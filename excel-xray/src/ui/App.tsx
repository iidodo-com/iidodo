import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { XrayClient } from '../worker/client';
import { SEVERITY_LABEL, type StructureCategory } from '../core/types';
import { fmtBytes } from './format';
import { Ctx, makeLoaded, type AppCtx, type DiagFilter, type Loaded, type Selection, type Tab } from './ctx';
import { Home } from './Home';
import { Dashboard } from './Dashboard';
import { SheetExplorer } from './SheetExplorer';
import { Diagnostics } from './Diagnostics';
import { Structure } from './Structure';
import { ReportView } from './ReportView';
import { CompareView } from './CompareView';
import { DetailPanel } from './DetailPanel';

const GraphView = lazy(() => import('./GraphView').then((m) => ({ default: m.GraphView })));

const TABS: Array<{ id: Tab; label: string; hint: string; needsFile: boolean }> = [
  { id: 'home', label: 'ファイル', hint: 'Excelファイルを読み込む', needsFile: false },
  { id: 'dashboard', label: 'ダッシュボード', hint: '検査結果の全体像', needsFile: true },
  { id: 'sheets', label: 'シート', hint: 'シートとセルを調べる', needsFile: true },
  { id: 'diagnostics', label: '数式診断', hint: '数式エラー・パターン不一致・固定値混入', needsFile: true },
  { id: 'graph', label: '依存関係', hint: 'セルの参照関係をグラフで見る', needsFile: true },
  { id: 'structure', label: '外部リンク・構造', hint: '隠しシート・名前定義・外部参照', needsFile: true },
  { id: 'report', label: 'レポート出力', hint: 'HTML / CSV / JSON / 印刷', needsFile: true },
  { id: 'compare', label: '2ファイル比較', hint: '旧版と新版の差分', needsFile: false },
];

export function App() {
  const client = useMemo(() => new XrayClient(), []);
  useEffect(() => () => client.terminate(), [client]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [selection, setSelection] = useState<Selection>({});
  const [currentSheet, setCurrentSheet] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graphTarget, setGraphTarget] = useState<AppCtx['graphTarget']>(null);
  const [focusRequest, setFocusRequest] = useState<AppCtx['focusRequest']>(null);
  const [diagFilter, setDiagFilter] = useState<DiagFilter>({});
  const [structureCategory, setStructureCategory] = useState<StructureCategory | 'all'>('all');
  const [sideOpen, setSideOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const nonce = useRef(0);

  const openBuffer = useCallback(async (name: string, data: Uint8Array) => {
    setError(null);
    setBusy('ファイルを読み込んでいます…');
    try {
      const copy = data.slice().buffer as ArrayBuffer;
      const { model, analysis } = await client.load('main', name, copy, (m) => setBusy(m));
      const l = makeLoaded(model, analysis);
      setLoaded(l);
      setSelection({});
      setCurrentSheet(model.sheets.find((s) => s.state === 'visible')?.name ?? model.sheets[0]?.name ?? null);
      setDiagFilter({});
      setGraphTarget(null);
      setDetailOpen(false);
      setSideOpen(false);
      setTab('dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [client]);

  const openFile = useCallback(async (f: File) => {
    setError(null);
    if (f.size === 0) { setError('ファイルが空です。'); return; }
    setBusy('ファイルを読み込んでいます…');
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      await openBuffer(f.name, buf);
    } catch (e) {
      setError(`ファイルを読み取れませんでした: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(null);
    }
  }, [openBuffer]);

  const ctx: AppCtx = {
    loaded, client, selection, select: (s) => { setSelection(s); setDetailOpen(true); },
    tab, setTab: (t) => { setError(null); setTab(t); }, currentSheet, setCurrentSheet,
    goCell: (sheet, address) => {
      setCurrentSheet(sheet);
      setSelection({ sheet, address });
      setFocusRequest({ sheet, address, nonce: ++nonce.current });
      setTab('sheets');
      setDetailOpen(true);
    },
    goGraph: (sheet, address) => {
      setGraphTarget({ sheet, address, nonce: ++nonce.current });
      setTab('graph');
    },
    graphTarget, focusRequest, diagFilter,
    goDiagnostics: (f) => { setDiagFilter(f); setTab('diagnostics'); },
    structureCategory,
    goStructure: (c) => { setStructureCategory(c); setTab('structure'); },
    openFile, openBuffer,
  };

  const sevCounts = loaded?.analysis.summary.bySeverity;
  const showSide = !!loaded && tab !== 'compare' && tab !== 'home';
  const showDetail = !!loaded && tab !== 'compare' && tab !== 'home';

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <header className="topbar">
          <button className="icon-btn side-toggle" aria-label="シート一覧を開閉" aria-expanded={sideOpen} onClick={() => setSideOpen((v) => !v)}>☰</button>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">X</span>
            <div>
              <h1>Excel X-Ray</h1>
              <p>Excelの検査室 — ブラウザ内で完結・読取専用</p>
            </div>
          </div>
          {loaded && (
            <div className="file-chip" title={loaded.model.fileName}>
              <span className="file-name">{loaded.model.fileName}</span>
              <span className="file-meta">{fmtBytes(loaded.model.fileSize)}</span>
              {sevCounts && (['high', 'medium', 'low'] as const).map((s) => (
                <span key={s} className={`mini-count sev-${s}`} title={`重要度 ${SEVERITY_LABEL[s]}`}>{SEVERITY_LABEL[s]} {sevCounts[s]}</span>
              ))}
            </div>
          )}
          <span className="privacy" title="ファイルの内容は外部へ送信されません">🔒 外部送信なし</span>
        </header>

        <nav className="tabs" aria-label="画面の切り替え">
          {TABS.map((t) => {
            const disabled = t.needsFile && !loaded;
            return (
              <button
                key={t.id}
                className={`tab ${tab === t.id ? 'active' : ''}`}
                aria-current={tab === t.id ? 'page' : undefined}
                disabled={disabled}
                title={disabled ? '先にExcelファイルを読み込んでください' : t.hint}
                onClick={() => ctx.setTab(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {error && (
          <div className="banner error" role="alert">
            <span>⚠ {error}</span>
            <button className="btn small" onClick={() => setError(null)}>閉じる</button>
          </div>
        )}

        <div className={`workspace ${sideOpen ? 'side-open' : ''} ${detailOpen ? 'detail-open' : ''} ${showSide ? 'has-file' : ''}`}>
          {showSide && loaded && (
            <aside className="sidebar" aria-label="シート一覧">
              <h2>シート一覧 <span className="count">{loaded.model.sheets.length}</span></h2>
              <ul>
                {loaded.model.sheets.map((s) => {
                  const warn = loaded.analysis.findings.filter((f) => f.sheet === s.name && f.severity !== 'info').length;
                  return (
                    <li key={s.name}>
                      <button
                        className={`sheet-item ${currentSheet === s.name ? 'active' : ''}`}
                        onClick={() => { setCurrentSheet(s.name); setTab('sheets'); setSideOpen(false); }}
                        title="このシートの内容を表示"
                      >
                        <span className="sheet-name">{s.name}</span>
                        <span className="sheet-sub">
                          {s.state !== 'visible' && <span className={`state-tag ${s.state}`}>{s.state === 'hidden' ? '非表示' : 'Very Hidden'}</span>}
                          <span>{s.usedRange ?? '空'}</span>
                          <span>ƒ{s.formulaCount}</span>
                          {warn > 0 && <span className="warn-dot" title="警告あり">⚠{warn}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
          )}

          <main className="main" id="main">
            {tab === 'home' && <Home />}
            {tab === 'dashboard' && loaded && <Dashboard />}
            {tab === 'sheets' && loaded && <SheetExplorer />}
            {tab === 'diagnostics' && loaded && <Diagnostics />}
            {tab === 'graph' && loaded && (
              <Suspense fallback={<div className="pad">グラフ部品を読み込んでいます…</div>}><GraphView /></Suspense>
            )}
            {tab === 'structure' && loaded && <Structure />}
            {tab === 'report' && loaded && <ReportView />}
            {tab === 'compare' && <CompareView />}
          </main>

          {showDetail && (
            <aside className="detail" aria-label="詳細パネル">
              <button className="btn small detail-close" onClick={() => setDetailOpen(false)}>詳細を閉じる</button>
              <DetailPanel />
            </aside>
          )}
          {showDetail && !detailOpen && (
            <button className="btn detail-fab" onClick={() => setDetailOpen(true)}>詳細パネル</button>
          )}
        </div>

        {busy && (
          <div className="overlay" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p>{busy}</p>
            <p className="small">解析はブラウザ内で実行しています。大きなファイルは時間がかかることがあります。</p>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
