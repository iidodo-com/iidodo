"""精度指標：文字誤り率(CER)。正解テキストがあるときの比較用。"""
from __future__ import annotations

import re


def normalize(text: str) -> str:
    """比較用に空白・改行をすべて除く（レイアウトの違いを誤りに数えないため）。"""
    return re.sub(r"\s+", "", text)


def edit_distance(a: str, b: str) -> int:
    """レーベンシュタイン距離（挿入・削除・置換を各1）。"""
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        for j, cb in enumerate(b, start=1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(reference: str, hypothesis: str) -> float:
    """文字誤り率 = 編集距離 / 正解の文字数。0に近いほど良い（1を超えることもある）。"""
    ref, hyp = normalize(reference), normalize(hypothesis)
    if not ref:
        return 0.0 if not hyp else 1.0
    return edit_distance(ref, hyp) / len(ref)
