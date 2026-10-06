"""GUIの動作テスト（tkinter。表示できる環境でのみ実行。Linuxでは xvfb-run python -m unittest tests.test_gui）。

index.db は、共有のダミー文書から作る。環境変数 DOCSEARCH_TEST_DB / DOCSEARCH_TEST_ROOT があれば、それを使う
（tkinter のある Python に docx 等のライブラリが無い場合に、別の Python で作ったDBを渡すため）。
"""
import os
import tempfile
import time
import unittest
from unittest import mock

from tests import common
from core import db, opener
from core.config import Config

try:
    import tkinter as tk
    import gui
except (ImportError, SystemExit):
    tk = None


def make_cfg():
    """テスト用の Config を返す。"""
    if os.environ.get("DOCSEARCH_TEST_DB"):
        return Config(roots=[os.environ["DOCSEARCH_TEST_ROOT"]], db_path=os.environ["DOCSEARCH_TEST_DB"], output_dir=tempfile.mkdtemp())
    return common.shared_verification()["cfg"]


@unittest.skipIf(tk is None, "tkinter を使えない環境のためGUIテストは未実施")
class GuiTest(unittest.TestCase):
    def setUp(self):
        try:
            self.root = tk.Tk()
        except tk.TclError as e:
            self.skipTest("画面を開けない環境のためGUIテストは未実施: %s" % e)
        self.addCleanup(self.root.destroy)
        self.cfg = make_cfg()
        self.app = gui.App(self.root, self.cfg)

    def pump(self, until, timeout=10):
        """画面のイベントを処理しながら、条件が満たされるまで待つ。"""
        end = time.time() + timeout
        while time.time() < end:
            self.root.update()
            if until():
                return True
            time.sleep(0.02)
        return False

    def search(self, q):
        """検索語を入力して検索ボタン相当を実行し、結果表示（または状態メッセージの変化）まで待つ。"""
        self.app.status.set("")
        self.app.query.set(q)
        self.app.start_search()
        self.assertTrue(self.pump(lambda: self.app.status.get() != "" and str(self.app.btn["state"]) == "normal"))

    def test_search_highlight_and_detail(self):
        """検索結果が一覧に出て、選択すると詳細欄で検索語が強調される。"""
        self.search("ＡＢＣ")
        self.assertEqual(len(self.app.tree.get_children()), 5)
        self.assertIn("該当 5 件中 1～5 件目を表示", self.app.status.get())
        self.app.tree.selection_set("0")
        self.root.update()
        ranges = self.app.detail.tag_ranges("hit")
        self.assertGreaterEqual(len(ranges), 2)
        self.assertEqual(self.app.detail.get(ranges[0], ranges[1]), "abc")

    def test_place_checkbox_changes_and_filters(self):
        """「同じ場所内」のチェックでAND範囲が切り替わる。拡張子・日付の絞り込みも効く。"""
        self.search("委託料 損害賠償")
        self.assertEqual(len(self.app.tree.get_children()), 2)
        self.app.place.set(True)
        self.search("委託料 損害賠償")
        self.assertEqual(len(self.app.tree.get_children()), 1)
        self.app.place.set(False)
        for x in ("docx", "xlsx", "pdf"):
            self.app.ext_vars[x].set(False)
        self.search("ABC")
        self.assertEqual(len(self.app.tree.get_children()), 1)
        self.app.ext_vars["docx"].set(True)
        self.app.since.set("2024-01-01")
        self.search("ABC")
        self.assertEqual(len(self.app.tree.get_children()), 1)

    def test_errors_shown_in_japanese(self):
        """検索式・日付・拡張子の誤りは、画面の状態欄に日本語で出て、落ちない。"""
        self.search('"abc')
        self.assertIn("閉じられていません", self.app.status.get())
        self.search("")
        self.assertIn("入力されていません", self.app.status.get())
        self.search("-秘密")
        self.assertIn("だけでは検索できません", self.app.status.get())
        self.app.since.set("2024-99-99")
        self.app.status.set("")
        self.app.start_search()
        self.assertIn("日付", self.app.status.get())
        self.app.since.set("")
        for v in self.app.ext_vars.values():
            v.set(False)
        self.app.start_search()
        self.assertIn("拡張子", self.app.status.get())

    def test_choose_registered_folder_searches_only_below(self):
        """登録済みのルート内のフォルダを選ぶと、その下だけを検索する（親・兄弟は出ない）。「解除」で全体に戻る。"""
        root0 = self.cfg.roots[0]
        with mock.patch.object(gui.filedialog, "askdirectory", return_value=os.path.join(root0, "契約書")) as dlg:
            self.app.choose_folder()
        self.assertEqual(dlg.call_args.kwargs["initialdir"], root0)
        self.assertEqual(self.app.folder.get(), os.path.join(root0, "契約書"))
        self.search("ABC")
        self.assertEqual(len(self.app.tree.get_children()), 2)
        with mock.patch.object(gui.filedialog, "askdirectory", return_value=""):
            self.app.choose_folder()  # キャンセルでは変わらない
        self.assertEqual(self.app.folder.get(), os.path.join(root0, "契約書"))
        self.app.clear_folder()
        self.assertEqual(self.app.folder.get(), "")
        self.search("ABC")
        self.assertEqual(len(self.app.tree.get_children()), 5)

    def wait_idle(self):
        """インデックス作成が終わる（または止まる）まで待つ。"""
        self.assertTrue(self.pump(lambda: not self.app.indexing, timeout=20))
        self.root.update()

    def new_app_with_empty_db(self):
        """空のインデックスで画面を開き直す（roots なしの初回起動と同じ）。(画面, 対象フォルダ) を返す。"""
        d = tempfile.mkdtemp()
        cfg = Config(roots=[], db_path=os.path.join(d, "i.db"), output_dir=d)
        db.connect_rw(cfg.db_path).close()
        self.app.root.destroy() if False else None
        target = os.path.join(d, "検索したい", "子フォルダ")
        os.makedirs(target)
        for n in ("a.pdf", "b.pdf"):
            with open(os.path.join(target, n), "wb") as f:
                f.write(b"dummy")
        with open(os.path.join(d, "検索したい", "親直下.pdf"), "wb") as f:
            f.write(b"dummy")
        return gui.App(self.root, cfg), os.path.join(d, "検索したい"), target

    def fake_extract(self):
        """画面テスト用: PDF等のライブラリが無くても、ファイル名に応じた本文を返す抽出関数に差し替える。"""
        from core.extract import Extracted

        def fake(ext, data, cfg):
            ex = Extracted()
            ex.add("p.1", "ゼータ本文")
            return ex
        return mock.patch("core.indexer.extract", side_effect=fake)

    def test_choose_unindexed_folder_creates_index_then_searches_only_it(self):
        """未登録のフォルダを選ぶと、確認のうえインデックスを作成し、完了後はそのフォルダ以下だけを検索する（親は見ない）。"""
        app, parent, child = self.new_app_with_empty_db()
        self.app = app
        asked = []
        with self.fake_extract(), mock.patch.object(gui.messagebox, "askyesno", side_effect=lambda t, m: asked.append(m) or True), \
                mock.patch.object(gui.messagebox, "showinfo") as info, \
                mock.patch.object(gui.filedialog, "askdirectory", return_value=child):
            app.choose_folder()
            self.wait_idle()
        self.assertIn("まだインデックスされていません", asked[0])
        self.assertIn("親フォルダは検索対象に入りません", asked[0])
        self.assertIn("処理 2 ファイル", info.call_args[0][1])
        self.assertEqual(app.folder.get(), child)
        self.search("ゼータ")
        self.assertEqual(sorted(r.name for r in app.results), ["a.pdf", "b.pdf"])  # 親直下.pdf は出ない
        # 親を選ぶと、子は登録済みでも「親は未登録」なので、確認のうえ親全体を作成し直す（子はまとめられる）
        with self.fake_extract(), mock.patch.object(gui.messagebox, "askyesno", return_value=True) as ask, \
                mock.patch.object(gui.messagebox, "showinfo"), mock.patch.object(gui.filedialog, "askdirectory", return_value=parent):
            app.choose_folder()
            self.wait_idle()
        ask.assert_called_once()
        self.search("ゼータ")
        self.assertEqual(sorted(r.name for r in app.results), ["a.pdf", "b.pdf", "親直下.pdf"])
        self.assertEqual(len({r.fullpath for r in app.results}), 3)  # 二重登録なし

    def test_decline_does_not_index(self):
        """確認で「いいえ」を選ぶと、何も作らず、検索フォルダも変わらない。"""
        app, parent, child = self.new_app_with_empty_db()
        self.app = app
        with mock.patch.object(gui.messagebox, "askyesno", return_value=False), mock.patch.object(gui.filedialog, "askdirectory", return_value=child):
            app.choose_folder()
        self.assertFalse(app.indexing)
        self.assertEqual(app.folder.get(), "")
        self.assertEqual(app.indexed_roots(), [])

    def test_cancel_during_indexing_then_resume(self):
        """インデックス作成を中止すると、検索フォルダは変わらず、もう一度選ぶと続きから再開する。"""
        app, parent, child = self.new_app_with_empty_db()
        self.app = app
        with self.fake_extract(), mock.patch.object(gui.messagebox, "askyesno", return_value=True), \
                mock.patch.object(gui.messagebox, "showinfo"):
            app.cancel = False
            app.start_indexing(child)
            app.request_cancel()  # 開始直後に中止
            self.wait_idle()
            self.assertEqual(app.folder.get(), "")
            self.assertIn("中止", app.status.get())
            self.assertEqual(app.indexed_roots(), [])  # 未完了のフォルダは、登録済みとして扱わない
            with mock.patch.object(gui.filedialog, "askdirectory", return_value=child):
                app.choose_folder()
                self.wait_idle()
        self.assertEqual(app.folder.get(), child)
        self.assertEqual(app.indexed_roots(), [child])

    def test_scan_progress_text_and_cancel_during_scan(self):
        """走査中も、見つかったファイル数と経過時間が表示され、中止できる。"""
        app, parent, child = self.new_app_with_empty_db()
        self.app = app
        app.q.put(("scan", 123, "契約書/2024", 4.0))
        app.poll()
        self.assertIn("123 件のファイルが見つかりました", app.prog_text.get())
        self.assertIn("経過", app.prog_text.get())
        self.assertIn("契約書/2024", app.prog_text.get())
        import core.scanner as sc
        real = sc.scan_root

        def slow_scan(root, cfg, on_dir=None):
            for i in range(200):
                if on_dir:
                    on_dir(i, "dir%d" % i)
                time.sleep(0.01)
            return real(root, cfg, on_dir)
        with mock.patch("core.indexer.scan_root", side_effect=slow_scan):
            app.start_indexing(child)
            self.assertIn(child, app.folder.get())  # 作成中も、選んだフォルダを表示する
            self.assertIn("インデックス作成中", app.folder.get())
            self.pump(lambda: "見つかりました" in app.prog_text.get(), timeout=5)
            self.assertTrue(app.indexing)
            app.request_cancel()
            self.wait_idle()
        self.assertIn("中止", app.status.get())
        self.assertEqual(app.indexed_roots(), [])
        self.assertEqual(app.folder.get(), "")  # 中止したら、元の表示に戻る

    def test_elapsed_ticker_updates_without_events(self):
        """走査から何の通知も来ない間（1つの巨大なフォルダの読み込み中など）も、経過秒が更新され続ける。"""
        app, parent, child = self.new_app_with_empty_db()
        self.app = app
        import core.scanner as sc
        gate = []

        def blocking_scan(root, cfg, on_dir=None):
            while not gate:
                time.sleep(0.02)
            return sc.ScanResult(entries=[])
        with mock.patch("core.indexer.scan_root", side_effect=blocking_scan), mock.patch.object(gui.messagebox, "showinfo"), \
                mock.patch.object(gui.messagebox, "askyesno", side_effect=AssertionError("確認が繰り返された")):
            app.start_indexing(child)
            self.pump(lambda: False, timeout=1.3)
            self.assertRegex(app.prog_text.get(), r"経過 [1-9]\d*秒")
            gate.append(1)
            self.wait_idle()
        # 対象の文書が1つも無いフォルダでも、作成が終われば「登録済み」になり、検索フォルダとして選ばれる
        self.assertEqual(app.indexed_roots(), [child])
        self.assertEqual(app.folder.get(), child)

    def test_index_error_is_shown(self):
        """インデックス作成に失敗しても、画面は落ちず、日本語のメッセージを出す。"""
        app, parent, child = self.new_app_with_empty_db()
        self.app = app
        with mock.patch.object(gui.messagebox, "askyesno", return_value=True), mock.patch.object(gui.messagebox, "showerror") as err, \
                mock.patch.object(gui, "run_index", side_effect=gui.RootError("フォルダ「x」にアクセスできません。")):
            app.start_indexing(child)
            self.wait_idle()
        self.assertIn("アクセスできません", err.call_args[0][1])
        self.assertFalse(app.indexing)

    def wait_search(self):
        """検索（ページ送りを含む）が終わるまで待つ。"""
        self.app.status.set("")
        return self.pump(lambda: self.app.status.get() != "" and str(self.app.btn["state"]) == "normal")

    def test_paging_and_csv_all(self):
        """ページ送り: 1ページの件数を変えられ、前へ・次へで全件を見られる。CSVは表示中のページではなく全件を保存する。"""
        self.app.page_size.set("2")
        self.search("ABC")
        self.assertEqual(len(self.app.tree.get_children()), 2)
        self.assertEqual(self.app.page_label.get(), "1～2 件目 / 全 5 件")
        self.assertEqual((str(self.app.prev_btn["state"]), str(self.app.next_btn["state"])), ("disabled", "normal"))
        seen = [r.fullpath for r in self.app.results]
        for expect_rows, label, nxt in ((2, "3～4 件目 / 全 5 件", "normal"), (1, "5～5 件目 / 全 5 件", "disabled")):
            self.app.status.set("")
            self.app.go_page(1)
            self.assertTrue(self.wait_search())
            self.assertEqual(len(self.app.tree.get_children()), expect_rows)
            self.assertEqual(self.app.page_label.get(), label)
            self.assertEqual(str(self.app.next_btn["state"]), nxt)
            self.assertEqual(str(self.app.prev_btn["state"]), "normal")
            seen += [r.fullpath for r in self.app.results]
        self.assertEqual(len(seen), 5)
        self.assertEqual(len(set(seen)), 5)  # 重複も欠落もない
        # CSV: 最後のページ（1件）を表示していても、全5件を保存する
        out = os.path.join(tempfile.mkdtemp(), "全件.csv")
        with mock.patch.object(gui.filedialog, "asksaveasfilename", return_value=out):
            self.app.save_csv()
        with open(out, encoding="utf-8-sig") as f:
            self.assertEqual(len(f.read().strip().splitlines()), 6)
        self.assertIn("全 5 件", self.app.status.get())
        # 前へで戻る。件数を変えると、最初のページから検索し直す
        self.app.status.set("")
        self.app.go_page(-1)
        self.assertTrue(self.wait_search())
        self.assertEqual(self.app.page_label.get(), "3～4 件目 / 全 5 件")
        self.app.page_size.set("100")
        self.app.status.set("")
        self.app.change_page_size()
        self.assertTrue(self.wait_search())
        self.assertEqual(self.app.page_label.get(), "1～5 件目 / 全 5 件")
        self.assertEqual((str(self.app.prev_btn["state"]), str(self.app.next_btn["state"])), ("disabled", "disabled"))

    def test_bad_page_size_is_japanese_error(self):
        """1ページの件数が数字でないときは、日本語のメッセージを出す。"""
        self.app.page_size.set("たくさん")
        self.app.query.set("ABC")
        self.app.start_search()
        self.assertIn("整数", self.app.status.get())

    def test_short_term_notice(self):
        """3文字未満の検索では、全件走査の注意が状態欄に出る。"""
        self.search("納期")
        self.assertIn("全件走査のため時間がかかる場合があります", self.app.status.get())

    def test_open_copy_path_and_csv(self):
        """開く（読み取り専用の一時コピー）・フォルダを開く・パスをコピー・CSV保存。"""
        self.search("ABC")
        self.app.tree.selection_set("0")
        self.root.update()
        r = self.app.results[0]
        with mock.patch.object(opener, "_launch") as launch:
            self.app.open_selected()
        target = launch.call_args[0][0]
        self.assertNotEqual(target, r.fullpath)
        self.assertTrue(os.path.exists(target))
        self.app.copy_path()
        self.assertEqual(self.root.clipboard_get(), r.fullpath)
        with mock.patch.object(opener, "reveal_folder") as rev:
            self.app.reveal_selected()
        rev.assert_called_once_with(r.fullpath)
        out = os.path.join(tempfile.mkdtemp(), "結果.csv")
        with mock.patch.object(gui.filedialog, "asksaveasfilename", return_value=out):
            self.app.save_csv()
        self.assertTrue(os.path.exists(out))
        opener.cleanup_temp()
        self.assertFalse(os.path.exists(target))


if __name__ == "__main__":
    unittest.main()
