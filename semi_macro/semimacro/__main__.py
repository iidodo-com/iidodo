"""使い方: python -m semimacro {fetch|dashboard|hypothesis|check_env|all|test} [--config PATH]"""
import argparse
import sys
import unittest
from datetime import datetime

from . import config as C
from .fred import FetchError


def _force_utf8():
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")   # Windowsのコンソールでも日本語が化けないように
        except Exception:
            pass


def cmd_fetch(cfg):
    from . import fred, prices
    from .store import Store
    store = Store(cfg)
    failures = []
    print("== FRED ==")
    key_ok = True
    for spec in cfg["fred"]["series"]:
        if not key_ok:
            break
        try:
            m = fred.update_series(store, spec, cfg)
            print(f"  OK  {spec['id']:14s} {m['first_date']}〜{m['last_date']} 有効{m['n_valid']}件 欠損{m['n_missing_total']}件 改訂{m['n_revised_in_overlap']}件")
        except FetchError as e:
            print(f"  NG  {spec['id']}: {e}")
            failures.append(spec["id"])
            if "FRED_API_KEY" in str(e) and "設定されていません" in str(e):
                print("  (APIキー未設定のため、残りのFRED系列は省略します)")
                key_ok = False
    print("== 株価・指数 (yfinance) ==")
    for t in cfg["yfinance"]["tickers"]:
        if not t.get("enabled", True):
            continue
        try:
            m = prices.update_ticker(store, t, cfg)
            ex = f" 未確定の足を除外: {m['excluded_partial_bars']}" if m["excluded_partial_bars"] else ""
            print(f"  OK  {t['ticker']:8s} {m['first_date']}〜{m['last_date']} {m['n_rows']}行 [{m['refetch']}]{ex}")
        except FetchError as e:
            print(f"  NG  {t['ticker']}: {e}")
            failures.append(t["ticker"])
    if failures:
        print(f"\n取得できなかった指標: {', '.join(failures)}（取得できたものでダッシュボードは作成できます）")
    return 0


def cmd_dashboard(cfg):
    from .datasets import load_all
    from . import dashboard
    data = load_all(cfg)
    p, flags = dashboard.build(data)
    print(f"ダッシュボード: {p}")
    if flags:
        print(f"品質フラグ一覧: {flags}")
    if data.missing:
        print("取得できていない指標: " + ", ".join(m["key"] for m in data.missing))
    return 0


def cmd_hypothesis(cfg, synthetic=False):
    from . import hypothesis, report_hypo
    from .datasets import load_all
    h = cfg["hypothesis"]
    if synthetic:
        return _demo(cfg)
    if not h.get("criteria_confirmed"):
        print("仮説検証は実行しません。config.yaml の hypothesis.criteria_confirmed が false です。\n"
              "判定基準(事前に固定)を確認・承認してから true にしてください。結果を見る前に基準を固定するための仕組みです。")
        return 2
    data = load_all(cfg)
    results, T = hypothesis.run_all(data)
    p = report_hypo.build(results, T, data)
    from .mapping import date_map_table
    spreads = {sp["id"]: data.fred[sp["id"]]["value"] for sp in h["spread_series"] if sp["id"] in data.fred}
    if data.jp_cal is not None and spreads:
        out = C.output_dir(cfg) / f"date_map_{datetime.now():%Y%m%d}.csv"
        date_map_table(spreads, data.jp_cal, strict=True).to_csv(out, encoding="utf-8-sig")
        print(f"日付対応表: {out}")
    print(f"仮説検証: {p}")
    return 0


def _demo(cfg):
    """合成データで画面とコードの動作だけを確認するデモ(実データの結果ではない)。"""
    import copy
    from . import hypothesis, report_hypo
    from .datasets import Data
    from .store import Store
    import pandas as pd
    sys.path.insert(0, str(C.PROJECT_DIR))
    from tests.helpers import synthetic_pair
    cfg = copy.deepcopy(cfg)
    cfg["hypothesis"]["stats"].update(n_bootstrap=200, n_permutations=200)
    L, P = synthetic_pair(n=3000, beta=1.0, shift=3, seed=1)
    L2, P2 = synthetic_pair(n=780, beta=0.0, seed=2, start="2023-10-06")
    cfg["hypothesis"]["spread_series"] = [{"id": "SYN_LONG", "label": "合成データ(長期・関係あり)", "family": "Moodys"},
                                          {"id": "SYN_SHORT", "label": "合成データ(約3年・関係なし)", "family": "ICE"}]
    cfg["hypothesis"]["targets"] = {"verdict": ["SOX"], "descriptive": []}
    results = {}
    for sid, (a, b) in {"SYN_LONG": (L, P), "SYN_SHORT": (L2, P2)}.items():
        r = hypothesis.run_pair(a, "US", b, cfg, inference=True)
        r.update(label=sid, family="x", target="SOX", target_desc="合成データ", kind="US")
        results[(sid, "SOX")] = r
    d = Data(cfg, Store(cfg))
    p = report_hypo.build(results, {}, d, synthetic=True)
    print(f"デモ(合成データ): {p}")
    return 0


def main(argv=None):
    _force_utf8()
    ap = argparse.ArgumentParser(prog="python -m semimacro")
    ap.add_argument("command", choices=["fetch", "dashboard", "hypothesis", "check_env", "all", "test"])
    ap.add_argument("--config", help="config.yaml のパス")
    ap.add_argument("--intraday", action="store_true", help="check_env: 5分足の最終足と日足Closeも比較する")
    ap.add_argument("--synthetic", action="store_true", help="hypothesis: 合成データのデモ(実データは使わない)")
    a = ap.parse_args(argv)
    if a.command == "test":
        suite = unittest.defaultTestLoader.discover(str(C.PROJECT_DIR / "tests"), top_level_dir=str(C.PROJECT_DIR))
        return 0 if unittest.TextTestRunner(verbosity=1).run(suite).wasSuccessful() else 1
    try:
        C.load_dotenv()
        cfg = C.load_config(a.config)
        if a.command == "fetch":
            return cmd_fetch(cfg)
        if a.command == "dashboard":
            return cmd_dashboard(cfg)
        if a.command == "hypothesis":
            return cmd_hypothesis(cfg, a.synthetic)
        if a.command == "check_env":
            from . import check_env
            text, path = check_env.run(cfg, a.intraday)
            print(text)
            print(f"\n(この診断結果は {path} にも保存しました)")
            return 0
        if a.command == "all":
            cmd_fetch(cfg)
            cmd_dashboard(cfg)
            return cmd_hypothesis(cfg)
    except (C.ConfigError, FetchError) as e:
        print(f"エラー: {e}")
        return 1
    except Exception as e:  # 想定外
        print(f"想定外のエラー({type(e).__name__}): {e}\n対処: 内容を控えて、python -m semimacro check_env の結果とあわせて確認してください。")
        return 1


if __name__ == "__main__":
    sys.exit(main())
