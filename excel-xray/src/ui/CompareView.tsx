import { useEffect, useMemo, useRef, useState } from 'react';
import { CHANGE_LABEL, type ChangeType, type DiffResult } from '../core/diff';
import { csvCell } from '../core/report';
import { SEVERITY_LABEL, type Severity } from '../core/types';
import { useApp } from './ctx';
import { baseName, download, stamp } from './format';
import { SevBadge } from './SevBadge';
import { VirtualList } from './VirtualList';

interface Side { name: string; info: string }

export function CompareView() {
  const { client } = useApp();
  const [a, setA] = useState<Side | null>(null);
  const [b, setB] = useState<Side | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [type, setType] = useState<ChangeType | 'all'>('all');
  const [sev, setSev] = useState<Severity | 'all'>('all');
  const [sheet, setSheet] = useState('all');
  const [text, setText] = useState('');
  const inA = useRef<HTMLInputElement>(null);
  const inB = useRef<HTMLInputElement>(null);

  const load = async (slot: 'cmpA' | 'cmpB', f: File) => {
    setErr(null);
    setBusy(`${f.name} を読み込んでいます…`);
    try {
      const buf = await f.arrayBuffer();
      const { model } = await client.load(slot, f.name, buf, (m) => setBusy(`${f.name}: ${m}`));
      (slot === 'cmpA' ? setA : setB)({ name: f.name, info: `シート ${model.sheets.length}・数式 ${model.sheets.reduce((n, s) => n + s.formulaCount, 0)}` });
      setDiff(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      (slot === 'cmpA' ? setA : setB)(null);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!a || !b || diff) return;
    let live = true;
    setBusy('差分を計算しています…');
    client.compare().then((d) => { if (live) setDiff(d); }).catch((e) => { if (live) setErr(String(e.message ?? e)); }).finally(() => { if (live) setBusy(null); });
    return () => { live = false; };
  }, [a, b, diff, client]);

  const sheets = useMemo(() => [...new Set((diff?.items ?? []).map((i) => i.sheet))], [diff]);
  const list = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (diff?.items ?? []).filter((i) =>
      (type === 'all' || i.type === type) && (sev === 'all' || i.severity === sev) && (sheet === 'all' || i.sheet === sheet) &&
      (!t || `${i.address ?? ''} ${i.before ?? ''} ${i.after ?? ''} ${i.detail}`.toLowerCase().includes(t)));
  }, [diff, type, sev, sheet, text]);

  const exportCsv = () => {
    const head = ['重要度', '変更種別', 'シート', '旧シート名', 'セル', '変更前', '変更後', '説明'];
    const rows = list.map((i) => [SEVERITY_LABEL[i.severity], CHANGE_LABEL[i.type], i.sheet, i.oldSheet ?? '', i.address ?? '', i.before ?? '', i.after ?? '', i.detail].map(csvCell).join(','));
    download(`${baseName(b?.name ?? 'diff')}_diff_${stamp()}.csv`, 'text/csv;charset=utf-8', '﻿' + [head.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n');
  };

  return (
    <div className="page fill">
      <h2 className="page-title">2ファイル比較</h2>
      <p className="lead">旧版と新版のExcelファイルを読み込むと、シート・値・数式・構造の差分を表示します。ファイルは外部へ送信されません。</p>
      <div className="cmp-pick">
        <div className="panel">
          <h3>旧版</h3>
          <p className="mono">{a ? a.name : '未選択'}</p><p className="small">{a?.info}</p>
          <button className="btn" onClick={() => inA.current?.click()}>旧版ファイルを選択</button>
          <input ref={inA} type="file" hidden accept=".xlsx,.xlsm" onChange={(e) => { const f = e.target.files?.[0]; if (f) load('cmpA', f); e.target.value = ''; }} />
        </div>
        <div className="panel">
          <h3>新版</h3>
          <p className="mono">{b ? b.name : '未選択'}</p><p className="small">{b?.info}</p>
          <button className="btn" onClick={() => inB.current?.click()}>新版ファイルを選択</button>
          <input ref={inB} type="file" hidden accept=".xlsx,.xlsm" onChange={(e) => { const f = e.target.files?.[0]; if (f) load('cmpB', f); e.target.value = ''; }} />
        </div>
      </div>
      {busy && <div className="banner" role="status">{busy}</div>}
      {err && <div className="banner error" role="alert">⚠ {err}</div>}
      {diff && (
        <>
          <div className="cmp-summary">
            <b>変更 {diff.totalChanges} 件</b>{diff.truncated && <span className="small">（表示は先頭 {diff.items.length} 件まで）</span>}
            {diff.totalChanges === 0 && <span> — 検査した範囲（値・数式・シート・非表示・結合・名前定義・外部リンク）に差分はありません。</span>}
          </div>
          <div className="filters">
            <label>変更種別
              <select value={type} onChange={(e) => setType(e.target.value as ChangeType | 'all')}>
                <option value="all">すべて</option>
                {(Object.keys(diff.counts) as ChangeType[]).map((t) => <option key={t} value={t}>{CHANGE_LABEL[t]} ({diff.counts[t]})</option>)}
              </select>
            </label>
            <label>重要度
              <select value={sev} onChange={(e) => setSev(e.target.value as Severity | 'all')}>
                <option value="all">すべて</option>
                {(['high', 'medium', 'low', 'info'] as const).map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
              </select>
            </label>
            <label>シート
              <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
                <option value="all">すべて</option>
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="grow">キーワード<input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="セル番地・値・数式" /></label>
            <button className="btn small" onClick={exportCsv} disabled={list.length === 0}>表示中の差分をCSVで保存</button>
          </div>
          {list.length === 0 ? <div className="empty">条件に一致する差分はありません。</div> : (
            <div className="findings-wrap">
              <div className="drow fhead" aria-hidden="true"><span>重要度</span><span>変更種別</span><span>シート!セル</span><span>変更前</span><span>変更後</span></div>
              <VirtualList ariaLabel="差分一覧" count={list.length} rowHeight={58} render={(i) => {
                const d = list[i];
                return (
                  <div role="listitem" key={d.id}>
                    <div className="drow" style={{ height: 58 }} title={d.detail}>
                      <span><SevBadge sev={d.severity} /></span>
                      <span>{CHANGE_LABEL[d.type]}</span>
                      <span className="mono clip">{d.oldSheet ? `${d.oldSheet} → ` : ''}{d.sheet}{d.address ? '!' + d.address : ''}</span>
                      <span className="mono clip2 before">{d.before ?? '—'}</span>
                      <span className="mono clip2 after">{d.after ?? '—'}</span>
                    </div>
                  </div>
                );
              }} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
