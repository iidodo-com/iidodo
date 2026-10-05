"""共通の小さな補助関数"""
from __future__ import annotations

import datetime as dt


def safe_datetime(ts):
    """UNIX時刻を日時に変換する。変換できない値（None・範囲外）は None を返す"""
    if ts is None:
        return None
    try:
        return dt.datetime.fromtimestamp(ts)
    except (OverflowError, OSError, ValueError):
        return None


def years_before(base: dt.date, years: int) -> dt.date:
    """基準日から years 年前の日付を返す（2月29日は2月28日に丸める）"""
    try:
        return base.replace(year=base.year - years)
    except ValueError:
        return base.replace(year=base.year - years, day=28)


def cutoff_timestamp(base: dt.date, years: int) -> float:
    """「N年以上前」の境界時刻（境界日の0時・ローカル時刻）をUNIX時刻で返す"""
    d = years_before(base, years)
    return dt.datetime.combine(d, dt.time.min).timestamp()
