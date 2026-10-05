"""config.toml を作る（セットアップ.bat から呼ばれる）。使い方: python setup_config.py ["検索したいフォルダのパス"]

UTF-8 で書き出す（バッチファイルから日本語を直接書くと文字コードが合わないため、この小さなスクリプトで作る）。
index.db と出力先は、共有フォルダではなく、自分のPCの ~/docsearch_data に置く設定にする。
"""
import json
import os
import sys

from core.config import ConfigError, load_config
from core.pathutil import fs_path

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.expanduser("~"), "docsearch_data")


def build_text(root):
    """config.toml の内容を作る。root は「/」区切りにし、TOML の文字列として安全に書き出す。root が空なら roots = []。"""
    roots = json.dumps(root.replace("\\", "/"), ensure_ascii=False) if root else ""
    return (
        "# セットアップ.bat が作成した設定です。詳しい項目は config.example.toml を参照してください。\n"
        "# roots は省略・空でも構いません（検索画面の「選択…」で、検索するフォルダを選べます）。\n"
        "roots = [%s]\n"
        "db_path = \"~/docsearch_data/index.db\"\n"
        "output_dir = \"~/docsearch_data/output\"\n" % roots)


def main(argv=None):
    """config.toml を作成する。戻り値は終了コード（0:作成 2:引数・既存 3:フォルダにアクセスできない）。"""
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) > 1:
        print("使い方: python setup_config.py [\"検索したいフォルダのパス\"]（省略すると、検索画面で選ぶ設定になります）")
        return 2
    root = (args[0].strip().strip('"').rstrip("\\/") or args[0].strip()) if args and args[0].strip() else ""
    target = os.path.join(HERE, "config.toml")
    if os.path.exists(target):
        print("config.toml は既にあるため、変更しませんでした（変更するにはメモ帳で config.toml を編集してください）。")
        return 2
    if root and not os.path.isdir(fs_path(root)):
        print("エラー: フォルダ「%s」にアクセスできません。パスの綴り・共有フォルダの接続・権限を確認して、もう一度実行してください。" % root)
        return 3
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write(build_text(root))
    try:
        load_config(target)
    except ConfigError as e:
        os.remove(target)
        print("エラー: %s" % e)
        return 2
    print("config.toml を作成しました。検索対象: %s ／ index.db の保存先: %s" % (root or "（検索画面で選択）", DATA_DIR))
    return 0


if __name__ == "__main__":
    sys.exit(main())
