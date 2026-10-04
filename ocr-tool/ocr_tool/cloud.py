"""クラウドOCR（任意機能）：Google Cloud Vision / Azure AI Vision (Read) に画像を送信して読み取る。

★ 重要: この機能を使うと、書類の画像が外部のサービス（Google / Microsoft）に送信されます。
  誤送信を防ぐため、config.yaml の cloud.allow_upload を true にしたときだけ動きます。
  個人情報（氏名・口座番号など）を含む書類は、送信してよいか確認してから使ってください。
費用: 無料枠の範囲で使う想定。このツール自身が月ごとの利用枚数を数え、無料枠に達したら止まります
  （cloud.stop_at_free_limit）。ただし、他の用途で同じアカウントを使っている分は数えられません。

追加ライブラリは不要（標準ライブラリの urllib だけ）。会社のプロキシは環境変数 HTTPS_PROXY に従う。
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import cv2
import numpy as np

from .engine import Line, PageOCR, Word
from .errors import OcrToolError

log = logging.getLogger("ocr_tool")
PROVIDERS = ("google", "azure")
MAX_SIDE = 4000          # 送信前に、長辺がこれを超える画像は縮小する（通信量と上限対策）
MAX_BYTES = 8_000_000    # 送信する画像のバイト数の目安（Google 10MB / Azure 20MB の上限に余裕を持たせる）
_LATIN = re.compile(r"[A-Za-z0-9]")


@dataclass
class CWord:
    """クラウドが返した1語。box は送信した画像の座標ではなく、元画像の座標に戻したもの (x0, y0, x1, y1)。"""
    text: str
    conf: float                    # 0-100
    box: tuple[float, float, float, float]
    line_end: bool = False         # 行の終わりか
    space_after: bool = False      # 語の後ろに空白があるか（英単語の区切り用）


# ---------------------------------------------------------------- 設定・安全装置

def require_upload_allowed(cfg: dict) -> None:
    """外部送信の同意（cloud.allow_upload）がなければ止める。"""
    if not cfg["cloud"]["allow_upload"]:
        raise OcrToolError(
            "クラウドOCRは、書類の画像を外部のサービス（Google / Microsoft）に送信します。送信は許可されていません。",
            "送信してよい書類であることを確認し、config.yaml の cloud.allow_upload を true にしてください。")


def credentials(cfg: dict, provider: str) -> dict:
    """APIキー等を環境変数 → config.yaml の順で取得する。無ければ手順つきのエラー。"""
    c = cfg["cloud"]
    if provider == "google":
        key = os.environ.get("GOOGLE_VISION_API_KEY") or c["google"]["api_key"]
        if not key:
            raise OcrToolError("Google Cloud Vision の APIキーが設定されていません。",
                               "README「クラウドOCR」の手順でキーを作り、環境変数 GOOGLE_VISION_API_KEY に設定してください。")
        return {"key": str(key)}
    endpoint = os.environ.get("AZURE_VISION_ENDPOINT") or c["azure"]["endpoint"]
    key = os.environ.get("AZURE_VISION_KEY") or c["azure"]["key"]
    if not endpoint or not key:
        raise OcrToolError("Azure AI Vision のエンドポイントまたはキーが設定されていません。",
                           "README「クラウドOCR」の手順でリソースを作り、環境変数 AZURE_VISION_ENDPOINT と AZURE_VISION_KEY に設定してください。")
    return {"endpoint": str(endpoint).rstrip("/"), "key": str(key)}


def check(cfg: dict, providers: list[str]) -> None:
    """処理を始める前に、送信許可とキーの有無を確認する（途中で止まらないように）。"""
    require_upload_allowed(cfg)
    for p in providers:
        credentials(cfg, p)


class Usage:
    """月ごとの利用回数の記録。無料枠を超えないための安全装置（このツールからの利用分のみ）。"""

    def __init__(self, cfg: dict):
        self.path = Path(cfg["cloud"]["usage_file"])
        self.limits = cfg["cloud"]["free_limit"]
        self.stop = cfg["cloud"]["stop_at_free_limit"]

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def count(self, provider: str) -> int:
        return int(self._load().get(date.today().strftime("%Y-%m"), {}).get(provider, 0))

    def add(self, provider: str) -> int:
        """1回分を数える。無料枠に達していれば（stop が有効なら）例外にする。80%を超えたら警告する。"""
        data, month = self._load(), date.today().strftime("%Y-%m")
        n = int(data.get(month, {}).get(provider, 0))
        limit = int(self.limits[provider])
        if self.stop and n >= limit:
            raise OcrToolError(
                f"{provider} の今月の無料枠（{limit}回）に達したため、送信を止めました（このツールでの利用回数: {n}）。",
                "来月まで待つか、config.yaml の cloud.stop_at_free_limit を false にしてください（超過分は有料になる場合があります）。")
        if n + 1 >= 0.8 * limit and n < 0.8 * limit:
            log.warning("%s の利用回数が無料枠の80%%に達しました（%d/%d）", provider, n + 1, limit)
            print(f"  注意: {provider} の今月の利用回数が無料枠の80%に達しました（{n + 1}/{limit}）。")
        data.setdefault(month, {})[provider] = n + 1
        try:
            self.path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        except OSError as e:  # 記録できなくても読み取りは続ける
            log.warning("利用回数を記録できませんでした: %s", e)
        return n + 1


# ---------------------------------------------------------------- 送信

def _encode(img: np.ndarray) -> tuple[bytes, float]:
    """画像をJPEGにして返す。(バイト列, 縮小率)。縮小率は、返ってきた座標を元の画像に戻すのに使う。"""
    scale = min(1.0, MAX_SIDE / max(img.shape[:2]))
    send = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else img
    for q in (92, 85, 75, 60):
        ok, buf = cv2.imencode(".jpg", send, [cv2.IMWRITE_JPEG_QUALITY, q])
        if ok and len(buf) <= MAX_BYTES:
            return buf.tobytes(), scale
    raise OcrToolError("画像が大きすぎて送信できません。", "画像を縮小するか、スキャン解像度を下げてください（A4で300dpi程度が目安）。")


def _post(url: str, body: bytes, headers: dict, timeout: float, retries: int = 2) -> dict:
    """JSONをPOSTして、結果のdictを返す。一時的な失敗（429/5xx/通信エラー）は少し待って再試行する。"""
    last: Exception | None = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            host = urllib.parse.urlparse(url).hostname or ""
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({})) if host in ("127.0.0.1", "localhost") else urllib.request.build_opener()
            with opener.open(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 * (attempt + 1))
                last = e
                continue
            raise _http_error(e.code, detail) from e
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
                continue
            raise OcrToolError(
                f"クラウドに接続できませんでした（{e}）。",
                "インターネット接続を確認してください。会社のプロキシ経由なら、環境変数 HTTPS_PROXY（認証が必要なら "
                "http://ユーザー名:パスワード@ホスト:ポート）を設定してください。") from e
    raise OcrToolError(f"クラウドへの送信に失敗しました（{last}）。", "しばらくしてからやり直してください。")


def _http_error(code: int, detail: str) -> OcrToolError:
    table = {
        400: ("リクエストが拒否されました（画像の形式・大きさの問題など）。", "画像が壊れていないか、極端に小さい/大きくないか確認してください。"),
        401: ("認証に失敗しました（キーが違う・期限切れ）。", "APIキー（とエンドポイント）を確認してください。"),
        403: ("権限がありません（APIが有効でない・課金アカウントが未設定・キーの制限など）。",
              "Google: Cloud Vision API を有効にし、課金アカウントを紐づけてください（無料枠内なら課金されません）。キーの制限設定も確認してください。"),
        404: ("接続先が見つかりません。", "Azure はエンドポイントのURL（https://〜.cognitiveservices.azure.com など）を確認してください。"),
        407: ("プロキシの認証が必要です。", "環境変数 HTTPS_PROXY に http://ユーザー名:パスワード@ホスト:ポート を設定してください。"),
        429: ("利用上限（回数・頻度）に達しました。", "しばらく待つか、無料枠（月の上限）を確認してください。"),
    }
    msg, hint = table.get(code, (f"クラウドがエラーを返しました（HTTP {code}）。", "しばらくしてからやり直してください。"))
    return OcrToolError(f"{msg}（詳細: {detail}）", hint)


# ---------------------------------------------------------------- 応答の解析

def _bbox(verts: list[dict] | list[float] | None) -> tuple[float, float, float, float]:
    """頂点のリストから (x0, y0, x1, y1)。Googleは {x,y}（0が省略されることがある）、Azureは {x,y} または [x1,y1,...]。"""
    if not verts:
        return 0.0, 0.0, 0.0, 0.0
    if isinstance(verts[0], dict):
        xs = [float(v.get("x", 0)) for v in verts]
        ys = [float(v.get("y", 0)) for v in verts]
    else:
        xs, ys = [float(v) for v in verts[0::2]], [float(v) for v in verts[1::2]]
    return min(xs), min(ys), max(xs), max(ys)


def parse_google(resp: dict) -> list[CWord]:
    """Google の応答（responses[0].fullTextAnnotation）を単語のリストにする。"""
    r = (resp.get("responses") or [{}])[0]
    if r.get("error"):
        raise OcrToolError(f"Google Cloud Vision がエラーを返しました: {r['error'].get('message', r['error'])}",
                           "キー・API有効化・課金設定を確認してください。")
    words: list[CWord] = []
    for page in (r.get("fullTextAnnotation") or {}).get("pages", []):
        for block in page.get("blocks", []):
            for para in block.get("paragraphs", []):
                for w in para.get("words", []):
                    syms = w.get("symbols", [])
                    text = "".join(s.get("text", "") for s in syms)
                    if not text:
                        continue
                    brk = ((syms[-1].get("property") or {}).get("detectedBreak") or {}).get("type", "") if syms else ""
                    words.append(CWord(text, float(w.get("confidence", 0)) * 100, _bbox((w.get("boundingBox") or {}).get("vertices")),
                                       line_end=brk in ("EOL_SURE_SPACE", "LINE_BREAK"), space_after=brk in ("SPACE", "SURE_SPACE")))
        if words:
            words[-1].line_end = True
    return words


def parse_azure(resp: dict) -> list[CWord]:
    """Azure の応答（readResult.blocks[].lines[].words[]）を単語のリストにする。旧形式（pages[].lines/words）も受け付ける。"""
    rr = resp.get("readResult") or {}
    words: list[CWord] = []
    if "blocks" in rr:
        for block in rr["blocks"]:
            for line in block.get("lines", []):
                ws = line.get("words") or [{"text": line.get("text", ""), "boundingPolygon": line.get("boundingPolygon"), "confidence": 0}]
                for i, w in enumerate(ws):
                    if w.get("text"):
                        words.append(CWord(w["text"], float(w.get("confidence", 0)) * 100, _bbox(w.get("boundingPolygon")),
                                           line_end=(i == len(ws) - 1), space_after=True))
    else:
        for page in rr.get("pages", []):
            for w in page.get("words", []):
                if w.get("content"):
                    words.append(CWord(w["content"], float(w.get("confidence", 0)) * 100, _bbox(w.get("boundingBox") or w.get("polygon")),
                                       line_end=False, space_after=True))
        # 旧形式は語に行の終わりの情報が無いため、y座標の変化で行を分ける（join_lines側で処理）
    return words


def _scale_back(words: list[CWord], scale: float) -> list[CWord]:
    if scale != 1.0:
        for w in words:
            w.box = tuple(v / scale for v in w.box)  # type: ignore[assignment]
    return words


def join_words(words: list[CWord]) -> str:
    """語を連結する。日本語は空白なし、英数字どうしの間だけ空白を入れる。"""
    out = ""
    for i, w in enumerate(words):
        out += w.text
        if i + 1 < len(words) and _LATIN.search(w.text[-1]) and _LATIN.search(words[i + 1].text[0]):
            out += " "
    return out


def group_lines(words: list[CWord]) -> list[list[CWord]]:
    """語を行ごとにまとめる。line_end があればそれに従い、なければ縦位置の近さで分ける。"""
    lines: list[list[CWord]] = []
    cur: list[CWord] = []
    for w in words:
        if cur and not cur[-1].line_end and not any(x.line_end for x in cur):
            # 行の終わりの情報がない（旧形式）: 縦の中心が大きくずれたら別の行
            cy, wh = (cur[-1].box[1] + cur[-1].box[3]) / 2, max(cur[-1].box[3] - cur[-1].box[1], 1)
            if abs((w.box[1] + w.box[3]) / 2 - cy) > 0.6 * wh:
                lines.append(cur)
                cur = []
        cur.append(w)
        if w.line_end:
            lines.append(cur)
            cur = []
    if cur:
        lines.append(cur)
    return lines


def words_to_page(words: list[CWord]) -> PageOCR:
    """単語のリストを、行ごとの PageOCR にする。"""
    lines: list[Line] = []
    for grp in group_lines(words):
        text = join_words(grp)
        n = sum(len(w.text) for w in grp) or 1
        conf = sum(w.conf * len(w.text) for w in grp) / n
        x0, y0 = min(w.box[0] for w in grp), min(w.box[1] for w in grp)
        x1, y1 = max(w.box[2] for w in grp), max(w.box[3] for w in grp)
        lines.append(Line(len(lines) + 1, text, conf, min(w.conf for w in grp), (int(x0), int(y0), int(x1 - x0), int(y1 - y0)),
                          [Word(w.text, w.conf, (int(w.box[0]), int(w.box[1]), int(w.box[2] - w.box[0]), int(w.box[3] - w.box[1]))) for w in grp]))
    return PageOCR(lines)


# ---------------------------------------------------------------- 呼び出し

def read_words(img: np.ndarray, cfg: dict, provider: str) -> list[CWord]:
    """画像1枚をクラウドで読み、語のリスト（元画像の座標）を返す。送信前に許可・キー・無料枠を確認する。"""
    require_upload_allowed(cfg)
    cred = credentials(cfg, provider)
    Usage(cfg).add(provider)
    data, scale = _encode(img)
    timeout = float(cfg["cloud"]["timeout_sec"])
    if provider == "google":
        body = json.dumps({"requests": [{"image": {"content": base64.b64encode(data).decode("ascii")},
                                         "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                                         "imageContext": {"languageHints": ["ja"]}}]}).encode("utf-8")
        url = f"{cfg['cloud']['google']['url']}?key={cred['key']}"
        words = parse_google(_post(url, body, {"Content-Type": "application/json"}, timeout))
    elif provider == "azure":
        url = f"{cred['endpoint']}/computervision/imageanalysis:analyze?api-version={cfg['cloud']['azure']['api_version']}&features=read"
        words = parse_azure(_post(url, data, {"Content-Type": "application/octet-stream", "Ocp-Apim-Subscription-Key": cred["key"]}, timeout))
    else:
        raise OcrToolError(f"未対応のクラウドです: {provider}", f"{' / '.join(PROVIDERS)} のいずれかを指定してください。")
    return _scale_back(words, scale)


def recognize_page(img: np.ndarray, cfg: dict, provider: str) -> PageOCR:
    """ページ全体をクラウドで読み、行ごとの結果（信頼度つき）を返す。"""
    return words_to_page(read_words(img, cfg, provider))


def words_in_box(words: list[CWord], box: tuple[int, int, int, int]) -> list[CWord]:
    """範囲 (x0,y0,x1,y1) の中に中心がある語を、上から下・左から右の順で返す。"""
    x0, y0, x1, y1 = box
    inside = [w for w in words if x0 <= (w.box[0] + w.box[2]) / 2 <= x1 and y0 <= (w.box[1] + w.box[3]) / 2 <= y1]
    return sorted(inside, key=lambda w: ((w.box[1] + w.box[3]) // 2 // max(int((w.box[3] - w.box[1]) * 0.6), 8), w.box[0]))


def text_in_box(words: list[CWord], box: tuple[int, int, int, int]) -> tuple[str, float | None]:
    """範囲内の語を、行ごとに改行でつないだ文字列と、文字数重みの信頼度にする。"""
    inside = words_in_box(words, box)
    if not inside:
        return "", None
    rows: list[list[CWord]] = []
    for w in inside:
        cy = (w.box[1] + w.box[3]) / 2
        if rows and abs(cy - (rows[-1][0].box[1] + rows[-1][0].box[3]) / 2) <= 0.6 * max(w.box[3] - w.box[1], 8):
            rows[-1].append(w)
        else:
            rows.append([w])
    n = sum(len(w.text) for w in inside) or 1
    return "\n".join(join_words(sorted(r, key=lambda w: w.box[0])) for r in rows), sum(w.conf * len(w.text) for w in inside) / n
