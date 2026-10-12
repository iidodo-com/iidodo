import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { addr, rectToString } from './address';
import type {
  CellData, CellType, DefinedNameInfo, ExternalLinkInfo, HyperlinkInfo, SheetModel, SheetState,
  TableInfo, ValidationInfo, WorkbookModel,
} from './types';

export class ExcelXrayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelXrayError';
  }
}

export const MAX_FILE_BYTES = 150 * 1024 * 1024;
export const WARN_FILE_BYTES = 30 * 1024 * 1024;

export interface ParseOptions {
  fileName: string;
  onProgress?: (message: string) => void;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
}

export function detectFormat(bytes: Uint8Array, fileName: string): { ok: true } | { ok: false; message: string } {
  const lower = fileName.toLowerCase();
  if (bytes.length < 4) return { ok: false, message: 'ファイルが空、または小さすぎます。Excelファイルではない可能性があります。' };
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const isOle = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (isOle) {
    return {
      ok: false,
      message: lower.endsWith('.xls')
        ? '旧形式（.xls）は未対応です。Excelで「.xlsx」または「.xlsm」として保存し直してからお試しください。'
        : 'このファイルは旧形式（.xls）またはパスワードで暗号化されたブックの可能性があり、読み込めません。暗号化されたブックはパスワードを解除してから読み込んでください。',
    };
  }
  if (!isZip) {
    return { ok: false, message: 'Excelブック（.xlsx / .xlsm）として認識できません。ファイルが破損しているか、別の形式です。' };
  }
  if (lower.endsWith('.xlsb')) return { ok: false, message: '.xlsb 形式は未対応です。.xlsx で保存し直してください。' };
  return { ok: true };
}

interface RawWorkbookInfo {
  sheetStates: Map<string, SheetState>;
  sheetOrder: string[];
  definedNames: DefinedNameInfo[];
  externalLinks: ExternalLinkInfo[];
  fullCalcOnLoad: boolean;
  application: string | null;
  hasMacros: boolean;
  unanalyzedParts: string[];
}

export async function readRawWorkbookInfo(zip: JSZip): Promise<RawWorkbookInfo> {
  const text = async (p: string) => {
    const f = zip.file(p);
    return f ? await f.async('string') : null;
  };
  const wbXml = (await text('xl/workbook.xml')) ?? '';
  const relsXml = (await text('xl/_rels/workbook.xml.rels')) ?? '';

  const sheetStates = new Map<string, SheetState>();
  const sheetOrder: string[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*?\/?>/g)) {
    const name = attr(m[0], 'name');
    if (name == null) continue;
    sheetOrder.push(name);
    const st = attr(m[0], 'state');
    sheetStates.set(name, st === 'hidden' ? 'hidden' : st === 'veryHidden' ? 'veryHidden' : 'visible');
  }

  const definedNames: DefinedNameInfo[] = [];
  for (const m of wbXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)) {
    const name = attr(m[1], 'name');
    if (name == null) continue;
    const local = attr(m[1], 'localSheetId');
    definedNames.push({
      name,
      ref: decodeXml(m[2]).trim(),
      scope: local != null ? (sheetOrder[Number(local)] ?? `シート#${local}`) : null,
      hidden: attr(m[1], 'hidden') === '1' || attr(m[1], 'hidden') === 'true',
      builtin: name.startsWith('_xlnm.'),
    });
  }

  // 外部リンク: workbook.xml の <externalReference> の並び順が数式中の [n] に対応する
  const relTarget = new Map<string, string>();
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*?\/?>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) relTarget.set(id, target);
  }
  const externalLinks: ExternalLinkInfo[] = [];
  let idx = 0;
  for (const m of wbXml.matchAll(/<externalReference\b[^>]*?\/?>/g)) {
    idx++;
    const rid = attr(m[0], 'r:id');
    let part = rid ? relTarget.get(rid) ?? '' : '';
    part = part.replace(/^\/?(xl\/)?/, 'xl/');
    const relPath = part.replace(/([^/]+)$/, '_rels/$1.rels');
    const rel = part ? await text(relPath) : null;
    let target: string | null = null;
    if (rel) {
      const rm = /<Relationship\b[^>]*?\/?>/.exec(rel);
      if (rm) target = attr(rm[0], 'Target');
    }
    externalLinks.push({ index: idx, target, part });
  }

  const fullCalcOnLoad = /<calcPr\b[^>]*fullCalcOnLoad="(1|true)"/.test(wbXml);
  const appXml = await text('docProps/app.xml');
  const application = appXml ? (/<Application>([^<]*)<\/Application>/.exec(appXml)?.[1] ?? null) : null;

  const names = Object.keys(zip.files);
  const hasMacros = names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n));
  const counts: Array<[RegExp, string]> = [
    [/^xl\/charts\/chart\d+\.xml$/, 'グラフ'],
    [/^xl\/pivotTables\/pivotTable\d+\.xml$/, 'ピボットテーブル'],
    [/^xl\/drawings\/drawing\d+\.xml$/, '図形・描画オブジェクト'],
    [/^xl\/media\//, '画像'],
    [/^xl\/(comments\d*\.xml|threadedComments\/)/, 'コメント／スレッド化されたコメント'],
    [/^xl\/slicers\//, 'スライサー'],
    [/^xl\/embeddings\//, '埋め込みオブジェクト'],
    [/^xl\/queryTables\//, 'クエリテーブル（外部データ接続）'],
    [/^xl\/connections\.xml$/, 'データ接続'],
  ];
  const unanalyzedParts: string[] = [];
  for (const [re, label] of counts) {
    const n = names.filter((x) => re.test(x)).length;
    if (n > 0) unanalyzedParts.push(`${label}（${n}）`);
  }
  if (hasMacros) unanalyzedParts.push('VBAマクロ（実行・解析は行いません）');

  return { sheetStates, sheetOrder, definedNames, externalLinks, fullCalcOnLoad, application, hasMacros, unanalyzedParts };
}

function toIso(d: Date): string {
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function richToText(v: unknown): string {
  if (v && typeof v === 'object' && 'richText' in (v as object)) {
    return ((v as { richText: Array<{ text: string }> }).richText ?? []).map((t) => t.text).join('');
  }
  return typeof v === 'string' ? v : String(v ?? '');
}

type Prim = { t: CellType; v: string | number | boolean | null };

function primFrom(val: unknown): Prim {
  if (val == null) return { t: 'empty', v: null };
  if (typeof val === 'number') return { t: 'number', v: val };
  if (typeof val === 'string') return { t: val === '' ? 'empty' : 'string', v: val === '' ? null : val };
  if (typeof val === 'boolean') return { t: 'boolean', v: val };
  if (val instanceof Date) return { t: 'date', v: toIso(val) };
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if ('error' in o) return { t: 'error', v: String(o.error) };
    if ('richText' in o) return { t: 'string', v: richToText(o) };
    if ('text' in o) return { t: 'string', v: richToText(o.text) };
  }
  return { t: 'string', v: String(val) };
}

const VT = { Null: 0, Merge: 1, Number: 2, String: 3, Date: 4, Hyperlink: 5, Formula: 6, SharedString: 7, RichText: 8, Boolean: 9, Error: 10 };

export async function parseWorkbook(input: ArrayBuffer | Uint8Array, opts: ParseOptions): Promise<WorkbookModel> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const progress = opts.onProgress ?? (() => {});
  const fmt = detectFormat(bytes, opts.fileName);
  if (!fmt.ok) throw new ExcelXrayError(fmt.message);
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ExcelXrayError(`ファイルサイズが大きすぎます（上限 ${Math.round(MAX_FILE_BYTES / 1048576)}MB）。`);
  }
  const warnings: string[] = [];
  if (bytes.length > WARN_FILE_BYTES) {
    warnings.push('ファイルが大きいため、メモリ使用量と処理時間が増えています。');
  }

  progress('ZIPを展開しています');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ExcelXrayError('ファイルを展開できません。破損しているか、Excelブックではない可能性があります。');
  }
  if (!zip.file('xl/workbook.xml')) {
    throw new ExcelXrayError(
      zip.file('xl/workbook.bin')
        ? '.xlsb 形式は未対応です。.xlsx で保存し直してください。'
        : 'Excelブック（xl/workbook.xml）が見つかりません。破損しているか、Excel以外のファイルです。',
    );
  }

  progress('ブックの構造情報を読み取っています');
  const raw = await readRawWorkbookInfo(zip);

  progress('シートとセルを読み取っています');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch (e) {
    throw new ExcelXrayError(`ブックの読み込みに失敗しました（破損または非対応の内容）: ${e instanceof Error ? e.message : String(e)}`);
  }

  const sheets: SheetModel[] = [];
  let i = 0;
  for (const ws of wb.worksheets) {
    progress(`シート「${ws.name}」を解析しています (${i + 1}/${wb.worksheets.length})`);
    sheets.push(readSheet(ws, i, raw.sheetStates.get(ws.name) ?? (ws.state as SheetState) ?? 'visible'));
    i++;
  }

  const lower = opts.fileName.toLowerCase();
  const format = lower.endsWith('.xlsm') ? 'xlsm（マクロ有効ブック）' : lower.endsWith('.xlsx') ? 'xlsx' : (lower.split('.').pop() ?? '不明');
  return {
    fileName: opts.fileName,
    fileSize: bytes.length,
    format,
    sheets,
    definedNames: raw.definedNames,
    externalLinks: raw.externalLinks,
    hasMacros: raw.hasMacros,
    fullCalcOnLoad: raw.fullCalcOnLoad,
    application: raw.application,
    unanalyzedParts: raw.unanalyzedParts,
    warnings,
  };
}

function readSheet(ws: ExcelJS.Worksheet, index: number, state: SheetState): SheetModel {
  const cells: CellData[] = [];
  const hyperlinks: HyperlinkInfo[] = [];
  let formulaCount = 0;
  let valueCount = 0;
  let minR = Infinity, minC = Infinity, maxR = 0, maxC = 0;

  ws.eachRow({ includeEmpty: false }, (row, r) => {
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      const type = cell.type as number;
      if (type === VT.Merge || type === VT.Null) return;
      const nf = cell.numFmt && cell.numFmt !== 'General' ? cell.numFmt : undefined;
      let data: CellData | null = null;
      if (type === VT.Formula) {
        // 注意: ExcelJS の cell.value は計算結果が 0 / false / 空文字のとき result を落とすため、
        // 内部モデル(cell.model)から保存結果を直接読む。
        const fv = cell.model as unknown as { formula?: string; sharedFormula?: string; result?: unknown; shareType?: string };
        const f = (cell.formula ?? fv.formula ?? '').toString();
        const hasResult = fv.result !== undefined && fv.result !== null;
        const prim = hasResult ? primFrom(fv.result) : { t: 'empty' as CellType, v: null };
        data = { r, c, t: prim.t, v: prim.v, f, cached: hasResult, nf };
        if (fv.shareType === 'array') data.fkind = 'array';
        formulaCount++;
      } else if (type === VT.Hyperlink) {
        const hv = cell.value as { text?: unknown; hyperlink?: string };
        // リンクのテキストが数式オブジェクトの場合も、文字列化せず保存結果を取り出す
        const inner = hv.text && typeof hv.text === 'object' && 'formula' in (hv.text as object)
          ? (hv.text as { formula?: string; result?: unknown }) : null;
        const prim = primFrom(inner ? inner.result : hv.text ?? '');
        const target = hv.hyperlink ?? '';
        data = { r, c, t: prim.t, v: prim.v, nf, link: target };
        if (inner?.formula) { data.f = inner.formula; data.cached = inner.result !== undefined; formulaCount++; }
        hyperlinks.push({ address: addr(r, c), target, external: !target.startsWith('#') });
        if (prim.t !== 'empty') valueCount++;
      } else {
        const prim = primFrom(cell.value);
        if (prim.t === 'empty') return;
        data = { r, c, t: prim.t, v: prim.v, nf };
        valueCount++;
      }
      cells.push(data);
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
    });
  });

  const hiddenRows: number[] = [];
  const rowTotal = Math.min(ws.rowCount, 1048576);
  for (let r = 1; r <= rowTotal; r++) {
    // getRow は未定義の行を生成しうるため、定義済みの行だけを調べる
    const row = (ws as unknown as { _rows: Array<ExcelJS.Row | undefined> })._rows?.[r - 1];
    if (row && row.hidden) hiddenRows.push(r);
  }
  const hiddenCols: number[] = [];
  for (const col of ws.columns ?? []) {
    if (col && col.hidden && col.number) hiddenCols.push(col.number);
  }

  const tables: TableInfo[] = [];
  try {
    for (const t of ws.getTables() as unknown as Array<{ table: { name: string; tableRef: string } }>) {
      tables.push({ name: t.table.name, ref: t.table.tableRef });
    }
  } catch { /* テーブルを読めない場合は空のまま */ }

  const validations: ValidationInfo[] = [];
  try {
    const dv = ((ws as unknown as { dataValidations?: { model?: unknown } }).dataValidations?.model ?? {}) as Record<string, { type?: string; formulae?: unknown[] }>;
    for (const [ref, v] of Object.entries(dv)) {
      validations.push({ ref, type: String(v.type ?? ''), formulae: (v.formulae ?? []).map(String) });
    }
  } catch { /* 入力規則を読めない場合は空のまま */ }

  const merges = [...(((ws.model as unknown as { merges?: string[] }).merges) ?? [])];

  cells.sort((a, b) => a.r - b.r || a.c - b.c);
  const hasCells = cells.length > 0;
  return {
    name: ws.name,
    index,
    state,
    usedRange: hasCells ? rectToString({ r1: minR, c1: minC, r2: maxR, c2: maxC }) : null,
    maxRow: hasCells ? maxR : 0,
    maxCol: hasCells ? maxC : 0,
    cells,
    formulaCount,
    valueCount,
    hiddenRows,
    hiddenCols,
    merges,
    hyperlinks,
    tables,
    validations,
  };
}
