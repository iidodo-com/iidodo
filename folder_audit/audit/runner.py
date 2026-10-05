"""実行本体：走査 → 判定 → Excel出力。対象フォルダには一切書き込まない"""
from __future__ import annotations

import datetime as dt
import os
import sys
import time
from dataclasses import dataclass

from . import checks, hasher, report, scanner
from .scanner import LINK_KIND
from .store import Store
from .util import cutoff_timestamp, years_before

WORK_DB_NAME = "inventory_work.sqlite"


class RunError(Exception):
    """利用者に伝えて終了するべき実行時エラー"""


@dataclass
class RunResult:
    xlsx_path: str
    summary: dict


class Progress:
    """進捗を画面に出す（同じ行を上書き）"""

    def __init__(self, out):
        """出力先を指定する"""
        self.out = out
        self.last = 0.0

    def __call__(self, stage, done, total=None, final=False):
        """0.5秒ごと（最終回は必ず）に処理済み件数を表示する"""
        now = time.monotonic()
        if not final and now - self.last < 0.5:
            return
        self.last = now
        t = f" / {total:,}" if total else ""
        self.out.write(f"\r[{stage}] {done:,}{t} 件処理済み" + ("\n" if final else ""))
        self.out.flush()


def _inside(child: str, parent: str) -> bool:
    """child が parent の内側（同一含む）なら True"""
    c = os.path.normcase(os.path.realpath(child))
    p = os.path.normcase(os.path.realpath(parent))
    try:
        return os.path.commonpath([c, p]) == p
    except ValueError:
        return False


def prepare_paths(target: str, output: str):
    """対象・出力フォルダを検証する。出力が対象の内側なら中止（対象に書かないため）"""
    if not os.path.isdir(target):
        raise RunError(f"対象フォルダが見つかりません: {target}")
    if _inside(output, target):
        raise RunError("出力フォルダは対象フォルダの外に指定してください（対象には何も書き込みません）")
    os.makedirs(output, exist_ok=True)


def _summary_rows(c):
    """サマリシートの行 (区分, 項目, 値, 容量, 備考) を組み立てる"""
    cfg, light = c["cfg"], c["light"]
    S = []
    add = lambda sec, item, val, cap=None, note="": S.append((sec, item, val, cap, note))
    add("実行情報", "対象フォルダ", c["target"])
    add("実行情報", "実行日時", c["started"].strftime("%Y-%m-%d %H:%M:%S"))
    add("実行情報", "実行モード", "軽量モード（ハッシュ計算なし）" if light else "通常モード")
    add("実行情報", "基準日", c["reference_date"].isoformat(),
        note="設定値" if cfg.reference_date else "設定が空のため実行日を使用")
    add("実行情報", "長期未更新の境界", c["cutoff_date"].isoformat(), note=f"{cfg.stale_years}年前（これより前を対象）")
    add("全体", "総ファイル数", c["total_files"], c["total_bytes"], "除外・リンク・読み取り不可フォルダ内を除く")
    add("全体", "フォルダ数", c["total_dirs"])
    add("全体", "0バイトのファイル数", c["zero_bytes"], 0, "重複候補の対象外")
    dups = c["dups"]
    conf = [g for g in dups if g["status"] == hasher.CONFIRMED]
    unv = [g for g in dups if g["status"] != hasher.CONFIRMED]
    if light:
        add("重複候補", "重複候補", "軽量モードのため未実施")
    else:
        add("重複候補", "重複候補グループ数（全体一致）", len(conf), None, "「重複」と断定せず候補として扱う")
        add("重複候補", "重複候補ファイル数（全体一致）", sum(len(g["paths"]) for g in conf),
            sum(len(g["paths"]) * g["size"] for g in conf))
        add("重複候補", "無駄容量の合計（全体一致）", None, sum(g["wasted"] for g in conf), "(件数−1)×サイズの合計")
        add("重複候補", "全体は未確認のグループ数", len(unv), sum(g["wasted"] for g in unv),
            "読み込み上限超過。先頭・末尾のみ一致。容量は無駄容量の上限見込み")
        add("重複候補", "全体は未確認のファイル数", sum(len(g["paths"]) for g in unv),
            sum(len(g["paths"]) * g["size"] for g in unv))
    if c["naming_state"] is None:
        add("命名逸脱", "命名規則（必須/禁止パターン）", "規則未設定", None, "config.toml の [naming] を設定してください")
    else:
        add("命名逸脱", "命名規則の逸脱ファイル数", len(c["naming"]), sum(r[4] for r in c["naming"]))
    add("命名逸脱", "版管理パターン該当ファイル数", len(c["version_hits"]), sum(r[4] for r in c["version_hits"]),
        "「最終」「_v2」等")
    vg = c["version_groups"]
    add("版の乱立候補", "グループ数", len(vg))
    add("版の乱立候補", "ファイル数", sum(len(g["items"]) for g in vg),
        sum(i[3] for g in vg for i in g["items"]))
    add("長期未更新", "ファイル数", len(c["stale"]), sum(r[2] for r in c["stale"]),
        "更新日時は実際の作成・最終利用日を示さない場合があります")
    add("フォルダ", "階層が深いフォルダ数", len(c["deep"]), None, f"深さ>{cfg.depth_threshold}")
    add("除外", "除外ファイル数", c["excluded_files"], None, "除外リスト: " + ", ".join(cfg.exclude_names))
    add("除外", "除外フォルダ数", c["excluded_dirs"])
    kinds = c["error_counts"]
    unreadable = sum(n for k, n in kinds if k != LINK_KIND)
    links = sum(n for k, n in kinds if k == LINK_KIND)
    add("読み取り不可", "読み取り不可の件数", unreadable, None, "権限・パス長などで読めなかった項目")
    for k, n in kinds:
        if k != LINK_KIND:
            add("読み取り不可", f"  種類: {k}", n)
    add("読み取り不可", "辿らなかったリンク等の件数", links, None, "シンボリックリンク・ジャンクション・ショートカット類は辿りません")
    for k, v in cfg.display_rows():
        add("使用した設定値", k, v)
    add("注意", WARN_TEXT, None)
    add("注意", "更新日時について", None, None, "更新日時は実際の作成・最終利用日を示さない場合があります")
    return S


WARN_TEXT = "内部資料のため取り扱い注意"


def run_audit(target, output, cfg, *, light=False, resume=False, keep_work=False,
              now=None, out=None) -> RunResult:
    """棚卸しを実行して Excel を出力する。resume=True なら一時DBの結果を再利用する"""
    out = out or sys.stderr
    target = os.path.abspath(target) if not target.startswith("\\\\") else target
    output = os.path.abspath(output)
    prepare_paths(target, output)
    started = now or dt.datetime.now()
    progress = Progress(out)
    db_path = os.path.join(output, WORK_DB_NAME)
    if not resume:
        for suffix in ("", "-journal"):
            if os.path.exists(db_path + suffix):
                os.remove(db_path + suffix)
    store = Store(db_path)
    try:
        reuse = (resume and store.get_meta("target") == target and store.get_meta("scan_done") == "1")
        if resume and not reuse:
            out.write("再開できる走査結果がないため、走査からやり直します（計算済みのハッシュは再利用します）\n")
        if reuse:
            out.write("前回の走査結果を再利用します\n")
        else:
            store.reset_scan()
            store.set_meta("target", target)
            scanner.scan(target, cfg, store, progress)
            store.set_meta("scan_done", 1)
        dups = [] if light else hasher.find_duplicates(store, cfg, progress)
        ref = cfg.reference_date or started.date()
        cutoff = cutoff_timestamp(ref, cfg.stale_years)
        naming_state, naming = checks.naming_violations(store, cfg)
        hits, vgroups = checks.version_candidates(store, cfg)
        folders = store.folder_summary()
        n, size, d = store.totals()
        ctx = {
            "cfg": cfg, "light": light, "target": target, "started": started,
            "reference_date": ref, "cutoff_date": years_before(ref, cfg.stale_years),
            "total_files": n, "total_bytes": size, "total_dirs": d, "zero_bytes": store.zero_byte_count(),
            "dups": dups, "naming_state": naming_state, "naming": naming,
            "version_hits": hits, "version_groups": vgroups,
            "stale": store.stale_files(cutoff), "folders": folders,
            "deep": checks.deep_folders(folders, cfg.depth_threshold),
            "excluded_files": int(store.get_meta("excluded_files", 0)),
            "excluded_dirs": int(store.get_meta("excluded_dirs", 0)),
            "error_counts": store.error_counts(), "errors": store.error_rows(),
            "file_info": store.file_info,
        }
        ctx["summary_rows"] = _summary_rows(ctx)
        xlsx = os.path.join(output, f"shared_folder_inventory_{started:%Y%m%d_%H%M%S}.xlsx")
        report.write_report(xlsx, ctx)
        summary = {k: ctx[k] for k in ("total_files", "total_bytes", "excluded_files", "excluded_dirs")}
        summary["unreadable"] = sum(n for k, n in ctx["error_counts"] if k != LINK_KIND)
    finally:
        store.close()
    if not keep_work:
        for suffix in ("", "-journal"):
            if os.path.exists(db_path + suffix):
                os.remove(db_path + suffix)
    return RunResult(xlsx, summary)
