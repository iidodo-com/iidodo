"""モックプロバイダ: ランダムウォークの疑似ティック。取引時間のスケジュール(前場→昼休み→後場)を再現する。

clock: virtual … 仮想時計。日本時間 08:59:50 から speed 倍速で進め、前場・昼休み・後場・大引けを再現し、
                 大引け後は次の営業日の寄付き前へ進んで繰り返す（市場が閉まっている時間帯でも開発できる）。
clock: real    … 実時間。取引時間内だけティックを出す（時間外は何も出さない）。
各セッション終了時刻ちょうど(11:30:00 / 15:30:00)に締めの約定を1本出す。
配信VWAP(vendor_vwap)として「約定ベースの真のVWAP」を付けるので、足ベースの自前VWAPとの乖離ログの検証にも使える。
"""
from __future__ import annotations

import asyncio
import datetime as dt
import random
import time
from typing import AsyncIterator

from core.session import SessionClock, jst_epoch, to_jst
from .base import Capabilities, DataProvider, Tick


class _Sym:
    def __init__(self, base: float, rng: random.Random) -> None:
        self.base = base
        self.price = base
        self.prev_close = base
        self.cum_volume = 0.0
        self.cum_value = 0.0
        self.trend = rng.uniform(-1, 1)
        self.next_t = 0.0


class MockProvider(DataProvider):
    name = "mock"
    capabilities = Capabilities(history=False, max_symbols=None, history_adjusted=None, pushes_every_trade=True,
                                description="疑似ティック生成（ランダムウォーク）")

    def __init__(self, cfg: dict, clock: SessionClock, seed: int | None = None,
                 after_date: dt.date | None = None) -> None:
        super().__init__()
        m = cfg.get("mock", {})
        self.clock = clock
        self.mode = m.get("clock", "virtual")
        self.speed = float(m.get("speed", 60)) if self.mode == "virtual" else 1.0
        self.gap = float(m.get("mean_tick_gap_s", 3.0))
        self.rng = random.Random(seed if seed is not None else m.get("seed"))
        self.bases = {s["code"]: float(s.get("mock_base_price", 1000)) for s in cfg.get("symbols", [])}
        self._t0 = time.monotonic()
        self._after = after_date           # virtualでは、DBに記録済みの日より後の営業日から始める（既存記録を混ぜない）
        self._vbase = self._start_of_day(time.time())

    # ---- 時計 ----
    def _start_of_day(self, ref_ts: float) -> float:
        d = to_jst(ref_ts).date()
        if not self.clock.calendar.is_trading_day(d):
            d = self.clock.calendar.prev_trading_day(d)
        if self.mode == "virtual" and self._after is not None and d <= self._after:
            d = self.clock.calendar.next_trading_day(self._after)
        return jst_epoch(d, dt.time(8, 59, 50))

    def now(self) -> float:
        if self.mode == "real":
            return time.time()
        return self._vbase + (time.monotonic() - self._t0) * self.speed

    def _next_day(self) -> None:
        d = self.clock.calendar.next_trading_day(to_jst(self.now()).date())
        self._vbase = jst_epoch(d, dt.time(8, 59, 50))
        self._t0 = time.monotonic()

    # ---- 生成 ----
    def _make_tick(self, code: str, s: _Sym, t: float) -> Tick:
        mu = 0.00004 * s.trend
        s.price *= 1.0 + self.rng.gauss(mu, 0.0004)
        if self.rng.random() < 0.01:
            s.trend = self.rng.uniform(-1.5, 1.5)             # たまにトレンド転換 → クロス等のイベントが出る
        s.price = max(s.price, 1.0)
        price = round(s.price, 1) if s.price < 1000 else float(round(s.price))
        qty = 100 * self.rng.randint(1, 30)
        if self.rng.random() < 0.03:
            qty *= 10
        s.cum_volume += qty
        s.cum_value += qty * price
        return Tick(code, t, price, s.cum_volume, s.cum_value, s.cum_value / s.cum_volume, s.prev_close)

    async def stream(self, symbols: list[str]) -> AsyncIterator[Tick]:
        self.status = "connected"
        syms = {c: _Sym(self.bases.get(c, 1000.0 + hash(c) % 3000), self.rng) for c in symbols}
        t_prev = self.now()
        for s in syms.values():
            s.next_t = t_prev + self.rng.expovariate(1 / self.gap)
        boundaries = lambda d: [jst_epoch(d, self.clock.m_end), jst_epoch(d, self.clock.a_end)]  # noqa: E731
        while True:
            await asyncio.sleep(0.05)
            t_cur = self.now()
            d = to_jst(t_cur).date()
            trading_day = self.clock.calendar.is_trading_day(d)
            for code, s in syms.items():
                while trading_day and s.next_t <= t_cur:
                    t = s.next_t
                    s.next_t = t + self.rng.expovariate(1 / self.gap)
                    if self.clock.session_of_tick(t) is not None:     # 昼休み・寄付き前・大引け後は出さない
                        yield self._make_tick(code, s, t)
                if not trading_day:
                    s.next_t = t_cur + 60
                # 締めの約定（11:30:00 / 15:30:00 ちょうど）
                if trading_day:
                    for b in boundaries(d):
                        if t_prev < b <= t_cur:
                            yield self._make_tick(code, s, b)
            t_prev = t_cur
            # 大引け後しばらくしたら次の営業日へ（virtualのみ）
            if self.mode == "virtual" and t_cur > jst_epoch(d, self.clock.a_end) + 120:
                for code, s in syms.items():
                    s.prev_close = round(s.price, 1) if s.price < 1000 else float(round(s.price))
                    s.cum_volume = s.cum_value = 0.0
                self._next_day()
                t_prev = self.now()
                for s in syms.values():
                    s.next_t = t_prev + self.rng.expovariate(1 / self.gap)
