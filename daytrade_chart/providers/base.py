"""データ層の抽象。プロバイダを差し替えても core 側は変更不要。"""
from __future__ import annotations

import datetime as dt
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import AsyncIterator, Callable, Optional


@dataclass
class Tick:
    symbol: str                      # 英数字コード可（285A 等）。int変換しない
    timestamp: float                 # UTCエポック秒
    price: float
    cum_volume: float                # 当日累計売買高（株）
    cum_value: Optional[float] = None    # 当日累計売買代金（円）
    vendor_vwap: Optional[float] = None  # 配信元が提供するVWAP（検証用）
    prev_close: Optional[float] = None   # 前日終値（配信されれば）。※仕様書記載項目への追加フィールド


@dataclass
class Candle:
    symbol: str
    t: int
    o: float
    h: float
    l: float
    c: float
    v: float


@dataclass(frozen=True)
class Capabilities:
    history: bool = False                    # 過去ローソク足を取得できるか
    max_symbols: Optional[int] = None        # 1度に登録できる銘柄数の上限
    history_adjusted: Optional[bool] = None  # 履歴が分割調整済みか（None=不明/履歴なし）
    pushes_every_trade: Optional[bool] = None  # 全約定が届くか（False/None=スナップショット方式で取りこぼしあり得る）
    description: str = ""


class DataProvider(ABC):
    name: str = "base"
    capabilities: Capabilities = Capabilities()

    def __init__(self) -> None:
        # connecting / connected / reconnecting / disconnected / idle
        self.status: str = "idle"
        # 再接続後に main がセットする: on_gap(欠損開始ts, 欠損終了ts)
        self.on_gap: Optional[Callable[[float, float], None]] = None

    @abstractmethod
    def stream(self, symbols: list[str]) -> AsyncIterator[Tick]:
        """Tick を yield し続ける非同期ジェネレータ（`async def` + `yield` で実装する）。"""

    async def fetch_history(self, symbol: str, interval: str, start: dt.datetime, end: dt.datetime) -> list[Candle]:
        """過去ローソク足（取得できるプロバイダのみ実装）。"""
        raise NotImplementedError(f"{self.name} は履歴取得に対応していません")

    def now(self) -> float:
        """このプロバイダの「データ上の現在時刻」(UTCエポック秒)。リプレイ・モックでは仮想時計。"""
        import time
        return time.time()

    async def close(self) -> None:
        return None
