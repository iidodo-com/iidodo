"""パスの扱い（260文字超・UNC・日本語パス対応）と、リンクの判定。"""
import ntpath
import os
import stat

_LONG_PREFIXES = ("\\\\?\\", "\\\\.\\")


def to_long_path(path):
    """Windows の長いパス用接頭辞（\\\\?\\）を付けた文字列を返す。文字列→文字列だけの関数。

    - 通常パス  C:\\a\\b        → \\\\?\\C:\\a\\b
    - UNCパス   \\\\srv\\sh\\a   → \\\\?\\UNC\\srv\\sh\\a
    - 既に接頭辞が付いているパスは、そのまま返す
    - 相対パス・ドライブ相対パス（C:a）は、接頭辞を付けられないのでそのまま返す
    「/」は「\\」に直し、「.」「..」は整理してから接頭辞を付ける（\\\\?\\ 形式は整理されないため）。
    """
    if not path:
        return path
    if path.startswith(_LONG_PREFIXES) or path.startswith(("//?/", "//./")):
        return path
    p = path.replace("/", "\\")
    if p.startswith("\\\\"):
        parts = [x for x in p[2:].split("\\") if x]
        if len(parts) < 2:  # サーバ名と共有名が揃っていないものは変換しない
            return path
        return "\\\\?\\UNC\\" + ntpath.normpath(p)[2:]
    if len(p) >= 3 and p[1] == ":" and p[2] == "\\" and p[0].isalpha():
        return "\\\\?\\" + ntpath.normpath(p)
    return path


def fs_path(path):
    """ファイル操作に渡すパスを返す。Windows のときだけ長いパス用に変換し、他のOSではそのまま返す。"""
    return to_long_path(path) if os.name == "nt" else path


def _isjunction_fallback(path):
    """os.path.isjunction がない Python（3.11以前。開発環境のみ）用の代替。Windows のジャンクションを判定する。"""
    if os.name != "nt":
        return False
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return bool(getattr(st, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT) and not stat.S_ISLNK(st.st_mode)


# 職場PC（Python 3.14）では標準の os.path.isjunction を使う
isjunction = getattr(os.path, "isjunction", _isjunction_fallback)


def is_link(path):
    """シンボリックリンクまたはジャンクションなら True（辿らないための判定）。"""
    return os.path.islink(path) or isjunction(path)


def display_path(root, relpath):
    """画面表示・コピー用の通常形式のパス（\\\\?\\ なし）を組み立てる。relpath は「/」区切り。"""
    return os.path.normpath(os.path.join(root, *relpath.split("/")))


def read_bytes(path):
    """ファイルを読み取り専用（rb）で全部読む。対象フォルダのファイルを開く唯一の入口。"""
    with open(fs_path(path), "rb") as f:
        return f.read()
