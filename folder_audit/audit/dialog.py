"""フォルダ選択ダイアログ（標準ライブラリ tkinter。画面表示のみで通信はしない）"""
from __future__ import annotations

import os


class DialogUnavailable(Exception):
    """ダイアログを開けない環境（画面なし・tkinter未導入）を示す例外"""


def choose_folder(title: str, initialdir: str | None = None) -> str | None:
    """フォルダ選択ダイアログを開き、選んだパスを返す。キャンセル時は None。
    Windowsのダイアログは / 区切りで返すため、OS標準の区切りに正規化する（UNCも \\\\server\\share 形式）"""
    try:
        import tkinter
        from tkinter import filedialog
        root = tkinter.Tk()
    except Exception as e:  # ImportError / TclError（画面なし）
        raise DialogUnavailable(str(e))
    try:
        root.withdraw()
        root.attributes("-topmost", True)  # 他のウィンドウの後ろに隠れないように
        chosen = filedialog.askdirectory(title=title, initialdir=initialdir, mustexist=True, parent=root)
    finally:
        root.destroy()
    return os.path.normpath(chosen) if chosen else None
