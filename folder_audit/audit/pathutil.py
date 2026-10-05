"""Windowsの長いパス・UNCパス対応のためのパス変換"""
from __future__ import annotations

import ntpath
import os

EXT_PREFIX = "\\\\?\\"
UNC_EXT_PREFIX = "\\\\?\\UNC\\"


def to_extended_path(path: str, windows: bool | None = None) -> str:
    """OS呼び出し用に拡張長パスへ変換する。
    C:\\a\\b -> \\\\?\\C:\\a\\b、\\\\srv\\share\\a -> \\\\?\\UNC\\srv\\share\\a。
    Windows以外では何もしない（windows=True でテスト用に強制できる）"""
    if windows is None:
        windows = os.name == "nt"
    if not windows:
        return path
    p = path.replace("/", "\\")
    if p.startswith(EXT_PREFIX) or p.startswith("\\\\.\\"):
        return p
    if p.startswith("\\\\"):
        return UNC_EXT_PREFIX + ntpath.normpath(p)[2:]
    return EXT_PREFIX + ntpath.abspath(p)


def to_os_path(path: str) -> str:
    """ファイル操作（scandir/open）に渡すパスを返す"""
    return to_extended_path(path)


def to_display_path(path: str) -> str:
    """拡張長パス表記を取り除き、人が読む通常の表記に戻す"""
    if path.startswith(UNC_EXT_PREFIX):
        return "\\\\" + path[len(UNC_EXT_PREFIX):]
    if path.startswith(EXT_PREFIX):
        return path[len(EXT_PREFIX):]
    return path
