import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  count: number;
  rowHeight: number;
  height?: number | string;
  overscan?: number;
  render: (index: number) => ReactNode;
  header?: ReactNode;
  className?: string;
  ariaLabel?: string;
  /** このindexが見えるようにスクロールする */
  scrollToIndex?: number | null;
}

/** 固定行高の縦方向仮想スクロール。表示範囲の行だけをDOMに描画する。 */
export function VirtualList({ count, rowHeight, height = '100%', overscan = 6, render, header, className, ariaLabel, scrollToIndex }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [vh, setVh] = useState(400);

  const onScroll = useCallback(() => { if (ref.current) setTop(ref.current.scrollTop); }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setVh(el.clientHeight);
    const ro = new ResizeObserver(() => setVh(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (scrollToIndex != null && ref.current) {
      const y = scrollToIndex * rowHeight;
      const el = ref.current;
      if (y < el.scrollTop || y + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, y - rowHeight * 2);
    }
  }, [scrollToIndex, rowHeight]);

  const start = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((top + vh) / rowHeight) + overscan);
  const rows: ReactNode[] = [];
  for (let i = start; i < end; i++) rows.push(render(i));
  return (
    <div ref={ref} className={`vlist ${className ?? ''}`} style={{ height }} onScroll={onScroll} role="list" aria-label={ariaLabel} tabIndex={0}>
      {header}
      <div style={{ height: count * rowHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: start * rowHeight, left: 0, right: 0 }}>{rows}</div>
      </div>
    </div>
  );
}
