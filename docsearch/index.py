"""インデックス作成・更新。例: python index.py（初回も更新も同じ。変更のないファイルは飛ばします）"""
import argparse
import dataclasses
import os
import sqlite3
import sys
import time

from core import db, roots as roots_mod
from core.config import ConfigError, load_config
from core.console import NOTICE_INDEX, setup_stdio
from core.export import write_issues_csv
from core.indexer import run_index
from core.kinds import KIND_ORDER
from core.scanner import RootError, check_root

HERE = os.path.dirname(os.path.abspath(__file__))
CONSOLE_LIST_MAX = 50


def fmt_time(sec):
    """秒を hh:mm:ss にする。"""
    sec = int(sec)
    return "%02d:%02d:%02d" % (sec // 3600, sec % 3600 // 60, sec % 60)


def make_progress(err):
    """進捗表示（処理済み／全体、経過時間）を1行で上書き表示する関数を返す。"""
    last = [0.0, 0]  # 最後に描画した時刻、直前の行の長さ

    def progress(done, total, elapsed, current):
        """処理済み/全体・経過時間・処理中のファイルを表示する（描画は0.2秒に1回）。"""
        now = time.time()
        if now - last[0] < 0.2 and done < total:
            return
        last[0] = now
        name = current if len(current) <= 50 else "…" + current[-49:]
        line = "処理済み %d/%d ファイル | 経過 %s | %s" % (done, total, fmt_time(elapsed), name)
        err.write("\r" + line.ljust(last[1]))  # 直前の行より短いときは空白で消す（古いコンソールでも動く）
        last[1] = len(line)
        err.flush()
    return progress


def make_scan_progress(err):
    """走査中の進捗（見つけたファイル数・経過時間・調べているフォルダ）を1行で表示する関数を返す。"""
    last = [0.0, 0]

    def scan_progress(found, rel_dir, elapsed):
        """フォルダを調べるたびに呼ばれる（描画は0.2秒に1回）。"""
        now = time.time()
        if now - last[0] < 0.2:
            return
        last[0] = now
        name = rel_dir if len(rel_dir) <= 50 else "…" + rel_dir[-49:]
        line = "ファイルを調べています: %d 件 | 経過 %s | %s" % (found, fmt_time(elapsed), name or ".")
        err.write("\r" + line.ljust(last[1]))
        last[1] = len(line)
        err.flush()
    return scan_progress


def issue_rows(conn):
    """issues を (種別, フルパス, 場所, 詳細) の列で返す（種別の表示順・パス順）。"""
    order = {k: i for i, k in enumerate(KIND_ORDER)}
    rows = conn.execute("SELECT i.kind, f.root, f.relpath, i.location, i.detail FROM issues i JOIN files f ON f.id=i.file_id").fetchall()
    rows.sort(key=lambda r: (order.get(r[0], 99), r[1], r[2], r[3]))
    return [(k, os.path.normpath(os.path.join(root, *rel.split("/"))), loc, d) for k, root, rel, loc, d in rows]


def print_report(conn, cfg, out, csv_path=None):
    """対象外・エラー・テキスト抽出不可の件数と一覧を表示し、全件をCSVに保存する。"""
    rows = issue_rows(conn)
    c = conn.execute("SELECT status, count(*) FROM files GROUP BY status").fetchall()
    st = dict(c)
    chunks = conn.execute("SELECT count(*) FROM chunks").fetchone()[0]
    print("\n===== インデックスの状況 =====", file=out)
    print("取り込み済み %d ファイル（本文 %d か所）／ エラー %d ／ 対象外 %d" % (
        st.get("ok", 0), chunks, st.get("error", 0), st.get("excluded", 0)), file=out)
    kinds = {}
    for r in rows:
        kinds.setdefault(r[0], []).append(r)
    if not kinds:
        print("対象外・エラー・テキスト抽出不可はありません。", file=out)
    for k in KIND_ORDER + [k for k in kinds if k not in KIND_ORDER]:
        if k not in kinds:
            continue
        lst = kinds[k]
        print("\n■ %s: %d件" % (k, len(lst)), file=out)
        for r in lst[:CONSOLE_LIST_MAX]:
            print("  - %s%s" % (r[1], (" [%s]" % r[2]) if r[2] else ""), file=out)
        if len(lst) > CONSOLE_LIST_MAX:
            print("  …ほか %d 件（全件はCSVを参照）" % (len(lst) - CONSOLE_LIST_MAX), file=out)
    if csv_path and rows:
        write_issues_csv(rows, csv_path)
        print("\n一覧の全件を保存しました: %s" % csv_path, file=out)


def main(argv=None, out=None, err=None):
    """インデックスを作成・更新する。戻り値は終了コード（0:正常 2:設定 3:環境 4:対象フォルダ/DB 130:中断）。"""
    out, err = out or sys.stdout, err or sys.stderr
    ap = argparse.ArgumentParser(description="全文検索インデックスの作成・更新（対象フォルダは読み取りのみ）")
    ap.add_argument("--config", default=os.path.join(HERE, "config.toml"))
    ap.add_argument("--retry-errors", action="store_true", help="前回エラーになったファイルも、変更がなくても再試行する")
    ap.add_argument("--allow-mass-delete", action="store_true", help="大量削除の安全装置を解除する（共有フォルダの接続を確認してから）")
    ap.add_argument("--add", metavar="フォルダ", default="", help="このフォルダ（とその下のすべて）を検索対象に追加して、インデックスを作成する")
    ap.add_argument("--report", action="store_true", help="走査せず、現在のインデックスの対象外・エラー一覧だけを表示する")
    ap.add_argument("--check", action="store_true", help="走査せず、FTS索引の整合性だけを確認する")
    try:
        a = ap.parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0  # 引数の誤りは argparse が説明を表示する（--help で使い方を確認）
    try:
        db.check_environment()
        cfg = load_config(a.config)
        first = not os.path.exists(cfg.db_path)
        conn = db.connect_rw(cfg.db_path, create=not (a.report or a.check))
    except db.EnvError as e:
        print("環境エラー: %s" % e, file=err)
        return 3
    except ConfigError as e:
        print("エラー: %s" % e, file=err)
        return 2
    except db.DbError as e:
        print("エラー: %s" % e, file=err)
        return 4
    try:
        if a.check:
            ok, msg = db.check_integrity(conn)
            print(msg, file=out)
            return 0 if ok else 4
        if a.report:
            print_report(conn, cfg, out)
            return 0
        if first or db.get_meta(conn, "notice_shown") is None:
            print("=" * 60 + "\n" + NOTICE_INDEX + "\n" + "=" * 60 + "\n", file=out)
            with conn:
                db.set_meta(conn, "notice_shown", "1")
        stamp = time.strftime("%Y%m%d_%H%M%S")
        try:
            if a.add:
                folder = os.path.normpath(a.add.strip().strip('"'))
                check_root(folder)
                absorbed = roots_mod.add_root(conn, folder, cfg.roots)
                for r in absorbed:
                    print("入れ子のフォルダの登録を、上位のフォルダにまとめました: %s" % r, file=out)
                stats = run_index(cfg, conn, make_progress(err), a.retry_errors, a.allow_mass_delete, roots=[folder], scan_progress=make_scan_progress(err))
                roots_mod.clear_incomplete(conn, [folder])
            else:
                targets = roots_mod.all_roots(cfg, conn)
                if not targets:
                    print("検索対象のフォルダがありません。検索画面の「選択…」でフォルダを選ぶか、"
                          "python index.py --add \"フォルダ\" で追加するか、config.toml の roots に書いてください。", file=err)
                    return 2
                stats = run_index(dataclasses.replace(cfg, roots=targets), conn, make_progress(err), a.retry_errors, a.allow_mass_delete,
                                  scan_progress=make_scan_progress(err))
                roots_mod.clear_incomplete(conn, targets)
        except RootError as e:
            print("\nエラー: %s" % e, file=err)
            return 4
        except KeyboardInterrupt:
            print("\n中断しました。完了したファイルは保存済みです。もう一度実行すると、処理済みの分を飛ばして続きから再開します。", file=err)
            return 130
        except sqlite3.OperationalError as e:
            print("\nエラー: index.db を更新できません（%s）。別の index.py や GUI が同時に使っていないか、index.db の保存先の"
                  "空き容量・書き込み権限を確認してください。完了したファイルは保存済みなので、原因を解消して再実行すれば続きから再開します。" % e, file=err)
            return 4
        err.write("\n")
        print("完了: 経過 %s | 今回処理 %d ファイル（うちエラー %d）| 変更なしで省略 %d | 削除を反映 %d | 対象外の拡張子 %d 件（無視）| 除外パターン %d 件"
              % (fmt_time(stats.elapsed), len(stats.processed), stats.errors, stats.skipped_unchanged,
                 len(stats.deleted), stats.other_ext, stats.pattern_excluded), file=out)
        if stats.delete_blocked:
            print("【注意】削除候補が %d 件あり、安全装置（大量削除の防止）のため削除しませんでした。共有フォルダの接続・パスを確認し、"
                  "本当に削除されている場合は --allow-mass-delete を付けて実行してください。" % stats.delete_blocked, file=out)
        print_report(conn, cfg, out, os.path.join(cfg.output_dir, "index_report_%s.csv" % stamp))
        sz = os.path.getsize(cfg.db_path)
        print("\nindex.db のサイズ: %.2f MB（%s）。文書の本文を含むため、元文書と同等に取り扱ってください。" % (sz / 1048576, cfg.db_path), file=out)
        return 0
    finally:
        conn.close()


def run():
    """入口。想定外の例外でも、スタックトレースだけを出さず、日本語で状況を伝える。"""
    setup_stdio()
    try:
        return main()
    except Exception as e:
        print("想定外のエラーが発生しました（%s: %s）。完了したファイルは保存済みです。内容を作成者に連絡してください。" % (type(e).__name__, e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(run())
