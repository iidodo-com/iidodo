"""config.yaml の読み込みと検証。エラーは日本語で原因と対処を示す。"""
from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Any

import yaml

from .errors import OcrToolError

# 既定値。config.yaml に無い項目はここの値になる
DEFAULTS: dict[str, Any] = {
    "input_dir": "./in",
    "output_dir": "./out",
    "recursive": False,
    "ocr": {
        "language": "jpn",
        "psm": "auto",
        "dpi": 300,
        "timeout_sec": 300,
        "tesseract_cmd": None,
        "tessdata_dir": None,
        "second_tessdata_dir": None,
        "engine": "tesseract",
        "remove_cjk_spaces": True,
    },
    "pdf": {"render_dpi": 300},
    "preprocess": {
        "enabled": True,
        "grayscale": True,
        "deskew": True,
        "denoise": "nlmeans",
        "flatten": True,
        "remove_lines": True,
        "binarize": "none",
    },
    "layout": {"mode": "auto", "min_cells": 4},
    "handwriting": {"enabled": False, "model_dir": None},
    "review": {"threshold": 70, "word_level": False},
    "output": {"page_txt": True, "searchable_pdf": True, "page_header": True},
}

_CHOICES = {
    ("preprocess", "denoise"): ("none", "median", "nlmeans"),
    ("preprocess", "binarize"): ("none", "otsu"),
    ("layout", "mode"): ("auto", "text", "cells"),
    ("ocr", "engine"): ("tesseract", "handwriting"),
}


def _deep_merge(base: dict, override: dict, path: str = "") -> dict:
    """base に override を再帰的に重ねる。未知のキーは誤記の可能性が高いのでエラーにする。"""
    out = copy.deepcopy(base)
    for key, value in override.items():
        if key not in base:
            raise OcrToolError(
                f"config.yaml に未知の項目 '{path}{key}' があります。",
                f"項目名のスペルを確認してください。使える項目: {', '.join(base.keys())}",
            )
        if isinstance(base[key], dict):
            if value is None:
                continue
            if not isinstance(value, dict):
                raise OcrToolError(
                    f"config.yaml の '{path}{key}' は入れ子の設定（キー: 値）である必要があります。",
                    "インデントとコロンの書式を確認してください。",
                )
            out[key] = _deep_merge(base[key], value, f"{path}{key}.")
        else:
            out[key] = value
    return out


def _normalize_choice(section: str, key: str, value: Any) -> str:
    """YAMLでは none/off が null/false に化けることがあるので文字列に戻して検証する。"""
    if value is None or value is False:
        value = "none"
    elif value is True:
        raise OcrToolError(
            f"config.yaml の {section}.{key} に true は指定できません。",
            f"{' / '.join(_CHOICES[(section, key)])} のいずれかを書いてください。",
        )
    value = str(value).strip().lower()
    if value == "off":
        value = "none"
    if value not in _CHOICES[(section, key)]:
        raise OcrToolError(
            f"config.yaml の {section}.{key} の値 '{value}' は使えません。",
            f"{' / '.join(_CHOICES[(section, key)])} のいずれかを指定してください。",
        )
    return value


def validate(cfg: dict) -> dict:
    """値の型・範囲を検証し、表記ゆれを正規化する。"""
    ocr = cfg["ocr"]
    lang = str(ocr["language"]).strip()
    if not re.fullmatch(r"[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*", lang):
        raise OcrToolError(
            f"ocr.language '{lang}' の書式が正しくありません。",
            "例: jpn / jpn_vert / jpn+eng のように、言語コードを + でつないでください。",
        )
    ocr["language"] = lang

    psm = ocr["psm"]
    if str(psm).lower() == "auto":
        ocr["psm"] = "auto"
    else:
        try:
            psm = int(psm)
            if not 0 <= psm <= 13:
                raise ValueError
        except (TypeError, ValueError):
            raise OcrToolError(
                f"ocr.psm '{psm}' は使えません。",
                "auto、または 0〜13 の整数を指定してください。",
            ) from None
        ocr["psm"] = psm

    for section, key, lo, hi in [
        ("ocr", "dpi", 50, 1200),
        ("ocr", "timeout_sec", 1, 86400),
        ("pdf", "render_dpi", 72, 600),
        ("review", "threshold", 0, 100),
        ("layout", "min_cells", 1, 1000),
    ]:
        v = cfg[section][key]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            raise OcrToolError(
                f"config.yaml の {section}.{key} は {lo}〜{hi} の数値で指定してください（現在: {v!r}）。",
                "数値以外や範囲外の値が入っていないか確認してください。",
            )

    for section, key in _CHOICES:
        cfg[section][key] = _normalize_choice(section, key, cfg[section][key])

    bool_keys = [
        ("recursive",), ("ocr", "remove_cjk_spaces"),
        ("preprocess", "enabled"), ("preprocess", "grayscale"), ("preprocess", "deskew"), ("preprocess", "flatten"), ("preprocess", "remove_lines"),
        ("review", "word_level"), ("handwriting", "enabled"),
        ("output", "page_txt"), ("output", "searchable_pdf"), ("output", "page_header"),
    ]
    for path in bool_keys:
        v = cfg[path[0]] if len(path) == 1 else cfg[path[0]][path[1]]
        if not isinstance(v, bool):
            raise OcrToolError(
                f"config.yaml の {'.'.join(path)} は true / false で指定してください（現在: {v!r}）。",
                "引用符で囲まず、小文字の true か false を書いてください。",
            )
    return cfg


def load_config(path: str | Path | None) -> dict:
    """config.yaml を読み、既定値に重ねて検証した設定dictを返す。path=None なら既定値のみ。"""
    cfg = copy.deepcopy(DEFAULTS)
    if path is not None:
        p = Path(path)
        if not p.is_file():
            raise OcrToolError(
                f"設定ファイルが見つかりません: {p}",
                "main.py と同じフォルダの config.yaml を使うか、--config でパスを指定してください。",
            )
        try:
            data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as e:
            raise OcrToolError(
                f"設定ファイルの書式エラーです: {e}",
                "インデント（スペース。タブは不可）とコロンの後の半角スペースを確認してください。",
            ) from e
        except UnicodeDecodeError as e:
            raise OcrToolError(
                "設定ファイルがUTF-8として読めません。",
                "メモ帳なら「名前を付けて保存」で文字コードをUTF-8にしてください。",
            ) from e
        if not isinstance(data, dict):
            raise OcrToolError("設定ファイルの中身が「キー: 値」の形式ではありません。", "config.yaml の書式を確認してください。")
        cfg = _deep_merge(cfg, data)
    return validate(cfg)


def is_vertical(cfg: dict) -> bool:
    """言語設定に縦書き(jpn_vert)が含まれるか。"""
    return "_vert" in cfg["ocr"]["language"]
