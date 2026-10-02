"""手書き文字の読み取り（任意機能）。manga-ocr（Apache-2.0。モデルも Apache-2.0）を使う。

Tesseract は印刷文字向けで、手書きはほとんど読めない。manga-ocr は1行の画像を読む深層学習モデルで、
手書きの日本語にもある程度対応する。ただし次の限界がある（README参照）:
  - 1行ずつ読むため、行の切り出し（このファイルの segment_lines）が必要
  - 読めない字を「それらしい別の文字」で答える（もっともらしい誤読）。信頼度の低い部分は必ず目視する
  - torch を使うため導入が重い（約1.5GB）。処理もTesseractより遅い（CPUで1行あたり約0.2〜3秒）
このモジュールは、使われるときまで torch などを読み込まない（導入していなくても通常のOCRは動く）。
"""
from __future__ import annotations

import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from .engine import Line, PageOCR, Word
from .errors import OcrToolError

DEFAULT_MODEL = "kha-white/manga-ocr-base"
MAX_ASPECT = 8.0    # モデルは正方形に縮めて読むため、これより横長の行は分割して読む
_READERS: dict = {}


class Reader:
    """manga-ocr のラッパー。read() は (文字列, 平均信頼度0-100, 最小信頼度0-100) を返す。"""

    def __init__(self, model_dir: str | None):
        try:
            import torch  # noqa: F401
            from manga_ocr import MangaOcr
        except ImportError as e:
            raise OcrToolError(
                f"手書き読み取り用のライブラリが入っていません（{e}）。",
                "setup_handwriting.bat を実行して導入してください（README「手書きモード」参照）。") from e
        path = DEFAULT_MODEL
        if model_dir:
            p = Path(model_dir)
            if not (p / "config.json").is_file():
                raise OcrToolError(
                    f"手書き用モデルが見つかりません: {p}",
                    "README「手書きモード」の手順で、モデルのファイルをこのフォルダに置いてください。"
                    "（config.yaml の handwriting.model_dir）")
            path = str(p.resolve())
            os.environ["HF_HUB_OFFLINE"] = "1"  # 手元のモデルだけを使い、ネットワークに接続しない
        try:
            self._ocr = MangaOcr(pretrained_model_name_or_path=path, force_cpu=True)
        except Exception as e:  # noqa: BLE001
            raise OcrToolError(f"手書き用モデルを読み込めませんでした（{e}）。",
                               "モデルのファイル一式（config.json, vocab.txt, モデル本体 など）が揃っているか確認してください。") from e

    def read(self, img: Image.Image) -> tuple[str, float, float]:
        import torch
        from manga_ocr.ocr import post_process
        m = self._ocr
        x = m.processor(img.convert("L").convert("RGB"), return_tensors="pt").pixel_values
        with torch.no_grad():
            out = m.model.generate(x.to(m.model.device), max_length=300, output_scores=True, return_dict_in_generate=True)
        text = post_process(m.tokenizer.decode(out.sequences[0], skip_special_tokens=True))
        try:
            probs = m.model.compute_transition_scores(out.sequences, out.scores, normalize_logits=True)[0].exp()
            return text, float(probs.mean()) * 100, float(probs.min()) * 100
        except Exception:  # noqa: BLE001  信頼度が取れない版でも文字は返す
            return text, 0.0, 0.0


def get_reader(model_dir: str | None = None) -> Reader:
    """モデルは重い（読み込みに約10秒）ので、1回だけ読み込んで使い回す。"""
    key = str(model_dir)
    if key not in _READERS:
        _READERS[key] = Reader(model_dir)
    return _READERS[key]


def check(cfg: dict) -> None:
    """手書きモードが使えるか（ライブラリ・モデルの場所）を、処理の前に確認する。"""
    try:
        import torch  # noqa: F401
        import manga_ocr  # noqa: F401
    except ImportError as e:
        raise OcrToolError(f"手書きモードに必要なライブラリが入っていません（{e}）。",
                           "setup_handwriting.bat を実行してください。使わないなら config.yaml の handwriting.enabled を false にしてください。") from e
    md = cfg["handwriting"]["model_dir"]
    if md and not (Path(md) / "config.json").is_file():
        raise OcrToolError(f"手書き用モデルが見つかりません: {md}",
                           "README「手書きモード」の手順でモデルのファイルを置くか、model_dir を null にしてください（初回は自動ダウンロード）。")


# ---------------------------------------------------------------- 行の切り出し

def _ink(gray: np.ndarray) -> np.ndarray:
    """文字（インク）の二値画像。影があっても取り出せるよう、先に明るさを均してから大津の方法を使う。"""
    from .preprocess import flatten_illumination
    g = flatten_illumination(cv2.medianBlur(gray, 3))
    bw = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    n, lab, st, _ = cv2.connectedComponentsWithStats(bw, connectivity=8)
    small = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] < 25]  # ゴミ点
    bw[np.isin(lab, small)] = 0
    return bw


def _runs(flags: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    """True が続く区間 (start, end)。min_gap 未満の隙間はつなぐ。"""
    idx = np.where(flags)[0]
    if not len(idx):
        return []
    out, s, p = [], int(idx[0]), int(idx[0])
    for x in idx[1:]:
        if x - p > min_gap:
            out.append((s, p + 1))
            s = int(x)
        p = int(x)
    out.append((s, p + 1))
    return out


def split_wide(bw: np.ndarray, x0: int, x1: int, y0: int, y1: int) -> list[tuple[int, int]]:
    """横長すぎる行を、文字の隙間で左右に分ける（各片の幅 ≤ 高さ×MAX_ASPECT）。"""
    limit = int(max(y1 - y0, 40) * MAX_ASPECT)
    if x1 - x0 <= limit:
        return [(x0, x1)]
    col = bw[y0:y1, x0:x1].sum(axis=0) > 0
    pieces, start = [], x0
    while x1 - start > limit:
        lo, hi = start + limit // 2, start + limit
        gaps = [x for x in range(lo, hi) if not col[x - x0]]
        cut = gaps[len(gaps) // 2] if gaps else hi  # 隙間があればその中央、なければ強制的に切る
        pieces.append((start, cut))
        start = cut
    pieces.append((start, x1))
    return [(a, b) for a, b in pieces if b - a > 5]


def segment_lines(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    """手書きの行を上から順に切り出し、(x0, y0, x1, y1) を返す（横書き）。横方向の黒画素の分布で行を分ける。"""
    bw = _ink(gray)
    h, w = bw.shape
    rows = _runs(bw.sum(axis=1) > 0, min_gap=max(18, h // 120))
    boxes = []
    for y0, y1 in rows:
        if y1 - y0 < 18:
            continue
        xs = np.where(bw[y0:y1].sum(axis=0) > 0)[0]
        if not len(xs) or np.count_nonzero(bw[y0:y1]) < 60:
            continue
        pad = 12
        boxes.append((max(int(xs.min()) - pad, 0), max(y0 - pad, 0), min(int(xs.max()) + pad, w), min(y1 + pad, h)))
    return boxes


def read_crop(gray: np.ndarray, reader: Reader) -> tuple[str, float, float, list[Word]]:
    """切り出した1行（またはマス）を読む。横長なら分割して読み、(文字列, 平均信頼度, 最小信頼度, 分割ごとの単語) を返す。"""
    bw = _ink(gray)
    h, w = gray.shape
    xs = np.where(bw.sum(axis=0) > 0)[0]
    if not len(xs):
        return "", 0.0, 0.0, []
    words, texts, means, mins = [], [], [], []
    for a, b in split_wide(bw, int(xs.min()), int(xs.max()) + 1, 0, h):
        piece = gray[:, max(a - 10, 0):min(b + 10, w)]
        text, mean, mn = reader.read(Image.fromarray(piece))
        if text.strip():
            texts.append(text.strip())
            means.append(mean)
            mins.append(mn)
            words.append(Word(text.strip(), mean, (a, 0, b - a, h)))
    if not texts:
        return "", 0.0, 0.0, []
    return "".join(texts), sum(means) / len(means), min(mins), words


def recognize_page(gray: np.ndarray, cfg: dict) -> PageOCR:
    """ページ全体の手書き文字を、行ごとに読む。信頼度は手書き用モデルの確率（目安）。"""
    reader = get_reader(cfg["handwriting"]["model_dir"])
    lines: list[Line] = []
    for (x0, y0, x1, y1) in segment_lines(gray):
        text, mean, mn, words = read_crop(gray[y0:y1, x0:x1], reader)
        if not text:
            continue
        words = [Word(w.text, w.conf, (w.box[0] + x0, y0, w.box[2], y1 - y0)) for w in words]
        lines.append(Line(len(lines) + 1, text, mean, mn, (x0, y0, x1 - x0, y1 - y0), words))
    return PageOCR(lines)
