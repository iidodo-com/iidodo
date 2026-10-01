"""日本株デイトレ用リアルタイムチャート（閲覧・記録専用）。注文・売買機能は無い。

起動: uvicorn main:app --port 8000   （または python main.py）
データの流れ: Provider.stream → Aggregator(1m/5m) → Indicators → EventEngine → SQLite → /ws で配信
"""
from __future__ import annotations

import asyncio
import csv
import datetime as dt
import io
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import Optional

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from core import indicators as ind
from core.aggregator import Aggregator, Bar
from core.config import BASE_DIR, load_config, resolve_path
from core.events import EventEngine, event_label
from core.indicators import IndicatorParams, make_frame
from core.logging_setup import setup_logging
from core.session import JST, SessionClock, SessionState, to_jst
from core.store import Store
from providers import create_provider
from providers.base import Tick

log = logging.getLogger("main")
INTERVALS = {"1m": 60, "5m": 300}
DISPLAY_OFFSET = 9 * 3600     # Lightweight Charts はUTC表示のため、+9h して日本時間の時計で表示する
MAX_INDICATOR_ROWS = 2500


def _jst_str(ts: float) -> str:
    return to_jst(ts).strftime("%Y-%m-%d %H:%M:%S")


class Conn:
    def __init__(self, ws: WebSocket, symbol: str, params: IndicatorParams) -> None:
        self.ws, self.symbol, self.interval, self.params = ws, symbol, "1m", params
        self.need_snapshot = True
        self.dirty = False
        self.last_status = 0.0


class App:
    def __init__(self, cfg: dict) -> None:
        self.cfg = cfg
        self.clock = SessionClock.from_config(cfg)
        self.store = Store(resolve_path(cfg, "db_path"))
        self.symbols = [s["code"] for s in cfg["symbols"]]
        self.names = {s["code"]: s.get("name", s["code"]) for s in cfg["symbols"]}
        self.defaults = IndicatorParams.from_config(cfg.get("indicators", {}), cfg.get("split_guard", True))
        self.splits = {str(k): [dt.date.fromisoformat(str(d)) for d in v] for k, v in (cfg.get("splits") or {}).items()}
        tk = cfg.get("tick", {})
        self.agg = Aggregator(self.clock, intervals=tuple(INTERVALS.values()),
                              max_price_deviation=float(tk.get("max_price_deviation", 0.5)))
        self.vwap_every = float(tk.get("vwap_check_interval_s", 60))
        self.vwap_warn = float(tk.get("vwap_warn_pct", 0.5))
        after = None
        if cfg.get("provider") == "mock":
            r = self.store.query("SELECT MAX(ts) m FROM ticks WHERE source='mock'")
            after = to_jst(r[0]["m"]).date() if r and r[0]["m"] else None
        self.provider = create_provider(cfg, self.clock, self.store, after_date=after)
        self.source = self.provider.name
        self.live = self.source not in ("replay",)            # replay はティック・足をDBに書かない
        self.data_source = cfg.get("replay", {}).get("source", "mock") if self.source == "replay" else self.source
        self.engine = EventEngine(cfg, self.clock, self.store, self.source, lambda s: self.splits.get(s, ()))
        self.conns: set[Conn] = set()
        self.last_tick_vol: dict[str, float] = {}
        self.last_tick_ts: dict[str, float] = {}
        self._vwap_checked: dict[str, float] = {}
        self.tasks: list[asyncio.Task] = []
        self.fatal: Optional[str] = None
        self.tick_count = 0

    # ------------------------------------------------------------ 起動
    async def bootstrap(self) -> None:
        """起動時: 取得可能なら履歴を取得し、なければDBに記録済みの足を読み込む。前日終値も用意する。"""
        today = to_jst(time.time()).date()
        for sym in self.symbols:
            loaded = False
            if self.provider.capabilities.history:
                try:
                    start = dt.datetime.combine(today, dt.time(0, 0), tzinfo=JST)
                    for name, itv in INTERVALS.items():
                        candles = await self.provider.fetch_history(sym, name, start, dt.datetime.now(start.tzinfo))
                        self.agg.load_bars(sym, itv, [Bar(c.t, c.o, c.h, c.l, c.c, c.v, closed=True) for c in candles])
                    loaded = True
                except Exception as e:  # noqa: BLE001
                    log.warning("履歴取得に失敗 %s: %s（DBの記録で代替）", sym, e)
            # 仮想時計(mock virtual)・replay では過去記録を混ぜない
            virtual = self.source == "replay" or (self.source == "mock" and self.cfg.get("mock", {}).get("clock") == "virtual")
            if not loaded and not virtual:
                days = [today]
                if self.defaults.ma_carry_prev_day:
                    days.insert(0, self.clock.calendar.prev_trading_day(today))
                for d in days:
                    lo, hi = self.clock.trading_day_bounds(d)
                    for itv in INTERVALS.values():
                        rows = self.store.query(
                            "SELECT * FROM bars WHERE source=? AND symbol=? AND interval=? AND t>=? AND t<? ORDER BY t",
                            (self.source, sym, itv, lo, hi + 1))
                        self.agg.load_bars(sym, itv, [Bar(r["t"], r["o"], r["h"], r["l"], r["c"], r["v"], closed=True,
                                                          gap=bool(r["gap"])) for r in rows])
            pc = self.store.last_close_before(self.data_source, sym, self.clock.trading_day_bounds(today)[0])
            if pc:
                self.agg.set_prev_close(sym, pc)
        n = self.engine.backfill_from_db()
        if n:
            log.info("未記入だったイベント変化率を %d 件補完", n)

        def on_gap(a: float, b: float) -> None:
            log.warning("受信欠損 %s 〜 %s: 該当する足に欠損の印を付けます", _jst_str(a), _jst_str(b))
            self.agg.mark_gap(a, b)
        self.provider.on_gap = on_gap

    def start(self) -> None:
        self.tasks = [asyncio.create_task(self._consume(), name="consume"),
                      asyncio.create_task(self._housekeeping(), name="housekeeping")]

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        for t in self.tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        try:
            await self.provider.close()
        except Exception:  # noqa: BLE001
            log.exception("provider.close() 失敗")
        self.store.close()

    # ------------------------------------------------------------ ティック処理
    async def _consume(self) -> None:
        backoff = 1.0
        while True:
            try:
                async for tick in self.provider.stream(self.symbols):
                    self.handle_tick(tick)
                    backoff = 1.0
                if self.source == "replay":
                    self.finish_replay()
                    return
                log.warning("ストリームが終了しました。再接続します")
            except asyncio.CancelledError:
                raise
            except NotImplementedError as e:
                self.fatal = str(e)
                log.error("プロバイダ未実装: %s", e)
                return
            except Exception as e:  # noqa: BLE001
                if self.source == "replay":
                    self.fatal = str(e)
                    log.error("リプレイ失敗: %s", e)
                    return
                self.provider.status = "reconnecting"
                log.exception("ストリーム異常: %s。%.0f秒後に再接続", type(e).__name__, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)

    def handle_tick(self, tick: Tick) -> None:
        res = self.agg.on_tick(tick)
        if not res.accepted:
            return
        self.tick_count += 1
        sym = tick.symbol
        if self.live:
            self.store.add_tick(self.source, tick)
        self.last_tick_vol[sym] = res.volume
        self.last_tick_ts[sym] = tick.timestamp
        for itv, bar in res.closed:
            self._on_closed(sym, itv, bar)
        if res.in_session:
            bars1 = self.agg.get_bars(sym, 60)
            for ev in self.engine.on_tick(sym, tick.timestamp, tick.price, bars1):
                self._broadcast_event(ev)
            self._check_vendor_vwap(tick, bars1)
        self._mark_dirty(sym)

    def _on_closed(self, sym: str, itv: int, bar: Bar) -> None:
        if self.live:
            self.store.save_bar(self.source, sym, itv, bar)
        if itv == 60:
            for ev in self.engine.on_bar_closed(sym, self.agg.get_bars(sym, 60)):
                self._broadcast_event(ev)

    def _check_vendor_vwap(self, tick: Tick, bars1) -> None:
        if not tick.vendor_vwap:
            return
        last = self._vwap_checked.get(tick.symbol, 0.0)
        if tick.timestamp - last < self.vwap_every:
            return
        own = self.engine.current_vwap(tick.symbol, bars1)
        if own is None:
            return
        self._vwap_checked[tick.symbol] = tick.timestamp
        diff = (own / tick.vendor_vwap - 1.0) * 100.0
        if self.live:
            self.store.add_vwap_check(self.source, tick.symbol, tick.timestamp, own, tick.vendor_vwap, diff)
        lvl = logging.WARNING if abs(diff) > self.vwap_warn else logging.INFO
        log.log(lvl, "VWAP比較 %s 自前(足ベース)=%.2f 配信=%.2f 乖離=%+.3f%%", tick.symbol, own, tick.vendor_vwap, diff)

    def finish_replay(self) -> None:
        for sym, itv, bar in self.agg.close_until(float("inf")):
            self._on_closed(sym, itv, bar)
        self.engine.fill_pending(self.provider.now())
        log.info("リプレイ終了 (%d ティック)", self.tick_count)
        self._broadcast_all_dirty()

    async def _housekeeping(self) -> None:
        while True:
            await asyncio.sleep(1.0)
            try:
                self.store.flush()
                now = self.provider.now()
                if now > 0:
                    for sym, itv, bar in self.agg.close_until(now):
                        self._on_closed(sym, itv, bar)
                        self._mark_dirty(sym)
                    self.engine.fill_pending(now)
            except Exception:  # noqa: BLE001
                log.exception("housekeeping 失敗")

    # ------------------------------------------------------------ 状態表示
    def status(self) -> dict:
        p = self.provider
        now = p.now()
        if self.fatal:
            return {"code": "disconnected", "label": "切断（" + self.fatal[:60] + "）", "stalled": True, "now": now}
        mode = "mock" if self.source == "mock" else "replay" if self.source == "replay" else "live"
        if p.status in ("reconnecting",):
            return {"code": "reconnecting", "label": "再接続中", "stalled": True, "mode": mode, "now": now}
        if p.status in ("connecting", "idle") or (mode == "replay" and now == 0):
            return {"code": "connecting", "label": "接続中", "stalled": True, "mode": mode, "now": now}
        if p.status == "disconnected":
            return {"code": "disconnected", "label": "切断", "stalled": True, "mode": mode, "now": now}
        if p.status == "finished":
            return {"code": "replay_done", "label": "リプレイ終了", "stalled": True, "mode": mode, "now": now}
        st = self.clock.state(now)
        if st == SessionState.LUNCH:
            return {"code": "lunch", "label": "昼休み（チャート停止中）", "stalled": True, "mode": mode, "now": now}
        if st == SessionState.CLOSED_DAY:
            return {"code": "closed_day", "label": "休場日（取引時間外）", "stalled": True, "mode": mode, "now": now}
        if st in (SessionState.PRE_OPEN, SessionState.AFTER_CLOSE):
            return {"code": "off_hours", "label": "取引時間外（チャート停止中）", "stalled": True, "mode": mode, "now": now}
        label = {"mock": "モック", "replay": f"リプレイ中 ×{getattr(p, 'speed', '')}", "live": "接続中（受信中）"}[mode]
        return {"code": mode, "label": label, "stalled": False, "mode": mode, "now": now}

    def warnings(self) -> list[str]:
        w = []
        cap = self.provider.capabilities
        if self.source not in ("mock", "replay"):
            if cap.pushes_every_trade is not True:
                w.append("この足は受信したスナップショットから作った近似値です（取りこぼしがあり得るため、証券会社のチャートとは完全には一致しません）。")
        if self.cfg.get("warn_unadjusted_history", True) and self.source not in ("mock", "replay"):
            if not cap.history:
                w.append("履歴(ローソク足)APIがないため、過去の足は本アプリが記録したものです。株式分割・併合の調整は行われません（未調整）。")
            elif cap.history_adjusted is not True:
                w.append("履歴データが分割・併合調整済みか未確認です。分割日をまたぐ区間の指標は不連続になる可能性があります。")
        for s, ds in self.splits.items():
            w.append(f"{s}: 分割/併合日 {', '.join(map(str, ds))} 設定済み。" +
                     ("この日をまたぐ区間の指標計算は無効化（リセット）しています。" if self.defaults.split_guard
                      else "split_guard が無効のため、日をまたぐ区間の指標は不連続の影響を受けます。"))
        return w

    def meta(self) -> dict:
        d = self.defaults
        return {
            "provider": self.source, "capabilities": self.provider.capabilities.__dict__,
            "symbols": [{"code": c, "name": self.names[c]} for c in self.symbols],
            "defaults": {"sma": list(d.sma), "ema": list(d.ema), "bb_period": d.bb_period, "bb_sigmas": list(d.bb_sigmas)},
            "ddof": d.ddof, "std_label": "母標準偏差(ddof=0)" if d.ddof == 0 else "標本標準偏差(ddof=1)",
            "vwap_reset_afternoon": d.vwap_reset_afternoon, "ma_cross_lunch": d.ma_cross_lunch,
            "ma_carry_prev_day": d.ma_carry_prev_day, "split_guard": d.split_guard,
            "warnings": self.warnings(),
        }

    # ------------------------------------------------------------ 配信
    def _params_from_client(self, raw: dict) -> IndicatorParams:
        def ints(key, default, lo=1, hi=500):
            try:
                v = tuple(sorted({min(max(int(x), lo), hi) for x in raw.get(key, default)}))
                return v or tuple(default)
            except (TypeError, ValueError):
                return tuple(default)

        def floats(key, default):
            try:
                v = tuple(float(min(max(float(x), 0.1), 6.0)) for x in raw.get(key, default))
                return v or tuple(default)
            except (TypeError, ValueError):
                return tuple(default)
        d = self.defaults
        try:
            bb_n = min(max(int(raw.get("bb_period", d.bb_period)), 2), 500)
        except (TypeError, ValueError):
            bb_n = d.bb_period
        return replace(d, sma=ints("sma", d.sma), ema=ints("ema", d.ema), bb_period=bb_n,
                       bb_sigmas=floats("bb_sigmas", d.bb_sigmas))

    def _mark_dirty(self, sym: str) -> None:
        for c in self.conns:
            if c.symbol == sym:
                c.dirty = True

    def _broadcast_all_dirty(self) -> None:
        for c in self.conns:
            c.dirty = True

    def _broadcast_event(self, ev: dict) -> None:
        for c in list(self.conns):
            if c.symbol == ev["symbol"]:
                asyncio.create_task(self._safe_send(c, {"type": "event", "event": self._event_for_client(ev)}))

    def _event_for_client(self, ev: dict) -> dict:
        return {"id": ev["id"], "symbol": ev["symbol"], "etype": ev["type"], "label": ev["label"], "ts": ev["ts"],
                "price": ev["price"], "time": ev["ts"] + DISPLAY_OFFSET, "jst": _jst_str(ev["ts"])}

    async def _safe_send(self, c: Conn, msg: dict) -> bool:
        try:
            await c.ws.send_text(json.dumps(msg, ensure_ascii=False, allow_nan=False))
            return True
        except Exception:  # noqa: BLE001
            self.conns.discard(c)
            return False

    def build_view(self, c: Conn, full: bool) -> dict:
        itv = INTERVALS.get(c.interval, 60)
        sym = c.symbol
        bars = self.agg.get_bars(sym, itv)
        sd = self.splits.get(sym, ())
        view: dict = {"type": "snapshot" if full else "update", "symbol": sym, "interval": c.interval,
                      "ddof": self.defaults.ddof}
        series: dict[str, list] = {}
        res: dict = {}
        if bars:
            sub = bars[-MAX_INDICATOR_ROWS:]
            df = make_frame(sub)
            res = ind.compute(df, c.params, sd)
            take = len(sub) if full else min(3, len(sub))
            for name, s in res.items():
                pts = []
                for i in range(len(sub) - take, len(sub)):
                    v = s.iloc[i]
                    if pd.notna(v):
                        pts.append({"time": int(sub[i].t) + DISPLAY_OFFSET, "value": round(float(v), 4)})
                series[name] = pts
            shown = sub if full else sub[-3:]
            view["bars"] = [dict(b.as_dict(), time=b.t + DISPLAY_OFFSET) for b in shown]
        else:
            view["bars"] = []
        view["indicators"] = series
        price = bars[-1].c if bars else None
        vwap_now = None
        if res.get("vwap") is not None and len(res["vwap"]):
            v = res["vwap"].iloc[-1]
            vwap_now = float(v) if pd.notna(v) else None
        pm = ind.pct_metrics(self.agg.state[sym].last_price if sym in self.agg.state else price,
                             self.agg.get_prev_close(sym), vwap_now)
        view["header"] = {
            "price": self.agg.state[sym].last_price if sym in self.agg.state else None,
            "prev_close": self.agg.get_prev_close(sym), "vwap": vwap_now,
            "last_bar_volume": bars[-1].v if bars else None, "last_tick_volume": self.last_tick_vol.get(sym),
            "last_tick_time": _jst_str(self.last_tick_ts[sym]) if sym in self.last_tick_ts else None, **pm,
        }
        view["status"] = self.status()
        if full:
            lo = self.clock.trading_day_bounds(to_jst(self.provider.now() or time.time()).date())[0]
            rows = self.store.query("SELECT * FROM events WHERE source=? AND symbol=? AND ts>=? ORDER BY ts DESC LIMIT 200",
                                    (self.source, sym, lo))
            view["events"] = [self._event_for_client({"id": r["id"], "symbol": r["symbol"], "type": r["type"],
                                                      "label": event_label(r["type"], self.engine.ema_fast, self.engine.ema_slow),
                                                      "ts": r["ts"], "price": r["price"]}) for r in rows][::-1]
            view["meta"] = self.meta()
        return view


# ====================================================================== FastAPI
APP: Optional[App] = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global APP
    load_dotenv(BASE_DIR / ".env")
    cfg = load_config()
    setup_logging(resolve_path(cfg, "log_dir"))
    log.info("起動: provider=%s symbols=%s", cfg.get("provider"), [s["code"] for s in cfg["symbols"]])
    APP = App(cfg)
    await APP.bootstrap()
    APP.start()
    yield
    await APP.stop()
    APP = None


app = FastAPI(title="日本株デイトレ チャート（閲覧・記録専用）", lifespan=lifespan)
STATIC = BASE_DIR / "static"


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/stats")
async def stats_page():
    return FileResponse(STATIC / "stats.html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/api/meta")
async def api_meta():
    return APP.meta() | {"status": APP.status()}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    a = APP
    conn = Conn(ws, a.symbols[0], a.defaults)
    a.conns.add(conn)

    async def sender():
        while True:
            await asyncio.sleep(0.2)
            if conn.need_snapshot:
                conn.need_snapshot = conn.dirty = False
                if not await a._safe_send(conn, a.build_view(conn, full=True)):
                    return
            elif conn.dirty:
                conn.dirty = False
                if not await a._safe_send(conn, a.build_view(conn, full=False)):
                    return
            elif time.time() - conn.last_status > 1.0:
                conn.last_status = time.time()
                if not await a._safe_send(conn, {"type": "status", "status": a.status()}):
                    return

    send_task = asyncio.create_task(sender())
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if msg.get("type") == "subscribe":
                sym = str(msg.get("symbol", conn.symbol))
                if sym in a.names:
                    conn.symbol = sym
                if msg.get("interval") in INTERVALS:
                    conn.interval = msg["interval"]
                conn.params = a._params_from_client(msg.get("params", {}))
                conn.need_snapshot = True
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("ws エラー")
    finally:
        send_task.cancel()
        a.conns.discard(conn)


# ---------------------------------------------------------------- 検証画面 API
def _events_df(source: Optional[str], symbol: Optional[str], etype: Optional[str]) -> pd.DataFrame:
    sql, args = "SELECT * FROM events WHERE 1=1", []
    for col, val in (("source", source), ("symbol", symbol), ("type", etype)):
        if val:
            sql += f" AND {col}=?"
            args.append(val)
    rows = APP.store.query(sql + " ORDER BY ts", args)
    return pd.DataFrame([dict(r) for r in rows])


@app.get("/api/stats")
async def api_stats(source: Optional[str] = None, symbol: Optional[str] = None, etype: Optional[str] = None,
                    group_by: str = "type,bucket"):
    cfg_ev = APP.cfg.get("events", {})
    min_n = int(cfg_ev.get("min_sample", 30))
    df = _events_df(source, symbol, etype)
    cols = [c for c in group_by.split(",") if c in ("type", "symbol", "bucket", "source")]
    horizons = [h for h in (1, 3, 5, 10)]
    out = []
    if not df.empty:
        df["_all"] = 1
        keys = cols or ["_all"]
        for k, g in df.groupby(keys, dropna=False):
            k = k if isinstance(k, tuple) else (k,)
            row = {"group": dict(zip(keys, k)), "n": int(len(g)), "low_sample": len(g) < min_n, "h": {}}
            if "type" in row["group"]:
                row["label"] = event_label(row["group"]["type"], APP.engine.ema_fast, APP.engine.ema_slow)
            for h in horizons:
                s = g[f"chg_{h}"].dropna()
                row["h"][str(h)] = {"n": int(len(s)), "mean": None if s.empty else float(s.mean()),
                                    "win_rate": None if s.empty else float((s > 0).mean()), "low_sample": len(s) < min_n}
            out.append(row)
    sources = [r["source"] for r in APP.store.query("SELECT DISTINCT source FROM events")]
    types = [{"type": r["type"], "label": event_label(r["type"], APP.engine.ema_fast, APP.engine.ema_slow)}
             for r in APP.store.query("SELECT DISTINCT type FROM events ORDER BY type")]
    return JSONResponse({"rows": out, "min_sample": min_n, "sources": sources, "types": types,
                         "symbols": [{"code": c, "name": APP.names[c]} for c in APP.symbols],
                         "total_events": int(len(df)), "ddof": APP.engine.params.ddof,
                         "horizons_min": horizons})


@app.get("/api/events")
async def api_events(source: Optional[str] = None, symbol: Optional[str] = None, limit: int = Query(200, le=5000)):
    df = _events_df(source, symbol, None)
    if df.empty:
        return []
    df["jst"] = df["ts"].map(_jst_str)
    df["label"] = df["type"].map(lambda t: event_label(t, APP.engine.ema_fast, APP.engine.ema_slow))
    df = df.astype(object).where(df.notna(), None)
    return df.tail(limit).iloc[::-1].to_dict("records")


@app.get("/api/export/{table}.csv")
async def export_csv(table: str, source: Optional[str] = None, symbol: Optional[str] = None):
    if table not in ("events", "ticks", "bars", "vwap_check"):
        return JSONResponse({"error": "table は events / ticks / bars / vwap_check のいずれか"}, status_code=400)
    sql, args = f"SELECT * FROM {table} WHERE 1=1", []
    if source:
        sql += " AND source=?"
        args.append(source)
    if symbol:
        sql += " AND symbol=?"
        args.append(symbol)
    rows = APP.store.query(sql, args)

    def gen():
        buf = io.StringIO()
        w = csv.writer(buf)
        if rows:
            hdr = list(rows[0].keys())
            w.writerow(hdr + ["jst_time"] if "ts" in hdr else hdr)
            for r in rows:
                vals = list(r)
                if "ts" in hdr:
                    vals.append(_jst_str(r["ts"]))
                w.writerow(vals)
        yield "﻿" + buf.getvalue()      # Excelで文字化けしないようBOM付きUTF-8

    return StreamingResponse(gen(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{table}.csv"'})


if __name__ == "__main__":
    import argparse

    import uvicorn

    ap = argparse.ArgumentParser(description="日本株デイトレ チャート（閲覧・記録専用）")
    ap.add_argument("--provider", choices=["mock", "replay", "kabu", "tachibana"])
    ap.add_argument("--speed", type=float, help="replay/mock の速度倍率")
    ap.add_argument("--date", help="replay の対象日 YYYY-MM-DD")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args()
    if a.provider:
        os.environ["PROVIDER"] = a.provider
    if a.speed:
        os.environ["REPLAY_SPEED" if (a.provider == "replay") else "MOCK_SPEED"] = str(a.speed)
    if a.date:
        os.environ["REPLAY_DATE"] = a.date
    uvicorn.run(app, host=a.host, port=a.port)
