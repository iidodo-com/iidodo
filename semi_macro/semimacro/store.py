"""CSV・メタ情報・生データ(取得日時つき)の保存。"""
import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .config import data_dir


def utc_stamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def utc_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    def __init__(self, cfg):
        self.root = data_dir(cfg)
        self.series_dir = self.root / "series"
        self.meta_dir = self.root / "meta"
        self.raw_dir = self.root / "raw"
        self.manual_dir = self.root / "manual"
        for d in (self.series_dir, self.meta_dir, self.raw_dir, self.manual_dir):
            d.mkdir(parents=True, exist_ok=True)

    def series_path(self, name):
        return self.series_dir / f"{name}.csv"

    def read(self, name):
        p = self.series_path(name)
        if not p.exists():
            return None
        df = pd.read_csv(p, index_col=0, parse_dates=True)
        df.index.name = "date"
        return df

    def write(self, name, df):
        df = df.sort_index()
        df.index.name = "date"
        df.to_csv(self.series_path(name), encoding="utf-8")

    def read_meta(self, name):
        p = self.meta_dir / f"{name}.json"
        if not p.exists():
            return {}
        return json.loads(p.read_text(encoding="utf-8"))

    def write_meta(self, name, meta):
        (self.meta_dir / f"{name}.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    def save_raw(self, name, text, ext, fetched_at=None):
        """取得した生データを、取得日時つきで残す(分割・配当で履歴が書き換わっても再現できるように)。"""
        d = self.raw_dir / name
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{fetched_at or utc_stamp()}.{ext}"
        p.write_text(text, encoding="utf-8")
        return p
