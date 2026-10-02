"""帳票突合のテスト。Tesseract不要のもの＋合成帳票でのE2E（フォント・Tesseractがあれば）。"""
import shutil
from pathlib import Path

import cv2
import numpy as np
import pytest

from ocr_tool import form, matching
from ocr_tool.config import load_config
from ocr_tool.errors import OcrToolError
from ocr_tool.form import FieldResult, FieldSpec, Template
from ocr_tool.normalize import normalize_digits, normalize_text, parse_amount, parse_date_jp

ROOT = Path(__file__).resolve().parents[1]


# ---------------------------------------------------------------- 正規化
@pytest.mark.parametrize("text,expected", [
    ("\\11,000 昌", 11000), ("¥11.000", 11000), ("WO 円", 0), ("￥１２，０００円", 12000), ("", None), ("円", None),
])
def test_parse_amount(text, expected):
    assert parse_amount(text) == expected


def test_parse_date_jp():
    assert parse_date_jp("令和8年9月25日") == (2026, 9, 25)
    assert parse_date_jp("R8.9.25") == (2026, 9, 25)
    assert parse_date_jp("令和元年5月1日") == (2019, 5, 1)
    assert parse_date_jp("2026/9/25") == (2026, 9, 25)
    assert parse_date_jp("令和 年 月 日") is None


def test_normalize():
    assert normalize_text("ｶ)ﾃｲｰｶﾞｲｱ") == normalize_text("カ)テイーガイア")
    assert normalize_text("広島市 中区　8番") == normalize_text("広島市中区８番")
    assert normalize_digits("O1OO-OOｏ") == "0100-000"


# ---------------------------------------------------------------- テンプレート
def test_sample_template_loads():
    tpl = form.load_template(ROOT / "templates" / "hiroshima_invoice.yaml")
    assert len(tpl.fields) >= 15 and any(f.handwritten for f in tpl.fields)


@pytest.mark.parametrize("yaml_text,needle", [
    ("fields: []\n", "項目(fields)がありません"),
    ("fields:\n  - {id: a, box: [10, 10, 5, 20]}\n", "不正"),
    ("fields:\n  - {id: a, box: [0, 0, 5, 5], type: foo}\n", "type"),
    ("fields:\n  - {id: a, box: [0, 0, 5, 5]}\n  - {id: a, box: [0, 0, 5, 5]}\n", "重複"),
])
def test_template_errors(tmp_path, yaml_text, needle):
    p = tmp_path / "t.yaml"
    p.write_text(yaml_text, encoding="utf-8")
    with pytest.raises(OcrToolError) as e:
        form.load_template(p)
    assert needle in str(e.value)


# ---------------------------------------------------------------- 枠の検出と座標変換
def framed_page(dx=0, dy=0, scale=1.0):
    img = np.full((1400, 1000), 255, np.uint8)
    x0, y0, x1, y1 = int((100 + dx) * scale), int((150 + dy) * scale), int((900 + dx) * scale), int((1100 + dy) * scale)
    cv2.rectangle(img, (x0, y0), (x1, y1), 0, 5)
    cv2.line(img, (x0, y0 + 200), (x1, y0 + 200), 0, 4)
    cv2.line(img, (x0 + 300, y0), (x0 + 300, y0 + 200), 0, 4)
    return img


def test_detect_frame_and_box_follow_shift():
    a = form.detect_frame(framed_page())
    b = form.detect_frame(framed_page(dx=37, dy=21))
    assert abs(b[0] - a[0] - 37) <= 3 and abs(b[1] - a[1] - 21) <= 3 and abs(a[2] - 800) <= 4
    spec = FieldSpec("x", "x", (100, 50, 400, 150))
    ba = form.field_box_px(spec, a, (1400, 1000))
    bb = form.field_box_px(spec, b, (1400, 1000))
    assert abs((bb[0] - ba[0]) - 37) <= 3 and abs((bb[1] - ba[1]) - 21) <= 3


def test_detect_frame_fails_with_japanese_error():
    with pytest.raises(OcrToolError) as e:
        form.detect_frame(np.full((800, 600), 255, np.uint8))
    assert "外枠" in str(e.value) and e.value.hint


# ---------------------------------------------------------------- 突合判定
def fr(id, value, text="", conf=90.0, readings=None, hand=False, problems=None, is_text=False):
    return FieldResult(id, id, text or str(value), value, conf, hand, problems or [], None, None,
                       readings if readings is not None else [(text or str(value), value, conf)], is_text)


def tpl_of(**fields):
    return Template("t", [], [], {"fields": fields})


def judge(results, mapping, ref):
    return {j.id: j for j in matching.judge_document(results, tpl_of(**mapping), ref)}


def test_amount_and_digits_judgement():
    m = {"amount": {"column": "金額", "rule": "amount"}, "acc": {"column": "口座", "rule": "digits"}}
    j = judge([fr("amount", 11000), fr("acc", "8483089")], m, {"金額": "11,000", "口座": "8483080"})
    assert j["amount"].status == matching.OK
    assert j["acc"].status == matching.NG and "8483089" in j["acc"].reason


def test_handwritten_is_never_auto_ok():
    m = {"d": {"column": "日付", "rule": "date"}}
    j = judge([fr("d", (2026, 9, 25), hand=True)], m, {"日付": "2026-09-25"})
    assert j["d"].status == matching.HAND and "一致" in j["d"].reason


def test_empty_is_flagged():
    j = judge([FieldResult("a", "a", "", None, None, False, ["読み取れませんでした"], None, None)], {"a": {"column": "A"}}, {"A": "x"})
    assert j["a"].status == matching.EMPTY


def test_other_readings_downgrade_ng_to_review_or_ok():
    m = {"s": {"column": "S", "rule": "contains"}}
    one_of_three = [("ペーパーシレス", "ペーパーシレス", 80), ("ペーパーシレス", "ペーパーシレス", 80), ("ペーパーレス", "ペーパーレス", 80)]
    j = judge([fr("s", "ペーパーシレス", readings=one_of_three, is_text=True)], m, {"S": "ペーパーレス"})
    assert j["s"].status == matching.REVIEW
    two_of_three = [one_of_three[0], one_of_three[2], one_of_three[2]]
    j = judge([fr("s", "ペーパーシレス", readings=two_of_three, is_text=True)], m, {"S": "ペーパーレス"})
    assert j["s"].status == matching.OK


def test_low_confidence_text_mismatch_is_review_not_ng():
    m = {"n": {"column": "N", "rule": "text"}}
    j = judge([fr("n", "がが", conf=20, is_text=True)], m, {"N": "カ)ティーガイア"})
    assert j["n"].status == matching.REVIEW


def test_consistency_check():
    tpl = Template("t", [], [{"name": "合計", "expr": "a == b + c"}], {})
    ok = matching._checks([fr("a", 11000), fr("b", 11000), fr("c", 0)], tpl)[0][0]
    ng = matching._checks([fr("a", 12000), fr("b", 11000), fr("c", 0)], tpl)[0][0]
    unknown = matching._checks([fr("a", 12000), fr("b", None), fr("c", 0)], tpl)[0][0]
    assert (ok.status, ng.status, unknown.status) == (matching.OK, matching.NG, matching.REVIEW)
    with pytest.raises(OcrToolError):
        matching._checks([], Template("t", [], [{"expr": "__import__('os')"}], {}))


def test_verified_by_check_skips_low_confidence_flags():
    tpl = Template("t", [], [{"name": "合計", "expr": "a == b + c"}], {})
    rs = [fr("a", 11000, conf=16, problems=["読み取り方によって結果が揺れました（2/4件が同じ）"]), fr("b", 11000, conf=80), fr("c", 0, conf=40)]
    j = {x.id: x for x in matching.judge_document(rs, tpl, None)}
    assert j["a"].status == matching.SKIP and j["c"].status == matching.SKIP
    rs[2] = fr("c", 1, conf=40)  # 計算が合わなければ、確認済みにならない
    j = {x.id: x for x in matching.judge_document(rs, tpl, None)}
    assert j["a"].status == matching.REVIEW


def test_invalid_handwritten_date_is_none():
    assert parse_date_jp("令和 9 年月 95") is None and parse_date_jp("2027-04-95") is None


def test_find_reference_row():
    rows = [{"番号": "0000001234-000"}, {"番号": "0000009999-000"}]
    assert matching.find_reference_row(rows, "番号", "0000001234-000")[2] == "exact"
    row, note, conf = matching.find_reference_row(rows, "番号", "0000001284-000")
    assert conf == "near" and row == rows[0] and "完全一致しません" in note
    assert matching.find_reference_row(rows, "番号", "1111111111-111")[2] == "none"
    with pytest.raises(OcrToolError):
        matching.find_reference_row(rows, "無い列", "x")


def test_load_reference_encodings(tmp_path):
    text = "番号,名前\n1,広島\n"
    for enc in ("utf-8-sig", "cp932"):
        p = tmp_path / f"r_{enc}.csv"
        p.write_bytes(text.encode(enc))
        assert matching.load_reference(p)[0]["名前"] == "広島"


# ---------------------------------------------------------------- E2E（合成帳票）
FONT = Path("/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf")


@pytest.mark.skipif(shutil.which("tesseract") is None or not FONT.exists(), reason="Tesseractまたは日本語フォントが未導入")
def test_end_to_end_synthetic_form(tmp_path):
    from PIL import Image, ImageDraw, ImageFont
    from ocr_tool import engine

    cfg = load_config(None)
    try:
        engine.setup_tesseract(cfg)
    except OcrToolError:
        pytest.skip("jpn言語データが未導入")
    im = Image.new("L", (2480, 3508), 255)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(str(FONT), 60)
    d.rectangle([250, 450, 2240, 1100], outline=0, width=6)
    d.text((300, 500), "請求金額", font=f, fill=0)
    d.text((1500, 500), "¥11,000円", font=f, fill=0)
    d.text((300, 700), "三井住友銀行", font=f, fill=0)
    d.text((300, 900), "8483089", font=f, fill=0)
    arr = np.asarray(im.rotate(1.0, fillcolor=255))
    tpl = Template("t", [
        FieldSpec("amount", "金額", (600, 10, 960, 110), type="amount"),
        FieldSpec("bank", "銀行", (20, 120, 500, 210), type="text"),
        FieldSpec("acc", "口座", (20, 230, 500, 330), type="digits"),
    ], [], {})
    res, frame, angle = form.read_form(cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR), tpl, cfg, 300)
    got = {r.id: r.value for r in res}
    assert got["amount"] == 11000 and got["bank"] == "三井住友銀行" and got["acc"] == "8483089"
    assert abs(angle) > 0.3  # 傾きを補正している
