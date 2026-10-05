"""ダミーの共有フォルダ構造と expected.json を生成する（実在のフォルダは使わない）

使い方: python generate_sample.py --dest <作業フォルダ>
  <作業フォルダ>/target        ... ダミーの対象フォルダ
  <作業フォルダ>/expected.json ... 仕込んだ内容と件数（対象フォルダの外に置く）
"""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import datetime as dt
from pathlib import Path

REF_DATE = "2026-10-01"
STALE_YEARS = 3
DEPTH_THRESHOLD = 8
DEFAULT_MTIME = dt.datetime(2026, 6, 1, 12, 0).timestamp()
P = "20260101_"  # 命名規則に合致する先頭（日付8桁＋アンダースコア）
PARTIAL = 65536
TEST_MAX_READ = 1048576  # テスト用の読み込み上限（1MiB）

TEST_CONFIG_TOML = f"""reference_date = "{REF_DATE}"
stale_years = {STALE_YEARS}
depth_threshold = {DEPTH_THRESHOLD}
[scan]
exclude_names = ["~$*", "Thumbs.db", "desktop.ini", ".DS_Store"]
exclude_dirs = []
[hash]
partial_bytes = {PARTIAL}
max_read_bytes = {TEST_MAX_READ}
[naming]
required_patterns = ['^\\d{{8}}_']
forbidden_patterns = ['　', '[\\uff61-\\uff9f]', '[#%&]']
[version]
patterns = ['最終', '最新', 'コピー', '(?i)_final', '(?i)_v\\d+', ' \\(\\d+\\)']
"""


def ts(*a) -> float:
    """年月日(時分)からUNIX時刻を作る"""
    return dt.datetime(*a).timestamp()


class Planter:
    """ダミーツリーを作りながら、仕込んだ内容を記録する"""

    def __init__(self, root: Path, seed: int):
        """作成先と乱数の種を指定する"""
        self.root, self.seed = root, seed
        self.files = {}      # 相対パス -> {size, mtime, tags}
        self.dirs = {"."}    # 作成したフォルダ（相対）
        self.excluded = []
        self.n = 0

    def rnd(self, n: int, key: str) -> bytes:
        """key ごとに決まった乱数バイト列を返す"""
        return random.Random(f"{self.seed}:{key}").randbytes(n)

    def uniq(self, key: str) -> bytes:
        """他と重ならないサイズ・内容のファイルを返す"""
        self.n += 1
        return self.rnd(1000 + 37 * self.n, f"uniq{self.n}:{key}")

    def mkdir(self, rel: str) -> None:
        """フォルダを作り、祖先も記録する"""
        (self.root / rel).mkdir(parents=True, exist_ok=True)
        parts = rel.split("/")
        for i in range(1, len(parts) + 1):
            self.dirs.add("/".join(parts[:i]))

    def file(self, rel: str, data: bytes, mtime=DEFAULT_MTIME, tags=(), excluded=False) -> None:
        """ファイルを作り更新日時を設定する。excluded=True は除外対象として記録"""
        self.mkdir(os.path.dirname(rel) or ".") if os.path.dirname(rel) else None
        p = self.root / rel
        p.write_bytes(data)
        os.utime(p, (mtime, mtime))
        if excluded:
            self.excluded.append(rel)
        else:
            self.files[rel] = {"size": len(data), "mtime": mtime, "tags": set(tags)}


def build(dest: Path, seed: int = 20260101) -> dict:
    """ダミー構造を dest/target に作り、expected を返す"""
    target = dest / "target"
    if target.exists():
        restore_permissions(target)
        shutil.rmtree(target)
    target.mkdir(parents=True)
    pl = Planter(target, seed)
    f = pl.file

    # --- 重複グループ A（別名・別フォルダ・3件・大きめ。部分ハッシュ→全体ハッシュまで進む） ---
    da = pl.rnd(300_000, "dupA")
    f(f"営業部/見積/{P}提案資料.pptx", da)
    f(f"営業部/契約/{P}提案資料_写し.pptx", da)
    f(f"配布用/{P}提案資料.pptx", da)
    # --- 重複グループ B（日本語・全角スペース・小さいファイル。全角スペースで命名逸脱にもなる） ---
    db = pl.rnd(2048, "dupB")
    f(f"経理部/2020/{P}請求書　控え.pdf", db, tags=["forbidden"])
    f(f"経理部/2021/{P}請求書　控え.pdf", db, tags=["forbidden"])
    # --- 誤検出確認：サイズだけ同じで内容が違う ---
    f(f"総務部/雑多/{P}同サイズA.dat", pl.rnd(200_000, "ssA"))
    f(f"総務部/雑多/{P}同サイズB.dat", pl.rnd(200_000, "ssB"))
    # --- 誤検出確認：サイズ・先頭・末尾が同じで中身だけ違う（全体ハッシュで除外される） ---
    head, tail = pl.rnd(PARTIAL, "htH"), pl.rnd(PARTIAL, "htT")
    f(f"営業部/契約/{P}試算A.bin", head + pl.rnd(310_000 - 2 * PARTIAL, "htA") + tail)
    f(f"営業部/契約/{P}試算B.bin", head + pl.rnd(310_000 - 2 * PARTIAL, "htB") + tail)
    # --- 読み込み上限超過（1.2MB/1.3MB > 上限1MiB）：全体は未確認として出る ---
    big = pl.rnd(1_200_000, "bigSame")
    f(f"技術部/大容量/{P}ログ一式A.bin", big)
    f(f"技術部/大容量/{P}ログ一式B.bin", big)
    bh, bt = pl.rnd(PARTIAL, "bH"), pl.rnd(PARTIAL, "bT")
    f(f"技術部/大容量/{P}データ一式A.bin", bh + pl.rnd(1_300_000 - 2 * PARTIAL, "bA") + bt)
    f(f"技術部/大容量/{P}データ一式B.bin", bh + pl.rnd(1_300_000 - 2 * PARTIAL, "bB") + bt)
    # --- 0バイト（重複候補にしない） ---
    f(f"総務部/雑多/{P}空.txt", b"")
    f(f"共通/{P}空.txt", b"")

    # --- 命名規則違反 ---
    f("総務部/雑多/メモ.txt", pl.uniq("memo"), tags=["required"])
    f("総務部/雑多/data.csv", pl.uniq("csv"), tags=["required"])
    f(f"総務部/雑多/{P}議事録　最終確認.txt", pl.uniq("gijiroku"), tags=["forbidden", "version"])
    f(f"総務部/雑多/{P}ﾃｽﾄ資料.txt", pl.uniq("kana"), tags=["forbidden"])
    f(f"総務部/雑多/{P}見積#2.txt", pl.uniq("hash"), tags=["forbidden"])
    # --- 版の乱立グループ ---
    v1 = [f"{P}契約書.docx", f"{P}契約書_最終.docx", f"{P}契約書_最終_v2.docx", f"{P}契約書 (1).docx"]
    for n in v1:
        f(f"営業部/契約/{n}", pl.uniq(n), tags=[] if n == v1[0] else ["version"])
    v2 = [f"{P}見積書.xlsx", f"{P}見積書_最新.xlsx", f"{P}見積書_コピー.xlsx"]
    for n in v2:
        f(f"営業部/見積/{n}", pl.uniq(n), tags=[] if n == v2[0] else ["version"])
    f(f"営業部/見積/{P}見積書_B社.xlsx", pl.uniq("B社"))  # 対照：グループにならない
    f(f"配布用/{P}契約書_最終.docx", pl.uniq("haifu"), tags=["version"])  # 別フォルダは束ねない
    f(f"総務部/雑多/{P}報告書_final.docx", pl.uniq("final"), tags=["version"])  # 単独

    # --- 更新日時を過去に書き換え ---
    f(f"経理部/2020/{P}総勘定元帳.xlsx", pl.uniq("a"), ts(2019, 4, 1, 9), ["stale"])
    f(f"経理部/2020/{P}仕訳帳.xlsx", pl.uniq("b"), ts(2020, 11, 15, 9), ["stale"])
    f(f"経理部/2021/{P}予算表.xlsx", pl.uniq("c"), ts(2021, 6, 30, 9), ["stale"])
    f(f"総務部/規程/{P}就業規則.docx", pl.uniq("d"), ts(2022, 1, 10, 9), ["stale"])
    f(f"経理部/2021/{P}期末資料.xlsx", pl.uniq("e"), ts(2023, 9, 30, 23, 0), ["stale"])  # 境界の直前＝対象
    f(f"経理部/2021/{P}期首資料.xlsx", pl.uniq("f"), ts(2023, 10, 1, 12, 0))               # 境界の当日＝対象外

    # --- 階層が深いフォルダ（技術部=1 ... L9=10。深さ9・10が閾値8超） ---
    deep = "技術部/" + "/".join(f"L{i}" for i in range(1, 10))
    f(f"技術部/{P}概要.md", pl.uniq("gaiyo"))
    f(f"{deep}/{P}設計書.md", pl.uniq("sekkei"))
    # --- 長いパス（相対パスだけで260文字超） ---
    longdirs = "/".join(f"部署横断プロジェクト資料フォルダ{i}_" + "あ" * 36 for i in range(1, 6))
    long_rel = f"共通/長いパス/{longdirs}/{P}長いパス検証.txt"
    f(long_rel, pl.uniq("long"))
    # --- 日本語・全角スペースを含む（命名規則には合致） ---
    f(f"共通/テンプレート/{P}議事録 テンプレート.docx", pl.uniq("tpl"))
    f(f"共通/テンプレート/{P}会議資料テンプレート.pptx", pl.uniq("tpl2"))
    for i in range(1, 6):
        f(f"総務部/規程/{P}資料{i:02d}.txt", pl.uniq(f"fill{i}"))
        f(f"技術部/{P}メモ{i:02d}.txt", pl.uniq(f"gfill{i}"))

    # --- 除外対象 ---
    f(f"営業部/見積/~${P}見積書.xlsx", pl.uniq("tmp"), excluded=True)
    f("営業部/見積/Thumbs.db", pl.uniq("th1"), excluded=True)
    f("総務部/雑多/Thumbs.db", pl.uniq("th2"), excluded=True)
    f("共通/desktop.ini", pl.uniq("ini"), excluded=True)

    # --- リンク（辿らない）：親へ戻るループと、ファイルへのリンク ---
    links_created = []
    try:
        os.symlink("..", target / "共通" / "ループ")
        os.symlink(f"テンプレート/{P}会議資料テンプレート.pptx", target / "共通" / "ショートカット代わり")
        links_created = ["共通/ループ", "共通/ショートカット代わり"]
    except (OSError, NotImplementedError):
        pass

    # --- 読み取り権限のないもの（rootでは chmod が効かず作れない） ---
    pair_a, pair_b = pl.rnd(4097, "permA"), pl.rnd(4097, "permB")
    f(f"配布用/{P}権限なし.dat", pair_a)
    f(f"配布用/{P}権限なし_対.dat", pair_b)
    pl.mkdir("総務部/権限なしフォルダ")
    inner = target / "総務部/権限なしフォルダ/inner.txt"
    inner.write_bytes(b"x")
    unreadable = {"created": False, "paths": []}
    pf = target / f"配布用/{P}権限なし.dat"
    pd = target / "総務部/権限なしフォルダ"
    os.chmod(pf, 0)
    os.chmod(pd, 0)
    try:
        open(pf, "rb").close()
        os.listdir(pd)
        effective = False
    except PermissionError:
        effective = True
    if effective:
        unreadable = {"created": True, "paths": [f"配布用/{P}権限なし.dat", "総務部/権限なしフォルダ"]}
    else:
        os.chmod(pf, 0o644)
        os.chmod(pd, 0o755)
        inner.unlink()  # 作れない環境では空フォルダのまま

    return make_expected(pl, links_created, unreadable, long_rel)


def make_expected(pl: Planter, links, unreadable, long_rel) -> dict:
    """仕込んだ内容から expected.json の内容を作る（ツールの出力は使わない）"""
    P_ = P
    files = pl.files
    by_tag = lambda t: sorted(r for r, v in files.items() if t in v["tags"])
    depth = lambda rel: 0 if rel == "." else rel.count("/") + 1
    folders = {}
    for d in sorted(pl.dirs):
        members = [v for r, v in files.items() if (os.path.dirname(r) or ".") == d]
        folders[d] = {
            "depth": depth(d), "files": len(members), "bytes": sum(m["size"] for m in members),
            "min_mtime": min((m["mtime"] for m in members), default=None),
            "max_mtime": max((m["mtime"] for m in members), default=None),
        }
    sz = lambda rels: files[rels[0]]["size"]
    dupA = [f"営業部/見積/{P_}提案資料.pptx", f"営業部/契約/{P_}提案資料_写し.pptx", f"配布用/{P_}提案資料.pptx"]
    dupB = [f"経理部/2020/{P_}請求書　控え.pdf", f"経理部/2021/{P_}請求書　控え.pdf"]
    bigS = [f"技術部/大容量/{P_}ログ一式A.bin", f"技術部/大容量/{P_}ログ一式B.bin"]
    bigD = [f"技術部/大容量/{P_}データ一式A.bin", f"技術部/大容量/{P_}データ一式B.bin"]
    v1 = sorted(f"営業部/契約/{n}" for n in [f"{P_}契約書.docx", f"{P_}契約書_最終.docx", f"{P_}契約書_最終_v2.docx", f"{P_}契約書 (1).docx"])
    v2 = sorted(f"営業部/見積/{n}" for n in [f"{P_}見積書.xlsx", f"{P_}見積書_最新.xlsx", f"{P_}見積書_コピー.xlsx"])
    unread = unreadable["paths"]
    return {
        "generator": {"reference_date": REF_DATE, "stale_years": STALE_YEARS, "depth_threshold": DEPTH_THRESHOLD,
                      "partial_bytes": PARTIAL, "test_max_read_bytes": TEST_MAX_READ},
        "totals": {"files": len(files), "bytes": sum(v["size"] for v in files.values()),
                   "excluded_files": len(pl.excluded), "links": len(links), "zero_byte_files": 2,
                   "dirs": len(pl.dirs)},
        "duplicates": {
            "confirmed_groups": [{"files": sorted(g), "size": sz(g)} for g in (dupA, dupB)],
            "confirmed_wasted_bytes": 2 * sz(dupA) + sz(dupB),
            "unverified_groups": [{"files": sorted(g), "size": sz(g)} for g in (bigS, bigD)],
            "must_not_detect": {
                "same_size_diff_content": sorted([f"総務部/雑多/{P_}同サイズA.dat", f"総務部/雑多/{P_}同サイズB.dat"]),
                "same_head_tail_diff_middle": sorted([f"営業部/契約/{P_}試算A.bin", f"営業部/契約/{P_}試算B.bin"]),
                "zero_byte": sorted([f"総務部/雑多/{P_}空.txt", f"共通/{P_}空.txt"]),
                "permission_pair_same_size": sorted([f"配布用/{P_}権限なし.dat", f"配布用/{P_}権限なし_対.dat"]),
            },
            "note": "unverified_groups のうち『データ一式A/B』は中身が違うが、上限超過のため全体は未確認として出るのが想定（既知の限界）",
        },
        "naming": {"required": by_tag("required"), "forbidden": by_tag("forbidden"), "version_hits": by_tag("version")},
        "version_groups": [v1, v2],
        "stale": by_tag("stale"),
        "not_stale_boundary": [f"経理部/2021/{P_}期首資料.xlsx"],
        "deep_folders": sorted(d for d in pl.dirs if depth(d) > DEPTH_THRESHOLD),
        "folders": folders,
        "excluded": sorted(pl.excluded),
        "links": links,
        "unreadable": {"created": unreadable["created"], "paths": unread,
                       "note": "rootなど権限が効かない環境では作成できない（created=false）"},
        "special_names": {"long_path_file": long_rel, "long_path_relative_length": len(long_rel),
                          "fullwidth_space_files": [r for r in files if "　" in r]},
    }


def restore_permissions(target: Path) -> None:
    """権限を戻す（フォルダ削除前に呼ぶ）"""
    for d, dirs, fs in os.walk(target, onerror=lambda e: None):
        for n in dirs + fs:
            p = os.path.join(d, n)
            if not os.path.islink(p):
                try:
                    os.chmod(p, 0o755 if os.path.isdir(p) else 0o644)
                except OSError:
                    pass
    try:
        os.chmod(target / "総務部/権限なしフォルダ", 0o755)
    except OSError:
        pass


def main(argv=None) -> int:
    """コマンドライン：ダミーツリーと expected.json を作る"""
    ap = argparse.ArgumentParser(description="ダミーの共有フォルダと expected.json を生成")
    ap.add_argument("--dest", required=True, help="作業フォルダ（その下に target と expected.json を作る）")
    ap.add_argument("--seed", type=int, default=20260101)
    a = ap.parse_args(argv)
    dest = Path(a.dest)
    dest.mkdir(parents=True, exist_ok=True)
    exp = build(dest, a.seed)
    (dest / "expected.json").write_text(json.dumps(exp, ensure_ascii=False, indent=2), encoding="utf-8")
    (dest / "test_config.toml").write_text(TEST_CONFIG_TOML, encoding="utf-8")
    print(f"生成しました: {dest / 'target'} / 仕込みファイル数 {exp['totals']['files']}")
    if not exp["unreadable"]["created"]:
        print("注意: この環境では読み取り権限のないファイルを作成できませんでした（root等）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
