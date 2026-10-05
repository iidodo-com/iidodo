"""段階的な重複判定：サイズ一致 → 先頭・末尾ハッシュ一致 → 全体SHA-256一致"""
from __future__ import annotations

import hashlib
from collections import defaultdict

from .pathutil import to_os_path
from .scanner import classify_error

CONFIRMED = "全体SHA-256一致"
UNVERIFIED = "全体は未確認（先頭・末尾のみ一致）"
HASH_PHASE = "ハッシュ計算"
CHUNK = 1 << 20


def partial_hash(path: str, size: int, n: int):
    """先頭n・末尾nバイトのSHA-256を返す。size<=2n なら全体を読み (hex, True)、
    それ以外は (hex, False)。読み取りのみ"""
    h = hashlib.sha256()
    with open(to_os_path(path), "rb") as f:
        if size <= 2 * n:
            h.update(f.read())
            return h.hexdigest(), True
        h.update(f.read(n))
        f.seek(size - n)
        h.update(f.read(n))
    return h.hexdigest(), False


def full_hash(path: str) -> str:
    """ファイル全体のSHA-256を返す（読み取りのみ）"""
    h = hashlib.sha256()
    with open(to_os_path(path), "rb") as f:
        while True:
            b = f.read(CHUNK)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def find_duplicates(store, cfg, progress=None):
    """重複候補グループのリストを返す。各要素は dict(status, size, paths)。
    前の段階で一致しないものは次の段階に進めない"""
    n = cfg.partial_bytes
    total = store.count_same_size_files()
    done = 0
    groups = []

    def fail(path, e):
        """ハッシュ計算での読み取り失敗を記録する"""
        store.add_errors([(path, classify_error(e), str(e), HASH_PHASE)])

    for size in store.duplicate_sizes():
        by_partial = defaultdict(list)
        for path, mtime in store.files_of_size(size):
            done += 1
            if progress and done % 50 == 0:
                progress("ハッシュ計算(部分)", done, total)
            cached = store.get_hash(path, size, mtime)
            if cached is None:
                try:
                    p, complete = partial_hash(path, size, n)
                except OSError as e:
                    fail(path, e)
                    continue
                cached = (p, p if complete else None)
                store.put_hash(path, size, mtime, *cached)
            by_partial[cached[0]].append((path, mtime, cached[1], cached[0]))
        for items in by_partial.values():
            if len(items) < 2:
                continue
            if items[0][2] is not None:  # 全体を読み済み（小さいファイル）
                groups.append({"status": CONFIRMED, "size": size, "paths": sorted(i[0] for i in items)})
            elif size > cfg.max_read_bytes:
                groups.append({"status": UNVERIFIED, "size": size, "paths": sorted(i[0] for i in items)})
            else:
                by_full = defaultdict(list)
                for path, mtime, full, part in items:
                    if full is None:
                        try:
                            full = full_hash(path)
                        except OSError as e:
                            fail(path, e)
                            continue
                        store.put_hash(path, size, mtime, part, full)
                    by_full[full].append(path)
                for paths in by_full.values():
                    if len(paths) >= 2:
                        groups.append({"status": CONFIRMED, "size": size, "paths": sorted(paths)})
        store.commit()
    if progress:
        progress("ハッシュ計算", done, total, final=True)
    groups.sort(key=lambda g: (-(len(g["paths"]) - 1) * g["size"], g["paths"][0]))
    for i, g in enumerate(groups, 1):
        g["id"] = i
        g["wasted"] = (len(g["paths"]) - 1) * g["size"]
    return groups

