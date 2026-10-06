"""FRED API クライアント。失敗時は原因と対処を日本語で示す。APIキーは環境変数 FRED_API_KEY から読む。"""
import os
import time

import pandas as pd
import requests

from .store import utc_iso, utc_stamp

BASE = "https://api.stlouisfed.org/fred"


class FetchError(Exception):
    """利用者向けの日本語メッセージを持つ取得エラー。"""


def get_api_key():
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        raise FetchError(
            "FRED APIキーが設定されていません(環境変数 FRED_API_KEY)。\n"
            "対処: https://fred.stlouisfed.org/docs/api/api_key.html で無料のキーを取得し、\n"
            "  Windows(今後のウィンドウ用): setx FRED_API_KEY \"取得したキー\"  ← 実行後にコマンドプロンプトを開き直す\n"
            "  または、プロジェクト直下の .env ファイルに FRED_API_KEY=取得したキー と1行書く(.env は git に入りません)。")
    return key


def _request(path, params, http_cfg, series_id=""):
    key = get_api_key()
    p = dict(params, api_key=key, file_type="json")
    timeout = http_cfg.get("timeout_sec", 30)
    retries = http_cfg.get("retries", 3)
    backoff = http_cfg.get("backoff_sec", 5)
    last = None
    for attempt in range(retries + 1):
        try:
            r = requests.get(f"{BASE}/{path}", params=p, timeout=timeout)
        except requests.exceptions.Timeout:
            last = FetchError(f"[{series_id}] FREDへの接続がタイムアウトしました。\n対処: ネットワークを確認し、しばらくしてから再実行してください。")
        except requests.exceptions.ConnectionError:
            last = FetchError(f"[{series_id}] FREDに接続できません。\n対処: インターネット接続、プロキシ/社内ファイアウォール(api.stlouisfed.org への通信許可)を確認してください。")
        else:
            if r.status_code == 200:
                return r
            msg = ""
            try:
                msg = r.json().get("error_message", "")
            except Exception:
                pass
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", backoff * (2 ** attempt)))
                last = FetchError(f"[{series_id}] FREDのレート制限に達しました(HTTP 429)。\n対処: 時間をおいて再実行してください(一度に大量の系列を取らない)。")
                if attempt < retries:
                    time.sleep(min(wait, 120))
                    continue
            elif r.status_code in (400, 404) and "api_key" in msg.lower():
                raise FetchError(f"[{series_id}] APIキーが無効です: {msg}\n対処: FRED_API_KEY の値(32桁の英数字)を確認してください。キーを再発行した場合は設定し直してください。")
            elif r.status_code in (400, 404):
                raise FetchError(f"[{series_id}] 系列が見つかりません(廃止またはIDの誤り): {msg}\n"
                                 f"対処: https://fred.stlouisfed.org/series/{series_id} を開いて存在を確認し、config.yaml のIDを直してください。似たIDを推測で当てはめないでください。")
            elif r.status_code in (401, 403):
                raise FetchError(f"[{series_id}] FREDに拒否されました(HTTP {r.status_code}): {msg}\n対処: APIキーと利用規約上の制限を確認してください。")
            else:
                last = FetchError(f"[{series_id}] FREDがエラーを返しました(HTTP {r.status_code}): {msg}\n対処: 時間をおいて再実行してください。")
        if attempt < retries:
            time.sleep(backoff * (2 ** attempt))
    raise last


def fetch_meta(series_id, http_cfg):
    r = _request("series", {"series_id": series_id}, http_cfg, series_id)
    s = r.json()["seriess"][0]
    return {k: s.get(k) for k in ("id", "title", "observation_start", "observation_end", "frequency",
                                  "units", "seasonal_adjustment", "last_updated", "notes")}


def fetch_observations(series_id, start, http_cfg):
    """(DataFrame[value], 生JSONテキスト) を返す。'.' は欠損(NaN)として保持する。"""
    r = _request("series/observations", {"series_id": series_id, "observation_start": start}, http_cfg, series_id)
    obs = r.json()["observations"]
    df = pd.DataFrame({"value": [pd.to_numeric(o["value"], errors="coerce") for o in obs]},
                      index=pd.to_datetime([o["date"] for o in obs]))
    df.index.name = "date"
    return df, r.text


def update_series(store, spec, cfg):
    """差分取得して保存する。戻り値はメタ情報(dict)。"""
    sid = spec["id"]
    http_cfg = cfg["http"]
    fcfg = cfg["fred"]
    old = store.read(sid)
    start = fcfg["start"]
    if old is not None and len(old):
        start = (old.index.max() - pd.Timedelta(days=fcfg["overlap_days"])).strftime("%Y-%m-%d")
    info = fetch_meta(sid, http_cfg)
    new, raw = fetch_observations(sid, start, http_cfg)
    stamp = utc_stamp()
    store.save_raw(sid, raw, "json", stamp)
    revised = 0
    if old is not None and len(old):
        ov = new.index.intersection(old.index)
        a, b = old.loc[ov, "value"], new.loc[ov, "value"]
        revised = int(((a - b).abs() > 1e-9).sum() + (a.isna() != b.isna()).sum())
        df = pd.concat([old.drop(new.index, errors="ignore"), new]).sort_index()
    else:
        df = new
    store.write(sid, df)
    valid = df["value"].dropna()
    last_year = df.loc[df.index > df.index.max() - pd.Timedelta(days=365)]
    meta = {
        "id": sid, "name": spec["name"], "kind": spec["kind"], "unit": spec["unit"],
        "source": "FRED (セントルイス連銀) API", "source_url": f"https://fred.stlouisfed.org/series/{sid}",
        "provider_note": info.get("title"), "frequency": info.get("frequency"), "units_fred": info.get("units"),
        "fred_observation_start": info.get("observation_start"), "fred_observation_end": info.get("observation_end"),
        "fred_last_updated": info.get("last_updated"),
        "fetched_at_utc": utc_iso(), "fetch_start_requested": start, "raw_snapshot": f"data/raw/{sid}/{stamp}.json",
        "first_date": str(valid.index.min().date()) if len(valid) else None,
        "last_date": str(valid.index.max().date()) if len(valid) else None,
        "n_rows": int(len(df)), "n_valid": int(len(valid)), "n_missing_total": int(df["value"].isna().sum()),
        "n_missing_last_365d": int(last_year["value"].isna().sum()),
        "n_revised_in_overlap": revised,
        "missing_policy": "欠損('.')は保存時も NaN のまま。前日値の持ち越しはしない。分析で日付を合わせる際の持ち越しは align 規則に従い、別途記録する。",
    }
    store.write_meta(sid, meta)
    return meta
