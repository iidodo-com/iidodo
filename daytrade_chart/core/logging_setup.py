"""logging 設定: 標準出力 + logs/ のファイル。認証情報・トークンは出力しない（登録された秘密値をマスクする）。"""
from __future__ import annotations

import logging
import logging.handlers
from pathlib import Path

_SECRETS: set[str] = set()


def register_secret(value: str | None) -> None:
    """ログに出してはいけない文字列（APIパスワード・トークン）を登録する。出力時に *** に置換される。"""
    if value and len(value) >= 4:
        _SECRETS.add(value)


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if _SECRETS:
            msg = record.getMessage()
            red = msg
            for s in _SECRETS:
                red = red.replace(s, "***")
            if red != msg:
                record.msg, record.args = red, None
        return True


def setup_logging(log_dir: Path, level: int = logging.INFO) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(level)
    for h in list(root.handlers):
        if getattr(h, "_daytrade", False):
            root.removeHandler(h)
    handlers = [logging.StreamHandler(), logging.handlers.RotatingFileHandler(
        log_dir / "app.log", maxBytes=5_000_000, backupCount=5, encoding="utf-8")]
    anomaly = logging.handlers.RotatingFileHandler(log_dir / "anomaly.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    anomaly.addFilter(lambda r: r.name == "anomaly")
    handlers.append(anomaly)
    for h in handlers:
        h.setFormatter(fmt)
        h.addFilter(RedactFilter())
        h._daytrade = True  # type: ignore[attr-defined]
        root.addHandler(h)
    logging.getLogger("httpx").setLevel(logging.WARNING)   # URLにトークンが載る可能性を避ける
    logging.getLogger("websockets").setLevel(logging.WARNING)
