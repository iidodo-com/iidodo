"""ソースコードの静的チェック: 通信しないこと、対象フォルダに対する破壊的な操作を書いていないこと。"""
import os
import re
import unittest

from tests import common

ROOT = os.path.dirname(common.HERE)
APP_FILES = [os.path.join(ROOT, f) for f in ("index.py", "search.py", "gui.py")] + [
    os.path.join(ROOT, "core", f) for f in os.listdir(os.path.join(ROOT, "core")) if f.endswith(".py")]


def source(path):
    """ソースを読む（コメント行は除く）。"""
    with open(path, encoding="utf-8") as f:
        return "\n".join(ln for ln in f.read().splitlines() if not ln.lstrip().startswith("#"))


class StaticTest(unittest.TestCase):
    def test_no_network_modules(self):
        """アプリ本体が、通信に使うモジュールを読み込んでいない（完全オフライン）。"""
        pat = re.compile(r"^\s*(import|from)\s+(socket|ssl|urllib|http|ftplib|smtplib|poplib|imaplib|telnetlib|xmlrpc|requests|"
                         r"httpx|aiohttp|webbrowser|asyncio)\b", re.M)
        for p in APP_FILES:
            self.assertIsNone(pat.search(source(p)), os.path.basename(p))

    def test_destructive_calls_only_in_opener(self):
        """ファイルの削除・移動・リネーム・属性変更は、一時コピーを扱う opener.py だけにある。"""
        pat = re.compile(r"os\.(remove|unlink|rename|replace|rmdir|removedirs|chmod|utime|truncate)|shutil\.(move|rmtree|copy|copy2|copyfile)|\.unlink\(|\.rename\(")
        for p in APP_FILES:
            if os.path.basename(p) == "opener.py":
                continue
            self.assertIsNone(pat.search(source(p)), os.path.basename(p))

    def test_write_open_only_in_export(self):
        """書き込みモードの open() は、CSV出力（export.py）だけにある。対象ファイルを開くのは read_bytes（rb）だけ。"""
        pat = re.compile(r"\bopen\([^,()]*(?:\([^()]*\))?[^,()]*,\s*[\"']([^\"']+)[\"']")
        found = 0
        for p in APP_FILES:
            for m in pat.finditer(source(p)):
                found += 1
                if os.path.basename(p) != "export.py":
                    self.assertFalse(set(m.group(1)) & set("wax+"), "%s: %s" % (os.path.basename(p), m.group(0)))
        self.assertGreaterEqual(found, 3)  # 正規表現が空振りしていないことの確認


class BatchFileTest(unittest.TestCase):
    NAMES = ("セットアップ.bat", "更新.bat", "検索.bat")

    def test_bat_encoding_and_unc_safe(self):
        """バッチファイルは、日本語Windowsで文字化けしないよう Shift-JIS(cp932)・CRLF で、UNCパスでも動くよう pushd を使う。"""
        for n in self.NAMES:
            with open(os.path.join(ROOT, n), "rb") as f:
                raw = f.read()
            text = raw.decode("cp932")  # cp932 で読めること
            self.assertNotIn(b"\r\r\n", raw)
            self.assertEqual(raw.count(b"\n"), raw.count(b"\r\n"), n + ": CRLF")
            self.assertIn('pushd "%~dp0"', text, n)
            self.assertNotIn("\ncd ", text, n)
            # 括弧ブロック（行末の「(」や行頭の「)」）は、中に ) があると cmd が崩れるので使わない
            for ln in text.splitlines():
                self.assertFalse(ln.rstrip().endswith("("), "%s: %s" % (n, ln))
                self.assertFalse(ln.lstrip().startswith(")"), "%s: %s" % (n, ln))
            self.assertNotRegex(text, r"(?m)^\s*(if|else|for)\b.*\($", n)

    def test_setup_config_writes_utf8_toml(self):
        """setup_config.py が UTF-8 の config.toml を作り、DB の保存先を共有フォルダ側にしない。"""
        import tempfile
        import setup_config
        from core.config import load_config
        d = tempfile.mkdtemp()
        root = os.path.join(d, "行政経営課 資料")
        os.makedirs(root)
        old_here, old_data = setup_config.HERE, setup_config.DATA_DIR
        setup_config.HERE, setup_config.DATA_DIR = d, os.path.join(d, "data")
        try:
            self.assertEqual(setup_config.main([os.path.join(d, "無い")]), 3)  # 存在しないフォルダ
            self.assertEqual(setup_config.main([root + "\\"]), 0)  # 末尾の区切りは除かれる
            self.assertEqual(setup_config.main([root]), 2)  # 既存は上書きしない
        finally:
            setup_config.HERE, setup_config.DATA_DIR = old_here, old_data
        cfg = load_config(os.path.join(d, "config.toml"))
        self.assertEqual(cfg.roots, [os.path.normpath(root)])
        self.assertTrue(cfg.db_path.startswith(os.path.expanduser("~")))


if __name__ == "__main__":
    unittest.main()
