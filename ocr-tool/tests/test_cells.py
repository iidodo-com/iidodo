"""セルモード・罫線除去のテスト（Tesseract不要）。"""
import cv2
import numpy as np
import pytest

from ocr_tool import cells, preprocess
from ocr_tool.config import load_config
from ocr_tool.engine import Line, PageOCR, is_noise
from ocr_tool.errors import OcrToolError


def grid_page(rows=2, cols=3, dashed=False):
    """罫線の表（rows × cols）と、各マスの中の文字に見立てた黒い矩形。"""
    img = np.full((1400, 1800), 255, np.uint8)
    x0, y0, cw, ch = 150, 200, 450, 300
    for r in range(rows + 1):
        cv2.line(img, (x0, y0 + r * ch), (x0 + cols * cw, y0 + r * ch), 0, 5)
    for c in range(cols + 1):
        cv2.line(img, (x0 + c * cw, y0), (x0 + c * cw, y0 + rows * ch), 0, 5)
    for r in range(rows):
        for c in range(cols):
            cv2.rectangle(img, (x0 + c * cw + 60, y0 + r * ch + 100), (x0 + c * cw + 160, y0 + r * ch + 160), 0, -1)
    return img


def test_detect_cells_finds_grid():
    found = cells.detect_cells(grid_page(2, 3))
    assert len(found) == 6
    xs = sorted({c[0] for c in found})
    assert len(xs) == 3 and all(abs((c[2] - c[0]) - 445) < 15 for c in found)


def test_detect_cells_ignores_plain_text_page():
    img = np.full((1400, 1000), 255, np.uint8)
    for r in range(10):
        for c in range(12):
            cv2.rectangle(img, (80 + c * 60, 100 + r * 90), (80 + c * 60 + 40, 100 + r * 90 + 40), 0, -1)
    assert cells.detect_cells(img) == []


def test_detect_cells_rejects_noise_page():
    img = np.full((1400, 1000), 90, np.uint8)  # 真っ黒に近い（影）→ 罫線とは認めない
    assert cells.detect_cells(img) == []


def test_group_rows_orders_top_to_bottom_left_to_right():
    cs = [(300, 10, 400, 100), (10, 12, 200, 100), (10, 200, 200, 300)]
    rows = cells._group_rows(cs)
    assert [[c[0] for c in r] for r in rows] == [[10, 300], [10]]


def test_remove_lines_keeps_text_blocks():
    img = grid_page(1, 1)
    out = preprocess.remove_lines(img)
    assert np.count_nonzero(out[290:370, 200:320] < 128) > 5000     # 文字に見立てた矩形（100×60）は残る
    border = img[198:203, 160:580]
    assert np.count_nonzero(border < 128) > 0 and np.count_nonzero(out[198:203, 160:580] < 128) == 0


def test_remove_lines_removes_dashed_vertical_lines():
    img = np.full((600, 600), 255, np.uint8)
    for y in range(50, 500, 16):
        cv2.line(img, (300, y), (300, y + 10), 0, 3)  # 点線
    cv2.rectangle(img, (100, 200), (160, 240), 0, -1)  # 文字に見立てた塊
    out = preprocess.remove_lines(img)
    assert np.count_nonzero(out[:, 295:306] < 128) == 0 and out[220, 130] < 128


def test_cells_joined_with_pipes_and_multiline_cells_kept():
    def ln(text, row):
        return Line(1, text, 90, 90, (0, 0, 1, 1), row_id=row, is_cell=True)
    page = PageOCR([ln("品名", 0), ln("数量", 0), ln("鉛筆", 1), ln("株式会社\n東京本社", 1), ln("計", 2)])
    assert page.text == "品名 | 数量\n鉛筆\n株式会社\n東京本社\n計"


def test_noise_lines():
    assert is_noise("| ' 「") and is_noise("ーー") and not is_noise("金額")


def test_layout_config_validation(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("layout:\n  mode: tables\n", encoding="utf-8")
    with pytest.raises(OcrToolError) as e:
        load_config(p)
    assert "layout.mode" in str(e.value)
    assert load_config(None)["layout"]["mode"] == "auto" and load_config(None)["preprocess"]["remove_lines"] is True
