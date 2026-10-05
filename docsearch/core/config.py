"""config.toml の読み込みと検証。エラーは日本語で、キー名と原因が分かるようにする。"""
import os
import tomllib
from dataclasses import dataclass, field

TARGET_EXTENSIONS = ("docx", "xlsx", "pptx", "pdf")


class ConfigError(Exception):
    """設定ファイルの誤り。メッセージは利用者向けの日本語。"""


@dataclass
class Config:
    roots: list = field(default_factory=list)
    db_path: str = "index.db"
    output_dir: str = "output"
    extensions: list = field(default_factory=lambda: list(TARGET_EXTENSIONS))
    legacy_extensions: list = field(default_factory=lambda: ["doc", "xls", "ppt"])
    exclude_patterns: list = field(default_factory=lambda: ["~$*", "*.tmp", "Thumbs.db"])
    max_file_size_mb: float = 100
    max_cells_per_xlsx: int = 50000
    include_numbers_in_xlsx: bool = False
    snippet_chars: int = 60
    open_mode: str = "copy"
    mass_delete_guard: bool = True

    @property
    def max_file_bytes(self):
        """サイズ上限をバイトで返す。"""
        return int(self.max_file_size_mb * 1024 * 1024)

    def extract_signature(self):
        """抽出結果に影響する設定の署名。変わったら、変更のないファイルも再処理する。"""
        return "v1|cells=%d|num=%d" % (self.max_cells_per_xlsx, int(self.include_numbers_in_xlsx))


_KNOWN = {
    "roots", "db_path", "output_dir", "extensions", "legacy_extensions", "exclude_patterns",
    "max_file_size_mb", "max_cells_per_xlsx", "include_numbers_in_xlsx", "snippet_chars",
    "open_mode", "mass_delete_guard",
}


def _bad(key, reason, hint=""):
    """キー名と原因（と対処）を含む ConfigError を作る。"""
    msg = "config.toml の設定エラー: キー「%s」%s。" % (key, reason)
    if hint:
        msg += hint
    return ConfigError(msg)


def _str_list(data, key, default=None, lower=False, required=False, allow_empty=False):
    """文字列のリストを取り出して検証する。"""
    if key not in data:
        if required:
            raise _bad(key, "がありません", "例: %s = [\"D:/資料\"]" % key)
        return default
    v = data[key]
    if not isinstance(v, list) or not all(isinstance(x, str) and x.strip() for x in v):
        raise _bad(key, "は、空でない文字列のリストで指定してください", "例: %s = [\"a\", \"b\"]" % key)
    if required and not v and not allow_empty:
        raise _bad(key, "が空です", "検索対象のフォルダを1つ以上指定してください。")
    return [x.strip().lstrip(".").lower() if lower else x.strip() for x in v]


def _number(data, key, default, integer, minimum, maximum=None):
    """数値（整数または実数）を取り出して範囲を検証する。"""
    if key not in data:
        return default
    v = data[key]
    ok = isinstance(v, int) and not isinstance(v, bool) if integer else (
        isinstance(v, (int, float)) and not isinstance(v, bool))
    if not ok:
        raise _bad(key, "は%sで指定してください" % ("整数" if integer else "数値"), "例: %s = %s" % (key, default))
    if v < minimum or (maximum is not None and v > maximum):
        rng = "%s 以上" % minimum if maximum is None else "%s～%s" % (minimum, maximum)
        raise _bad(key, "の値 %s は範囲外です" % v, "%s で指定してください。" % rng)
    return v


def _resolve(base_dir, p):
    """相対パスを設定ファイルのあるフォルダ基準の絶対パスにする。"""
    p = os.path.expanduser(p)
    if not os.path.isabs(p) and not p.startswith(("\\\\", "//")):
        p = os.path.join(base_dir, p)
    return os.path.normpath(p)


def load_config(path):
    """config.toml を読み込んで Config を返す。誤りがあれば ConfigError（日本語）。"""
    if not os.path.isfile(path):
        raise ConfigError(
            "設定ファイル「%s」が見つかりません。config.example.toml を config.toml という名前でコピーし、"
            "roots（検索対象フォルダ）を実際のパスに書き換えてください。" % path)
    try:
        with open(path, "rb") as f:
            data = tomllib.load(f)
    except UnicodeDecodeError:
        raise ConfigError("config.toml を UTF-8 として読めません。UTF-8（BOMなし）で保存し直してください。")
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(
            "config.toml の書式が正しくありません（%s）。Windows のパスは \"D:/資料\" のように「/」で書くか、"
            "'D:\\資料' のようにシングルクォートで囲んでください。\"D:\\資料\" の「\\」は特殊文字になるためエラーになります。" % e)
    unknown = sorted(set(data) - _KNOWN)
    if unknown:
        raise ConfigError("config.toml の設定エラー: 未知のキー「%s」があります。綴りを確認してください（使えるキー: %s）。"
                          % ("」「".join(unknown), "、".join(sorted(_KNOWN))))
    base = os.path.dirname(os.path.abspath(path))
    # roots は省略できる（検索画面の「選択…」で、検索するフォルダを後から選べる）
    roots = [_resolve(base, r) for r in _str_list(data, "roots", default=[])]
    db_path = data.get("db_path", "index.db")
    out_dir = data.get("output_dir", "output")
    for k, v in (("db_path", db_path), ("output_dir", out_dir)):
        if not isinstance(v, str) or not v.strip():
            raise _bad(k, "は、空でない文字列で指定してください")
    cfg = Config(roots=roots, db_path=_resolve(base, db_path), output_dir=_resolve(base, out_dir))
    cfg.extensions = _str_list(data, "extensions", cfg.extensions, lower=True)
    bad = [e for e in cfg.extensions if e not in TARGET_EXTENSIONS]
    if bad:
        raise _bad("extensions", "に対応していない拡張子 %s があります" % "、".join(bad),
                   "指定できるのは %s です。" % "、".join(TARGET_EXTENSIONS))
    cfg.legacy_extensions = _str_list(data, "legacy_extensions", cfg.legacy_extensions, lower=True)
    cfg.exclude_patterns = _str_list(data, "exclude_patterns", cfg.exclude_patterns)
    cfg.max_file_size_mb = _number(data, "max_file_size_mb", 100, False, 0.001)
    cfg.max_cells_per_xlsx = _number(data, "max_cells_per_xlsx", 50000, True, 1)
    cfg.snippet_chars = _number(data, "snippet_chars", 60, True, 10, 500)
    for k in ("include_numbers_in_xlsx", "mass_delete_guard"):
        if k in data:
            if not isinstance(data[k], bool):
                raise _bad(k, "は true か false で指定してください")
            setattr(cfg, k, data[k])
    if "open_mode" in data:
        if data["open_mode"] not in ("copy", "original"):
            raise _bad("open_mode", "の値 %r は使えません" % (data["open_mode"],), "\"copy\" か \"original\" を指定してください。")
        cfg.open_mode = data["open_mode"]
    return cfg
