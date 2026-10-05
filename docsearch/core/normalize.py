"""登録前・検索前に同じ方法でテキストを正規化する。"""
import re
import unicodedata

_WS = re.compile(r"\s+")
# 制御文字・ゼロ幅文字・孤立サロゲート（PDF等に混ざり、検索を妨げたりDB保存で失敗したりする）
_STRIP = re.compile(
    "[\x00-\x1f\x7f-\x9f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064"
    "\u2066-\u206f\ufeff\ufff9-\ufffb\ud800-\udfff]"
)


def normalize(text):
    """Unicode NFKC → 小文字化 → 空白の連続を1つに → 前後の空白を除去 した文字列を返す。

    全角・半角、全角英数字、大文字・小文字、㈱→(株)、①→1 などのゆれを吸収する。
    登録時（本文）と検索時（検索語）の両方で、必ずこの関数を通す。
    """
    if not text:
        return ""
    t = unicodedata.normalize("NFKC", text).lower()
    t = _WS.sub(" ", t)
    return _STRIP.sub("", t).strip()
