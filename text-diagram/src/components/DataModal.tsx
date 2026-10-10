import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, Upload } from 'lucide-react';
import type { Graph } from '../types';
import { nodeSize } from '../lib/layout';
import { normalizeGraphJson } from '../lib/llm';
import { Modal } from './Modal';

/** Parse editor JSON. Keeps x/y if present; returns null positions otherwise so the caller can lay out. */
export function importGraphJson(text: string): { graph: Graph; needsLayout: boolean } {
  const data = JSON.parse(text);
  if (!Array.isArray(data?.nodes) || !Array.isArray(data?.edges)) throw new Error('nodes / edges 配列が必要です');
  const hasPos = data.nodes.every((n: { x?: unknown; y?: unknown }) => Number.isFinite(n.x) && Number.isFinite(n.y));
  const raw = normalizeGraphJson(data);
  const idOf = new Map<string, string>();
  const src = data.nodes as Record<string, unknown>[];
  const nodes = raw.nodes.map((n, i) => {
    const orig = src.find((s) => String(s.label ?? s.id).trim() === n.label);
    const id = `n${i + 1}`;
    idOf.set(n.label, id);
    const category = n.category ?? 'エンティティ';
    return {
      id,
      label: n.label,
      category,
      note: n.note,
      x: hasPos ? Number(orig?.x) : 0,
      y: hasPos ? Number(orig?.y) : 0,
      ...nodeSize(n.label, category),
    };
  });
  const edges = raw.edges.map((e, i) => ({
    id: `e${i + 1}`,
    source: idOf.get(e.source)!,
    target: idOf.get(e.target)!,
    label: e.label ?? '',
    kind: e.kind ?? ('normal' as const),
    bidirectional: e.bidirectional,
  }));
  if (nodes.length === 0) throw new Error('ノードがありません');
  return { graph: { nodes, edges }, needsLayout: !hasPos };
}

export function exportGraphJson(g: Graph): string {
  return JSON.stringify(
    {
      nodes: g.nodes.map(({ id, label, category, note, x, y }) => ({
        id,
        label,
        category,
        ...(note ? { note } : {}),
        x: Math.round(x),
        y: Math.round(y),
      })),
      edges: g.edges.map(({ source, target, label, kind, bidirectional }) => ({
        source,
        target,
        label,
        kind,
        ...(bidirectional ? { bidirectional } : {}),
      })),
    },
    null,
    2,
  );
}

export function DataModal({
  open,
  graph,
  onImport,
  onClose,
}: {
  open: boolean;
  graph: Graph;
  onImport: (g: Graph, needsLayout: boolean) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setText(graph.nodes.length ? exportGraphJson(graph) : '{\n  "nodes": [],\n  "edges": []\n}');
      setErr('');
      setCopied(false);
    }
  }, [open, graph]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.querySelector<HTMLTextAreaElement>('#t2d-json');
      ta?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const apply = () => {
    try {
      const r = importGraphJson(text);
      onImport(r.graph, r.needsLayout);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal open={open} title="編集データ（JSON）" onClose={onClose}>
      <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
        編集してから「読み込む」で図に反映できます。x / y を省略すると自動配置されます。
      </p>
      <textarea
        id="t2d-json"
        className="field h-72 resize-none font-mono text-xs leading-relaxed"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setErr('');
        }}
      />
      {err && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">JSONエラー: {err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={copy}>
          {copied ? <Check size={15} /> : <ClipboardCopy size={15} />}
          {copied ? 'コピーしました' : 'コピー'}
        </button>
        <button type="button" className="btn-primary" onClick={apply}>
          <Upload size={15} /> 読み込む
        </button>
      </div>
    </Modal>
  );
}
