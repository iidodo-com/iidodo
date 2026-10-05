"""フォルダの走査（読み取り専用）。リンクは辿らず、読めないものは記録して続行する"""
from __future__ import annotations

import errno
import fnmatch
import os

from .pathutil import to_os_path

LINK_KIND = "リンク/再解析ポイント（未追跡）"
SPECIAL_KIND = "特殊ファイル（対象外）"
NAME_KIND = "ファイル名の文字コード不正"
MTIME_KIND = "更新日時が不正"
REPARSE_POINT = 0x400  # Windowsの再解析ポイント属性（ジャンクション等）
BATCH = 2000


def classify_error(e: OSError) -> str:
    """例外をエラー種別の文字列に分類する"""
    winerr = getattr(e, "winerror", None)
    if isinstance(e, PermissionError):
        return "アクセス権限エラー"
    if e.errno == errno.ENAMETOOLONG or winerr == 206:
        return "パス長エラー"
    if winerr in (53, 55, 59, 64, 67, 121, 1219, 1231) or e.errno in (
            errno.ENETUNREACH, errno.ENETDOWN, errno.EHOSTUNREACH, errno.ETIMEDOUT):
        return "ネットワークエラー"
    if isinstance(e, FileNotFoundError):
        return "走査中に見つからない（削除・移動の可能性）"
    return f"その他のOSエラー（{type(e).__name__}）"


def _is_link(entry) -> bool:
    """シンボリックリンク・ジャンクション・再解析ポイントなら True"""
    if entry.is_symlink():
        return True
    junction = getattr(entry, "is_junction", None)
    if junction is not None and junction():
        return True
    attrs = getattr(entry.stat(follow_symlinks=False), "st_file_attributes", 0)
    return bool(attrs & REPARSE_POINT)


def _safe(s: str) -> str:
    """SQLiteに保存できない文字（単独サロゲート等）を置換する"""
    try:
        s.encode("utf-8")
        return s
    except UnicodeEncodeError:
        return s.encode("utf-8", "replace").decode("utf-8")


def scan(root: str, cfg, store, progress=None) -> dict:
    """root 以下を走査して store に保存する。除外件数などの統計を返す"""
    ex_files = [p.lower() for p in cfg.exclude_names]
    ex_dirs = [p.lower() for p in cfg.exclude_dirs]
    stats = {"excluded_files": 0, "excluded_dirs": 0, "seen": 0}
    files, dirs, errs = [], [], []

    def flush():
        """バッファをDBへ書き出す"""
        store.add_files(files)
        store.add_dirs(dirs)
        store.add_errors(errs)
        store.commit()
        files.clear(), dirs.clear(), errs.clear()

    def matches(name, pats):
        """名前が除外パターンのいずれかに合うか"""
        n = name.lower()
        return any(fnmatch.fnmatchcase(n, p) for p in pats)

    stack = [(root, 0)]
    while stack:
        dpath, depth = stack.pop()
        dirs.append((_safe(dpath), depth))
        try:
            it = os.scandir(to_os_path(dpath))
        except OSError as e:
            errs.append((_safe(dpath), classify_error(e), str(e), "走査"))
            continue
        try:
            with it:
                for entry in it:
                    stats["seen"] += 1
                    name = entry.name
                    full = os.path.join(dpath, name)
                    try:
                        if _is_link(entry):
                            errs.append((_safe(full), LINK_KIND, "辿らずに記録のみ", "走査"))
                        elif entry.is_dir(follow_symlinks=False):
                            if matches(name, ex_dirs):
                                stats["excluded_dirs"] += 1
                            else:
                                stack.append((full, depth + 1))
                        elif entry.is_file(follow_symlinks=False):
                            if matches(name, ex_files):
                                stats["excluded_files"] += 1
                                continue
                            st = entry.stat(follow_symlinks=False)
                            sname = _safe(name)
                            if sname != name:
                                errs.append((_safe(full), NAME_KIND, "置換して記録", "走査"))
                            mtime = st.st_mtime
                            if mtime is None or not (-1e11 < mtime < 1e11):
                                errs.append((_safe(full), MTIME_KIND, repr(mtime), "走査"))
                                mtime = None
                            files.append((_safe(full), _safe(dpath), sname,
                                          os.path.splitext(sname)[1].lower(), st.st_size, mtime))
                        else:
                            errs.append((_safe(full), SPECIAL_KIND, "通常のファイル/フォルダではない", "走査"))
                    except OSError as e:
                        errs.append((_safe(full), classify_error(e), str(e), "走査"))
                    if len(files) + len(errs) >= BATCH:
                        flush()
                    if progress and stats["seen"] % 500 == 0:
                        progress("走査", stats["seen"])
        except OSError as e:
            errs.append((_safe(dpath), classify_error(e), str(e), "走査"))
    flush()
    if progress:
        progress("走査", stats["seen"], final=True)
    store.set_meta("excluded_files", stats["excluded_files"])
    store.set_meta("excluded_dirs", stats["excluded_dirs"])
    return stats
