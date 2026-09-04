#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_sample_csv.py

madoguchi-analyzer 検証用のダミーCSVを生成する。
実データと同一のフォルダ階層・ファイル名規則・cp932・CRLF・65列で出力し、
理論値(集計期待値)を samples/expected.json に書き出す。

フォルダ階層: <out>/旧端末/令和<N>年/<M>月/<区コード><区名>/CD<YYMMDD><支店番号5桁>.CSV
文字コード: cp932 (Shift_JIS)  改行: CRLF  列数: 65固定  列3(業種名)のみクォート付き。

列マッピング・例外処理の定義は docs/SPEC.md を参照。このスクリプトは
SPEC.md 4.0〜4.6節のロジックに合わせて期待値を計算する
(取消除外・欠測終了時刻は既定「除外」・外れ値閾値は既定180分)。

使い方:
    # 小規模(動作確認用。samples/ にそのままコミットできるサイズ)
    python3 make_sample_csv.py --out ../samples/dummy_small --kus 2 --months 1,2 --seed 1

    # 大規模(負荷試験用。8区×12か月、約2000ファイル/約78万件相当)
    python3 make_sample_csv.py --out /tmp/madoguchi_perf --kus 8 --months 1-12 --seed 1 --scale full
"""
import argparse
import json
import os
import random
import statistics
from datetime import date, timedelta

# ---------------------------------------------------------------------------
# マスタデータ(ダミー)
# ---------------------------------------------------------------------------

# (区コード, 区名) 実データ(中区)に合わせ、あとはヨコハマ市の区名を借りた架空の8区
KU_MASTER = [
    ("01", "中区"),
    ("02", "西区"),
    ("03", "南区"),
    ("04", "神奈川区"),
    ("05", "保土ケ谷区"),
    ("06", "磯子区"),
    ("07", "金沢区"),
    ("08", "港北区"),
]

# (大区分, 業種名, 発生比率の重み, ピーク時間帯タイプ)
# 業種名は SPEC.md に挙がっている例をそのまま使用(ダミーなのでコードとの対応は実データと一致しない)
GYOSHU_MASTER = [
    (1, "証明書の交付", 30, "both"),
    (2, "住所の変更", 18, "morning"),
    (3, "国民健康保険", 12, "afternoon"),
    (4, "マイナンバーカード", 16, "both"),
    (5, "印鑑の登録", 8, "morning"),
    (6, "戸籍の届出・車臨番", 9, "both"),
    (7, "国民年金", 5, "afternoon"),
    (8, "保険料の納付", 6, "afternoon"),
]

REIWA_EPOCH_YEAR = 2018  # 令和1年=2019 -> western - 2018 = reiwa_year


def to_reiwa(year: int) -> int:
    return year - REIWA_EPOCH_YEAR


def sec_to_hms(sec: int) -> str:
    sec = max(0, int(round(sec)))
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


class RecordBuilder:
    """1件分の65列レコードを組み立てるヘルパー。列は1始まりで指定する。"""

    def __init__(self):
        self.cols = [""] * 65

    def set(self, idx1, value):
        self.cols[idx1 - 1] = "" if value is None else str(value)
        return self

    def row(self):
        return list(self.cols)


def gen_normal_record(seq_no, dai_kubun, gyoshu_name, group_no, issue_sec,
                       call_sec, end_sec, teller, op1=0):
    r = RecordBuilder()
    r.set(1, seq_no)
    r.set(2, dai_kubun)
    r.set(3, gyoshu_name)
    r.set(4, group_no)
    r.set(5, sec_to_hms(issue_sec))
    r.set(40, sec_to_hms(call_sec) if call_sec is not None else "")
    r.set(41, sec_to_hms(end_sec) if end_sec is not None else "")
    r.set(42, "")
    r.set(48, op1)
    r.set(49, 0)
    r.set(50, 0)
    r.set(51, random.randint(1, 4))
    r.set(52, random.randint(0, 3))
    r.set(53, teller if teller is not None else "")
    r.set(65, 1 if end_sec is not None else 0)
    return r.row()


def gen_cancel_record(seq_no, dai_kubun, gyoshu_name, group_no, issue_sec, cancel_sec):
    r = RecordBuilder()
    r.set(1, seq_no)
    r.set(2, dai_kubun)
    r.set(3, gyoshu_name)
    r.set(4, group_no)
    r.set(5, sec_to_hms(issue_sec))
    r.set(40, sec_to_hms(cancel_sec))
    r.set(41, sec_to_hms(cancel_sec))
    r.set(42, sec_to_hms(cancel_sec))
    r.set(48, 4)
    r.set(49, 0)
    r.set(50, 0)
    r.set(51, random.randint(1, 4))
    r.set(52, 0)
    r.set(53, "")
    r.set(65, 0)
    return r.row()


def gen_staff_call_record(dai_kubun, call_sec):
    """大区分50〜52: 係員呼出。注3のとおり 列4/48-52/60-65 は0、他は空欄。"""
    r = RecordBuilder()
    r.set(1, "")
    r.set(2, dai_kubun)
    r.set(3, "係員呼出")
    r.set(4, 0)
    r.set(5, sec_to_hms(call_sec))
    r.set(40, "")
    r.set(41, "")
    r.set(42, "")
    r.set(48, 0)
    r.set(49, 0)
    r.set(50, 0)
    r.set(51, 0)
    r.set(52, 0)
    r.set(53, "")
    r.set(65, 0)
    return r.row()


def gen_visit_count_record(count_sec):
    """大区分60: 来店カウント。注4のとおり 列4/48-52/60-65 は0、他は空欄。"""
    r = RecordBuilder()
    r.set(1, "")
    r.set(2, 60)
    r.set(3, "来店カウント")
    r.set(4, 0)
    r.set(5, sec_to_hms(count_sec))
    r.set(40, "")
    r.set(41, "")
    r.set(42, "")
    r.set(48, 0)
    r.set(49, 0)
    r.set(50, 0)
    r.set(51, 0)
    r.set(52, 0)
    r.set(53, "")
    r.set(65, 0)
    return r.row()


def sample_issue_time(rng, busy_factor):
    """朝(9-11時)と昼過ぎ(13-14時)に山が来る現実的な分布を返す(秒)。8:00〜17:34の範囲。"""
    peak = rng.choices(
        ["morning", "early", "noon", "afternoon", "late"],
        weights=[38, 10, 8, 34, 10],
        k=1,
    )[0]
    if peak == "morning":
        center, sd = 9.5 * 3600, 0.7 * 3600
    elif peak == "early":
        center, sd = 8.5 * 3600, 0.3 * 3600
    elif peak == "noon":
        center, sd = 12.3 * 3600, 0.5 * 3600
    elif peak == "afternoon":
        center, sd = 13.7 * 3600, 0.8 * 3600
    else:
        center, sd = 16.7 * 3600, 0.6 * 3600
    t = rng.gauss(center, sd)
    return int(clamp(t, 8 * 3600, 17 * 3600 + 34 * 60))


def build_day_records(rng, target_count, missing_end_rate, cancel_rate,
                       outlier_rate, staff_call_count, visit_count_count):
    """1区1日分のレコード群と、その理論値を作る。"""
    rows = []
    seq = 1
    exp = {
        "total_records": 0,
        "gyoshu_records": 0,      # 大区分1-32
        "visit_records": 0,       # 大区分60
        "staff_call_records": 0,  # 大区分50-52 (参考値)
        "cancel_records": 0,
        "missing_end_records": 0,
        "duration_minutes": [],   # 取消/欠測/外れ値を除いた処理時間(分) 集計用の生値(後でexpected.jsonには要約のみ格納)
        "wait_minutes": [],
        "after1630_duration_minutes": [],
        "bin_counts": [0] * 44,   # 8:00-19:00, 15分刻み(44ビン) 母数定義①(通常業務のみ)
    }

    for _ in range(target_count):
        issue_sec = sample_issue_time(rng, 1.0)
        dai_kubun, gyoshu_name, _, _ = rng.choices(
            GYOSHU_MASTER, weights=[g[2] for g in GYOSHU_MASTER], k=1
        )[0]
        group_no = rng.randint(1, 4)
        teller = rng.randint(16, 28)

        is_cancel = rng.random() < cancel_rate
        wait_min = clamp(rng.gauss(2.2, 2.0), 0.1, 25)
        call_sec = issue_sec + int(wait_min * 60)

        if is_cancel:
            cancel_sec = call_sec + rng.randint(0, 20)
            rows.append(gen_cancel_record(seq, dai_kubun, gyoshu_name, group_no,
                                           issue_sec, cancel_sec))
            exp["cancel_records"] += 1
            exp["total_records"] += 1
            exp["gyoshu_records"] += 1
            seq += 1
            _add_bin(exp["bin_counts"], issue_sec)
            continue

        is_outlier = rng.random() < outlier_rate
        if is_outlier:
            dur_min = rng.uniform(190, 226)
        else:
            dur_min = clamp(rng.lognormvariate(1.55, 0.55), 0.5, 179)

        is_missing_end = (issue_sec >= 16 * 3600 + 23 * 60) and (rng.random() < missing_end_rate)

        end_sec = None if is_missing_end else call_sec + int(dur_min * 60)

        rows.append(gen_normal_record(seq, dai_kubun, gyoshu_name, group_no,
                                       issue_sec, call_sec, end_sec, teller))
        exp["total_records"] += 1
        exp["gyoshu_records"] += 1
        seq += 1
        _add_bin(exp["bin_counts"], issue_sec)

        exp["wait_minutes"].append(wait_min)
        if is_missing_end:
            exp["missing_end_records"] += 1
        else:
            exp["duration_minutes"].append(dur_min)
            if issue_sec >= 16 * 3600 + 30 * 60:
                exp["after1630_duration_minutes"].append(dur_min)

    # 係員呼出(参考値。母数には含めない)
    for _ in range(staff_call_count):
        call_sec = sample_issue_time(rng, 1.0)
        dai_kubun = rng.choice([50, 51, 52])
        rows.append(gen_staff_call_record(dai_kubun, call_sec))
        exp["staff_call_records"] += 1
        exp["total_records"] += 1

    # 来店カウント(大区分60)
    for _ in range(visit_count_count):
        count_sec = sample_issue_time(rng, 1.0)
        rows.append(gen_visit_count_record(count_sec))
        exp["visit_records"] += 1
        exp["total_records"] += 1
        _add_bin_visit(exp, count_sec)

    rng.shuffle(rows)  # 実データ同様レコード順に規則性を持たせない
    return rows, exp


def _add_bin(bin_counts, issue_sec):
    idx = int((issue_sec - 8 * 3600) // 900)
    if 0 <= idx < len(bin_counts):
        bin_counts[idx] += 1


def _add_bin_visit(exp, count_sec):
    exp.setdefault("visit_bin_counts", [0] * 44)
    idx = int((count_sec - 8 * 3600) // 900)
    if 0 <= idx < len(exp["visit_bin_counts"]):
        exp["visit_bin_counts"][idx] += 1


def write_csv_cp932_quoted(path, rows):
    """実データ同様、列3(業種名)のみを常にダブルクォートで囲んでcp932で書き出す。"""
    lines = []
    for row in rows:
        cells = list(row)
        cells[2] = '"' + str(cells[2]).replace('"', '""') + '"'
        lines.append(",".join(str(c) for c in cells))
    text = "\r\n".join(lines) + "\r\n"
    with open(path, "wb") as f:
        f.write(text.encode("cp932", errors="replace"))


def month_range(spec: str):
    months = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-")
            months.update(range(int(a), int(b) + 1))
        elif part:
            months.add(int(part))
    return sorted(months)


def business_days(year, month):
    d = date(year, month, 1)
    days = []
    while d.month == month:
        if d.weekday() < 5:  # 月〜金
            days.append(d)
        d += timedelta(days=1)
    return days


def summarize(values):
    if not values:
        return {"count": 0, "mean": 0.0, "median": 0.0, "max": 0.0, "sum": 0.0}
    return {
        "count": len(values),
        "mean": round(statistics.mean(values), 4),
        "median": round(statistics.median(values), 4),
        "max": round(max(values), 4),
        "sum": round(sum(values), 4),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, help="出力先ディレクトリ")
    ap.add_argument("--year", type=int, default=2024, help="生成する年(西暦)")
    ap.add_argument("--kus", type=int, default=2, help="使用する区の数(先頭からKU_MASTERを使用、最大8)")
    ap.add_argument("--months", default="1,2", help="生成する月。例: 1,2 / 1-12")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--scale", choices=["small", "full"], default="small",
                     help="small: 1日あたり数十件(動作確認用) / full: 1日あたり約680件(実データ相当、負荷試験用)")
    ap.add_argument("--missing-end-rate", type=float, default=0.35,
                     help="16:23以降発行のレコードのうち、終了時刻を欠測させる割合")
    ap.add_argument("--cancel-rate", type=float, default=0.012, help="取消レコードの割合")
    ap.add_argument("--outlier-rate", type=float, default=0.01, help="外れ値(190〜226分)の割合")
    ap.add_argument("--base-count", type=int, default=None,
                     help="1区1日あたりの通常業務レコード数を直接指定(指定時は--scaleの既定値を上書き)")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    months = month_range(args.months)
    kus = KU_MASTER[: args.kus]

    out_root = os.path.abspath(args.out)
    os.makedirs(out_root, exist_ok=True)

    if args.scale == "full":
        base_count, staff_calls, visits = 640, 25, 15
    else:
        base_count, staff_calls, visits = 25, 3, 2
    if args.base_count is not None:
        base_count = args.base_count

    expected = {
        "generated_with": {
            "seed": args.seed,
            "scale": args.scale,
            "kus": [f"{c}{n}" for c, n in kus],
            "months": months,
            "year": args.year,
            "missing_end_rate": args.missing_end_rate,
            "cancel_rate": args.cancel_rate,
            "outlier_rate": args.outlier_rate,
        },
        "days": {},   # "YYYY-MM-DD|区コード" -> 日次理論値
        "overall": {},
        "files": 0,
        "rows": 0,
    }

    all_duration = []
    all_wait = []
    all_after1630 = []
    total_files = 0
    total_rows = 0

    for month in months:
        # 3月・4月は繁忙で件数増(1.4倍)
        busy_mult = 1.4 if month in (3, 4) else 1.0
        for d in business_days(args.year, month):
            for ku_code, ku_name in kus:
                target = int(base_count * busy_mult * rng.uniform(0.85, 1.15))
                rows, exp = build_day_records(
                    rng, target, args.missing_end_rate, args.cancel_rate,
                    args.outlier_rate, staff_calls, visits,
                )

                reiwa = to_reiwa(d.year)
                folder = os.path.join(
                    out_root, "旧端末", f"令和{reiwa}年", f"{d.month}月", f"{ku_code}{ku_name}"
                )
                os.makedirs(folder, exist_ok=True)
                fname = f"CD{d.strftime('%y%m%d')}00000.CSV"
                fpath = os.path.join(folder, fname)
                write_csv_cp932_quoted(fpath, rows)

                total_files += 1
                total_rows += len(rows)

                key = f"{d.isoformat()}|{ku_code}"
                dur_summary = summarize(exp["duration_minutes"])
                wait_summary = summarize(exp["wait_minutes"])
                after1630_summary = summarize(exp["after1630_duration_minutes"])
                expected["days"][key] = {
                    "date": d.isoformat(),
                    "ku_code": ku_code,
                    "ku_name": ku_name,
                    "total_records": exp["total_records"],
                    "gyoshu_records": exp["gyoshu_records"],
                    "visit_records": exp["visit_records"],
                    "staff_call_records": exp["staff_call_records"],
                    "cancel_records": exp["cancel_records"],
                    "missing_end_records": exp["missing_end_records"],
                    "duration_minutes_excl": dur_summary,
                    "wait_minutes": wait_summary,
                    "after1630_duration_minutes_excl": after1630_summary,
                    "bin_counts_15min_8to19_gyoshu": exp["bin_counts"],
                }

                all_duration.extend(exp["duration_minutes"])
                all_wait.extend(exp["wait_minutes"])
                all_after1630.extend(exp["after1630_duration_minutes"])

    expected["files"] = total_files
    expected["rows"] = total_rows
    expected["overall"] = {
        "duration_minutes_excl": summarize(all_duration),
        "wait_minutes": summarize(all_wait),
        "after1630_duration_minutes_excl": summarize(all_after1630),
    }

    exp_path = os.path.join(out_root, "expected.json")
    with open(exp_path, "w", encoding="utf-8") as f:
        json.dump(expected, f, ensure_ascii=False, indent=2)

    print(f"生成完了: files={total_files} rows={total_rows}")
    print(f"出力先: {out_root}")
    print(f"理論値: {exp_path}")


if __name__ == "__main__":
    main()
