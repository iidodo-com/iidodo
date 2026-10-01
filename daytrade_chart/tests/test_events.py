import pandas as pd
import pytest

from core import indicators as ind
from core.aggregator import Aggregator
from core.events import EventEngine
from core.indicators import make_frame
from core.store import Store
from providers.base import Tick
from .conftest import ts

CFG = {"events": {"ema_fast": 2, "ema_slow": 3, "bb_period": 3, "bb_sigmas": [1.0], "bb_ddof": 0,
                  "horizons_min": [1, 3, 5, 10]},
       "indicators": {}, "split_guard": True}


@pytest.fixture
def env(clock, tmp_path):
    store = Store(tmp_path / "t.db")
    eng = EventEngine(CFG, clock, store, "mock")
    ag = Aggregator(clock, intervals=(60,))
    yield clock, store, eng, ag
    store.close()


def feed(env, t, price, cum):
    clock, store, eng, ag = env
    r = ag.on_tick(Tick("285A", t, price, cum))
    evs = []
    for itv, b in r.closed:
        evs += eng.on_bar_closed("285A", ag.get_bars("285A", 60))
    evs += eng.on_tick("285A", t, price, ag.get_bars("285A", 60))
    return evs


def test_current_vwap_matches_indicator(env):
    clock, store, eng, ag = env
    for i, (p, c) in enumerate([(100, 0), (101, 100), (103, 300), (102, 450)]):
        ag.on_tick(Tick("285A", ts(9, 0) + 30 * i, p, c))
    bars = ag.get_bars("285A", 60)
    v_df = ind.vwap(make_frame(bars), eng.params).iloc[-1]
    assert eng.current_vwap("285A", bars) == pytest.approx(v_df)


def test_vwap_cross_and_fill_horizons(env):
    clock, store, eng, ag = env
    # 出来高を持つ価格推移: 100 → 上昇 → 下落でVWAPを下抜け
    seq = [(100, 0), (100, 100), (104, 300), (106, 500), (101, 800), (97, 1200)]
    evs = []
    for i, (p, c) in enumerate(seq):
        evs += feed(env, ts(9, 0) + 20 * i, p, c)
    types = [e["type"] for e in evs]
    assert "vwap_cross_down" in types
    down = [e for e in evs if e["type"] == "vwap_cross_down"][0]
    assert down["symbol"] == "285A" and down["bucket"] == "寄付き直後"
    # 後から価格が戻る → 1分後・3分後が埋まり、10分後は空欄のまま
    feed(env, ts(9, 0) + 20 * 5 + 60, 98, 1300)
    feed(env, ts(9, 0) + 20 * 5 + 180, 99, 1400)
    eng.fill_pending(ts(9, 0) + 20 * 5 + 180)
    row = store.query("SELECT * FROM events WHERE id=?", (down["id"],))[0]
    # イベントは 9:01:20(価格101)。1分後=9:02:20 時点の最新価格は 97(9:01:40)、3分後=9:04:20 時点は 98(9:02:40)
    assert down["price"] == 101
    assert row["chg_1"] == pytest.approx((97 / 101 - 1) * 100)
    assert row["chg_3"] == pytest.approx((98 / 101 - 1) * 100)
    assert row["chg_5"] is None and row["chg_10"] is None


def test_bb_and_ema_events_on_closed_bars(env):
    clock, store, eng, ag = env
    # 1分足の終値: 横ばい→急落(BB下抜け) →急反発
    closes = [100, 100, 100, 100, 90, 100, 112]
    evs = []
    for i, c in enumerate(closes):
        evs += feed(env, ts(9, 0) + 60 * i + 5, c, 100 * (i + 1))
    # 確定足は最後の1本を除いた分。足 i=4 (90) は i=5 のティックで確定する
    types = {e["type"] for e in evs}
    assert "bb_lower_1" in types
    assert types & {"ema_golden", "ema_dead"}
    low = [e for e in evs if e["type"] == "bb_lower_1"][0]
    assert low["ts"] == ts(9, 5)           # 9:04 の足の確定時刻 = 9:05:00
    assert low["price"] == 90


def test_event_beyond_close_is_not_filled(env):
    clock, store, eng, ag = env
    eid = store.add_event("mock", "285A", "vwap_cross_up", ts(15, 25), 100.0, "後場")
    eng._pending[eid] = __import__("core.events", fromlist=["_Pending"])._Pending(eid, "285A", ts(15, 25), 100.0, {1, 3, 5, 10})
    eng._record_price("285A", ts(15, 25), 100.0)
    eng._record_price("285A", ts(15, 29), 101.0)
    eng._record_price("285A", ts(15, 30), 102.0)
    eng.fill_pending(ts(15, 30))
    row = store.query("SELECT * FROM events WHERE id=?", (eid,))[0]
    # 1分後(15:26)・3分後(15:28)の時点の最新価格は 100 → 0%
    assert row["chg_1"] == pytest.approx(0.0) and row["chg_3"] == pytest.approx(0.0)
    assert row["chg_5"] == pytest.approx(2.0)      # 15:30 ちょうど（大引け）は有効
    assert row["chg_10"] is None                   # 大引けを超える → 空欄
