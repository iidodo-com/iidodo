"""クラウドOCRのテスト。実際のサービスには接続せず、サービスの応答（公式ドキュメントの形式）を模した手元のサーバーで検証する。
※ 実キー・実サービスでの動作は未確認（README参照）。"""
import json
import shutil
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import cv2
import numpy as np
import pytest

from ocr_tool import cloud, form, loader, pipeline
from ocr_tool.cloud import CWord
from ocr_tool.config import load_config
from ocr_tool.errors import OcrToolError
from ocr_tool.form import FieldSpec

# ---- 応答の見本（Google images:annotate / Azure Image Analysis 4.0 の形式）
def gsym(t, brk=None):
    s = {"text": t, "confidence": 0.99}
    if brk:
        s["property"] = {"detectedBreak": {"type": brk}}
    return s


def gword(syms, box, conf=0.97):
    x0, y0, x1, y1 = box
    return {"symbols": syms, "confidence": conf,
            "boundingBox": {"vertices": [{"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}]}}


GOOGLE = {"responses": [{"fullTextAnnotation": {"pages": [{"blocks": [{"paragraphs": [{"words": [
    gword([gsym("請"), gsym("求"), gsym("書", "SPACE")], (100, 100, 400, 160)),
    gword([gsym("金"), gsym("額", "EOL_SURE_SPACE")], (500, 100, 700, 160)),
    gword([gsym("¥"), gsym("1"), gsym("1"), gsym(","), gsym("0"), gsym("0"), gsym("0", "LINE_BREAK")], (100, 300, 600, 360), 0.9),
    gword([gsym("A"), gsym("B", "SPACE")], (100, 500, 200, 560)),
    gword([gsym("C"), gsym("D", "LINE_BREAK")], (220, 500, 320, 560)),
]}]}]}]}}]}


def azure_word(t, box, conf=0.99):
    x0, y0, x1, y1 = box
    return {"text": t, "boundingPolygon": [{"x": x0, "y": y0}, {"x": x1, "y": y0}, {"x": x1, "y": y1}, {"x": x0, "y": y1}], "confidence": conf}


AZURE = {"modelVersion": "2024-02-01", "metadata": {"width": 1000, "height": 800}, "readResult": {"blocks": [{"lines": [
    {"text": "請求書 金額", "boundingPolygon": [], "words": [azure_word("請求書", (100, 100, 400, 160)), azure_word("金額", (500, 100, 700, 160))]},
    {"text": "¥11,000", "boundingPolygon": [], "words": [azure_word("¥11,000", (100, 300, 600, 360), 0.8)]},
]}]}}


class Mock:
    """手元のHTTPサーバー。受け取ったリクエストを記録し、用意した応答を順に返す。"""

    def __init__(self, replies):
        self.replies, self.requests = list(replies), []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                outer.requests.append({"path": self.path, "headers": dict(self.headers), "body": body})
                status, payload = outer.replies.pop(0) if len(outer.replies) > 1 else outer.replies[0]
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *a):
                pass

        self.srv = HTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.srv.server_port}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()


@pytest.fixture
def cfg(tmp_path):
    c = load_config(None)
    c["cloud"]["allow_upload"] = True
    c["cloud"]["usage_file"] = str(tmp_path / "usage.json")
    c["cloud"]["google"]["api_key"] = "KEY123"
    c["cloud"]["azure"].update(endpoint="http://127.0.0.1:1", key="AZKEY")
    return c


@pytest.fixture
def img():
    return np.full((800, 1000, 3), 255, np.uint8)


# ---------------------------------------------------------------- 解析
def test_parse_google_words_lines_and_spaces():
    words = cloud.parse_google(GOOGLE)
    assert [w.text for w in words] == ["請求書", "金額", "¥11,000", "AB", "CD"]
    page = cloud.words_to_page(words)
    assert [ln.text for ln in page.lines] == ["請求書金額", "¥11,000", "AB CD"]  # 日本語は空白なし、英字の語間だけ空白
    assert page.lines[0].box[:2] == (100, 100) and page.lines[1].conf == pytest.approx(90.0)


def test_parse_google_error_is_japanese():
    with pytest.raises(OcrToolError) as e:
        cloud.parse_google({"responses": [{"error": {"code": 3, "message": "Bad image data."}}]})
    assert "Bad image data" in str(e.value) and e.value.hint


def test_parse_azure_blocks_and_legacy_pages():
    words = cloud.parse_azure(AZURE)
    assert [w.text for w in words] == ["請求書", "金額", "¥11,000"] and words[2].conf == pytest.approx(80.0)
    assert [ln.text for ln in cloud.words_to_page(words).lines] == ["請求書金額", "¥11,000"]
    legacy = {"readResult": {"pages": [{"words": [
        {"content": "請求書", "boundingBox": [100, 100, 400, 100, 400, 160, 100, 160], "confidence": 0.9},
        {"content": "金額", "boundingBox": [500, 100, 700, 100, 700, 160, 500, 160], "confidence": 0.9},
        {"content": "合計", "boundingBox": [100, 400, 300, 400, 300, 460, 100, 460], "confidence": 0.9}]}]}}
    assert [ln.text for ln in cloud.words_to_page(cloud.parse_azure(legacy)).lines] == ["請求書金額", "合計"]


def test_text_in_box_assigns_words_by_position():
    words = cloud.parse_google(GOOGLE)
    text, conf = cloud.text_in_box(words, (90, 90, 720, 170))
    assert text == "請求書金額" and conf == pytest.approx(97.0)
    assert cloud.text_in_box(words, (90, 290, 700, 370))[0] == "¥11,000"
    assert cloud.text_in_box(words, (0, 600, 50, 700)) == ("", None)


# ---------------------------------------------------------------- 安全装置
def test_upload_requires_explicit_permission(cfg, img):
    cfg["cloud"]["allow_upload"] = False
    with pytest.raises(OcrToolError) as e:
        cloud.read_words(img, cfg, "google")
    assert "送信" in str(e.value) and "allow_upload" in e.value.hint


def test_missing_credentials_have_instructions(cfg, monkeypatch):
    monkeypatch.delenv("GOOGLE_VISION_API_KEY", raising=False)
    monkeypatch.delenv("AZURE_VISION_KEY", raising=False)
    monkeypatch.delenv("AZURE_VISION_ENDPOINT", raising=False)
    cfg["cloud"]["google"]["api_key"] = None
    cfg["cloud"]["azure"].update(endpoint=None, key=None)
    with pytest.raises(OcrToolError) as e:
        cloud.check(cfg, ["google"])
    assert "GOOGLE_VISION_API_KEY" in e.value.hint
    with pytest.raises(OcrToolError) as e:
        cloud.check(cfg, ["azure"])
    assert "AZURE_VISION_KEY" in e.value.hint
    monkeypatch.setenv("GOOGLE_VISION_API_KEY", "fromenv")
    assert cloud.credentials(cfg, "google")["key"] == "fromenv"


def test_free_limit_stops_and_warns(cfg, capsys):
    cfg["cloud"]["free_limit"]["google"] = 5
    u = cloud.Usage(cfg)
    for _ in range(4):
        u.add("google")
    assert "80%" in capsys.readouterr().out and u.count("google") == 4
    u.add("google")
    with pytest.raises(OcrToolError) as e:
        u.add("google")
    assert "無料枠" in str(e.value) and u.count("google") == 5
    cfg["cloud"]["stop_at_free_limit"] = False
    cloud.Usage(cfg).add("google")  # 止めない設定なら続行できる


# ---------------------------------------------------------------- 送受信（手元の模擬サーバー）
def test_google_request_and_response(cfg, img):
    m = Mock([(200, GOOGLE)])
    try:
        cfg["cloud"]["google"]["url"] = m.url + "/v1/images:annotate"
        words = cloud.read_words(img, cfg, "google")
    finally:
        m.close()
    req = m.requests[0]
    body = json.loads(req["body"])["requests"][0]
    assert "key=KEY123" in req["path"] and body["features"] == [{"type": "DOCUMENT_TEXT_DETECTION"}]
    assert body["imageContext"]["languageHints"] == ["ja"] and len(body["image"]["content"]) > 100
    assert [w.text for w in words][:2] == ["請求書", "金額"] and cloud.Usage(cfg).count("google") == 1


def test_azure_request_and_response(cfg, img):
    m = Mock([(200, AZURE)])
    try:
        cfg["cloud"]["azure"]["endpoint"] = m.url
        words = cloud.read_words(img, cfg, "azure")
    finally:
        m.close()
    req = m.requests[0]
    assert req["path"].startswith("/computervision/imageanalysis:analyze?api-version=2024-02-01&features=read")
    assert req["headers"]["Ocp-Apim-Subscription-Key"] == "AZKEY" and req["body"][:2] == b"\xff\xd8"  # JPEG
    assert req["headers"]["Content-Type"] == "application/octet-stream" and len(words) == 3


def test_large_image_is_downscaled_and_boxes_scaled_back(cfg, monkeypatch):
    monkeypatch.setattr(cloud, "MAX_SIDE", 400)
    big = np.full((800, 1000, 3), 255, np.uint8)  # 縮小率 0.4
    small_boxes = {"responses": [{"fullTextAnnotation": {"pages": [{"blocks": [{"paragraphs": [{"words": [
        gword([gsym("あ", "EOL_SURE_SPACE")], (40, 40, 80, 80))]}]}]}]}}]}
    m = Mock([(200, small_boxes)])
    try:
        cfg["cloud"]["google"]["url"] = m.url + "/v1/images:annotate"
        w = cloud.read_words(big, cfg, "google")[0]
    finally:
        m.close()
    assert w.box == pytest.approx((100, 100, 200, 200))  # 縮小した画像上の座標を、元の画像の座標に戻す


def test_http_errors_have_japanese_hints(cfg, img):
    for code, needle in [(403, "権限"), (401, "認証"), (400, "拒否")]:
        m = Mock([(code, {"error": "x"})])
        try:
            cfg["cloud"]["google"]["url"] = m.url + "/v1/images:annotate"
            with pytest.raises(OcrToolError) as e:
                cloud.read_words(img, cfg, "google")
        finally:
            m.close()
        assert needle in str(e.value) and e.value.hint


def test_rate_limit_is_retried(cfg, img, monkeypatch):
    monkeypatch.setattr(cloud.time, "sleep", lambda s: None)
    m = Mock([(429, {}), (200, GOOGLE)])
    try:
        cfg["cloud"]["google"]["url"] = m.url + "/v1/images:annotate"
        assert len(cloud.read_words(img, cfg, "google")) == 5
    finally:
        m.close()
    assert len(m.requests) == 2


def test_connection_failure_message(cfg, img, monkeypatch):
    monkeypatch.setattr(cloud.time, "sleep", lambda s: None)
    cfg["cloud"]["google"]["url"] = "http://127.0.0.1:9/v1/images:annotate"  # 誰も聞いていないポート
    with pytest.raises(OcrToolError) as e:
        cloud.read_words(img, cfg, "google")
    assert "接続" in str(e.value) and "HTTPS_PROXY" in e.value.hint


def test_pipeline_engine_google_makes_no_pdf(cfg):
    m = Mock([(200, GOOGLE)])
    try:
        cfg["cloud"]["google"]["url"] = m.url + "/v1/images:annotate"
        cfg["ocr"]["engine"] = "google"
        res = pipeline.ocr_page(loader.PageImage(np.full((800, 1000, 3), 255, np.uint8), 1, 1, 300), cfg, want_pdf=True)
    finally:
        m.close()
    assert res.pdf_bytes is None and res.ocr.text.splitlines()[0] == "請求書金額" and res.applied["engine"] == "google"


# ---------------------------------------------------------------- 候補の統合
def cands(*items):
    return [(t, v, c, src) for t, v, c, src in items]


def test_decide_prefers_cloud_over_tesseract_majority(cfg):
    spec = FieldSpec("s", "件名", (0, 0, 1, 1), type="text")
    cs = cands(*[("ペーパーシレス会議", "ペーパーシレス会議", 85.0, "tess")] * 3, ("ペーパーレス会議", "ペーパーレス会議", 97.0, "cloud"))
    r = form._decide(spec, cs, np.zeros((10, 10), np.uint8), (0, 0, 10, 10), cfg)
    assert r.value == "ペーパーレス会議"
    cfg["cloud"]["prefer_cloud"] = False
    assert form._decide(spec, cs, np.zeros((10, 10), np.uint8), (0, 0, 10, 10), cfg).value == "ペーパーシレス会議"


def test_decide_flags_disagreement_between_engines(cfg):
    spec = FieldSpec("a", "金額", (0, 0, 1, 1), type="amount")
    cs = cands(("111,000", 111000, 50.0, "tess"), ("11,000", 11000, 90.0, "tess"), ("¥11,000", 11000, 95.0, "cloud"))
    r = form._decide(spec, cs, np.zeros((10, 10), np.uint8), (0, 0, 10, 10), cfg)
    assert r.value == 11000 and r.conf == 95.0 and not r.problems  # 3つ中2つ一致(0.67)なら揺れとは扱わない
    cs = cands(("111,000", 111000, 50.0, "tess"), ("12,000", 12000, 60.0, "tess"), ("¥11,000", 11000, 95.0, "cloud"))
    r = form._decide(spec, cs, np.zeros((10, 10), np.uint8), (0, 0, 10, 10), cfg)
    assert r.value == 11000 and any("揺れ" in p for p in r.problems)


def test_choices_snap_cloud_value(cfg):
    spec = FieldSpec("t", "預金種別", (0, 0, 1, 1), type="text", choices=("普通預金", "当座預金"))
    r = form._decide(spec, cands(("普通預余", "普通預余", 80.0, "cloud")), np.zeros((10, 10), np.uint8), (0, 0, 10, 10), cfg)
    assert r.value == "普通預金"


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract未導入")
def test_read_form_uses_one_cloud_call_per_page_and_survives_cloud_failure(cfg, monkeypatch):
    monkeypatch.setattr(cloud.time, "sleep", lambda s: None)
    cfg["cloud"]["reconcile_engines"] = ["google"]
    page = np.full((1400, 1000, 3), 255, np.uint8)
    cv2.rectangle(page, (100, 150), (900, 700), (0, 0, 0), 5)
    cv2.line(page, (100, 350), (900, 350), (0, 0, 0), 4)
    tpl = form.Template("t", [FieldSpec("a", "A", (50, 50, 400, 200), type="text"), FieldSpec("b", "B", (500, 50, 900, 200), type="text")], [], {})
    ok = {"responses": [{"fullTextAnnotation": {"pages": [{"blocks": [{"paragraphs": [{"words": [
        gword([gsym("甲", "EOL_SURE_SPACE")], (180, 190, 260, 260))]}]}]}]}}]}
    m = Mock([(200, ok)])
    try:
        cfg["cloud"]["google"]["url"] = m.url + "/v1/images:annotate"
        res, frame, _ = form.read_form(page, tpl, cfg, 300)
        assert len(m.requests) == 1  # 項目数に関係なく、ページごとに1回
    finally:
        m.close()
    assert res[0].text == "甲" and any(t == "甲" for t, _, _ in res[0].readings)  # クラウドの読み取りも候補に入っている
    m2 = Mock([(500, {"error": "boom"})])
    try:
        cfg["cloud"]["google"]["url"] = m2.url + "/v1/images:annotate"
        res2, _, _ = form.read_form(page, tpl, cfg, 300)  # クラウドが失敗しても、Tesseractだけで続行する
    finally:
        m2.close()
    assert len(res2) == 2
