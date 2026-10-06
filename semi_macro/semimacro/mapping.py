"""日付の対応表(日本日付 j ↔ 使った米国日付)。align.py の規則Aと同じ merge_asof で日付そのものを返す。"""
import pandas as pd


def us_dates_used(us_dates, cal_days, strict=True):
    """cal_days の各日に対し、米国系列の有効日付のうち使われる日付を返す。
    strict=True: 暦日が厳密に前(規則A・日本株)。strict=False: 同日を含む(米国同士・米国暦で合わせる)。"""
    left = pd.DataFrame({"cal": pd.DatetimeIndex(cal_days).tz_localize(None).normalize()})
    right = pd.DataFrame({"us": pd.DatetimeIndex(us_dates).tz_localize(None).normalize()})
    m = pd.merge_asof(left.sort_values("cal"), right.sort_values("us"), left_on="cal", right_on="us",
                      allow_exact_matches=not strict)
    return pd.Series(m["us"].values, index=pd.DatetimeIndex(cal_days))


def align_values(us, cal_days, strict):
    """米国系列を暦に載せる。strict=True は align.align_us_to_jp と同じ結果。"""
    used = us_dates_used(us.dropna().index, cal_days, strict)
    vals = us.dropna()
    out = pd.Series([vals.get(u, float("nan")) if pd.notna(u) else float("nan") for u in used],
                    index=used.index, name=us.name)
    return out, used


def date_map_table(spreads, cal_days, strict=True):
    """日付対応表: jp_date, 各系列の使用米国日付、遅れ日数(暦日)。"""
    out = pd.DataFrame(index=pd.DatetimeIndex(cal_days))
    out.index.name = "jp_date"
    for name, s in spreads.items():
        used = us_dates_used(s.dropna().index, cal_days, strict)
        out[f"us_date_used[{name}]"] = used.dt.strftime("%Y-%m-%d")
        out[f"lag_days[{name}]"] = (out.index - pd.DatetimeIndex(used)).days
    return out
