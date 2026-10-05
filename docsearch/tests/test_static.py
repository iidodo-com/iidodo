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


if __name__ == "__main__":
    unittest.main()
