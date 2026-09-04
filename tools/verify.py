#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify.py

tools/make_sample_csv.py が生成した理論値(expected.json)と、
dist/madoguchi-analyzer.html から書き出した「日別集計.csv」（⑥繁忙日の特定タブの
「全日分をCSV出力」ボタンで出力されるもの）を突合し、差異を表示する。

使い方:
    1. ブラウザで madoguchi-analyzer.html を開き、make_sample_csv.py で生成した
       フォルダ（例: samples/dummy_small）を投入する。
       母数定義は既定の「① 発券レコードのみ」のまま検証すること
       （expected.json の gyoshu_records と対応する）。
    2. 「⑥ 繁忙日の特定」タブで「全日分をCSV出力(UTF-8)」を押し、
       ダウンロードした 日別集計.csv を用意する。
    3. 次のコマンドで突合する:

       python3 verify.py --expected ../samples/dummy_small/expected.json --actual 日別集計.csv

差異が無ければ「OK」、あれば日付ごとの差分を一覧表示して終了コード1を返す。
"""
import argparse
import csv
import json
import sys
from collections import defaultdict


def load_expected_daily(expected_path):
    with open(expected_path, encoding="utf-8") as f:
        data = json.load(f)
    daily = defaultdict(int)
    for key, day in data["days"].items():
        daily[day["date"]] += day["gyoshu_records"]
    totals = {
        "files": data["files"],
        "rows": data["rows"],
        "gyoshu_records_total": sum(daily.values()),
    }
    return daily, totals, data


def load_actual_daily(actual_path):
    daily = {}
    with open(actual_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            if not row:
                continue
            date_str, weekday, count = row[0], row[1], row[2]
            daily[date_str] = int(count)
    return daily


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--expected", required=True, help="make_sample_csv.py が出力した expected.json")
    ap.add_argument("--actual", required=True, help="ツールから出力した 日別集計.csv")
    ap.add_argument("--tolerance", type=int, default=0, help="件数の許容誤差（既定0=完全一致）")
    args = ap.parse_args()

    expected_daily, totals, raw = load_expected_daily(args.expected)
    actual_daily = load_actual_daily(args.actual)

    all_dates = sorted(set(expected_daily.keys()) | set(actual_daily.keys()))
    mismatches = []
    for d in all_dates:
        exp = expected_daily.get(d, 0)
        act = actual_daily.get(d, None)
        if act is None:
            mismatches.append((d, exp, "―(出力に存在しない)"))
            continue
        if abs(exp - act) > args.tolerance:
            mismatches.append((d, exp, act))

    print(f"生成条件: seed={raw['generated_with']['seed']} scale={raw['generated_with']['scale']} "
          f"kus={raw['generated_with']['kus']} months={raw['generated_with']['months']}")
    print(f"理論値: files={totals['files']} rows={totals['rows']} "
          f"母数①(発券レコード)合計={totals['gyoshu_records_total']}")
    print(f"実測値: 日別集計.csv 合計={sum(actual_daily.values())} ({len(actual_daily)}日分)")
    print(f"比較対象日数: {len(all_dates)} / 差異: {len(mismatches)}")

    if mismatches:
        print("\n--- 差異のある日 ---")
        print(f"{'日付':12} {'期待値':>8} {'実測値':>8}")
        for d, exp, act in mismatches[:100]:
            print(f"{d:12} {exp:8} {str(act):>8}")
        if len(mismatches) > 100:
            print(f"…他 {len(mismatches)-100} 件")
        print("\n結果: NG（差異あり）")
        sys.exit(1)
    else:
        print("\n結果: OK（母数定義①の日別件数が理論値と完全一致）")
        sys.exit(0)


if __name__ == "__main__":
    main()
