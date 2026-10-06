"""保存済みデータの読み込み、手動CSVの適用、データ品質フラグ、日本の営業日カレンダー、バスケット構築。"""
import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import config as C
from .manual import apply_manual, read_manual
from .store import Store


@dataclass
class Data:
    cfg: dict
    store: Store
    fred: dict = field(default_factory=dict)       # id -> DataFrame[value]
    px: dict = field(default_factory=dict)         # ticker -> DataFrame
    meta: dict = field(default_factory=dict)       # key -> meta
    flags: list = field(default_factory=list)      # dict(kind, series, date, detail)
    missing: list = field(default_factory=list)    # 取得できなかった指標(理由つき)
    jp_cal: pd.DatetimeIndex = None
    basket: pd.DataFrame = None                    # ret, n_used, level
    stock_ret: dict = field(default_factory=dict)  # ticker -> DataFrame[ret, span]
    n225_ret: pd.DataFrame = None


def load_all(cfg, store=None):
    store = store or Store(cfg)
    d = Data(cfg, store)
    for s in cfg["fred"]["series"]:
        df = store.read(s["id"])
        if df is None or df["value"].dropna().empty:
            d.missing.append({"key": s["id"], "name": s["name"], "reason": "未取得(fetch を実行、またはAPIキー/ネットワークを確認)"})
            continue
        d.fred[s["id"]] = df
        d.meta[s["id"]] = store.read_meta(s["id"])
    tol = cfg["quality"]["manual_conflict_tolerance"]
    for t in cfg["yfinance"]["tickers"]:
        if not t.get("enabled", True):
            continue
        name = C.safe_name(t["ticker"])
        df = store.read(name)
        mpath = store.manual_dir / f"{name}.csv"
        if df is None:
            df = pd.DataFrame(columns=["open", "high", "low", "close", "adj_close", "volume", "dividends", "splits"],
                              index=pd.DatetimeIndex([], name="date"))
        if mpath.exists():
            man = read_manual(mpath)
            if len(man):
                df, fl = apply_manual(df, man, tol)
                for f in fl:
                    d.flags.append(dict(f, series=t["ticker"]))
        if df.empty or df["close"].dropna().empty:
            d.missing.append({"key": t["ticker"], "name": t["name"], "reason": "未取得(fetch を実行、またはネットワーク/手動CSVを確認)"})
            continue
        if "src" not in df.columns:
            df["src"] = "yfinance"
        d.px[t["ticker"]] = df
        d.meta[t["ticker"]] = store.read_meta(name)
    _quality_flags(d)
    _build_jp(d)
    return d


def _role(cfg, ticker):
    return next(t["role"] for t in cfg["yfinance"]["tickers"] if t["ticker"] == ticker)


def _basket_members(cfg):
    m = list(cfg["basket"]["members"])
    if cfg["basket"].get("include_optional"):
        m += [t["ticker"] for t in cfg["yfinance"]["tickers"] if t["role"] == "jp_optional"]
    return m


def _tradable(df, role="jp_stock"):
    """出来高0の行は非取引(前値埋めの疑い)として除く(個別株・ETFのみ)。
    指数は出来高が常に0のため、この規則を適用しない。出来高が無い行(手動補完)は有効扱い。"""
    if role == "index":
        return df["close"].notna()
    return df["close"].notna() & ~(df["volume"] == 0)


def _quality_flags(d):
    cfg = d.cfg
    thr = cfg["quality"]["large_move_threshold"]
    members = [m for m in _basket_members(cfg) if m in d.px]
    n225 = d.px.get(cfg["basket"]["benchmark"])
    for t, df in d.px.items():
        role = _role(cfg, t)
        if role in ("jp_stock", "jp_optional", "us_etf", "reference_etf"):
            zero = df.index[df["volume"] == 0]
            for dt in zero:
                others = [m for m in members if m != t and m in d.px and dt in d.px[m].index
                          and d.px[m].loc[dt, "volume"] > 0]
                n225_ok = n225 is not None and dt in n225.index and pd.notna(n225.loc[dt, "close"])
                if role in ("jp_stock", "jp_optional") and len(members) > 1 and len(others) == len([m for m in members if m != t and m in d.px]) \
                        and len(others) >= 1 and n225_ok:
                    d.flags.append({"kind": "zero_volume_check", "series": t, "date": dt,
                                    "detail": "出来高0だが他のバスケット銘柄と日経平均は通常取引 → 要確認(前値埋めとは断定しない)。計算からは除外"})
                else:
                    d.flags.append({"kind": "zero_volume_excluded", "series": t, "date": dt,
                                    "detail": "出来高0。非取引日の前値埋めの可能性が高い(他銘柄も取引なし/指数なし)。計算から除外"})
        ok = _tradable(df, role)
        c = df.loc[ok, "close"]
        r = c.pct_change()
        for dt, v in r[r.abs() > thr].items():
            d.flags.append({"kind": "large_move", "series": t, "date": dt,
                            "detail": f"日次変動 {v:+.1%}(補正なし。実際の値動きか取得誤りかは要確認)"})
        for dt, v in df.loc[df["splits"] > 0, "splits"].items():
            d.flags.append({"kind": "split", "series": t, "date": dt,
                            "detail": f"yfinance上の分割日(比率 {v:g})。効力発生日と同じとは仮定しない。Closeは分割調整済み"})
        meta = d.meta.get(t, {})
        for dt in meta.get("excluded_partial_bars", []):
            d.flags.append({"kind": "partial_bar_excluded", "series": t, "date": pd.Timestamp(dt),
                            "detail": "未確定の足(取引終了前)として除外(config.yamlの時刻で変更可)"})


def _build_jp(d):
    """日本の営業日カレンダー、個別株リターン(span記録)、バスケット、日経平均リターンを作る。"""
    cfg = d.cfg
    members = [m for m in _basket_members(cfg) if m in d.px]
    if not members:
        return
    need = math.ceil(len(_basket_members(cfg)) / 2)
    flagsum = pd.concat([_tradable(d.px[m]).astype(int).rename(m) for m in members], axis=1).fillna(0)
    cal = flagsum.index[flagsum.sum(axis=1) >= need]
    d.jp_cal = pd.DatetimeIndex(cal)
    pos = pd.Series(np.arange(len(cal)), index=cal)
    rets = {}
    for m in members:
        df = d.px[m]
        ok = _tradable(df)
        c = df.loc[ok, "close"].reindex(cal)
        valid = c.notna()
        p = pos[valid]
        prev_close = c[valid].shift(1)
        span = p.diff()
        ret = c[valid] / prev_close - 1
        r = pd.DataFrame({"ret": ret, "span": span}).reindex(cal)
        r.loc[r["span"] != 1, "ret"] = np.nan   # 複数営業日にまたがるリターンは1日リターンとして扱わない
        d.stock_ret[m] = r
        multi = r[(r["span"] > 1)]
        for dt, row in multi.iterrows():
            d.flags.append({"kind": "multi_day_return", "series": m, "date": dt,
                            "detail": f"前の有効日から{int(row['span'])}営業日ぶんのリターン(1日リターンとして扱わず、バスケット日次平均から除外)"})
    R = pd.DataFrame({m: d.stock_ret[m]["ret"] for m in members})
    n_used = R.notna().sum(axis=1)
    min_members = max(2, need)
    ret = R.mean(axis=1).where(n_used >= min_members)
    level = (1 + ret.fillna(0)).cumprod() * 100
    d.basket = pd.DataFrame({"ret": ret, "n_used": n_used, "level": level})
    bad = d.basket[d.basket["ret"].isna()]
    for dt in bad.index:
        d.flags.append({"kind": "basket_ret_unavailable", "series": "BASKET", "date": dt,
                        "detail": f"有効な銘柄が{min_members}未満のため日次リターンなし(水準は前日のまま連鎖)"})
    # 日経平均(ベンチマーク): カレンダーに対する欠損を記録。前日値で埋めない
    bm = cfg["basket"]["benchmark"]
    if bm in d.px:
        c = d.px[bm]["close"].reindex(cal)
        for dt in c.index[c.isna()]:
            d.flags.append({"kind": "missing_vs_calendar", "series": bm, "date": dt,
                            "detail": "日本の営業日(バスケット多数が取引)だが取得元に行なし/NaN。手動CSV(data/manual/)で補えます。補えない日はベンチマーク相対の計算から除外"})
        prev_valid_pos = pos.where(c.notna()).ffill().shift(1)
        span = (pos - prev_valid_pos).where(c.notna())
        r = (c / c.where(c.notna()).ffill().shift(1) - 1).where(c.notna())
        r[span != 1] = np.nan
        d.n225_ret = pd.DataFrame({"ret": r, "span": span})
        for dt in d.n225_ret.index[(d.n225_ret["span"] > 1)]:
            d.flags.append({"kind": "multi_day_return", "series": bm, "date": dt,
                            "detail": f"欠損をまたぐ{int(d.n225_ret.loc[dt, 'span'])}営業日ぶんのリターン(相対計算から除外)"})
    # 相対(バスケット−日経平均)の除外日
    if d.n225_ret is not None:
        rel = d.basket["ret"] - d.n225_ret["ret"]
        d.basket["rel_ret"] = rel
        ex = d.basket.index[rel.isna() & d.basket["ret"].notna()]
        for dt in ex:
            d.flags.append({"kind": "relative_excluded", "series": "BASKET_REL", "date": dt,
                            "detail": "日経平均の1日リターンが無いため、ベンチマーク相対の計算から除外(前日値で埋めない)"})
        d.basket["rel_level"] = (1 + rel.fillna(0)).cumprod() * 100
