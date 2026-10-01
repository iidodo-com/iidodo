from __future__ import annotations

from .base import Capabilities, Candle, DataProvider, Tick  # noqa: F401


def create_provider(cfg: dict, clock, store=None, after_date=None) -> DataProvider:
    name = cfg.get("provider", "mock")
    if name == "mock":
        from .mock import MockProvider
        return MockProvider(cfg, clock, after_date=after_date)
    if name == "replay":
        from .replay import ReplayProvider
        return ReplayProvider(cfg, store)
    if name == "kabu":
        from .kabu import KabuProvider
        return KabuProvider(cfg)
    if name == "tachibana":
        from .tachibana import TachibanaProvider
        return TachibanaProvider()
    raise ValueError(f"未知のプロバイダ: {name}")
