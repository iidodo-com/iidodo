"""コマンドライン検索。例: python search.py "検索語" --ext docx,pptx --folder サブフォルダ --since 2024-04-01 --limit 50"""
import argparse
import os
import sqlite3
import sys

from core import db
from core.config import ConfigError, load_config
from core.console import setup_stdio
from core.export import write_results_csv
from core.query import QueryError
from core.searcher import build_options, search

HERE = os.path.dirname(os.path.abspath(__file__))


class _ArgError(Exception):
    """コマンドライン引数の誤り（argparse の英語メッセージを、日本語の案内に包んで表示するため）。"""


class _Parser(argparse.ArgumentParser):
    """argparse が勝手に終了・英語メッセージを出さないようにするパーサ。"""

    def error(self, message):
        """誤りは例外にして、main が日本語で案内する。"""
        raise _ArgError(message)


def format_snippet(r):
    """スニペットの検索語を【】で囲んで強調する。"""
    s, pos, out = r.snippet, 0, []
    for a, b in r.spans:
        out.append(s[pos:a])
        out.append("【" + s[a:b] + "】")
        pos = b
    out.append(s[pos:])
    return "".join(out)


def main(argv=None, out=None, err=None):
    """検索を実行して結果を表示する。戻り値は終了コード（0:正常 2:入力・設定の誤り 3:環境 4:DB）。"""
    out = out or sys.stdout
    err = err or sys.stderr
    ap = _Parser(prog="search.py", description="過去の起案・資料の全文検索（完全オフライン・読み取り専用）")
    ap.add_argument("query", nargs="?", default=None, help='検索語。スペース区切りでAND、"..." でフレーズ、-語 で除外')
    ap.add_argument("--ext", default="", help="拡張子の絞り込み（例: docx,pptx）")
    ap.add_argument("--folder", default="", help="対象フォルダ内のサブフォルダ（例: 契約書/2024）")
    ap.add_argument("--since", default="", help="この日以降に更新（例: 2024-04-01）")
    ap.add_argument("--until", default="", help="この日までに更新（例: 2024-12-31）")
    ap.add_argument("--limit", default=50, help="表示件数（既定 50）")
    ap.add_argument("--sort", default="relevance", choices=["relevance", "date"], help="relevance:関連度(bm25) / date:更新日の新しい順")
    ap.add_argument("--scope", default="file", choices=["file", "place"], help="file:ファイル内でAND（既定）/ place:同じ場所内でAND")
    ap.add_argument("--csv", default="", help="結果をCSVに保存するパス")
    ap.add_argument("--config", default=os.path.join(HERE, "config.toml"), help="設定ファイル（既定: config.toml）")
    try:
        a, extra = ap.parse_known_args(argv)
    except SystemExit:  # --help
        return 0
    except _ArgError as e:
        print("コマンドラインの指定が正しくありません（%s）。使い方は --help で確認できます。"
              "検索語が - で始まる場合は、先頭に -- を付けてください（例: python search.py -- \"-秘密\"）。" % e, file=err)
        return 2
    if a.query is None and extra and extra[0].startswith("-"):
        a.query = extra.pop(0)  # 「-秘密」のように - で始まる検索語は、argparse がオプションと誤認するので拾い直す
    if extra:
        print("不明なオプション「%s」があります。使い方は --help で確認できます。" % " ".join(extra), file=err)
        return 2
    if a.query is None:
        a.query = ""  # 後段で「検索語が入力されていません」の日本語メッセージになる
    try:
        db.check_environment()
        cfg = load_config(a.config)
        opts = build_options(a.ext, a.folder, a.since, a.until, a.limit, a.sort, a.scope, cfg.snippet_chars)
        conn = db.connect_ro(cfg.db_path)
    except db.EnvError as e:
        print("環境エラー: %s" % e, file=err)
        return 3
    except ConfigError as e:
        print("エラー: %s" % e, file=err)
        return 2
    except QueryError as e:
        print("入力エラー: %s" % e, file=err)
        return 2
    except db.DbError as e:
        print("エラー: %s" % e, file=err)
        return 4
    try:
        res = search(conn, a.query, opts)
    except QueryError as e:
        print("検索語のエラー: %s" % e, file=err)
        return 2
    except sqlite3.DatabaseError as e:
        print("エラー: index.db を読み取れません（%s）。インデックス作成中の可能性があります。しばらくしてからもう一度試してください。"
              "解決しない場合は index.py --check で整合性を確認してください。" % e, file=err)
        return 4
    finally:
        conn.close()
    for n in res.notices:
        print("【お知らせ】" + n, file=out)
    print("検索語: %s%s | 並び順: %s | AND の範囲: %s | 該当 %d %s中 %d 件を表示" % (
        " ".join(res.positives), ("  除外: " + " ".join(res.negatives)) if res.negatives else "",
        "関連度(bm25)" if res.sort_used == "relevance" else "更新日の新しい順",
        "ファイル内" if opts.scope == "file" else "同じ場所内", res.total,
        "ファイル" if opts.scope == "file" else "か所", len(res.results)), file=out)
    for i, r in enumerate(res.results, 1):
        more = "（ほか%d箇所）" % (r.place_hits - 1) if opts.scope == "file" and r.place_hits > 1 else ""
        print("%d. %s | %s%s | %s | %s" % (i, r.name, r.location, more, r.mtime_text, r.folder or "."), file=out)
        print("     " + format_snippet(r), file=out)
    if res.results:
        print("※スニペットは正規化後の文字（㈱→(株)、全角英数字→半角 など）で表示されます。引用する際は元ファイルで確認してください。", file=out)
    if a.csv:
        try:
            write_results_csv(res.results, a.csv)
            print("CSVを保存しました: %s" % a.csv, file=out)
        except OSError as e:
            print("エラー: CSVを保存できません（%s）。保存先のフォルダ・権限・ファイルが開かれていないかを確認してください。" % e, file=err)
            return 2
    return 0


def run():
    """入口。想定外の例外でも、スタックトレースだけを出さず、日本語で状況を伝える。"""
    setup_stdio()
    try:
        return main()
    except KeyboardInterrupt:
        print("中断しました。", file=sys.stderr)
        return 130
    except Exception as e:
        print("想定外のエラーが発生しました（%s: %s）。内容を作成者に連絡してください。" % (type(e).__name__, e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(run())
