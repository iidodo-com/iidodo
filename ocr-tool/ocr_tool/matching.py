"""読み取り結果と突合元データ（CSV）の照合。項目ごとに 一致 / 要確認 / 不一致 / 未読取 / 要目視 を判定する。"""
from __future__ import annotations

import csv
import difflib
import re
from dataclasses import dataclass
from pathlib import Path

from .errors import OcrToolError
from .form import FieldResult, Template
from .metrics import edit_distance
from .normalize import normalize_digits, normalize_text, parse_amount, parse_date_jp

OK, REVIEW, NG, EMPTY, HAND, SKIP = "一致", "要確認", "不一致", "未読取", "要目視", "読取OK"  # 読取OK=突合元なしで読み取れた（突合は未実施）
# 書類全体の判定は、より注意が必要な方を優先する
SEVERITY = {OK: 0, SKIP: 0, REVIEW: 1, HAND: 1, EMPTY: 2, NG: 3}


@dataclass
class Judgement:
    id: str
    label: str
    read_text: str
    read_value: object
    ref_value: str
    status: str
    reason: str
    conf: float | None
    result: FieldResult | None = None


def load_reference(path: str | Path) -> list[dict]:
    """突合元CSVを読む。文字コードは UTF-8(BOM可) → Shift-JIS(cp932) の順に試す。"""
    p = Path(path)
    if not p.is_file():
        raise OcrToolError(f"突合元ファイルが見つかりません: {p}", "--reference で CSV ファイルのパスを指定してください。")
    raw = p.read_bytes()
    for enc in ("utf-8-sig", "cp932"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise OcrToolError("突合元CSVの文字コードを判別できません。", "Excelで「CSV UTF-8」または「CSV」として保存し直してください。")
    rows = [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in csv.DictReader(text.splitlines())]
    if not rows:
        raise OcrToolError("突合元CSVにデータ行がありません。", "1行目に列見出し、2行目以降にデータがあるか確認してください。")
    return rows


def find_reference_row(rows: list[dict], key_column: str, key_read: str | None, digits: bool = True):
    """キー項目で突合元の行を探す。完全一致がなければ編集距離2以内の近い行を候補にする（要確認）。
    戻り値: (行 or None, 注記, 確度) 確度は 'exact' / 'near' / 'none'"""
    if rows and key_column not in rows[0]:
        raise OcrToolError(f"突合元CSVにキー列 '{key_column}' がありません（列: {', '.join(rows[0].keys())}）。",
                           "テンプレートの match.key_column を、CSVの見出しに合わせてください。")
    if not key_read:
        return None, "キー項目を読み取れなかったため、突合元の行を特定できません", "none"
    norm = (lambda s: normalize_digits(s, "-")) if digits else normalize_text
    k = norm(key_read)
    exact = [r for r in rows if norm(r[key_column]) == k]
    if len(exact) == 1:
        return exact[0], "", "exact"
    if len(exact) > 1:
        return exact[0], f"キー '{key_read}' が突合元に {len(exact)} 件あります（先頭を使用）", "near"
    near = sorted(((edit_distance(k, norm(r[key_column])), r) for r in rows), key=lambda t: t[0])
    if near and near[0][0] <= 2 and (len(near) == 1 or near[1][0] > near[0][0]):
        return near[0][1], f"キーが突合元と完全一致しません（読取 {key_read} / 候補 {near[0][1][key_column]}）", "near"
    return None, f"キー '{key_read}' が突合元に見つかりません", "none"


def _partial_ratio(text: str, needle: str) -> float:
    """text の中で needle に最も近い部分の類似度（0〜1）。needle と同じ長さの窓をずらして比べる。"""
    if not needle or not text:
        return 0.0
    n = len(needle)
    if len(text) <= n:
        return difflib.SequenceMatcher(None, text, needle).ratio()
    return max(difflib.SequenceMatcher(None, text[i:i + n], needle).ratio() for i in range(len(text) - n + 1))


def _compare(rule: str, read_value, ref_raw: str, opts: dict) -> tuple[str, str]:
    """1項目の比較。(判定, 理由) を返す。"""
    if rule == "amount":
        ref = parse_amount(ref_raw)
        return (OK, "") if ref is not None and read_value == ref else (NG, f"金額が違います（読取 {read_value:,} / 突合元 {ref_raw}）" if isinstance(read_value, int) else "金額が違います")
    if rule == "digits":
        a, b = normalize_digits(str(read_value), opts.get("keep", "-")), normalize_digits(ref_raw, opts.get("keep", "-"))
        return (OK, "") if a == b else (NG, f"数字が違います（読取 {a} / 突合元 {b}）")
    if rule == "date":
        ref = parse_date_jp(ref_raw)
        return (OK, "") if ref is not None and read_value == ref else (NG, f"日付が違います（読取 {read_value} / 突合元 {ref_raw}）")
    a, b = normalize_text(str(read_value)), normalize_text(ref_raw)
    if rule == "contains":
        if b and b in a:
            return OK, ""
        best = _partial_ratio(a, b)
        if best >= opts.get("threshold_review", 0.8):
            return REVIEW, f"突合元の文字列とほぼ同じ箇所があります（類似度 {best:.0%}。1文字の誤読の可能性）"
        return NG, "突合元の文字列が読み取り結果に含まれていません"
    ratio = difflib.SequenceMatcher(None, a, b).ratio() if (a or b) else 1.0
    ok_t, rev_t = opts.get("threshold_ok", 0.97), opts.get("threshold_review", 0.8)
    if a == b or ratio >= ok_t:
        return OK, ""
    if ratio >= rev_t:
        return REVIEW, f"似ているが違います（類似度 {ratio:.0%}）"
    return NG, f"文字列が違います（類似度 {ratio:.0%}）"


LOW_TEXT_CONF = 50.0  # 文字列項目で、これ未満の信頼度の不一致は「不一致」でなく「要確認」にする


def _consider_readings(r: FieldResult, m: dict, ref_raw: str, status: str, why: str) -> tuple[str, str]:
    """採用した読み方が突合元と一致しなくても、他の読み方が一致するかを見る。
    過半数の読み方が一致なら「一致」、一部だけなら「要確認」（誤読の可能性）にする。"""
    if status == OK or len(r.readings) < 2:
        return status, why
    ok = sum(1 for _, v, _ in r.readings if v is not None and _compare(m.get("rule", "text"), v, ref_raw, m)[0] == OK)
    total = len(r.readings)
    if ok * 2 >= total:
        return OK, ""
    if ok > 0:
        return REVIEW, f"{why}。別の読み方では突合元と一致しました（{ok}/{total}件）。誤読の可能性があります"
    return status, why


def _show(r: FieldResult) -> str:
    """表示用の読取値（金額は桁区切り、日付は YYYY-MM-DD、複数行は空白でつなぐ）。"""
    v = r.value
    if v is None:
        return r.text.replace("\n", " ")
    if isinstance(v, int):
        return f"{v:,}"
    if isinstance(v, tuple) and len(v) == 3:
        return f"{v[0]}-{v[1]:02d}-{v[2]:02d}"
    return str(v).replace("\n", " ")


def judge_document(results: list[FieldResult], tpl: Template, ref_row: dict | None, conf_threshold: float = 70.0) -> list[Judgement]:
    """1枚の帳票の全項目を判定する。ref_row が None のときは突合せず、読み取り品質だけで判定する。"""
    mapping = (tpl.match or {}).get("fields") or {}
    out: list[Judgement] = []
    check_js, verified = _checks(results, tpl)  # 整合性チェックが成り立った項目は、読み取りの揺れや低信頼度を問題にしない
    for r in results:
        m = mapping.get(r.id)
        ref_raw = ref_row.get(m["column"], "") if (ref_row is not None and m) else ""
        shown = _show(r)
        reasons = list(r.problems)
        if r.handwritten:
            note = "手書き欄のため目視で確認してください"
            if ref_row is not None and m and r.value is not None:
                st, _ = _compare(m.get("rule", "text"), r.value, ref_raw, m)
                note += "（読み取り値は突合元と" + ("一致" if st == OK else "不一致。誤読の可能性が高い") + "）"
            out.append(Judgement(r.id, r.label, r.text, shown, ref_raw, HAND, note, r.conf, r))
            continue
        if r.value is None:
            out.append(Judgement(r.id, r.label, r.text, "", ref_raw, EMPTY, "; ".join(reasons) or "読み取れませんでした", r.conf, r))
            continue
        if ref_row is None or not m:
            if r.id in verified:
                reasons = [x for x in reasons if "揺れ" not in x]
                out.append(Judgement(r.id, r.label, r.text, shown, "", SKIP, "; ".join(reasons) or "項目間の計算で確認済み", r.conf, r))
                continue
            low = r.conf is not None and r.conf < conf_threshold
            status = REVIEW if (reasons or low) else SKIP
            if low:
                reasons.append(f"信頼度が低い（{r.conf:.0f}）")
            out.append(Judgement(r.id, r.label, r.text, shown, "", status, "; ".join(reasons), r.conf, r))
            continue
        status, why = _compare(m.get("rule", "text"), r.value, ref_raw, m)
        status, why = _consider_readings(r, m, ref_raw, status, why)
        if status == NG and reasons:
            status = REVIEW  # 読み取りに不安があるときの不一致は、誤読の可能性があるので要確認にとどめる
            why += "。読み取りにも不安があります"
        if status == NG and r.type_is_text and r.conf is not None and r.conf < LOW_TEXT_CONF:
            status = REVIEW  # 文字列で信頼度がとても低いときの不一致は、誤読の可能性が高い
            why += f"。信頼度が低いため誤読の可能性があります（{r.conf:.0f}）"
        if status == OK:  # 突合元と一致していれば、読み方の揺れは問題にしない（形式違反だけ残す）
            reasons = [x for x in reasons if "揺れ" not in x]
        if why:
            reasons.insert(0, why)
        out.append(Judgement(r.id, r.label, r.text, shown, ref_raw, status, "; ".join(reasons), r.conf, r))
    out.extend(check_js)
    return out


def _checks(results: list[FieldResult], tpl: Template) -> tuple[list[Judgement], set[str]]:
    """項目間の整合性チェック（例: 金額 = 差引額 + 源泉所得税額）。読み取り単体でも誤読を発見できる。"""
    values = {r.id: r.value for r in results}
    out, verified = [], set()
    for c in tpl.checks:
        expr, name = str(c.get("expr", "")), str(c.get("name", c.get("expr", "")))
        if not re.fullmatch(r"[a-z0-9_ +\-=()]+", expr):
            raise OcrToolError(f"テンプレートの checks の式が不正です: {expr}", "項目id・数字・ + - == ( ) だけで書いてください。例: amount == net_amount + withholding")
        ids = set(re.findall(r"[a-z_][a-z0-9_]*", expr))
        if any(not isinstance(values.get(i), int) for i in ids):
            out.append(Judgement(f"check:{name}", f"整合性: {name}", "", "", "", REVIEW, "必要な項目を読み取れていないため確認できません", None))
            continue
        ok = bool(eval(expr, {"__builtins__": {}}, {i: values[i] for i in ids}))  # noqa: S307  文字種を検証済みの式
        out.append(Judgement(f"check:{name}", f"整合性: {name}", "", "成立" if ok else "不成立", "", OK if ok else NG,
                             "" if ok else "項目間の計算が合いません（どれかの読み違い、または書類の誤記）", None))
        if ok:
            verified |= ids
    return out, verified


def document_status(js: list[Judgement]) -> str:
    """書類全体の判定：一番重い項目の判定に合わせる。"""
    worst = max(js, key=lambda j: SEVERITY[j.status], default=None)
    if worst is None or SEVERITY[worst.status] == 0:
        return OK
    return {1: REVIEW, 2: REVIEW, 3: NG}[SEVERITY[worst.status]]
