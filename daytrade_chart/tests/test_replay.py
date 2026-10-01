"""記録済みティックを replay プロバイダで再生 → 足・イベントが再現され、DBのティックは重複しないこと。"""
import datetime as dt
import random
import time

import pytest
import yaml
from fastapi.testclient import TestClient

from core.config import BASE_DIR
from core.session import jst_epoch
from core.store import Store
from providers.base import Tick


def record_day(path, day=dt.date(2026, 9, 30)):
    rng = random.Random(3)
    st = Store(path)
    price, cum = 1800.0, 0.0
    for s0, s1 in (((9, 0), (11, 30)), ((12, 30), (15, 30))):
        t, end = jst_epoch(day, dt.time(*s0)), jst_epoch(day, dt.time(*s1))
        while t <= end:
            price *= 1 + rng.gauss(0, 0.0007)
            cum += 100 * rng.randint(1, 20)
            st.add_tick("mock", Tick("285A", t, round(price), cum, None, None, 1790.0))
            t += 5
    st.flush()
    n = st.query("SELECT COUNT(*) n FROM ticks")[0]["n"]
    st.close()
    return n


def test_replay_reproduces_bars_and_events(tmp_path, monkeypatch):
    db = tmp_path / "market.db"
    n_ticks = record_day(db)
    cfg = yaml.safe_load((BASE_DIR / "config.yaml").read_text(encoding="utf-8"))
    cfg.update({"db_path": str(db), "log_dir": str(tmp_path / "logs"), "provider": "replay",
                "symbols": [{"code": "285A", "name": "x"}]})
    cfg["replay"].update({"source": "mock", "date": "2026-09-30", "speed": 1e6, "max_real_gap_s": 0.0})
    p = tmp_path / "c.yaml"
    p.write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    monkeypatch.setenv("APP_CONFIG", str(p))
    import main
    with TestClient(main.app) as c:
        app = main.APP
        t0 = time.time()
        while app.provider.status != "finished" and time.time() - t0 < 60:
            time.sleep(0.2)
        assert app.provider.status == "finished"
        assert app.tick_count > 0.9 * n_ticks
        bars = app.agg.get_bars("285A", 60)
        assert len(bars) > 300 and all(b.closed for b in bars)
        assert app.agg.get_prev_close("285A") == 1790.0
        st = c.get("/api/stats?source=replay").json()
        assert st["total_events"] > 0
        assert c.get("/api/meta").json()["status"]["code"] == "replay_done"
        # リプレイ中のイベントは source=replay で記録され、ティックは二重に書かれない
        q = app.store.query
        assert q("SELECT COUNT(*) n FROM ticks")[0]["n"] == n_ticks
        assert q("SELECT COUNT(*) n FROM events WHERE source<>'replay'")[0]["n"] == 0
        assert q("SELECT COUNT(*) n FROM events WHERE source='replay' AND chg_1 IS NOT NULL")[0]["n"] > 0


def test_replay_without_data_reports_disconnected(tmp_path, monkeypatch):
    cfg = yaml.safe_load((BASE_DIR / "config.yaml").read_text(encoding="utf-8"))
    cfg.update({"db_path": str(tmp_path / "empty.db"), "log_dir": str(tmp_path / "logs"), "provider": "replay"})
    p = tmp_path / "c.yaml"
    p.write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    monkeypatch.setenv("APP_CONFIG", str(p))
    import main
    with TestClient(main.app) as c:
        time.sleep(1.0)
        s = c.get("/api/meta").json()["status"]
        assert s["code"] == "disconnected" and "リプレイ対象" in s["label"]
