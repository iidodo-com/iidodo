"""画像の前処理：グレースケール化・傾き補正・ノイズ除去・二値化。
各ステップは config.yaml の preprocess で個別にON/OFFできる。"""
from __future__ import annotations

import cv2
import numpy as np

MAX_SKEW_DEG = 15.0   # 推定する傾きの上限（度）
MIN_FIX_DEG = 0.2     # これ未満の傾きは補正しない（補間で画質が落ちるだけのため）


def to_gray(img: np.ndarray) -> np.ndarray:
    """グレースケール化（既にグレーならそのまま）。"""
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def denoise(img: np.ndarray, method: str) -> np.ndarray:
    """ノイズ除去。median=高速、nlmeans=高品質だが低速。"""
    if method == "median":
        return cv2.medianBlur(img, 3)
    if method == "nlmeans":
        if img.ndim == 2:
            return cv2.fastNlMeansDenoising(img, None, h=10, templateWindowSize=7, searchWindowSize=21)
        return cv2.fastNlMeansDenoisingColored(img, None, 10, 10, 7, 21)
    return img


def flatten_illumination(img: np.ndarray) -> np.ndarray:
    """照明ムラ・影の補正。紙面の明るさ（背景）を大きな範囲で推定し、画像をそれで割って白に揃える。
    スマホ撮影やスキャナの端の暗がりがあるページで、Tesseractの内部二値化が失敗するのを防ぐ。"""
    gray = to_gray(img)
    k = max(31, min(gray.shape) // 40) | 1  # 文字の太さより十分大きく、紙面の明暗変化より小さく
    bg = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    bg = cv2.GaussianBlur(bg, (0, 0), k / 4)
    return cv2.divide(gray, bg, scale=255)


def binarize(img: np.ndarray, method: str) -> np.ndarray:
    """二値化（大津の方法：画像全体で最適なしきい値を1つ決める）。"""
    if method == "otsu":
        _, out = cv2.threshold(to_gray(img), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return out
    return img


def _rotate(img: np.ndarray, angle: float, expand: bool = True, border: int = 255) -> np.ndarray:
    """画像を angle 度（反時計回りが正）回転する。空いた部分は白で埋める。"""
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    if expand:
        cos, sin = abs(m[0, 0]), abs(m[0, 1])
        nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
        m[0, 2] += nw / 2 - w / 2
        m[1, 2] += nh / 2 - h / 2
        w, h = nw, nh
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(border,) * (3 if img.ndim == 3 else 1))


def estimate_skew(img: np.ndarray, vertical: bool = False) -> float:
    """文字行の傾き（補正のために回す角度, 度）を射影プロファイル法で推定する。
    横書きは行ごとの黒画素数の分散、縦書きは列ごとの分散が最大になる角度を探す。
    文字がほとんど無いページは 0 を返す。"""
    gray = to_gray(img)
    scale = 1200.0 / max(gray.shape)
    if scale < 1:
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    # 照明ムラがあると大津の二値化が崩れるため、先に明るさを均一にしてから文字画素を取り出す
    gray = flatten_illumination(cv2.medianBlur(gray, 3))
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    if np.count_nonzero(bw) < 0.002 * bw.size:
        return 0.0
    axis = 0 if vertical else 1

    def score(angle: float) -> float:
        rot = _rotate(bw, angle, expand=False, border=0)
        return float(np.var(rot.sum(axis=axis, dtype=np.float64)))

    coarse = np.arange(-MAX_SKEW_DEG, MAX_SKEW_DEG + 0.01, 1.0)
    best = max(coarse, key=score)
    fine = np.arange(best - 1.0, best + 1.01, 0.1)
    best = float(max(fine, key=score))
    # 0度とほぼ同スコアなら（罫線のない写真など）補正しない
    if score(best) < score(0.0) * 1.02:
        return 0.0
    return best


def deskew(img: np.ndarray, vertical: bool = False) -> tuple[np.ndarray, float]:
    """傾き補正。(補正後画像, 回した角度) を返す。"""
    angle = estimate_skew(img, vertical)
    if abs(angle) < MIN_FIX_DEG:
        return img, 0.0
    return _rotate(img, angle), angle


def preprocess(img: np.ndarray, pp: dict, vertical: bool = False) -> tuple[np.ndarray, dict]:
    """設定 pp（config の preprocess）に従い前処理する。(画像, 適用内容の記録) を返す。
    順序: グレースケール → 傾き補正 → ノイズ除去 → 照明ムラ補正 → 二値化"""
    applied: dict = {}
    if not pp["enabled"]:
        return img, applied
    out = img
    if pp["grayscale"]:
        out = to_gray(out)
        applied["grayscale"] = True
    if pp["deskew"]:
        out, angle = deskew(out, vertical)
        applied["deskew_deg"] = round(angle, 2)
    if pp["denoise"] != "none":
        out = denoise(out, pp["denoise"])
        applied["denoise"] = pp["denoise"]
    if pp["flatten"]:
        out = flatten_illumination(out)
        applied["flatten"] = True
    if pp["binarize"] != "none":
        out = binarize(out, pp["binarize"])
        applied["binarize"] = pp["binarize"]
    return out, applied
