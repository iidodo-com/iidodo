"""リプレイプロバイダ: SQLite(data/market.db)に記録済みのティックを、速度倍率を指定して再生する。
市場が閉まっている時間帯でも開発・テストできる。再生中のデータ上の時刻は now() で取得できる（仮想時計）。
"""
from __future__ import annotations

import asyncio
import datetime as dt
from typing import AsyncIterator, Optional

from core.session import jst_epoch, to_jst
from core.store import Store
from .base import Capabilities, DataProvider, Tick


class ReplayProvider(DataProvider):
    name = "replay"
    capabilities = Capabilities(history=False, max_symbols=None, pushes_every_trade=None,
                                description="記録済みティックの再生")

    def __init__(self, cfg: dict, store: Store) -> None:
        super().__init__()
        r = cfg.get("replay", {})
        self.store = store
        self.source = r.get("source", "mock")
        self.speed = max(float(r.get("speed", 10)), 0.01)
        self.date = r.get("date")
        self.max_gap = float(r.get("max_real_gap_s", 2.0))
        self._vnow = 0.0
        self.finished = False
        self.day: Optional[dt.date] = None

    def now(self) -> float:
        return self._vnow

    def _resolve_day(self) -> Optional[dt.date]:
        if self.date:
            return dt.date.fromisoformat(str(self.date))
        rows = self.store.query("SELECT MAX(ts) m FROM ticks WHERE source=?", (self.source,))
        if not rows or rows[0]["m"] is None:
            return None
        return to_jst(rows[0]["m"]).date()

    async def stream(self, symbols: list[str]) -> AsyncIterator[Tick]:
        self.day = self._resolve_day()
        if self.day is None:
            self.status = "disconnected"
            raise RuntimeError(f"リプレイ対象のティックがありません (source={self.source})。先に mock/kabu で記録してください。")
        lo, hi = jst_epoch(self.day, dt.time(0, 0)), jst_epoch(self.day, dt.time(0, 0)) + 86400
        marks = ",".join("?" for _ in symbols)
        self.status = "connected"
        last_t: Optional[float] = None
        cursor = lo
        while cursor < hi:
            rows = self.store.query(
                f"SELECT * FROM ticks WHERE source=? AND symbol IN ({marks}) AND ts>=? AND ts<? ORDER BY ts, rowid LIMIT 5000",
                (self.source, *symbols, cursor, hi))
            if not rows:
                break
            for r in rows:
                if last_t is not None and r["ts"] > last_t:
                    await asyncio.sleep(min((r["ts"] - last_t) / self.speed, self.max_gap))
                else:
                    await asyncio.sleep(0)
                last_t = r["ts"]
                self._vnow = r["ts"]
                yield Tick(r["symbol"], r["ts"], r["price"], r["cum_volume"], r["cum_value"], r["vendor_vwap"], r["prev_close"])
            if len(rows) < 5000:
                break
            cursor = rows[-1]["ts"] + 1e-6   # 同一tsが5000件境界をまたぐ極端なケースは許容(未対応)
        self.finished = True
        self.status = "finished"
