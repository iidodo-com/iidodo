"""設定の読み込み。config.yaml を既定値にマージし、環境変数で一部上書きする。"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

BASE_DIR = Path(__file__).resolve().parent.parent


def load_config(path: str | os.PathLike | None = None) -> dict[str, Any]:
    p = Path(path) if path else Path(os.environ.get("APP_CONFIG", BASE_DIR / "config.yaml"))
    with open(p, encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    # 環境変数による上書き（文字列キー・型に注意）
    if os.environ.get("PROVIDER"):
        cfg["provider"] = os.environ["PROVIDER"].strip().lower()
    if os.environ.get("REPLAY_SPEED"):
        cfg.setdefault("replay", {})["speed"] = float(os.environ["REPLAY_SPEED"])
    if os.environ.get("REPLAY_DATE"):
        cfg.setdefault("replay", {})["date"] = os.environ["REPLAY_DATE"]
    if os.environ.get("MOCK_SPEED"):
        cfg.setdefault("mock", {})["speed"] = float(os.environ["MOCK_SPEED"])
    if os.environ.get("DB_PATH"):
        cfg["db_path"] = os.environ["DB_PATH"]
    # 銘柄コードは必ず文字列にする（YAMLで 6501 と書かれても str 化。285A はもともと文字列）
    for s in cfg.get("symbols", []):
        s["code"] = str(s["code"])
    return cfg


def resolve_path(cfg: dict[str, Any], key: str) -> Path:
    p = Path(cfg[key])
    return p if p.is_absolute() else BASE_DIR / p
