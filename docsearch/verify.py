"""検証: ダミー文書を生成→インデックス作成→expected.json と検索結果を突き合わせ、見逃し・誤検出を数える。

使い方: python verify.py [--work verify_out] [--bulk 200]   （自動テストと同じ処理を、結果の表つきで実行）
"""
import argparse
import json
import os
import shutil
import sys
import time

import generate_sample
from core import db
from core.config import Config
from core.indexer import run_index
from core.searcher import build_options, search


def make_config(work, bulk=False):
    """検証用の Config（ダミー文書フォルダ、index.db は work 配下）を作る。"""
    roots = [os.path.join(work, "docs")] + ([os.path.join(work, "bulk")] if bulk else [])
    return Config(roots=roots, db_path=os.path.join(work, "index.db"), output_dir=os.path.join(work, "output"))


def dir_size(path):
    """通常ファイルの合計サイズ（シンボリックリンクは除く）。"""
    total = 0
    for dp, _dn, fns in os.walk(path):
        for fn in fns:
            p = os.path.join(dp, fn)
            if os.path.isfile(p) and not os.path.islink(p):
                total += os.path.getsize(p)
    return total


def evaluate(conn, exp):
    """expected.json の各検索を実行し、期待と比べた結果（見逃し・誤検出・場所の誤り）の一覧を返す。"""
    rows = []
    for sp in exp["searches"]:
        opts = build_options(",".join(sp.get("ext", [])), sp.get("folder", ""), sp.get("since", ""), "", 100000,
                             "relevance", sp["scope"])
        res = search(conn, sp["query"], opts)
        row = {"id": sp["id"], "query": sp["query"], "note": sp["note"], "scope": sp["scope"], "total": res.total,
               "full_scan": res.full_scan, "sort_used": res.sort_used}
        if sp["scope"] == "place":
            want = {tuple(x) for x in sp["expect"]}
            got = {(r.relpath, r.location) for r in res.results}
            row["location_errors"] = []
        else:
            want = set(sp["expect_files"])
            got = {r.relpath for r in res.results}
            bad = [(r.relpath, r.location) for r in res.results if r.location not in sp["expect_locations"].get(r.relpath, [])]
            best = sp.get("best_location", {})
            bad += [(r.relpath, r.location) for r in res.results if r.relpath in best and r.location != best[r.relpath]]
            row["location_errors"] = bad
        row.update(expected=len(want), detected=len(want & got), missed=sorted(map(str, want - got)),
                   false_positive=sorted(map(str, got - want)), duplicates=len(res.results) - len(got))
        row["full_scan_ok"] = bool(sp.get("full_scan", False)) == res.full_scan
        row["ok"] = (not row["missed"] and not row["false_positive"] and not row["location_errors"]
                     and row["duplicates"] == 0 and row["full_scan_ok"])
        rows.append(row)
    return rows


def compare_issues(conn, exp):
    """DBの issues（対象外・エラー等）と、expected_issues を突き合わせる。(未検出, 想定外) を返す。"""
    got = set()
    for kind, rel, loc in conn.execute("SELECT i.kind, f.relpath, i.location FROM issues i JOIN files f ON f.id=i.file_id"):
        got.add((rel, kind, loc))
    want = {(i["file"], i["kind"], i["location"]) for i in exp["expected_issues"]}
    return sorted(want - got), sorted(got - want)


def run_verification(work, quiet=True):
    """生成→取り込み→評価を行い、結果の辞書を返す。work は作り直される。"""
    exp = generate_sample.generate(work, quiet=quiet)
    cfg = make_config(work)
    conn = db.connect_rw(cfg.db_path)
    t0 = time.time()
    stats = run_index(cfg, conn)
    elapsed = time.time() - t0
    rows = evaluate(conn, exp)
    miss_i, extra_i = compare_issues(conn, exp)
    ok, msg = db.check_integrity(conn)
    kinds = dict(conn.execute("SELECT kind, count(*) FROM issues GROUP BY kind").fetchall())
    conn.close()
    src = dir_size(os.path.join(work, "docs"))
    res = {"exp": exp, "rows": rows, "stats": stats, "elapsed": elapsed, "issues_missing": miss_i, "issues_extra": extra_i,
           "integrity": (ok, msg), "kinds": kinds, "src_bytes": src, "db_bytes": os.path.getsize(cfg.db_path), "cfg": cfg}
    return res


def format_report(r):
    """検証結果を、利用者向けの表（Markdown風）に整形する。"""
    L = ["| ID | 検索語 | 範囲 | 期待 | 検出 | 見逃し | 誤検出 | 場所の誤り | 判定 |", "|---|---|---|---|---|---|---|---|---|"]
    te = td = tm = tf = 0
    for x in r["rows"]:
        L.append("| %s | %s | %s | %d | %d | %d | %d | %d | %s |" % (
            x["id"], x["query"].replace("|", "\\|"), "場所" if x["scope"] == "place" else "ファイル", x["expected"], x["detected"],
            len(x["missed"]), len(x["false_positive"]), len(x["location_errors"]), "OK" if x["ok"] else "NG"))
        te += x["expected"]; td += x["detected"]; tm += len(x["missed"]); tf += len(x["false_positive"])
    L.append("| 合計 | | | %d | %d | %d | %d | | |" % (te, td, tm, tf))
    s = r["stats"]
    L += ["", "- 取り込み: 対象 %d ファイル、処理 %d、エラー %d、除外パターン %d、対象外の拡張子 %d、所要 %.2f 秒" % (
        s.total_targets, len(s.processed), s.errors, s.pattern_excluded, s.other_ext, r["elapsed"]),
        "- 種別ごとの件数: " + "、".join("%s %d" % kv for kv in sorted(r["kinds"].items())),
        "- issues の未検出 %d 件、想定外 %d 件 %s" % (len(r["issues_missing"]), len(r["issues_extra"]), r["issues_missing"] + r["issues_extra"]),
        "- FTS整合性（integrity-check）: %s" % r["integrity"][1],
        "- index.db %.1f KB / 元ファイル合計 %.1f KB = %.2f 倍（ダミー文書。小さい文書はOffice形式の定型部分が大きいため、実文書の比とは異なる）" % (
            r["db_bytes"] / 1024, r["src_bytes"] / 1024, r["db_bytes"] / max(1, r["src_bytes"]))]
    return "\n".join(L)


def measure_bulk(work, n):
    """速度・サイズの目安: ダミーの Word/Excel/PowerPoint を n 個生成し、別のDBに取り込んで時間とサイズ比を測る。"""
    bulk = os.path.join(work, "bulk")
    if os.path.exists(bulk):
        shutil.rmtree(bulk)
    generate_sample.generate_bulk(bulk, n)
    cfg = Config(roots=[bulk], db_path=os.path.join(work, "bulk_index.db"), output_dir=os.path.join(work, "output"))
    if os.path.exists(cfg.db_path):
        os.remove(cfg.db_path)
    conn = db.connect_rw(cfg.db_path)
    out = {"n": n, "src_bytes": dir_size(bulk)}
    t0 = time.time()
    st = run_index(cfg, conn)
    out["index_sec"] = time.time() - t0
    out["files"] = st.total_targets
    t0 = time.time()
    st2 = run_index(cfg, conn)
    out["rerun_sec"], out["rerun_processed"] = time.time() - t0, len(st2.processed)
    out["db_bytes"] = os.path.getsize(cfg.db_path)
    out["chunks"] = conn.execute("SELECT count(*) FROM chunks").fetchone()[0]
    out["text_bytes"] = conn.execute("SELECT sum(length(text)) FROM chunks").fetchone()[0]
    timings = {}
    for label, q, scope in (("3文字以上・ファイル内", "損害賠償", "file"), ("3文字以上・同じ場所内", "損害賠償", "place"),
                            ("AND2語・ファイル内", "検収 報告", "file"), ("2文字（LIKE全件走査）・ファイル内", "検収", "file"),
                            ("2文字（LIKE全件走査）・同じ場所内", "検収", "place"), ("フレーズ", "\"料金の支払は月末締め\"", "file")):
        best, total = 1e9, 0
        for _ in range(3):
            t0 = time.time()
            r = search(conn, q, build_options(limit=50, scope=scope))
            best = min(best, time.time() - t0)
            total = r.total
        timings[label] = (best, total)
    out["timings"] = timings
    out["integrity"] = db.check_integrity(conn)
    conn.close()
    return out


def format_bulk(b):
    """measure_bulk の結果を整形する。"""
    L = ["- ダミー大量生成: %d ファイル、元ファイル合計 %.1f MB、本文 %d か所（正規化後の本文 %.1f MB）" % (
        b["files"], b["src_bytes"] / 1048576, b["chunks"], b["text_bytes"] / 1048576),
        "- 初回インデックス %.1f 秒（%.0f ファイル/秒）、変更なしの再実行 %.2f 秒（再処理 %d ファイル）" % (
            b["index_sec"], b["files"] / b["index_sec"], b["rerun_sec"], b["rerun_processed"]),
        "- index.db %.2f MB / 元ファイル合計 %.2f MB = %.2f 倍（正規化後の本文に対しては %.2f 倍）" % (
            b["db_bytes"] / 1048576, b["src_bytes"] / 1048576, b["db_bytes"] / b["src_bytes"], b["db_bytes"] / b["text_bytes"]),
        "- 検索時間（3回中の最小）:"]
    for k, (t, total) in b["timings"].items():
        L.append("  - %s: %.3f 秒（該当 %d）" % (k, t, total))
    L.append("- FTS整合性: %s" % b["integrity"][1])
    return "\n".join(L)


def main():
    """コマンドライン入口。"""
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="verify_out")
    ap.add_argument("--bulk", type=int, default=0, help="速度・サイズ比の目安用に、ダミー文書をN個追加生成して測定する")
    a = ap.parse_args()
    r = run_verification(a.work, quiet=False)
    print(format_report(r))
    if a.bulk:
        print("\n" + format_bulk(measure_bulk(a.work, a.bulk)))
    bad = [x for x in r["rows"] if not x["ok"]]
    for x in bad:
        print("NG:", json.dumps({k: x[k] for k in ("id", "query", "missed", "false_positive", "location_errors", "full_scan_ok")}, ensure_ascii=False))
    return 1 if bad or r["issues_missing"] or r["issues_extra"] or not r["integrity"][0] else 0


if __name__ == "__main__":
    sys.exit(main())
