"""イベント検出と事後検証用の記録（売買の推奨ではない）。

検出するイベント:
  1. vwap_cross_up / vwap_cross_down : 価格(ティック)が VWAP を上抜け/下抜け（形成中の1分足を含むVWAPと比較）
  2. ema_golden / ema_dead          : EMA(fast)とEMA(slow)のクロス（確定した1分足の終値で判定）
  3. bb_lower_K / bb_upper_K        : 確定した1分足の終値が BB -Kσ を下回った/+Kσ を上回った（内側→外側に出た最初の足）
各イベントについて、発生後 N 分(取引時間内の経過分。昼休みは数えない)の価格変化率を自動で埋める。
  変化率(%) = (N分後の価格 ÷ イベント時の価格 − 1) × 100   ※スプレッド・手数料は含まない / 売買方向では符号反転しない
"""
from __future__ import annotations

import bisect
import datetime as dt
import logging
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

import pandas as pd

from . import indicators as ind
from .indicators import IndicatorParams, group_key, make_frame
from .session import SessionClock, jst_epoch, to_jst
from .store import HORIZON_COLS, Store

log = logging.getLogger("events")


def _fmt(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


def event_label(etype: str, ema_fast: int = 9, ema_slow: int = 21) -> str:
    base = {
        "vwap_cross_up": "VWAP上抜け", "vwap_cross_down": "VWAP下抜け",
        "ema_golden": f"EMA{ema_fast}がEMA{ema_slow}を上抜け(GC)", "ema_dead": f"EMA{ema_fast}がEMA{ema_slow}を下抜け(DC)",
    }
    if etype in base:
        return base[etype]
    if etype.startswith("bb_lower_"):
        return f"1分足終値が BB −{etype[9:]}σ を下回る"
    if etype.startswith("bb_upper_"):
        return f"1分足終値が BB +{etype[9:]}σ を上回る"
    return etype


@dataclass
class _Pending:
    id: int
    symbol: str
    ts: float
    price: float
    todo: set = field(default_factory=set)


class EventEngine:
    def __init__(self, cfg: dict, clock: SessionClock, store: Optional[Store], source: str,
                 split_dates: Callable[[str], Sequence] = lambda s: ()) -> None:
        ev = cfg.get("events", {})
        self.clock, self.store, self.source = clock, store, source
        self.split_dates = split_dates
        self.horizons = [int(h) for h in ev.get("horizons_min", [1, 3, 5, 10]) if int(h) in HORIZON_COLS]
        self.ema_fast, self.ema_slow = int(ev.get("ema_fast", 9)), int(ev.get("ema_slow", 21))
        base = IndicatorParams.from_config(cfg.get("indicators", {}), cfg.get("split_guard", True))
        self.sigmas = tuple(float(x) for x in ev.get("bb_sigmas", [1.0, 2.0]))
        from dataclasses import replace
        self.params = replace(base, sma=(), ema=(self.ema_fast, self.ema_slow), bb_period=int(ev.get("bb_period", 20)),
                              bb_sigmas=self.sigmas, ddof=int(ev.get("bb_ddof", 0)))
        self._vwap_side: dict[str, tuple] = {}       # symbol -> (group_key, side)
        self._last_bar_eval: dict[str, int] = {}
        self._hist_ts: dict[str, list[float]] = {}
        self._hist_px: dict[str, list[float]] = {}
        self._pending: dict[int, _Pending] = {}

    # ---------- VWAP（足の一覧から現在のVWAPを求める。indicators.vwap と同じ規則） ----------
    def current_vwap(self, symbol: str, bars: Sequence) -> Optional[float]:
        if not bars:
            return None
        p = self.params
        j = to_jst(bars[-1].t)
        lo = jst_epoch(j.date(), dt.time(0, 0))          # VWAPは日ごとにリセット（グループは日内なので分割日の影響なし）
        if p.vwap_reset_afternoon and j.time() >= p.afternoon_from:
            lo = jst_epoch(j.date(), p.afternoon_from)   # 後場でリセットする設定
        pv = vv = 0.0
        for b in reversed(bars):
            if b.t < lo:
                break
            pv += (b.h + b.l + b.c) / 3.0 * b.v
            vv += b.v
        return pv / vv if vv > 0 else None

    # ---------- ティック ----------
    def on_tick(self, symbol: str, ts: float, price: float, bars_1m: Sequence) -> list[dict]:
        self._record_price(symbol, ts, price)
        out = []
        v = self.current_vwap(symbol, bars_1m)
        if v is None:
            return out
        side = 1 if price > v else -1 if price < v else 0
        p = self.params
        k = group_key(ts, by_day=True, by_session=p.vwap_reset_afternoon, split_dates=self.split_dates(symbol),
                      afternoon_from=p.afternoon_from, split_guard=p.split_guard)
        prev = self._vwap_side.get(symbol)
        if side == 0:
            if prev is None or prev[0] != k:
                self._vwap_side[symbol] = (k, 0)
            return out
        if prev is not None and prev[0] == k and prev[1] != 0 and prev[1] != side:
            out.append(self._emit(symbol, "vwap_cross_up" if side > 0 else "vwap_cross_down", ts, price,
                                  self.clock.time_bucket(ts), {"vwap": round(v, 4)}))
        self._vwap_side[symbol] = (k, side)
        return out

    # ---------- 確定した1分足 ----------
    def on_bar_closed(self, symbol: str, bars_1m: Sequence) -> list[dict]:
        closed = [b for b in bars_1m if b.closed]
        if len(closed) < 2:
            return []
        last = closed[-1]
        if self._last_bar_eval.get(symbol) == last.t:
            return []
        self._last_bar_eval[symbol] = last.t
        df = make_frame(closed)
        res = ind.compute(df, self.params, self.split_dates(symbol))
        out = []
        ts_ev, bucket = last.t + 60, self.clock.time_bucket(last.t)
        f, s = res[f"ema_{self.ema_fast}"], res[f"ema_{self.ema_slow}"]
        d_prev, d_cur = f.iloc[-2] - s.iloc[-2], f.iloc[-1] - s.iloc[-1]
        if pd.notna(d_prev) and pd.notna(d_cur):
            detail = {"ema_fast": round(float(f.iloc[-1]), 4), "ema_slow": round(float(s.iloc[-1]), 4)}
            if d_prev <= 0 < d_cur:
                out.append(self._emit(symbol, "ema_golden", ts_ev, last.c, bucket, detail))
            elif d_prev >= 0 > d_cur:
                out.append(self._emit(symbol, "ema_dead", ts_ev, last.c, bucket, detail))
        c_cur, c_prev = df["c"].iloc[-1], df["c"].iloc[-2]
        for sg in self.sigmas:
            lo, up = res[f"bb_lo_{_fmt(sg)}"], res[f"bb_up_{_fmt(sg)}"]
            for name, ser, cmp in (("lower", lo, lambda c, b: c < b), ("upper", up, lambda c, b: c > b)):
                cur_b, prev_b = ser.iloc[-1], ser.iloc[-2]
                if pd.isna(cur_b) or not cmp(c_cur, cur_b):
                    continue
                if pd.notna(prev_b) and cmp(c_prev, prev_b):
                    continue            # 既に外側にいた（連続）→ 最初の足だけ記録
                out.append(self._emit(symbol, f"bb_{name}_{_fmt(sg)}", ts_ev, last.c, bucket,
                                      {"band": round(float(cur_b), 4), "sigma": sg, "ddof": self.params.ddof}))
        return out

    # ---------- 記録 ----------
    def _emit(self, symbol, etype, ts, price, bucket, detail) -> dict:
        eid = self.store.add_event(self.source, symbol, etype, ts, price, bucket, detail) if self.store else -1
        if eid >= 0:
            self._pending[eid] = _Pending(eid, symbol, ts, price, set(self.horizons))
        log.info("イベント %s %s ts=%s price=%s", symbol, etype, to_jst(ts).strftime("%H:%M:%S"), price)
        return {"id": eid, "symbol": symbol, "type": etype, "label": event_label(etype, self.ema_fast, self.ema_slow),
                "ts": ts, "price": price, "bucket": bucket}

    def _record_price(self, symbol: str, ts: float, price: float) -> None:
        tl, pl = self._hist_ts.setdefault(symbol, []), self._hist_px.setdefault(symbol, [])
        tl.append(ts)
        pl.append(price)
        if len(tl) > 40000:
            del tl[:20000], pl[:20000]

    def _price_at(self, symbol: str, target: float) -> Optional[float]:
        tl = self._hist_ts.get(symbol)
        if not tl:
            return None
        i = bisect.bisect_right(tl, target) - 1
        return self._hist_px[symbol][i] if i >= 0 else None

    # ---------- 事後の変化率を埋める ----------
    def fill_pending(self, data_now: float) -> int:
        """data_now(データ上の現在時刻)までに経過した分の変化率を埋める。まだ経過していないものは空欄のまま。"""
        n = 0
        for eid in list(self._pending):
            ev = self._pending[eid]
            for h in sorted(ev.todo):
                target = self.clock.add_trading_seconds(ev.ts, h * 60)
                if target is None:             # 大引けを超える → 値は付けない（集計の母数にも入らない）
                    ev.todo.discard(h)
                    continue
                if data_now < target:
                    continue
                px = self._price_at(ev.symbol, target)
                if px is None:
                    continue
                if self.store:
                    self.store.set_event_change(eid, h, (px / ev.price - 1.0) * 100.0)
                ev.todo.discard(h)
                n += 1
            if not ev.todo:
                del self._pending[eid]
        if n and self.store:
            self.store.commit()
        return n

    def backfill_from_db(self) -> int:
        """再起動前に作ったイベントのうち未記入の変化率を、DBのティックから埋める（replay以外）。"""
        if not self.store or self.source == "replay":
            return 0
        n = 0
        for r in self.store.unfilled_events(self.source):
            for h in self.horizons:
                col = HORIZON_COLS[h]
                if r[col] is not None:
                    continue
                target = self.clock.add_trading_seconds(r["ts"], h * 60)
                if target is None:
                    continue
                mx = self.store.query("SELECT MAX(ts) m FROM ticks WHERE source=? AND symbol=?", (self.source, r["symbol"]))
                if not mx or mx[0]["m"] is None or mx[0]["m"] < target:
                    continue
                px = self.store.query("SELECT price FROM ticks WHERE source=? AND symbol=? AND ts<=? ORDER BY ts DESC LIMIT 1",
                                      (self.source, r["symbol"], target))
                if px:
                    self.store.set_event_change(r["id"], h, (px[0]["price"] / r["price"] - 1.0) * 100.0)
                    n += 1
        self.store.commit()
        return n
