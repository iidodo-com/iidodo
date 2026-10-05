"""コンソール出力の設定。"""
import sys

NOTICE_INDEX = (
    "【取扱い注意】index.db には、対象文書の本文（正規化後のテキスト）が含まれます。\n"
    "元の文書と同等の機密情報として扱ってください（共有フォルダ・クラウド・メールに置かない／持ち出さない／不要になったら削除）。\n"
    "このツールは対象フォルダのファイルを変更・削除・移動・リネームしません（読み取り専用）。"
)


def setup_stdio():
    """Windows のコンソール（cp932）で表示できない文字があっても、例外で落ちないようにする。"""
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
