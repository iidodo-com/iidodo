"""単体テスト（Tesseract不要）。"""
import csv

import cv2
import numpy as np
import pytest

from ocr_tool import config as C
from ocr_tool.engine import Line, PageOCR, Word, clean_cjk_spaces, parse_tsv_data
from ocr_tool.errors import OcrToolError
from ocr_tool.metrics import cer, edit_distance
from ocr_tool.pipeline import output_dir_for
from ocr_tool.preprocess import deskew, estimate_skew, preprocess
from ocr_tool.review import HEADER, ReviewWriter, review_rows
from pathlib import Path


def text_page(angle=0.0, vertical=False):
    """文字行に見立てた黒い矩形を並べた画像（フォント不要）。"""
    img = np.full((900, 700), 255, np.uint8)
    for r in range(12):
        for c in range(14):
            x, y = 60 + c * 42, 60 + r * 62
            cv2.rectangle(img, (x, y), (x + 28, y + 36), 0, -1)
    if vertical:
        img = img.T.copy()
    m = cv2.getRotationMatrix2D((350, 450), angle, 1.0)
    return cv2.warpAffine(img, m, (700, 900), borderValue=255)


def test_cjk_space_removed_but_english_kept():
    assert clean_cjk_spaces("日 本 語 の hello world 文 字") == "日本語の hello world 文字"


def test_cer():
    assert edit_distance("abc", "abd") == 1
    assert cer("あいう え", "あいうえ") == 0
    assert cer("あいうえ", "あいう") == pytest.approx(0.25)
    assert cer("", "") == 0


@pytest.mark.parametrize("angle", [-6.0, 3.0, 10.0])
def test_estimate_skew_recovers_angle(angle):
    est = estimate_skew(text_page(angle))
    assert est == pytest.approx(-angle, abs=0.4)


def test_estimate_skew_vertical():
    est = estimate_skew(text_page(4.0, vertical=True), vertical=True)
    assert est == pytest.approx(-4.0, abs=0.4)


def test_blank_page_not_rotated():
    out, ang = deskew(np.full((500, 400), 255, np.uint8))
    assert ang == 0.0 and out.shape == (500, 400)


def test_preprocess_toggle():
    img = text_page(2.0)
    same, applied = preprocess(img, {**C.DEFAULTS["preprocess"], "enabled": False})
    assert same is img and applied == {}
    out, applied = preprocess(img, {**C.DEFAULTS["preprocess"], "binarize": "otsu"})
    assert set(np.unique(out)) <= {0, 255} and applied["binarize"] == "otsu"


def test_config_defaults_and_yaml_off_is_none(tmp_path):
    p = tmp_path / "c.yaml"
    p.write_text("preprocess:\n  denoise: off\n  binarize: no\nocr:\n  language: jpn_vert\n", encoding="utf-8")
    cfg = C.load_config(p)
    assert cfg["preprocess"]["denoise"] == "none"
    assert cfg["preprocess"]["binarize"] == "none"
    assert C.is_vertical(cfg)


@pytest.mark.parametrize("text,needle", [
    ("preproces:\n  enabled: true\n", "未知の項目"),
    ("review:\n  threshold: 150\n", "review.threshold"),
    ("preprocess:\n  denoise: gauss\n", "preprocess.denoise"),
    ("ocr:\n  language: 'jpn jpn_vert'\n", "ocr.language"),
    ("preprocess:\n  deskew: maybe\n", "preprocess.deskew"),
    ("a: [", "書式エラー"),
])
def test_config_errors_are_japanese(tmp_path, text, needle):
    p = tmp_path / "c.yaml"
    p.write_text(text, encoding="utf-8")
    with pytest.raises(OcrToolError) as e:
        C.load_config(p)
    assert needle in str(e.value) and e.value.hint


def test_parse_tsv_groups_lines_and_confidence():
    d = {k: [] for k in "level page_num block_num par_num line_num left top width height conf text".split()}

    def add(level, par, line, text, conf, left=0):
        for k, v in zip(d, [level, 1, 1, par, line, left, 10, 20, 20, conf, text]):
            d[k].append(v)

    add(4, 1, 1, "", -1)                 # 行レベルの行は無視される
    add(5, 1, 1, "日 本", 90, 0)
    add(5, 1, 1, "語", 50, 30)
    add(5, 2, 1, "次の段落", 80)
    add(5, 2, 1, "  ", 95)               # 空白だけの単語は無視
    page = parse_tsv_data(d)
    assert [l.text for l in page.lines] == ["日本語", "次の段落"]
    assert page.lines[0].conf == pytest.approx((90 * 2 + 50) / 3)
    assert page.lines[0].min_conf == 50
    assert page.lines[1].new_paragraph and page.text == "日本語\n\n次の段落"


def test_review_rows_and_csv(tmp_path):
    page = PageOCR([
        Line(1, "良い行", 95, 90, (0, 0, 10, 10), [Word("良い行", 95, (0, 0, 10, 10))]),
        Line(2, "怪しい行", 40, 20, (0, 20, 10, 10), [Word("怪しい", 60, (0, 20, 5, 10)), Word("行", 20, (5, 20, 5, 10))]),
    ])
    rows = review_rows("a.png", 1, page, 70, word_level=True)
    assert [r[3] for r in rows] == ["行", "単語", "単語"]
    assert [r[4] for r in rows] == ["怪しい行", "怪しい", "行"]
    assert review_rows("a.png", 2, PageOCR([]), 70)[0][7].startswith("文字が検出されませんでした")
    with ReviewWriter(tmp_path / "r.csv") as w:
        w.write(rows)
    got = list(csv.reader(open(tmp_path / "r.csv", encoding="utf-8-sig", newline="")))
    assert got[0] == HEADER and len(got) == 4


def test_output_dir_has_no_collision():
    root, out = Path("in"), Path("out")
    assert output_dir_for(root / "a.png", root, out) != output_dir_for(root / "a.pdf", root, out)
    assert output_dir_for(root / "sub" / "a.png", root, out).name == "sub__a_png"
