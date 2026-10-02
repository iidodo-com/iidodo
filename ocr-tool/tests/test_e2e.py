"""結合テスト：Tesseract(jpn) が入っている環境でのみ実行。失敗ファイルがあっても止まらないことを確認する。"""
import csv
import shutil

import cv2
import numpy as np
import pytest

import main
from ocr_tool import engine
from ocr_tool.config import load_config

pytestmark = pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseractが未導入")


def _have_jpn():
    try:
        engine.setup_tesseract(load_config(None))
        return True
    except Exception:
        return False


@pytest.mark.skipif(not _have_jpn(), reason="jpn言語データが未導入")
def test_run_survives_bad_files(tmp_path):
    src, out = tmp_path / "in", tmp_path / "out"
    src.mkdir()
    cv2.imwrite(str(src / "blank.png"), np.full((600, 800), 255, np.uint8))
    (src / "broken.png").write_bytes(b"not an image")
    (src / "broken.pdf").write_bytes(b"%PDF-1.4 broken")
    (src / "日本語名.png").write_bytes(cv2.imencode(".png", np.full((600, 800), 255, np.uint8))[1].tobytes())
    code = main.main(["--input", str(src), "--output", str(out)])
    assert code == 1  # 失敗あり
    log = (out / "error.log").read_text(encoding="utf-8")
    assert "broken.png" in log and "broken.pdf" in log
    rows = list(csv.reader(open(out / "review.csv", encoding="utf-8-sig", newline="")))
    assert len(rows) >= 3  # ヘッダ + 白紙2枚の「文字なし」行
    assert (out / "日本語名_png" / "all.txt").exists()


def test_missing_input_folder_is_error_code_2(tmp_path):
    assert main.main(["--input", str(tmp_path / "nope"), "--output", str(tmp_path / "o")]) == 2
