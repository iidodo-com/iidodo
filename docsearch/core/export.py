"""検索結果・インデックス作成レポートのCSV出力。"""
import csv
import os

_FORMULA_HEAD = ("=", "+", "-", "@", "\t", "\r")


def _safe(v):
    """Excelで開いたときに数式として実行されないよう、先頭が = + - @ の文字列には ' を付ける。"""
    s = "" if v is None else str(v)
    return "'" + s if s.startswith(_FORMULA_HEAD) else s


def write_results_csv(results, path):
    """検索結果をCSV（UTF-8 BOM付き。Excelで文字化けしない）に保存する。保存先フォルダが無ければ作る。"""
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["ファイル名", "フォルダ", "フルパス", "場所", "更新日", "スニペット(正規化後)", "bm25", "ファイル内の該当場所数"])
        for r in results:
            w.writerow([_safe(x) for x in (r.name, r.folder, r.fullpath, r.location, r.mtime_text, r.snippet,
                                           "" if r.score is None else "%.4f" % r.score, r.place_hits)])


def write_issues_csv(rows, path):
    """対象外・エラー・テキスト抽出不可の一覧を CSV に保存する。rows は (種別, フルパス, 場所, 詳細) の列。"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["種別", "ファイル", "場所", "詳細"])
        for r in rows:
            w.writerow([_safe(x) for x in r])
