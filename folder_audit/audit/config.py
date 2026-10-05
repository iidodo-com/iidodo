"""設定ファイル（config.toml）の読み込みと検証"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from pathlib import Path


class ConfigError(Exception):
    """設定の誤りを示す例外"""


@dataclass(frozen=True)
class Config:
    reference_date: dt.date | None
    stale_years: int
    depth_threshold: int
    exclude_names: tuple
    exclude_dirs: tuple
    partial_bytes: int
    max_read_bytes: int
    required_patterns: tuple
    forbidden_patterns: tuple
    version_patterns: tuple

    def compiled(self, patterns):
        """文字列の正規表現リストをコンパイルして返す"""
        return [re.compile(p) for p in patterns]

    def display_rows(self):
        """Excelの「使用した設定値」に出す (項目, 値) の一覧を返す"""
        ref = self.reference_date.isoformat() if self.reference_date else "(空: 実行日を使用)"
        return [
            ("reference_date", ref),
            ("stale_years", self.stale_years),
            ("depth_threshold", self.depth_threshold),
            ("scan.exclude_names", ", ".join(self.exclude_names)),
            ("scan.exclude_dirs", ", ".join(self.exclude_dirs)),
            ("hash.partial_bytes", self.partial_bytes),
            ("hash.max_read_bytes", self.max_read_bytes),
            ("naming.required_patterns", " | ".join(self.required_patterns) or "(未設定)"),
            ("naming.forbidden_patterns", " | ".join(self.forbidden_patterns) or "(未設定)"),
            ("version.patterns", " | ".join(self.version_patterns)),
        ]


def _str_list(section: dict, key: str, label: str) -> tuple:
    """文字列のリスト項目を取り出して検証する"""
    v = section.get(key, [])
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise ConfigError(f"{label} は文字列のリストで指定してください")
    return tuple(v)


def _int(section: dict, key: str, label: str, default: int, minimum: int) -> int:
    """整数項目を取り出して検証する"""
    v = section.get(key, default)
    if isinstance(v, bool) or not isinstance(v, int) or v < minimum:
        raise ConfigError(f"{label} は {minimum} 以上の整数で指定してください")
    return v


def _check_regex(patterns: tuple, label: str) -> None:
    """正規表現として正しいか検証する"""
    for p in patterns:
        try:
            re.compile(p)
        except re.error as e:
            raise ConfigError(f"{label} の正規表現が不正です: {p!r} ({e})")


def parse_config(data: dict) -> Config:
    """辞書（TOMLの内容）から Config を作る"""
    ref = data.get("reference_date", "")
    if isinstance(ref, dt.datetime):
        ref = ref.date()
    elif isinstance(ref, str):
        ref = ref.strip()
        if ref:
            try:
                ref = dt.date.fromisoformat(ref)
            except ValueError:
                raise ConfigError("reference_date は YYYY-MM-DD 形式で指定してください")
        else:
            ref = None
    elif not isinstance(ref, dt.date):
        raise ConfigError("reference_date は YYYY-MM-DD 形式で指定してください")
    scan = data.get("scan", {})
    hs = data.get("hash", {})
    nm = data.get("naming", {})
    ver = data.get("version", {})
    cfg = Config(
        reference_date=ref,
        stale_years=_int(data, "stale_years", "stale_years", 3, 1),
        depth_threshold=_int(data, "depth_threshold", "depth_threshold", 8, 1),
        exclude_names=_str_list(scan, "exclude_names", "scan.exclude_names"),
        exclude_dirs=_str_list(scan, "exclude_dirs", "scan.exclude_dirs"),
        partial_bytes=_int(hs, "partial_bytes", "hash.partial_bytes", 65536, 1),
        max_read_bytes=_int(hs, "max_read_bytes", "hash.max_read_bytes", 1 << 30, 1),
        required_patterns=_str_list(nm, "required_patterns", "naming.required_patterns"),
        forbidden_patterns=_str_list(nm, "forbidden_patterns", "naming.forbidden_patterns"),
        version_patterns=_str_list(ver, "patterns", "version.patterns"),
    )
    if cfg.max_read_bytes < 2 * cfg.partial_bytes:
        raise ConfigError("hash.max_read_bytes は hash.partial_bytes の2倍以上にしてください")
    _check_regex(cfg.required_patterns, "naming.required_patterns")
    _check_regex(cfg.forbidden_patterns, "naming.forbidden_patterns")
    _check_regex(cfg.version_patterns, "version.patterns")
    return cfg


def load_config(path) -> Config:
    """設定ファイルを読み込む（BOM付きUTF-8も可）"""
    import tomllib

    try:
        text = Path(path).read_bytes().decode("utf-8-sig")
        data = tomllib.loads(text)
    except OSError as e:
        raise ConfigError(f"設定ファイルを読めません: {path} ({e})")
    except (UnicodeDecodeError, tomllib.TOMLDecodeError) as e:
        raise ConfigError(f"設定ファイルの書式が不正です: {path} ({e})")
    return parse_config(data)
