"""手書きモードのテスト。torch/manga-ocr が無くても動くよう、読み取り部分は偽物に差し替える。"""
import cv2
import numpy as np
import pytest
from PIL import Image

from ocr_tool import form, handwriting, loader, pipeline
from ocr_tool.config import load_config
from ocr_tool.errors import OcrToolError
from ocr_tool.form import FieldSpec


class FakeReader:
    """画像の幅に応じた文字を返す偽のモデル。呼ばれた回数と画像の大きさを記録する。"""

    def __init__(self):
        self.calls = []

    def read(self, img: Image.Image):
        self.calls.append(img.size)
        return f"文字{len(self.calls)}", 90.0, 60.0


def handwritten_page(lines=3):
    img = np.full((1200, 900), 255, np.uint8)
    for i in range(lines):
        y = 150 + i * 300
        for x in range(150, 700, 70):  # 文字に見立てた縦長の塊を並べる
            cv2.rectangle(img, (x, y), (x + 40, y + 90), 0, -1)
    return img


def test_segment_lines_finds_each_line_top_to_bottom():
    boxes = handwriting.segment_lines(handwritten_page(3))
    assert len(boxes) == 3
    assert [b[1] for b in boxes] == sorted(b[1] for b in boxes)
    assert all(b[0] <= 150 and b[2] >= 670 for b in boxes)


def test_segment_lines_ignores_specks_and_blank():
    img = np.full((600, 600), 255, np.uint8)
    img[300:303, 300:303] = 0  # ゴミ点だけ
    assert handwriting.segment_lines(img) == []


def test_wide_line_is_split_at_gaps():
    bw = np.zeros((100, 2000), np.uint8)
    for x in range(0, 2000, 80):
        bw[10:90, x:x + 40] = 255
    pieces = handwriting.split_wide(bw, 0, 1960, 0, 100)
    assert len(pieces) >= 2 and all((b - a) <= 100 * handwriting.MAX_ASPECT + 80 for a, b in pieces)
    assert pieces[0][0] == 0 and pieces[-1][1] == 1960


def test_read_crop_joins_pieces_and_reports_min_confidence():
    r = FakeReader()
    img = np.full((100, 2000), 255, np.uint8)
    for x in range(0, 2000, 80):
        cv2.rectangle(img, (x + 10, 10), (x + 50, 90), 0, -1)
    text, mean, mn, words = handwriting.read_crop(img, r)
    assert len(r.calls) >= 2 and text.startswith("文字1文字2") and mean == 90.0 and mn == 60.0 and len(words) == len(r.calls)


def test_recognize_page_builds_lines(monkeypatch):
    r = FakeReader()
    monkeypatch.setattr(handwriting, "get_reader", lambda model_dir=None: r)
    cfg = load_config(None)
    page = handwriting.recognize_page(handwritten_page(2), cfg)
    assert [ln.text for ln in page.lines] == ["文字1", "文字2"]
    assert page.lines[0].conf == 90.0 and page.lines[0].min_conf == 60.0


def test_pipeline_uses_handwriting_engine_and_makes_no_pdf(monkeypatch):
    monkeypatch.setattr(handwriting, "get_reader", lambda model_dir=None: FakeReader())
    cfg = load_config(None)
    cfg["ocr"]["engine"] = "handwriting"
    bgr = cv2.cvtColor(handwritten_page(2), cv2.COLOR_GRAY2BGR)
    res = pipeline.ocr_page(loader.PageImage(bgr, 1, 1, 300), cfg, want_pdf=True)
    assert res.pdf_bytes is None and res.applied["engine"] == "handwriting" and len(res.ocr.lines) == 2


def test_handwritten_field_uses_handwriting_when_enabled(monkeypatch):
    monkeypatch.setattr(handwriting, "get_reader", lambda model_dir=None: FakeReader())
    cfg = load_config(None)
    cfg["handwriting"]["enabled"] = True
    gray = np.full((600, 800), 255, np.uint8)
    cv2.rectangle(gray, (100, 100), (140, 180), 0, -1)
    spec = FieldSpec("d", "日付", (0, 0, 1000, 1000), type="text", handwritten=True)
    r = form._read_handwritten(gray, spec, (50, 50, 400, 300), cfg)
    assert r.handwritten and r.text == "文字1" and r.conf == 90.0 and any("手書き用モデル" in p for p in r.problems)


def test_missing_libraries_give_japanese_error():
    pytest.importorskip("numpy")
    try:
        import manga_ocr  # noqa: F401
        pytest.skip("manga-ocr が入っている環境")
    except ImportError:
        pass
    with pytest.raises(OcrToolError) as e:
        handwriting.check(load_config(None))
    assert "setup_handwriting.bat" in e.value.hint


def test_engine_config_validation(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("ocr:\n  engine: gpt\n", encoding="utf-8")
    with pytest.raises(OcrToolError) as e:
        load_config(p)
    assert "ocr.engine" in str(e.value)
    assert load_config(None)["handwriting"]["enabled"] is False
