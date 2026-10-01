"""取引セッション判定（前場・昼休み・後場・休場日）。

時刻は全て UTC エポック秒（float）で受け取り、日付・時刻の判定は Asia/Tokyo で行う。
区間は半開区間 [開始, 終了)。11:30 ちょうどは昼休み、12:30 ちょうどは後場、15:30 ちょうどは大引け後。
ただし 15:30:00 ちょうどの約定（クロージング・オークションの約定）は後場最終の足に含める
（`bar_time` / `session_of_tick` を参照）。
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Sequence
from zoneinfo import ZoneInfo

JST = ZoneInfo("Asia/Tokyo")


class SessionState(str, Enum):
    CLOSED_DAY = "closed_day"      # 休場日
    PRE_OPEN = "pre_open"          # 営業日の寄付き前
    MORNING = "morning"
    LUNCH = "lunch"
    AFTERNOON = "afternoon"
    AFTER_CLOSE = "after_close"    # 営業日の大引け後


def parse_hhmm(s: str) -> dt.time:
    h, m = s.split(":")[:2]
    return dt.time(int(h), int(m))


def to_jst(ts: float) -> dt.datetime:
    return dt.datetime.fromtimestamp(ts, JST)


def jst_epoch(d: dt.date, t: dt.time) -> float:
    return dt.datetime.combine(d, t, tzinfo=JST).timestamp()


class TradingCalendar:
    """営業日判定。土日・祝日(jpholiday)・年末年始(12/31-1/3)・設定ファイルの追加休場日。"""

    def __init__(
        self,
        use_jpholiday: bool = True,
        year_end_closed: bool = True,
        extra_holidays: Iterable[str | dt.date] = (),
        extra_open_days: Iterable[str | dt.date] = (),
    ) -> None:
        self.year_end_closed = year_end_closed
        self.extra_holidays = {self._d(x) for x in extra_holidays}
        self.extra_open_days = {self._d(x) for x in extra_open_days}
        self._jph = None
        if use_jpholiday:
            try:
                import jpholiday  # noqa: WPS433

                self._jph = jpholiday
            except ImportError:  # pragma: no cover
                self._jph = None

    @staticmethod
    def _d(x: str | dt.date) -> dt.date:
        return x if isinstance(x, dt.date) else dt.date.fromisoformat(str(x))

    def is_trading_day(self, d: dt.date) -> bool:
        if d in self.extra_open_days:
            return True
        if d in self.extra_holidays:
            return False
        if d.weekday() >= 5:
            return False
        if self.year_end_closed and ((d.month == 12 and d.day == 31) or (d.month == 1 and d.day <= 3)):
            return False
        if self._jph is not None and self._jph.is_holiday(d):
            return False
        return True

    def prev_trading_day(self, d: dt.date) -> dt.date:
        d -= dt.timedelta(days=1)
        while not self.is_trading_day(d):
            d -= dt.timedelta(days=1)
        return d

    def next_trading_day(self, d: dt.date) -> dt.date:
        d += dt.timedelta(days=1)
        while not self.is_trading_day(d):
            d += dt.timedelta(days=1)
        return d


@dataclass(frozen=True)
class TimeBucket:
    name: str
    start: dt.time
    end: dt.time


class SessionClock:
    def __init__(
        self,
        calendar: TradingCalendar,
        morning: tuple[str, str] = ("09:00", "11:30"),
        afternoon: tuple[str, str] = ("12:30", "15:30"),
        buckets: Sequence[dict] = (),
    ) -> None:
        self.calendar = calendar
        self.m_start, self.m_end = parse_hhmm(morning[0]), parse_hhmm(morning[1])
        self.a_start, self.a_end = parse_hhmm(afternoon[0]), parse_hhmm(afternoon[1])
        self.buckets = [TimeBucket(b["name"], parse_hhmm(b["start"]), parse_hhmm(b["end"])) for b in buckets]

    @classmethod
    def from_config(cls, cfg: dict) -> "SessionClock":
        c = cfg.get("calendar", {})
        cal = TradingCalendar(
            use_jpholiday=c.get("use_jpholiday", True),
            year_end_closed=c.get("year_end_closed", True),
            extra_holidays=c.get("extra_holidays", []) or [],
            extra_open_days=c.get("extra_open_days", []) or [],
        )
        s = cfg.get("sessions", {})
        return cls(cal, tuple(s.get("morning", ["09:00", "11:30"])), tuple(s.get("afternoon", ["12:30", "15:30"])),
                   cfg.get("time_buckets", []))

    # ---- 状態判定 ----
    def state(self, ts: float) -> SessionState:
        j = to_jst(ts)
        if not self.calendar.is_trading_day(j.date()):
            return SessionState.CLOSED_DAY
        t = j.time()
        if t < self.m_start:
            return SessionState.PRE_OPEN
        if t < self.m_end:
            return SessionState.MORNING
        if t < self.a_start:
            return SessionState.LUNCH
        if t < self.a_end:
            return SessionState.AFTERNOON
        return SessionState.AFTER_CLOSE

    def is_trading(self, ts: float) -> bool:
        return self.state(ts) in (SessionState.MORNING, SessionState.AFTERNOON)

    def session_of_tick(self, ts: float) -> str | None:
        """約定時刻が属するセッション名。各セッション終了時刻ちょうどの約定（大引け/前引けの板寄せ約定）は
        そのセッションに含める。それ以外の時間（昼休み・寄付き前・休場日）は None。"""
        j = to_jst(ts)
        if not self.calendar.is_trading_day(j.date()):
            return None
        t = j.time()
        if self.m_start <= t <= self.m_end:
            return "morning"
        if self.a_start <= t <= self.a_end:
            return "afternoon"
        return None

    def bar_time(self, ts: float, interval: int) -> int | None:
        """ティックが属する足の開始時刻(UTCエポック秒)。時間外は None。
        セッション終了時刻ちょうどのティックは直前の足(終了-1秒の足)に入れる。"""
        sess = self.session_of_tick(ts)
        if sess is None:
            return None
        end = self.m_end if sess == "morning" else self.a_end
        j = to_jst(ts)
        eff = ts
        if j.time() == end and j.microsecond == 0:
            eff = ts - 1
        return int(eff // interval * interval)

    def time_bucket(self, ts: float) -> str:
        t = to_jst(ts).time()
        for b in self.buckets:
            if b.start <= t < b.end:
                return b.name
        if t == self.a_end:  # 15:30ちょうど（大引けの約定）は最後の区分
            return self.buckets[-1].name if self.buckets else "その他"
        return "その他"

    # ---- 取引時間内の経過 ----
    def add_trading_seconds(self, ts: float, secs: float) -> float | None:
        """ts から「取引時間内で」secs 秒進めた時刻。昼休み・時間外は数えない。
        その日の大引け(後場終了)を超える場合は None。"""
        j = to_jst(ts)
        d = j.date()
        if not self.calendar.is_trading_day(d):
            return None
        segs = [(jst_epoch(d, self.m_start), jst_epoch(d, self.m_end)),
                (jst_epoch(d, self.a_start), jst_epoch(d, self.a_end))]
        remaining = secs
        cur = ts
        for s, e in segs:
            if cur >= e:
                continue
            cur = max(cur, s)
            avail = e - cur
            if remaining <= avail:
                return cur + remaining
            remaining -= avail
            cur = e
        return None

    def trading_day_bounds(self, d: dt.date) -> tuple[float, float]:
        return jst_epoch(d, self.m_start), jst_epoch(d, self.a_end)
