"""SQLite（FTS5 trigram）の起動時チェック、スキーマ、接続、ファイル単位の登録・削除。"""
import os
import sqlite3
from pathlib import Path

SCHEMA_VERSION = "1"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY,
  root TEXT NOT NULL,
  relpath TEXT NOT NULL,          -- 「/」区切り
  ext TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime_ns INTEGER NOT NULL,
  status TEXT NOT NULL,           -- ok / error / excluded
  sig TEXT NOT NULL DEFAULT '',   -- 抽出設定の署名
  indexed_at TEXT,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(root, relpath)
);
CREATE TABLE IF NOT EXISTS issues(
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS issues_file ON issues(file_id);
CREATE TABLE IF NOT EXISTS chunks(
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL,
  location TEXT NOT NULL,
  text TEXT NOT NULL              -- 正規化後の本文（場所ごと）
);
CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_id);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, content='chunks', content_rowid='id', tokenize='trigram'
);
"""


class EnvError(Exception):
    """実行環境（SQLite）の問題。利用者向けの日本語メッセージ。別方式への自動切替はしない。"""


class DbError(Exception):
    """index.db に関する問題。利用者向けの日本語メッセージ。"""


def check_environment():
    """SQLite のバージョンと FTS5・trigram の利用可否を確認する。使えなければ EnvError。

    使えない場合に別方式（LIKE のみ等）へ勝手に切り替えない。判断を仰ぐために停止する。
    戻り値は sqlite3.sqlite_version。
    """
    ver = sqlite3.sqlite_version
    stop = ("\nこのツールは FTS5 の trigram トークナイザ（SQLite 3.34 以降）を前提にしており、"
            "別の検索方式へは自動で切り替えません。作成者に状況（下記のバージョンとエラー）を伝えて、方針を相談してください。")
    parts = tuple(int(x) for x in ver.split(".")[:3])
    if parts < (3, 34, 0):
        raise EnvError("SQLite のバージョンが古く（%s）、trigram トークナイザを使えません。" % ver + stop)
    try:
        c = sqlite3.connect(":memory:")
        try:
            c.execute("CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')")
            c.execute("INSERT INTO t VALUES('テスト文書')")
            if c.execute("SELECT count(*) FROM t WHERE t MATCH '\"スト文\"'").fetchone()[0] != 1:
                raise EnvError("FTS5 の trigram で日本語の部分一致が動作しませんでした（SQLite %s）。" % ver + stop)
        finally:
            c.close()
    except sqlite3.OperationalError as e:
        raise EnvError("この Python の SQLite（%s）では FTS5 または trigram を使えません（%s）。" % (ver, e) + stop)
    return ver


def connect_rw(db_path, create=True):
    """index.db を読み書きで開く（create=True なら新規作成）。スキーマ版が違えば DbError。"""
    parent = os.path.dirname(os.path.abspath(db_path))
    if not os.path.isdir(parent):
        raise DbError("index.db の保存先フォルダ「%s」がありません。config.toml の db_path を確認してください。" % parent)
    if not create and not os.path.isfile(db_path):
        raise DbError("index.db「%s」がありません。先に index.py でインデックスを作成してください。" % db_path)
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("PRAGMA foreign_keys=OFF")
        conn.executescript(_SCHEMA)
        row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        if row is None:
            conn.execute("INSERT INTO meta VALUES('schema_version', ?)", (SCHEMA_VERSION,))
            conn.commit()
        elif row[0] != SCHEMA_VERSION:
            conn.close()
            raise DbError("index.db のスキーマ版（%s）がこのツール（%s）と一致しません。index.db を削除して作り直してください。"
                          % (row[0], SCHEMA_VERSION))
    except sqlite3.DatabaseError as e:
        raise DbError("index.db「%s」を開けません（%s）。壊れている可能性があります。削除して index.py で作り直してください。" % (db_path, e))
    return conn


def connect_ro(db_path):
    """index.db を読み取り専用で開く（検索用。DBを変更しない）。無ければ DbError。"""
    if not os.path.isfile(db_path):
        raise DbError("index.db「%s」がありません。先に index.py でインデックスを作成してください。" % db_path)
    try:
        try:
            conn = sqlite3.connect(Path(os.path.abspath(db_path)).as_uri() + "?mode=ro", uri=True)
        except sqlite3.OperationalError:
            conn = sqlite3.connect(db_path)
            conn.execute("PRAGMA query_only=ON")
        row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
    except sqlite3.DatabaseError as e:
        raise DbError("index.db「%s」を開けません（%s）。壊れている可能性があります。" % (db_path, e))
    if not row or row[0] != SCHEMA_VERSION:
        conn.close()
        raise DbError("index.db のスキーマ版がこのツールと一致しません。index.db を削除して作り直してください。")
    return conn


def get_meta(conn, key, default=None):
    """meta テーブルの値を返す。"""
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def set_meta(conn, key, value):
    """meta テーブルに値を保存する（コミットは呼び出し側）。"""
    conn.execute("INSERT INTO meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def delete_file(conn, file_id):
    """ファイル1件分の chunks・FTS索引・issues・files の行を削除する（コミットは呼び出し側）。

    外部コンテンツ方式の FTS は、削除時に登録時と同じ本文を渡す必要があるため、
    chunks を消す前に 'delete' コマンドで索引から外す。
    """
    conn.execute("INSERT INTO chunks_fts(chunks_fts, rowid, text) SELECT 'delete', id, text FROM chunks WHERE file_id=?",
                 (file_id,))
    conn.execute("DELETE FROM chunks WHERE file_id=?", (file_id,))
    conn.execute("DELETE FROM issues WHERE file_id=?", (file_id,))
    conn.execute("DELETE FROM files WHERE id=?", (file_id,))


def insert_file(conn, root, relpath, ext, size, mtime_ns, status, sig, chunks, issues, truncated, indexed_at):
    """ファイル1件分の行・本文チャンク・issues を登録し、FTS索引に載せる（コミットは呼び出し側）。

    chunks は [(場所, 正規化済み本文)]、issues は [(種別, 場所, 詳細)]。
    """
    cur = conn.execute(
        "INSERT INTO files(root,relpath,ext,size,mtime_ns,status,sig,indexed_at,chunk_count,truncated) "
        "VALUES(?,?,?,?,?,?,?,?,?,?)",
        (root, relpath, ext, size, mtime_ns, status, sig, indexed_at, len(chunks), int(truncated)))
    fid = cur.lastrowid
    if chunks:
        conn.executemany("INSERT INTO chunks(file_id,location,text) VALUES(?,?,?)", [(fid, loc, t) for loc, t in chunks])
        conn.execute("INSERT INTO chunks_fts(rowid, text) SELECT id, text FROM chunks WHERE file_id=?", (fid,))
    if issues:
        conn.executemany("INSERT INTO issues(file_id,kind,location,detail) VALUES(?,?,?,?)",
                         [(fid, k, loc, d) for k, loc, d in issues])
    return fid


def check_integrity(conn):
    """FTS索引と chunks（外部コンテンツ）の整合性、およびDB全体の整合性を確認する。

    戻り値は (正常なら True, メッセージ)。FTS5 の integrity-check（rank=1）は
    索引の内容が外部テーブルの内容と一致しているかまで検証する。
    """
    try:
        conn.execute("INSERT INTO chunks_fts(chunks_fts, rank) VALUES('integrity-check', 1)")
        res = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if res != "ok":
            return False, "DBの整合性エラー: %s" % res
    except sqlite3.DatabaseError as e:
        return False, "FTS索引の整合性エラー: %s" % e
    return True, "整合性に問題はありません"


def rebuild_fts(conn):
    """FTS索引を chunks から作り直す（整合性エラーの修復用）。"""
    conn.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')")
    conn.commit()
