#!/usr/bin/env python3
"""公的統計の取得スクリプト。取得物を data/raw/ に保存し、data/manifest.json に記録する。

  python fetch_data.py                # 全取得
  ESTAT_APP_ID=xxxx python fetch_data.py   # 国勢調査(e-Stat API)も取得

appId は環境変数 ESTAT_APP_ID のみから読む（ファイル・リポジトリには保存しない）。
未設定・失敗時は status="missing" として理由を記録し、値の補完・推測はしない。
"""
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import sources as S

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "data" / "raw"
MANIFEST = ROOT / "data" / "manifest.json"
UA = "seirei-dashboard/1.0 (public statistics fetch)"


def http_get(url, retries=3):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read(), dict(r.headers), r.status
        except Exception as e:  # noqa: BLE001 - 理由を記録して再試行
            last = e
            time.sleep(2 ** i)
    raise RuntimeError(f"{url}: {last}")


def now_iso():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(timespec="seconds")


def fetch_file_source(src):
    out_dir = RAW / src["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    files, errors = [], []
    for name, url in src["files"]:
        rec = {"name": name, "url": url, "retrieved_at": now_iso()}
        try:
            body, hdr, status = http_get(url)
            (out_dir / name).write_bytes(body)
            rec.update(status="ok", http_status=status, bytes=len(body),
                       sha256=hashlib.sha256(body).hexdigest(),
                       last_modified=hdr.get("Last-Modified"))
        except Exception as e:  # noqa: BLE001
            rec.update(status="missing", reason=str(e))
            errors.append(f"{name}: {e}")
        files.append(rec)
    ok = all(f["status"] == "ok" for f in files)
    return {**{k: v for k, v in src.items() if k != "files"},
            "status": "ok" if ok else "missing", "files": files,
            "reason": "; ".join(errors) or None}


def fetch_census(app_id):
    meta = {k: v for k, v in S.CENSUS.items()}
    if not app_id:
        return {**meta, "status": "missing", "files": [],
                "reason": "環境変数 ESTAT_APP_ID 未設定のため未取得"}
    out_dir = RAW / S.CENSUS["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    areas = ",".join(c[0] for c in S.CITIES)
    q = urllib.parse.urlencode({"appId": app_id, "statsDataId": S.CENSUS["stats_data_id"],
                                "cdArea": areas, "metaGetFlg": "N", "cntGetFlg": "N"})
    url_logged = f"{S.ESTAT_API}/getStatsData?statsDataId={S.CENSUS['stats_data_id']}&cdArea={areas}"  # appId は記録しない
    rec = {"name": "census2020.json", "url": url_logged, "retrieved_at": now_iso()}
    try:
        body, hdr, status = http_get(f"{S.ESTAT_API}/getStatsData?{q}")
        d = json.loads(body)["GET_STATS_DATA"]
        if d["RESULT"]["STATUS"] != 0:
            raise RuntimeError(f"e-Stat API STATUS={d['RESULT']['STATUS']} {d['RESULT'].get('ERROR_MSG')}")
        (out_dir / "census2020.json").write_bytes(body)
        tinf = d["STATISTICAL_DATA"].get("TABLE_INF", {})
        rec.update(status="ok", http_status=status, bytes=len(body),
                   sha256=hashlib.sha256(body).hexdigest())
        meta["updated"] = tinf.get("UPDATED_DATE")
        return {**meta, "status": "ok", "files": [rec], "reason": None}
    except Exception as e:  # noqa: BLE001
        msg = str(e).replace(app_id, "***")
        rec.update(status="missing", reason=msg)
        return {**meta, "status": "missing", "files": [rec], "reason": msg}


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    result = {"fetched_at": now_iso(), "sources": []}
    for src in S.SOURCES:
        print(f"fetch {src['id']} ...", flush=True)
        result["sources"].append(fetch_file_source(src))
    print("fetch census2020 (e-Stat API) ...", flush=True)
    result["sources"].append(fetch_census(os.environ.get("ESTAT_APP_ID")))
    MANIFEST.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    bad = [s["id"] for s in result["sources"] if s["status"] != "ok"]
    print("manifest:", MANIFEST, "未取得:", bad or "なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())
