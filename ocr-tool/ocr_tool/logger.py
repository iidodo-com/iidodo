"""エラーログ（out/error.log）の設定。"""
import logging
from pathlib import Path


def setup_error_log(out_dir: Path) -> Path:
    """失敗の記録先を out/error.log にする（実行ごとに追記、UTF-8）。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "error.log"
    log = logging.getLogger("ocr_tool")
    log.setLevel(logging.INFO)
    log.handlers.clear()
    h = logging.FileHandler(path, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    log.addHandler(h)
    log.propagate = False
    return path
