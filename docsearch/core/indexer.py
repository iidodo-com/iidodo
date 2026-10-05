"""インデックス作成: 差分更新・中断再開・削除反映。対象フォルダのファイルは読み取り（rb）のみ。"""
import os
import time
from dataclasses import dataclass, field
from datetime import datetime

from . import db
from .extract import ExtractError, extract
from .kinds import KIND_ERROR, STATUS_ERROR, STATUS_EXCLUDED, STATUS_OK
from .pathutil import read_bytes
from .scanner import check_root, scan_root


@dataclass
class IndexStats:
    """インデックス作成の結果。processed は今回実際に処理（再読込）した相対パス。"""
    total_targets: int = 0
    processed: list = field(default_factory=list)
    skipped_unchanged: int = 0
    deleted: list = field(default_factory=list)
    delete_blocked: int = 0
    errors: int = 0
    other_ext: int = 0
    pattern_excluded: int = 0
    elapsed: float = 0.0


def _mass_delete_blocked(cfg, allow, existing_count, delete_count):
    """削除が「大量」で安全装置に引っかかるか。10件以上のインデックスで、半数を超える削除は止める。"""
    return cfg.mass_delete_guard and not allow and existing_count >= 10 and delete_count > existing_count * 0.5


def _now():
    """現在時刻の文字列（ISO形式）。"""
    return datetime.now().isoformat(timespec="seconds")


def run_index(cfg, conn, progress=None, retry_errors=False, allow_mass_delete=False, roots=None):
    """cfg.roots を走査して index.db を更新し、IndexStats を返す。

    progress(done, total, elapsed, current) は1ファイルごとに呼ばれる（done は変更なしで飛ばした分を含む）。
    途中で中断（例外）しても、完了したファイルは1ファイル＝1トランザクションで保存済みなので、
    次回は同じ判定（パス・サイズ・更新日時・抽出設定が同じなら飛ばす）で続きから再開できる。
    roots を指定したときは、そのフォルダだけを走査し、ほかの root の登録には触れない（画面から1フォルダを追加するとき）。
    省略時は cfg.roots 全体を走査し、cfg.roots に無い root の登録は「消えたもの」として削除する（安全装置つき）。
    """
    t0 = time.time()
    stats = IndexStats()
    scan_roots = list(roots) if roots is not None else list(cfg.roots)
    for r in scan_roots:
        check_root(r)  # 1つでも到達できなければ、何も変更せず中止（削除と誤認しない）
    sig = cfg.extract_signature()
    entries, protected = [], []
    for r in scan_roots:
        res = scan_root(r, cfg)
        entries.extend(res.entries)
        stats.other_ext += res.other_ext_count
        stats.pattern_excluded += res.pattern_excluded
    for e in entries:
        if e.kind == "scanerror":
            protected.append((e.root, e.relpath))

    existing = {}
    for row in conn.execute("SELECT id,root,relpath,size,mtime_ns,status,sig FROM files"):
        if roots is None or row[1] in scan_roots:
            existing[(row[1], row[2])] = row
    seen = {(e.root, e.relpath) for e in entries}

    # 削除の反映（読めなかったフォルダ配下は、消えたと断定できないので残す）
    def under_error(key):
        for root, rel in protected:
            if key[0] == root and (rel == "." or key[1] == rel or key[1].startswith(rel + "/")):
                return True
        return False

    gone = [k for k in existing if k not in seen and not under_error(k)]
    if gone:
        if _mass_delete_blocked(cfg, allow_mass_delete, len(existing), len(gone)):
            stats.delete_blocked = len(gone)
        else:
            with conn:
                for k in gone:
                    db.delete_file(conn, existing[k][0])
                    stats.deleted.append(k[1])

    # 対象外・走査エラーは、ファイルを読まないので毎回書き直す（設定変更が即反映される）
    with conn:
        for e in entries:
            if e.kind in ("target",):
                continue
            row = existing.get((e.root, e.relpath))
            if row:
                db.delete_file(conn, row[0])
            db.insert_file(conn, e.root, e.relpath, e.ext, e.size, e.mtime_ns, STATUS_EXCLUDED, sig, [],
                           [(e.issue_kind, "", e.detail)], False, _now())

    targets = [e for e in entries if e.kind == "target"]
    stats.total_targets = len(targets)
    todo = []
    for e in targets:
        row = existing.get((e.root, e.relpath))
        same = row and row[3] == e.size and row[4] == e.mtime_ns and row[6] == sig
        if same and (row[5] == STATUS_OK or (row[5] == STATUS_ERROR and not retry_errors)):
            stats.skipped_unchanged += 1
        else:
            todo.append(e)

    done = stats.skipped_unchanged
    for e in todo:
        if progress:
            progress(done, stats.total_targets, time.time() - t0, e.relpath)
        _process_one(cfg, conn, e, existing.get((e.root, e.relpath)), sig, stats)
        done += 1
    if progress:
        progress(done, stats.total_targets, time.time() - t0, "")
    with conn:
        db.set_meta(conn, "last_index_at", _now())
    stats.elapsed = time.time() - t0
    return stats


def _process_one(cfg, conn, e, old_row, sig, stats):
    """ファイル1件を読み込み・抽出して、1トランザクションで登録する。失敗は種別つきで記録して続行する。"""
    full = os.path.join(e.root, *e.relpath.split("/"))
    chunks, issues, truncated, status = [], [], False, STATUS_OK
    try:
        data = read_bytes(full)
        ex = extract(e.ext, data, cfg)
        chunks, issues, truncated = ex.chunks, ex.issues, ex.truncated
    except ExtractError as x:
        status, issues = STATUS_ERROR, [(x.kind, "", x.detail)]
    except OSError as x:
        status = STATUS_ERROR
        issues = [(KIND_ERROR, "", "ファイルを開けません（%s）。他のアプリで使用中・アクセス権限・接続を確認してください。" % (x.strerror or x))]
    if status == STATUS_ERROR:
        stats.errors += 1
    with conn:  # 例外（Ctrl+C等）のときはロールバックされ、このファイルは未処理のまま残る
        if old_row:
            db.delete_file(conn, old_row[0])
        db.insert_file(conn, e.root, e.relpath, e.ext, e.size, e.mtime_ns, status, sig, chunks, issues, truncated, _now())
    stats.processed.append(e.relpath)
