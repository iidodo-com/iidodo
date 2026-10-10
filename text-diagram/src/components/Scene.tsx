import { memo } from 'react';
import type { DEdge, DNode, Theme } from '../types';
import { edgeGeometry } from '../lib/geometry';
import { textWidth } from '../lib/layout';
import { CANVAS, swatch } from '../lib/theme';

export const FONT = '"Inter","Noto Sans JP","Hiragino Sans","Yu Gothic UI","Meiryo",system-ui,sans-serif';

interface Props {
  nodes: DNode[];
  edges: DEdge[];
  selectedId: string | null;
  theme: Theme;
}

/** Pure SVG scene (no DOM deps) so it can be rendered live and to a static string for export. */
export const Scene = memo(function Scene({ nodes, edges, selectedId, theme }: Props) {
  const c = CANVAS[theme];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const active = new Set<string>();
  const activeEdges = new Set<string>();
  if (selectedId) {
    active.add(selectedId);
    for (const e of edges) {
      if (e.source === selectedId || e.target === selectedId) {
        activeEdges.add(e.id);
        active.add(e.source);
        active.add(e.target);
      }
    }
  }
  const dim = (on: boolean) => (selectedId && !on ? 0.18 : 1);

  return (
    <g fontFamily={FONT}>
      <defs>
        <filter id="t2d-shadow" x="-20%" y="-30%" width="140%" height="180%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0f172a" floodOpacity={theme === 'dark' ? 0.5 : 0.14} />
        </filter>
      </defs>

      <g>
        {edges.map((e) => {
          const a = byId.get(e.source);
          const b = byId.get(e.target);
          if (!a || !b) return null;
          const g = edgeGeometry(e, a, b);
          const on = activeEdges.has(e.id);
          const base = e.kind === 'conflict' ? c.conflict : c.edge;
          const color = on ? swatch(a.category, theme).accent : base;
          const lw = e.label ? textWidth(e.label, 0.78) + 16 : 0;
          return (
            <g key={e.id} style={{ opacity: dim(on), transition: 'opacity .2s' }}>
              <path
                d={g.d}
                fill="none"
                stroke={color}
                strokeWidth={on ? 2.6 : 1.8}
                strokeLinecap="round"
                strokeDasharray={e.kind === 'conflict' ? '7 5' : undefined}
              />
              {g.arrows.map((p, i) => (
                <polygon key={i} points={p} fill={color} />
              ))}
              {e.label && (
                <g>
                  <rect
                    x={g.mx - lw / 2}
                    y={g.my - 11}
                    width={lw}
                    height={22}
                    rx={11}
                    fill={c.labelBg}
                    stroke={on ? color : 'none'}
                    strokeWidth={1}
                    opacity={0.96}
                  />
                  <text
                    x={g.mx}
                    y={g.my}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fontWeight={500}
                    fill={on ? color : c.edgeText}
                  >
                    {e.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>

      <g>
        {nodes.map((n) => {
          const s = swatch(n.category, theme);
          const sel = n.id === selectedId;
          const on = active.has(n.id);
          return (
            <g
              key={n.id}
              data-node-id={n.id}
              transform={`translate(${n.x - n.w / 2},${n.y - n.h / 2})`}
              style={{ opacity: dim(on), cursor: 'grab', transition: 'opacity .2s' }}
            >
              <rect
                width={n.w}
                height={n.h}
                rx={14}
                fill={s.fill}
                stroke={sel ? s.accent : s.stroke}
                strokeWidth={sel ? 2.6 : 1.4}
                filter="url(#t2d-shadow)"
              />
              <rect x={0} y={14} width={4} height={n.h - 28} rx={2} fill={s.accent} />
              <text
                x={n.w / 2}
                y={17}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10}
                fontWeight={600}
                letterSpacing={0.6}
                fill={s.sub}
              >
                {n.category}
              </text>
              <text
                x={n.w / 2}
                y={n.h - 19}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={15}
                fontWeight={650}
                fill={s.text}
              >
                {n.label}
              </text>
              {n.note && <title>{n.note}</title>}
            </g>
          );
        })}
      </g>
    </g>
  );
});
