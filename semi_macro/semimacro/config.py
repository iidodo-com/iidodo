"""設定の読み込みと .env の読み込み(python-dotenv 不要の簡易版)。"""
import os
from pathlib import Path

import yaml

PROJECT_DIR = Path(__file__).resolve().parent.parent


class ConfigError(Exception):
    pass


def load_dotenv(path=None):
    """`KEY=VALUE` 形式の .env を読み、未設定の環境変数だけ設定する。値は表示しない。"""
    path = Path(path) if path else PROJECT_DIR / ".env"
    if not path.exists():
        return False
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v
    return True


def load_config(path=None):
    path = Path(path) if path else PROJECT_DIR / "config.yaml"
    if not path.exists():
        raise ConfigError(f"設定ファイルが見つかりません: {path}\n対処: config.yaml をプロジェクト直下に置いてください。")
    try:
        cfg = yaml.safe_load(path.read_text(encoding="utf-8-sig"))
    except yaml.YAMLError as e:
        raise ConfigError(f"config.yaml の書式が正しくありません: {e}\n対処: インデント(スペース)とコロンの後の空白を確認してください。")
    cfg["_path"] = str(path)
    return cfg


def data_dir(cfg):
    d = Path(cfg["paths"]["data_dir"])
    return d if d.is_absolute() else PROJECT_DIR / d


def output_dir(cfg):
    d = Path(cfg["paths"]["output_dir"])
    return d if d.is_absolute() else PROJECT_DIR / d


def safe_name(ticker):
    """ファイル名用。^ を除く(^N225 -> N225)。"""
    return ticker.replace("^", "").replace("/", "_")
