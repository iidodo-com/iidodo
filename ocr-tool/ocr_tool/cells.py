"""セルモード：罫線で囲まれたマス目（表・帳票）を自動検出し、マスごとに読む。
テンプレートなしで使える汎用の方式。隣のマスの文字が1行に混ざる問題を避けられる。
枠の外にある文字（題字・注意書きなど）は、マスを白く塗りつぶしたあとのページ全体の読み取りで拾う。"""
from __future__ import annotations

import cv2
import numpy as np

from . import engine, preprocess
from .engine import Line, PageOCR, Word

MIN_CELL_W, MIN_CELL_H = 40, 24  # これより小さいマスは無視（点・ゴミ）
MAX_LINE_RATIO = 0.08            # 罫線の画素がページのこの割合を超えたら、罫線ではなくノイズとみなす
MIN_INK_RATIO = 0.002            # マス内の黒画素がこれ未満なら空欄とみなして読まない


def detect_cells(gray: np.ndarray) -> list[tuple[int, int, int, int]]:
    """罫線で閉じたマス目の (x0, y0, x1, y1) を返す。罫線で区切られた背景領域を「マス」とみなす。
    ページ外周につながった領域（枠の外）や、枠が欠けて形が崩れた領域は除く。"""
    h, w = gray.shape
    solid, _ = preprocess.rule_mask(gray)
    lines = cv2.dilate(solid, np.ones((3, 3), np.uint8))
    if np.count_nonzero(lines) > MAX_LINE_RATIO * lines.size:  # 罫線にしては多すぎる（影・ノイズで黒い帯ができた）
        return []
    free = cv2.bitwise_not(lines)
    n, _, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)
    cells = []
    for i in range(1, n):
        x, y, cw, ch, area = (int(v) for v in stats[i])
        if cw < MIN_CELL_W or ch < MIN_CELL_H:
            continue
        if cw * ch > 0.5 * w * h or area < 0.7 * cw * ch:  # 外周の余白、または枠が欠けて形が崩れた領域
            continue
        cells.append((x, y, x + cw, y + ch))
    return cells


def _group_rows(cells: list[tuple[int, int, int, int]]) -> list[list[tuple[int, int, int, int]]]:
    """上端がほぼ同じセルを同じ行にまとめ、行は上から、行内は左から並べる。"""
    rows: list[list[tuple[int, int, int, int]]] = []
    for c in sorted(cells, key=lambda c: (c[1], c[0])):
        for r in rows:
            top = sum(x[1] for x in r) / len(r)
            if abs(c[1] - top) <= max(12, 0.25 * (c[3] - c[1])):
                r.append(c)
                break
        else:
            rows.append([c])
    rows.sort(key=lambda r: sum(x[1] for x in r) / len(r))
    return [sorted(r, key=lambda c: c[0]) for r in rows]


def _read_cell(crop: np.ndarray, cfg: dict, dpi: int) -> PageOCR:
    """1マスを読む。縦に細長いマス（縦書きの見出し）は、縦書きモデルがあればそれで読む。"""
    ocr = cfg["ocr"]
    h, w = crop.shape[:2]
    lang, psm = ocr["language"], 6
    if h > 2.5 * w and h > 150 and "jpn_vert" in engine.available_languages():
        lang, psm = "jpn_vert", 5
    elif h < 110 and w > 1.5 * h:
        psm = 7  # 1行のマス
    crop = cv2.copyMakeBorder(crop, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=255)
    return engine.recognize_with(crop, lang, psm, dpi, ocr["timeout_sec"], ocr["remove_cjk_spaces"])


def recognize_cells(gray_with_lines: np.ndarray, gray_clean: np.ndarray, cells: list[tuple[int, int, int, int]],
                    cfg: dict, dpi: int) -> PageOCR:
    """マスごとに読み、枠の外の文字も加えて、上から下・左から右の順に並べた PageOCR を返す。
    gray_clean は罫線を消した画像（読み取りに使う）。"""
    lines: list[Line] = []
    rows = _group_rows(cells)
    anchors: list[tuple[float, list[Line]]] = []  # (行の上端y, その行のLine群)
    for ri, row in enumerate(rows):
        row_lines = []
        for ci, (x0, y0, x1, y1) in enumerate(row):
            inner = gray_clean[y0 + 3:y1 - 3, x0 + 3:x1 - 3]
            if inner.size == 0 or np.count_nonzero(inner < 128) < MIN_INK_RATIO * inner.size:
                continue  # 空欄
            page = _read_cell(inner, cfg, dpi)
            text = page.text.strip()
            if not text or engine.is_noise(text):
                continue
            words = [Word(w.text, w.conf, (w.box[0] + x0, w.box[1] + y0 - 20 + 3, w.box[2], w.box[3])) for ln in page.lines for w in ln.words]
            conf = page.mean_conf or 0.0
            mn = min((w.conf for w in words), default=conf)
            row_lines.append(Line(0, text, conf, mn, (x0, y0, x1 - x0, y1 - y0), words, row_id=ri, is_cell=True))
        if row_lines:
            anchors.append((sum(c[1] for c in row) / len(row), row_lines))

    # 枠の外の文字：マスを白く塗りつぶしてからページ全体を読む
    rest = gray_clean.copy()
    for x0, y0, x1, y1 in cells:
        rest[max(y0 - 2, 0):y1 + 2, max(x0 - 2, 0):x1 + 2] = 255
    if np.count_nonzero(rest < 128) > MIN_INK_RATIO * rest.size / 4:
        outside = engine.recognize_with(rest, cfg["ocr"]["language"], 6, dpi, cfg["ocr"]["timeout_sec"], cfg["ocr"]["remove_cjk_spaces"])
        for ln in outside.lines:
            if engine.is_noise(ln.text):
                continue
            ln.row_id = None
            anchors.append((float(ln.box[1]), [ln]))

    for n, (_, group) in enumerate(sorted(anchors, key=lambda a: a[0]), start=1):
        for ln in group:
            ln.line_no = len(lines) + 1
            lines.append(ln)
    for i, ln in enumerate(lines):
        ln.new_paragraph = False
    return PageOCR(lines)
