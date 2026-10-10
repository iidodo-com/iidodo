import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Moon, PencilLine, Workflow as FlowIcon, Network, Settings as SettingsIcon, Sun } from 'lucide-react';
import type { DNode, Graph, Preset, RawGraph, Settings, Theme, View } from './types';
import { autoLayout, buildGraph, nodeSize } from './lib/layout';
import { parseText } from './lib/parser';
import { extractWithLLM } from './lib/llm';
import { SAMPLES } from './lib/samples';
import { exportPng, exportSvg } from './lib/export';
import { InputPanel } from './components/InputPanel';
import { Canvas } from './components/Canvas';
import { ExportBar } from './components/ExportBar';
import { Inspector } from './components/Inspector';
import { EmptyState } from './components/EmptyState';
import { SettingsModal } from './components/SettingsModal';
import { DataModal } from './components/DataModal';

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

function loadSettings(): Settings {
  try {
    const s = JSON.parse(store.get('t2d-settings') ?? '');
    if (s && typeof s.provider === 'string') return s;
  } catch {
    /* ignore */
  }
  return { provider: 'none', apiKey: '', model: '' };
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const [text, setText] = useState('');
  const [preset, setPreset] = useState<Preset>('relation');
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [fitSignal, setFitSignal] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [modal, setModal] = useState<'settings' | 'data' | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'input' | 'diagram'>('input'); // mobile only
  const [notice, setNotice] = useState<{ kind: 'warn' | 'info'; msg: string } | null>(null);

  const aiOn = settings.provider !== 'none' && settings.apiKey.length > 0;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    store.set('t2d-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const applyRaw = useCallback((raw: RawGraph, p: Preset) => {
    setGraph(buildGraph(raw, p));
    setSelectedId(null);
    setFitSignal((n) => n + 1);
  }, []);

  const generate = useCallback(
    async (src = text, p = preset) => {
      if (!src.trim()) return;
      let raw: RawGraph | null = null;
      if (aiOn) {
        setBusy(true);
        try {
          raw = await extractWithLLM(src, p, settings);
        } catch (e) {
          setNotice({
            kind: 'warn',
            msg: `AI解析に失敗したためルールベースで生成しました（${e instanceof Error ? e.message : String(e)}）`,
          });
        } finally {
          setBusy(false);
        }
      }
      raw ??= parseText(src, p);
      if (raw.nodes.length === 0) {
        setNotice({ kind: 'warn', msg: '図にできる要素が見つかりませんでした。「A → B: 関係」形式や箇条書きで書いてみてください。' });
        return;
      }
      applyRaw(raw, p);
      setTab('diagram');
    },
    [text, preset, aiOn, settings, applyRaw],
  );

  const loadSample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id)!;
    setText(s.text);
    setPreset(s.preset);
    void generate(s.text, s.preset);
  };

  const moveNode = useCallback((id: string, x: number, y: number) => {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
  }, []);

  const patchNode = (id: string, patch: Partial<Pick<DNode, 'label' | 'category' | 'note'>>) =>
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        if (n.id !== id) return n;
        const m = { ...n, ...patch };
        return { ...m, ...nodeSize(m.label, m.category) };
      }),
    }));

  const deleteNode = (id: string) => {
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.source !== id && e.target !== id),
    }));
    setSelectedId(null);
  };

  const selected = useMemo(() => graph.nodes.find((n) => n.id === selectedId) ?? null, [graph.nodes, selectedId]);
  const empty = graph.nodes.length === 0;

  const run = async (fn: () => Promise<void> | void) => {
    try {
      await fn();
    } catch (e) {
      setNotice({ kind: 'warn', msg: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 md:px-4 md:py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-900 text-white dark:bg-blue-500">
            <Network size={17} />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-bold">Text2Diagram</h1>
            <p className="hidden text-xs text-slate-500 sm:block">テキストから即座に図解</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1.5 text-xs"
            onClick={() => setModal('settings')}
            title="AI設定"
          >
            <SettingsIcon size={14} />
            <span className="hidden sm:inline">AI設定</span>
            <span
              className={`h-1.5 w-1.5 rounded-full ${aiOn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
              aria-label={aiOn ? 'AI有効' : 'AI無効'}
            />
          </button>
          <button
            type="button"
            aria-label="テーマ切替"
            title="ライト / ダーク切替"
            className="btn-ghost !px-2.5 !py-1.5"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          className={`${tab === 'input' ? 'block' : 'hidden'} min-h-0 w-full flex-1 bg-slate-50 dark:bg-slate-950 md:block md:w-[380px] md:flex-none md:border-r md:border-slate-200 md:dark:border-slate-800`}
        >
          <InputPanel
            text={text}
            setText={setText}
            preset={preset}
            setPreset={setPreset}
            onGenerate={() => void generate()}
            onSample={loadSample}
            busy={busy}
            aiOn={aiOn}
          />
        </aside>

        <section className={`${tab === 'diagram' ? 'block' : 'hidden'} relative min-h-0 flex-1 md:block`}>
          <Canvas
            nodes={graph.nodes}
            edges={graph.edges}
            selectedId={selectedId}
            theme={theme}
            view={view}
            setView={setView}
            onSelect={setSelectedId}
            onMoveNode={moveNode}
            fitSignal={fitSignal}
          />
          <ExportBar
            disabled={empty}
            onLayout={() => {
              setGraph((g) => autoLayout(g, preset));
              setFitSignal((n) => n + 1);
            }}
            onPng={() => void run(() => exportPng(graph.nodes, graph.edges, theme, 2))}
            onSvg={() => run(() => exportSvg(graph.nodes, graph.edges, theme))}
            onJson={() => setModal('data')}
          />
          <AnimatePresence>
            {selected && (
              <Inspector
                key="inspector"
                node={selected}
                nodes={graph.nodes}
                edges={graph.edges}
                onChange={(p) => patchNode(selected.id, p)}
                onDelete={() => deleteNode(selected.id)}
                onClose={() => setSelectedId(null)}
              />
            )}
            {empty && <EmptyState key="empty" onTry={() => loadSample('sangoku')} />}
          </AnimatePresence>

          <AnimatePresence>
            {notice && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                role="status"
                className="absolute bottom-4 left-1/2 flex max-w-[90%] -translate-x-1/2 items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {notice.msg}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      <nav className="grid grid-cols-2 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-900 md:hidden">
        {(
          [
            ['input', '入力', PencilLine],
            ['diagram', '図解', FlowIcon],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              if (id === 'diagram') setFitSignal((n) => n + 1);
            }}
            className={`flex items-center justify-center gap-1.5 py-3 text-sm font-medium ${
              tab === id ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'
            }`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </nav>

      <SettingsModal
        open={modal === 'settings'}
        settings={settings}
        onClose={() => setModal(null)}
        onSave={(s) => {
          setSettings(s);
          store.set('t2d-settings', JSON.stringify(s));
        }}
      />
      <DataModal
        open={modal === 'data'}
        graph={graph}
        onClose={() => setModal(null)}
        onImport={(g, needsLayout) => {
          setGraph(needsLayout ? autoLayout(g, preset) : g);
          setSelectedId(null);
          setFitSignal((n) => n + 1);
        }}
      />
    </div>
  );
}
