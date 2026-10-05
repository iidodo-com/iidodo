"""命名逸脱・版の乱立・長期未更新などのチェック"""
from __future__ import annotations

import os
import re
import unicodedata
from collections import defaultdict

STRIP_CHARS = " _-　.()（）"


def naming_violations(store, cfg):
    """必須/禁止パターンによる命名逸脱を返す。規則が両方空なら (None, [])（規則未設定）。
    戻り値: (規則設定あり or None, [(path, dir, name, 理由, size, mtime)])"""
    req = cfg.compiled(cfg.required_patterns)
    forb = cfg.compiled(cfg.forbidden_patterns)
    if not req and not forb:
        return None, []
    rows = []
    for path, d, name, _ext, size, mtime in store.iter_files_by_dir():
        reasons = []
        if req and not any(r.search(name) for r in req):
            reasons.append("必須パターン不一致")
        for pat, r in zip(cfg.forbidden_patterns, forb):
            if r.search(name):
                reasons.append(f"禁止パターン: {pat}")
        if reasons:
            rows.append((path, d, name, "; ".join(reasons), size, mtime))
    return True, rows


def _norm_stem(name: str):
    """拡張子を除いた名前をNFKC正規化して (stem, ext) を返す"""
    stem, ext = os.path.splitext(name)
    return unicodedata.normalize("NFKC", stem), ext.lower()


def version_candidates(store, cfg):
    """版管理パターンに該当するファイルと、同じフォルダ内で版が乱立している候補グループを返す。
    戻り値: (hits, groups)。hits は [(path, dir, name, 該当パターン, size, mtime)]、
    groups は [dict(id, dir, key, items=[(path, name, hit_patterns, size, mtime)])]"""
    pats = list(zip(cfg.version_patterns, cfg.compiled(cfg.version_patterns)))
    if not pats:
        return [], []
    hits, groups = [], []

    def flush(d, buckets):
        """1フォルダ分のバケットから、2件以上かつ版パターン該当を含むものをグループ化する"""
        for (key, ext), items in buckets.items():
            if len(items) >= 2 and key and any(i[2] for i in items):
                groups.append({"dir": d, "key": key + ext, "items": items})

    cur, buckets = None, defaultdict(list)
    for path, d, name, _ext, size, mtime in store.iter_files_by_dir():
        if d != cur:
            if cur is not None:
                flush(cur, buckets)
            cur, buckets = d, defaultdict(list)
        stem, ext = _norm_stem(name)
        matched = [p for p, r in pats if r.search(stem)]
        key = stem
        for _p, r in pats:
            key = r.sub("", key)
        key = key.strip(STRIP_CHARS).casefold()
        if matched:
            hits.append((path, d, name, ", ".join(matched), size, mtime))
        buckets[(key, ext)].append((path, name, matched, size, mtime))
    if cur is not None:
        flush(cur, buckets)
    for i, g in enumerate(groups, 1):
        g["id"] = i
    return hits, groups


def deep_folders(folder_rows, threshold: int):
    """階層の深さが閾値を超えるフォルダ行だけを返す（folder_summary の行形式）"""
    return [r for r in folder_rows if r[1] > threshold]
