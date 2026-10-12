import { addr, cellKey, compressRuns, colToLetters } from './address';
import { parseFormula } from './formula';
import type { CellData, Severity, SheetModel, WorkbookModel } from './types';

export type ChangeType =
  | 'sheet-added' | 'sheet-removed' | 'sheet-renamed'
  | 'value-changed' | 'formula-changed' | 'ref-changed' | 'formula-to-value' | 'value-to-formula'
  | 'result-changed' | 'cell-added' | 'cell-removed'
  | 'state-changed' | 'hidden-rows-changed' | 'hidden-cols-changed' | 'merge-changed'
  | 'name-changed' | 'external-link-changed';

export const CHANGE_LABEL: Record<ChangeType, string> = {
  'sheet-added': 'シート追加', 'sheet-removed': 'シート削除', 'sheet-renamed': 'シート名変更',
  'value-changed': '値の変更', 'formula-changed': '数式の変更', 'ref-changed': '数式の参照先の変更',
  'formula-to-value': '数式→固定値', 'value-to-formula': '固定値→数式', 'result-changed': '保存結果のみ変更',
  'cell-added': 'セル追加', 'cell-removed': 'セル削除',
  'state-changed': '表示状態の変更', 'hidden-rows-changed': '非表示行の変更', 'hidden-cols-changed': '非表示列の変更',
  'merge-changed': '結合セルの変更', 'name-changed': '名前定義の変更', 'external-link-changed': '外部リンクの変更',
};

export interface DiffItem {
  id: number;
  type: ChangeType;
  severity: Severity;
  /** 新版側のシート名（削除の場合は旧版名） */
  sheet: string;
  oldSheet?: string;
  address?: string;
  before?: string;
  after?: string;
  detail: string;
}

export interface DiffResult {
  items: DiffItem[];
  truncated: boolean;
  counts: Partial<Record<ChangeType, number>>;
  totalChanges: number;
}

const MAX_ITEMS = 20000;

function show(c: CellData | undefined): string | undefined {
  if (!c) return undefined;
  if (c.f !== undefined) return `=${c.f}` + (c.cached ? `  → ${c.t === 'empty' ? '(空)' : String(c.v)}` : '  (保存結果なし)');
  return c.t === 'empty' ? '(空)' : String(c.v);
}

function sheetSimilarity(a: SheetModel, b: SheetModel): number {
  if (a.cells.length === 0 || b.cells.length === 0) return a.cells.length === b.cells.length ? 0.5 : 0;
  const m = new Map<number, CellData>();
  for (const c of a.cells) m.set(cellKey(c.r, c.c), c);
  let same = 0;
  const sample = b.cells.slice(0, 3000);
  for (const c of sample) {
    const o = m.get(cellKey(c.r, c.c));
    if (o && o.f === c.f && o.v === c.v) same++;
  }
  return same / Math.max(sample.length, Math.min(a.cells.length, 3000));
}

export function diffWorkbooks(oldWb: WorkbookModel, newWb: WorkbookModel): DiffResult {
  const items: DiffItem[] = [];
  const counts: Partial<Record<ChangeType, number>> = {};
  let total = 0;
  let truncated = false;
  let seq = 0;
  const push = (it: Omit<DiffItem, 'id'>) => {
    total++;
    counts[it.type] = (counts[it.type] ?? 0) + 1;
    if (items.length >= MAX_ITEMS) { truncated = true; return; }
    items.push({ ...it, id: ++seq });
  };

  const oldBy = new Map(oldWb.sheets.map((s) => [s.name, s]));
  const newBy = new Map(newWb.sheets.map((s) => [s.name, s]));
  const pairs: Array<[SheetModel, SheetModel]> = [];
  const oldRest = oldWb.sheets.filter((s) => !newBy.has(s.name));
  const newRest = newWb.sheets.filter((s) => !oldBy.has(s.name));
  for (const s of newWb.sheets) { const o = oldBy.get(s.name); if (o) pairs.push([o, s]); }

  // 名前変更の推定（内容の類似度が高い未対応シート同士）
  const usedNew = new Set<SheetModel>();
  for (const o of oldRest) {
    let best: SheetModel | null = null;
    let bestScore = 0.6;
    for (const n of newRest) {
      if (usedNew.has(n)) continue;
      const sc = sheetSimilarity(o, n);
      if (sc >= bestScore) { best = n; bestScore = sc; }
    }
    if (best) {
      usedNew.add(best);
      pairs.push([o, best]);
      push({ type: 'sheet-renamed', severity: 'medium', sheet: best.name, oldSheet: o.name, before: o.name, after: best.name, detail: `内容が ${(bestScore * 100).toFixed(0)}% 一致するため、名前変更と推定しました（推定です）。` });
    } else {
      push({ type: 'sheet-removed', severity: 'high', sheet: o.name, before: o.name, detail: `シート「${o.name}」が新版にありません（数式 ${o.formulaCount}・値 ${o.valueCount}）。` });
    }
  }
  for (const n of newRest) {
    if (!usedNew.has(n)) push({ type: 'sheet-added', severity: 'info', sheet: n.name, after: n.name, detail: `シート「${n.name}」が追加されています（数式 ${n.formulaCount}・値 ${n.valueCount}）。` });
  }

  for (const [o, n] of pairs) diffSheet(o, n, push);

  // 名前定義
  const key = (d: { name: string; scope: string | null }) => `${d.scope ?? ''}::${d.name}`;
  const oldNames = new Map(oldWb.definedNames.filter((d) => !d.builtin).map((d) => [key(d), d]));
  const newNames = new Map(newWb.definedNames.filter((d) => !d.builtin).map((d) => [key(d), d]));
  for (const [k, d] of newNames) {
    const o = oldNames.get(k);
    if (!o) push({ type: 'name-changed', severity: 'low', sheet: '(ブック)', after: `${d.name} = ${d.ref}`, detail: `名前定義「${d.name}」が追加されました。` });
    else if (o.ref !== d.ref) push({ type: 'name-changed', severity: 'medium', sheet: '(ブック)', before: `${o.name} = ${o.ref}`, after: `${d.name} = ${d.ref}`, detail: `名前定義「${d.name}」の参照先が変更されました。` });
  }
  for (const [k, o] of oldNames) {
    if (!newNames.has(k)) push({ type: 'name-changed', severity: 'medium', sheet: '(ブック)', before: `${o.name} = ${o.ref}`, detail: `名前定義「${o.name}」が削除されました。` });
  }
  // 外部リンク
  const ol = new Set(oldWb.externalLinks.map((l) => l.target ?? '(不明)'));
  const nl = new Set(newWb.externalLinks.map((l) => l.target ?? '(不明)'));
  for (const t of nl) if (!ol.has(t)) push({ type: 'external-link-changed', severity: 'medium', sheet: '(ブック)', after: t, detail: '外部リンクが追加されました。' });
  for (const t of ol) if (!nl.has(t)) push({ type: 'external-link-changed', severity: 'low', sheet: '(ブック)', before: t, detail: '外部リンクが削除されました。' });

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
  items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.id - b.id);
  return { items, truncated, counts, totalChanges: total };
}

function diffSheet(o: SheetModel, n: SheetModel, push: (i: Omit<DiffItem, 'id'>) => void) {
  const sheet = n.name;
  const oldSheet = o.name !== n.name ? o.name : undefined;
  if (o.state !== n.state) {
    push({ type: 'state-changed', severity: 'medium', sheet, oldSheet, before: o.state, after: n.state, detail: `シートの表示状態が ${o.state} から ${n.state} に変わりました。` });
  }
  const setDiff = (a: number[], b: number[]) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });
  const rd = setDiff(o.hiddenRows, n.hiddenRows);
  if (rd.added.length || rd.removed.length) {
    push({ type: 'hidden-rows-changed', severity: 'low', sheet, oldSheet,
      before: runsText(o.hiddenRows, false) || '(なし)', after: runsText(n.hiddenRows, false) || '(なし)',
      detail: `非表示の行: 追加 ${rd.added.length} / 解除 ${rd.removed.length}` });
  }
  const cd = setDiff(o.hiddenCols, n.hiddenCols);
  if (cd.added.length || cd.removed.length) {
    push({ type: 'hidden-cols-changed', severity: 'low', sheet, oldSheet,
      before: runsText(o.hiddenCols, true) || '(なし)', after: runsText(n.hiddenCols, true) || '(なし)',
      detail: `非表示の列: 追加 ${cd.added.length} / 解除 ${cd.removed.length}` });
  }
  const om = new Set(o.merges), nm = new Set(n.merges);
  const mAdd = [...nm].filter((x) => !om.has(x)), mDel = [...om].filter((x) => !nm.has(x));
  if (mAdd.length || mDel.length) {
    push({ type: 'merge-changed', severity: 'info', sheet, oldSheet, before: [...om].join(', ') || '(なし)', after: [...nm].join(', ') || '(なし)', detail: `結合セル: 追加 ${mAdd.length} / 解除 ${mDel.length}` });
  }

  const oc = new Map<number, CellData>();
  for (const c of o.cells) oc.set(cellKey(c.r, c.c), c);
  const nc = new Map<number, CellData>();
  for (const c of n.cells) nc.set(cellKey(c.r, c.c), c);

  for (const c of n.cells) {
    const a = addr(c.r, c.c);
    const before = oc.get(cellKey(c.r, c.c));
    if (!before) {
      push({ type: 'cell-added', severity: 'info', sheet, oldSheet, address: a, after: show(c), detail: 'セルが追加されました。' });
      continue;
    }
    if (before.f !== undefined && c.f !== undefined) {
      if (before.f !== c.f) {
        const pb = parseFormula(before.f, c.r, c.c);
        const pa = parseFormula(c.f, c.r, c.c);
        const refOnly = pb.ok && pa.ok && pb.shape === pa.shape;
        push({ type: refOnly ? 'ref-changed' : 'formula-changed', severity: 'medium', sheet, oldSheet, address: a, before: show(before), after: show(c),
          detail: refOnly ? '関数・演算子は同じで、参照先が変わっています。' : '数式の内容が変わっています。' });
      } else if (before.cached && c.cached && (before.v !== c.v || before.t !== c.t)) {
        push({ type: 'result-changed', severity: 'info', sheet, oldSheet, address: a, before: show(before), after: show(c), detail: '数式は同じで、保存された計算結果だけが異なります（入力値の変化による再計算の可能性）。' });
      }
    } else if (before.f !== undefined && c.f === undefined) {
      push({ type: 'formula-to-value', severity: 'high', sheet, oldSheet, address: a, before: show(before), after: show(c), detail: '数式が固定値に置き換わっています。意図した値貼り付けか確認してください。' });
    } else if (before.f === undefined && c.f !== undefined) {
      push({ type: 'value-to-formula', severity: 'medium', sheet, oldSheet, address: a, before: show(before), after: show(c), detail: '固定値が数式に置き換わっています。' });
    } else if (before.v !== c.v || before.t !== c.t) {
      push({ type: 'value-changed', severity: 'low', sheet, oldSheet, address: a, before: show(before), after: show(c), detail: '値が変更されています。' });
    }
  }
  for (const c of o.cells) {
    if (!nc.has(cellKey(c.r, c.c))) {
      push({ type: 'cell-removed', severity: c.f !== undefined ? 'medium' : 'low', sheet, oldSheet, address: addr(c.r, c.c), before: show(c), detail: 'セルが削除（空白化）されました。' });
    }
  }
}

function runsText(nums: number[], cols: boolean): string {
  return compressRuns(nums).map(([a, b]) => {
    const f = (x: number) => (cols ? colToLetters(x) : String(x));
    return a === b ? f(a) : `${f(a)}-${f(b)}`;
  }).join(', ');
}
