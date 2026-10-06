"""診断コマンド: python -m semimacro check_env
この環境(あなたのPC)で、取得・照合・欠損チェックを再実行する。結果は画面と output/check_env_*.txt に出す。
データ保存(data/)は変更しない。"""
import os
import platform
import sys
from datetime import datetime

import numpy as np
import pandas as pd

from . import config as C
from . import fred, prices
from .fred import FetchError


def _ver(mod):
    try:
        m = __import__(mod)
        return getattr(m, "__version__", "?")
    except Exception as e:
        return f"未インストール({type(e).__name__})"


def run(cfg, intraday=False):
    L = []
    P = L.append
    now = datetime.now()
    P(f"診断 {now:%Y-%m-%d %H:%M:%S}（この端末の時刻） / JST現在 {prices.now_jst():%Y-%m-%d %H:%M}")
    P("=" * 78)
    P("1. 環境")
    P(f"  Python {sys.version.split()[0]} / {platform.platform()}")
    for m in ("requests", "pandas", "numpy", "scipy", "matplotlib", "yfinance", "yaml"):
        P(f"  {m}: {_ver(m)}")
    P(f"  設定ファイル: {cfg['_path']}")
    key = os.environ.get("FRED_API_KEY", "")
    P(f"  FRED_API_KEY: {'設定あり(' + str(len(key)) + '文字。値は表示しません)' if key else '未設定 → FRED系列は取得できません(READMEのキー設定を参照)'}")
    problems = []

    P("")
    P("2. FRED系列（API）")
    P(f"  {'ID':14s}{'結果':6s}{'有効期間':25s}{'頻度':14s}{'単位':26s}{'有効/全行':>14s}{'欠損':>6s}{'最大間隔日':>10s}")
    if not key:
        P("  APIキー未設定のためスキップ")
        problems.append("FRED APIキー未設定")
    else:
        for s in cfg["fred"]["series"]:
            sid = s["id"]
            try:
                info = fred.fetch_meta(sid, cfg["http"])
                df, _ = fred.fetch_observations(sid, cfg["fred"]["start"], cfg["http"])
                v = df["value"].dropna()
                gap = v.index.to_series().diff().dt.days.max()
                P(f"  {sid:14s}{'OK':6s}{str(v.index.min().date()) + '〜' + str(v.index.max().date()):25s}{str(info['frequency']):14s}{str(info['units'])[:24]:26s}"
                  f"{str(len(v)) + '/' + str(len(df)):>14s}{len(df) - len(v):>6d}{int(gap):>10d}")
                if sid in ("BAMLC0A0CM", "BAMLH0A0HYM2"):
                    yrs = (v.index.max() - v.index.min()).days / 365.25
                    P(f"      ↑ ICE系: 取得できる履歴は約{yrs:.1f}年(FRED注記: 2026年4月以降は3年分のみ)")
            except FetchError as e:
                P(f"  {sid:14s}NG    {str(e).splitlines()[0]}")
                problems.append(f"FRED {sid}: {str(e).splitlines()[0]}")

    P("")
    P("3. yfinance（非公式。auto_adjust=False）")
    P(f"  {'ティッカー':10s}{'期間':25s}{'行数':>7s}{'最終日':>12s}{'終値NaN':>8s}{'出来高0':>8s}{'分割(yfinance上の日付)'}")
    hist = {}
    for t in cfg["yfinance"]["tickers"]:
        tk = t["ticker"]
        if not t.get("enabled", True):
            continue
        try:
            df = prices.fetch_history(tk, cfg["yfinance"]["start"], cfg["http"])
            hist[tk] = (t, df)
            sp = {str(k.date()): v for k, v in df[df["splits"] > 0]["splits"].items()}
            fin = prices.is_final(df.index[-1], t["market"], cfg)
            P(f"  {tk:10s}{str(df.index.min().date()) + '〜' + str(df.index.max().date()):25s}{len(df):>7d}{str(df.index[-1].date()):>12s}"
              f"{int(df['close'].isna().sum()):>8d}{int((df['volume'] == 0).sum()):>8d}  {sp or 'なし'}{'' if fin else '  ※最終行は未確定の足(除外されます)'}")
        except FetchError as e:
            P(f"  {tk:10s}NG    {str(e).splitlines()[0]}")
            problems.append(f"yfinance {tk}: {str(e).splitlines()[0]}")

    P("")
    P("4. 日本株の終値照合表（直近の確定5営業日。証券会社画面と見比べてください）")
    P("  注意: yfinanceのCloseは分割調整済み。分割日より前の日付は取引所の生の終値と一致しません。場中・未確定の日は含めません。")
    members = [m for m in cfg["basket"]["members"] if m in hist]
    extra = [t["ticker"] for t in cfg["yfinance"]["tickers"] if t["role"] == "jp_optional" and t["ticker"] in hist]
    bm = cfg["basket"]["benchmark"]
    cols = ([bm] if bm in hist else []) + members + extra
    if members:
        vol = pd.concat([((hist[m][1]["volume"] > 0) & hist[m][1]["close"].notna()).astype(int).rename(m) for m in members], axis=1).fillna(0)
        need = int(np.ceil(len(cfg["basket"]["members"]) / 2))
        cal = vol.index[vol.sum(axis=1) >= need]
        cal = [d for d in cal if prices.is_final(d, "JP", cfg)]
        last5 = cal[-5:]
        P("  日付        " + "".join(f"{c:>12s}" for c in cols))
        for d in last5:
            cells = []
            for c in cols:
                v = hist[c][1]["close"].get(d, np.nan)
                cells.append(f"{'(欠損)' if pd.isna(v) else format(v, ',.1f'):>12s}")
            P(f"  {d.date()}  " + "".join(cells))
        P("  → 画面の値と一致したら、config.yaml の verification に範囲を追記してください(未記入の範囲は「未確認」と表示されます)。")
        if bm in hist:
            miss = [str(d.date()) for d in cal[-60:] if d not in hist[bm][1].index or pd.isna(hist[bm][1]["close"].get(d, np.nan))]
            P("")
            P("5. 欠損チェック（直近60営業日）")
            P(f"  {bm} が欠損の営業日(バスケット多数が取引した日): {miss or 'なし'}")
            if miss:
                problems.append(f"{bm} 欠損: {', '.join(miss)} → data/manual/{C.safe_name(bm)}.csv で補完(templates/ 参照)")
        for m in members:
            z = [str(d.date()) for d in hist[m][1].index[hist[m][1]["volume"] == 0] if d >= (cal[-60] if len(cal) >= 60 else cal[0])]
            P(f"  {m} の出来高0の行(直近60営業日付近): {z or 'なし'}")
    if intraday and members:
        P("")
        P("   [--intraday] 5分足の最終足と日足Closeの比較（クロージング・オークションの有無の目安）")
        import yfinance as yf
        for tk in members[:2]:
            try:
                m5 = yf.Ticker(tk).history(period="5d", interval="5m", auto_adjust=False)
                m5.index = m5.index.tz_convert("Asia/Tokyo")
                for day, g in m5.groupby(m5.index.date):
                    dc = hist[tk][1]["close"].get(pd.Timestamp(day), np.nan)
                    P(f"   {tk} {day} 最終足{g.index[-1]:%H:%M} 終値{g['Close'].iloc[-1]:,.1f} / 日足Close {dc:,.1f}")
            except Exception as e:
                P(f"   {tk}: 5分足を取得できません({type(e).__name__})")

    P("")
    P("6. BAA10Y / AAA10Y の取得可能期間・頻度・欠損 → 上の「2. FRED系列」の該当行を参照")
    P("")
    P("7. 要対処")
    if problems:
        for p in problems:
            P(f"  - {p}")
    else:
        P("  なし")
    text = "\n".join(L)
    out = C.output_dir(cfg)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"check_env_{now:%Y%m%d_%H%M}.txt"
    path.write_text(text, encoding="utf-8")
    return text, path
