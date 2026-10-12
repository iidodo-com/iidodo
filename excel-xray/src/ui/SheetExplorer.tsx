import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addr, cellKey, colToLetters, parseAddr } from '../core/address';
import { KIND_LABEL, SEVERITY_ORDER, type CellData, type Finding, type FindingKind, type Severity } from '../core/types';
import { useApp, type SheetView } from './ctx';
import { cellText, TYPE_LABEL } from './format';
import { VirtualList } from './VirtualList';

const ROW_H = 24;
const COL_W = 116;
const HEAD_W = 56;
const HEAD_H = 26;
const MAX_ROWS = 1048576;
const MAX_COLS = 16384;

function worstSeverity(fs: Finding[] | undefined): Severity | null {
  if (!fs || !fs.length) return null;
  return fs.reduce<Severity>((w, f) => (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[w] ? f.severity : w), 'info');
}

export function SheetExplorer() {
  const { loaded } = useApp();
  return loaded ? <SheetExplorerInner /> : null;
}

function SheetExplorerInner() {
  const { loaded, currentSheet, selection, select, focusRequest } = useApp();
  const [query, setQuery] = useState('');
  const [onlyFormula, setOnlyFormula] = useState(false);
  const [onlyWarn, setOnlyWarn] = useState(false);
  const [kind, setKind] = useState<FindingKind | 'all'>('all');
  const [allSheets, setAllSheets] = useState(false);
  if (!loaded || !currentSheet) return null;
  const view = loaded.sheets.get(currentSheet);
  if (!view) return <div className="pad">シートが見つかりません。</div>;

  const filtering = query.trim() !== '' || onlyFormula || onlyWarn || kind !== 'all';
  const selected = selection.sheet === currentSheet ? selection.address : undefined;

  const kinds = useMemo(() => {
    const s = new Set<FindingKind>();
    for (const f of loaded.analysis.findings) if (f.sheet === currentSheet) s.add(f.kind);
    return [...s];
  }, [loaded, currentSheet]);

  return (
    <div className="page fill">
      <h2 className="page-title">シートエクスプローラー <span className="crumb">{currentSheet}</span></h2>
      <div className="sheet-info">
        <span>表示状態: <b>{view.sheet.state === 'visible' ? '表示' : view.sheet.state === 'hidden' ? '非表示' : 'Very Hidden'}</b></span>
        <span>使用範囲: <b className="mono">{view.sheet.usedRange ?? 'なし'}</b></span>
        <span>数式: <b>{view.sheet.formulaCount}</b></span>
        <span>値のあるセル: <b>{view.sheet.valueCount}</b></span>
        <span>非表示: <b>{view.sheet.hiddenRows.length}行 / {view.sheet.hiddenCols.length}列</b></span>
      </div>
      <div className="filters" role="search">
        <label className="grow">検索
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="セル番地・文字列・数式・警告種別（例: D6 / 売上 / SUM / 数式エラー）" />
        </label>
        <label className="check"><input type="checkbox" checked={onlyFormula} onChange={(e) => setOnlyFormula(e.target.checked)} />数式のみ</label>
        <label className="check"><input type="checkbox" checked={onlyWarn} onChange={(e) => setOnlyWarn(e.target.checked)} />警告ありのみ</label>
        <label>警告種別
          <select value={kind} onChange={(e) => setKind(e.target.value as FindingKind | 'all')}>
            <option value="all">すべて</option>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={allSheets} onChange={(e) => setAllSheets(e.target.checked)} />全シートを検索</label>
        {filtering && <button className="btn small" onClick={() => { setQuery(''); setOnlyFormula(false); setOnlyWarn(false); setKind('all'); }}>絞り込みを解除して表に戻る</button>}
      </div>
      {filtering ? (
        <SearchResults query={query} onlyFormula={onlyFormula} onlyWarn={onlyWarn} kind={kind} allSheets={allSheets} />
      ) : (
        <Grid key={currentSheet} view={view} selected={selected} onSelect={(a) => select({ sheet: currentSheet, address: a })} focus={focusRequest?.sheet === currentSheet ? focusRequest : null} />
      )}
    </div>
  );
}

function Grid({ view, selected, onSelect, focus }: {
  view: SheetView; selected?: string; onSelect: (a: string) => void; focus: { address: string; nonce: number } | null;
}) {
  const { loaded } = useApp();
  const scroller = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, w: 800, h: 400 });
  const rows = Math.min(view.sheet.maxRow + 30, MAX_ROWS);
  const cols = Math.min(view.sheet.maxCol + 6, MAX_COLS);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (el) setPos({ top: el.scrollTop, left: el.scrollLeft, w: el.clientWidth, h: el.clientHeight });
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    onScroll();
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onScroll]);

  const reveal = useCallback((r: number, c: number) => {
    const el = scroller.current;
    if (!el) return;
    const y = (r - 1) * ROW_H, x = (c - 1) * COL_W;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight;
    if (x < el.scrollLeft) el.scrollLeft = x;
    else if (x + COL_W > el.scrollLeft + el.clientWidth) el.scrollLeft = x + COL_W - el.clientWidth;
  }, []);

  useEffect(() => {
    if (!focus) return;
    const p = parseAddr(focus.address);
    if (!p || !scroller.current) return;
    const el = scroller.current;
    el.scrollTop = Math.max(0, (p.r - 4) * ROW_H);
    el.scrollLeft = Math.max(0, (p.c - 3) * COL_W);
  }, [focus?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const r0 = Math.max(1, Math.floor(pos.top / ROW_H) - 3);
  const r1 = Math.min(rows, Math.ceil((pos.top + pos.h) / ROW_H) + 3);
  const c0 = Math.max(1, Math.floor(pos.left / COL_W) - 2);
  const c1 = Math.min(cols, Math.ceil((pos.left + pos.w) / COL_W) + 2);

  const cells: ReactElement[] = [];
  const sel = selected ? parseAddr(selected) : null;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = view.cells.get(cellKey(r, c));
      const a = addr(r, c);
      const fs = loaded?.findingsByCell.get(`${view.sheet.name}!${a}`);
      const worst = worstSeverity(fs);
      const isSel = sel?.r === r && sel?.c === c;
      const hidden = view.hiddenRows.has(r) || view.hiddenCols.has(c);
      const txt = cell ? (cell.f !== undefined && !cell.cached ? '(未保存)' : cellText(cell)) : '';
      cells.push(
        <div
          key={`${r}:${c}`} role="gridcell" aria-selected={isSel}
          className={`gc ${cell?.f !== undefined ? 'fx' : ''} ${cell?.t === 'error' ? 'err' : ''} ${cell && (cell.t === 'number') ? 'num' : ''} ${worst ? 'w-' + worst : ''} ${isSel ? 'sel' : ''} ${hidden ? 'hid' : ''}`}
          style={{ left: (c - 1) * COL_W, top: (r - 1) * ROW_H, width: COL_W, height: ROW_H }}
          onClick={() => onSelect(a)}
          title={cell ? `${a}${cell.f !== undefined ? '  =' + cell.f : ''}` : a}
        >
          {cell?.f !== undefined && <i className="fxmark" aria-hidden="true">ƒ</i>}
          <span>{txt}</span>
        </div>,
      );
    }
  }
  const colHeads: ReactElement[] = [];
  for (let c = c0; c <= c1; c++) {
    colHeads.push(<div key={c} className={`gh ${view.hiddenCols.has(c) ? 'hid' : ''} ${sel?.c === c ? 'cur' : ''}`} style={{ left: (c - 1) * COL_W, width: COL_W }}>{colToLetters(c)}{view.hiddenCols.has(c) ? ' ⊘' : ''}</div>);
  }
  const rowHeads: ReactElement[] = [];
  for (let r = r0; r <= r1; r++) {
    rowHeads.push(<div key={r} className={`gh ${view.hiddenRows.has(r) ? 'hid' : ''} ${sel?.r === r ? 'cur' : ''}`} style={{ top: (r - 1) * ROW_H, height: ROW_H }}>{r}{view.hiddenRows.has(r) ? '⊘' : ''}</div>);
  }

  const onKey = (e: React.KeyboardEvent) => {
    const cur = sel ?? { r: 1, c: 1 };
    let { r, c } = cur;
    switch (e.key) {
      case 'ArrowDown': r++; break;
      case 'ArrowUp': r--; break;
      case 'ArrowLeft': c--; break;
      case 'ArrowRight': c++; break;
      case 'PageDown': r += 20; break;
      case 'PageUp': r -= 20; break;
      case 'Home': c = 1; break;
      default: return;
    }
    e.preventDefault();
    r = Math.max(1, Math.min(rows, r));
    c = Math.max(1, Math.min(cols, c));
    onSelect(addr(r, c));
    reveal(r, c);
  };

  return (
    <div className="gridbox" role="grid" aria-label={`${view.sheet.name} のセル表`} aria-rowcount={rows} aria-colcount={cols}>
      <div className="grid-corner" style={{ width: HEAD_W, height: HEAD_H }}>
        <small>⊘=非表示</small>
      </div>
      <div className="grid-colheads" style={{ left: HEAD_W, height: HEAD_H }}>
        <div style={{ position: 'relative', width: cols * COL_W, height: HEAD_H, transform: `translateX(${-pos.left}px)` }}>{colHeads}</div>
      </div>
      <div className="grid-rowheads" style={{ top: HEAD_H, width: HEAD_W }}>
        <div style={{ position: 'relative', height: rows * ROW_H, width: HEAD_W, transform: `translateY(${-pos.top}px)` }}>{rowHeads}</div>
      </div>
      <div className="grid-body" ref={scroller} style={{ left: HEAD_W, top: HEAD_H }} onScroll={onScroll} onKeyDown={onKey} tabIndex={0}
        aria-label="セルを矢印キーで移動できます">
        <div style={{ position: 'relative', width: cols * COL_W, height: rows * ROW_H }}>{cells}</div>
      </div>
    </div>
  );
}

function SearchResults({ query, onlyFormula, onlyWarn, kind, allSheets }: {
  query: string; onlyFormula: boolean; onlyWarn: boolean; kind: FindingKind | 'all'; allSheets: boolean;
}) {
  const { loaded, currentSheet, select, goCell, selection } = useApp();
  const LIMIT = 5000;
  const { rows, truncated } = useMemo(() => {
    if (!loaded) return { rows: [] as Array<{ sheet: string; cell: CellData; fs: Finding[] }>, truncated: false };
    const q = query.trim().toLowerCase();
    const out: Array<{ sheet: string; cell: CellData; fs: Finding[] }> = [];
    let trunc = false;
    const targets = allSheets ? [...loaded.sheets.values()] : [loaded.sheets.get(currentSheet!)!];
    outer: for (const v of targets) {
      for (const cell of v.sheet.cells) {
        if (onlyFormula && cell.f === undefined) continue;
        const a = addr(cell.r, cell.c);
        const fs = loaded.findingsByCell.get(`${v.sheet.name}!${a}`) ?? [];
        if (onlyWarn && fs.length === 0) continue;
        if (kind !== 'all' && !fs.some((f) => f.kind === kind)) continue;
        if (q) {
          const hit = a.toLowerCase() === q || a.toLowerCase().startsWith(q) && /\d/.test(q)
            || cellText(cell).toLowerCase().includes(q)
            || (cell.f ?? '').toLowerCase().includes(q)
            || fs.some((f) => KIND_LABEL[f.kind].toLowerCase().includes(q) || f.title.toLowerCase().includes(q));
          if (!hit) continue;
        }
        out.push({ sheet: v.sheet.name, cell, fs });
        if (out.length >= LIMIT) { trunc = true; break outer; }
      }
    }
    return { rows: out, truncated: trunc };
  }, [loaded, query, onlyFormula, onlyWarn, kind, allSheets, currentSheet]);

  if (rows.length === 0) return <div className="empty">条件に一致するセルはありません。</div>;
  return (
    <div className="findings-wrap">
      <div className="small pad-s">{rows.length}{truncated ? '+' : ''} 件{truncated ? `（上限 ${LIMIT} 件で打ち切り。条件を絞ってください）` : ''}</div>
      <div className="crow fhead" aria-hidden="true"><span>シート</span><span>セル</span><span>型</span><span>保存値</span><span>数式</span><span>警告</span></div>
      <VirtualList ariaLabel="検索結果" count={rows.length} rowHeight={32} render={(i) => {
        const x = rows[i];
        const a = addr(x.cell.r, x.cell.c);
        const isSel = selection.sheet === x.sheet && selection.address === a;
        return (
          <div role="listitem" key={`${x.sheet}!${a}`}>
            <button className={`crow ${isSel ? 'selected' : ''}`} style={{ height: 32 }}
              onClick={() => (allSheets ? goCell(x.sheet, a) : select({ sheet: x.sheet, address: a }))}>
              <span className="clip">{x.sheet}</span><span className="mono">{a}</span>
              <span>{TYPE_LABEL[x.cell.t]}</span><span className="clip">{x.cell.f !== undefined && !x.cell.cached ? '(未保存)' : cellText(x.cell)}</span>
              <span className="mono clip">{x.cell.f !== undefined ? '=' + x.cell.f : ''}</span>
              <span className="clip">{x.fs.map((f) => KIND_LABEL[f.kind]).join(' / ')}</span>
            </button>
          </div>
        );
      }} />
    </div>
  );
}
