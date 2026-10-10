import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { DEdge, DNode, Theme, View } from '../types';
import { bounds } from '../lib/layout';
import { CANVAS } from '../lib/theme';
import { Scene } from './Scene';

interface Props {
  nodes: DNode[];
  edges: DEdge[];
  selectedId: string | null;
  theme: Theme;
  view: View;
  setView: (v: View | ((p: View) => View)) => void;
  onSelect: (id: string | null) => void;
  onMoveNode: (id: string, x: number, y: number) => void;
  /** bump to re-fit the view */
  fitSignal: number;
}

const MIN_K = 0.15;
const MAX_K = 3;
const clamp = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

export function Canvas({ nodes, edges, selectedId, theme, view, setView, onSelect, onMoveNode, fitSignal }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const size = useRef({ w: 800, h: 600 });
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const drag = useRef<
    | { type: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
    | { type: 'node'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
    | null
  >(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number; v: View } | null>(null);
  const [panning, setPanning] = useState(false);
  const c = CANVAS[theme];

  const fit = useCallback(() => {
    const ns = nodesRef.current;
    if (ns.length === 0) return setView({ x: 0, y: 0, k: 1 });
    const b = bounds(ns);
    const el = wrap.current;
    if (el && el.clientWidth > 0) size.current = { w: el.clientWidth, h: el.clientHeight };
    const { w, h } = size.current;
    const pad = 70;
    const k = clamp(Math.min((w - pad * 2) / (b.maxX - b.minX), (h - pad * 2) / (b.maxY - b.minY), 1.2));
    setView({ k, x: w / 2 - ((b.minX + b.maxX) / 2) * k, y: h / 2 - ((b.minY + b.maxY) / 2) * k });
  }, [setView]);

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      size.current = { w: el.clientWidth, h: el.clientHeight };
    });
    ro.observe(el);
    size.current = { w: el.clientWidth, h: el.clientHeight };
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  // wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
        return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setView]);

  const zoomBy = (f: number) =>
    setView((v) => {
      const { w, h } = size.current;
      const k = clamp(v.k * f);
      return { k, x: w / 2 - ((w / 2 - v.x) * k) / v.k, y: h / 2 - ((h / 2 - v.y) * k) / v.k };
    });

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const r0 = e.currentTarget.getBoundingClientRect();
    pointers.current.set(e.pointerId, { x: e.clientX - r0.left, y: e.clientY - r0.top });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: view };
      drag.current = null;
      setPanning(false);
      return;
    }
    const target = (e.target as Element).closest('[data-node-id]');
    e.currentTarget.setPointerCapture(e.pointerId);
    if (target) {
      const id = target.getAttribute('data-node-id')!;
      const n = nodesRef.current.find((x) => x.id === id)!;
      drag.current = { type: 'node', id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
    } else {
      drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
      setPanning(true);
    }
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) {
      const r = e.currentTarget.getBoundingClientRect();
      pointers.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    }
    const pz = pinch.current;
    if (pz && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const k = clamp((pz.v.k * (Math.hypot(a.x - b.x, a.y - b.y) || 1)) / pz.dist);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      setView({ k, x: cx - ((pz.cx - pz.v.x) * k) / pz.v.k, y: cy - ((pz.cy - pz.v.y) * k) / pz.v.k });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.type === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    else onMoveNode(d.id, d.ox + dx / view.k, d.oy + dy / view.k);
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      drag.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (!d || d.moved) return;
    onSelect(d.type === 'node' ? d.id : null);
  };

  const gs = 24 * view.k;
  return (
    <div ref={wrap} className="relative h-full w-full overflow-hidden" style={{ background: c.bg }}>
      <svg
        ref={svgRef}
        className="h-full w-full select-none touch-none"
        style={{ cursor: panning ? 'grabbing' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <pattern id="t2d-dots" width={gs} height={gs} x={view.x} y={view.y} patternUnits="userSpaceOnUse">
            <circle cx={gs / 2} cy={gs / 2} r={Math.max(0.8, 1.1 * view.k)} fill={c.dot} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#t2d-dots)" />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <Scene nodes={nodes} edges={edges} selectedId={selectedId} theme={theme} />
        </g>
      </svg>

      <div className="absolute bottom-3 left-3 flex items-center gap-1 md:bottom-4 md:left-4 rounded-xl border border-slate-200 bg-white/90 p-1 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/90">
        <IconBtn label="縮小" onClick={() => zoomBy(1 / 1.25)}>
          <Minus size={16} />
        </IconBtn>
        <span className="w-12 text-center text-xs font-medium tabular-nums text-slate-600 dark:text-slate-300">
          {Math.round(view.k * 100)}%
        </span>
        <IconBtn label="拡大" onClick={() => zoomBy(1.25)}>
          <Plus size={16} />
        </IconBtn>
        <span className="mx-0.5 h-5 w-px bg-slate-200 dark:bg-slate-600" />
        <IconBtn label="全体表示（リセット）" onClick={fit}>
          <Maximize size={16} />
        </IconBtn>
      </div>
    </div>
  );
}

export function IconBtn({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 ${
        active ? 'bg-slate-100 dark:bg-slate-700' : ''
      }`}
    >
      {children}
    </button>
  );
}
