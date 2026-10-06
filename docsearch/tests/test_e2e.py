"""結合テスト: expected.json との突き合わせ（見逃し・誤検出）、3文字未満のLIKE、AND範囲、並び順、異常な検索語、CLI。"""
import io
import json
import os
import tempfile
import unittest

from tests import common
import index as index_cli
import search as search_cli
import verify
from core import db
from core.searcher import build_options, search


class ExpectedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = common.shared_verification()

    def test_every_search_matches_expected(self):
        """expected.json の全検索で、見逃し・誤検出・場所の誤り・重複がない。"""
        for row in self.r["rows"]:
            with self.subTest(id=row["id"], query=row["query"]):
                self.assertEqual(row["missed"], [], "見逃し")
                self.assertEqual(row["false_positive"], [], "誤検出")
                self.assertEqual(row["location_errors"], [], "場所の誤り")
                self.assertEqual(row["duplicates"], 0)
                self.assertTrue(row["full_scan_ok"], "全件走査の判定")

    def test_totals(self):
        """期待件数の合計と検出件数の合計が一致する（0件の期待も含め、空振りでないことも確認）。"""
        exp = sum(x["expected"] for x in self.r["rows"])
        det = sum(x["detected"] for x in self.r["rows"])
        self.assertEqual(exp, det)
        self.assertGreater(exp, 40)
        zero = [x["id"] for x in self.r["rows"] if x["expected"] == 0]
        self.assertEqual(zero, ["S12", "S13"])  # 一致しないはずの検索が、本当に0件

    def test_issues_match_expected(self):
        """対象外・エラー・テキスト抽出不可・数式キャッシュなしの一覧が、仕込んだ内容と過不足なく一致する。"""
        self.assertEqual(self.r["issues_missing"], [])
        self.assertEqual(self.r["issues_extra"], [])
        self.assertEqual(self.r["kinds"], self.r["exp"]["expected_issue_counts"])

    def test_stats(self):
        """除外パターン（~$）・対象外の拡張子（.txt）が数えられ、一時ファイルはDBに入らない。"""
        s = self.r["stats"]
        self.assertEqual(s.pattern_excluded, self.r["exp"]["pattern_excluded"])
        self.assertEqual(s.other_ext, 1)
        conn = db.connect_ro(self.r["cfg"].db_path)
        try:
            self.assertEqual(conn.execute("SELECT count(*) FROM files WHERE relpath LIKE '%~$%'").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM files WHERE relpath LIKE '%メモ.txt'").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT count(*) FROM chunks").fetchone()[0], len(self.r["exp"]["registry"]))
        finally:
            conn.close()

    def test_integrity_after_full_index(self):
        """作成直後のFTS索引の整合性が正常。"""
        self.assertTrue(self.r["integrity"][0], self.r["integrity"][1])


class ShortTermTest(unittest.TestCase):
    """3文字未満の検索語: trigram の MATCH では出ず、LIKE に切り替わること（実際の挙動の確認）。"""

    @classmethod
    def setUpClass(cls):
        cls.r = common.shared_verification()
        cls.conn = db.connect_ro(cls.r["cfg"].db_path)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def count_match(self, term):
        return self.conn.execute("SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH ?", ('"%s"' % term,)).fetchone()[0]

    def count_like(self, term):
        return self.conn.execute("SELECT count(*) FROM chunks WHERE text LIKE ?", ("%" + term + "%",)).fetchone()[0]

    def test_two_chars_match_returns_nothing_but_like_finds(self):
        """2文字は MATCH では0件・LIKE では見つかる。3文字は MATCH で見つかる。"""
        self.assertEqual(self.count_match("納期"), 0)
        self.assertEqual(self.count_like("納期"), 5)
        self.assertGreater(self.count_match("損害賠償"), 0)
        self.assertGreater(self.count_match("委託料"), 0)  # ちょうど3文字
        self.assertEqual(self.count_match("委託"), 0)
        self.assertGreater(self.count_like("委託"), 0)

    def test_search_switches_to_like_and_warns(self):
        """検索機能は2文字語で LIKE に切り替わり、「全件走査のため時間がかかる場合がある」と表示する。"""
        out = search(self.conn, "納期", build_options(scope="place"))
        self.assertTrue(out.full_scan and out.like_used)
        self.assertEqual(out.total, 5)
        self.assertTrue(any("全件走査のため時間がかかる場合があります" in n for n in out.notices))
        self.assertEqual(out.sort_used, "date")  # bm25 が使えないので更新日順になる旨も通知
        self.assertTrue(any("bm25" in n for n in out.notices))

    def test_one_char_and_mixed(self):
        """1文字語もLIKEで検索できる。3文字以上の語と混在するときは、全件走査の警告は出ない。"""
        out = search(self.conn, "納", build_options(scope="place"))
        self.assertTrue(out.full_scan)
        self.assertEqual(out.total, 5)
        out = search(self.conn, "納期 ABC", build_options(scope="place"))
        self.assertFalse(out.full_scan)
        self.assertTrue(out.like_used)
        self.assertFalse(any("全件走査のため" in n for n in out.notices))

    def test_like_special_chars_are_literal(self):
        """検索語の % や _ は、ワイルドカードにならない。"""
        self.assertEqual(search(self.conn, "%", build_options(scope="place")).total, 0)
        self.assertEqual(search(self.conn, "_", build_options(scope="place")).total, 0)


class ScopeAndSortTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = common.shared_verification()
        cls.conn = db.connect_ro(cls.r["cfg"].db_path)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def test_file_scope_vs_place_scope(self):
        """同じ検索語でも、ファイル内なら該当し、同じ場所内では該当しないファイルがある（企画書: 委託料はノート・損害賠償は別スライド）。"""
        f = search(self.conn, "委託料 損害賠償", build_options(scope="file"))
        p = search(self.conn, "委託料 損害賠償", build_options(scope="place"))
        self.assertEqual(sorted(r.name for r in f.results), ["新規事業企画書.pptx", "秘密保持契約書.docx"])
        self.assertEqual([(r.name, r.location) for r in p.results], [("秘密保持契約書.docx", "段落6")])

    def test_file_scope_location_choice(self):
        """ファイル単位のとき、語を最も多く含む場所（段落6）を表示し、ほかの該当場所の数も持つ。"""
        f = search(self.conn, "委託料 損害賠償", build_options(scope="file"))
        r = [x for x in f.results if x.name == "秘密保持契約書.docx"][0]
        self.assertEqual(r.location, "段落6")
        self.assertEqual(r.place_hits, 2)  # 段落5（委託料のみ）と段落6
        self.assertEqual(sorted(r.snippet[a:b] for a, b in r.spans), ["委託料", "損害賠償"])
        pp = [x for x in f.results if x.name == "新規事業企画書.pptx"][0]
        self.assertIn(pp.location, ("スライド3(ノート)", "スライド4"))
        self.assertEqual(pp.place_hits, 2)

    def test_relevance_order_is_best_bm25(self):
        """関連度順は、場所単位では各場所のbm25の昇順、ファイル単位ではファイルごとの最良bm25の昇順。"""
        for scope in ("place", "file"):
            res = search(self.conn, "ABC 株式会社", build_options(scope=scope, sort="relevance")) if scope == "place" else \
                search(self.conn, "ABC", build_options(scope=scope, sort="relevance"))
            scores = [r.score for r in res.results]
            self.assertTrue(len(scores) >= 3 and None not in scores, scope)
            self.assertEqual(scores, sorted(scores), scope)
        # ファイル単位のスコアは、そのファイルの場所単位スコアの最小値と一致する
        fs = {r.relpath: r.score for r in search(self.conn, "ABC", build_options(scope="file")).results}
        ps = {}
        for r in search(self.conn, "ABC", build_options(scope="place")).results:
            ps[r.relpath] = min(ps.get(r.relpath, 1e9), r.score)
        self.assertEqual(fs.keys(), ps.keys())
        for k in fs:
            self.assertAlmostEqual(fs[k], ps[k], places=9)

    def test_date_order(self):
        """更新日順は、更新日の新しい順（同じ日は相対パス順）。"""
        for scope in ("place", "file"):
            res = search(self.conn, "ABC", build_options(scope=scope, sort="date"))
            mt = [r.mtime_ns for r in res.results]
            self.assertEqual(mt, sorted(mt, reverse=True), scope)
            self.assertEqual(res.results[0].name, "予算表 2024.xlsx")
        self.assertNotEqual([r.relpath for r in search(self.conn, "ABC", build_options(sort="date")).results],
                            [r.relpath for r in search(self.conn, "ABC", build_options(sort="relevance")).results])

    def test_limit_and_total(self):
        """limit は表示件数だけを制限し、total は該当数全体を返す。"""
        res = search(self.conn, "ABC", build_options(limit=2, scope="file"))
        self.assertEqual((len(res.results), res.total), (2, 5))
        res = search(self.conn, "ABC", build_options(limit=2, scope="place"))
        self.assertEqual(len(res.results), 2)
        self.assertGreater(res.total, 2)

    def test_paging_covers_everything_without_overlap(self):
        """ページ送り（offset）: ページをつなげると、1回で全件取った結果と同じ順序・同じ内容になり、重複も欠落もない。"""
        for scope in ("place", "file"):
            for sort in ("relevance", "date"):
                with self.subTest(scope=scope, sort=sort):
                    full = search(self.conn, "ABC", build_options(limit=1000, scope=scope, sort=sort))
                    want = [(r.relpath, r.location) for r in full.results]
                    self.assertGreaterEqual(len(want), 5)
                    got, off = [], 0
                    while True:
                        page = search(self.conn, "ABC", build_options(limit=2, offset=off, scope=scope, sort=sort))
                        self.assertEqual((page.total, page.offset), (full.total, off))
                        if not page.results:
                            break
                        self.assertLessEqual(len(page.results), 2)
                        got += [(r.relpath, r.location) for r in page.results]
                        off += 2
                    self.assertEqual(got, want)
                    self.assertEqual(len(set(got)), len(got))
                    beyond = search(self.conn, "ABC", build_options(limit=2, offset=full.total + 10, scope=scope, sort=sort))
                    self.assertEqual((beyond.results, beyond.total), ([], full.total))

    def test_exclusion_scope_difference(self):
        """除外語: 場所単位では「その場所」を、ファイル単位では「そのファイル全体」を除外する。"""
        p = search(self.conn, "損害賠償 -上限", build_options(scope="place"))
        f = search(self.conn, "損害賠償 -上限", build_options(scope="file"))
        self.assertEqual(sorted(r.name for r in p.results), ["新規事業企画書.pptx", "調査報告書.pdf"])
        self.assertEqual(sorted(r.name for r in f.results), ["新規事業企画書.pptx", "調査報告書.pdf"])
        p2 = search(self.conn, "委託料 -損害賠償", build_options(scope="place"))
        f2 = search(self.conn, "委託料 -損害賠償", build_options(scope="file"))
        self.assertIn("秘密保持契約書.docx", [r.name for r in p2.results])  # 段落5は損害賠償を含まない
        self.assertNotIn("秘密保持契約書.docx", [r.name for r in f2.results])  # ファイル内に損害賠償があるので除外

    def test_filters(self):
        """拡張子・フォルダ・期間の絞り込み（フォルダ名の % _ は文字として扱う）。"""
        r = search(self.conn, "ABC", build_options(exts="pptx"))
        self.assertEqual([x.ext for x in r.results], ["pptx"])
        r = search(self.conn, "ABC", build_options(folder="契約書"))
        self.assertEqual(sorted(x.name for x in r.results), ["業務委託契約書　雛形.docx", "秘密保持契約書.docx"])
        r = search(self.conn, "ABC", build_options(folder="契約書\\"))  # 区切り文字・末尾の区切りも許容
        self.assertEqual(r.total, 2)
        self.assertEqual(search(self.conn, "ABC", build_options(folder="%")).total, 0)
        r = search(self.conn, "ABC", build_options(since="2024-01-01", until="2024-06-30"))
        self.assertEqual([x.name for x in r.results], ["新規事業企画書.pptx"])
        r = search(self.conn, "ABC", build_options(since="2024-05-10", until="2024-05-10"))
        self.assertEqual(r.total, 1)  # 開始日・終了日とも当日を含む

    def test_links_not_followed(self):
        """リンク先のファイル・フォルダは、リンク経由では索引されない（重複して出ない）。"""
        if not self.r["exp"]["symlinks"]:
            self.skipTest("この環境ではシンボリックリンクを作れませんでした")
        self.assertEqual(self.conn.execute("SELECT count(*) FROM files WHERE relpath LIKE 'リンク/%' AND status='ok'").fetchone()[0], 0)


class CliTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = common.shared_verification()
        cls.cfgfile = os.path.join(os.path.dirname(cls.r["cfg"].db_path), "c.toml")
        with open(cls.cfgfile, "w", encoding="utf-8") as f:
            f.write('roots = ["%s"]\ndb_path = "%s"\noutput_dir = "%s"\n' % tuple(
                p.replace("\\", "/") for p in (cls.r["cfg"].roots[0], cls.r["cfg"].db_path, cls.r["cfg"].output_dir)))

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        rc = search_cli.main(["--config", self.cfgfile] + list(argv), out, err)
        return rc, out.getvalue(), err.getvalue()

    def test_weird_queries_give_japanese_message_without_exception(self):
        """空・引用符・" * - : ( ) を含む検索語・除外語だけ、で例外にならず、日本語のメッセージが出る。"""
        errors = {"": "入力", "   ": "入力", '"': "閉じられていません", '"abc': "閉じられていません", '""': "空", "-": "除外",
                  "abc -": "除外", "-秘密": "除外語（-語）だけ", "--": "入力",  # 「--」はコマンドラインの区切りとして消費され、検索語なしになる
                  "---": "除外語（-語）だけ", '-"abc"': "除外語（-語）だけ",
                  'a"b': "閉じられていません", "損害賠償 -": "除外", '"" 損害賠償': "空"}
        for q, word in errors.items():
            with self.subTest(q=q):
                rc, out, err = self.run_cli(q)
                self.assertEqual(rc, 2)
                self.assertIn("検索語のエラー", err)
                self.assertIn(word, err)
                self.assertNotIn("Traceback", err + out)
        literal = ["*", ":", "(", ")", "契約*", "a:b", "(契約書)", '"a*b"', "NOT", "AND", "OR", "NEAR(", "a OR b", "損害賠償 *", "'", "\\",
                   "損害賠償 (", "損害賠償 -(", "損害賠償 -*", "^", "損害賠償:上限", "col:損害賠償", "{x}", "a\"b\"", "損害賠償\x00"]
        for q in literal:
            with self.subTest(q=q):
                rc, out, err = self.run_cli(q)
                self.assertEqual(rc, 0, err)
                self.assertEqual(err, "")
                self.assertIn("検索語:", out)

    def test_special_chars_are_searched_literally(self):
        """特殊文字は文字として検索される（演算子として解釈されない）。"""
        rc, out, _ = self.run_cli("損害賠償 OR 委託料", "--scope", "place")
        self.assertIn("該当 0 か所", out)  # 「or」という語は本文に無いので、OR演算子ではなく文字として扱われる
        rc, out, _ = self.run_cli("(株)ダミー商事")
        self.assertIn("該当 1 ファイル", out)

    def test_cli_output_and_csv(self):
        """通常の検索結果の表示・強調・注意書き・CSV保存。"""
        csvp = os.path.join(tempfile.mkdtemp(), "x", "結果.csv")
        rc, out, err = self.run_cli("ＡＢＣ", "--ext", "docx,pptx", "--limit", "10", "--csv", csvp)
        self.assertEqual(rc, 0, err)
        self.assertIn("【abc】", out)
        self.assertIn("正規化後の文字", out)
        self.assertIn("該当 3 ファイル", out)
        self.assertTrue(os.path.exists(csvp))
        with open(csvp, encoding="utf-8-sig") as f:
            self.assertEqual(len(f.read().strip().splitlines()), 4)

    def test_cli_paging(self):
        """--limit / --offset でページ送りでき、番号と「次のN件」の案内が出る。"""
        rc, out, err = self.run_cli("ABC", "--limit", "2")
        self.assertEqual(rc, 0, err)
        self.assertIn("該当 5 ファイル中 1～2 件目を表示", out)
        self.assertIn("--offset 2 を付けて", out)
        self.assertIn("\n1. ", out)
        rc, out, err = self.run_cli("ABC", "--limit", "2", "--offset", "2")
        self.assertIn("3～4 件目を表示", out)
        self.assertIn("\n3. ", out)
        self.assertIn("--offset 4 を付けて", out)
        rc, out, err = self.run_cli("ABC", "--limit", "2", "--offset", "4")
        self.assertIn("5～5 件目を表示", out)
        self.assertNotIn("--offset", out)  # 最後のページには、次の案内を出さない
        rc, out, err = self.run_cli("ABC", "--limit", "2", "--offset", "99")
        self.assertEqual(rc, 0, err)
        self.assertIn("該当 5 ファイル中 0～99 件目を表示", out)  # 範囲外の開始位置: 結果なし（表示は0件）
        for bad, word in (("-1", "0以上"), ("x", "整数")):
            rc, out, err = self.run_cli("ABC", "--offset", bad)
            self.assertEqual(rc, 2)
            self.assertIn(word, err)

    def test_argument_errors(self):
        """日付・拡張子・件数の誤りも、日本語のメッセージで終了コード2。"""
        for args, word in ((["x", "--since", "2024-99-99"], "日付"), (["x", "--ext", "txt"], "拡張子"), (["x", "--limit", "abc"], "整数")):
            rc, out, err = self.run_cli(*args)
            self.assertEqual(rc, 2)
            self.assertIn(word, err)

    def test_missing_db_and_config(self):
        """index.db や設定ファイルが無いときは、日本語で対処を案内する。"""
        d = tempfile.mkdtemp()
        cfg = os.path.join(d, "c.toml")
        with open(cfg, "w", encoding="utf-8") as f:
            f.write('roots = ["%s"]\n' % d.replace("\\", "/"))
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(search_cli.main(["x", "--config", cfg], out, err), 4)
        self.assertIn("index.py", err.getvalue())
        err = io.StringIO()
        self.assertEqual(search_cli.main(["x", "--config", os.path.join(d, "none.toml")], io.StringIO(), err), 2)
        self.assertIn("config.example.toml", err.getvalue())


class IndexCliTest(unittest.TestCase):
    def test_first_run_notice_and_report(self):
        """初回実行時の画面に取扱い注意が出て、2回目は出ない。AES暗号化など種別ごとの件数が出る。"""
        tmp = tempfile.mkdtemp()
        work, exp, cfg, conn = common.fresh_sample(tmp)
        conn.close()
        os.remove(cfg.db_path)
        cfgfile = os.path.join(tmp, "c.toml")
        with open(cfgfile, "w", encoding="utf-8") as f:
            f.write('roots = ["%s"]\ndb_path = "%s"\noutput_dir = "%s"\n' % tuple(
                p.replace("\\", "/") for p in (cfg.roots[0], cfg.db_path, cfg.output_dir)))
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(index_cli.main(["--config", cfgfile], out, err), 0, err.getvalue())
        text = out.getvalue()
        self.assertIn("取扱い注意", text)
        self.assertIn("元の文書と同等", text)
        self.assertIn("読み取り専用", text)
        self.assertIn("■ 読込不可（AES暗号化）: 1件", text)
        self.assertIn("■ 対象外(旧形式): 3件", text)
        self.assertIn("処理済み", err.getvalue())  # 進捗表示（処理済み／全体、経過時間）
        self.assertIn("経過", err.getvalue())
        self.assertTrue(any(n.startswith("index_report_") for n in os.listdir(cfg.output_dir)))
        out2 = io.StringIO()
        self.assertEqual(index_cli.main(["--config", cfgfile], out2, io.StringIO()), 0)
        self.assertNotIn("取扱い注意", out2.getvalue())
        self.assertIn("今回処理 0 ファイル", out2.getvalue())  # 2回目は、変更のないファイルを再処理しない
        self.assertIn("変更なしで省略 21", out2.getvalue())
        out3 = io.StringIO()
        self.assertEqual(index_cli.main(["--config", cfgfile, "--check"], out3, io.StringIO()), 0)
        self.assertIn("問題はありません", out3.getvalue())

    def test_missing_root_message(self):
        """対象フォルダに到達できないときは、日本語で原因と対処を示して終了する（何も削除しない）。"""
        tmp = tempfile.mkdtemp()
        cfgfile = os.path.join(tmp, "c.toml")
        with open(cfgfile, "w", encoding="utf-8") as f:
            f.write('roots = ["%s/存在しない共有"]\ndb_path = "%s/i.db"\n' % (tmp.replace("\\", "/"), tmp.replace("\\", "/")))
        out, err = io.StringIO(), io.StringIO()
        self.assertEqual(index_cli.main(["--config", cfgfile], out, err), 4)
        self.assertIn("アクセスできません", err.getvalue())
        self.assertIn("何も削除せず", err.getvalue())


if __name__ == "__main__":
    unittest.main()
