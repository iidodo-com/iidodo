"""指標計算（VWAP / SMA / EMA / ボリンジャーバンド）。

入力DataFrameの列: t(UTCエポック秒), o, h, l, c, v。行は時刻昇順。
グルーピング（リセット・連続計算の単位）は `group_keys` に集約し、
`core/events.py` の増分VWAPとも同じ規則を共有する。

【精度の限界】足ベースのVWAPは、各足の典型価格 (H+L+C)/3 を足の出来高で重み付けした近似値であり、
約定ごとの VWAP（売買代金 ÷ 売買高）とは一致しない。足の中での約定の偏りが反映されないため。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np
import pandas as pd

from .session import JST, parse_hhmm


@dataclass(frozen=True)
class IndicatorParams:
    sma: tuple[int, ...] = (20,)
    ema: tuple[int, ...] = (9, 21)
    bb_period: int = 20
    bb_sigmas: tuple[float, ...] = (1.0, 2.0)
    ddof: int = 0                        # 0=母標準偏差, 1=標本標準偏差
    vwap_reset_afternoon: bool = False
    ma_cross_lunch: bool = True
    ma_carry_prev_day: bool = False
    split_guard: bool = True
    afternoon_from: dt.time = field(default_factory=lambda: dt.time(12, 0))

    @classmethod
    def from_config(cls, ind: dict, split_guard: bool = True) -> "IndicatorParams":
        return cls(
            sma=tuple(int(x) for x in ind.get("sma", [20])),
            ema=tuple(int(x) for x in ind.get("ema", [9, 21])),
            bb_period=int(ind.get("bb_period", 20)),
            bb_sigmas=tuple(float(x) for x in ind.get("bb_sigmas", [1.0, 2.0])),
            ddof=int(ind.get("bb_ddof", 0)),
            vwap_reset_afternoon=bool(ind.get("vwap_reset_afternoon", False)),
            ma_cross_lunch=bool(ind.get("ma_cross_lunch", True)),
            ma_carry_prev_day=bool(ind.get("ma_carry_prev_day", False)),
            split_guard=split_guard,
            afternoon_from=parse_hhmm(ind.get("afternoon_from", "12:00")),
        )


def make_frame(bars: Sequence) -> pd.DataFrame:
    """Bar(または dict) のリストから DataFrame を作る。"""
    rows = [(b.t, b.o, b.h, b.l, b.c, b.v) if hasattr(b, "t") else
            (b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]
    return pd.DataFrame(rows, columns=["t", "o", "h", "l", "c", "v"])


def split_segment(d: dt.date, split_dates: Sequence[dt.date]) -> int:
    """日付 d が何番目の「分割区間」か（分割日以降なら +1 ずつ増える）。"""
    return sum(1 for s in split_dates if s <= d)


def group_key(ts: float, *, by_day: bool, by_session: bool, split_dates: Sequence[dt.date],
              afternoon_from: dt.time, split_guard: bool) -> tuple:
    j = dt.datetime.fromtimestamp(ts, JST)
    seg = split_segment(j.date(), split_dates) if split_guard else 0
    day = j.date().toordinal() if by_day else 0
    sess = int(j.time() >= afternoon_from) if by_session else 0
    return (seg, day, sess)


def _keys(df: pd.DataFrame, p: IndicatorParams, split_dates: Sequence[dt.date],
          by_day: bool, by_session: bool) -> pd.Series:
    ks = [group_key(t, by_day=by_day, by_session=by_session, split_dates=split_dates,
                    afternoon_from=p.afternoon_from, split_guard=p.split_guard) for t in df["t"]]
    # タプルを整数IDに変換して groupby しやすくする
    ids = {}
    out = [ids.setdefault(k, len(ids)) for k in ks]
    return pd.Series(out, index=df.index)


def vwap(df: pd.DataFrame, p: IndicatorParams, split_dates: Sequence[dt.date] = ()) -> pd.Series:
    """VWAP = 累積(典型価格×出来高) ÷ 累積出来高。典型価格 = (高値+安値+終値)/3。
    9:00(日の最初の足)でリセット。vwap_reset_afternoon=True なら後場開始でもリセット。
    累積出来高が0の間は NaN（ゼロ除算しない）。"""
    if df.empty:
        return pd.Series(dtype=float)
    tp = (df["h"] + df["l"] + df["c"]) / 3.0
    k = _keys(df, p, split_dates, by_day=True, by_session=p.vwap_reset_afternoon)
    cum_pv = (tp * df["v"]).groupby(k).cumsum()
    cum_v = df["v"].groupby(k).cumsum()
    return (cum_pv / cum_v.where(cum_v > 0)).astype(float)


def _ma_keys(df, p, split_dates):
    return _keys(df, p, split_dates, by_day=not p.ma_carry_prev_day, by_session=not p.ma_cross_lunch)


def sma(df: pd.DataFrame, n: int, p: IndicatorParams, split_dates: Sequence[dt.date] = ()) -> pd.Series:
    if df.empty:
        return pd.Series(dtype=float)
    k = _ma_keys(df, p, split_dates)
    return df["c"].groupby(k).transform(lambda s: s.rolling(n, min_periods=n).mean())


def ema(df: pd.DataFrame, n: int, p: IndicatorParams, split_dates: Sequence[dt.date] = ()) -> pd.Series:
    """EMA(期間n): α=2/(n+1)、最初の足を初期値とする再帰式。n本そろうまでは NaN。"""
    if df.empty:
        return pd.Series(dtype=float)
    k = _ma_keys(df, p, split_dates)
    return df["c"].groupby(k).transform(lambda s: s.ewm(span=n, adjust=False, min_periods=n).mean())


def bollinger(df: pd.DataFrame, p: IndicatorParams, split_dates: Sequence[dt.date] = ()) -> dict[str, pd.Series]:
    """中心線=SMA(期間n)、バンド=中心線 ± k×標準偏差。標準偏差は ddof=0(母)/1(標本)を params.ddof で切替。"""
    out: dict[str, pd.Series] = {}
    if df.empty:
        return out
    n = p.bb_period
    k = _ma_keys(df, p, split_dates)
    g = df["c"].groupby(k)
    mid = g.transform(lambda s: s.rolling(n, min_periods=n).mean())
    sd = g.transform(lambda s: s.rolling(n, min_periods=n).std(ddof=p.ddof))
    out["bb_mid"] = mid
    for s in p.bb_sigmas:
        out[f"bb_up_{_fmt(s)}"] = mid + s * sd
        out[f"bb_lo_{_fmt(s)}"] = mid - s * sd
    return out


def _fmt(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else str(x)


def compute(df: pd.DataFrame, p: IndicatorParams, split_dates: Sequence[dt.date] = ()) -> dict[str, pd.Series]:
    """全指標を計算して {名前: Series} で返す。キー: vwap, sma_N, ema_N, bb_mid, bb_up_K, bb_lo_K"""
    out: dict[str, pd.Series] = {"vwap": vwap(df, p, split_dates)}
    for n in p.sma:
        out[f"sma_{n}"] = sma(df, n, p, split_dates)
    for n in p.ema:
        out[f"ema_{n}"] = ema(df, n, p, split_dates)
    out.update(bollinger(df, p, split_dates))
    return out


def pct_metrics(price: float | None, prev_close: float | None, vwap_value: float | None) -> dict[str, float | None]:
    """前日終値比(%) と VWAP乖離率(%)。分母が無い/0 のときは None。"""
    def pct(a, b):
        if a is None or b is None or b == 0 or (isinstance(b, float) and np.isnan(b)):
            return None
        return (a / b - 1.0) * 100.0
    return {"chg_prev_close_pct": pct(price, prev_close), "vwap_dev_pct": pct(price, vwap_value)}
