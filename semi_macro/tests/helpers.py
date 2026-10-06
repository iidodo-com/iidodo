import copy
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from semimacro.config import load_config
from semimacro.store import Store


def tmp_cfg():
    cfg = load_config()
    cfg = copy.deepcopy(cfg)
    d = tempfile.mkdtemp(prefix="semimacro_test_")
    cfg["paths"]["data_dir"] = str(Path(d) / "data")
    cfg["paths"]["output_dir"] = str(Path(d) / "output")
    return cfg


def px_frame(dates, close, volume=None, splits=None):
    n = len(dates)
    df = pd.DataFrame({"open": close, "high": close, "low": close, "close": close, "adj_close": close,
                       "volume": volume if volume is not None else [1000.0] * n,
                       "dividends": [0.0] * n, "splits": splits if splits is not None else [0.0] * n},
                      index=pd.DatetimeIndex(dates, name="date"))
    return df


def synthetic_pair(n=3000, beta=0.0, shift=3, seed=0, start="2010-01-04"):
    """スプレッド水準Lと半導体株水準P(同じ営業日)。beta>0 なら、スプレッド縮小(dL<0)の shift 日後に上昇しやすい。"""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(start, periods=n)
    dL = rng.normal(0, 1, n)
    L = pd.Series(100 + np.cumsum(dL), index=idx)
    noise = rng.normal(0, 0.01, n)
    ret = noise.copy()
    if beta:
        ret[shift:] += -beta * dL[:-shift] * 0.01
    P = pd.Series(1000 * np.exp(np.cumsum(ret)), index=idx)
    return L, P
