import { Trash2, X } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DEdge, DNode } from '../types';

export function Inspector({
  node,
  edges,
  nodes,
  onChange,
  onDelete,
  onClose,
}: {
  node: DNode;
  edges: DEdge[];
  nodes: DNode[];
  onChange: (patch: Partial<Pick<DNode, 'label' | 'category' | 'note'>>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? '?';
  const rel = edges.filter((e) => e.source === node.id || e.target === node.id);
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -12 }}
      className="absolute left-2 top-14 w-60 md:left-4 md:top-4 md:w-64 rounded-xl border border-slate-200 bg-white/95 p-3 text-sm shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">ノード編集</span>
        <button type="button" aria-label="閉じる" onClick={onClose} className="text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>
      <input className="field mb-2 !py-1.5" aria-label="名前" value={node.label} onChange={(e) => onChange({ label: e.target.value })} />
      <input
        className="field mb-2 !py-1.5"
        aria-label="カテゴリ"
        placeholder="カテゴリ（色が変わります）"
        value={node.category}
        onChange={(e) => onChange({ category: e.target.value })}
      />
      <input
        className="field mb-2 !py-1.5"
        aria-label="メモ"
        placeholder="メモ"
        value={node.note ?? ''}
        onChange={(e) => onChange({ note: e.target.value })}
      />
      {rel.length > 0 && (
        <ul className="mb-2 max-h-28 space-y-0.5 overflow-y-auto text-xs text-slate-500 dark:text-slate-400">
          {rel.map((e) => (
            <li key={e.id}>
              {label(e.source)} {e.bidirectional ? '↔' : '→'} {label(e.target)}
              {e.label && <span className="text-slate-400"> ({e.label})</span>}
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onDelete} className="btn-ghost w-full !py-1 text-xs !text-rose-600">
        <Trash2 size={13} /> ノードを削除
      </button>
    </motion.div>
  );
}
