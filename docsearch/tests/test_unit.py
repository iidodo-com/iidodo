"""単体テスト: 正規化、パス変換、設定、検索式、スニペット、CSV、一時コピー。"""
import csv
import os
import stat
import tempfile
import unittest
from unittest import mock

from tests import common  # noqa: F401  (sys.path の設定)
from core import db, export, opener
from core.config import ConfigError, load_config
from core.normalize import normalize
from core.pathutil import fs_path, to_long_path
from core.query import QueryError, like_pattern, parse_query
from core.searcher import SearchResult, build_options, folder_to_relative, make_snippet


class NormalizeTest(unittest.TestCase):
    def test_width_and_case(self):
        """全角英数字・全角数字・大文字小文字・㈱・①・全角スペースが吸収される。"""
        self.assertEqual(normalize("ＡＢＣ"), "abc")
        self.assertEqual(normalize("ABC"), normalize("abc"))
        self.assertEqual(normalize("１２か月"), "12か月")
        self.assertEqual(normalize("㈱ダミー　①"), "(株)ダミー 1")
        self.assertEqual(normalize("a\u3000\u3000b\n\tc"), "a b c")

    def test_control_and_zero_width(self):
        """制御文字・ゼロ幅文字・孤立サロゲートは除去される（DB保存で失敗しない）。"""
        self.assertEqual(normalize("契\u200b約\x00書\ud800"), "契約書")
        self.assertEqual(normalize(None), "")
        normalize("x\ud800").encode("utf-8")


class LongPathTest(unittest.TestCase):
    def test_normal_drive_path(self):
        """通常パスに \\\\?\\ が付く。「/」は「\\」になり、.. は整理される。"""
        self.assertEqual(to_long_path("C:\\Users\\a\\b.docx"), "\\\\?\\C:\\Users\\a\\b.docx")
        self.assertEqual(to_long_path("C:/Users/a/../b.docx"), "\\\\?\\C:\\Users\\b.docx")
        self.assertEqual(to_long_path("D:\\資料\\全角　スペース\\ファイル.docx"), "\\\\?\\D:\\資料\\全角　スペース\\ファイル.docx")

    def test_unc(self):
        """UNCは \\\\?\\UNC\\サーバ\\共有\\... の形になる。"""
        self.assertEqual(to_long_path("\\\\srv\\share\\dir\\f.docx"), "\\\\?\\UNC\\srv\\share\\dir\\f.docx")
        self.assertEqual(to_long_path("//サーバ/共有/資料/f.docx"), "\\\\?\\UNC\\サーバ\\共有\\資料\\f.docx")
        self.assertEqual(to_long_path("\\\\srv\\share"), "\\\\?\\UNC\\srv\\share")

    def test_already_prefixed(self):
        """既に接頭辞が付いているパスは、変更しない。"""
        for p in ("\\\\?\\C:\\a\\b", "\\\\?\\UNC\\srv\\share\\f", "\\\\.\\pipe\\x", "//?/C:/a/b"):
            self.assertEqual(to_long_path(p), p)

    def test_not_convertible(self):
        """相対パス・ドライブ相対・空・サーバ名だけのUNCは変換しない。"""
        for p in ("a\\b.docx", "資料/a.docx", "C:a.docx", "", "\\\\srv"):
            self.assertEqual(to_long_path(p), p)

    def test_over_260(self):
        """260文字を超えるパスも変換でき、元の内容が保たれる。"""
        p = "C:\\" + "\\".join("あ" * 40 for _ in range(8)) + "\\f.docx"
        self.assertGreater(len(p), 260)
        self.assertEqual(to_long_path(p), "\\\\?\\" + p)

    def test_fs_path_is_identity_on_non_windows(self):
        """Windows以外では、パスをそのまま使う。"""
        if os.name != "nt":
            self.assertEqual(fs_path("C:\\a"), "C:\\a")


class ConfigTest(unittest.TestCase):
    def write(self, text):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "config.toml")
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        return p

    def test_valid_defaults_and_relative(self):
        """roots だけ書けば既定値が入り、相対パスは設定ファイルの場所が基準になる。"""
        p = self.write('roots = ["D:/資料"]\n')
        c = load_config(p)
        self.assertEqual(c.max_file_size_mb, 100)
        self.assertEqual(c.open_mode, "copy")
        self.assertEqual(c.db_path, os.path.join(os.path.dirname(p), "index.db"))
        self.assertIn("~$*", c.exclude_patterns)

    def test_example_file_loads(self):
        """リポジトリの config.example.toml がそのまま読み込める。"""
        c = load_config(os.path.join(os.path.dirname(common.HERE), "config.example.toml"))
        self.assertEqual(len(c.roots), 2)
        self.assertEqual(c.extensions, ["docx", "xlsx", "pptx", "pdf"])

    def assertErr(self, text, *words):
        with self.assertRaises(ConfigError) as cm:
            load_config(self.write(text))
        msg = str(cm.exception)
        for w in words:
            self.assertIn(w, msg)
        return msg

    def test_errors_name_key_and_reason(self):
        """エラーにはキー名と原因が日本語で入る。"""
        self.assertErr('db_path = "x"\n', "roots", "ありません")
        self.assertErr('roots = []\n', "roots", "空")
        self.assertErr('roots = "D:/a"\n', "roots", "リスト")
        self.assertErr('roots = ["a"]\nmax_file_size_mb = "大きい"\n', "max_file_size_mb", "数値")
        self.assertErr('roots = ["a"]\nmax_file_size_mb = 0\n', "max_file_size_mb", "範囲外")
        self.assertErr('roots = ["a"]\nmax_cells_per_xlsx = 1.5\n', "max_cells_per_xlsx", "整数")
        self.assertErr('roots = ["a"]\nsnippet_chars = 5\n', "snippet_chars", "範囲外")
        self.assertErr('roots = ["a"]\nopen_mode = "auto"\n', "open_mode", "copy")
        self.assertErr('roots = ["a"]\nmass_delete_guard = "yes"\n', "mass_delete_guard", "true")
        self.assertErr('roots = ["a"]\nextensions = ["docx", "txt"]\n', "extensions", "txt")
        self.assertErr('roots = ["a"]\nrootz = 1\n', "未知のキー", "rootz")

    def test_toml_syntax_error_and_windows_backslash(self):
        """バックスラッシュのパスで書式エラーになったとき、書き方の対処を案内する。"""
        msg = self.assertErr('roots = ["D:\\資料"]\n', "書式", "/")
        self.assertIn("シングルクォート", msg)
        self.assertIsInstance(load_config(self.write("roots = ['D:\\資料']\n")).roots, list)

    def test_missing_file_and_bad_encoding(self):
        """設定ファイルが無い・UTF-8でないときも、日本語で対処を案内する。"""
        with self.assertRaises(ConfigError) as cm:
            load_config("/nonexistent/config.toml")
        self.assertIn("config.example.toml", str(cm.exception))
        d = tempfile.mkdtemp()
        p = os.path.join(d, "c.toml")
        with open(p, "wb") as f:
            f.write('roots = ["資料"]\n'.encode("cp932"))
        with self.assertRaises(ConfigError) as cm:
            load_config(p)
        self.assertIn("UTF-8", str(cm.exception))


class QueryParseTest(unittest.TestCase):
    def test_and_phrase_exclude(self):
        """スペース区切りAND・フレーズ・除外・全角記号の正規化。"""
        q = parse_query('契約書 "有効期間 は"  -秘密 -"a b"')
        self.assertEqual(q.positives, ["契約書", "有効期間 は"])
        self.assertEqual(q.negatives, ["秘密", "a b"])
        q = parse_query("ＡＢＣ　－ｘｙｚ")  # 全角スペース・全角マイナス
        self.assertEqual((q.positives, q.negatives), (["abc"], ["xyz"]))
        self.assertEqual(parse_query("a-b").positives, ["a-b"])  # 語の途中の - は除外にならない
        self.assertEqual(parse_query("abc abc").positives, ["abc"])

    def test_special_chars_are_literal(self):
        """* : ( ) は特別扱いせず、文字として検索する。"""
        self.assertEqual(parse_query("契約* (a:b)").positives, ["契約*", "(a:b)"])

    def test_errors_are_japanese(self):
        """検索式の誤りは QueryError で、日本語の原因と対処が入る。"""
        for raw, word in (("", "入力"), ("   ", "入力"), ('"abc', "閉じられていません"), ('""', "空"), ("-", "除外"),
                          ("abc -", "除外"), ("-秘密", "だけでは"), ("--", "だけでは"), ('a"b', "閉じられていません")):
            with self.assertRaises(QueryError, msg=repr(raw)) as cm:
                parse_query(raw)
            self.assertIn(word, str(cm.exception), repr(raw))
        with self.assertRaises(QueryError):
            parse_query(" ".join("w%d" % i for i in range(30)))

    def test_like_escape(self):
        """LIKE の特殊文字がエスケープされる。"""
        self.assertEqual(like_pattern("a%b_c\\d"), "%a\\%b\\_c\\\\d%")

    def test_build_options_errors(self):
        """絞り込み条件の誤りも、日本語で QueryError になる。"""
        for kw, word in ((dict(exts="txt"), "拡張子"), (dict(since="2024/13/45"), "日付"), (dict(limit="x"), "整数"),
                          (dict(limit=0), "1以上"), (dict(sort="x"), "並び順"), (dict(scope="x"), "範囲"),
                          (dict(since="2024-05-01", until="2024-04-01"), "後")):
            with self.assertRaises(QueryError) as cm:
                build_options(**kw)
            self.assertIn(word, str(cm.exception))
        o = build_options(exts="DOCX, .pdf", since="2024/04/01")
        self.assertEqual(o.exts, ["docx", "pdf"])


class FolderChoiceTest(unittest.TestCase):
    def test_absolute_to_relative(self):
        """ダイアログで選んだ絶対パスが、検索対象フォルダからの相対パスになる。"""
        roots = ["/data/資料", "/srv/共有"]
        self.assertEqual(folder_to_relative("/data/資料/契約書/2024", roots), "契約書/2024")
        self.assertEqual(folder_to_relative("/srv/共有/企画\u3000資料", roots), "企画\u3000資料")
        self.assertEqual(folder_to_relative("/data/資料", roots), "")
        self.assertEqual(folder_to_relative("契約書/2024", roots), "契約書/2024")
        self.assertEqual(folder_to_relative("", roots), "")

    def test_outside_roots_is_japanese_error(self):
        """検索対象の外のフォルダ（前方一致だけ似ているものを含む）は、日本語のエラーになる。"""
        for p in ("/other/dir", "/data/資料2/x"):
            with self.assertRaises(QueryError) as cm:
                folder_to_relative(p, ["/data/資料"])
            self.assertIn("検索対象フォルダ", str(cm.exception))
        self.assertEqual(build_options(folder="/data/資料/a", roots=["/data/資料"]).folder, "a")


class SnippetTest(unittest.TestCase):
    def test_snippet_and_spans(self):
        """検索語の前後が切り出され、強調範囲が正しい位置を指す。"""
        text = "あ" * 100 + "契約書" + "い" * 100 + "契約書"
        s, spans = make_snippet(text, ["契約書"], 10)
        self.assertTrue(s.startswith("…") and s.endswith("…"))
        for a, b in spans:
            self.assertEqual(s[a:b], "契約書")
        self.assertEqual(len(spans), 1)
        s, spans = make_snippet("契約書の契約書", ["契約書", "契約書の"], 5)
        self.assertEqual(spans, [(0, 7)])  # 重なる・隣り合う強調範囲は1つにまとまる


class CsvTest(unittest.TestCase):
    def test_csv_and_formula_guard(self):
        """CSVはBOM付きUTF-8で、= + - @ で始まる値は数式として実行されないよう ' が付く。"""
        r = SearchResult("/r", "フォルダ/=cmd.docx", "docx", "段落1", 1_700_000_000_000_000_000, "=1+1 の件", [(0, 2)], -1.5, 2)
        d = tempfile.mkdtemp()
        p = os.path.join(d, "o", "r.csv")
        export.write_results_csv([r], p)
        with open(p, "rb") as f:
            self.assertTrue(f.read().startswith(b"\xef\xbb\xbf"))
        with open(p, encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))
        self.assertEqual(rows[0][0], "ファイル名")
        self.assertEqual(rows[1][0], "'=cmd.docx")
        self.assertEqual(rows[1][5], "'=1+1 の件")
        self.assertEqual(rows[1][7], "2")


class OpenerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self._old = tempfile.tempdir
        tempfile.tempdir = os.path.join(self.tmp, "ostmp")
        os.makedirs(tempfile.tempdir)
        self.src = os.path.join(self.tmp, "元 ファイル.docx")
        with open(self.src, "wb") as f:
            f.write(b"dummy-bytes")
        os.utime(self.src, (1_600_000_000, 1_600_000_000))
        self.before = os.stat(self.src)

    def tearDown(self):
        tempfile.tempdir = self._old

    def test_copy_is_readonly_and_original_untouched(self):
        """copy モードは、OSの一時フォルダに読み取り専用のコピーを作って開く。元ファイルは変わらない。"""
        with mock.patch.object(opener, "_launch") as launch:
            target = opener.open_file(self.src, "copy")
        launch.assert_called_once_with(target)
        self.assertNotEqual(os.path.dirname(target), self.tmp)
        self.assertTrue(target.startswith(tempfile.gettempdir()))
        with open(target, "rb") as f:
            self.assertEqual(f.read(), b"dummy-bytes")
        self.assertEqual(stat.S_IMODE(os.stat(target).st_mode) & 0o222, 0)  # 書き込み権限なし
        after = os.stat(self.src)
        self.assertEqual((after.st_size, after.st_mtime_ns), (self.before.st_size, self.before.st_mtime_ns))

    def test_original_mode_opens_original(self):
        """original モードは元ファイルのパスで開く。"""
        with mock.patch.object(opener, "_launch") as launch:
            self.assertEqual(opener.open_file(self.src, "original"), self.src)
        launch.assert_called_once_with(self.src)

    def test_cleanup_removes_readonly_copies(self):
        """終了時・次回起動時の掃除で、読み取り専用の一時コピーも削除される。"""
        with mock.patch.object(opener, "_launch"):
            t1 = opener.open_file(self.src, "copy")
            t2 = opener.open_file(self.src, "copy")
        self.assertTrue(os.path.exists(t1) and os.path.exists(t2))
        opener.cleanup_temp()  # 次回起動時と終了時（atexit）に呼ばれるのと同じ関数
        self.assertFalse(os.path.exists(t1) or os.path.exists(t2))
        self.assertFalse(os.path.exists(opener.temp_root()))
        self.assertTrue(os.path.exists(self.src))
        opener.cleanup_temp()  # 何も無くても落ちない

    def test_missing_file_message(self):
        """移動・削除されたファイルは、日本語の案内つきエラーになる。"""
        with self.assertRaises(OSError) as cm:
            opener.open_file(os.path.join(self.tmp, "無い.docx"), "copy")
        self.assertIn("インデックスを更新", str(cm.exception))


class EnvCheckTest(unittest.TestCase):
    def test_ok_here(self):
        """この環境では FTS5 と trigram が使える。"""
        self.assertTrue(db.check_environment())

    def test_old_sqlite_stops_with_japanese_message(self):
        """SQLite が古い場合は、日本語のメッセージで停止し、別方式に切り替えない。"""
        with mock.patch.object(db.sqlite3, "sqlite_version", "3.30.0"):
            with self.assertRaises(db.EnvError) as cm:
                db.check_environment()
        self.assertIn("trigram", str(cm.exception))
        self.assertIn("自動で切り替えません", str(cm.exception))

    def test_fts5_missing_stops(self):
        """FTS5/trigram が作れない場合も、日本語のメッセージで停止する。"""
        real = db.sqlite3.connect

        class Fake:
            def execute(self, sql, *a):
                raise db.sqlite3.OperationalError("no such module: fts5")

            def close(self):
                pass
        with mock.patch.object(db.sqlite3, "connect", return_value=Fake()):
            with self.assertRaises(db.EnvError) as cm:
                db.check_environment()
        self.assertIn("FTS5", str(cm.exception))
        self.assertIn("相談", str(cm.exception))
        self.assertIs(db.sqlite3.connect, real)


if __name__ == "__main__":
    unittest.main()
