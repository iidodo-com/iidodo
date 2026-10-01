import datetime as dt
import math

import pandas as pd
import pytest

from core import indicators as ind
from core.indicators import IndicatorParams
from .conftest import DAY, ts

P = IndicatorParams()


def frame(rows):
    """rows: (epoch, o, h, l, c, v)"""
    return pd.DataFrame(rows, columns=["t", "o", "h", "l", "c", "v"])


def test_vwap_hand_calculated():
    df = frame([
        (ts(9, 0), 100, 100, 100, 100, 0),      # 出来高0 → VWAP は NaN（ゼロ除算しない）
        (ts(9, 1), 100, 102, 98, 100, 100),
        (ts(9, 2), 100, 106, 100, 103, 200),
        (ts(9, 3), 103, 105, 101, 104, 0),      # 出来高0の足 → 累積は増えない → 前の値のまま
    ])
    v = ind.vwap(df, P)
    # 足1: 典型価格 = (102+98+100)/3 = 100      → 累積PV=100*100=10000,  累積V=100  → 100.0
    # 足2: 典型価格 = (106+100+103)/3 = 103      → 累積PV=10000+103*200=30600, 累積V=300 → 102.0
    # 足3: 出来高0 → 累積PV=30600, 累積V=300 のまま → 102.0
    assert math.isnan(v[0])
    assert v[1] == pytest.approx(100.0)
    assert v[2] == pytest.approx(102.0)
    assert v[3] == pytest.approx(102.0)


def test_vwap_resets_each_day_and_optionally_at_afternoon():
    d2 = DAY + dt.timedelta(days=1)
    df = frame([
        (ts(11, 29), 100, 100, 100, 100, 100),
        (ts(12, 30), 200, 200, 200, 200, 100),
        (ts(9, 0, day=d2), 300, 300, 300, 300, 100),
    ])
    # 後場継続(既定): 昼休み後もリセットしない → (100*100+200*100)/200 = 150。翌日は9:00でリセット → 300
    v = ind.vwap(df, P)
    assert list(v.round(6)) == [100.0, 150.0, 300.0]
    # 後場でリセットする設定
    v2 = ind.vwap(df, IndicatorParams(vwap_reset_afternoon=True))
    assert list(v2.round(6)) == [100.0, 200.0, 300.0]


def closes(cs, start=(9, 0)):
    return frame([(ts(9, 0) + 60 * i, c, c, c, c, 100) for i, c in enumerate(cs)])


def test_sma():
    df = closes([1, 2, 3, 4, 5])
    s = ind.sma(df, 3, P)
    assert s.isna().tolist() == [True, True, False, False, False]
    assert list(s.dropna()) == [2.0, 3.0, 4.0]


def test_ema():
    df = closes([1, 2, 3, 4, 5])
    e = ind.ema(df, 3, P)            # α = 2/(3+1) = 0.5 、初期値=最初の終値
    # e0=1, e1=.5*2+.5*1=1.5, e2=.5*3+.5*1.5=2.25, e3=.5*4+.5*2.25=3.125, e4=.5*5+.5*3.125=4.0625
    assert e.isna().tolist() == [True, True, False, False, False]
    assert list(e.dropna()) == pytest.approx([2.25, 3.125, 4.0625])


def test_bollinger_ddof0_and_ddof1():
    df = closes([1, 2, 3, 4, 5])
    # 窓[1,2,3]: 平均2。偏差二乗和=(1+0+1)=2
    # ddof=0: 分散=2/3 → σ=0.81650; ddof=1: 分散=2/2=1 → σ=1
    b0 = ind.bollinger(df, IndicatorParams(bb_period=3, ddof=0))
    b1 = ind.bollinger(df, IndicatorParams(bb_period=3, ddof=1))
    s0 = math.sqrt(2 / 3)
    assert b0["bb_mid"][2] == pytest.approx(2.0)
    assert b0["bb_up_1"][2] == pytest.approx(2 + s0)
    assert b0["bb_lo_2"][2] == pytest.approx(2 - 2 * s0)
    assert b1["bb_up_1"][2] == pytest.approx(3.0)
    assert b1["bb_up_2"][2] == pytest.approx(4.0)
    assert b1["bb_lo_2"][2] == pytest.approx(0.0)
    assert b0["bb_mid"].isna().tolist()[:2] == [True, True]


def test_custom_sigma():
    df = closes([1, 2, 3, 4, 5])
    b = ind.bollinger(df, IndicatorParams(bb_period=3, bb_sigmas=(1.5,), ddof=1))
    assert b["bb_up_1.5"][2] == pytest.approx(3.5)


def test_ma_across_lunch_and_day_options():
    d2 = DAY + dt.timedelta(days=1)
    df = frame([
        (ts(11, 28), 1, 1, 1, 1, 1), (ts(11, 29), 2, 2, 2, 2, 1),
        (ts(12, 30), 3, 3, 3, 3, 1), (ts(12, 31), 4, 4, 4, 4, 1),
        (ts(9, 0, day=d2), 5, 5, 5, 5, 1), (ts(9, 1, day=d2), 6, 6, 6, 6, 1),
    ])
    # 昼休みをまたいで連続(既定)、日ごとにリセット: 1日目 [1,2,3,4] の2期間SMA = nan,1.5,2.5,3.5 / 2日目 nan,5.5
    s = ind.sma(df, 2, IndicatorParams())
    assert math.isnan(s[0]) and s[1] == 1.5 and s[2] == 2.5 and s[3] == 3.5
    assert math.isnan(s[4]) and s[5] == 5.5
    # 前日を引き継ぐ: 日付またぎも連続 → s[4] = (4+5)/2
    s2 = ind.sma(df, 2, IndicatorParams(ma_carry_prev_day=True))
    assert s2[4] == 4.5
    # 昼休みで区切る: 後場は 12:30 から数え直し → s[2] は nan、s[3] = (3+4)/2
    s3 = ind.sma(df, 2, IndicatorParams(ma_cross_lunch=False))
    assert s3[1] == 1.5 and math.isnan(s3[2]) and s3[3] == 3.5


def test_split_guard_cuts_calculation_at_split_date():
    d2 = DAY + dt.timedelta(days=1)
    df = frame([(ts(9, 0), 1000, 1000, 1000, 1000, 1), (ts(9, 1), 1000, 1000, 1000, 1000, 1),
                (ts(9, 0, day=d2), 500, 500, 500, 500, 1), (ts(9, 1, day=d2), 500, 500, 500, 500, 1)])
    carry = dict(ma_carry_prev_day=True)
    # 分割日 = d2。ガードあり → 分割日をまたぐ平均は作らない（3期間SMAが 2日目の前半で nan）
    s = ind.sma(df, 2, IndicatorParams(split_guard=True, **carry), split_dates=[d2])
    assert s[3] == 500 and math.isnan(s[2])
    # ガードなし → 不連続な価格をそのまま平均してしまう（これを避けるための設定）
    s2 = ind.sma(df, 2, IndicatorParams(split_guard=False, **carry), split_dates=[d2])
    assert s2[2] == 750


def test_empty_frame_is_safe():
    out = ind.compute(frame([]), P)
    assert out["vwap"].empty


def test_pct_metrics():
    m = ind.pct_metrics(110, 100, 105)
    assert m["chg_prev_close_pct"] == pytest.approx(10.0)
    assert m["vwap_dev_pct"] == pytest.approx((110 / 105 - 1) * 100)
    assert ind.pct_metrics(110, None, float("nan")) == {"chg_prev_close_pct": None, "vwap_dev_pct": None}
