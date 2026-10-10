import type { DEdge, DNode } from '../types';

export interface EdgeGeom {
  d: string;
  /** label anchor */
  mx: number;
  my: number;
  arrows: string[]; // polygon point strings
}

function rectEdgePoint(n: DNode, tx: number, ty: number, pad = 2) {
  const dx = tx - n.x;
  const dy = ty - n.y;
  if (dx === 0 && dy === 0) return { x: n.x, y: n.y };
  const hw = n.w / 2 + pad;
  const hh = n.h / 2 + pad;
  const s = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: n.x + dx * s, y: n.y + dy * s };
}

function arrowHead(tip: { x: number; y: number }, from: { x: number; y: number }, size = 10) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const l = size;
  const w = size * 0.5;
  const bx = tip.x - Math.cos(a) * l;
  const by = tip.y - Math.sin(a) * l;
  const nx = -Math.sin(a) * w;
  const ny = Math.cos(a) * w;
  return `${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${(bx + nx).toFixed(1)},${(by + ny).toFixed(1)} ${(bx - nx).toFixed(1)},${(by - ny).toFixed(1)}`;
}

/** Quadratic bezier between node borders with a gentle bend. */
export function edgeGeometry(e: DEdge, a: DNode, b: DNode): EdgeGeom {
  const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / dist;
  const ny = (b.x - a.x) / dist;
  const bend = Math.min(60, dist * 0.14);
  const cx0 = (a.x + b.x) / 2 + nx * bend;
  const cy0 = (a.y + b.y) / 2 + ny * bend;
  // aim at the control point so the curve leaves the border cleanly
  const p0 = rectEdgePoint(a, cx0, cy0);
  const p2 = rectEdgePoint(b, cx0, cy0);
  const arrows: string[] = [arrowHead(p2, { x: cx0, y: cy0 })];
  if (e.bidirectional) arrows.push(arrowHead(p0, { x: cx0, y: cy0 }));
  // shorten the line so it doesn't poke through arrowheads
  const sh = (p: { x: number; y: number }, to: { x: number; y: number }, by: number) => {
    const d = Math.hypot(to.x - p.x, to.y - p.y) || 1;
    return { x: p.x + ((to.x - p.x) / d) * by, y: p.y + ((to.y - p.y) / d) * by };
  };
  const c = { x: cx0, y: cy0 };
  const s = e.bidirectional ? sh(p0, c, 8) : p0;
  const t = sh(p2, c, 8);
  return {
    d: `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${cx0.toFixed(1)},${cy0.toFixed(1)} ${t.x.toFixed(1)},${t.y.toFixed(1)}`,
    mx: 0.25 * p0.x + 0.5 * cx0 + 0.25 * p2.x,
    my: 0.25 * p0.y + 0.5 * cy0 + 0.25 * p2.y,
    arrows,
  };
}
