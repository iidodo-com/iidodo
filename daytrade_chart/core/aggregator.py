"""ティック → 1分足/5分足 への集約。

ティック処理のルール:
- 出来高 = 累計出来高の差分。差分が負（累計リセット/異常値）なら出来高0・異常ログ、足は価格のみ更新。
- 同一時刻・同一累計の重複ティックは無視。
- 価格<=0、時刻の逆行、値幅制限を大きく外れる値は無視してログに残す。
- 初回ティック（基準なし）は出来高0（途中参加で巨大な出来高を作らないため）。日付が変わったら基準を0にリセット。
- 時間外（昼休み・寄付き前・大引け後・休場日）のティックは足を作らない（基準の更新のみ）。

※この足は、受信したスナップショットから作った近似値である（PUSHは全約定ではない可能性があり、
  取りこぼしがあるため、証券会社のチャートとは完全には一致しない）。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Optional

from providers.base import Tick
from .session import SessionClock, to_jst

log = logging.getLogger("aggregator")
anomaly_log = logging.getLogger("anomaly")


@dataclass
class Bar:
    t: int                 # 足の開始時刻（UTCエポック秒）
    o: float
    h: float
    l: float
    c: float
    v: float = 0.0
    n: int = 0             # 取り込んだティック数
    closed: bool = False
    gap: bool = False      # 欠損（再接続中などで取りこぼした可能性）

    def as_dict(self) -> dict:
        return {"t": self.t, "o": self.o, "h": self.h, "l": self.l, "c": self.c, "v": self.v,
                "closed": self.closed, "gap": self.gap}


@dataclass
class TickResult:
    accepted: bool
    reason: str = ""                       # 無視した理由
    volume: float = 0.0
    in_session: bool = False
    updated: list = field(default_factory=list)   # [(interval, Bar)] 更新(形成中)
    closed: list = field(default_factory=list)    # [(interval, Bar)] 今回確定した足


@dataclass
class _State:
    prev_cum: Optional[float] = None
    last_ts: Optional[float] = None
    last_cum: Optional[float] = None
    last_price: Optional[float] = None
    last_date: Optional[object] = None
    prev_close: Optional[float] = None
    pending_gap: bool = False


class Aggregator:
    def __init__(self, clock: SessionClock, intervals=(60, 300), max_price_deviation: float = 0.5,
                 max_bars: int = 6000) -> None:
        self.clock = clock
        self.intervals = tuple(intervals)
        self.max_dev = max_price_deviation
        self.max_bars = max_bars
        self.state: dict[str, _State] = {}
        self.bars: dict[str, dict[int, list[Bar]]] = {}

    # ---------- アクセサ ----------
    def _st(self, symbol: str) -> _State:
        if symbol not in self.state:
            self.state[symbol] = _State()
            self.bars[symbol] = {i: [] for i in self.intervals}
        return self.state[symbol]

    def set_prev_close(self, symbol: str, price: Optional[float]) -> None:
        if price and price > 0:
            self._st(symbol).prev_close = float(price)

    def get_prev_close(self, symbol: str) -> Optional[float]:
        return self._st(symbol).prev_close

    def get_bars(self, symbol: str, interval: int) -> list[Bar]:
        self._st(symbol)
        return self.bars[symbol][interval]

    def load_bars(self, symbol: str, interval: int, bars: list[Bar]) -> None:
        """過去の確定足（履歴APIまたはDB）を先頭に読み込む。"""
        self._st(symbol)
        self.bars[symbol][interval] = sorted(bars, key=lambda b: b.t) + self.bars[symbol][interval]

    # ---------- 中核 ----------
    def on_tick(self, tick: Tick) -> TickResult:
        sym = tick.symbol
        st = self._st(sym)
        ts, price = tick.timestamp, tick.price

        if price is None or price <= 0:
            anomaly_log.warning("無視: 価格が0以下 %s ts=%s price=%s", sym, ts, price)
            return TickResult(False, "price<=0")
        if st.last_ts is not None and ts < st.last_ts:
            anomaly_log.warning("無視: 時刻の逆行 %s ts=%s < last=%s", sym, ts, st.last_ts)
            return TickResult(False, "time_regress")
        if st.last_ts is not None and ts == st.last_ts and tick.cum_volume == st.last_cum:
            return TickResult(False, "duplicate")
        ref = st.prev_close or st.last_price
        if ref and abs(price / ref - 1.0) > self.max_dev:
            anomaly_log.warning("無視: 値幅が大きすぎる %s price=%s ref=%s (>%.0f%%)", sym, price, ref, self.max_dev * 100)
            return TickResult(False, "price_out_of_range")
        if tick.prev_close:
            st.prev_close = float(tick.prev_close)

        # ---- 出来高（累計の差分）----
        d = to_jst(ts).date()
        if st.last_date is not None and d != st.last_date:
            st.prev_cum = 0.0          # 日付が変わった → 累計は0から数え直し
        if st.prev_cum is None:
            vol = 0.0                  # 基準なし(途中参加) → 基準だけ設定
        else:
            diff = tick.cum_volume - st.prev_cum
            if diff < 0:
                anomaly_log.warning("累計出来高が減少 %s %s -> %s: 出来高0として扱い、価格のみ更新", sym, st.prev_cum, tick.cum_volume)
                vol = 0.0
            else:
                vol = float(diff)
        st.prev_cum = tick.cum_volume
        st.last_cum = tick.cum_volume
        st.last_ts = ts
        st.last_price = price
        st.last_date = d

        res = TickResult(True, volume=vol)
        if self.clock.session_of_tick(ts) is None:
            return res                  # 時間外: 足は作らない
        res.in_session = True

        for itv in self.intervals:
            b0 = self.clock.bar_time(ts, itv)
            bars = self.bars[sym][itv]
            cur = bars[-1] if bars else None
            if cur is not None and cur.t == b0:
                cur.closed = False      # 遅延ティックで確定済みの足に追記された場合は再オープン
                cur.h = max(cur.h, price)
                cur.l = min(cur.l, price)
                cur.c = price
                cur.v += vol
                cur.n += 1
            else:
                if cur is not None and not cur.closed:
                    cur.closed = True
                    res.closed.append((itv, cur))
                cur = Bar(b0, price, price, price, price, vol, 1, gap=st.pending_gap)
                bars.append(cur)
                if len(bars) > self.max_bars:
                    del bars[: len(bars) - self.max_bars]
            res.updated.append((itv, cur))
        st.pending_gap = False
        return res

    def close_until(self, now: float) -> list:
        """now 時点で終了している形成中の足を確定する（昼休み・大引け後の確定用）。[(symbol, interval, Bar)]"""
        out = []
        for sym, per in self.bars.items():
            for itv, bars in per.items():
                if bars and not bars[-1].closed and bars[-1].t + itv <= now:
                    bars[-1].closed = True
                    out.append((sym, itv, bars[-1]))
        return out

    def mark_gap(self, start_ts: float, end_ts: float) -> None:
        """[start_ts, end_ts] に受信が途切れた。重なる足と、次に作る足に欠損の印を付ける。"""
        for sym, per in self.bars.items():
            for itv, bars in per.items():
                for b in bars[-3:]:
                    if b.t + itv > start_ts and b.t < end_ts:
                        b.gap = True
            self.state[sym].pending_gap = True
