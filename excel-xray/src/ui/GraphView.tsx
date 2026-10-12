import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useReactFlow,
  type Edge, type Node, type NodeProps,
} from '@xyflow/react';
import { addr } from '../core/address';
import type { GraphMode, GraphNode, GraphResult } from '../core/graph';
import { useApp } from './ctx';
import { cellText } from './format';

type NodeData = { g: GraphNode } & Record<string, unknown>;

function XNode({ data }: NodeProps<Node<NodeData>>) {
  const g = data.g;
  const cls = ['xnode', `k-${g.kind}`, g.isRoot ? 'root' : '', g.inCycle ? 'cycle' : '', g.isFormula ? 'fx' : ''].join(' ');
  return (
    <div className={cls} title={g.note ?? g.formula ?? g.label}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="xn-title">
        {g.kind === 'range' ? '範囲 ' : g.kind === 'external' ? '外部 ' : g.kind === 'unresolved' ? '解決不能 ' : ''}
        <b className="mono">{g.label}</b>
        {g.inCycle && <span className="xn-tag">循環</span>}
        {g.dynamic && <span className="xn-tag dyn">動的</span>}
        {g.hasMore && <span className="xn-tag more" title="先に参照関係があります（階層・上限のため未展開）">＋</span>}
      </div>
      {g.formula && <div className="xn-f mono">{g.formula}</div>}
      {g.value !== undefined && <div className="xn-v">{g.kind === 'range' ? g.value : `保存値: ${g.value}`}</div>}
    </div>
  );
}
const nodeTypes = { x: XNode };

function layout(res: GraphResult): { nodes: Node<NodeData>[]; edges: Edge[] } {
  const byLevel = new Map<number, GraphNode[]>();
  for (const n of res.nodes) {
    const l = byLevel.get(n.level) ?? [];
    l.push(n);
    byLevel.set(n.level, l);
  }
  const nodes: Node<NodeData>[] = [];
  for (const [level, list] of byLevel) {
    list.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, 'ja', { numeric: true }));
    const H = 96;
    list.forEach((g, i) => {
      nodes.push({
        id: g.id, type: 'x', data: { g },
        position: { x: level * 320, y: (i - (list.length - 1) / 2) * H },
      });
    });
  }
  const edges: Edge[] = res.edges.map((e) => ({
    id: e.id, source: e.source, target: e.target, label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed }, animated: false,
  }));
  return { nodes, edges };
}

export function GraphView() {
  return <ReactFlowProvider><GraphInner /></ReactFlowProvider>;
}

function GraphInner() {
  const { loaded, client, graphTarget, selection, select, goCell } = useApp();
  const firstFormula = useMemo(() => {
    if (!loaded) return null;
    for (const s of loaded.model.sheets) {
      const c = s.cells.find((x) => x.f !== undefined);
      if (c) return { sheet: s.name, address: addr(c.r, c.c) };
    }
    const s = loaded.model.sheets.find((x) => x.cells.length) ?? loaded.model.sheets[0];
    return s ? { sheet: s.name, address: 'A1' } : null;
  }, [loaded]);

  const init = graphTarget ?? (selection.sheet && selection.address ? { sheet: selection.sheet, address: selection.address } : firstFormula);
  const [sheet, setSheet] = useState(init?.sheet ?? '');
  const [address, setAddress] = useState(init?.address ?? 'A1');
  const [mode, setMode] = useState<GraphMode>('both');
  const [depth, setDepth] = useState(3);
  const [maxNodes, setMaxNodes] = useState(60);
  const [rangeLimit, setRangeLimit] = useState(10);
  const [res, setRes] = useState<GraphResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (graphTarget) { setSheet(graphTarget.sheet); setAddress(graphTarget.address); }
  }, [graphTarget?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sheet || !address) return;
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      client.graph('main', { sheet, address: address.trim().toUpperCase(), mode, depth, maxNodes, rangeExpandLimit: rangeLimit })
        .then((r) => { if (live) setRes(r); })
        .catch((e) => { if (live) setRes({ ok: false, error: String(e.message ?? e), nodes: [], edges: [], truncated: false, cycleDetected: false, notes: [] }); })
        .finally(() => { if (live) setBusy(false); });
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [client, sheet, address, mode, depth, maxNodes, rangeLimit]);

  const flow = useMemo(() => (res && res.ok ? layout(res) : { nodes: [], edges: [] }), [res]);
  const { fitView } = useReactFlow();
  useEffect(() => {
    // ノード配置が変わるたびに全体が見える位置へ調整する
    const t = setTimeout(() => { fitView({ padding: 0.2, duration: 200 }); }, 60);
    return () => clearTimeout(t);
  }, [flow, fitView]);

  const hits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!loaded || q.length < 1) return [];
    const out: Array<{ sheet: string; address: string; text: string }> = [];
    for (const s of loaded.model.sheets) {
      for (const c of s.cells) {
        const a = addr(c.r, c.c);
        const txt = cellText(c);
        if (a.toLowerCase() === q || (c.f ?? '').toLowerCase().includes(q) || txt.toLowerCase().includes(q)) {
          out.push({ sheet: s.name, address: a, text: c.f !== undefined ? '=' + c.f : txt });
          if (out.length >= 12) return out;
        }
      }
    }
    return out;
  }, [search, loaded]);

  const onNodeClick = useCallback((_: unknown, n: Node) => {
    const g = (n.data as NodeData).g;
    if (g.kind === 'cell' && g.sheet) select({ sheet: g.sheet, address: g.address });
  }, [select]);
  const onNodeDoubleClick = useCallback((_: unknown, n: Node) => {
    const g = (n.data as NodeData).g;
    if (g.kind === 'cell' && g.sheet) { setSheet(g.sheet); setAddress(g.address); }
  }, []);

  if (!loaded) return null;
  return (
    <div className="page fill graphpage">
      <h2 className="page-title">依存関係グラフ</h2>
      <p className="lead">矢印は「参照される側 → 参照する側」（計算の流れ）です。ノードをクリックで詳細、ダブルクリックでそのセルを中心に再表示します。</p>
      <div className="filters graph-controls">
        <label>シート
          <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
            {loaded.model.sheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label>セル番地
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="mono short" aria-label="セル番地" placeholder="例: D6" />
        </label>
        <div className="chips" role="radiogroup" aria-label="表示モード">
          {([['up', '上流（参照元）'], ['down', '下流（参照先）'], ['both', '両方向']] as const).map(([m, l]) => (
            <button key={m} role="radio" aria-checked={mode === m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{l}</button>
          ))}
        </div>
        <label>探索階層
          <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label>ノード上限
          <select value={maxNodes} onChange={(e) => setMaxNodes(Number(e.target.value))}>{[30, 60, 100, 200, 400].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </label>
        <label title="範囲参照の中にある数式セルを、いくつまで展開するか">範囲の展開数
          <select value={rangeLimit} onChange={(e) => setRangeLimit(Number(e.target.value))}>{[0, 5, 10, 30, 100].map((n) => <option key={n} value={n}>{n === 0 ? '展開しない（集約のみ）' : n}</option>)}</select>
        </label>
        <div className="searchbox">
          <label>セルを検索
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="番地・値・数式" />
          </label>
          {hits.length > 0 && (
            <ul className="hits" role="listbox" aria-label="検索結果">
              {hits.map((h) => (
                <li key={h.sheet + h.address}>
                  <button role="option" aria-selected="false" onClick={() => { setSheet(h.sheet); setAddress(h.address); setSearch(''); }}>
                    <span className="mono">{h.sheet}!{h.address}</span> <span className="small clip">{h.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {res && !res.ok && <div className="banner error" role="alert">{res.error}</div>}
      {res && res.ok && (
        <div className="graph-status" aria-live="polite">
          {busy ? '更新中…' : `ノード ${res.nodes.length} / エッジ ${res.edges.length}`}
          {res.nodes.find((n) => n.isRoot)?.note && <span className="small"> — {res.nodes.find((n) => n.isRoot)!.note}</span>}
          <button className="btn small" onClick={() => goCell(sheet, address.toUpperCase())}>このセルをシートで見る</button>
        </div>
      )}
      {res && res.ok && res.notes.length > 0 && (
        <div className="banner warn" role="status">{res.notes.slice(0, 6).map((n, i) => <div key={i}>• {n}</div>)}{res.notes.length > 6 && <div>…ほか {res.notes.length - 6} 件</div>}</div>
      )}
      <div className="flow-wrap" aria-label="依存関係グラフ">
        <ReactFlow
          nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes}
          onNodeClick={onNodeClick} onNodeDoubleClick={onNodeDoubleClick}
          fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.1} maxZoom={1.6}
          nodesConnectable={false} edgesFocusable={false} proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
        <div className="legend small">
          <span><i className="lg root" />起点</span><span><i className="lg fx" />数式セル</span><span><i className="lg plain" />定数セル</span>
          <span><i className="lg range" />範囲（集約）</span><span><i className="lg cycle" />循環の可能性</span><span><i className="lg ext" />外部/解決不能</span>
        </div>
      </div>
    </div>
  );
}
