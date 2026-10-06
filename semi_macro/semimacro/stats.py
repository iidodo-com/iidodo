"""ラグ相関・重ならない窓・ブロックブートストラップ・最大統計量のブロック置換検定(numpy/scipyのみ)。

設計の理由:
- 5/20営業日の変化・リターンは窓が重なると自己相関が強く、通常の相関検定のp値は過度に小さくなる。
  → 基本は重ならない窓(stride=max(窓))で標本化。重なる窓を使う場合は循環ブロックブートストラップで信頼区間を出す。
    (iidブートストラップは使わない)
- 多数のラグ・窓を同時に試すので、最大統計量(全セルの max|r|)の分布をブロック置換で作り、調整後p値を出す。
  Holm法は個々のp値が有効であることが前提だが、重なる窓・隣接ラグの強い従属ではその前提が崩れるため採用しない。
"""
import numpy as np
import pandas as pd
from scipy import stats as sps


# ---- 基本部品 ----------------------------------------------------------------
def pearson(x, y):
    """NaNを含むペアを除いたピアソン相関。(r, n)。分散0やn<3はNaN。"""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    m = ~(np.isnan(x) | np.isnan(y))
    n = int(m.sum())
    if n < 3:
        return np.nan, n
    xs, ys = x[m] - x[m].mean(), y[m] - y[m].mean()
    sxx, syy = (xs * xs).sum(), (ys * ys).sum()
    if sxx <= 0 or syy <= 0:
        return np.nan, n
    return float((xs * ys).sum() / np.sqrt(sxx * syy)), n


def change(level, k):
    """k営業日変化(差): level[t] - level[t-k]。行位置で数える。"""
    return level - level.shift(k)


def pct_return(close, k):
    """k営業日リターン: close[t]/close[t-k] - 1。"""
    return close / close.shift(k) - 1


def lagged_pairs(x, y0, lag):
    """x[t] と y0[t+lag] の組(行位置で対応)。y0 は forward_return(close, 0, h) など。"""
    return np.asarray(x, float), np.asarray(pd.Series(y0).shift(-lag), float)


def nonoverlap_corr(x, y0, lag, stride):
    """重ならない窓での相関。開始位置(offset)を0..stride-1で変えた各標本の相関の平均・最小・最大と、標本数の平均、p値の中央値。"""
    xa, ya = lagged_pairs(x, y0, lag)
    rs, ns, ps = [], [], []
    for off in range(stride):
        xs_, ys_ = xa[off::stride], ya[off::stride]
        m = ~(np.isnan(xs_) | np.isnan(ys_))
        r, n = pearson(xs_, ys_)
        if not np.isnan(r):
            rs.append(r)
            ns.append(n)
            ps.append(float(sps.pearsonr(xs_[m], ys_[m])[1]))
    if not rs:
        return {"r_mean": np.nan, "r_min": np.nan, "r_max": np.nan, "n_mean": 0.0, "p_median": np.nan}
    return {"r_mean": float(np.mean(rs)), "r_min": float(np.min(rs)), "r_max": float(np.max(rs)),
            "n_mean": float(np.mean(ns)), "p_median": float(np.median(ps))}


# ---- ブロック処理 --------------------------------------------------------------
def block_indices(starts, L, n):
    """循環ブロックのインデックス列。starts の各点から長さLを(nで循環して)連結し、先頭n個を返す。"""
    idx = np.concatenate([(np.arange(L) + s) % n for s in starts])
    return idx[:n]


def block_perm_indices(n, L, order):
    """連続ブロック(長さL、最後は余り)を order の順に並べ替えたインデックス。"""
    blocks = [np.arange(i, min(i + L, n)) for i in range(0, n, L)]
    return np.concatenate([blocks[i] for i in order])


def bootstrap_ci(x, y, L, B, level, rng):
    """循環ブロックブートストラップ(ペアをまとめて再標本)での相関の信頼区間(パーセンタイル法)。"""
    x = np.asarray(x, float)
    y = np.asarray(y, float)
    m = ~(np.isnan(x) | np.isnan(y))
    x, y = x[m], y[m]
    n = len(x)
    if n < max(10, 2 * L):
        return (np.nan, np.nan)
    nb = int(np.ceil(n / L))
    starts = rng.integers(0, n, size=(B, nb))
    idx = (starts[:, :, None] + np.arange(L)[None, None, :]) % n
    idx = idx.reshape(B, -1)[:, :n]
    xb, yb = x[idx], y[idx]
    xb = xb - xb.mean(axis=1, keepdims=True)
    yb = yb - yb.mean(axis=1, keepdims=True)
    den = np.sqrt((xb ** 2).sum(axis=1) * (yb ** 2).sum(axis=1))
    with np.errstate(invalid="ignore", divide="ignore"):
        r = (xb * yb).sum(axis=1) / den
    r = r[~np.isnan(r)]
    a = (1 - level) / 2
    return float(np.quantile(r, a)), float(np.quantile(r, 1 - a))


def maxstat_p(obs_abs, null_max):
    """調整後p値 = (1 + #{null_max >= obs}) / (B + 1)。"""
    null_max = np.asarray(null_max, float)
    return (1 + int((null_max >= obs_abs).sum())) / (len(null_max) + 1)


# ---- 全セルの相関表と最大統計量検定 -------------------------------------------------
def cell_table(xs, ys, lags):
    """xs: {k: Series(x)}, ys: {h: Series(y0=h日先行リターン)}。各(k,h,lag)のピアソン相関と標本数(重なる窓)。"""
    rows = []
    for k, x in xs.items():
        for h, y0 in ys.items():
            for lag in lags:
                xa, ya = lagged_pairs(x, y0, lag)
                r, n = pearson(xa, ya)
                rows.append({"k": k, "h": h, "lag": lag, "r": r, "n": n})
    return pd.DataFrame(rows)


def maxstat_permutation(xs, ys, lags, L, B, rng):
    """xs全体に共通のブロック置換(行を同じ並べ替え)を与え、全セルの max|r| の帰無分布を作る。
    置換でxの窓内の自己相関は保たれ、xとyの対応だけが壊れる。"""
    n = len(next(iter(xs.values())))
    nblk = int(np.ceil(n / L))
    keys_y = {h: [np.asarray(pd.Series(y0).shift(-lag), float) for lag in lags] for h, y0 in ys.items()}
    xarr = {k: np.asarray(x, float) for k, x in xs.items()}
    out = np.empty(B)
    for b in range(B):
        perm = block_perm_indices(n, L, rng.permutation(nblk))
        mx = 0.0
        for k, xa in xarr.items():
            xp = xa[perm]
            for h, yl in keys_y.items():
                for ya in yl:
                    r, _ = pearson(xp, ya)
                    if not np.isnan(r) and abs(r) > mx:
                        mx = abs(r)
        out[b] = mx
    return out


def split_corr(x, y0, lag, n_splits):
    """時間順に n_splits 等分した各期間での相関と標本数(重なる窓)。"""
    xa, ya = lagged_pairs(x, y0, lag)
    n = len(xa)
    edges = np.linspace(0, n, n_splits + 1).astype(int)
    return [pearson(xa[a:b], ya[a:b]) for a, b in zip(edges[:-1], edges[1:])]


# ---- 判定 ----------------------------------------------------------------------
def longest_run(mask):
    """True が連続する最大長と、その区間の開始位置。"""
    best = cur = 0
    best_start = start = 0
    for i, v in enumerate(mask):
        if v:
            if cur == 0:
                start = i
            cur += 1
            if cur > best:
                best, best_start = cur, start
        else:
            cur = 0
    return best, best_start


def decide(cells, crit):
    """事前基準(config.yaml の hypothesis.verdict)に基づく判定。
    cells: DataFrame[k,h,lag,r,n_eff_total,n_eff_split_min,p_adj,ci_lo,ci_hi,split_signs_neg(bool)]
    仮説の方向 = スプレッドの縮小(変化<0)の後にリターン上昇 → 相関は負。"""
    elig = cells[(cells["n_eff_total"] >= crit["min_effective_n_total"]) &
                 (cells["n_eff_split_min"] >= crit["min_effective_n_per_split"])]
    reasons = []
    if elig.empty:
        return "判断できない", [f"重ならない窓での標本数が基準(全期間{crit['min_effective_n_total']}以上かつ各分割期間{crit['min_effective_n_per_split']}以上)を満たすセルがありません。"
                           "検定力が足りないため、仮説の支持・不支持を判断しません。"]
    alpha = crit["alpha"]
    sig_neg = elig[(elig["p_adj"] <= alpha) & (elig["r"] < 0)]
    sig_pos = elig[(elig["p_adj"] <= alpha) & (elig["r"] > 0)]
    support_cells = []
    for (k, h), g in elig.groupby(["k", "h"]):
        g = g.sort_values("lag")
        lag_to_neg = {int(l): bool(r < 0 and pa <= alpha and hi < 0 and ss)
                      for l, r, pa, hi, ss in zip(g["lag"], g["r"], g["p_adj"], g["ci_hi"], g["split_signs_neg"])}
        sign_neg = (g["r"] < 0).tolist()
        run, st = longest_run(sign_neg)
        ok_cells = [l for l, v in lag_to_neg.items() if v]
        if ok_cells and run >= crit["min_consecutive_lags"]:
            lags_sorted = g["lag"].tolist()
            run_lags = set(lags_sorted[st:st + run])
            if any(l in run_lags for l in ok_cells):
                support_cells.append((k, h, ok_cells, run))
    if support_cells:
        txt = "; ".join(f"(変化{k}日,先行{h}日): ラグ{ok}で全基準を満たす(負の相関が連続{run}ラグ)" for k, h, ok, run in support_cells)
        return "支持する(条件付き)", [f"適格セルのうち {txt}。ただし相関であり因果ではない。複数の対象・系列を同時に見ているため偶然の混入は残る。"]
    # 支持しない: 逆方向で有意、または同等性(効果が小さいと言える)
    if len(sig_pos):
        top = sig_pos.reindex(sig_pos["r"].sort_values(ascending=False).index).iloc[0]
        return "支持しない", [f"仮説と逆方向(正)の相関が調整後p≦{alpha}で有意なセルがあります(例: 変化{int(top['k'])}日・先行{int(top['h'])}日・ラグ{int(top['lag'])}: r={top['r']:+.3f})。"]
    eq = crit["equivalence_r"]
    if (elig["ci_lo"] > -eq).all():
        return "支持しない", [f"適格な全セル・全ラグで、相関の95%信頼区間の下限が -{eq} より上です(仮説の方向に r≦-{eq} 以上の関係があるとは言えない)。"]
    if len(sig_neg):
        reasons.append("負の相関で調整後p値が基準を満たすラグはあるが、連続性・信頼区間・分割期間の符号一致のいずれかの基準を満たしません。")
    else:
        reasons.append(f"調整後p≦{alpha}で負の相関となるセルはありません。")
    reasons.append(f"一方、全セル・全ラグで信頼区間の下限が -{eq} より上とも言えないため、「支持しない」とも言えません(検定力不足)。")
    return "判断できない", reasons
