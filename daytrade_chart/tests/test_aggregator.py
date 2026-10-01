import datetime as dt

import pytest

from core.aggregator import Aggregator
from providers.base import Tick
from .conftest import DAY, ts


def mk(clock, **kw):
    return Aggregator(clock, intervals=(60, 300), **kw)


def tick(sym, t, price, cum):
    return Tick(sym, t, price, cum)


def test_volume_is_diff_of_cumulative(clock):
    ag = mk(clock)
    r0 = ag.on_tick(tick("6501", ts(9, 0, 1), 100, 1000))
    assert r0.volume == 0                      # 初回は基準だけ（途中参加で巨大出来高を作らない）
    r1 = ag.on_tick(tick("6501", ts(9, 0, 10), 101, 1300))
    r2 = ag.on_tick(tick("6501", ts(9, 0, 20), 99, 1500))
    assert (r1.volume, r2.volume) == (300, 200)
    bar = ag.get_bars("6501", 60)[0]
    assert (bar.o, bar.h, bar.l, bar.c, bar.v, bar.n) == (100, 101, 99, 99, 500, 3)


def test_cumulative_reset_negative_diff(clock, caplog):
    ag = mk(clock)
    ag.on_tick(tick("6501", ts(9, 0, 1), 100, 1000))
    ag.on_tick(tick("6501", ts(9, 0, 2), 101, 1500))
    with caplog.at_level("WARNING", logger="anomaly"):
        r = ag.on_tick(tick("6501", ts(9, 0, 3), 102, 100))    # 累計が減った
    assert r.accepted and r.volume == 0
    assert any("累計出来高が減少" in m for m in caplog.messages)
    bar = ag.get_bars("6501", 60)[0]
    assert bar.c == 102 and bar.v == 500                       # 価格のみ更新、出来高は加算されない
    r2 = ag.on_tick(tick("6501", ts(9, 0, 4), 102, 150))       # 新しい基準(100)からの差分
    assert r2.volume == 50


def test_duplicate_ticks_ignored(clock):
    ag = mk(clock)
    ag.on_tick(tick("6501", ts(9, 0, 1), 100, 1000))
    dup = ag.on_tick(tick("6501", ts(9, 0, 1), 100, 1000))
    assert not dup.accepted and dup.reason == "duplicate"
    same_ts_new_cum = ag.on_tick(tick("6501", ts(9, 0, 1), 100, 1100))   # 同時刻でも累計が違えば有効
    assert same_ts_new_cum.accepted and same_ts_new_cum.volume == 100
    assert ag.get_bars("6501", 60)[0].n == 2


def test_zero_volume_bar(clock):
    ag = mk(clock)
    ag.on_tick(tick("6501", ts(9, 0, 1), 100, 1000))
    ag.on_tick(tick("6501", ts(9, 1, 5), 101, 1000))           # 累計変化なし → 出来高0の足
    b = ag.get_bars("6501", 60)
    assert len(b) == 2 and b[1].v == 0 and b[1].c == 101 and b[0].closed


def test_invalid_ticks_are_ignored_and_logged(clock, caplog):
    ag = mk(clock, max_price_deviation=0.5)
    ag.set_prev_close("6501", 100)
    ag.on_tick(tick("6501", ts(9, 0, 10), 100, 10))
    with caplog.at_level("WARNING", logger="anomaly"):
        assert ag.on_tick(tick("6501", ts(9, 0, 11), 0, 10)).reason == "price<=0"
        assert ag.on_tick(tick("6501", ts(9, 0, 11), -5, 10)).reason == "price<=0"
        assert ag.on_tick(tick("6501", ts(9, 0, 5), 100, 10)).reason == "time_regress"
        assert ag.on_tick(tick("6501", ts(9, 0, 12), 180, 20)).reason == "price_out_of_range"
    assert len(caplog.messages) == 4
    assert ag.get_bars("6501", 60)[0].n == 1


def test_bar_closing_and_5min(clock):
    ag = mk(clock)
    ag.on_tick(tick("6501", ts(9, 0, 1), 100, 0))
    r = ag.on_tick(tick("6501", ts(9, 1, 1), 101, 10))
    assert [(i, b.t) for i, b in r.closed] == [(60, ts(9, 0))]
    assert len(ag.get_bars("6501", 300)) == 1                  # 5分足は9:00-9:05で継続
    r = ag.on_tick(tick("6501", ts(9, 5, 0), 102, 20))
    assert sorted(i for i, _ in r.closed) == [60, 300]
    assert ag.get_bars("6501", 300)[0].closed


def test_session_edges(clock):
    ag = mk(clock)
    ag.on_tick(tick("6501", ts(11, 29, 59), 100, 0))
    ag.on_tick(tick("6501", ts(11, 30, 0), 101, 10))           # 前場最後の約定は 11:29 の足
    r = ag.on_tick(tick("6501", ts(11, 40, 0), 102, 20))       # 昼休み: 足を作らない
    assert not r.in_session and r.accepted
    ag.on_tick(tick("6501", ts(12, 30, 0), 103, 30))
    ag.on_tick(tick("6501", ts(15, 30, 0), 104, 40))           # 大引けの約定は 15:29 の足
    ag.on_tick(tick("6501", ts(15, 31, 0), 105, 50))           # 大引け後は足なし
    ts_ = [b.t for b in ag.get_bars("6501", 60)]
    assert ts_ == [ts(11, 29), ts(12, 30), ts(15, 29)]
    bars = {b.t: b for b in ag.get_bars("6501", 60)}
    assert bars[ts(11, 29)].c == 101 and bars[ts(15, 29)].c == 104


def test_close_until(clock):
    ag = mk(clock)
    ag.on_tick(tick("6501", ts(15, 29, 30), 100, 0))
    assert ag.close_until(ts(15, 29, 59)) == []
    out = ag.close_until(ts(15, 30, 0))
    assert {(i, b.t) for _, i, b in out} == {(60, ts(15, 29)), (300, ts(15, 25))}


def test_new_day_resets_cumulative(clock):
    ag = mk(clock)
    ag.on_tick(tick("6501", ts(15, 0, 0), 100, 9000))
    d2 = DAY + dt.timedelta(days=1)
    r = ag.on_tick(tick("6501", ts(9, 0, 5, day=d2), 101, 700))   # 翌日: 累計は0から数え直す
    assert r.volume == 700


def test_alphanumeric_symbols(clock):
    ag = mk(clock)
    for code in ("285A", "200A", "6501"):
        ag.on_tick(tick(code, ts(9, 0, 1), 100, 0))
        ag.on_tick(tick(code, ts(9, 0, 2), 101, 50))
    assert {s: ag.get_bars(s, 60)[0].v for s in ("285A", "200A", "6501")} == {"285A": 50, "200A": 50, "6501": 50}


def test_gap_marking(clock):
    ag = mk(clock)
    ag.on_tick(tick("6501", ts(9, 0, 1), 100, 0))
    ag.mark_gap(ts(9, 0, 30), ts(9, 3, 0))
    ag.on_tick(tick("6501", ts(9, 3, 5), 101, 10))
    bars = ag.get_bars("6501", 60)
    assert bars[0].gap and bars[1].gap
