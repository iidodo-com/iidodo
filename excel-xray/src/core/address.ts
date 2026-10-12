export const MAX_ROW = 1048576;
export const MAX_COL = 16384;

export function colToLetters(c: number): string {
  let s = '';
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

export function lettersToCol(l: string): number {
  let n = 0;
  for (const ch of l.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function addr(r: number, c: number): string {
  return colToLetters(c) + r;
}

export function parseAddr(a: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a.trim());
  if (!m) return null;
  const c = lettersToCol(m[1]);
  const r = Number(m[2]);
  if (c < 1 || c > MAX_COL || r < 1 || r > MAX_ROW) return null;
  return { r, c };
}

export interface Rect { r1: number; c1: number; r2: number; c2: number }

export function parseRect(a: string): Rect | null {
  const parts = a.split(':');
  if (parts.length === 1) {
    const p = parseAddr(parts[0]);
    return p ? { r1: p.r, c1: p.c, r2: p.r, c2: p.c } : null;
  }
  if (parts.length !== 2) return null;
  const p = parseAddr(parts[0]);
  const q = parseAddr(parts[1]);
  if (!p || !q) return null;
  return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) };
}

export function rectToString(x: Rect): string {
  const a = addr(x.r1, x.c1);
  return x.r1 === x.r2 && x.c1 === x.c2 ? a : `${a}:${addr(x.r2, x.c2)}`;
}

export function rectArea(x: Rect): number {
  return (x.r2 - x.r1 + 1) * (x.c2 - x.c1 + 1);
}

export function rectContains(x: Rect, r: number, c: number): boolean {
  return r >= x.r1 && r <= x.r2 && c >= x.c1 && c <= x.c2;
}

export function cellKey(r: number, c: number): number {
  return r * 16385 + c;
}

/** 連続する数値を範囲表記にまとめる。例: [3,4,5,9] -> [[3,5],[9,9]] */
export function compressRuns(nums: number[]): Array<[number, number]> {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const n of s) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out;
}

/** シート名をA1参照用に必要なら引用符で囲む */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_\u0080-￿][A-Za-z0-9_.\u0080-￿]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name)
    ? name
    : `'${name.replace(/'/g, "''")}'`;
}
