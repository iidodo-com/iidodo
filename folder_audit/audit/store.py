"""途中結果を保存するSQLite一時ファイル（出力フォルダ内。対象フォルダには作らない）"""
from __future__ import annotations

import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY, dir TEXT, name TEXT, ext TEXT, size INTEGER, mtime REAL);
CREATE INDEX IF NOT EXISTS idx_files_size ON files(size);
CREATE INDEX IF NOT EXISTS idx_files_dir ON files(dir);
CREATE TABLE IF NOT EXISTS dirs (path TEXT PRIMARY KEY, depth INTEGER);
CREATE TABLE IF NOT EXISTS errors (
    path TEXT, kind TEXT, message TEXT, phase TEXT, PRIMARY KEY (path, kind));
CREATE TABLE IF NOT EXISTS hashes (
    path TEXT PRIMARY KEY, size INTEGER, mtime REAL, partial TEXT, full TEXT);
"""


class Store:
    """SQLiteの読み書きをまとめたクラス"""

    def __init__(self, path: str):
        """DBを開き、表がなければ作る"""
        self.path = path
        self.con = sqlite3.connect(path)
        self.con.executescript(SCHEMA)
        self.con.commit()

    def close(self) -> None:
        """変更を確定して閉じる"""
        self.con.commit()
        self.con.close()

    # ---- メタ情報 ----
    def get_meta(self, key, default=None):
        """メタ情報を1件取得する"""
        r = self.con.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return r[0] if r else default

    def set_meta(self, key, value) -> None:
        """メタ情報を1件保存する"""
        self.con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (key, str(value)))
        self.con.commit()

    # ---- 走査結果 ----
    def reset_scan(self) -> None:
        """走査結果を消す（ハッシュのキャッシュは残す）"""
        for t in ("files", "dirs"):
            self.con.execute(f"DELETE FROM {t}")
        self.con.execute("DELETE FROM errors")
        self.con.execute("DELETE FROM meta WHERE key IN ('scan_done','excluded_files','excluded_dirs')")
        self.con.commit()

    def add_files(self, rows) -> None:
        """ファイル行をまとめて追加する"""
        self.con.executemany("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?)", rows)

    def add_dirs(self, rows) -> None:
        """フォルダ行をまとめて追加する"""
        self.con.executemany("INSERT OR REPLACE INTO dirs VALUES (?,?)", rows)

    def add_errors(self, rows) -> None:
        """エラー行 (path, kind, message, phase) をまとめて追加する"""
        self.con.executemany("INSERT OR REPLACE INTO errors VALUES (?,?,?,?)", rows)

    def commit(self) -> None:
        """変更を確定する"""
        self.con.commit()

    # ---- 集計・取得 ----
    def totals(self):
        """(総ファイル数, 総容量, フォルダ数) を返す"""
        n, s = self.con.execute("SELECT COUNT(*), COALESCE(SUM(size),0) FROM files").fetchone()
        d = self.con.execute("SELECT COUNT(*) FROM dirs").fetchone()[0]
        return n, s, d

    def zero_byte_count(self) -> int:
        """0バイトファイルの件数"""
        return self.con.execute("SELECT COUNT(*) FROM files WHERE size=0").fetchone()[0]

    def iter_files_by_dir(self):
        """フォルダ・名前の順にファイルを返す (path, dir, name, ext, size, mtime)"""
        return self.con.execute(
            "SELECT path, dir, name, ext, size, mtime FROM files ORDER BY dir, name")

    def stale_files(self, cutoff_ts: float):
        """境界時刻より前に更新されたファイルを古い順に返す"""
        return self.con.execute(
            "SELECT dir, name, size, mtime FROM files WHERE mtime IS NOT NULL AND mtime < ? "
            "ORDER BY mtime, path", (cutoff_ts,)).fetchall()

    def folder_summary(self):
        """フォルダ別 (path, depth, 件数, 容量, 最古, 最新) を返す（直下のファイルのみ）"""
        return self.con.execute(
            "SELECT d.path, d.depth, COUNT(f.path), COALESCE(SUM(f.size),0), MIN(f.mtime), MAX(f.mtime) "
            "FROM dirs d LEFT JOIN files f ON f.dir = d.path GROUP BY d.path ORDER BY d.path").fetchall()

    def error_rows(self):
        """読み取り不可の一覧 (kind, path, message, phase) を返す"""
        return self.con.execute(
            "SELECT kind, path, message, phase FROM errors ORDER BY kind, path").fetchall()

    def error_counts(self):
        """エラー種別ごとの件数 [(kind, 件数)] を返す"""
        return self.con.execute(
            "SELECT kind, COUNT(*) FROM errors GROUP BY kind ORDER BY kind").fetchall()

    # ---- ハッシュ ----
    def duplicate_sizes(self):
        """同じサイズのファイルが2件以上ある、0より大きいサイズの一覧"""
        return [r[0] for r in self.con.execute(
            "SELECT size FROM files WHERE size > 0 GROUP BY size HAVING COUNT(*) > 1 ORDER BY size")]

    def files_of_size(self, size: int):
        """指定サイズのファイル [(path, mtime)] を返す"""
        return self.con.execute(
            "SELECT path, mtime FROM files WHERE size=? ORDER BY path", (size,)).fetchall()

    def count_same_size_files(self) -> int:
        """サイズ一致グループに入るファイルの総数（進捗表示用）"""
        return self.con.execute(
            "SELECT COUNT(*) FROM files WHERE size IN "
            "(SELECT size FROM files WHERE size > 0 GROUP BY size HAVING COUNT(*) > 1)").fetchone()[0]

    def get_hash(self, path, size, mtime):
        """保存済みハッシュ (partial, full) を返す。サイズ・更新日時が変わっていれば None"""
        r = self.con.execute(
            "SELECT size, mtime, partial, full FROM hashes WHERE path=?", (path,)).fetchone()
        if r and r[0] == size and r[1] == mtime:
            return r[2], r[3]
        return None

    def put_hash(self, path, size, mtime, partial, full) -> None:
        """ハッシュ結果を保存する"""
        self.con.execute("INSERT OR REPLACE INTO hashes VALUES (?,?,?,?,?)",
                         (path, size, mtime, partial, full))

    def file_info(self, path):
        """1ファイルの (size, mtime) を返す。なければ (None, None)"""
        r = self.con.execute("SELECT size, mtime FROM files WHERE path=?", (path,)).fetchone()
        return r if r else (None, None)
