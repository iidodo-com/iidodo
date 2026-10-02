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


def rule_mask(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """罫線（長い横線・縦線）の画素マスクと、文字の二値画像を返す。
    太い塊（大きな文字・塗りつぶし）や、文字の一画（短くて他の画素とつながった線分）は罫線に含めない。"""
    bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    h, w = bw.shape
    n_bw, lab_bw, st_bw, _ = cv2.connectedComponentsWithStats(bw, connectivity=8)
    mask = np.zeros_like(bw)
    for horizontal in (True, False):
        size = max((w if horizontal else h) // 30, 80)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (size, 1) if horizontal else (1, size))
        opened = cv2.morphologyEx(bw, cv2.MORPH_OPEN, k)
        n, lab, st, cen = cv2.connectedComponentsWithStats(opened, connectivity=8)
        for i in range(1, n):
            length, thick = (st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]) if horizontal else (st[i, cv2.CC_STAT_HEIGHT], st[i, cv2.CC_STAT_WIDTH])
            if thick > 14:
                continue  # 太い塊は罫線ではない
            if length < 200:
                # 短い線は、表の枠など大きな図形につながっているときだけ罫線とみなす（文字の一画を消さないため）
                j = lab_bw[int(cen[i][1]), int(cen[i][0])]
                if j == 0 or max(st_bw[j, cv2.CC_STAT_WIDTH], st_bw[j, cv2.CC_STAT_HEIGHT]) < 200:
                    continue
            mask[lab == i] = 255
    return mask, bw


def remove_lines(img: np.ndarray) -> np.ndarray:
    """表や枠の罫線（長い横線・縦線、点線）を白で消す。罫線が `山` `|` `中` のような断片文字として読まれるのを防ぐ。
    文字が罫線に接している箇所は、画素が少し欠けることがある。"""
    gray = to_gray(img)
    solid, bw = rule_mask(gray)
    lines = cv2.dilate(solid, np.ones((3, 3), np.uint8))
    # 点線は、枠線とつながっていると「太い塊」に見えてしまうので、実線を取り除いてから探す
    rest = cv2.bitwise_and(bw, cv2.bitwise_not(cv2.dilate(solid, np.ones((7, 7), np.uint8))))
    lines = cv2.bitwise_or(lines, _dashed_lines(rest))
    out = gray.copy()
    out[lines > 0] = 255
    return out


def _dashed_lines(bw: np.ndarray, gap: int = 31, min_len: int = 100, max_thick: int = 12) -> np.ndarray:
    """点線（細かい線分の連なり）の画素を返す。隙間をつないで「細くて長い」部分だけを点線とみなす。
    文字は隙間をつなぐと太い塊になるため、細さの条件で区別できる。"""
    mask = np.zeros_like(bw)
    for horizontal in (True, False):
        k = np.ones((1, gap), np.uint8) if horizontal else np.ones((gap, 1), np.uint8)
        closed = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, k)
        n, lab, st, _ = cv2.connectedComponentsWithStats(closed, connectivity=8)
        for i in range(1, n):
            w_, h_ = st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]
            thin, long_ = (h_, w_) if horizontal else (w_, h_)
            if thin <= max_thick and long_ >= min_len:
                mask[lab == i] = 255
    return cv2.dilate(mask, np.ones((3, 3), np.uint8))


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
    順序: グレースケール → 傾き補正 → ノイズ除去 → 照明ムラ補正 → 罫線除去 → 二値化"""
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
    if pp.get("remove_lines"):
        out = remove_lines(out)
        applied["remove_lines"] = True
    if pp["binarize"] != "none":
        out = binarize(out, pp["binarize"])
        applied["binarize"] = pp["binarize"]
    return out, applied
