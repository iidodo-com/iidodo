"""kabu プロバイダの単体テスト。実際の kabuステーションには接続していない（フェイクサーバーで自前の解釈を確認するだけ）。"""
import asyncio
import json
import socket
import threading
import time

import pytest
import uvicorn
from fastapi import FastAPI, Header, WebSocket
from fastapi.responses import JSONResponse

from providers.kabu import KabuProvider, PORTS
from .conftest import ts

SAMPLE = {"Symbol": "285A", "CurrentPrice": 2408.0, "CurrentPriceTime": "2026-10-01T10:00:05+09:00",
          "CurrentPriceStatus": 1, "TradingVolume": 4571500.0, "TradingValue": 10946119350.0,
          "VWAP": 2394.4262, "PreviousClose": 2400.0}


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("KABU_API_PASSWORD", "pw-secret-123")
    monkeypatch.delenv("KABU_ENV", raising=False)


def test_default_is_test_environment_and_production_is_explicit(env, monkeypatch):
    p = KabuProvider({})
    assert p.env == "test" and ":18081/" in p.base_url and ":18081/" in p.ws_url          # 既定は検証用
    monkeypatch.setenv("KABU_ENV", "production")
    q = KabuProvider({})
    assert ":18080/" in q.base_url and PORTS["production"] == 18080                      # 明示した時だけ本番
    monkeypatch.setenv("KABU_ENV", "prod")
    with pytest.raises(ValueError):
        KabuProvider({})


def test_requires_password_from_env(monkeypatch):
    monkeypatch.delenv("KABU_API_PASSWORD", raising=False)
    with pytest.raises(RuntimeError):
        KabuProvider({})


def test_parse_snapshot(env):
    p = KabuProvider({})
    p._symbols = ["285A"]
    t = p.parse(json.dumps(SAMPLE))
    assert t.symbol == "285A" and t.price == 2408.0 and t.cum_volume == 4571500.0
    assert t.cum_value == 10946119350.0 and t.vendor_vwap == 2394.4262 and t.prev_close == 2400.0
    assert t.timestamp == ts(10, 0, 5)
    # 使えないメッセージ
    assert p.parse(json.dumps({**SAMPLE, "CurrentPrice": None})) is None
    assert p.parse(json.dumps({**SAMPLE, "Symbol": "9999"})) is None            # 未登録銘柄
    assert p.parse(json.dumps({**SAMPLE, "CurrentPriceStatus": 6})) is None     # 売買停止
    assert p.parse("not json") is None


def build_fake(state):
    api = FastAPI()

    @api.post("/kabusapi/token")
    async def token(body: dict):
        state["token_calls"] += 1
        if body.get("APIPassword") != "pw-secret-123":
            return JSONResponse({"Code": 4001009, "Message": "x"}, status_code=401)
        return {"ResultCode": 0, "Token": f"TOKEN{state['token_calls']}-abcdef"}

    @api.put("/kabusapi/register")
    async def register(body: dict, x_api_key: str = Header(None)):
        state["register_keys"].append(x_api_key)
        if state["reject_first_register"] and len(state["register_keys"]) == 1:
            return JSONResponse({"Code": 4001007, "Message": "bad key"}, status_code=401)
        return {"RegistList": body["Symbols"]}

    @api.put("/kabusapi/unregister")
    async def unregister(body: dict, x_api_key: str = Header(None)):
        state["unregistered"] = [s["Symbol"] for s in body["Symbols"]]
        return {"RegistList": []}

    @api.websocket("/kabusapi/websocket")
    async def ws(sock: WebSocket):
        await sock.accept()
        state["ws_connects"] += 1
        n = state["ws_connects"]
        await sock.send_text(json.dumps({**SAMPLE, "TradingVolume": 1000.0 * n}))
        await sock.send_text(json.dumps({**SAMPLE, "TradingVolume": 1000.0 * n, "CurrentPrice": None}))  # 無視されるべき
        if n == 1:
            await sock.close()          # 1回目は切断して再接続させる
        else:
            await asyncio.sleep(3)
    return api


@pytest.fixture
def fake_server():
    state = {"token_calls": 0, "register_keys": [], "ws_connects": 0, "reject_first_register": False}
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    server = uvicorn.Server(uvicorn.Config(build_fake(state), host="127.0.0.1", port=port, log_level="error"))
    th = threading.Thread(target=server.run, daemon=True); th.start()
    while not server.started:
        time.sleep(0.05)
    yield port, state
    server.should_exit = True
    th.join(timeout=5)


def test_stream_register_reconnect_and_gap(env, fake_server, caplog):
    port, state = fake_server
    p = KabuProvider({"kabu": {"reconnect_min_s": 0.1, "reconnect_max_s": 0.5}},
                     base_url=f"http://127.0.0.1:{port}/kabusapi", ws_url=f"ws://127.0.0.1:{port}/kabusapi/websocket")
    gaps = []
    p.on_gap = lambda a, b: gaps.append((a, b))

    async def run():
        got = []
        gen = p.stream(["285A"])
        async for t in gen:
            got.append(t)
            if len(got) == 2:
                break
        await gen.aclose()
        await p.close()
        return got

    got = asyncio.run(asyncio.wait_for(run(), 20))
    assert [t.cum_volume for t in got] == [1000.0, 2000.0]         # 切断→再接続をまたいで受信
    assert state["ws_connects"] == 2 and len(gaps) == 1            # 再接続時に欠損通知
    assert state["token_calls"] == 1                               # トークンは使い回す（再発行しない）
    assert state["register_keys"][0].startswith("TOKEN1")
    assert state["unregistered"] == ["285A"]                       # 自分の登録分だけ解除
    assert "pw-secret-123" not in caplog.text and "TOKEN1-abcdef" not in caplog.text   # 秘密がログに出ない


def test_token_refetched_on_401(env, fake_server):
    port, state = fake_server
    state["reject_first_register"] = True
    p = KabuProvider({}, base_url=f"http://127.0.0.1:{port}/kabusapi", ws_url=f"ws://127.0.0.1:{port}/kabusapi/websocket")
    asyncio.run(asyncio.wait_for(p._prepare(["285A"]), 10))
    assert state["token_calls"] == 2 and state["register_keys"][1].startswith("TOKEN2")


def test_symbol_limit(env):
    p = KabuProvider({})

    async def run():
        async for _ in p.stream([str(i) for i in range(51)]):
            pass
    with pytest.raises(ValueError):
        asyncio.run(run())
