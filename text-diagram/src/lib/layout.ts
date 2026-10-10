import type { DEdge, DNode, Graph, Preset, RawGraph } from '../types';

const NODE_H = 56;
const FONT_CJK = 15;
const FONT_LATIN = 8.6;

export function textWidth(s: string, scale = 1): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0)! > 0xff ? FONT_CJK : FONT_LATIN) * scale;
  return w;
}

export function nodeSize(label: string, category: string): { w: number; h: number } {
  const w = Math.max(textWidth(label), textWidth(category, 0.7)) + 40;
  return { w: Math.round(Math.max(104, Math.min(w, 320))), h: NODE_H };
}

let counter = 0;
export const uid = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Convert a RawGraph to a laid-out Graph. */
export function buildGraph(raw: RawGraph, preset: Preset): Graph {
  const idByLabel = new Map<string, string>();
  const nodes: DNode[] = raw.nodes.map((n, i) => {
    const id = `n${i + 1}`;
    idByLabel.set(n.label, id);
    const category = n.category ?? 'エンティティ';
    return { id, label: n.label, category, note: n.note, x: 0, y: 0, ...nodeSize(n.label, category) };
  });
  const edges: DEdge[] = [];
  raw.edges.forEach((e, i) => {
    const s = idByLabel.get(e.source);
    const t = idByLabel.get(e.target);
    if (!s || !t || s === t) return;
    edges.push({
      id: `e${i + 1}`,
      source: s,
      target: t,
      label: e.label ?? '',
      kind: e.kind ?? 'normal',
      bidirectional: e.bidirectional,
    });
  });
  return autoLayout({ nodes, edges }, preset);
}

export function autoLayout(g: Graph, preset: Preset): Graph {
  if (g.nodes.length === 0) return g;
  const nodes =
    preset === 'flow' ? layered(g, 'LR') : preset === 'causal' ? layered(g, 'TB') : force(g);
  return { nodes, edges: g.edges };
}

/* ---------- layered (DAG-ish) layout ---------- */

function layered(g: Graph, dir: 'LR' | 'TB'): DNode[] {
  const ids = g.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((i) => [i, []]));
  g.edges.forEach((e) => out.get(e.source)!.push(e.target));

  // break cycles with DFS (ignore back edges)
  const state = new Map<string, 0 | 1 | 2>();
  const dag: [string, string][] = [];
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      const s = state.get(v) ?? 0;
      if (s === 1) continue;
      dag.push([u, v]);
      if (s === 0) visit(v);
    }
    state.set(u, 2);
  };
  const hasIn = new Set(g.edges.map((e) => e.target));
  ids.filter((i) => !hasIn.has(i)).forEach((i) => !state.get(i) && visit(i));
  ids.forEach((i) => !state.get(i) && visit(i));

  // longest-path ranking
  const rank = new Map<string, number>(ids.map((i) => [i, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const [u, v] of dag) {
      if (rank.get(v)! < rank.get(u)! + 1) {
        rank.set(v, rank.get(u)! + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const layers: string[][] = [];
  ids.forEach((i) => (layers[rank.get(i)!] ??= []).push(i));
  const layerList = layers.filter(Boolean);

  // barycenter ordering
  const pos = new Map<string, number>();
  layerList.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  const nbrs = (id: string, up: boolean) =>
    dag.filter(([u, v]) => (up ? v === id : u === id)).map(([u, v]) => (up ? u : v));
  for (let it = 0; it < 4; it++) {
    const seq = it % 2 === 0 ? layerList.slice(1) : layerList.slice(0, -1).reverse();
    for (const l of seq) {
      const up = it % 2 === 0;
      const bc = new Map<string, number>();
      l.forEach((id) => {
        const ns = nbrs(id, up);
        bc.set(id, ns.length ? ns.reduce((a, n) => a + pos.get(n)!, 0) / ns.length : pos.get(id)!);
      });
      l.sort((a, b) => bc.get(a)! - bc.get(b)!);
      l.forEach((id, i) => pos.set(id, i));
    }
  }

  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const GAP_LAYER = 110;
  const GAP_NODE = 36;
  const GAP_ROW = 90;
  const WRAP = dir === 'LR' ? 1500 : 1100; // wrap long chains into extra rows / columns

  const info = layerList.map((l) => {
    const main = Math.max(...l.map((id) => (dir === 'LR' ? byId.get(id)!.w : byId.get(id)!.h)));
    const cross = l.map((id) => (dir === 'LR' ? byId.get(id)!.h : byId.get(id)!.w));
    return { l, main, cross, total: cross.reduce((a, b) => a + b, 0) + GAP_NODE * (l.length - 1) };
  });
  const rows: (typeof info)[] = [[]];
  let used = 0;
  for (const it of info) {
    if (used > 0 && used + it.main > WRAP) {
      rows.push([]);
      used = 0;
    }
    rows[rows.length - 1].push(it);
    used += it.main + GAP_LAYER;
  }

  const placed = new Map<string, { x: number; y: number }>();
  let rowOffset = 0;
  for (const row of rows) {
    const extent = Math.max(...row.map((it) => it.total));
    let cursor = 0;
    for (const it of row) {
      let c = -it.total / 2;
      it.l.forEach((id, i) => {
        const mid = cursor + it.main / 2;
        const cm = rowOffset + extent / 2 + c + it.cross[i] / 2;
        placed.set(id, dir === 'LR' ? { x: mid, y: cm } : { x: cm, y: mid });
        c += it.cross[i] + GAP_NODE;
      });
      cursor += it.main + GAP_LAYER;
    }
    rowOffset += extent + GAP_ROW;
  }
  return g.nodes.map((n) => ({ ...n, ...placed.get(n.id)! }));
}

/* ---------- force-directed layout (deterministic) ---------- */

function force(g: Graph): DNode[] {
  const n = g.nodes.length;
  const R = 90 + n * 34;
  const p = g.nodes.map((_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(a) * R, y: Math.sin(a) * R * 0.75, vx: 0, vy: 0 };
  });
  const idx = new Map(g.nodes.map((nd, i) => [nd.id, i]));
  const links = g.edges.map((e) => [idx.get(e.source)!, idx.get(e.target)!] as const);
  const L = 230;

  for (let it = 0; it < 400; it++) {
    const cool = 1 - it / 400;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = p[i].x - p[j].x;
        let dy = p[i].y - p[j].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = (i - j) * 0.5;
          dy = 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        const f = 52000 / d2;
        p[i].vx += (dx / d) * f;
        p[i].vy += (dy / d) * f;
        p[j].vx -= (dx / d) * f;
        p[j].vy -= (dy / d) * f;
      }
    }
    for (const [a, b] of links) {
      const dx = p[b].x - p[a].x;
      const dy = p[b].y - p[a].y;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - L) * 0.04;
      p[a].vx += (dx / d) * f;
      p[a].vy += (dy / d) * f;
      p[b].vx -= (dx / d) * f;
      p[b].vy -= (dy / d) * f;
    }
    for (const q of p) {
      q.vx -= q.x * 0.004;
      q.vy -= q.y * 0.004;
      q.x += Math.max(-40, Math.min(40, q.vx)) * cool;
      q.y += Math.max(-40, Math.min(40, q.vy)) * cool;
      q.vx *= 0.5;
      q.vy *= 0.5;
    }
  }

  // resolve rectangle overlaps
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = g.nodes[i];
        const b = g.nodes[j];
        const ox = (a.w + b.w) / 2 + 28 - Math.abs(p[i].x - p[j].x);
        const oy = (a.h + b.h) / 2 + 28 - Math.abs(p[i].y - p[j].y);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) {
            const s = p[i].x >= p[j].x ? 1 : -1;
            p[i].x += (s * ox) / 2;
            p[j].x -= (s * ox) / 2;
          } else {
            const s = p[i].y >= p[j].y ? 1 : -1;
            p[i].y += (s * oy) / 2;
            p[j].y -= (s * oy) / 2;
          }
        }
      }
    }
    if (!moved) break;
  }
  return g.nodes.map((nd, i) => ({ ...nd, x: Math.round(p[i].x), y: Math.round(p[i].y) }));
}

export function bounds(nodes: DNode[]) {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...nodes.map((n) => n.x - n.w / 2)),
    minY: Math.min(...nodes.map((n) => n.y - n.h / 2)),
    maxX: Math.max(...nodes.map((n) => n.x + n.w / 2)),
    maxY: Math.max(...nodes.map((n) => n.y + n.h / 2)),
  };
}
