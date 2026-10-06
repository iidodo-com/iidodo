"""yfinance(非公式)による株価・指数の取得。取得失敗・欠損・仕様変更を前提に作る。

保存する列: open, high, low, close(分割調整済み・配当調整なし), adj_close(分割+配当調整), volume, dividends, splits
yfinance の Close は auto_adjust=False でも「分割調整済み」であり、取引所が当時公表した生の終値ではない。
"""
import io

import pandas as pd

from .fred import FetchError
from .store import utc_iso, utc_stamp

COLS = {"Open": "open", "High": "high", "Low": "low", "Close": "close", "Adj Close": "adj_close",
        "Volume": "volume", "Dividends": "dividends", "Stock Splits": "splits"}


def _yf():
    try:
        import yfinance as yf
    except ImportError:
        raise FetchError("yfinance がインストールされていません。\n対処: pip install yfinance")
    return yf


def now_jst():
    return pd.Timestamp.now(tz="Asia/Tokyo")


def is_final(date, market, cfg, now=None):
    """その日付の足が確定済みか(未確定の足は黙って使わず、除外して記録する)。"""
    now = now or now_jst()
    mh = cfg["yfinance"]["market_hours"]
    d = pd.Timestamp(date).normalize()
    if market == "JP":
        h, m = map(int, mh["jp_final_after_jst"].split(":"))
        limit = (d + pd.Timedelta(hours=h, minutes=m)).tz_localize("Asia/Tokyo")
    else:
        h, m = map(int, mh["us_final_after_jst"].split(":"))
        limit = (d + pd.Timedelta(days=1, hours=h, minutes=m)).tz_localize("Asia/Tokyo")
    return now >= limit


def fetch_history(ticker, start, http_cfg=None):
    yf = _yf()
    try:
        raw = yf.Ticker(ticker).history(start=start, interval="1d", auto_adjust=False, actions=True)
    except Exception as e:  # yfinance は多様な例外を投げる(ネットワーク・レート制限・仕様変更)
        name = type(e).__name__
        txt = str(e)
        if "Too Many Requests" in txt or "429" in txt or "RateLimit" in name:
            raise FetchError(f"[{ticker}] Yahoo Finance のレート制限に達しました。\n対処: 数分〜数時間あけて再実行してください。頻繁な定期実行は避けてください。")
        raise FetchError(f"[{ticker}] 株価の取得に失敗しました({name}: {txt[:120]})。\n"
                         "対処: ネットワークを確認し、yfinance を最新版にしてください(pip install -U yfinance)。"
                         "改善しない場合はYahoo側の仕様変更の可能性があります。手動CSV(data/manual/)で補えます。")
    if raw is None or len(raw) == 0:
        raise FetchError(f"[{ticker}] 取得結果が0件でした。\n対処: ティッカーの綴り、ネットワーク、Yahoo側の障害・仕様変更を確認してください。")
    df = raw.rename(columns=COLS)[list(COLS.values())].copy()
    df.index = pd.DatetimeIndex(df.index).tz_localize(None).normalize()
    df.index.name = "date"
    return df


def verification_for(ticker, cfg):
    """config.yaml の verification から、その銘柄の照合状況をメタ情報用にまとめる。"""
    out = []
    for v in cfg.get("verification") or []:
        if ticker in (v.get("tickers") or []):
            out.append({"from": str(v.get("from")), "to": str(v.get("to")), "status": v.get("status"),
                        "by": v.get("by"), "note": v.get("note")})
    return out or "未確認(証券会社画面との照合記録なし)"


def update_ticker(store, spec, cfg):
    """差分取得して保存する。戻り値はメタ情報。"""
    tk, market = spec["ticker"], spec["market"]
    from . import config as _c
    name = _c.safe_name(tk)
    ycfg = cfg["yfinance"]
    old = store.read(name)
    full_reason = "初回取得" if old is None or not len(old) else None
    stamp = utc_stamp()
    if full_reason is None:
        tail_start = (old.index.max() - pd.Timedelta(days=ycfg["overlap_days"])).strftime("%Y-%m-%d")
        tail = fetch_history(tk, tail_start, cfg["http"])
        ov = tail.index.intersection(old.index)
        tol = ycfg["revision_tolerance"]
        diff = False
        for c in ("close", "adj_close"):
            a, b = old.loc[ov, c], tail.loc[ov, c]
            ok = a.notna() & b.notna()
            if ok.any() and (((a[ok] - b[ok]).abs() / b[ok].abs().clip(lower=1e-12)) > tol).any():
                diff = True
        if diff:
            full_reason = "重ねた期間の終値/調整後終値が保存値と不一致(分割・配当による遡及改訂の疑い)→全期間を取り直し"
            hist = fetch_history(tk, ycfg["start"], cfg["http"])
        else:
            hist = tail
    else:
        hist = fetch_history(tk, ycfg["start"], cfg["http"])
    buf = io.StringIO()
    hist.to_csv(buf)
    store.save_raw(name, buf.getvalue(), "csv", stamp)  # 取得したままの値(未確定の足も含む)を残す

    keep = hist["close"].notna()
    dropped_nan = [str(d.date()) for d in hist.index[~keep]]
    h2 = hist[keep]
    final = pd.Series([is_final(d, market, cfg) for d in h2.index], index=h2.index)
    dropped_partial = [str(d.date()) for d in h2.index[~final]]
    h2 = h2[final]
    if old is not None and len(old) and not (full_reason or "").startswith("重ねた"):
        df = pd.concat([old.drop(h2.index, errors="ignore"), h2]).sort_index()
    else:
        df = h2.sort_index()
    store.write(name, df)
    sp = df[df["splits"] > 0]["splits"]
    try:
        import yfinance
        yfv = yfinance.__version__
    except Exception:
        yfv = "?"
    meta = {
        "ticker": tk, "name": spec["name"], "role": spec["role"], "market": market,
        "source": "Yahoo Finance (yfinance 経由・非公式)", "yfinance_version": yfv,
        "source_url": f"https://finance.yahoo.com/quote/{tk}",
        "fetched_at_utc": utc_iso(), "raw_snapshot": f"data/raw/{name}/{stamp}.csv",
        "auto_adjust": False,
        "adjust_method": "close=分割調整済み(配当調整なし) / adj_close=分割+配当調整(yfinance仕様)。取引所公表の生の終値ではない",
        "refetch": full_reason or "差分取得(直近を重ねて取得し、不一致なしを確認)",
        "first_date": str(df.index.min().date()), "last_date": str(df.index.max().date()), "n_rows": int(len(df)),
        "excluded_partial_bars": dropped_partial, "excluded_nan_close": dropped_nan[-20:],
        "splits_per_yfinance": {str(k.date()): float(v) for k, v in sp.items()},
        "split_note": "分割日はyfinance上の日付をそのまま記録。効力発生日と同じとは仮定しない。",
        "close_time_basis": "日足Close。15:30終値かどうかは照合範囲のみ確認(下記verification)" if market == "JP" else "日足Close(米国取引所終値)",
        "verification": verification_for(tk, cfg),
        "missing_policy": "欠損は補完しない。前日値の持ち越しはしない。",
    }
    store.write_meta(name, meta)
    return meta
