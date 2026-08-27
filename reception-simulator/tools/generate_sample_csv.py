#!/usr/bin/env python3
"""
広島市区役所発券機データ サンプルCSV生成スクリプト
====================================================

「窓口受付時間シミュレーター」(reception-simulator/index.html) の動作確認・
性能検証のために、実データと同じ形式(65列固定・ヘッダーなし・Shift_JIS・
CD+YYMMDD+支店コード5桁のファイル名・令和年/月/区名のフォルダ構成)の
ダミーCSVを生成する。値はすべて乱数で、実在の来庁実績とは無関係。

出力と同時に ground_truth.json を書き出す。これはこのスクリプト自身が
シミュレーターと同じ計算式で算出した「期待値」であり、アプリの計算結果を
自動テストで突き合わせるために使う(実データの90.4%等とは一致しない。
これはあくまで生成したダミーデータに対する内部整合性チェック用)。

列レイアウト(1始まり、アプリのデフォルト設定と一致させている):
  1列目  : 発券番号(連番、参考値)
  5列目  : 発券時刻   (HHMMSS)
  40列目 : 一線呼出時刻 (HHMMSS、業務区分60では空)
  41列目 : 一線終了時刻 (HHMMSS、業務区分60では空)
  53列目 : 呼出テラーアドレス
  54列目 : 業務大区分  (50/51/52=係員呼出, 60=来店カウント)
  他列  : 空文字(未使用のダミー列)

使い方の例:
  # 小規模(動作確認・自動テスト用、数万行、数秒で生成)
  python3 generate_sample_csv.py --out ./sample_small --start 2025-04-01 --end 2025-04-30

  # 大規模(78万行相当、性能検証用)
  python3 generate_sample_csv.py --out ./sample_full --start 2025-04-01 --end 2026-05-21 --scale full
"""
import argparse
import csv
import json
import os
import random
from datetime import date, datetime, timedelta

NUM_COLS = 65
COL_TICKET_NO = 1
COL_ISSUE_TIME = 5
COL_CALL_TIME = 40
COL_END_TIME = 41
COL_TELLER = 53
COL_CATEGORY = 54

# 広島市8区 (フォルダ名は "01中区" のように連番2桁+区名)
WARDS = [
    ("01", "中区", "10101"),
    ("02", "東区", "10102"),
    ("03", "南区", "10103"),
    ("04", "西区", "10104"),
    ("05", "安佐南区", "10105"),
    ("06", "安佐北区", "10106"),
    ("07", "安芸区", "10107"),
    ("08", "佐伯区", "10108"),
]

# --ascii-names 用(自動テストツールが非ASCIIパスのファイル注入に対応できない環境向け)
WARDS_ASCII = [
    ("01", "WardChuo", "10101"),
    ("02", "WardHigashi", "10102"),
    ("03", "WardMinami", "10103"),
    ("04", "WardNishi", "10104"),
    ("05", "WardAsaminami", "10105"),
    ("06", "WardAsakita", "10106"),
    ("07", "WardAki", "10107"),
    ("08", "WardSaeki", "10108"),
]

STAFF_CALL_CODES = [50, 51, 52]
VISIT_COUNT_CODE = 60

CURRENT_START_MIN = 8 * 60 + 30   # 08:30
CURRENT_END_MIN = 17 * 60 + 15    # 17:15
# 発券自体は現行受付時間より少し前後に広がりうる(早出待ち・駆け込み)ことを再現
ISSUE_SPREAD_BEFORE = 20   # 分
ISSUE_SPREAD_AFTER = 25    # 分

OVERTIME_BASIS_MIN = 16 * 60 + 30  # 16:30
PROCESSING_TIME_MAX_MIN = 180


def reiwa_folder(d: date, ascii_names: bool = False) -> str:
    reiwa_year = d.year - 2018
    return f"R{reiwa_year}" if ascii_names else f"令和{reiwa_year}年"


def month_folder(d: date, ascii_names: bool = False) -> str:
    return f"M{d.month}" if ascii_names else f"{d.month}月"


def hhmmss(total_minutes: float) -> str:
    # 書き出す文字列は total_minutes を秒単位に丸めた値そのものにする(ground truth の
    # 判定もこの total_minutes を使うため、ここでランダムな秒を混ぜると境界付近で
    # CSVの表示値とground truthの判定値がずれて集計が食い違う)。
    total_minutes = max(0.0, min(24 * 60 - 1 / 60.0, total_minutes))
    total_seconds = int(round(total_minutes * 60))
    h = total_seconds // 3600
    m = (total_seconds % 3600) // 60
    s = total_seconds % 60
    return f"{h:02d}{m:02d}{s:02d}"


def sample_issue_minute(rng: random.Random) -> float:
    """来庁(発券)時刻を分単位で1つサンプルする。

    現行受付時間の前後に一定の裾を持つ三角分布っぽい合成分布とし、
    昼(12時台)にやや谷ができるようにして「それらしい」形にする。
    """
    lo = CURRENT_START_MIN - ISSUE_SPREAD_BEFORE
    hi = CURRENT_END_MIN + ISSUE_SPREAD_AFTER
    while True:
        # 台形分布: 中心に寄せつつ端も出るよう2つの一様分布を混合
        if rng.random() < 0.85:
            m = rng.triangular(CURRENT_START_MIN, CURRENT_END_MIN,
                                (CURRENT_START_MIN + CURRENT_END_MIN) / 2)
        else:
            m = rng.uniform(lo, hi)
        # 昼休み時間帯(12:00-13:00)は来庁がやや少ない
        if 12 * 60 <= m < 13 * 60 and rng.random() < 0.55:
            continue
        if lo <= m <= hi:
            return m


def build_row(rng: random.Random, ticket_no: int, issue_min: float, teller_id: int) -> list:
    row = [""] * NUM_COLS
    row[COL_TICKET_NO - 1] = str(ticket_no)
    row[COL_ISSUE_TIME - 1] = hhmmss(issue_min)
    row[COL_TELLER - 1] = f"T{teller_id:02d}"

    if rng.random() < 0.4:
        category = VISIT_COUNT_CODE
    else:
        category = rng.choice(STAFF_CALL_CODES)
    row[COL_CATEGORY - 1] = str(category)

    if category != VISIT_COUNT_CODE:
        wait = max(0.0, rng.gauss(12, 8))
        call_min = issue_min + wait
        # 通常業務時間はおおむね数分〜十数分、まれに長時間化(異常値テスト用)
        if rng.random() < 0.01:
            service = rng.uniform(190, 400)  # 異常値(閾値超)を意図的に混入
        elif rng.random() < 0.02:
            service = -rng.uniform(1, 10)  # 負値異常も少数混入(機器都合の逆転)
        else:
            service = max(0.5, rng.gauss(9, 5))
        end_min = call_min + service
        call_min = round(call_min * 60) / 60
        end_min = round(end_min * 60) / 60
        row[COL_CALL_TIME - 1] = hhmmss(call_min)
        row[COL_END_TIME - 1] = hhmmss(end_min)
    else:
        call_min = None
        end_min = None

    return row, category, call_min, end_min


def daterange_weekdays(start: date, end: date):
    d = start
    while d <= end:
        if d.weekday() < 5:  # 月-金のみ(区役所窓口を想定、祝日は簡略化のため考慮せず)
            yield d
        d += timedelta(days=1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="出力先ルートディレクトリ")
    ap.add_argument("--start", default="2025-04-01")
    ap.add_argument("--end", default="2026-05-21")
    ap.add_argument("--wards", default="all", help="'all' または '01,02' のようなカンマ区切りの区コード")
    ap.add_argument("--rows-per-day-per-ward", type=int, default=None,
                     help="1区1営業日あたりの生成行数(平均)。--scale full の場合は自動算出")
    ap.add_argument("--scale", choices=["small", "full"], default="small",
                     help="small: 動作確認向けの少量データ / full: 実運用相当(全期間×全区で約78万行)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--ascii-names", action="store_true",
                     help="フォルダ名・区名をASCIIのみにする(非ASCIIパスを扱えない自動テストツール向け。通常は指定不要)")
    args = ap.parse_args()

    rng = random.Random(args.seed)

    start = datetime.strptime(args.start, "%Y-%m-%d").date()
    end = datetime.strptime(args.end, "%Y-%m-%d").date()

    ward_master = WARDS_ASCII if args.ascii_names else WARDS
    if args.wards == "all":
        wards = ward_master
    else:
        codes = set(args.wards.split(","))
        wards = [w for w in ward_master if w[0] in codes]

    days = list(daterange_weekdays(start, end))
    if args.rows_per_day_per_ward is not None:
        rows_per_day_per_ward = args.rows_per_day_per_ward
    elif args.scale == "full":
        # 実データ(約78万件 / 約14ヶ月 / 8区)の実勢感に合わせた目安値
        rows_per_day_per_ward = max(1, round(780000 / max(1, len(days)) / max(1, len(wards))))
    else:
        rows_per_day_per_ward = 25

    os.makedirs(args.out, exist_ok=True)

    total_rows = 0
    excluded_from_generation = 0  # このスクリプトが意図的に混入させた異常値件数(参考値)

    gt = {
        "config_assumptions": {
            "issue_time_col": COL_ISSUE_TIME,
            "call_time_col": COL_CALL_TIME,
            "end_time_col": COL_END_TIME,
            "category_col": COL_CATEGORY,
            "visit_count_code": VISIT_COUNT_CODE,
            "staff_call_codes": STAFF_CALL_CODES,
            "time_format": "HHMMSS",
            "current_hours": {"start": "08:30", "end": "17:15"},
            "boundary": "start_inclusive_end_exclusive",
        },
        "generation": {
            "start": args.start, "end": args.end, "seed": args.seed,
            "wards": [w[1] for w in wards], "rows_per_day_per_ward": rows_per_day_per_ward,
        },
        "test_proposals": [],
    }

    # 検証用シナリオ: 9:00-16:30 に加え、現行時間そのもの(変化なし=100%になるはず)も併記
    scenarios = [
        {"start": "09:00", "end": "16:30"},
        {"start": "08:30", "end": "17:15"},
    ]
    scenario_counts = [
        {"denom": 0, "numerator": 0, "front_cut": 0, "back_cut": 0}
        for _ in scenarios
    ]

    overtime = {"count": 0, "sum_minutes": 0.0, "excluded": 0}

    ticket_no = 0
    for d in days:
        folder = os.path.join(args.out, reiwa_folder(d, args.ascii_names), month_folder(d, args.ascii_names))
        for ward_code, ward_name, branch_code in wards:
            ward_folder = os.path.join(folder, f"{ward_code}{ward_name}")
            os.makedirs(ward_folder, exist_ok=True)
            fname = f"CD{d.strftime('%y%m%d')}{branch_code}.csv"
            fpath = os.path.join(ward_folder, fname)

            n = max(0, round(rng.gauss(rows_per_day_per_ward, rows_per_day_per_ward * 0.15)))
            rows = []
            for _ in range(n):
                ticket_no += 1
                # 秒単位に丸めてから使う: hhmmss()の書き出し値とground truthの判定値を完全一致させるため
                # (丸めないと、境界ちょうどの時刻で「CSVに書かれた値」と「ground truthの判定に使った値」が
                #  1秒未満の差でずれ、集計件数が数件単位で食い違うことがある)。
                issue_min = round(sample_issue_minute(rng) * 60) / 60
                teller_id = rng.randint(1, 6)
                row, category, call_min, end_min = build_row(rng, ticket_no, issue_min, teller_id)
                rows.append(row)

                if category == VISIT_COUNT_CODE:
                    for scen, cnt in zip(scenarios, scenario_counts):
                        s_start = int(scen["start"][:2]) * 60 + int(scen["start"][3:])
                        s_end = int(scen["end"][:2]) * 60 + int(scen["end"][3:])
                        in_current = CURRENT_START_MIN <= issue_min < CURRENT_END_MIN
                        if in_current:
                            cnt["denom"] += 1
                            if s_start <= issue_min < s_end:
                                cnt["numerator"] += 1
                            if CURRENT_START_MIN <= issue_min < s_start:
                                cnt["front_cut"] += 1
                            if s_end <= issue_min < CURRENT_END_MIN:
                                cnt["back_cut"] += 1
                else:
                    if issue_min >= OVERTIME_BASIS_MIN:
                        proc = end_min - call_min
                        if proc < 0 or proc > PROCESSING_TIME_MAX_MIN:
                            overtime["excluded"] += 1
                        else:
                            overtime["count"] += 1
                            overtime["sum_minutes"] += proc

            with open(fpath, "w", newline="", encoding="shift_jis", errors="strict") as f:
                w = csv.writer(f)
                for row in rows:
                    w.writerow(row)

            total_rows += len(rows)

    for scen, cnt in zip(scenarios, scenario_counts):
        denom = cnt["denom"]
        ratio = (cnt["numerator"] / denom) if denom else 0.0
        gt["test_proposals"].append({
            "start": scen["start"], "end": scen["end"],
            "denom_current_hours": denom,
            "numerator_in_new_hours": cnt["numerator"],
            "ratio_percent": round(ratio * 100, 1),
            "front_cut": cnt["front_cut"],
            "back_cut": cnt["back_cut"],
        })

    gt["overtime"] = {
        "basis_time": "16:30",
        "target_count": overtime["count"],
        "sum_minutes": round(overtime["sum_minutes"], 2),
        "avg_minutes": round(overtime["sum_minutes"] / overtime["count"], 3) if overtime["count"] else 0,
        "excluded_abnormal_count": overtime["excluded"],
    }
    gt["total_rows"] = total_rows

    gt_path = os.path.join(args.out, "ground_truth.json")
    with open(gt_path, "w", encoding="utf-8") as f:
        json.dump(gt, f, ensure_ascii=False, indent=2)

    print(f"生成完了: {total_rows}行 -> {args.out}")
    print(f"ground truth -> {gt_path}")


if __name__ == "__main__":
    main()
