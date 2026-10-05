"""ファイルを開く・フォルダを開く。既定は「読み取り専用の一時コピー」を開き、元ファイルには触れない。"""
import atexit
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid

from .pathutil import fs_path

TEMP_NAME = "docsearch_open"


def temp_root():
    """OS の一時フォルダ内の、開く用コピーの置き場所。"""
    return os.path.join(tempfile.gettempdir(), TEMP_NAME)


def cleanup_temp():
    """一時コピーをすべて削除する（読み取り専用属性は外してから削除）。使用中で消せないものは残す。"""
    base = temp_root()
    if not os.path.isdir(fs_path(base)):
        return
    for dp, dns, fns in os.walk(fs_path(base), topdown=False):
        for fn in fns:
            p = os.path.join(dp, fn)
            try:
                os.chmod(p, stat.S_IWRITE | stat.S_IREAD)
                os.remove(p)
            except OSError:
                pass
        try:
            os.rmdir(dp)
        except OSError:
            pass


def make_readonly_copy(src):
    """src を一時フォルダへコピーし、読み取り専用属性を付けたコピーのパスを返す。元ファイルは読むだけ。"""
    d = os.path.join(temp_root(), uuid.uuid4().hex[:8])
    os.makedirs(fs_path(d), exist_ok=True)
    dst = os.path.join(d, "読取専用コピー_" + os.path.basename(src))
    shutil.copyfile(fs_path(src), fs_path(dst))
    os.chmod(fs_path(dst), stat.S_IREAD)
    return dst


def _launch(path):
    """OS の既定アプリでファイルを開く。"""
    if os.name == "nt":
        os.startfile(path)  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path])


def open_file(path, mode="copy"):
    """既定のアプリで開く。mode="copy" は読み取り専用の一時コピーを開く。失敗は OSError（日本語）。"""
    if not os.path.isfile(fs_path(path)):
        raise OSError("ファイルが見つかりません: %s（移動・削除された可能性があります。インデックスを更新してください）" % path)
    target = path
    if mode == "copy":
        try:
            target = make_readonly_copy(path)
        except OSError as e:
            raise OSError("一時コピーを作成できません（%s）。一時フォルダの空き容量・権限を確認してください。" % e)
    _launch(target)
    return target


def reveal_folder(path):
    """ファイルのあるフォルダを開く（Windowsではファイルを選択した状態）。ファイルは開かない。"""
    if os.name == "nt":
        subprocess.Popen(["explorer", "/select,%s" % path])
    else:
        _launch(os.path.dirname(path))


atexit.register(cleanup_temp)
