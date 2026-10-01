import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from core.session import SessionClock, TradingCalendar, jst_epoch  # noqa: E402

DAY = dt.date(2026, 10, 1)   # 木曜・営業日


def ts(h, m, s=0, day=DAY):
    return jst_epoch(day, dt.time(h, m, s))


@pytest.fixture
def clock():
    return SessionClock(TradingCalendar(), buckets=[
        {"name": "寄付き直後", "start": "09:00", "end": "09:30"},
        {"name": "前場中盤", "start": "09:30", "end": "11:00"},
        {"name": "後場", "start": "12:30", "end": "15:30"},
    ])
