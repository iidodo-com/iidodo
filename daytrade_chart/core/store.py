"""SQLite 永続化（data/market.db）: ティック・確定足・イベント・VWAP検証。"""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Iterable, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS ticks(
  source TEXT NOT NULL, symbol TEXT NOT NULL, ts REAL NOT NULL, price REAL NOT NULL,
  cum_volume REAL, cum_value REAL, vendor_vwap REAL, prev_close REAL);
CREATE INDEX IF NOT EXISTS ix_ticks ON ticks(source, symbol, ts);
CREATE TABLE IF NOT EXISTS bars(
  source TEXT NOT NULL, symbol TEXT NOT NULL, interval INTEGER NOT NULL, t INTEGER NOT NULL,
  o REAL, h REAL, l REAL, c REAL, v REAL, gap INTEGER DEFAULT 0,
  PRIMARY KEY(source, symbol, interval, t));
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, symbol TEXT NOT NULL,
  type TEXT NOT NULL, ts REAL NOT NULL, price REAL NOT NULL, bucket TEXT, detail TEXT,
  chg_1 REAL, chg_3 REAL, chg_5 REAL, chg_10 REAL);
CREATE INDEX IF NOT EXISTS ix_events ON events(source, symbol, type, ts);
CREATE TABLE IF NOT EXISTS vwap_check(
  source TEXT NOT NULL, symbol TEXT NOT NULL, ts REAL NOT NULL, own_vwap REAL, vendor_vwap REAL, diff_pct REAL);
"""

# 変化率の列。horizons_min=[1,3,5,10] に対応（列は固定。別の分数を使う場合はスキーマ拡張が必要）
HORIZON_COLS = {1: "chg_1", 3: "chg_3", 5: "chg_5", 10: "chg_10"}


class Store:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.db.executescript(SCHEMA)
            self.db.commit()
        self._tick_buf: list[tuple] = []

    # ---- 書き込み ----
    def add_tick(self, source: str, t) -> None:
        self._tick_buf.append((source, t.symbol, t.timestamp, t.price, t.cum_volume, t.cum_value,
                               t.vendor_vwap, t.prev_close))
        if len(self._tick_buf) >= 200:
            self.flush()

    def flush(self) -> None:
        with self.lock:
            if self._tick_buf:
                self.db.executemany("INSERT INTO ticks VALUES (?,?,?,?,?,?,?,?)", self._tick_buf)
                self._tick_buf = []
            self.db.commit()

    def save_bar(self, source: str, symbol: str, interval: int, bar) -> None:
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO bars VALUES (?,?,?,?,?,?,?,?,?,?)",
                            (source, symbol, interval, bar.t, bar.o, bar.h, bar.l, bar.c, bar.v, int(bar.gap)))

    def add_event(self, source: str, symbol: str, etype: str, ts: float, price: float,
                  bucket: str, detail: Optional[dict] = None) -> int:
        with self.lock:
            cur = self.db.execute(
                "INSERT INTO events(source,symbol,type,ts,price,bucket,detail) VALUES (?,?,?,?,?,?,?)",
                (source, symbol, etype, ts, price, bucket, json.dumps(detail or {}, ensure_ascii=False)))
            self.db.commit()
            return cur.lastrowid

    def set_event_change(self, event_id: int, minutes: int, pct: float) -> None:
        col = HORIZON_COLS[minutes]
        with self.lock:
            self.db.execute(f"UPDATE events SET {col}=? WHERE id=?", (pct, event_id))

    def add_vwap_check(self, source, symbol, ts, own, vendor, diff_pct) -> None:
        with self.lock:
            self.db.execute("INSERT INTO vwap_check VALUES (?,?,?,?,?,?)", (source, symbol, ts, own, vendor, diff_pct))

    def commit(self) -> None:
        with self.lock:
            self.db.commit()

    # ---- 読み出し ----
    def query(self, sql: str, params: Iterable = ()) -> list[sqlite3.Row]:
        self.flush()
        with self.lock:
            return self.db.execute(sql, tuple(params)).fetchall()

    def unfilled_events(self, source: str) -> list[sqlite3.Row]:
        return self.query("SELECT * FROM events WHERE source=? AND (chg_1 IS NULL OR chg_3 IS NULL OR chg_5 IS NULL "
                          "OR chg_10 IS NULL)", (source,))

    def last_close_before(self, source: str, symbol: str, before_ts: float) -> Optional[float]:
        """before_ts より前の最後の確定1分足の終値（前日終値の代用: 記録済みデータから）。"""
        r = self.query("SELECT c FROM bars WHERE source=? AND symbol=? AND interval=60 AND t<? ORDER BY t DESC LIMIT 1",
                       (source, symbol, before_ts))
        return float(r[0]["c"]) if r else None

    def close(self) -> None:
        self.flush()
        with self.lock:
            self.db.close()
