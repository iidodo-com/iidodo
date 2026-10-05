"""検索の実行: FTS5(trigram) と LIKE を使い分け、bm25／更新日順・ファイル単位／場所単位に対応する。"""
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime, time as dtime, timedelta

from .query import QueryError, fts_phrase, is_long, like_pattern, parse_query
from .roots import scopes_for


@dataclass
class SearchOptions:
    exts: list = None          # 例 ["docx","pdf"]（None は全部）
    folder: str = ""           # サブフォルダ名（相対パスの先頭一致。どの root でも一致）
    scopes: list = None        # [(root, 相対パスの接頭辞)]（選んだフォルダ以下。None は全部）
    since_ns: int = None       # この更新日時（ns）以降
    until_ns: int = None       # この更新日時（ns）より前
    limit: int = 50
    sort: str = "relevance"    # relevance / date
    scope: str = "file"        # file（ファイル内）/ place（同じ場所内）
    snippet_chars: int = 60


@dataclass
class SearchResult:
    root: str
    relpath: str
    ext: str
    location: str
    mtime_ns: int
    snippet: str
    spans: list                # スニペット内の強調範囲 [(開始, 終了)]
    score: float = None        # bm25（小さいほど関連度が高い）。LIKEのみの検索では None
    place_hits: int = 1        # ファイル単位のとき、該当した場所の数

    @property
    def fullpath(self):
        """画面表示・コピー用の通常形式のフルパス。"""
        return os.path.normpath(os.path.join(self.root, *self.relpath.split("/")))

    @property
    def name(self):
        """ファイル名。"""
        return self.relpath.rsplit("/", 1)[-1]

    @property
    def folder(self):
        """相対パスのフォルダ部分。"""
        return self.relpath.rsplit("/", 1)[0] if "/" in self.relpath else ""

    @property
    def mtime_text(self):
        """更新日時（ローカル時刻）の文字列。"""
        return datetime.fromtimestamp(self.mtime_ns / 1e9).strftime("%Y-%m-%d %H:%M")


@dataclass
class SearchOutcome:
    results: list = field(default_factory=list)
    total: int = 0                      # limit 適用前の該当数（ファイル単位ならファイル数、場所単位なら場所数）
    notices: list = field(default_factory=list)
    full_scan: bool = False             # 全語が3文字未満で、LIKEの全件走査になった
    like_used: bool = False             # 3文字未満の語を LIKE で処理した
    sort_used: str = "relevance"
    positives: list = field(default_factory=list)
    negatives: list = field(default_factory=list)


def parse_date_text(text, label):
    """YYYY-MM-DD（または YYYY/MM/DD）を date にする。空なら None。誤りは QueryError（日本語）。"""
    t = (text or "").strip()
    if not t:
        return None
    try:
        return datetime.strptime(t.replace("/", "-"), "%Y-%m-%d").date()
    except ValueError:
        raise QueryError("%sの日付「%s」を読めません。2024-04-01 の形式（年-月-日）で入力してください。" % (label, t))


def _day_start_ns(d):
    """その日の0時（ローカル時刻）を ns で返す。"""
    return int(datetime.combine(d, dtime.min).timestamp() * 1e9)


def build_options(exts="", folder="", since="", until="", limit=50, sort="relevance", scope="file", snippet_chars=60, roots=None):
    """画面・コマンドラインの文字列入力から SearchOptions を作る。誤りは QueryError（日本語）。

    folder は、サブフォルダ名（相対）でも、フォルダの絶対パスでもよい。絶対パスのときは、roots（インデックス済みの
    root の一覧）の中にあることが必要で、そのフォルダ以下だけを検索する（親は含めない）。
    """
    folder = (folder or "").strip()
    scopes = None
    is_abs = os.path.isabs(folder) or folder.startswith(("\\\\", "//")) or (len(folder) > 2 and folder[1] == ":")
    if folder and is_abs:
        scopes, covered = scopes_for(os.path.normpath(folder), roots or [])
        if not covered:
            raise QueryError("フォルダ「%s」は、まだインデックスされていません。検索画面の「選択…」で選ぶ（インデックスを作成できます）か、"
                             "python index.py --add \"フォルダ\" を実行してください。" % folder)
        folder = ""
    ext_list = [e.strip().lstrip(".").lower() for e in (exts or "").replace("、", ",").split(",") if e.strip()]
    bad = [e for e in ext_list if e not in ("docx", "xlsx", "pptx", "pdf")]
    if bad:
        raise QueryError("拡張子「%s」は指定できません。docx, xlsx, pptx, pdf から、カンマ区切りで指定してください。" % "、".join(bad))
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        raise QueryError("表示件数（--limit）は整数で指定してください。")
    if limit < 1:
        raise QueryError("表示件数（--limit）は1以上で指定してください。")
    if sort not in ("relevance", "date"):
        raise QueryError("並び順は relevance（関連度）か date（更新日の新しい順）で指定してください。")
    if scope not in ("file", "place"):
        raise QueryError("AND の範囲は file（ファイル内）か place（同じ場所内）で指定してください。")
    s, u = parse_date_text(since, "開始"), parse_date_text(until, "終了")
    if s and u and s > u:
        raise QueryError("期間の開始日（%s）が終了日（%s）より後になっています。" % (s, u))
    return SearchOptions(
        exts=ext_list or None, folder=folder, scopes=scopes,
        since_ns=_day_start_ns(s) if s else None,
        until_ns=_day_start_ns(u + timedelta(days=1)) if u else None,
        limit=limit, sort=sort, scope=scope, snippet_chars=snippet_chars)


def _file_filter(opts, params):
    """files テーブル（別名 f）への絞り込み条件（SQL片）を作り、params に値を入れる。"""
    w = ["f.status='ok'"]
    if opts.exts:
        keys = []
        for i, e in enumerate(opts.exts):
            params["e%d" % i] = e
            keys.append(":e%d" % i)
        w.append("f.ext IN (%s)" % ",".join(keys))
    if opts.scopes:
        conds = []
        for i, (root, prefix) in enumerate(opts.scopes):
            params["sr%d" % i] = root
            prefix = prefix.replace("\\", "/").strip("/")
            if prefix:
                params["sp%d" % i] = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "/%"
                conds.append("(f.root=:sr%d AND f.relpath LIKE :sp%d ESCAPE '\\')" % (i, i))
            else:
                conds.append("f.root=:sr%d" % i)
        w.append("(" + " OR ".join(conds) + ")")
    if opts.folder:
        fo = opts.folder.replace("\\", "/").strip("/")
        if fo:
            params["fo"] = fo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "/%"
            w.append("f.relpath LIKE :fo ESCAPE '\\'")
    if opts.since_ns is not None:
        params["since"] = opts.since_ns
        w.append("f.mtime_ns >= :since")
    if opts.until_ns is not None:
        params["until"] = opts.until_ns
        w.append("f.mtime_ns < :until")
    return " AND ".join(w)


def make_snippet(text, terms, width):
    """本文（正規化後）から、最初に見つかった検索語の前後 width 文字を切り出し、強調範囲を返す。"""
    first, firstlen = None, 0
    for t in terms:
        p = text.find(t)
        if p >= 0 and (first is None or p < first):
            first, firstlen = p, len(t)
    if first is None:
        first, firstlen = 0, 0
    s, e = max(0, first - width), min(len(text), first + firstlen + width)
    pre = "…" if s > 0 else ""
    body = pre + text[s:e] + ("…" if e < len(text) else "")
    spans = []
    for t in terms:
        k = body.find(t, len(pre))
        while k >= 0 and k < len(pre) + (e - s):
            spans.append((k, k + len(t)))
            k = body.find(t, k + max(1, len(t)))
    spans.sort()
    merged = []
    for a, b in spans:
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    return body, merged


def search(conn, raw_query, opts):
    """検索を実行して SearchOutcome を返す。検索式の誤りは QueryError（日本語）。

    3文字以上の語は FTS5(trigram) の MATCH、3文字未満の語は LIKE（全件走査になりうる）で処理する。
    """
    pq = parse_query(raw_query)
    out = SearchOutcome(positives=pq.positives, negatives=pq.negatives, sort_used=opts.sort)
    longs = [t for t in pq.positives if is_long(t)]
    shorts = [t for t in pq.positives if not is_long(t)]
    out.like_used = bool(shorts) or any(not is_long(t) for t in pq.negatives)
    if not longs:
        out.full_scan = True
        out.notices.append("検索語が3文字未満のため、LIKE による検索に切り替えました。全件走査のため時間がかかる場合があります。")
    elif out.like_used:
        out.notices.append("3文字未満の語は LIKE で判定しました（3文字以上の語で絞り込んだ結果に対して行うため、全件走査にはなりません）。")
    if opts.sort == "relevance" and not longs:
        out.sort_used = "date"
        out.notices.append("3文字以上の検索語がないため bm25（関連度）を計算できません。更新日の新しい順で表示します。")
    if opts.scope == "place":
        _search_place(conn, pq, longs, shorts, opts, out)
    else:
        _search_file(conn, pq, longs, shorts, opts, out)
    return out


def _search_place(conn, pq, longs, shorts, opts, out):
    """「同じ場所内」: 1つの場所（段落・セル・スライド・ページ）が全条件を満たすものを探す。"""
    params = {}
    where = [_file_filter(opts, params)]
    if longs:
        frm = "chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid JOIN files f ON f.id=c.file_id"
        params["m"] = " AND ".join(fts_phrase(t) for t in longs)
        where.append("chunks_fts MATCH :m")
        score = "bm25(chunks_fts)"
    else:
        frm = "chunks c JOIN files f ON f.id=c.file_id"
        score = "NULL"
    for i, t in enumerate(shorts):
        params["s%d" % i] = like_pattern(t)
        where.append("c.text LIKE :s%d ESCAPE '\\'" % i)
    nl = [t for t in pq.negatives if is_long(t)]
    if nl:
        params["nm"] = " OR ".join(fts_phrase(t) for t in nl)
        where.append("c.id NOT IN (SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH :nm)")
    for i, t in enumerate([t for t in pq.negatives if not is_long(t)]):
        params["ns%d" % i] = like_pattern(t)
        where.append("c.text NOT LIKE :ns%d ESCAPE '\\'" % i)
    w = " AND ".join(where)
    out.total = conn.execute("SELECT count(*) FROM %s WHERE %s" % (frm, w), params).fetchone()[0]
    if out.sort_used == "relevance" and longs:
        order = "score ASC, f.mtime_ns DESC, f.relpath, c.id"
    else:
        order = "f.mtime_ns DESC, f.relpath, c.id"
    params["limit"] = opts.limit
    sql = ("SELECT f.root, f.relpath, f.ext, f.mtime_ns, c.location, c.text, %s AS score FROM %s WHERE %s "
           "ORDER BY %s LIMIT :limit" % (score, frm, w, order))
    for root, rel, ext, mt, loc, text, sc in conn.execute(sql, params):
        snip, spans = make_snippet(text, pq.positives, opts.snippet_chars)
        out.results.append(SearchResult(root, rel, ext, loc, mt, snip, spans, sc, 1))


def _file_ids_for_term(conn, term, restrict=None):
    """語を含む場所を持つファイルID集合。3文字以上は FTS、未満は LIKE（restrict があればそのファイルだけを走査）。"""
    if is_long(term):
        rows = conn.execute("SELECT DISTINCT c.file_id FROM chunks c WHERE c.id IN "
                            "(SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?)", (fts_phrase(term),))
    elif restrict is None:
        rows = conn.execute("SELECT DISTINCT file_id FROM chunks WHERE text LIKE ? ESCAPE '\\'", (like_pattern(term),))
    else:
        conn.execute("DROP TABLE IF EXISTS temp.cur")
        conn.execute("CREATE TEMP TABLE cur(fid INTEGER PRIMARY KEY)")
        conn.executemany("INSERT INTO temp.cur VALUES(?)", [(i,) for i in restrict])
        rows = conn.execute("SELECT DISTINCT c.file_id FROM chunks c WHERE c.file_id IN (SELECT fid FROM temp.cur) "
                            "AND c.text LIKE ? ESCAPE '\\'", (like_pattern(term),))
    return {r[0] for r in rows}


def _search_file(conn, pq, longs, shorts, opts, out):
    """「ファイル内」: 各検索語が、そのファイルのどこかにあれば該当（除外語は、どこかにあれば除外）。

    並び順（関連度）はファイルごとの最良（最小）bm25。表示する場所は、検索語を最も多く含む場所
    （同数なら bm25 が良い場所、それも同じならファイル内の先頭）。
    """
    params = {}
    cand = {r[0]: r[1] for r in conn.execute("SELECT f.id, f.mtime_ns FROM files f WHERE %s" % _file_filter(opts, params), params)}
    ids = set(cand)
    for t in longs:  # 3文字以上は FTS で絞り込む
        if not ids:
            break
        ids &= _file_ids_for_term(conn, t)
    for t in shorts:  # 3文字未満は、残った候補のファイルだけを LIKE で走査する
        if not ids:
            break
        ids &= _file_ids_for_term(conn, t, restrict=ids)
    for t in pq.negatives:
        if not ids:
            break
        ids -= _file_ids_for_term(conn, t, restrict=ids) if not is_long(t) else _file_ids_for_term(conn, t)
    out.total = len(ids)
    if not ids:
        return
    best_score = {}
    chunk_score = {}
    conn.execute("DROP TABLE IF EXISTS temp.cand")
    conn.execute("CREATE TEMP TABLE cand(fid INTEGER PRIMARY KEY)")
    conn.executemany("INSERT INTO temp.cand VALUES(?)", [(i,) for i in ids])
    or_expr = " OR ".join(fts_phrase(t) for t in longs)
    if longs:
        for fid, cid, sc in conn.execute(
                "SELECT c.file_id, c.id, bm25(chunks_fts) FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.rowid "
                "WHERE chunks_fts MATCH ? AND c.file_id IN (SELECT fid FROM temp.cand)", (or_expr,)):
            chunk_score[cid] = sc
            if fid not in best_score or sc < best_score[fid]:
                best_score[fid] = sc
    if out.sort_used == "relevance" and longs:
        order = sorted(ids, key=lambda i: (best_score.get(i, 0), -cand[i], i))
    else:
        order = sorted(ids, key=lambda i: (-cand[i], i))
    top = order[:opts.limit]
    conn.execute("DELETE FROM temp.cand")
    conn.executemany("INSERT INTO temp.cand VALUES(?)", [(i,) for i in top])
    like_sql = "".join(" OR c.text LIKE ? ESCAPE '\\'" for _ in shorts)
    sql = ("SELECT c.id, c.file_id, c.location, c.text FROM chunks c WHERE c.file_id IN (SELECT fid FROM temp.cand) AND ("
           + ("c.id IN (SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?)" if longs else "0") + like_sql + ") ORDER BY c.id")
    args = ([or_expr] if longs else []) + [like_pattern(t) for t in shorts]
    by_file = {}
    for cid, fid, loc, text in conn.execute(sql, args):
        by_file.setdefault(fid, []).append((cid, loc, text))
    meta = {r[0]: r[1:] for r in conn.execute(
        "SELECT id, root, relpath, ext, mtime_ns FROM files WHERE id IN (SELECT fid FROM temp.cand)")}
    for fid in top:
        chunks = by_file.get(fid, [])
        if not chunks:
            continue

        def rank(ch):
            """表示する場所の優先度: 含む語の種類が多い → bm25が良い → ファイル内で先頭。"""
            hit = sum(1 for t in pq.positives if t in ch[2])
            return (-hit, chunk_score.get(ch[0], float("inf")), ch[0])
        cid, loc, text = min(chunks, key=rank)
        snip, spans = make_snippet(text, pq.positives, opts.snippet_chars)
        root, rel, ext, mt = meta[fid]
        out.results.append(SearchResult(root, rel, ext, loc, mt, snip, spans, best_score.get(fid), len(chunks)))
    conn.execute("DROP TABLE IF EXISTS temp.cand")
