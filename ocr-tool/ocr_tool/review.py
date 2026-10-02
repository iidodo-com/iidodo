"""信頼度の低い箇所を一覧CSV（review.csv）に出力する。"""
from __future__ import annotations

import csv
from pathlib import Path

from .engine import PageOCR

HEADER = ["ファイル", "ページ", "行番号", "種別", "文字列", "信頼度", "行内最小信頼度", "理由", "x", "y", "幅", "高さ"]


def review_rows(file_name: str, page_no: int, page: PageOCR, threshold: float, word_level: bool = False) -> list[list]:
    """しきい値未満の行（と、任意で単語）を CSV の行として返す。文字が全く無いページも1行出す。"""
    if not page.lines:
        return [[file_name, page_no, "", "ページ", "", "", "", "文字が検出されませんでした（白紙・低画質・向き違いの可能性）", "", "", "", ""]]
    rows: list[list] = []
    for ln in page.lines:
        if ln.conf < threshold:
            rows.append([file_name, page_no, ln.line_no, "行", ln.text, round(ln.conf, 1), round(ln.min_conf, 1),
                         f"行の信頼度が{threshold:g}未満", *ln.box])
        if word_level:
            for w in ln.words:
                if w.conf < threshold:
                    rows.append([file_name, page_no, ln.line_no, "単語", w.text, round(w.conf, 1), "",
                                 f"単語の信頼度が{threshold:g}未満", *w.box])
    return rows


class ReviewWriter:
    """review.csv を1ファイルずつ追記する。途中で止まっても、そこまでの結果は残る。
    Excelで文字化けしないよう UTF-8(BOM付き) で書く。"""

    def __init__(self, path: Path):
        self.path = path
        self._fh = open(path, "w", encoding="utf-8-sig", newline="")
        self._w = csv.writer(self._fh)
        self._w.writerow(HEADER)
        self.count = 0

    def write(self, rows: list[list]) -> None:
        self._w.writerows(rows)
        self._fh.flush()
        self.count += len(rows)

    def close(self) -> None:
        self._fh.close()

    def __enter__(self) -> "ReviewWriter":
        return self

    def __exit__(self, *exc) -> None:
        self.close()
