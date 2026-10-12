import { addr, compressRuns, cellKey, colToLetters, rectArea, rectToString, MAX_ROW } from './address';
import { AGGREGATE_FUNCTIONS, describeKeyDifference, keyToFormulaAt } from './formula';
import { buildIndex, type FormulaEntry, type SheetIndex, type WorkbookIndex } from './formulaTable';
import type {
  AnalysisResult, Certainty, Coverage, Finding, FindingKind, Severity, StructureItem, Summary, WorkbookModel,
} from './types';

const CAP_PER_KIND_SHEET = 300;
const ERROR_VALUES = new Set(['#REF!', '#DIV/0!', '#VALUE!', '#NAME?', '#N/A', '#NUM!', '#NULL!']);

const ERROR_ADVICE: Record<string, string> = {
  '#REF!': '参照先のセル・行・列・シートが削除された可能性があります。数式が指していた元のセルを確認してください。',
  '#DIV/0!': '0または空白で割り算している可能性があります。分母のセルの値を確認してください。',
  '#VALUE!': '数値が必要な箇所に文字列などが入っている可能性があります。参照先セルのデータ型を確認してください。',
  '#NAME?': '関数名・名前定義の誤り、または未対応の関数の可能性があります。名前定義と関数名のつづりを確認してください。',
  '#N/A': '検索関数で一致する値が見つからない、または値が未入力の可能性があります。検索キーと検索範囲を確認してください。',
  '#NUM!': '数値計算が不可能な引数（負数の平方根など）の可能性があります。引数の値を確認してください。',
  '#NULL!': '範囲演算子（スペース）の指定誤りの可能性があります。参照範囲の区切り文字を確認してください。',
};

class Collector {
  findings: Finding[] = [];
  structure: StructureItem[] = [];
  notes: string[] = [];
  private seq = 0;
  private perKey = new Map<string, number>();
  private omitted = new Map<string, number>();

  add(f: Omit<Finding, 'id'>, capKey?: string): boolean {
    if (capKey) {
      const n = (this.perKey.get(capKey) ?? 0) + 1;
      this.perKey.set(capKey, n);
      if (n > CAP_PER_KIND_SHEET) {
        this.omitted.set(capKey, (this.omitted.get(capKey) ?? 0) + 1);
        return false;
      }
    }
    this.findings.push({ ...f, id: `F${++this.seq}` });
    return true;
  }
  flushOmitted() {
    for (const [k, n] of this.omitted) {
      this.notes.push(`${k.replace('|', ' / ')}: 表示上限(${CAP_PER_KIND_SHEET}件)を超えたため、さらに ${n} 件を省略しました（件数は集計に含まれます）。`);
    }
  }
}

function sheetOf(ix: WorkbookIndex, name: string | undefined, ownSheet: string): SheetIndex | undefined {
  if (name == null) return ix.sheets.get(ownSheet);
  return ix.sheets.get(name) ?? ix.sheetByLower.get(name.toLowerCase());
}

function sheetExists(ix: WorkbookIndex, name: string): boolean {
  if (ix.sheetByLower.has(name.toLowerCase())) return true;
  // 3D参照 'Sheet1:Sheet3'
  if (name.includes(':')) {
    return name.split(':').every((n) => ix.sheetByLower.has(n.toLowerCase()));
  }
  return false;
}

export function analyzeWorkbook(model: WorkbookModel, ixIn?: WorkbookIndex): AnalysisResult {
  const ix = ixIn ?? buildIndex(model);
  const col = new Collector();

  const formulaErrorCells = detectErrors(ix, col);
  const patternMismatch = detectPatternMismatch(ix, col);
  const hardcode = detectHardcodedInFormulas(ix, col);
  detectEmbeddedConstants(ix, col);
  detectReferenceProblems(ix, col);
  const circularGroups = detectCircular(ix, col);
  const dynamicFormulas = detectDynamic(ix, col);
  detectNoCache(ix, col);
  const counts = detectStructure(ix, col);
  for (const e of ix.parseFailures) {
    col.add({
      kind: 'parse-failed', severity: 'low', certainty: 'confirmed', sheet: e.sheet, address: addr(e.r, e.c), formula: '=' + e.f,
      title: '数式を解析できませんでした',
      reason: e.parsed.error ?? '数式を解析できませんでした',
      advice: 'この数式は参照関係・パターン比較の対象外です。Excelで内容を直接確認してください。',
    }, 'parse-failed|' + e.sheet);
  }
  col.flushOmitted();

  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  col.findings.sort((a, b) =>
    order[a.severity] - order[b.severity] ||
    (a.sheet ?? '').localeCompare(b.sheet ?? '') ||
    cmpAddr(a.address, b.address));

  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of col.findings) bySeverity[f.severity]++;

  const sheetsWithData = model.sheets.filter((s) => s.cells.length > 0).length;
  const summary: Summary = {
    fileName: model.fileName,
    fileFormat: model.format,
    fileSize: model.fileSize,
    sheetCount: model.sheets.length,
    visibleSheets: model.sheets.filter((s) => s.state === 'visible').length,
    hiddenSheets: model.sheets.filter((s) => s.state === 'hidden').length,
    veryHiddenSheets: model.sheets.filter((s) => s.state === 'veryHidden').length,
    sheetsWithData,
    formulaCount: ix.entries.length,
    formulaErrorCells,
    patternMismatch,
    hardcodeCandidates: hardcode,
    externalRefs: ix.entries.filter((e) => e.parsed.hasExternal).length,
    externalLinks: model.externalLinks.length,
    hiddenRows: model.sheets.reduce((n, s) => n + s.hiddenRows.length, 0),
    hiddenCols: model.sheets.reduce((n, s) => n + s.hiddenCols.length, 0),
    definedNames: model.definedNames.filter((d) => !d.builtin).length,
    mergedCells: counts.merged,
    hyperlinks: counts.hyperlinks,
    circularGroups,
    dynamicFormulas,
    bySeverity,
  };

  return {
    summary,
    findings: col.findings,
    structure: col.structure,
    coverage: buildCoverage(model, ix),
    analyzedAt: new Date().toISOString(),
    truncatedNotes: col.notes,
  };
}

function cmpAddr(a?: string, b?: string): number {
  const pa = /^([A-Z]+)(\d+)/.exec(a ?? '');
  const pb = /^([A-Z]+)(\d+)/.exec(b ?? '');
  if (!pa || !pb) return (a ?? '').localeCompare(b ?? '');
  return Number(pa[2]) - Number(pb[2]) || pa[1].length - pb[1].length || pa[1].localeCompare(pb[1]);
}

// ---------------------------------------------------------------- エラー
function detectErrors(ix: WorkbookIndex, col: Collector): number {
  let formulaErrors = 0;
  for (const si of ix.sheets.values()) {
    for (const cell of si.sheet.cells) {
      const a = addr(cell.r, cell.c);
      if (cell.f !== undefined) {
        const p = si.formulas.get(cellKey(cell.r, cell.c))!.parsed;
        if (cell.t === 'error' && ERROR_VALUES.has(String(cell.v))) {
          formulaErrors++;
          const ev = String(cell.v);
          col.add({
            kind: 'formula-error', severity: 'high', certainty: 'confirmed', sheet: si.sheet.name, address: a, formula: '=' + cell.f,
            title: `数式の保存結果が ${ev} です`,
            reason: `このセルには数式があり、ファイルに保存されている計算結果が ${ev} です。数式が存在するだけでなく、保存された結果がエラーであることを根拠にしています。`,
            advice: ERROR_ADVICE[ev] + '（保存結果はExcelで最後に計算・保存された時点の値で、現在の値と異なる可能性があります）',
            evidence: `保存された結果: ${ev}`,
          }, 'formula-error|' + si.sheet.name);
        }
        if (p.errorLiterals.includes('#REF!')) {
          col.add({
            kind: 'ref-error-in-formula', severity: 'high', certainty: 'confirmed', sheet: si.sheet.name, address: a, formula: '=' + cell.f,
            title: '数式の中に #REF! が含まれています',
            reason: '数式本体に #REF! が書き込まれています。参照先が削除された結果、数式が壊れている状態です。',
            advice: ERROR_ADVICE['#REF!'],
            evidence: '数式内のトークン: #REF!',
          }, 'ref-error-in-formula|' + si.sheet.name);
        }
      } else if (cell.t === 'error') {
        col.add({
          kind: 'error-constant', severity: 'medium', certainty: 'confirmed', sheet: si.sheet.name, address: a,
          title: `エラー値 ${cell.v} が値として入力されています`,
          reason: '数式ではなく、エラー値そのものがセルの値として保存されています（数式結果を値貼り付けした可能性があります）。',
          advice: '元の数式や貼り付け元を確認してください。',
          evidence: `セルの値: ${cell.v}`,
        }, 'error-constant|' + si.sheet.name);
      }
    }
  }
  return formulaErrors;
}

// ---------------------------------------------------------------- パターン不一致
interface Run { cells: FormulaEntry[]; dir: 'col' | 'row' }

function collectRuns(si: SheetIndex): Run[] {
  const runs: Run[] = [];
  const byCol = new Map<number, FormulaEntry[]>();
  const byRow = new Map<number, FormulaEntry[]>();
  for (const e of si.formulas.values()) {
    if (!e.parsed.ok) continue;
    (byCol.get(e.c) ?? byCol.set(e.c, []).get(e.c)!).push(e);
    (byRow.get(e.r) ?? byRow.set(e.r, []).get(e.r)!).push(e);
  }
  const split = (list: FormulaEntry[], pos: (e: FormulaEntry) => number, dir: 'col' | 'row') => {
    list.sort((a, b) => pos(a) - pos(b));
    let cur: FormulaEntry[] = [];
    for (const e of list) {
      if (cur.length && pos(e) !== pos(cur[cur.length - 1]) + 1) {
        if (cur.length >= 4) runs.push({ cells: cur, dir });
        cur = [];
      }
      cur.push(e);
    }
    if (cur.length >= 4) runs.push({ cells: cur, dir });
  };
  for (const l of byCol.values()) split(l, (e) => e.r, 'col');
  for (const l of byRow.values()) split(l, (e) => e.c, 'row');
  return runs;
}

function detectPatternMismatch(ix: WorkbookIndex, col: Collector): number {
  const flagged = new Set<string>();
  for (const si of ix.sheets.values()) {
    const seen = new Map<number, { f: Omit<Finding, 'id'>; extra: string[] }>();
    for (const run of collectRuns(si)) {
      const counts = new Map<string, FormulaEntry[]>();
      for (const e of run.cells) (counts.get(e.parsed.key) ?? counts.set(e.parsed.key, []).get(e.parsed.key)!).push(e);
      let domKey = '';
      let dom: FormulaEntry[] = [];
      for (const [k, v] of counts) if (v.length > dom.length) { domKey = k; dom = v; }
      const len = run.cells.length;
      const minCount = run.dir === 'col' ? 3 : 4;
      const minRatio = run.dir === 'col' ? 0.6 : 0.7;
      if (dom.length < minCount || dom.length / len < minRatio) continue;
      const exampleSorted = dom;
      for (const e of run.cells) {
        if (e.parsed.key === domKey) continue;
        const group = counts.get(e.parsed.key)!;
        if (group.length > 2 || group.length >= dom.length) continue;
        const isEdge = e === run.cells[0] || e === run.cells[len - 1];
        // 合計行（run端で集計関数が他のセルを参照）は正常とみなして除外
        if (isEdge && e.parsed.functions.some((f) => AGGREGATE_FUNCTIONS.has(f)) && coversRun(e, run, si)) continue;
        const key = cellKey(e.r, e.c);
        const expected = keyToFormulaAt(domKey, e.r, e.c);
        const sameShape = e.parsed.shape === dom[0].parsed.shape;
        const diff = describeKeyDifference(e.parsed.key, domKey, e.r, e.c);
        const nearest = nearestExamples(exampleSorted, e, run.dir);
        const dirLabel = run.dir === 'col' ? '同じ列の上下' : '同じ行の左右';
        const severity: Severity = sameShape ? 'medium' : isEdge ? 'low' : 'medium';
        const certainty: Certainty = isEdge || dom.length < 4 ? 'candidate' : 'likely';
        const f: Omit<Finding, 'id'> = {
          kind: 'pattern-mismatch', severity, certainty, sheet: si.sheet.name, address: addr(e.r, e.c), formula: '=' + e.f,
          title: sameShape ? '数式パターン不一致の可能性（参照先のずれ）' : '数式パターン不一致の可能性（構造の違い）',
          reason: `${dirLabel}に連続する ${len} 個の数式のうち ${dom.length} 個が同じパターン（相対位置が同一）ですが、このセルだけ異なります。${diff}。`,
          advice: `周辺の数式から想定される形は「=${expected}」です。意図した違い（例外処理・特別な行）か、コピー漏れ・参照ずれかを元データと照らして確認してください。`,
          evidence: `周辺の数式: ${nearest}`,
        };
        const prev = seen.get(key);
        if (prev) {
          prev.extra.push(`${dirLabel}方向でも同様に検出`);
        } else {
          seen.set(key, { f, extra: [] });
        }
      }
    }
    for (const { f, extra } of seen.values()) {
      if (extra.length) f.evidence += `（${extra.join('、')}）`;
      col.add(f, 'pattern-mismatch|' + si.sheet.name);
      flagged.add(si.sheet.name + '!' + f.address);
    }
  }
  return flagged.size;
}

function coversRun(e: FormulaEntry, run: Run, si: SheetIndex): boolean {
  for (const ref of e.parsed.refs) {
    if (ref.sheet != null || ref.external != null) continue;
    for (const o of run.cells) {
      if (o === e) continue;
      if (o.r >= ref.rect.r1 && o.r <= ref.rect.r2 && o.c >= ref.rect.c1 && o.c <= ref.rect.c2) return true;
    }
    // 数式セル以外（定数）の範囲集計も合計行とみなす
    const cells = si.allCells;
    if (cells.any(ref.rect.r1, ref.rect.c1, ref.rect.r2, ref.rect.c2) && rectArea(ref.rect) > 1 && ref.rect.r2 < e.r + 1) return true;
  }
  return false;
}

function nearestExamples(dom: FormulaEntry[], e: FormulaEntry, dir: 'col' | 'row'): string {
  const dist = (o: FormulaEntry) => (dir === 'col' ? Math.abs(o.r - e.r) : Math.abs(o.c - e.c));
  return [...dom].sort((a, b) => dist(a) - dist(b)).slice(0, 2)
    .map((o) => `${addr(o.r, o.c)} =${o.f}`).join(' / ');
}

// ---------------------------------------------------------------- 数式領域への固定値混入
function detectHardcodedInFormulas(ix: WorkbookIndex, col: Collector): number {
  let n = 0;
  for (const si of ix.sheets.values()) {
    const found = new Map<number, Omit<Finding, 'id'>>();
    for (const cell of si.sheet.cells) {
      if (cell.f !== undefined) continue;
      if (cell.t !== 'number' && cell.t !== 'string') continue;
      for (const dir of ['col', 'row'] as const) {
        const dr = dir === 'col' ? 1 : 0;
        const dc = dir === 'col' ? 0 : 1;
        const get = (k: number) => si.formulas.get(cellKey(cell.r + dr * k, cell.c + dc * k));
        const before = [get(-1), get(-2)];
        const after = [get(1), get(2)];
        const b1 = before[0], a1 = after[0];
        let both: 'both' | 'before' | null = null;
        if (b1 && a1 && b1.parsed.ok && a1.parsed.ok && b1.parsed.key === a1.parsed.key) both = 'both';
        // 片側のみ: 数式列の「末尾」に置かれた固定値だけを対象とする（先頭の固定値は見出し・入力パラメータの可能性が高い）
        else if (b1 && before[1] && get(-3) && b1.parsed.ok && b1.parsed.key === before[1].parsed.key
          && b1.parsed.key === get(-3)!.parsed.key && !a1) both = 'before';
        if (!both) continue;
        const ref = b1!;
        // 見出し的な文字列は、片側のみの場合は除外。両側が同一パターンの数式に挟まれる場合のみ対象
        if (cell.t === 'string' && both !== 'both') continue;
        // 片側のみの場合: 集計行(合計)の手入力などの可能性が高く、確実性は低い
        const strong = both === 'both' && (get(-2)?.parsed.key === ref.parsed.key || get(2)?.parsed.key === ref.parsed.key);
        const key = cellKey(cell.r, cell.c);
        const expected = keyToFormulaAt(ref.parsed.key, cell.r, cell.c);
        const ctxLabel = dir === 'col' ? '同じ列の上下' : '同じ行の左右';
        const prev = found.get(key);
        const sev: Severity = cell.t === 'string' ? 'low' : both === 'both' ? 'medium' : 'low';
        const certainty: Certainty = strong ? 'likely' : 'candidate';
        if (prev && prev.certainty === 'likely') continue;
        found.set(key, {
          kind: 'hardcode-in-formulas', severity: sev, certainty, sheet: si.sheet.name, address: addr(cell.r, cell.c),
          title: '数式領域に固定値が混在している可能性',
          reason: both === 'both'
            ? `${ctxLabel}のセルは同じパターンの数式ですが、このセルだけ ${cell.t === 'number' ? '数値' : '文字列'}（${String(cell.v)}）の固定値です。`
            : `直前までの数式が同じパターンで続いた後、末尾だけ固定値（${String(cell.v)}）になっています。合計や手入力欄として意図したものの可能性もあります。`,
          advice: `周辺の数式から想定される形は「=${expected}」です。意図的な手入力（上書き・例外・合計の手入力）か、数式を値で上書きした事故かを確認してください。`,
          evidence: `周辺の数式: ${addr(ref.r, ref.c)} =${ref.f}`,
        });
      }
    }
    for (const f of found.values()) { col.add(f, 'hardcode-in-formulas|' + si.sheet.name); n++; }
  }
  return n;
}

// ---------------------------------------------------------------- 定数の埋め込み
const COMMON_INTS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 24, 30, 31, 60, 100, 360, 365, 1000, 10000, 1000000]);
function suspiciousLiterals(nums: number[]): number[] {
  return nums.filter((n) => {
    const a = Math.abs(n);
    if (COMMON_INTS.has(a)) return false;
    if (a === 0.5 || a === 0.1 || a === 0.01) return false;
    return !Number.isInteger(a) || a >= 100;
  });
}

function detectEmbeddedConstants(ix: WorkbookIndex, col: Collector) {
  for (const si of ix.sheets.values()) {
    const groups = new Map<string, FormulaEntry[]>();
    for (const e of si.formulas.values()) {
      if (!e.parsed.ok || e.parsed.refs.length === 0) continue;
      const lits = suspiciousLiterals(e.parsed.numbers);
      if (lits.length === 0) continue;
      const k = e.parsed.key;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.r - b.r || a.c - b.c);
      const first = list[0];
      const lits = [...new Set(suspiciousLiterals(first.parsed.numbers))];
      col.add({
        kind: 'embedded-constant', severity: 'low', certainty: 'candidate', sheet: si.sheet.name, address: addr(first.r, first.c),
        formula: '=' + first.f,
        title: '数式に数値が直接埋め込まれています',
        reason: `数式中に ${lits.join(', ')} という数値が直接書かれています。税率・係数・閾値などが数式に埋め込まれていると、変更時に更新漏れが起きやすくなります。`,
        advice: '意図した定数であれば問題ありません。変更されうる値は、別セルや名前定義にして参照する運用を検討してください。',
        count: list.length,
        cells: list.slice(0, 30).map((e) => addr(e.r, e.c)),
        evidence: list.length > 1 ? `同じパターンの数式が ${list.length} セルあります` : undefined,
      }, 'embedded-constant|' + si.sheet.name);
    }
  }
}

// ---------------------------------------------------------------- 参照の問題
function detectReferenceProblems(ix: WorkbookIndex, col: Collector) {
  for (const e of ix.entries) {
    if (!e.parsed.ok) continue;
    const a = addr(e.r, e.c);
    const si = ix.sheets.get(e.sheet)!;
    for (const ref of e.parsed.refs) {
      if (ref.external != null) continue;
      if (ref.sheet != null && !sheetExists(ix, ref.sheet)) {
        col.add({
          kind: 'ref-sheet-missing', severity: 'high', certainty: 'likely', sheet: e.sheet, address: a, formula: '=' + e.f,
          title: `参照先のシート「${ref.sheet}」が見つかりません`,
          reason: `数式が「${ref.sheet}」シートを参照していますが、このブックにはその名前のシートがありません。シート名の変更・削除、または他ブックからのコピーの可能性があります。`,
          advice: '参照先シートの名前、または意図したブックかどうかを確認してください。',
          evidence: `参照: ${ref.raw}`,
        }, 'ref-sheet-missing|' + e.sheet);
        continue;
      }
      // 空白セル参照（同一ブック内・実在シート・巨大範囲を除く）
      if (ref.kind === 'column' || ref.kind === 'row') continue;
      const target = sheetOf(ix, ref.sheet, e.sheet);
      if (!target || ref.sheet?.includes(':')) continue;
      if (ref.rect.r2 === MAX_ROW) continue;
      const hasAny = target.allCells.any(ref.rect.r1, ref.rect.c1, ref.rect.r2, ref.rect.c2);
      if (!hasAny) {
        col.add({
          kind: 'ref-blank', severity: 'low', certainty: 'candidate', sheet: e.sheet, address: a, formula: '=' + e.f,
          title: '参照先がすべて空白です',
          reason: `参照先 ${ref.raw}（${target.sheet.name}）には値も数式もありません。入力待ちの欄、または参照ずれ・削除済みデータへの参照の可能性があります。`,
          advice: '空白が意図したもの（これから入力する欄）か確認してください。',
          evidence: `参照: ${ref.raw} → ${rectToString(ref.rect)}`,
        }, 'ref-blank|' + e.sheet);
      }
    }
    void si;
  }
}

// ---------------------------------------------------------------- 循環参照（強連結成分）
export function findCycles(ix: WorkbookIndex, edgeLimit = 4000): { groups: FormulaEntry[][]; truncated: boolean } {
  const idOf = new Map<FormulaEntry, number>();
  ix.entries.forEach((e, i) => idOf.set(e, i));
  const adj: number[][] = new Array(ix.entries.length);
  let truncated = false;
  ix.entries.forEach((e, i) => {
    const out = new Set<number>();
    for (const ref of e.parsed.refs) {
      if (ref.external != null) continue;
      const target = sheetOf(ix, ref.sheet, e.sheet);
      if (!target || ref.sheet?.includes(':')) continue;
      const cut = target.formulaCells.query(ref.rect.r1, ref.rect.c1, ref.rect.r2, ref.rect.c2, edgeLimit, (r, c) => {
        const t = target.formulas.get(cellKey(r, c));
        if (t) out.add(idOf.get(t)!);
      });
      if (cut) truncated = true;
    }
    adj[i] = [...out];
  });
  // 反復版 Tarjan
  const n = adj.length;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const groups: FormulaEntry[][] = [];
  let counter = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work: Array<[number, number]> = [[s, 0]];
    index[s] = low[s] = counter++;
    stack.push(s);
    onStack[s] = 1;
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      if (top[1] < adj[v].length) {
        const w = adj[v][top[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        if (low[v] === index[v]) {
          const comp: number[] = [];
          let w: number;
          do { w = stack.pop()!; onStack[w] = 0; comp.push(w); } while (w !== v);
          if (comp.length > 1 || adj[v].includes(v)) groups.push(comp.map((i) => ix.entries[i]));
        }
        work.pop();
        if (work.length) {
          const p = work[work.length - 1][0];
          low[p] = Math.min(low[p], low[v]);
        }
      }
    }
  }
  return { groups, truncated };
}

function detectCircular(ix: WorkbookIndex, col: Collector): number {
  const { groups, truncated } = findCycles(ix);
  for (const g of groups) {
    g.sort((a, b) => a.sheet.localeCompare(b.sheet) || a.r - b.r || a.c - b.c);
    const first = g[0];
    const label = g.slice(0, 8).map((e) => `${e.sheet}!${addr(e.r, e.c)}`).join(' → ');
    col.add({
      kind: 'circular-ref', severity: 'high', certainty: 'likely', sheet: first.sheet, address: addr(first.r, first.c), formula: '=' + first.f,
      title: g.length === 1 ? '自己参照（循環参照）の可能性' : `循環参照の可能性（${g.length} セル）`,
      reason: g.length === 1
        ? '数式が自分自身のセルを参照しています。意図的な反復計算でない限り、Excelは循環参照として警告します。'
        : `数式同士が互いに参照し合う閉路が静的な参照関係から見つかりました: ${label}${g.length > 8 ? ' …' : ''}`,
      advice: '参照の流れをたどり、どこで輪になっているか確認してください（依存関係グラフ画面で確認できます）。INDIRECT/OFFSETによる実行時の参照は静的解析できません。',
      count: g.length,
      cells: g.slice(0, 30).map((e) => `${e.sheet}!${addr(e.r, e.c)}`),
    });
  }
  if (truncated) col.notes.push('循環参照の検査: 非常に大きな範囲参照があるため、一部の参照を打ち切って検査しました（循環の見落としがありうる）。');
  return groups.length;
}

// ---------------------------------------------------------------- 動的参照 / 保存結果なし
function detectDynamic(ix: WorkbookIndex, col: Collector): number {
  let n = 0;
  for (const e of ix.entries) {
    if (e.parsed.dynamicFunctions.length === 0) continue;
    n++;
    col.add({
      kind: 'dynamic-ref', severity: 'info', certainty: 'confirmed', sheet: e.sheet, address: addr(e.r, e.c), formula: '=' + e.f,
      title: `動的参照（${[...new Set(e.parsed.dynamicFunctions)].join(', ')}）を含みます`,
      reason: '参照先が実行時に決まるため、静的解析では参照先を確定できません。依存関係グラフにこのセルの参照元が完全には表示されない可能性があります。',
      advice: 'このセルの参照先は、Excel上で実際の計算結果や引数を確認してください。依存関係を完全に特定できないことに注意してください。',
    }, 'dynamic-ref|' + e.sheet);
  }
  return n;
}

function detectNoCache(ix: WorkbookIndex, col: Collector) {
  for (const si of ix.sheets.values()) {
    const missing = [...si.formulas.values()].filter((e) => !e.cell.cached);
    if (missing.length === 0) continue;
    const first = missing[0];
    col.add({
      kind: 'no-cache', severity: 'info', certainty: 'confirmed', sheet: si.sheet.name, address: addr(first.r, first.c), formula: '=' + first.f,
      title: `保存された計算結果がない数式が ${missing.length} 個あります`,
      reason: 'ファイルに計算結果が保存されていないため、これらのセルのエラー判定や値の確認はできません（Excel以外のツールで作成・編集された、または未計算のファイルの可能性）。本ツールは再計算を行いません。',
      advice: 'Excelで開いて再計算・保存すると結果が保存されます。このツールでは数式の構造のみ検査しています。',
      count: missing.length,
      cells: missing.slice(0, 30).map((e) => addr(e.r, e.c)),
    });
  }
  if (ix.model.fullCalcOnLoad) {
    col.add({
      kind: 'recalc-flag', severity: 'info', certainty: 'confirmed',
      title: '開く時に再計算するフラグが設定されています',
      reason: 'ブックに fullCalcOnLoad が設定されています。保存されている計算結果は、Excelで開いた時点の値と異なる可能性があります。',
      advice: '保存結果ベースの判定（数式エラーなど）は最新ではない可能性があります。',
    });
  }
}

// ---------------------------------------------------------------- 構造
function detectStructure(ix: WorkbookIndex, col: Collector): { merged: number; hyperlinks: number } {
  const model = ix.model;
  let merged = 0;
  let hyperlinks = 0;
  for (const s of model.sheets) {
    const stateLabel = s.state === 'visible' ? '表示' : s.state === 'hidden' ? '非表示' : 'Very Hidden';
    col.structure.push({
      category: 'sheet', name: s.name, sheet: s.name, address: s.usedRange ?? undefined,
      evidence: `表示状態: ${stateLabel} / 使用範囲: ${s.usedRange ?? 'なし'} / 数式 ${s.formulaCount}・値 ${s.valueCount}（workbook.xml の state 属性）`,
    });
    if (s.state === 'hidden') {
      col.add({
        kind: 'hidden-sheet', severity: 'medium', certainty: 'confirmed', sheet: s.name,
        title: `非表示シート「${s.name}」`,
        reason: 'workbook.xml でシートの state が hidden になっています。通常のシート一覧には表示されません。',
        advice: '非表示にした理由は断定できません。中身（数式・値・他シートからの参照）を確認してください。',
        evidence: `使用範囲: ${s.usedRange ?? 'なし'} / 数式 ${s.formulaCount}・値 ${s.valueCount}`,
      });
    } else if (s.state === 'veryHidden') {
      col.add({
        kind: 'very-hidden-sheet', severity: 'high', certainty: 'confirmed', sheet: s.name,
        title: `Very Hiddenシート「${s.name}」`,
        reason: 'workbook.xml でシートの state が veryHidden になっています。Excelの通常の「再表示」操作では選択肢に出てきません（VBAエディタ等で変更が必要）。',
        advice: '作成意図は断定できません。中身と、このシートを参照している数式がないか確認してください。',
        evidence: `使用範囲: ${s.usedRange ?? 'なし'} / 数式 ${s.formulaCount}・値 ${s.valueCount}`,
      });
    }
    // 非表示の行・列
    const rowRuns = compressRuns(s.hiddenRows);
    if (rowRuns.length) {
      const text = rowRuns.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(', ');
      const dataInHidden = s.cells.filter((c) => s.hiddenRows.includes(c.r)).length;
      for (const [a, b] of rowRuns) col.structure.push({ category: 'hidden-rows', name: `非表示の行 ${a === b ? a : a + '-' + b}`, sheet: s.name, address: `${a}:${b}`, evidence: `行 ${a}${a === b ? '' : '〜' + b}（${b - a + 1}行）が非表示` });
      col.add({
        kind: 'hidden-rows', severity: 'low', certainty: 'confirmed', sheet: s.name, address: `${rowRuns[0][0]}:${rowRuns[0][1]}`,
        title: `非表示の行 ${s.hiddenRows.length} 行`,
        reason: `行 ${text} が非表示です。非表示にした理由は断定できません。`,
        advice: `非表示の行にデータが含まれています（${dataInHidden} セル）。集計や数式がこの行を含めているか確認してください。`,
        evidence: `非表示の行内のセル数: ${dataInHidden}`, count: s.hiddenRows.length,
      });
    }
    const colRuns = compressRuns(s.hiddenCols);
    if (colRuns.length) {
      const text = colRuns.map(([a, b]) => (a === b ? colToLetters(a) : `${colToLetters(a)}-${colToLetters(b)}`)).join(', ');
      const dataInHidden = s.cells.filter((c) => s.hiddenCols.includes(c.c)).length;
      for (const [a, b] of colRuns) col.structure.push({ category: 'hidden-cols', name: `非表示の列 ${a === b ? colToLetters(a) : colToLetters(a) + '-' + colToLetters(b)}`, sheet: s.name, address: `${colToLetters(a)}:${colToLetters(b)}`, evidence: `列 ${colToLetters(a)}${a === b ? '' : '〜' + colToLetters(b)}（${b - a + 1}列）が非表示` });
      col.add({
        kind: 'hidden-cols', severity: 'low', certainty: 'confirmed', sheet: s.name, address: `${colToLetters(colRuns[0][0])}:${colToLetters(colRuns[0][1])}`,
        title: `非表示の列 ${s.hiddenCols.length} 列`,
        reason: `列 ${text} が非表示です。非表示にした理由は断定できません。`,
        advice: `非表示の列にデータが含まれています（${dataInHidden} セル）。参照・集計に影響がないか確認してください。`,
        evidence: `非表示の列内のセル数: ${dataInHidden}`, count: s.hiddenCols.length,
      });
    }
    // 結合セル
    merged += s.merges.length;
    for (const m of s.merges) col.structure.push({ category: 'merge', name: '結合セル', sheet: s.name, address: m, evidence: `mergeCells: ${m}` });
    if (s.merges.length) {
      col.add({
        kind: 'merged-cells', severity: 'info', certainty: 'confirmed', sheet: s.name, address: s.merges[0],
        title: `結合セル ${s.merges.length} 件`,
        reason: `結合セル: ${s.merges.slice(0, 10).join(', ')}${s.merges.length > 10 ? ' …' : ''}`,
        advice: '結合セルは並べ替え・フィルタ・数式コピーでずれの原因になりやすい構造です。',
        count: s.merges.length, cells: s.merges.slice(0, 30),
      });
    }
    // ハイパーリンク
    hyperlinks += s.hyperlinks.length;
    for (const h of s.hyperlinks) {
      col.structure.push({ category: 'hyperlink', name: h.external ? '外部ハイパーリンク' : '内部ハイパーリンク', sheet: s.name, address: h.address, evidence: h.target });
      if (h.external) {
        col.add({
          kind: 'hyperlink', severity: 'low', certainty: 'confirmed', sheet: s.name, address: h.address,
          title: '外部ハイパーリンク',
          reason: `リンク先: ${h.target}`,
          advice: 'このツールはリンク先へ接続しません。リンク先の安全性は自己責任で確認してください。',
        }, 'hyperlink|' + s.name);
      }
    }
    for (const t of s.tables) col.structure.push({ category: 'table', name: t.name, sheet: s.name, address: t.ref, evidence: `テーブル範囲 ${t.ref}` });
    for (const v of s.validations) col.structure.push({ category: 'validation', name: `入力規則 (${v.type || '不明'})`, sheet: s.name, address: v.ref, evidence: v.formulae.length ? `条件: ${v.formulae.join(' , ')}` : '条件を取得できません' });
  }

  // 名前定義
  for (const d of model.definedNames) {
    const scope = d.scope ?? 'ブック全体';
    col.structure.push({ category: 'name', name: d.name, sheet: d.scope ?? undefined, evidence: `参照先: ${d.ref}${d.builtin ? '（Excel組込み）' : ''} / スコープ: ${scope}${d.hidden ? ' / 非表示の名前' : ''}` });
    if (d.builtin) continue;
    const broken = /#REF!/i.test(d.ref);
    const external = /\[\d+\]/.test(d.ref) || /\[[^\]]+\.xls/i.test(d.ref);
    col.add({
      kind: broken ? 'name-broken' : 'defined-name',
      severity: broken ? 'high' : external ? 'medium' : 'info',
      certainty: 'confirmed', sheet: d.scope ?? undefined,
      title: broken ? `壊れた名前定義「${d.name}」` : `名前定義「${d.name}」`,
      reason: `参照先: ${d.ref}（スコープ: ${scope}${d.hidden ? '・非表示の名前' : ''}）${external ? ' ― 外部ブックを参照しています' : ''}`,
      advice: broken ? '参照先が失われています。この名前を使っている数式は #REF! になる可能性があります。' : '名前定義は数式の参照先をセル番地から隠します。参照先が意図どおりか確認してください。',
    }, 'defined-name');
  }

  // 外部リンク
  for (const l of model.externalLinks) {
    col.structure.push({ category: 'external-link', name: `外部リンク [${l.index}]`, evidence: `リンク先: ${l.target ?? '取得できません'}（パート: ${l.part || '不明'}）` });
    col.add({
      kind: 'external-link', severity: 'medium', certainty: 'confirmed',
      title: `外部ブックへのリンク [${l.index}]`,
      reason: `リンク先: ${l.target ?? '取得できません'}。数式中の [${l.index}] がこのリンク先を指します。`,
      advice: 'このツールはリンク先へ接続しません。リンク先ファイルの有無・更新状況・信頼できるファイルかを確認してください。',
    });
  }

  // 外部参照の数式／他シート参照
  const linkOf = new Map(model.externalLinks.map((l) => [String(l.index), l.target]));
  for (const e of ix.entries) {
    const a = addr(e.r, e.c);
    if (e.parsed.hasExternal) {
      const refs = e.parsed.refs.filter((r) => r.external != null).map((r) => {
        const t = linkOf.get(r.external!);
        return `${r.raw}${t ? ` → ${t}` : ''}`;
      });
      col.structure.push({ category: 'external-ref', name: '外部ブックを参照する数式', sheet: e.sheet, address: a, evidence: `=${e.f}` });
      col.add({
        kind: 'external-ref', severity: 'medium', certainty: 'confirmed', sheet: e.sheet, address: a, formula: '=' + e.f,
        title: '外部ブックを参照する数式',
        reason: `数式が別のブックを参照しています: ${refs.join(' ; ') || '(参照を特定できません)'}`,
        advice: 'リンク先が移動・削除されると値が更新されなくなります。このツールはリンク先へ接続しません。',
      }, 'external-ref|' + e.sheet);
    } else {
      const other = e.parsed.refs.filter((r) => r.sheet != null && r.sheet.toLowerCase() !== e.sheet.toLowerCase());
      if (other.length) {
        col.structure.push({ category: 'cross-sheet-ref', name: '他シートを参照する数式', sheet: e.sheet, address: a, evidence: `=${e.f}（参照先: ${[...new Set(other.map((r) => r.sheet))].join(', ')}）` });
      }
    }
  }

  // マクロ
  if (model.hasMacros) {
    col.add({
      kind: 'macro', severity: 'medium', certainty: 'confirmed',
      title: 'VBAマクロ（vbaProject.bin）を含んでいます',
      reason: 'ブック内にマクロが含まれています。このツールはマクロを実行・解析しません。',
      advice: 'マクロの内容はExcelのVBAエディタ等で確認してください。信頼できない出所のファイルではマクロを有効にしないでください。',
    });
  }
  return { merged, hyperlinks };
}

// ---------------------------------------------------------------- 検査範囲の明示
function buildCoverage(model: WorkbookModel, ix: WorkbookIndex): Coverage {
  const noCache = ix.entries.filter((e) => !e.cell.cached).length;
  return {
    checked: [
      `シート ${model.sheets.length} 枚の構造・表示状態（workbook.xml の記述に基づく）`,
      `数式 ${ix.entries.length} 個のトークン解析と参照抽出（解析失敗 ${ix.parseFailures.length} 個）`,
      '保存された計算結果にエラー値（#REF! など）があるセルの検出',
      '同一列・同一行で連続する数式の相対参照パターン比較',
      '数式領域に混在する固定値の検出',
      '循環参照（静的な参照関係に基づく）',
      '非表示の行・列、結合セル、名前定義、外部リンク、ハイパーリンク、テーブル、入力規則',
    ],
    notChecked: [
      '条件付き書式、グラフ、ピボットテーブル、図形、スライサーの中身',
      'VBAマクロの内容（実行・解析は行いません）',
      '数式の再計算（Excelの計算エンジンは実装していません。保存された結果のみ参照）',
      ...model.unanalyzedParts.map((p) => `未解析の要素: ${p}`),
    ],
    limitations: [
      'INDIRECT / OFFSET など参照先が実行時に決まる数式は、依存関係を完全には特定できません。',
      '名前定義・テーブルの構造化参照は、単純な範囲に解決できる場合のみ依存関係に反映します。',
      noCache > 0 ? `保存された計算結果がない数式が ${noCache} 個あり、これらは値ベースの検査（エラー判定）ができません。` : '',
      '検出結果のうち「候補」「可能性」と表示されるものは、誤りと断定できないものです。',
      '外部リンク先には接続しません。リンク先ファイルの内容は検査されません。',
    ].filter(Boolean),
  };
}

