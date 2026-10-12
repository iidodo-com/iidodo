import { useMemo, useState } from 'react';
import { useApp } from './ctx';
import { VirtualList } from './VirtualList';
import { CertBadge, SevBadge } from './SevBadge';
import { KIND_LABEL, SEVERITY_LABEL, type Finding, type FindingKind, type Severity } from '../core/types';

export function Diagnostics() {
  const { loaded } = useApp();
  return loaded ? <DiagnosticsInner /> : null;
}

function DiagnosticsInner() {
  const { loaded, diagFilter, goDiagnostics, select, selection } = useApp();
  const [text, setText] = useState(diagFilter.text ?? '');
  if (!loaded) return null;
  const f = diagFilter;
  const sev = f.severity ?? 'all';
  const kind = f.kind ?? 'all';
  const sheet = f.sheet ?? 'all';

  const kinds = useMemo(() => {
    const m = new Map<FindingKind, number>();
    for (const x of loaded.analysis.findings) m.set(x.kind, (m.get(x.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [loaded]);

  const list = useMemo(() => {
    const t = text.trim().toLowerCase();
    return loaded.analysis.findings.filter((x) =>
      (sev === 'all' || x.severity === sev) &&
      (kind === 'all' || x.kind === kind) &&
      (sheet === 'all' || x.sheet === sheet) &&
      (!t || `${x.sheet ?? ''}!${x.address ?? ''} ${x.formula ?? ''} ${x.title} ${x.reason} ${KIND_LABEL[x.kind]}`.toLowerCase().includes(t)));
  }, [loaded, sev, kind, sheet, text]);

  const set = (patch: Partial<typeof f>) => goDiagnostics({ ...f, ...patch });
  const selId = selection.finding?.id;

  return (
    <div className="page fill">
      <h2 className="page-title">数式診断</h2>
      <p className="lead">エラーは<b>保存された計算結果</b>に基づく事実、パターン不一致・固定値混入などは<b>誤りと断定できない候補</b>です。行をクリックすると右の詳細パネルに理由と確認事項が表示されます。</p>
      <div className="filters" role="search" aria-label="検出結果の絞り込み">
        <div className="chips" role="group" aria-label="重要度">
          {(['all', 'high', 'medium', 'low', 'info'] as const).map((s) => (
            <button key={s} className={`chip ${sev === s ? 'on' : ''} ${s !== 'all' ? 'sev-' + s : ''}`} aria-pressed={sev === s} onClick={() => set({ severity: s })}>
              {s === 'all' ? 'すべて' : SEVERITY_LABEL[s as Severity]}
              {s !== 'all' && <span className="chip-n">{loaded.analysis.summary.bySeverity[s as Severity]}</span>}
            </button>
          ))}
        </div>
        <label>種別
          <select value={kind} onChange={(e) => set({ kind: e.target.value as FindingKind | 'all' })}>
            <option value="all">すべて</option>
            {kinds.map(([k, n]) => <option key={k} value={k}>{KIND_LABEL[k]} ({n})</option>)}
          </select>
        </label>
        <label>シート
          <select value={sheet} onChange={(e) => set({ sheet: e.target.value })}>
            <option value="all">すべて</option>
            {loaded.model.sheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label className="grow">キーワード
          <input type="search" value={text} placeholder="セル番地・数式・理由などで絞り込み" onChange={(e) => setText(e.target.value)} />
        </label>
        <span className="small">{list.length} 件を表示</span>
      </div>

      {list.length === 0 ? (
        <div className="empty">条件に一致する検出はありません。<br /><span className="small">「ダッシュボード」の検査範囲で、検査した内容と対象外の内容を確認できます。</span></div>
      ) : (
        <div className="findings-wrap">
          <div className="frow fhead" aria-hidden="true">
            <span>重要度</span><span>種別 / 確実性</span><span>シート!セル</span><span>数式</span><span>内容</span>
          </div>
          <VirtualList
            ariaLabel="検出結果の一覧" count={list.length} rowHeight={66}
            render={(i) => <FindingRow key={list[i].id} f={list[i]} selected={selId === list[i].id}
              onPick={() => select({ sheet: list[i].sheet, address: list[i].address && /^[A-Z]+\d+$/.test(list[i].address!) ? list[i].address : undefined, finding: list[i] })} />}
          />
        </div>
      )}
    </div>
  );
}

function FindingRow({ f, selected, onPick }: { f: Finding; selected: boolean; onPick: () => void }) {
  return (
    <div role="listitem">
      <button className={`frow ${selected ? 'selected' : ''}`} onClick={onPick} aria-pressed={selected} style={{ height: 66 }}>
        <span><SevBadge sev={f.severity} /></span>
        <span className="kcell">{KIND_LABEL[f.kind]}<br /><CertBadge c={f.certainty} /></span>
        <span className="mono clip">{f.sheet ? `${f.sheet}${f.address ? '!' + f.address : ''}` : '（ブック全体）'}</span>
        <span className="mono clip" title={f.formula}>{f.formula ?? '—'}</span>
        <span className="clip2" title={f.reason}><b>{f.title}</b><br />{f.reason}</span>
      </button>
    </div>
  );
}
