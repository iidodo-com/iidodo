"""日米の日付合わせ規則(提案)。実装前の検証用で、リポジトリには未追加。

規則A(日本株): 日本の取引日 j に対応させる米国の値は、「暦日が j より厳密に前」の最新の米国営業日の値。
  - 米国 t 日の終値は日本時間の t+1 日早朝(5〜6時)なので、日本の t+1 日の取引時間より前に確定している。
  - 同日(暦日が等しい)の米国値は使わない(allow_exact_matches=False)。日本の j 日の取引時間中は、米国 j 日の終値はまだ存在しない。
  - 米国休場・日本休場で同じ米国値が複数の日本日に対応した場合は、水準が同じ=変化0として扱う(新情報なし)。
規則B(先行テスト): 日本株の「先行リターン」は、日本 j 日の終値を基準に、j+lag 日終値から j+lag+h 日終値までではなく、
  基準 close(j+lag) → close(j+lag+h)。lag=0 は「米国値が反映済みの j 日終値以降」を測り、反応日そのもの(j-1→j)は含めない。
  反応日リターン(close(j-1)→close(j))は、同時反応の診断用として別に出す。
"""
import pandas as pd


def align_us_to_jp(us: pd.Series, jp_days: pd.DatetimeIndex) -> pd.Series:
    """米国系列(米国日付index)を日本の取引日indexに載せる。暦日が厳密に前の最新値。"""
    left = pd.DataFrame({"jp": pd.DatetimeIndex(jp_days).tz_localize(None).normalize()})
    right = us.dropna().rename("v").reset_index()
    right.columns = ["us", "v"]
    right["us"] = pd.DatetimeIndex(right["us"]).tz_localize(None).normalize()
    m = pd.merge_asof(left.sort_values("jp"), right.sort_values("us"),
                      left_on="jp", right_on="us", allow_exact_matches=False)
    return pd.Series(m["v"].values, index=pd.DatetimeIndex(jp_days), name=us.name)


def forward_return(close: pd.Series, lag: int, h: int) -> pd.Series:
    """各日 j の先行リターン: close(j+lag+h)/close(j+lag) - 1。窓が足りない日はNaN。"""
    base = close.shift(-lag)
    return close.shift(-(lag + h)) / base - 1
