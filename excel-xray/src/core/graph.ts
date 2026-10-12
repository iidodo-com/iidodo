import { addr, cellKey, colToLetters, parseRect, rectArea, rectContains, rectToString, MAX_ROW, MAX_COL, type Rect } from './address';
import { findCycles } from './analyze';
import type { RefInfo } from './formula';
import type { FormulaEntry, SheetIndex, WorkbookIndex } from './formulaTable';
import type { CellData } from './types';

export type GraphMode = 'up' | 'down' | 'both';

export interface GraphRequest {
  sheet: string;
  address: string;
  mode: GraphMode;
  /** 探索階層 (1以上) */
  depth: number;
  /** 表示するノード数の上限 */
  maxNodes: number;
  /** 範囲参照ごとに展開する数式セルの上限 */
  rangeExpandLimit: number;
}

export interface GraphNode {
  id: string;
  kind: 'cell' | 'range' | 'external' | 'unresolved';
  sheet?: string;
  address: string;
  label: string;
  formula?: string;
  value?: string;
  isFormula: boolean;
  isRoot: boolean;
  /** 符号つき階層。上流は負、下流は正、起点は0 */
  level: number;
  /** 深さ・上限のため先を展開していない */
  hasMore: boolean;
  dynamic: boolean;
  inCycle: boolean;
  note?: string;
}

export interface GraphEdge { id: string; source: string; target: string; label?: string }

export interface GraphResult {
  ok: boolean;
  error?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  cycleDetected: boolean;
  notes: string[];
}

interface ResolvedRef {
  sheet: string | null; // null: 解決不能
  rect: Rect;
  kind: RefInfo['kind'];
  label: string;
  external?: string;
  unresolvedReason?: string;
  approx?: boolean;
}

function fmtValue(c: CellData | undefined): string | undefined {
  if (!c) return undefined;
  if (c.f !== undefined && !c.cached) return '(保存結果なし)';
  if (c.t === 'empty') return undefined;
  return String(c.v);
}

export class GraphContext {
  private reverseSingle = new Map<string, Map<number, FormulaEntry[]>>();
  private reverseRange = new Map<string, Array<{ rect: Rect; entry: FormulaEntry; approx: boolean }>>();
  private reverseBuilt = false;
  private cycleSet: Set<FormulaEntry> | null = null;
  private resolvedCache = new Map<FormulaEntry, ResolvedRef[]>();

  constructor(public readonly ix: WorkbookIndex) {}

  private sheetIx(name: string | undefined, own: string): SheetIndex | undefined {
    if (name == null) return this.ix.sheets.get(own);
    return this.ix.sheets.get(name) ?? this.ix.sheetByLower.get(name.toLowerCase());
  }

  /** 数式の参照を、シート解決済みの形に変換する（名前定義・テーブル参照は可能な範囲で解決） */
  resolveRefs(e: FormulaEntry): ResolvedRef[] {
    const cached = this.resolvedCache.get(e);
    if (cached) return cached;
    const out: ResolvedRef[] = [];
    const model = this.ix.model;
    for (const ref of e.parsed.refs) {
      if (ref.external != null) {
        out.push({ sheet: null, rect: ref.rect, kind: ref.kind, label: `[${ref.external}]${ref.sheet ?? ''}!${rectToString(ref.rect)}`, external: ref.external, unresolvedReason: '外部ブック（接続しません）' });
        continue;
      }
      const target = this.sheetIx(ref.sheet, e.sheet);
      if (!target) {
        out.push({ sheet: null, rect: ref.rect, kind: ref.kind, label: `${ref.sheet}!${rectToString(ref.rect)}`, unresolvedReason: `シート「${ref.sheet}」が見つかりません` });
        continue;
      }
      out.push({ sheet: target.sheet.name, rect: ref.rect, kind: ref.kind, label: ref.raw });
    }
    for (const nm of e.parsed.names) {
      const def = model.definedNames.find((d) => !d.builtin && d.name.toLowerCase() === nm.toLowerCase() && d.scope === e.sheet)
        ?? model.definedNames.find((d) => !d.builtin && d.name.toLowerCase() === nm.toLowerCase() && d.scope == null);
      const resolved = def ? this.resolveSimpleRef(def.ref) : null;
      if (resolved) out.push({ ...resolved, label: `名前:${nm}` });
      else out.push({ sheet: null, rect: { r1: 1, c1: 1, r2: 1, c2: 1 }, kind: 'cell', label: `名前:${nm}`, unresolvedReason: def ? `名前「${nm}」の参照先（${def.ref}）を単純な範囲に解決できません` : `名前「${nm}」の定義が見つかりません` });
    }
    for (const st of e.parsed.structured) {
      const tname = st.split('[')[0];
      let found: { sheet: string; ref: string } | null = null;
      for (const s of model.sheets) {
        const t = s.tables.find((x) => x.name.toLowerCase() === tname.toLowerCase());
        if (t) { found = { sheet: s.name, ref: t.ref }; break; }
      }
      const rect = found ? parseRect(found.ref) : null;
      if (found && rect) out.push({ sheet: found.sheet, rect, kind: 'range', label: `表:${st}`, approx: true });
      else out.push({ sheet: null, rect: { r1: 1, c1: 1, r2: 1, c2: 1 }, kind: 'cell', label: `表:${st}`, unresolvedReason: `テーブル「${tname}」を解決できません` });
    }
    this.resolvedCache.set(e, out);
    return out;
  }

  private resolveSimpleRef(text: string): ResolvedRef | null {
    const m = /^(?:'((?:[^']|'')+)'|([^'!]+))!(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)$/.exec(text.trim());
    if (!m) return null;
    const sheet = (m[1] ? m[1].replace(/''/g, "'") : m[2]);
    const target = this.sheetIx(sheet, '');
    const rect = parseRect(m[3].replace(/\$/g, ''));
    if (!target || !rect) return null;
    return { sheet: target.sheet.name, rect, kind: rect.r1 === rect.r2 && rect.c1 === rect.c2 ? 'cell' : 'range', label: text };
  }

  private buildReverse() {
    if (this.reverseBuilt) return;
    this.reverseBuilt = true;
    for (const e of this.ix.entries) {
      if (!e.parsed.ok) continue;
      for (const r of this.resolveRefs(e)) {
        if (!r.sheet) continue;
        if (r.kind === 'cell' && !r.approx) {
          let m = this.reverseSingle.get(r.sheet);
          if (!m) { m = new Map(); this.reverseSingle.set(r.sheet, m); }
          const k = cellKey(r.rect.r1, r.rect.c1);
          const l = m.get(k);
          if (l) l.push(e); else m.set(k, [e]);
        } else {
          let l = this.reverseRange.get(r.sheet);
          if (!l) { l = []; this.reverseRange.set(r.sheet, l); }
          l.push({ rect: r.rect, entry: e, approx: !!r.approx });
        }
      }
    }
  }

  dependentsOf(sheet: string, r: number, c: number): Array<{ entry: FormulaEntry; viaRange: boolean }> {
    this.buildReverse();
    const out: Array<{ entry: FormulaEntry; viaRange: boolean }> = [];
    const seen = new Set<FormulaEntry>();
    for (const e of this.reverseSingle.get(sheet)?.get(cellKey(r, c)) ?? []) {
      if (!seen.has(e)) { seen.add(e); out.push({ entry: e, viaRange: false }); }
    }
    for (const x of this.reverseRange.get(sheet) ?? []) {
      if (rectContains(x.rect, r, c) && !seen.has(x.entry)) { seen.add(x.entry); out.push({ entry: x.entry, viaRange: true }); }
    }
    return out;
  }

  cyclic(): Set<FormulaEntry> {
    if (!this.cycleSet) {
      const set = new Set<FormulaEntry>();
      for (const g of findCycles(this.ix).groups) for (const e of g) set.add(e);
      this.cycleSet = set;
    }
    return this.cycleSet;
  }

  query(req: GraphRequest): GraphResult {
    const { ix } = this;
    const res: GraphResult = { ok: true, nodes: [], edges: [], truncated: false, cycleDetected: false, notes: [] };
    const root = parseRectSingle(req.address);
    if (!root) return { ...res, ok: false, error: `セル番地「${req.address}」を解釈できません（例: D6）。` };
    const rootSheet = ix.sheets.get(req.sheet) ?? ix.sheetByLower.get(req.sheet.toLowerCase());
    if (!rootSheet) return { ...res, ok: false, error: `シート「${req.sheet}」が見つかりません。` };

    const depth = Math.max(1, Math.min(req.depth, 20));
    const maxNodes = Math.max(5, Math.min(req.maxNodes, 1000));
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();
    const cyc = this.cyclic();
    const dynamicNotes = new Set<string>();

    const cellNode = (sheet: string, r: number, c: number, level: number): GraphNode => {
      const id = `${sheet}!${addr(r, c)}`;
      const si = ix.sheets.get(sheet)!;
      const entry = si.formulas.get(cellKey(r, c));
      const cell = si.byKey.get(cellKey(r, c));
      const n: GraphNode = {
        id, kind: 'cell', sheet, address: addr(r, c), label: id,
        formula: entry ? '=' + entry.f : undefined, value: fmtValue(cell), isFormula: !!entry,
        isRoot: false, level, hasMore: false,
        dynamic: !!entry && entry.parsed.dynamicFunctions.length > 0,
        inCycle: !!entry && cyc.has(entry),
      };
      if (n.dynamic) dynamicNotes.add(id);
      return n;
    };
    const addNode = (n: GraphNode): boolean => {
      if (nodes.has(n.id)) return true;
      if (nodes.size >= maxNodes) { res.truncated = true; return false; }
      nodes.set(n.id, n);
      return true;
    };
    const addEdge = (source: string, target: string, label?: string) => {
      const id = `${source}->${target}`;
      if (!edges.has(id)) edges.set(id, { id, source, target, label });
    };

    const rootNode = cellNode(rootSheet.sheet.name, root.r, root.c, 0);
    rootNode.isRoot = true;
    if (!rootNode.isFormula && !rootSheet.byKey.has(cellKey(root.r, root.c))) {
      rootNode.note = 'このセルには値も数式もありません（他の数式から参照されている場合は下流に表示されます）。';
    }
    nodes.set(rootNode.id, rootNode);

    // ---- 上流
    if (req.mode === 'up' || req.mode === 'both') {
      const queue: Array<{ sheet: string; r: number; c: number; level: number }> = [{ sheet: rootNode.sheet!, r: root.r, c: root.c, level: 0 }];
      const visited = new Set<string>([rootNode.id]);
      while (queue.length) {
        const cur = queue.shift()!;
        const curId = `${cur.sheet}!${addr(cur.r, cur.c)}`;
        const curNode = nodes.get(curId)!;
        const entry = ix.sheets.get(cur.sheet)!.formulas.get(cellKey(cur.r, cur.c));
        if (!entry || !entry.parsed.ok) {
          if (entry && !entry.parsed.ok) curNode.note = `数式を解析できませんでした（${entry.parsed.error}）`;
          continue;
        }
        const resolved = this.resolveRefs(entry);
        if (Math.abs(cur.level) >= depth) { curNode.hasMore = resolved.length > 0; continue; }
        const level = cur.level - 1;
        for (const r of resolved) {
          if (!r.sheet) {
            const id = `x:${r.label}`;
            const n: GraphNode = {
              id, kind: r.external ? 'external' : 'unresolved', address: r.label, label: r.label, isFormula: false, isRoot: false,
              level, hasMore: false, dynamic: false, inCycle: false, note: r.unresolvedReason,
            };
            if (addNode(n)) addEdge(id, curId);
            if (r.unresolvedReason) res.notes.push(`${curId}: ${r.unresolvedReason}`);
            continue;
          }
          if (r.kind === 'cell' && !r.approx) {
            const n = cellNode(r.sheet, r.rect.r1, r.rect.c1, level);
            const isNew = !nodes.has(n.id);
            if (!addNode(n)) continue;
            addEdge(n.id, curId);
            if (isNew && !visited.has(n.id)) { visited.add(n.id); queue.push({ sheet: r.sheet, r: r.rect.r1, c: r.rect.c1, level }); }
          } else {
            const rid = `${r.sheet}!${rectLabel(r.rect)}`;
            const area = rectArea(r.rect);
            const si = ix.sheets.get(r.sheet)!;
            const inner: Array<[number, number]> = [];
            const cut = si.formulaCells.query(r.rect.r1, r.rect.c1, r.rect.r2, r.rect.c2, req.rangeExpandLimit + 1, (rr, cc) => inner.push([rr, cc]));
            const rn: GraphNode = {
              id: rid, kind: 'range', sheet: r.sheet, address: rectLabel(r.rect), label: rid, isFormula: false, isRoot: false, level,
              hasMore: false, dynamic: false, inCycle: false,
              value: area > 1_000_000 ? '範囲が非常に大きいため集約表示' : `${area.toLocaleString()} セル`,
              note: (r.approx ? 'テーブル構造化参照を、テーブル全体の範囲として近似しています。' : undefined),
            };
            const isNewRange = !nodes.has(rid);
            if (!addNode(rn)) continue;
            addEdge(rid, curId, r.label.startsWith('名前:') || r.label.startsWith('表:') ? r.label : undefined);
            if (!isNewRange) continue;
            const take = inner.slice(0, req.rangeExpandLimit);
            if (cut || inner.length > req.rangeExpandLimit) {
              rn.note = (rn.note ? rn.note + ' ' : '') + `範囲内の数式セルは先頭 ${req.rangeExpandLimit} 個のみ展開しています。`;
              rn.hasMore = true;
            }
            for (const [rr, cc] of take) {
              const n = cellNode(r.sheet, rr, cc, level - 1);
              const isNew = !nodes.has(n.id);
              if (!addNode(n)) break;
              addEdge(n.id, rid);
              if (isNew && Math.abs(level - 1) <= depth && !visited.has(n.id)) { visited.add(n.id); queue.push({ sheet: r.sheet, r: rr, c: cc, level: level - 1 }); }
            }
          }
        }
        if (res.truncated) { curNode.hasMore = true; }
      }
    }

    // ---- 下流
    if (req.mode === 'down' || req.mode === 'both') {
      const queue: Array<{ sheet: string; r: number; c: number; level: number }> = [{ sheet: rootNode.sheet!, r: root.r, c: root.c, level: 0 }];
      const visited = new Set<string>([rootNode.id]);
      while (queue.length) {
        const cur = queue.shift()!;
        const curId = `${cur.sheet}!${addr(cur.r, cur.c)}`;
        const curNode = nodes.get(curId)!;
        const deps = this.dependentsOf(cur.sheet, cur.r, cur.c);
        if (cur.level >= depth) { curNode.hasMore = curNode.hasMore || deps.length > 0; continue; }
        const level = cur.level + 1;
        for (const d of deps) {
          const n = cellNode(d.entry.sheet, d.entry.r, d.entry.c, level);
          const isNew = !nodes.has(n.id);
          if (!addNode(n)) { curNode.hasMore = true; continue; }
          addEdge(curId, n.id, d.viaRange ? '範囲参照' : undefined);
          if (isNew && !visited.has(n.id)) { visited.add(n.id); queue.push({ sheet: d.entry.sheet, r: d.entry.r, c: d.entry.c, level }); }
        }
      }
    }

    res.nodes = [...nodes.values()];
    res.edges = [...edges.values()];
    res.cycleDetected = res.nodes.some((n) => n.inCycle);
    if (res.cycleDetected) res.notes.unshift('循環参照の可能性があるセルが含まれます（赤枠）。静的な参照関係に基づく判定です。');
    if (dynamicNotes.size) res.notes.unshift(`INDIRECT / OFFSET を含むセル（${[...dynamicNotes].slice(0, 5).join(', ')}${dynamicNotes.size > 5 ? ' ほか' : ''}）があり、依存関係を完全に特定できません。`);
    if (res.truncated) res.notes.unshift(`ノード数の上限（${maxNodes}）に達したため、一部のノードを表示していません。`);
    return res;
  }
}

function parseRectSingle(a: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a.trim());
  if (!m) return null;
  let c = 0;
  for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
  const r = Number(m[2]);
  if (c < 1 || c > MAX_COL || r < 1 || r > MAX_ROW) return null;
  return { r, c };
}

function rectLabel(x: Rect): string {
  if (x.r1 === 1 && x.r2 === MAX_ROW) return x.c1 === x.c2 ? `${colToLetters(x.c1)}:${colToLetters(x.c2)}` : `${colToLetters(x.c1)}:${colToLetters(x.c2)}`;
  if (x.c1 === 1 && x.c2 === MAX_COL) return `${x.r1}:${x.r2}`;
  return rectToString(x);
}
