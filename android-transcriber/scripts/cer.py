#!/usr/bin/env python3
"""正解テキストと認識結果から文字誤り率(CER)を算出する。空白・句読点・記号は無視する。
使い方: python scripts/cer.py reference.txt hypothesis.txt
"""
from __future__ import annotations

import sys
import unicodedata
from pathlib import Path


def normalize(text: str) -> str:
    return "".join(c for c in text if not c.isspace() and not unicodedata.category(c).startswith(("P", "S", "C")))


def edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(reference: str, hypothesis: str) -> float:
    r, h = normalize(reference), normalize(hypothesis)
    if not r:
        return 0.0 if not h else 1.0
    return edit_distance(r, h) / len(r)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    ref, hyp = (Path(p).read_text(encoding="utf-8") for p in sys.argv[1:])
    print(f"CER = {cer(ref, hyp):.4f}")
