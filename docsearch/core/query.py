"""検索式の解析: スペース区切りのAND、"..." のフレーズ、-語 の除外。"""
from dataclasses import dataclass, field

from .normalize import normalize

MAX_TERMS = 20
TRIGRAM_MIN = 3  # この文字数未満の語は、trigram の索引が効かない


class QueryError(ValueError):
    """検索式の誤り。メッセージは利用者向けの日本語（原因と対処つき）。"""


@dataclass
class ParsedQuery:
    positives: list = field(default_factory=list)  # 正規化済みの検索語（AND）
    negatives: list = field(default_factory=list)  # 正規化済みの除外語


def parse_query(raw):
    """検索式を解析して ParsedQuery を返す。誤りは QueryError（日本語）。

    全体を先に正規化する（全角の「－」「"」「スペース」も半角として扱える）。
    語の中の * : ( ) などは、特別扱いせず、そのままの文字として検索する。
    """
    s = normalize(raw or "")
    if not s:
        raise QueryError("検索語が入力されていません。調べたい語句を入力してください。")
    pq = ParsedQuery()
    i, n = 0, len(s)
    while i < n:
        if s[i] == " ":
            i += 1
            continue
        neg = False
        if s[i] == "-":
            if i + 1 >= n or s[i + 1] == " ":
                raise QueryError("除外の「-」の後ろに語句がありません。除外したい語を「-語」のように続けて書いてください"
                                 "（「-」そのものを検索したい場合は \"-\" のように引用符で囲んでください）。")
            neg = True
            i += 1
        if s[i] == '"':
            j = s.find('"', i + 1)
            if j == -1:
                raise QueryError("引用符「\"」が閉じられていません。フレーズ検索は \"このように\" 前後を「\"」で囲んでください。")
            term = s[i + 1:j].strip()
            i = j + 1
            if not term:
                raise QueryError("引用符の中が空です。\"語句\" のように、検索したい語句を引用符の中に書いてください。")
        else:
            j = i
            while j < n and s[j] != " " and s[j] != '"':
                j += 1
            term = s[i:j]
            i = j
        target = pq.negatives if neg else pq.positives
        if term not in target:
            target.append(term)
    if not pq.positives:
        raise QueryError("除外語（-語）だけでは検索できません。検索したい語句を1つ以上、除外語の前に入力してください。")
    if len(pq.positives) + len(pq.negatives) > MAX_TERMS:
        raise QueryError("検索語が多すぎます（上限 %d 語）。語を減らしてください。" % MAX_TERMS)
    return pq


def fts_phrase(term):
    """FTS5 のフレーズとして安全に使える形（"..." で囲み、内部の " は二重にする）にする。"""
    return '"' + term.replace('"', '""') + '"'


def like_pattern(term):
    """LIKE 用に、%・_・\\ をエスケープした部分一致パターン（ESCAPE '\\' とセットで使う）を返す。"""
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def is_long(term):
    """trigram の索引が効く（3文字以上の）語か。"""
    return len(term) >= TRIGRAM_MIN
