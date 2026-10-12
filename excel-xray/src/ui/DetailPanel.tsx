import { useEffect, useState } from 'react';
import { addr, cellKey, parseAddr } from '../core/address';
import type { GraphResult } from '../core/graph';
import { KIND_LABEL, CERTAINTY_LABEL } from '../core/types';
import { useApp } from './ctx';
import { cellText, TYPE_LABEL } from './format';
import { CertBadge, SevBadge } from './SevBadge';

export function DetailPanel() {
  const { loaded, selection, goCell, goGraph, client, select } = useApp();
  const [nbrs, setNbrs] = useState<GraphResult | null>(null);

  const sheet = selection.sheet;
  const address = selection.address;
  const view = loaded && sheet ? loaded.sheets.get(sheet) : undefined;
  const pos = address ? parseAddr(address) : null;
  const cell = view && pos ? view.cells.get(cellKey(pos.r, pos.c)) : undefined;

  useEffect(() => {
    setNbrs(null);
    if (!sheet || !address || !pos || !view) return;
    let live = true;
    client.graph('main', { sheet, address, mode: 'both', depth: 1, maxNodes: 60, rangeExpandLimit: 0 })
      .then((g) => { if (live) setNbrs(g); })
      .catch(() => { if (live) setNbrs(null); });
    return () => { live = false; };
  }, [sheet, address, client]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return null;
  if (!sheet && !selection.finding) {
    return (
      <div className="detail-body">
        <h2>詳細パネル</h2>
        <p className="muted">検出結果の行、シート表のセル、依存関係グラフのノードを選択すると、ここに値・数式・参照関係・警告・理由が表示されます。</p>
      </div>
    );
  }

  const warnings = sheet && address ? loaded.findingsByCell.get(`${sheet}!${address}`) ?? [] : [];
  const ups = nbrs?.nodes.filter((n) => n.level === -1 && !n.isRoot) ?? [];
  const downs = nbrs?.nodes.filter((n) => n.level === 1 && !n.isRoot) ?? [];
  const f = selection.finding;

  return (
    <div className="detail-body">
      <h2>詳細パネル</h2>
      {f && (
        <section className="dsec finding-card">
          <div className="row"><SevBadge sev={f.severity} /> <CertBadge c={f.certainty} /> <b>{KIND_LABEL[f.kind]}</b></div>
          <h3>{f.title}</h3>
          <dl>
            <dt>検出理由</dt><dd>{f.reason}</dd>
            <dt>確認すべき内容</dt><dd>{f.advice}</dd>
            {f.evidence && (<><dt>根拠</dt><dd className="mono">{f.evidence}</dd></>)}
            <dt>判定の確実性</dt><dd>{CERTAINTY_LABEL[f.certainty]}</dd>
            {f.cells && f.cells.length > 0 && (<><dt>対象セル{f.count ? `（${f.count}件）` : ''}</dt><dd className="mono">{f.cells.join(', ')}{f.count && f.count > f.cells.length ? ' …' : ''}</dd></>)}
          </dl>
        </section>
      )}

      {sheet && address && pos && (
        <>
          <section className="dsec">
            <h3>セル</h3>
            <dl>
              <dt>シート名</dt><dd>{sheet}</dd>
              <dt>セル番地</dt><dd className="mono">{address}</dd>
              <dt>データ型</dt><dd>{cell ? TYPE_LABEL[cell.t] + (cell.f !== undefined ? '（数式セル）' : '') : '空（値も数式もありません）'}</dd>
              {cell && cell.f === undefined && (<><dt>保存値（定数）</dt><dd className="mono wrap">{cellText(cell) || '（空）'}</dd></>)}
              {cell && cell.f !== undefined && (
                <>
                  <dt>数式</dt><dd className="mono wrap formula">={cell.f}{cell.fkind === 'array' ? '  （配列数式）' : ''}</dd>
                  <dt>数式の保存結果</dt>
                  <dd className="mono wrap">{cell.cached ? (cellText(cell) || '（空文字）') : '取得できません（計算結果が保存されていません）'}</dd>
                </>
              )}
              <dt>表示形式</dt><dd className="mono">{cell?.nf ?? (cell ? 'General（標準）' : '取得できません')}</dd>
              {cell?.link && (<><dt>ハイパーリンク</dt><dd className="mono wrap">{cell.link}<br /><span className="small">接続はしません</span></dd></>)}
            </dl>
            {cell?.f !== undefined && <p className="small note">表示中の値は、ファイルに保存されていた計算結果です。本ツールは再計算を行いません。</p>}
            <div className="btns">
              <button className="btn small" onClick={() => goCell(sheet, address)}>シートで表示</button>
              <button className="btn small primary" onClick={() => goGraph(sheet, address)}>依存関係グラフで見る</button>
            </div>
          </section>

          <section className="dsec">
            <h3>警告（{warnings.length}）</h3>
            {warnings.length === 0 ? <p className="muted">このセルに関する検出はありません。</p> : (
              <ul className="wlist">
                {warnings.map((w) => (
                  <li key={w.id}>
                    <button className="link-block" onClick={() => select({ sheet, address, finding: w })}>
                      <SevBadge sev={w.severity} /> <b>{KIND_LABEL[w.kind]}</b><br /><span className="small">{w.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="dsec">
            <h3>参照関係（直接）</h3>
            {cell?.f !== undefined && (nbrs === null ? <p className="muted">読み込み中…</p> : null)}
            <h4>参照元（このセルが参照している）</h4>
            {nbrs && ups.length === 0 ? <p className="muted">なし{cell?.f !== undefined ? '（または解析不能）' : ''}</p> : (
              <ul className="reflist">{ups.map((n) => (
                <li key={n.id}>
                  {n.kind === 'cell' && n.sheet ? <button className="link mono" onClick={() => goCell(n.sheet!, n.address)}>{n.label}</button> : <span className="mono">{n.label}</span>}
                  {n.kind === 'range' && <span className="small"> 範囲 ({n.value})</span>}
                  {n.kind === 'external' && <span className="small"> 外部ブック（接続しません）</span>}
                  {n.kind === 'unresolved' && <span className="small"> {n.note}</span>}
                  {n.value && n.kind === 'cell' && <span className="small"> = {n.value}</span>}
                </li>
              ))}</ul>
            )}
            <h4>参照先（このセルを参照している）</h4>
            {nbrs && downs.length === 0 ? <p className="muted">なし</p> : (
              <ul className="reflist">{downs.map((n) => (
                <li key={n.id}><button className="link mono" onClick={() => goCell(n.sheet!, n.address)}>{n.label}</button>{n.formula && <span className="small mono"> {n.formula}</span>}</li>
              ))}</ul>
            )}
            {nbrs?.notes.length ? <p className="small note">{nbrs.notes.join(' ')}</p> : null}
          </section>

          <section className="dsec">
            <h3>周辺のセル</h3>
            <div className="mini" role="table" aria-label="周辺のセル">
              {[-2, -1, 0, 1, 2].map((dr) => (
                <div className="mini-row" role="row" key={dr}>
                  {[-2, -1, 0, 1, 2].map((dc) => {
                    const r = pos.r + dr, c = pos.c + dc;
                    if (r < 1 || c < 1) return <div className="mini-cell none" key={dc} role="cell" />;
                    const x = view?.cells.get(cellKey(r, c));
                    const a = addr(r, c);
                    return (
                      <button key={dc} role="cell" className={`mini-cell ${x?.f !== undefined ? 'fx' : ''} ${dr === 0 && dc === 0 ? 'me' : ''}`}
                        title={`${a}${x?.f !== undefined ? ' =' + x.f : ''}`} onClick={() => select({ sheet, address: a })}>
                        <small>{a}</small>
                        <span>{x ? (x.f !== undefined && !x.cached ? 'ƒ' : cellText(x)) : ''}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="small">青地は数式セル。クリックで移動できます。</p>
          </section>
        </>
      )}
    </div>
  );
}
