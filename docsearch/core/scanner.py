"""対象フォルダの再帰走査。シンボリックリンク・ジャンクションは辿らない。読み取りのみ。"""
import fnmatch
import os
from dataclasses import dataclass

from .kinds import KIND_LEGACY, KIND_LINK, KIND_SCAN, KIND_SIZE
from .pathutil import fs_path, is_link


class RootError(Exception):
    """検索対象フォルダに到達できない。利用者向けの日本語メッセージ。"""


@dataclass
class Entry:
    """走査で見つけた1件。kind は target（取り込む）/ legacy / toolarge / link / scanerror。"""
    root: str
    relpath: str
    ext: str
    size: int
    mtime_ns: int
    kind: str
    detail: str = ""

    @property
    def issue_kind(self):
        """対象外・走査エラーの場合に issues へ記録する種別。"""
        return {"legacy": KIND_LEGACY, "toolarge": KIND_SIZE, "link": KIND_LINK, "scanerror": KIND_SCAN}.get(self.kind)


@dataclass
class ScanResult:
    entries: list
    other_ext_count: int = 0
    pattern_excluded: int = 0


def check_root(root):
    """検索対象フォルダが存在するか確認する。無ければ RootError（削除と誤認しないよう処理を止めるため）。"""
    if not os.path.isdir(fs_path(root)):
        raise RootError(
            "検索対象フォルダ「%s」にアクセスできません。共有フォルダの接続・ドライブ文字・パスの綴りを確認してください。"
            "（インデックスの内容を守るため、この状態では何も削除せず処理を中止しました）" % root)


def _excluded(name, relpath, patterns):
    """除外パターン（ファイル名・フォルダ名、または相対パス）に一致するか。大文字小文字は区別しない。"""
    n, r = name.lower(), relpath.lower()
    for p in patterns:
        pl = p.lower()
        if fnmatch.fnmatchcase(n, pl) or (("/" in pl or "\\" in pl) and fnmatch.fnmatchcase(r, pl.replace("\\", "/"))):
            return True
    return False


def _is_link_entry(ent):
    """DirEntry がリンク（シンボリックリンク・ジャンクション）か。

    ファイルは、ジャンクションにならないので追加のアクセスをしない（ネットワーク上のフォルダで、1件ごとの問い合わせを避ける）。
    ジャンクションの判定が必要なのは、フォルダだけ。
    """
    if ent.is_symlink():
        return True
    if not ent.is_dir(follow_symlinks=False):
        return False
    is_junction = getattr(ent, "is_junction", None)  # Python 3.12 以降。取得済みの情報から判定でき、追加のアクセスが要らない
    return is_junction() if is_junction else is_link(ent.path)


def scan_root(root, cfg, on_dir=None):
    """root 以下を走査して ScanResult を返す。権限エラー等は止まらず scanerror として記録する。

    on_dir(見つけたファイル数, 処理したフォルダの相対パス) は、フォルダを1つ処理するごとに呼ばれる（進捗表示用）。
    """
    targets = set(cfg.extensions)
    legacy = set(cfg.legacy_extensions)
    res = ScanResult(entries=[])
    stack = [""]
    found = 0
    while stack:
        rel_dir = stack.pop()
        if on_dir:
            on_dir(found, rel_dir)
        abs_dir = os.path.join(root, *rel_dir.split("/")) if rel_dir else root
        try:
            with os.scandir(fs_path(abs_dir)) as it:
                items = sorted(it, key=lambda e: e.name)
        except OSError as e:
            res.entries.append(Entry(root, rel_dir or ".", "", 0, 0, "scanerror",
                                     "フォルダを読めません（%s）。アクセス権限・接続を確認してください。" % e.strerror))
            continue
        for ent in items:
            name = ent.name
            rel = rel_dir + "/" + name if rel_dir else name
            if _excluded(name, rel, cfg.exclude_patterns):
                res.pattern_excluded += 1
                continue
            ext = os.path.splitext(name)[1][1:].lower()
            found += 1
            try:
                if _is_link_entry(ent):
                    # リンクは辿らない。対象拡張子のファイルとフォルダのリンクだけ「対象外(リンク)」として記録する
                    if ext in targets or ext in legacy or ent.is_dir(follow_symlinks=True):
                        st = ent.stat(follow_symlinks=False)
                        res.entries.append(Entry(root, rel, ext, 0, st.st_mtime_ns, "link",
                                                 "シンボリックリンク／ジャンクションのため辿りません"))
                    continue
                if ent.is_dir(follow_symlinks=False):
                    stack.append(rel)
                    continue
                if ext in targets or ext in legacy:
                    st = ent.stat(follow_symlinks=False)
                    if ext in legacy:
                        kind, detail = "legacy", "旧形式（.%s）は読めないため対象外です。新形式で保存し直すと検索できます" % ext
                    elif st.st_size > cfg.max_file_bytes:
                        kind, detail = "toolarge", "サイズ %.1fMB が上限 %sMB を超えています" % (st.st_size / 1048576, cfg.max_file_size_mb)
                    else:
                        kind, detail = "target", ""
                    res.entries.append(Entry(root, rel, ext, st.st_size, st.st_mtime_ns, kind, detail))
                else:
                    res.other_ext_count += 1
            except OSError as e:
                res.entries.append(Entry(root, rel, "", 0, 0, "scanerror", "ファイル情報を取得できません（%s）" % e.strerror))
    res.entries.sort(key=lambda e: e.relpath)
    return res
