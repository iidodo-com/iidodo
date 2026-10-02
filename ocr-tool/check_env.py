"""Tesseract と日本語データが使えるかを確認する（setup.bat から呼ばれる）。"""
import sys

from ocr_tool import engine
from ocr_tool.config import load_config
from ocr_tool.errors import OcrToolError

try:
    cfg = load_config("config.yaml")
    version = engine.setup_tesseract(cfg)
    langs = cfg["ocr"]["language"]
    print(f"OK: Tesseract {version}、言語 {langs} を使えます。")
    try:
        import pytesseract
        has_vert = "jpn_vert" in pytesseract.get_languages(config="")
    except Exception:
        has_vert = False
    if not has_vert:
        print("注意: jpn_vert（縦書き）は未導入です。縦書きを読むときは README.md の手順で追加してください。")
except OcrToolError as e:
    print(f"未完了: {e.message}\n  対処: {e.hint}")
    sys.exit(1)
