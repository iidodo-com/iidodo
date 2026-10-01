"""立花証券 e支店 API 用のスタブ（未実装）。

将来の追加を想定し、DataProvider のインターフェースだけを合わせてある。
接続方式・認証・エンドポイント・メッセージ項目はまだ公式ドキュメントで確認していないため、一切書いていない。
実装する場合は README の「プロバイダを追加する手順」を参照。
"""
from __future__ import annotations

import datetime as dt
from typing import AsyncIterator

from .base import Candle, Capabilities, DataProvider, Tick


class TachibanaProvider(DataProvider):
    name = "tachibana"
    capabilities = Capabilities(history=False, max_symbols=None, description="スタブ（未実装）")

    def __init__(self, *args, **kwargs) -> None:
        super().__init__()

    async def stream(self, symbols: list[str]) -> AsyncIterator[Tick]:
        # TODO(未確認): 立花証券 e支店 API の接続方式・認証・配信項目を公式ドキュメントで確認してから実装する
        raise NotImplementedError("tachibana プロバイダは未実装です")
        yield  # pragma: no cover  (async generator にするための記述)

    async def fetch_history(self, symbol: str, interval: str, start: dt.datetime, end: dt.datetime) -> list[Candle]:
        raise NotImplementedError("tachibana プロバイダは未実装です")
