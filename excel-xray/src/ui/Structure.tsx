import { useMemo } from 'react';
import { useApp } from './ctx';
import { VirtualList } from './VirtualList';
import type { StructureCategory } from '../core/types';

const CAT_LABEL: Record<StructureCategory, string> = {
  sheet: 'シート', 'hidden-rows': '非表示の行', 'hidden-cols': '非表示の列', merge: '結合セル', name: '名前定義',
  'external-link': '外部リンク', 'external-ref': '外部ブックを参照する数式', hyperlink: 'ハイパーリンク',
  'cross-sheet-ref': '他シートを参照する数式', table: 'テーブル', validation: '入力規則',
};

export function Structure() {
  const { loaded } = useApp();
  return loaded ? <StructureInner /> : null;
}

function StructureInner() {
  const { loaded, structureCategory, goStructure, goCell } = useApp();
  if (!loaded) return null;
  const items = loaded.analysis.structure;
  const counts = useMemo(() => {
    const m = new Map<StructureCategory, number>();
    for (const x of items) m.set(x.category, (m.get(x.category) ?? 0) + 1);
    return m;
  }, [items]);
  const list = useMemo(() => items.filter((x) => structureCategory === 'all' || x.category === structureCategory), [items, structureCategory]);
  const m = loaded.model;

  return (
    <div className="page fill">
      <h2 className="page-title">外部リンク・構造検査</h2>
      <p className="lead">隠れた構造を一覧します。<b>非表示にした理由は断定できません</b>（番地と検出根拠のみ表示）。外部リンク先へは接続しません。</p>
      {m.externalLinks.length > 0 && (
        <div className="banner warn">外部リンクが {m.externalLinks.length} 件あります。リンク先: {m.externalLinks.map((l) => l.target ?? '取得できません').join(' , ')}</div>
      )}
      <div className="chips" role="group" aria-label="構造の種別">
        <button className={`chip ${structureCategory === 'all' ? 'on' : ''}`} aria-pressed={structureCategory === 'all'} onClick={() => goStructure('all')}>すべて <span className="chip-n">{items.length}</span></button>
        {(Object.keys(CAT_LABEL) as StructureCategory[]).map((c) => (
          <button key={c} className={`chip ${structureCategory === c ? 'on' : ''}`} aria-pressed={structureCategory === c} disabled={!counts.get(c)} onClick={() => goStructure(c)}>
            {CAT_LABEL[c]} <span className="chip-n">{counts.get(c) ?? 0}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="empty">この種別の項目は検出されませんでした。<br /><span className="small">ダッシュボードの「検査範囲」で検査対象を確認できます。</span></div>
      ) : (
        <div className="findings-wrap">
          <div className="srow fhead" aria-hidden="true"><span>種別</span><span>名称</span><span>シート</span><span>対象番地</span><span>検出根拠</span></div>
          <VirtualList ariaLabel="構造情報の一覧" count={list.length} rowHeight={44} render={(i) => {
            const x = list[i];
            const cellAddr = x.address && /^[A-Z]+\d+$/.test(x.address) ? x.address : null;
            return (
              <div role="listitem" key={i}>
                <div className="srow" style={{ height: 44 }}>
                  <span>{CAT_LABEL[x.category]}</span>
                  <span className="clip" title={x.name}>{x.name}</span>
                  <span className="clip">{x.sheet ?? '—'}</span>
                  <span className="mono">
                    {cellAddr && x.sheet && loaded.sheets.has(x.sheet)
                      ? <button className="link mono" onClick={() => goCell(x.sheet!, cellAddr)} title="シートエクスプローラーで開く">{cellAddr}</button>
                      : (x.address ?? '—')}
                  </span>
                  <span className="mono clip2" title={x.evidence}>{x.evidence}</span>
                </div>
              </div>
            );
          }} />
        </div>
      )}
    </div>
  );
}
