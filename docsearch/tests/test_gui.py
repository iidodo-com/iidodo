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
from core import opener
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
        self.assertIn("該当 5 件中 5 件", self.app.status.get())
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
