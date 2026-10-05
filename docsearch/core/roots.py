"""検索対象フォルダ（root）の管理: 設定ファイルの roots と、画面・--add で後から選んだ roots をまとめて扱う。

選んだフォルダ以下だけを検索対象にし、親フォルダは対象に入れない。入れ子の root は、上位のものにまとめて二重登録を防ぐ。
"""
import json
import os

from . import db
from .pathutil import path_variants


def _norm(p):
    """大文字小文字・区切り文字を揃えた比較用の文字列。"""
    return os.path.normcase(os.path.normpath(p))


def _with_sep(p):
    """末尾に区切り文字を付けた文字列（前方一致で、似た名前の兄弟フォルダを誤って含めないため）。"""
    return p if p.endswith(os.sep) else p + os.sep


def relative_to(child, parent):
    """child が parent の中（または同じ）なら、parent からの相対パス（「/」区切り。同じなら空文字）を返す。外なら None。

    ドライブ文字（V:\\\\…）とUNC（\\\\\\\\サーバ\\\\共有\\\\…）、リンクの違いは、実体のパスに直して照合する。
    """
    for cv in path_variants(child):
        for pv in path_variants(parent):
            if _norm(cv) == _norm(pv):
                return ""
            pp = _with_sep(pv)  # 区切り文字まで含めて比べる（_norm は末尾の区切りを消すので使わない）
            if os.path.normcase(cv).startswith(os.path.normcase(pp)):
                return cv[len(pp):].replace("\\", "/")
    return None


def is_within(child, parent, strict=False):
    """child が parent の中にあるか。strict=True なら、同じフォルダは含めない。"""
    rel = relative_to(child, parent)
    return rel is not None and not (strict and rel == "")


def effective_roots(roots):
    """roots から、重複と、他の root の中にある root（入れ子）を除いたリストを返す（上位のフォルダだけ残す）。"""
    out = []
    for r in roots:
        r = os.path.normpath(r)
        if any(is_within(r, o) for o in out):
            continue
        out = [o for o in out if not is_within(o, r)]
        out.append(r)
    return out


def _load(conn, key):
    """meta から、パスのリスト（JSON）を読む。"""
    v = db.get_meta(conn, key)
    try:
        return [x for x in json.loads(v) if isinstance(x, str)] if v else []
    except ValueError:
        return []


def _save(conn, key, lst):
    """meta に、パスのリスト（JSON）を保存する（コミットは呼び出し側）。"""
    db.set_meta(conn, key, json.dumps(lst, ensure_ascii=False))


def load_extra_roots(conn):
    """画面や --add で追加した root の一覧。"""
    return _load(conn, "extra_roots")


def all_roots(cfg, conn):
    """設定ファイルの roots と、後から追加した roots をまとめた、入れ子のない一覧。"""
    return effective_roots(list(cfg.roots) + load_extra_roots(conn))


def incomplete_roots(conn):
    """インデックス作成が最後まで終わっていない（中止・失敗した）root の一覧。"""
    return _load(conn, "incomplete_roots")


def indexed_roots(conn):
    """検索に使える（インデックス作成が完了している）root の一覧。

    登録されたファイルを持つ root と、画面・--add で追加した root（対象の文書が1つも無いフォルダも含む）のうち、
    作成が未完了のものを除く。
    """
    bad = {_norm(r) for r in incomplete_roots(conn)}
    out, seen = [], set()
    for r in [x for (x,) in conn.execute("SELECT DISTINCT root FROM files ORDER BY root")] + load_extra_roots(conn):
        if _norm(r) not in bad and _norm(r) not in seen:
            seen.add(_norm(r))
            out.append(r)
    return out


def scopes_for(folder, roots):
    """選んだフォルダ以下を検索するための条件 [(root, 相対パスの接頭辞)] と、完全にカバーされているか（covered）を返す。

    covered は、folder が（インデックス済みの）root の中、または同じであること。
    folder が root を含むだけ（folder の他の部分は未登録）の場合は、covered=False。
    """
    scopes, covered = [], False
    for r in roots:
        rel = relative_to(folder, r)
        if rel is not None:
            scopes.append((r, rel))
            covered = True
        elif is_within(r, folder):
            scopes.append((r, ""))
    return scopes, covered


def add_root(conn, folder, cfg_roots=()):
    """folder を検索対象に追加する準備をする。folder の中にある既存の root の登録を、二重にならないよう削除する。

    戻り値は、まとめた（登録を削除した）root のリスト。インデックス作成が終わるまで incomplete 扱いにする。
    """
    folder = os.path.normpath(folder)
    absorbed = [r for (r,) in conn.execute("SELECT DISTINCT root FROM files") if r != folder and is_within(r, folder, strict=True)]
    with conn:
        for r in absorbed:
            for (fid,) in conn.execute("SELECT id FROM files WHERE root=?", (r,)).fetchall():
                db.delete_file(conn, fid)
        extra = [r for r in load_extra_roots(conn) if not is_within(r, folder, strict=True)]
        covered_by_cfg = any(_norm(r) == _norm(folder) for r in cfg_roots)
        if not covered_by_cfg and not any(_norm(r) == _norm(folder) for r in extra):
            extra.append(folder)
        _save(conn, "extra_roots", extra)
        inc = [r for r in incomplete_roots(conn) if not is_within(r, folder, strict=True)]
        if not any(_norm(r) == _norm(folder) for r in inc):
            inc.append(folder)
        _save(conn, "incomplete_roots", inc)
    return absorbed


def clear_incomplete(conn, roots):
    """roots のインデックス作成が完了したことを記録する。"""
    done = {_norm(r) for r in roots}
    with conn:
        _save(conn, "incomplete_roots", [r for r in incomplete_roots(conn) if _norm(r) not in done])
