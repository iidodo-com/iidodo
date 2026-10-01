"""kabuステーション API プロバイダ（閲覧・記録専用。注文系・口座系のAPIは一切呼ばない）。

使うエンドポイントは次の4つだけ:
  POST /token         … APIトークン発行（body: {"APIPassword": ...}）
  PUT  /register      … PUSH配信する銘柄の登録（header: X-API-KEY）
  PUT  /unregister    … 終了時に、このアプリが登録した銘柄だけ解除（/unregister/all は他アプリの登録も消すので使わない）
  WS   /websocket     … PUSH配信の受信

【公式仕様で確認できた点】（kabucom/kabusapi の kabu_STATION_API.yaml v1.5 と PUSH配信ページ）
  - REST ベース: 本番 http://localhost:18080/kabusapi / 検証用 http://localhost:18081/kabusapi
  - PUSH: 本番 ws://localhost:18080/kabusapi/websocket / 検証用 ws://localhost:18081/kabusapi/websocket
  - 銘柄登録の上限は 50（REST登録分とPUSH登録分の合算）。市場コード 1=東証。
  - トークンは「kabuステーション終了」「ログアウト」「別のトークンが新たに発行された時」に無効になる。早朝に強制ログアウトがある。
  - 401=認証エラー(トークン不正など) / 403=アクセス権不正(APIキー不正など)。
  - PUSHは「値が更新される際に配信」され、昼休み・引け後は配信されない（＝全約定ではなくスナップショット方式）。
  - PUSHの項目: CurrentPrice(現値) / CurrentPriceTime(ISO8601, +09:00) / TradingVolume(売買高) / TradingValue(売買代金) /
    VWAP / PreviousClose(前日終値) / CurrentPriceStatus 等。
  - 動作環境: Windows のみ、kabuステーションの起動・ログインが前提（Professional/Premiumプラン）。

【未確認】
  - TODO(未確認): WebSocket接続時に認証(X-API-KEY等)が要るか。公式ページに記載がなく、本実装は付けずに接続する。
  - TODO(未確認): 売買高(TradingVolume)が日次でリセットされる時刻。仕様書に記載なし（日付が変わった時に基準を0に戻す実装で対応）。
  - TODO(未確認): 英数字コード(285A等)を Symbol にそのまま指定できるか。仕様書の例は数字のみ。
  - TODO(未確認): TradingVolume / TradingValue の単位の明記（サンプル値から 株・円 と推定）。
  - TODO(未確認): CurrentPriceStatus のうち、どれを足に使ってよいか（下の ACCEPT_STATUS は 現値/不連続歩み/板寄せ/終値/板寄せ約定 と推測）。
  - TODO(未確認): トークン失効をPUSH接続中に検知する方法（本実装は、切断→再接続時の 401/403 で再取得する）。
  - 履歴(ローソク足)APIはない（歩み値APIはあるが本実装では使わない）→ 履歴補完・調整済み判定はできない。
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import os
import random
import time
from typing import AsyncIterator, Optional

import httpx
import websockets

from core.logging_setup import register_secret
from core.session import JST
from .base import Capabilities, DataProvider, Tick

log = logging.getLogger("kabu")

PORTS = {"test": 18081, "production": 18080}      # 検証用 / 本番
ACCEPT_STATUS = {1, 2, 3, 8, 23}                   # TODO(未確認): 推測。docstring参照


class TokenInvalid(Exception):
    """401/403: トークン(APIキー)が無効。再取得が必要。"""


class KabuProvider(DataProvider):
    name = "kabu"
    capabilities = Capabilities(history=False, max_symbols=50, history_adjusted=None, pushes_every_trade=False,
                                description="kabuステーションAPI（PUSH=スナップショット方式。履歴APIなし）")

    def __init__(self, cfg: dict, base_url: Optional[str] = None, ws_url: Optional[str] = None) -> None:
        super().__init__()
        k = cfg.get("kabu", {})
        env = os.environ.get("KABU_ENV", "test").strip().lower()      # 既定は検証用
        if env not in PORTS:
            raise ValueError("KABU_ENV は test(検証用) か production(本番) のどちらか")
        host = os.environ.get("KABU_HOST", "localhost")
        port = PORTS[env]
        self.env = env
        self.base_url = base_url or f"http://{host}:{port}/kabusapi"
        self.ws_url = ws_url or f"ws://{host}:{port}/kabusapi/websocket"
        self._password = os.environ.get("KABU_API_PASSWORD", "")
        if not self._password:
            raise RuntimeError(".env に KABU_API_PASSWORD を設定してください（.env.example 参照）")
        register_secret(self._password)
        self.exchange = int(k.get("exchange", 1))
        self.backoff_min = float(k.get("reconnect_min_s", 1))
        self.backoff_max = float(k.get("reconnect_max_s", 60))
        self._token: Optional[str] = None
        self._symbols: list[str] = []
        if env == "production":
            log.warning("【本番環境】ポート %d に接続します（閲覧・記録のみ。注文は一切行いません）", port)
        else:
            log.info("検証用環境(ポート %d)に接続します", port)

    # ---------------------------------------------------------------- REST
    async def _issue_token(self, client: httpx.AsyncClient) -> None:
        r = await client.post(f"{self.base_url}/token", json={"APIPassword": self._password})
        if r.status_code != 200:
            raise ConnectionError(f"トークン発行に失敗 HTTP {r.status_code}{self._err(r)}")
        tok = r.json().get("Token")
        if not tok:
            raise ConnectionError("トークン発行の応答に Token がありません")
        self._token = tok
        register_secret(tok)
        log.info("APIトークンを取得しました")     # 値は出さない

    @staticmethod
    def _err(r: httpx.Response) -> str:
        try:
            j = r.json()
            return f" Code={j.get('Code')} Message={j.get('Message')}"
        except Exception:  # noqa: BLE001
            return ""

    async def _put(self, client: httpx.AsyncClient, path: str, symbols: list[str]) -> None:
        body = {"Symbols": [{"Symbol": s, "Exchange": self.exchange} for s in symbols]}
        r = await client.put(f"{self.base_url}{path}", json=body, headers={"X-API-KEY": self._token or ""})
        if r.status_code in (401, 403):
            raise TokenInvalid(f"HTTP {r.status_code}{self._err(r)}")
        if r.status_code != 200:
            raise ConnectionError(f"{path} 失敗 HTTP {r.status_code}{self._err(r)}")

    async def _prepare(self, symbols: list[str]) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if self._token is None:                       # 既存トークンは使い回す（再発行すると他アプリのトークンが無効になる）
                await self._issue_token(client)
            try:
                await self._put(client, "/register", symbols)
            except TokenInvalid as e:
                log.warning("トークンが無効です(%s)。再取得して登録し直します", e)
                self._token = None
                await self._issue_token(client)
                await self._put(client, "/register", symbols)
        log.info("銘柄を登録しました: %s", ",".join(symbols))

    # ---------------------------------------------------------------- PUSH
    def parse(self, raw: str | bytes) -> Optional[Tick]:
        """PUSHメッセージ(JSON) → Tick。使えないメッセージは None。"""
        try:
            m = json.loads(raw)
        except (ValueError, TypeError):
            log.warning("JSONでないPUSHメッセージを無視しました")
            return None
        if not isinstance(m, dict):
            return None
        sym = m.get("Symbol")
        price, t, vol = m.get("CurrentPrice"), m.get("CurrentPriceTime"), m.get("TradingVolume")
        if sym is None or price is None or t is None or vol is None:
            return None                                    # 気配のみの更新・未登録など
        if sym not in self._symbols:
            return None
        st = m.get("CurrentPriceStatus")
        if st is not None and st not in ACCEPT_STATUS:
            return None
        try:
            d = dt.datetime.fromisoformat(str(t))
            if d.tzinfo is None:
                d = d.replace(tzinfo=JST)
            return Tick(str(sym), d.timestamp(), float(price), float(vol),
                        _f(m.get("TradingValue")), _f(m.get("VWAP")), _f(m.get("PreviousClose")))
        except (ValueError, TypeError):
            log.warning("PUSHの時刻/数値を解釈できませんでした: %s", str(t)[:40])
            return None

    async def stream(self, symbols: list[str]) -> AsyncIterator[Tick]:
        if len(symbols) > (self.capabilities.max_symbols or 50):
            raise ValueError(f"登録できる銘柄は最大{self.capabilities.max_symbols}です（指定 {len(symbols)}）")
        self._symbols = list(symbols)
        backoff, first, lost_at = self.backoff_min, True, None
        while True:
            try:
                self.status = "connecting" if first else "reconnecting"
                await self._prepare(symbols)
                # TODO(未確認): WebSocket接続時の認証の要否（公式ページに記載なし）
                async with websockets.connect(self.ws_url, ping_interval=20, ping_timeout=20, max_size=2**22) as ws:
                    self.status = "connected"
                    log.info("PUSH接続しました")
                    if lost_at is not None and self.on_gap:
                        self.on_gap(lost_at, time.time())  # 履歴APIが無いので補完できず、足に「欠損」の印を付ける
                    lost_at, first, backoff = None, False, self.backoff_min
                    async for raw in ws:
                        tick = self.parse(raw)
                        if tick is not None:
                            yield tick
                raise ConnectionError("PUSH接続が閉じられました")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                if lost_at is None:
                    lost_at = time.time()
                self.status = "reconnecting"
                log.warning("接続エラー(%s): %s。%.1f秒後に再接続します", type(e).__name__, _safe(e), backoff)
                await asyncio.sleep(backoff * (0.8 + 0.4 * random.random()))
                backoff = min(backoff * 2, self.backoff_max)          # 指数バックオフ

    async def close(self) -> None:
        """終了時、このアプリが登録した銘柄だけを解除する（ベストエフォート）。"""
        if not (self._token and self._symbols):
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await self._put(client, "/unregister", self._symbols)
        except Exception as e:  # noqa: BLE001
            log.warning("銘柄解除に失敗: %s", _safe(e))


def _f(x) -> Optional[float]:
    try:
        return None if x is None else float(x)
    except (TypeError, ValueError):
        return None


def _safe(e: Exception) -> str:
    return str(e)[:200]
