#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
窓口受付時間シミュレーター用 サンプルCSV生成スクリプト

実データが手元になくても index.html の動作確認ができるよう、
「令和○年/○月/01中区/CD+YYMMDD+支店コード5桁.csv」という
フォルダ・ファイル構成のダミーCSV（Shift_JIS, 65列, ヘッダーなし）を生成し、
その分布から算出した期待値を expected.json として出力します。

注意：
  このスクリプトはランダム生成した「ダミーデータ」であり、
  実データ既知値（90.4% など）とは一致しません。
  検証モードでは、本スクリプトが出力する expected.json を
  index.html の「検証モード」タブから読み込むことで、
  ダミーデータと期待値が一致することを確認できます
  （＝検証モード自体の動作確認）。

使い方:
  python3 generate_sample.py
  python3 generate_sample.py --out-dir sample_data --days 30 --avg-visits 80

生成されるCSVの列レイアウト（index.html の設定パネルにそのまま入力してください）:
  列5  : 発券時刻（HHMMSS, 6桁）
  列40 : 一線呼出時刻（HHMMSS）
  列41 : 一線終了時刻（HHMMSS）
  列53 : 呼出テラーアドレス（窓口番号）
  列10 : 業務区分（50/51/52=係員呼出, 60=来店カウント）※このスクリプト独自の仮の列番号です
  列15 : （ダミー）ステータスコード 1〜3（列プロファイラの動作確認用）
  列20 : （ダミー）予約フラグ 0/1（列プロファイラの動作確認用）
"""
import argparse
import csv
import io
import json
import os
import random
from datetime import date, timedelta

COL_TOTAL = 65
COL_ISSUE = 5
COL_CALL = 40
COL_END = 41
COL_COUNTER = 53
COL_TASK = 10
COL_STATUS = 15
COL_RESV = 20

WARDS = [
    ("01", "中区", "00001", 1.4),
    ("02", "東区", "00002", 0.9),
    ("03", "南区", "00003", 0.9),
    ("04", "西区", "00004", 1.0),
    ("05", "安佐南区", "00005", 1.1),
    ("06", "安佐北区", "00006", 0.8),
    ("07", "安芸区", "00007", 0.6),
    ("08", "佐伯区", "00008", 0.8),
]

STAFF_CODES = [50, 51, 52]
VISIT_CODE = 60

CURRENT_START_MIN = 8 * 60 + 30   # 08:30
CURRENT_END_MIN = 17 * 60 + 15    # 17:15
NEW_START_MIN = 9 * 60            # 09:00
NEW_END_MIN = 16 * 60 + 30        # 16:30


def era_label(year, month):
    reiwa = year - 2018
    return f"令和{reiwa}年", f"{month}月"


def min_to_hhmmss(total_minutes, second=0):
    total_minutes = max(0, min(23 * 60 + 59, total_minutes))
    h = total_minutes // 60
    m = total_minutes % 60
    return f"{h:02d}{m:02d}{second:02d}"


def sample_arrival_minute(rng):
    """午前・昼過ぎにピークを持つ来庁時刻分布（7:30〜18:00の範囲、分単位）を生成する。"""
    peak = rng.choices(
        population=["morning", "midday", "afternoon"],
        weights=[0.42, 0.33, 0.25],
        k=1,
    )[0]
    if peak == "morning":
        center = 9 * 60 + 15
        sigma = 35
    elif peak == "midday":
        center = 11 * 60 + 30
        sigma = 45
    else:
        center = 15 * 60 + 30
        sigma = 60
    minute = int(rng.gauss(center, sigma))
    return max(7 * 60 + 30, min(18 * 60, minute))


def make_row(issue_min, call_min, end_min, counter, task, status, resv):
    fields = [""] * COL_TOTAL
    fields[COL_ISSUE - 1] = min_to_hhmmss(issue_min, second=random.randint(0, 59))
    if call_min is not None:
        fields[COL_CALL - 1] = min_to_hhmmss(call_min, second=random.randint(0, 59))
    if end_min is not None:
        fields[COL_END - 1] = min_to_hhmmss(end_min, second=random.randint(0, 59))
    fields[COL_COUNTER - 1] = str(counter)
    fields[COL_TASK - 1] = str(task)
    fields[COL_STATUS - 1] = str(status)
    fields[COL_RESV - 1] = str(resv)
    return fields


def generate(out_dir, start_date, days, avg_visits, staff_rate, seed):
    rng = random.Random(seed)
    total_visit_rows = 0
    current_hours_rows = 0
    new_hours_rows = 0
    front30_rows = 0
    back45_rows = 0

    for d in range(days):
        cur_date = start_date + timedelta(days=d)
        if cur_date.weekday() >= 5:  # 土日は開庁なしとみなす
            continue
        year, month, day = cur_date.year, cur_date.month, cur_date.day
        era_dir, month_dir = era_label(year, month)
        yy = year % 100

        for ward_code, ward_name, branch_code, weight in WARDS:
            folder = os.path.join(out_dir, era_dir, month_dir, f"{ward_code}{ward_name}")
            os.makedirs(folder, exist_ok=True)
            filename = f"CD{yy:02d}{month:02d}{day:02d}{branch_code}.csv"
            filepath = os.path.join(folder, filename)

            n_visits = max(0, int(rng.gauss(avg_visits * weight, avg_visits * weight * 0.15)))
            rows = []
            counter_pool = list(range(1, 13))

            for _ in range(n_visits):
                issue_min = sample_arrival_minute(rng)
                counter = rng.choice(counter_pool)
                status = rng.choice([1, 2, 3])
                resv = rng.choice([0, 0, 0, 1])

                # 来店カウント（母数）行：呼出/終了は発券直後の数分以内とみなす簡易値
                call_min = issue_min + rng.randint(0, 2)
                end_min = call_min + rng.randint(0, 2)
                rows.append(make_row(issue_min, call_min, end_min, counter, VISIT_CODE, status, resv))

                total_visit_rows += 1
                if CURRENT_START_MIN <= issue_min < CURRENT_END_MIN:
                    current_hours_rows += 1
                    if NEW_START_MIN <= issue_min < NEW_END_MIN:
                        new_hours_rows += 1
                    elif CURRENT_START_MIN <= issue_min < NEW_START_MIN:
                        front30_rows += 1
                    elif NEW_END_MIN <= issue_min < CURRENT_END_MIN:
                        back45_rows += 1

                # 一部の来庁者について、実際の窓口処理（係員呼出）行を追加生成する。
                if rng.random() < staff_rate:
                    wait = max(0, int(rng.gauss(12, 8)))
                    proc = max(1, int(rng.gauss(7, 4)))
                    staff_call_min = issue_min + wait
                    staff_end_min = staff_call_min + proc
                    task_code = rng.choice(STAFF_CODES)
                    rows.append(make_row(issue_min, staff_call_min, staff_end_min, counter, task_code, status, resv))

            rng.shuffle(rows)
            with io.StringIO(newline="") as buf:
                writer = csv.writer(buf, lineterminator="\r\n")
                for r in rows:
                    writer.writerow(r)
                content = buf.getvalue()
            with open(filepath, "wb") as f:
                f.write(content.encode("shift_jis", errors="replace"))

    ratio = (new_hours_rows / current_hours_rows * 100) if current_hours_rows else 0.0
    expected = {
        "total": total_visit_rows,
        "currentHours": current_hours_rows,
        "newHoursCount": new_hours_rows,
        "newHoursRatio": round(ratio, 1),
        "front30": front30_rows,
        "back45": back45_rows,
        "_meta": {
            "note": "generate_sample.py が生成したダミーデータの期待値です。実データ既知値（総件数781,149等）とは一致しません。",
            "basis": "発券時刻",
            "current_hours": "08:30-17:15",
            "new_hours": "09:00-16:30",
            "column_hints": {
                "colIssue": COL_ISSUE, "colCall": COL_CALL, "colEnd": COL_END,
                "colCounter": COL_COUNTER, "colTask": COL_TASK, "colTotal": COL_TOTAL,
                "timeFormat": "HHMMSS",
                "taskStaffCodes": STAFF_CODES, "taskVisitCodes": [VISIT_CODE]
            },
            "seed": seed, "days_requested": days, "avg_visits_per_ward_per_day": avg_visits
        }
    }
    with open(os.path.join(out_dir, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(expected, f, ensure_ascii=False, indent=2)

    return expected


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", default="sample_data", help="出力先ディレクトリ（既定: sample_data）")
    ap.add_argument("--start-date", default="2025-04-01", help="生成開始日 YYYY-MM-DD（既定: 2025-04-01）")
    ap.add_argument("--days", type=int, default=30, help="生成日数（土日は自動でスキップ、既定: 30）")
    ap.add_argument("--avg-visits", type=float, default=80, help="区あたり1日平均来庁件数（既定: 80）")
    ap.add_argument("--staff-rate", type=float, default=0.7, help="来庁者のうち実際に窓口処理行も生成する割合（既定: 0.7）")
    ap.add_argument("--seed", type=int, default=42, help="乱数シード（既定: 42、再現性のため固定）")
    args = ap.parse_args()

    y, m, d = map(int, args.start_date.split("-"))
    start_date = date(y, m, d)

    print(f"生成開始: {args.out_dir} / {args.start_date} から {args.days} 日分 / 区あたり平均 {args.avg_visits} 件/日")
    expected = generate(args.out_dir, start_date, args.days, args.avg_visits, args.staff_rate, args.seed)
    print("生成完了。")
    print(json.dumps(expected, ensure_ascii=False, indent=2))
    print(f"\nexpected.json を {os.path.join(args.out_dir, 'expected.json')} に出力しました。")
    print("index.html の「検証モード」タブから expected.json を読み込むと、このダミーデータに対する検証ができます。")
    print(f"設定パネルには 業務区分列={COL_TASK} / 時刻書式=HHMMSS（または自動判定）を入力してください。")


if __name__ == "__main__":
    main()
