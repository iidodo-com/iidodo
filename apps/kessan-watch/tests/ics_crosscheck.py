#!/usr/bin/env python3
"""ICS を第三者ライブラリ(icalendar)で読み込み、構造と内容を検証する（任意実行）。
使い方: pip install icalendar && python3 tests/ics_crosscheck.py out.ics
"""
import sys, datetime
from icalendar import Calendar

with open(sys.argv[1], "rb") as f:
    cal = Calendar.from_ical(f.read())
ev = [c for c in cal.walk() if c.name == "VEVENT"]
assert cal["VERSION"] == "2.0" and "PRODID" in cal
assert ev, "VEVENT なし"
uids = set()
for e in ev:
    s, en = e.decoded("DTSTART"), e.decoded("DTEND")
    assert type(s) is datetime.date and type(en) is datetime.date, "終日(DATE)でない"
    assert (en - s).days == 1, "DTEND が翌日でない"
    assert e["UID"] not in uids; uids.add(str(e["UID"]))
    assert str(e["SUMMARY"]).strip() and e.decoded("DTSTAMP")
    print("OK", s, str(e["SUMMARY"]).replace("\n", "⏎"))
print(f"icalendar で {len(ev)} 件を正常に解析")
