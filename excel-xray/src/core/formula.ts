import { tokenize, translateFormulaToR1C1, translateFormulaToA1, parseA1Ref } from '@borgar/fx/xlsx';
import { addr, MAX_COL, MAX_ROW, type Rect } from './address';

/** 静的に参照先を確定できない関数 */
export const DYNAMIC_FUNCTIONS = new Set(['INDIRECT', 'OFFSET']);
export const AGGREGATE_FUNCTIONS = new Set([
  'SUM', 'SUBTOTAL', 'AVERAGE', 'COUNT', 'COUNTA', 'MAX', 'MIN', 'AGGREGATE', 'SUMIF', 'SUMIFS', 'PRODUCT', 'MEDIAN',
]);

export interface RefInfo {
  /** 数式中の表記そのまま */
  raw: string;
  /** 参照先シート名（同一シートなら undefined）。3D参照は 'A:C' のように保持 */
  sheet?: string;
  /** 外部ブック参照のとき、[n] の n（またはパス文字列） */
  external?: string;
  rect: Rect;
  kind: 'cell' | 'range' | 'column' | 'row';
}

export interface ParsedFormula {
  ok: boolean;
  error?: string;
  refs: RefInfo[];
  functions: string[];
  dynamicFunctions: string[];
  /** 定義名（範囲名）トークン */
  names: string[];
  /** テーブル構造化参照 */
  structured: string[];
  errorLiterals: string[];
  /** 数式中の数値リテラル */
  numbers: number[];
  hasExternal: boolean;
  /** R1C1相対表現（パターン比較用キー） */
  key: string;
  /** 参照を # に置換した「形」だけのキー */
  shape: string;
}

function isExternalText(s: string): boolean {
  return /\[[^\]]+\.(xls[xmb]?|xlam)\]/i.test(s) || /^\[\d+\]/.test(s);
}

export function parseFormula(formula: string, row: number, col: number): ParsedFormula {
  const out: ParsedFormula = {
    ok: true, refs: [], functions: [], dynamicFunctions: [], names: [], structured: [],
    errorLiterals: [], numbers: [], hasExternal: false, key: formula, shape: formula,
  };
  const text = formula.startsWith('=') ? formula : '=' + formula;
  let tokens;
  try {
    tokens = tokenize(text, { withLocation: false, mergeRefs: true, allowTernary: false });
  } catch (e) {
    out.ok = false;
    out.error = String(e);
    return out;
  }
  const shapeParts: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'fx_prefix': break;
      case 'whitespace': break;
      case 'unknown':
        out.ok = false;
        out.error = `解釈できないトークン: ${t.value}`;
        shapeParts.push(t.value);
        break;
      case 'func': {
        const name = t.value.toUpperCase().replace(/^_XLFN\./, '').replace(/^_XLWS\./, '');
        out.functions.push(name);
        if (DYNAMIC_FUNCTIONS.has(name)) out.dynamicFunctions.push(name);
        shapeParts.push(name);
        break;
      }
      case 'number': {
        const n = Number(t.value);
        if (Number.isFinite(n)) out.numbers.push(n);
        shapeParts.push(t.value);
        break;
      }
      case 'error':
        out.errorLiterals.push(t.value.toUpperCase());
        shapeParts.push(t.value.toUpperCase());
        break;
      case 'range_named':
        out.names.push(t.value);
        shapeParts.push(t.value);
        break;
      case 'structured':
        out.structured.push(t.value);
        shapeParts.push(t.value);
        break;
      case 'range':
      case 'range_beam':
      case 'range_ternary': {
        shapeParts.push('#');
        let parsedRef: ReturnType<typeof parseA1Ref> | null = null;
        try { parsedRef = parseA1Ref(t.value, {}); } catch { parsedRef = null; }
        if (!parsedRef || !('range' in parsedRef) || !parsedRef.range) {
          out.ok = false;
          out.error = `参照を解析できません: ${t.value}`;
          break;
        }
        const ref = parsedRef;
        const wbName = ref.workbookName || undefined;
        const sheet = ref.sheetName || undefined;
        const external = wbName;
        if (external !== undefined) out.hasExternal = true;
        const g = ref.range;
        const wholeCol = g.top == null && g.bottom == null;
        const wholeRow = g.left == null && g.right == null;
        const rect: Rect = {
          r1: g.top == null ? 1 : g.top + 1,
          r2: g.bottom == null ? MAX_ROW : g.bottom + 1,
          c1: g.left == null ? 1 : g.left + 1,
          c2: g.right == null ? MAX_COL : g.right + 1,
        };
        const single = !wholeCol && !wholeRow && rect.r1 === rect.r2 && rect.c1 === rect.c2;
        out.refs.push({
          raw: t.value, sheet, external, rect,
          kind: wholeCol ? 'column' : wholeRow ? 'row' : single ? 'cell' : 'range',
        });
        break;
      }
      default:
        shapeParts.push(t.value);
    }
  }
  if (isExternalText(formula)) out.hasExternal = true;
  out.shape = shapeParts.join('');
  try {
    out.key = translateFormulaToR1C1(text, addr(row, col), {}).replace(/\s+/g, '');
  } catch {
    out.key = text.replace(/\s+/g, '');
    out.ok = false;
    out.error ??= '相対位置への変換に失敗しました';
  }
  return out;
}

/** パターンキー(R1C1)を指定セルに適用したA1形式の数式（"=" なし）を返す */
export function keyToFormulaAt(key: string, row: number, col: number): string {
  try {
    return translateFormulaToA1(key, addr(row, col), {}).replace(/^=/, '');
  } catch {
    return key;
  }
}

/** 2つのR1C1キーの最初の相違点を人間向けに説明する（A1表記に戻して比較） */
export function describeKeyDifference(
  actualKey: string, expectedKey: string, row: number, col: number,
): string {
  const a = splitA1(keyToFormulaAt(actualKey, row, col));
  const b = splitA1(keyToFormulaAt(expectedKey, row, col));
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return `「${a[i]}」の部分が、周辺の数式の並びから想定される「${b[i]}」と異なります`;
    }
  }
  if (a.length !== b.length) return '周辺の数式と項の数（引数・演算子の数）が異なります';
  return '周辺の数式と構造が異なります';
}

function splitA1(f: string): string[] {
  try {
    return tokenize('=' + f, { withLocation: false, mergeRefs: true })
      .filter((t) => t.type !== 'fx_prefix' && t.type !== 'whitespace')
      .map((t) => t.value);
  } catch {
    return [f];
  }
}

export function stripLeadingEquals(f: string): string {
  return f.startsWith('=') ? f.slice(1) : f;
}
