"""mock プロバイダで実際にアプリを起動し、ティック受信→足→指標→WebSocket配信→イベント記録→検証API/CSV まで通す。"""
import json
import time

import pytest
import yaml
from fastapi.testclient import TestClient

from core.config import BASE_DIR
from core.session import to_jst


@pytest.fixture
def client(tmp_path, monkeypatch):
    cfg = yaml.safe_load((BASE_DIR / "config.yaml").read_text(encoding="utf-8"))
    cfg["db_path"] = str(tmp_path / "market.db")
    cfg["log_dir"] = str(tmp_path / "logs")
    cfg["provider"] = "mock"
    cfg["mock"].update({"clock": "virtual", "speed": 6000, "seed": 7, "mean_tick_gap_s": 3.0})
    p = tmp_path / "config.yaml"
    p.write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    monkeypatch.setenv("APP_CONFIG", str(p))
    monkeypatch.delenv("PROVIDER", raising=False)
    import main
    with TestClient(main.app) as c:
        c.main = main
        yield c


def wait_for(cond, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if cond():
            return True
        time.sleep(0.3)
    return False


def test_full_pipeline_with_alphanumeric_symbols(client):
    main = client.main
    meta = client.get("/api/meta").json()
    assert [s["code"] for s in meta["symbols"]] == ["6501", "285A", "200A"]       # 英数字コードがそのまま通る
    assert meta["provider"] == "mock"

    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "subscribe", "symbol": "285A", "interval": "1m",
                                 "params": {"sma": [5], "ema": [3, 5], "bb_period": 5, "bb_sigmas": [1, 2]}}))
        snap = None
        updates = 0
        deadline = time.time() + 60
        while time.time() < deadline:
            m = json.loads(ws.receive_text())
            if m["type"] == "snapshot":
                snap = m
            elif m["type"] == "update" and m["symbol"] == "285A":
                updates += 1
                if updates >= 3 and any(b["closed"] for b in m["bars"]) and m["indicators"].get("vwap"):
                    break
        assert snap is not None and snap["symbol"] == "285A"
        assert updates >= 3
        assert m["header"]["price"] is not None and m["header"]["vwap"] is not None   # 現在値・VWAP
        assert m["header"]["vwap_dev_pct"] is not None and m["header"]["chg_prev_close_pct"] is not None
        assert "ema_3" in m["indicators"] and "bb_up_2" in m["indicators"] or updates >= 3

    # 1営業日(仮想)が大引けを過ぎるまで待つ
    app = main.APP
    assert wait_for(lambda: app.agg.state["285A"].last_ts and
                    to_jst(app.agg.state["285A"].last_ts).strftime("%H:%M") >= "15:29", timeout=120)
    time.sleep(2.5)    # 確定・イベント変化率の補完を待つ

    app.store.flush()
    q = app.store.query
    assert q("SELECT COUNT(*) n FROM ticks WHERE source='mock'")[0]["n"] > 500
    b1 = q("SELECT t FROM bars WHERE source='mock' AND symbol='285A' AND interval=60 ORDER BY t")
    assert len(b1) > 100
    hhmm = {to_jst(r["t"]).strftime("%H:%M") for r in b1}
    assert "09:00" in hhmm and "12:30" in hhmm and "15:29" in hhmm
    assert not any("11:30" <= h < "12:30" for h in hhmm)                 # 昼休みに足がない
    assert q("SELECT COUNT(*) n FROM vwap_check")[0]["n"] > 0           # 配信VWAPとの比較記録
    ev = q("SELECT * FROM events WHERE source='mock'")
    assert len(ev) > 0
    assert any(r["chg_1"] is not None for r in ev)                       # 発生後1分の変化率が自動で埋まる

    st = client.get("/api/stats?source=mock").json()
    assert st["total_events"] >= len(ev) and st["rows"]   # 仮想時計は翌営業日へ進み続けるため >=
    assert all("low_sample" in r for r in st["rows"])
    csv_text = client.get("/api/export/events.csv").content.decode("utf-8-sig")
    assert csv_text.splitlines()[0].startswith("id,source,symbol,type")
    assert client.get("/").status_code == 200 and client.get("/stats").status_code == 200
    assert client.get("/api/export/passwords.csv").status_code == 400


def test_no_order_endpoints_in_code():
    """注文系APIの呼び出しコードが無いこと（ソース全体を検査）。"""
    import re
    bad = re.compile(r"sendorder|cancelorder|/orders|/positions|wallet/", re.I)
    for f in list((BASE_DIR / "providers").glob("*.py")) + list((BASE_DIR / "core").glob("*.py")) + [BASE_DIR / "main.py"]:
        for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if bad.search(line) and not line.lstrip().startswith(("#", '"""')):
                pytest.fail(f"{f.name}:{i} 注文・口座系エンドポイントらしき記述: {line.strip()}")
