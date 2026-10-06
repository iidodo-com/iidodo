"""手動CSV(保険)。data/manual/<ティッカー(^除く)>.csv

必須列: date, close_adj, adjusted(none / split / split+div)
任意列: close_raw, source, note
yfinance に無い日(または終値がNaNの日)だけを補い、既存値と食い違えば警告してyfinanceを優先する。
"""
import pandas as pd

VALID_ADJ = ("none", "split", "split+div")


class ManualError(Exception):
    pass


def read_manual(path):
    for enc in ("utf-8-sig", "cp932"):
        try:
            df = pd.read_csv(path, encoding=enc)
            break
        except UnicodeDecodeError:
            continue
        except Exception as e:
            raise ManualError(f"手動CSVを読めません: {path}\n原因: {e}\n対処: 列名(date, close_adj, adjusted)とカンマ区切りを確認してください。")
    else:
        raise ManualError(f"手動CSVの文字コードを判別できません: {path}\n対処: UTF-8 か Shift_JIS(cp932) で保存してください。")
    miss = [c for c in ("date", "close_adj", "adjusted") if c not in df.columns]
    if miss:
        raise ManualError(f"手動CSVに必須列がありません({', '.join(miss)}): {path}\n対処: 列は date, close_adj, adjusted(必須) と close_raw, source, note(任意)です。")
    df = df.dropna(subset=["date"]).copy()
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"].astype(str).str.replace("/", "-"), errors="coerce")
    if df["date"].isna().any():
        raise ManualError(f"手動CSVの date を日付として読めない行があります: {path}\n対処: YYYY-MM-DD または YYYY/MM/DD で書いてください。")
    df["adjusted"] = df["adjusted"].astype(str).str.strip().str.lower()
    bad = df[~df["adjusted"].isin(VALID_ADJ)]
    if len(bad):
        raise ManualError(f"手動CSVの adjusted が不正です({bad['adjusted'].iloc[0]}): {path}\n対処: none / split / split+div のいずれかにしてください。")
    df["close_adj"] = pd.to_numeric(df["close_adj"], errors="coerce")
    if df["close_adj"].isna().any():
        raise ManualError(f"手動CSVの close_adj に数値でない行があります: {path}")
    for c in ("close_raw", "source", "note"):
        if c not in df.columns:
            df[c] = None
    return df.set_index("date").sort_index()


def apply_manual(df, man, tolerance):
    """df(yfinance由来)に手動値を適用。(df, flags[list of dict]) を返す。"""
    df = df.copy()
    if "src" not in df.columns:
        df["src"] = "yfinance"
    flags = []
    for d, r in man.iterrows():
        if r["adjusted"] in ("none", "split"):
            close = r["close_adj"]
            adj = r["close_adj"] if r["adjusted"] == "none" else float("nan")
        else:  # split+div: 調整後。close は close_raw があればそれを使う
            adj = r["close_adj"]
            cr = pd.to_numeric(r["close_raw"], errors="coerce")
            close = cr if pd.notna(cr) else float("nan")
        exists = d in df.index and pd.notna(df.loc[d, "close"])
        if exists:
            cmp_new, cmp_old = (close, df.loc[d, "close"]) if pd.notna(close) else (adj, df.loc[d, "adj_close"])
            if pd.notna(cmp_new) and cmp_old and abs(cmp_new - cmp_old) / abs(cmp_old) > tolerance:
                flags.append({"kind": "manual_conflict", "date": d, "detail":
                              f"手動値 {cmp_new} と yfinance値 {cmp_old} が {tolerance:.1%} 超ずれています(yfinanceを優先)。source={r['source']}"})
            continue
        df.loc[d, ["close", "adj_close"]] = [close, adj]
        for c in ("open", "high", "low", "volume"):
            df.loc[d, c] = float("nan")
        df.loc[d, ["dividends", "splits"]] = [0.0, 0.0]
        df.loc[d, "src"] = "manual"
        flags.append({"kind": "manual_filled", "date": d, "detail": f"手動CSVで補完(close={close}, 調整={r['adjusted']}, source={r['source']})"})
    return df.sort_index(), flags
