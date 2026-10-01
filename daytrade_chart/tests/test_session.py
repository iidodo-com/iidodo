import datetime as dt

from core.session import SessionClock, SessionState as S, TradingCalendar
from .conftest import DAY, ts


def test_boundaries(clock):
    assert clock.state(ts(8, 59, 59)) == S.PRE_OPEN
    assert clock.state(ts(9, 0)) == S.MORNING
    assert clock.state(ts(11, 29, 59)) == S.MORNING
    assert clock.state(ts(11, 30)) == S.LUNCH          # 11:30 ちょうどは昼休み
    assert clock.state(ts(12, 29, 59)) == S.LUNCH
    assert clock.state(ts(12, 30)) == S.AFTERNOON      # 12:30 ちょうどは後場
    assert clock.state(ts(15, 29, 59)) == S.AFTERNOON
    assert clock.state(ts(15, 30)) == S.AFTER_CLOSE    # 15:30 ちょうどは大引け後
    assert clock.is_trading(ts(9, 0)) and not clock.is_trading(ts(11, 30)) and not clock.is_trading(ts(15, 30))


def test_tick_at_session_end_belongs_to_last_bar(clock):
    # 15:30:00 ちょうどの約定(大引けの板寄せ)は 15:29 の足に入れる
    assert clock.bar_time(ts(15, 30), 60) == ts(15, 29)
    assert clock.bar_time(ts(11, 30), 60) == ts(11, 29)
    assert clock.bar_time(ts(15, 30), 300) == ts(15, 25)
    assert clock.bar_time(ts(12, 30), 60) == ts(12, 30)
    assert clock.bar_time(ts(11, 30, 1), 60) is None     # 昼休み
    assert clock.bar_time(ts(8, 59, 59), 60) is None
    assert clock.bar_time(ts(15, 30, 1), 60) is None


def test_weekend_and_holidays():
    cal = TradingCalendar()
    assert cal.is_trading_day(dt.date(2026, 10, 1))
    assert not cal.is_trading_day(dt.date(2026, 10, 3))   # 土
    assert not cal.is_trading_day(dt.date(2026, 10, 4))   # 日
    assert not cal.is_trading_day(dt.date(2026, 5, 6))    # 祝日(振替休日)
    assert not cal.is_trading_day(dt.date(2026, 11, 3))   # 文化の日


def test_year_end_closed_even_though_jpholiday_lacks_it():
    cal = TradingCalendar()
    for d in [(2025, 12, 31), (2026, 1, 1), (2026, 1, 2), (2026, 1, 3)]:
        assert not cal.is_trading_day(dt.date(*d)), d
    assert cal.is_trading_day(dt.date(2025, 12, 30))      # 大納会
    assert cal.is_trading_day(dt.date(2026, 1, 5))        # 大発会
    # jpholiday 単体では 12/31, 1/2, 1/3 は休日扱いにならない（README記載の根拠）
    import jpholiday
    assert not jpholiday.is_holiday(dt.date(2025, 12, 31))
    # 年末年始ルールを切ると 12/31 は営業日扱いになる（=自前ルールが必要な理由）
    assert TradingCalendar(year_end_closed=False).is_trading_day(dt.date(2025, 12, 31))


def test_calendar_overrides():
    cal = TradingCalendar(extra_holidays=["2026-10-01"], extra_open_days=["2026-10-03"])
    assert not cal.is_trading_day(dt.date(2026, 10, 1))
    assert cal.is_trading_day(dt.date(2026, 10, 3))       # 土曜でも臨時営業日として上書き可
    assert cal.next_trading_day(dt.date(2026, 9, 30)) == dt.date(2026, 10, 2)


def test_closed_day_state():
    clock = SessionClock(TradingCalendar())
    sat = dt.date(2026, 10, 3)
    assert clock.state(ts(10, 0, day=sat)) == S.CLOSED_DAY
    assert clock.bar_time(ts(10, 0, day=sat), 60) is None


def test_config_override_of_close_time():
    clock = SessionClock(TradingCalendar(), afternoon=("12:30", "15:00"))
    assert clock.state(ts(15, 0)) == S.AFTER_CLOSE
    assert clock.state(ts(14, 59, 59)) == S.AFTERNOON


def test_add_trading_seconds_skips_lunch(clock):
    assert clock.add_trading_seconds(ts(10, 0), 300) == ts(10, 5)
    assert clock.add_trading_seconds(ts(11, 28), 300) == ts(12, 33)   # 昼休みの60分は数えない
    assert clock.add_trading_seconds(ts(15, 25), 300) == ts(15, 30)   # 大引けちょうどは可
    assert clock.add_trading_seconds(ts(15, 25), 600) is None         # 大引けを超える


def test_time_bucket(clock):
    assert clock.time_bucket(ts(9, 5)) == "寄付き直後"
    assert clock.time_bucket(ts(10, 0)) == "前場中盤"
    assert clock.time_bucket(ts(14, 0)) == "後場"
