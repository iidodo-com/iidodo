"""仮説検証の本体。「社債スプレッドの縮小が、半導体株の反発に先行する」を、事前に固定した基準で判定する。

x(t)   = スプレッドのk営業日変化(差・%ポイント)。日本株はJP営業日カレンダー上で、規則A(暦日が厳密に前の米国値)で載せた水準から計算。
y(t+lag) = 半導体株の h営業日先行リターン: close(t+lag+h)/close(t+lag) - 1  (規則B)
仮説が正しければ相関は負(縮小=変化<0 の後に上昇)。相関は因果を意味しない。
"""
import numpy as np
import pandas as pd

from . import stats as S
from .align import align_us_to_jp, forward_return
from .mapping import align_values


def prepare(data):
    """ターゲット(水準系列とカレンダー種別)を作る。"""
    cfg, px = data.cfg, data.px
    T = {}
    if "^SOX" in px:
        s = px["^SOX"]["close"].dropna()
        T["SOX"] = ("US", s, "^SOX 終値(指数。配当調整なし)")
    if "SOXX" in px:
        d = px["SOXX"]
        ok = d["close"].notna() & ~(d["volume"] == 0)
        T["SOXX"] = ("US", d.loc[ok, "close"], "SOXX 終値(分割調整済み・配当なし)")
        if d.loc[ok, "adj_close"].notna().any():
            T["SOXX_ADJ"] = ("US", d.loc[ok, "adj_close"].dropna(), "SOXX 調整後終値(配当込み・感度分析)")
    if data.jp_cal is not None:
        cal = data.jp_cal
        bm = cfg["basket"]["benchmark"]
        if bm in px:
            T["N225"] = ("JP", px[bm]["close"].reindex(cal), "日経平均 終値(欠損日は補わない)")
        T["JP_BASKET"] = ("JP", data.basket["level"], cfg["basket"]["name"] + " 水準(日次リターンを連鎖。複数営業日にまたがるリターンは除外)")
        if "rel_level" in data.basket:
            T["JP_BASKET_REL"] = ("JP", data.basket["rel_level"], "バスケット−日経平均の超過リターン(日経欠損日は除外)")
        for m in cfg["basket"]["members"]:
            if m in px:
                d = px[m]
                ok = d["close"].notna() & ~(d["volume"] == 0)
                T[m] = ("JP", d.loc[ok, "close"].reindex(cal), f"{m} 終値(分割調整済み・出来高0の日は除外)")
    return T


def _split_info(xs, ys, lag_max, n_splits):
    """全体と各分割期間の有効ペア数。"""
    out = {}
    for k, x in xs.items():
        for h, y0 in ys.items():
            xa, ya = S.lagged_pairs(x, y0, lag_max)   # 最大ラグ=標本最小
            m = ~(np.isnan(xa) | np.isnan(ya))
            edges = np.linspace(0, len(xa), n_splits + 1).astype(int)
            out[(k, h)] = (int(m.sum()), [int(m[a:b].sum()) for a, b in zip(edges[:-1], edges[1:])])
    return out


def run_pair(spread, kind, level, cfg, inference=True, progress=None):
    """1つの(スプレッド系列, ターゲット)の結果。spread: 米国日付indexのSeries(欠損NaN可)、level: 市場カレンダーindexのSeries。"""
    h_cfg = cfg["hypothesis"]
    st = h_cfg["stats"]
    lags = list(range(h_cfg["lags"]["min"], h_cfg["lags"]["max"] + 1))
    ks, hs = h_cfg["spread_change_windows"], h_cfg["forward_return_windows"]
    crit = h_cfg["verdict"]
    rng = np.random.default_rng(st["seed"])
    cal = level.index
    first = spread.dropna().index.min()
    if kind == "JP":
        x_level = align_us_to_jp(spread.dropna(), cal)
        _, used = align_values(spread, cal, strict=True)
    else:
        x_level, used = align_values(spread, cal, strict=False)
    keep = cal >= first
    if kind == "JP":
        keep = keep & (cal > first)
    x_level, level = x_level[keep], level[keep]
    used = used[keep]
    carried = int((pd.DatetimeIndex(used) != x_level.index).sum()) if kind == "US" else None
    xs = {k: S.change(x_level, k) for k in ks}
    ys = {h: forward_return(level, 0, h) for h in hs}
    table = S.cell_table(xs, ys, lags)
    info = _split_info(xs, ys, lags[-1], st["n_splits"])
    rows = []
    for (k, h), (ntot, nsp) in info.items():
        stride = max(k, h)
        for lag in lags:
            no = S.nonoverlap_corr(xs[k], ys[h], lag, stride)
            sc = S.split_corr(xs[k], ys[h], lag, st["n_splits"])
            rows.append({"k": k, "h": h, "lag": lag, "stride": stride,
                         "n_eff_total": ntot / stride, "n_eff_split_min": min(nsp) / stride,
                         "r_no_mean": no["r_mean"], "r_no_min": no["r_min"], "r_no_max": no["r_max"],
                         "n_no": no["n_mean"], "p_no_median": no["p_median"],
                         "split_r": [r for r, _ in sc], "split_n": [n for _, n in sc]})
    cells = table.merge(pd.DataFrame(rows), on=["k", "h", "lag"])
    cells["split_signs_neg"] = [all((r < 0) for r in sr if not np.isnan(r)) and len(sr) > 0
                                if crit["require_split_sign_agreement"] else True for sr in cells["split_r"]]
    cells["ci_lo"] = np.nan
    cells["ci_hi"] = np.nan
    cells["p_adj"] = np.nan
    eligible_kh = {(k, h) for (k, h), (ntot, nsp) in info.items()
                   if ntot / max(k, h) >= crit["min_effective_n_total"] and min(nsp) / max(k, h) >= crit["min_effective_n_per_split"]}
    verdict, reasons, null_max = None, [], None
    if inference:
        L = st["block_length"]
        for i, c in cells.iterrows():
            xa, ya = S.lagged_pairs(xs[c["k"]], ys[c["h"]], int(c["lag"]))
            lo, hi = S.bootstrap_ci(xa, ya, L, st["n_bootstrap"], st["ci_level"], rng)
            cells.loc[i, ["ci_lo", "ci_hi"]] = [lo, hi]
        if eligible_kh:
            exs = {k: xs[k] for k in ks if any((k, h) in eligible_kh for h in hs)}
            eys = {h: ys[h] for h in hs if any((k, h) in eligible_kh for k in ks)}
            null_max = S.maxstat_permutation(exs, eys, lags, L, st["n_permutations"], rng)
            for i, c in cells.iterrows():
                if (c["k"], c["h"]) in eligible_kh and not np.isnan(c["r"]):
                    cells.loc[i, "p_adj"] = S.maxstat_p(abs(c["r"]), null_max)
        elig = cells[[(k, h) in eligible_kh for k, h in zip(cells["k"], cells["h"])]].copy()
        if elig.empty:
            verdict, reasons = ("判断できない", [
                f"重ならない窓での標本数が基準(全期間{crit['min_effective_n_total']}以上かつ各分割期間{crit['min_effective_n_per_split']}以上)を満たす窓の組がありません。"
                "検定力が足りないため、支持・不支持を判断しません。"])
        else:
            verdict, reasons = S.decide(elig, crit)
    # 同時反応の診断(先行テストには入れない): k日変化と、同じ窓(t-k→t)のターゲット変化
    diag = []
    for k in ks:
        xa = np.asarray(xs[k], float)
        ya = np.asarray(S.pct_return(level, k), float)
        r, n = S.pearson(xa, ya)
        lo, hi = S.bootstrap_ci(xa, ya, st["block_length"], min(st["n_bootstrap"], 1000), st["ci_level"], rng) if inference else (np.nan, np.nan)
        diag.append({"k": k, "r": r, "n": n, "ci_lo": lo, "ci_hi": hi})
    return {"cells": cells, "eligible_kh": sorted(eligible_kh), "verdict": verdict, "reasons": reasons,
            "diag": pd.DataFrame(diag), "n_rows": int(len(level)), "first": str(level.index.min().date()),
            "last": str(level.index.max().date()), "carried_us_days": carried,
            "null_max_q95": float(np.quantile(null_max, 0.95)) if null_max is not None else None,
            "date_map": pd.DataFrame({"us_date_used": pd.DatetimeIndex(used)}, index=level.index)}


def run_all(data, progress=print):
    """全(スプレッド×ターゲット)を実行。ICE系とMoody's系は別々に判定する(混ぜない)。"""
    cfg = data.cfg
    h = cfg["hypothesis"]
    T = prepare(data)
    results = {}
    for sp in h["spread_series"]:
        sid = sp["id"]
        if sid not in data.fred:
            results[(sid, None)] = {"missing": True, "label": sp["label"]}
            continue
        s = data.fred[sid]["value"]
        for tname in h["targets"]["verdict"] + h["targets"]["descriptive"]:
            if tname not in T:
                results[(sid, tname)] = {"missing": True, "label": sp["label"], "target_missing": True}
                continue
            kind, level, desc = T[tname]
            progress(f"  検定: {sid} × {tname}")
            r = run_pair(s, kind, level, cfg, inference=tname in h["targets"]["verdict"])
            r.update(label=sp["label"], family=sp["family"], target=tname, target_desc=desc, kind=kind)
            results[(sid, tname)] = r
    return results, T
