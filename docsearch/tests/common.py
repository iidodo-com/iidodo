"""テスト共通: ダミー文書の生成（1回だけ）、設定・DBの作成、読み取り専用の確認用スナップショット。"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import generate_sample  # noqa: E402
import verify  # noqa: E402
from core import db  # noqa: E402
from core.indexer import run_index  # noqa: E402

_cache = {}


def shared_verification():
    """生成→取り込み→評価を1回だけ実行して、全テストで共有する。"""
    if "r" not in _cache:
        work = tempfile.mkdtemp(prefix="docsearch_test_")
        _cache["work"] = work
        _cache["r"] = verify.run_verification(os.path.join(work, "v"))
    return _cache["r"]


def fresh_sample(tmp):
    """tmp 配下に、独立したダミー文書とインデックスを作る。(work, exp, cfg, conn) を返す。"""
    work = os.path.join(tmp, "w")
    exp = generate_sample.generate(work, quiet=True)
    cfg = verify.make_config(work)
    conn = db.connect_rw(cfg.db_path)
    return work, exp, cfg, conn


def snapshot(root):
    """フォルダ内の全エントリの (相対パス, 種別, サイズ, 更新日時ns, リンク先) を辞書で返す。読み取り専用の確認用。"""
    snap = {}
    for dp, dns, fns in os.walk(root, followlinks=False):
        for n in dns + fns:
            p = os.path.join(dp, n)
            st = os.lstat(p)
            snap[os.path.relpath(p, root)] = (
                "link" if os.path.islink(p) else "dir" if os.path.isdir(p) else "file",
                st.st_size, st.st_mtime_ns, os.readlink(p) if os.path.islink(p) else None)
    return snap
