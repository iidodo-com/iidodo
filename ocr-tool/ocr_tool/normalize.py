"""帳票の値の正規化：全角/半角、記号、金額、和暦の日付をそろえて比較できる形にする。"""
from __future__ import annotations

import re
import unicodedata

# 各種ハイフン・長音・ダッシュを「-」に統一する（OCRで混同されやすい）
_DASHES = "‐‑‒–—―−ーｰ─━－"
_DASH_TABLE = {ord(c): "-" for c in _DASHES}
# 数字として読み間違えやすい文字（数字欄でのみ使う）
_DIGIT_FIX = str.maketrans({"O": "0", "o": "0", "〇": "0", "Ｏ": "0", "I": "1", "l": "1", "|": "1", "！": "1", "S": "5", "B": "8"})

# 令和・平成・昭和 → 西暦への換算
_ERAS = {"令和": 2018, "R": 2018, "平成": 1988, "H": 1988, "昭和": 1925, "S": 1925}


def nfkc(text: str) -> str:
    """全角英数・半角カナなどを標準形(NFKC)にそろえる。例: 'ｶ)ﾃｲｰｶﾞｲｱ' → 'カ)ティーガイア'"""
    return unicodedata.normalize("NFKC", text or "")


def normalize_text(text: str) -> str:
    """文字列の比較用正規化：NFKC、空白除去、ハイフン統一、大文字化。"""
    t = nfkc(text).translate(_DASH_TABLE)
    t = re.sub(r"\s+", "", t)
    return t.upper()


def normalize_digits(text: str, keep: str = "-") -> str:
    """数字欄の正規化：数字と keep に含む記号だけを残し、O→0 などの読み違いを直す。"""
    t = nfkc(text).translate(_DASH_TABLE).translate(_DIGIT_FIX)
    return re.sub(rf"[^0-9{re.escape(keep)}]", "", t)


def parse_amount(text: str) -> int | None:
    """金額を整数(円)にする。'\\11,000 円' '¥11.000' '11，000' など。読めなければ None。
    ¥ が \\ や W に化ける・円が別字になる誤読を許容し、数字（とO→0）以外は捨てる。"""
    t = nfkc(text).translate(_DIGIT_FIX)
    t = re.sub(r"[^0-9,，.．]", "", t)
    t = re.sub(r"[,，.．]", "", t)  # 円に小数はないので、区切りはすべて桁区切りとして除く
    return int(t) if t else None


def parse_date_jp(text: str) -> tuple[int, int, int] | None:
    """日付を (西暦, 月, 日) にする。月が1〜12、日が1〜31でなければ（誤読として）None。'令和8年9月25日' / 'R8.9.25' / '2026/9/25' / '2026-09-25' に対応。"""
    d = _parse_date_raw(text)
    return d if d and 1 <= d[1] <= 12 and 1 <= d[2] <= 31 else None


def _parse_date_raw(text: str) -> tuple[int, int, int] | None:
    t = nfkc(text).replace(" ", "")
    m = re.search(r"(令和|平成|昭和|R|H|S)(\d{1,2}|元)[年.\-/](\d{1,2})[月.\-/](\d{1,2})", t)
    if m:
        year = 1 if m.group(2) == "元" else int(m.group(2))
        return _ERAS[m.group(1)] + year, int(m.group(3)), int(m.group(4))
    m = re.search(r"((?:19|20)\d{2})[年.\-/](\d{1,2})[月.\-/](\d{1,2})", t)
    if m:
        return int(m.group(1)), int(m.group(2)), int(m.group(3))
    return None
