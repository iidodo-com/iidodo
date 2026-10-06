import unittest
from unittest import mock

import numpy as np
import pandas as pd
import requests

from semimacro import fred, hypothesis as H, mapping, manual
from semimacro.align import align_us_to_jp
from semimacro.datasets import load_all
from semimacro.store import Store
from tests.helpers import px_frame, synthetic_pair, tmp_cfg

D = pd.to_datetime


class FakeResp:
    def __init__(self, status=200, payload=None, headers=None):
        self.status_code, self._p, self.headers = status, payload or {}, headers or {}
        self.text = "{}"

    def json(self):
        return self._p


class TestFredErrors(unittest.TestCase):
    def setUp(self):
        self.http = {"timeout_sec": 1, "retries": 0, "backoff_sec": 0}

    def test_missing_key(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(fred.FetchError) as cm:
                fred.fetch_meta("DGS10", self.http)
        self.assertIn("FRED_API_KEY", str(cm.exception))
        self.assertIn("対処", str(cm.exception))

    def _run(self, resp=None, exc=None):
        with mock.patch.dict("os.environ", {"FRED_API_KEY": "x" * 32}), \
                mock.patch("requests.get", side_effect=exc) if exc else mock.patch("requests.get", return_value=resp):
            with self.assertRaises(fred.FetchError) as cm:
                fred.fetch_meta("DGS10", self.http)
        return str(cm.exception)

    def test_rate_limit(self):
        self.assertIn("レート制限", self._run(FakeResp(429, headers={"Retry-After": "0"})))

    def test_connection_error(self):
        self.assertIn("接続できません", self._run(exc=requests.exceptions.ConnectionError()))

    def test_timeout(self):
        self.assertIn("タイムアウト", self._run(exc=requests.exceptions.Timeout()))

    def test_series_gone(self):
        m = self._run(FakeResp(400, {"error_message": "Bad Request.  The series does not exist."}))
        self.assertIn("見つかりません", m)
        self.assertIn("推測で当てはめない", m)

    def test_bad_key(self):
        self.assertIn("APIキーが無効", self._run(FakeResp(400, {"error_message": "Bad Request.  The value for variable api_key is not registered."})))


class TestFredUpdate(unittest.TestCase):
    def test_incremental_fetch_and_revision_detection(self):
        cfg = tmp_cfg()
        store = Store(cfg)
        spec = {"id": "TEST1", "name": "t", "kind": "rate", "unit": "%"}
        info = {"id": "TEST1", "title": "T", "observation_start": "2020-01-01", "observation_end": "2020-01-10",
                "frequency": "Daily", "units": "Percent", "last_updated": "x"}
        first = pd.DataFrame({"value": [1.0, np.nan, 3.0]}, index=D(["2020-01-01", "2020-01-02", "2020-01-03"]))
        second = pd.DataFrame({"value": [3.5, 4.0]}, index=D(["2020-01-03", "2020-01-06"]))
        with mock.patch.object(fred, "fetch_meta", return_value=info), \
                mock.patch.object(fred, "fetch_observations", return_value=(first, "{}")):
            m1 = fred.update_series(store, spec, cfg)
        self.assertEqual(m1["n_missing_total"], 1)
        with mock.patch.object(fred, "fetch_meta", return_value=info), \
                mock.patch.object(fred, "fetch_observations", return_value=(second, "{}")) as fo:
            m2 = fred.update_series(store, spec, cfg)
        # 差分取得: 最終日(1/3)から overlap_days 遡った日付から取る
        self.assertEqual(fo.call_args[0][1], "2019-12-13")
        self.assertEqual(m2["n_revised_in_overlap"], 1)          # 1/3 が 3.0 -> 3.5
        df = store.read("TEST1")
        self.assertEqual(df["value"].dropna().tolist(), [1.0, 3.5, 4.0])
        self.assertEqual(m2["last_date"], "2020-01-06")
        self.assertTrue(list((store.raw_dir / "TEST1").glob("*.json")))   # 生データが取得日時つきで残る


class TestMapping(unittest.TestCase):
    def test_dates_match_align_values(self):
        us = pd.Series([1.0, 2.0, np.nan, 4.0, 5.0], index=D(["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-08"]), name="s")
        jp = D(["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09"])
        vals = align_us_to_jp(us, jp)
        v2, used = mapping.align_values(us, jp, strict=True)
        self.assertEqual(vals.tolist(), v2.tolist())
        self.assertEqual([str(u.date()) for u in used], ["2026-10-01", "2026-10-02", "2026-10-02", "2026-10-06", "2026-10-08"])

    def test_same_day_for_us_calendar(self):
        us = pd.Series([1.0, 2.0], index=D(["2026-10-05", "2026-10-06"]))
        v, used = mapping.align_values(us, D(["2026-10-06"]), strict=False)
        self.assertEqual(v.tolist(), [2.0])


class TestManual(unittest.TestCase):
    def test_fill_and_conflict(self):
        df = px_frame(D(["2026-10-02", "2026-10-06"]), [100.0, 110.0])
        man = pd.DataFrame({"close_adj": [105.0, 120.0], "adjusted": ["none", "none"], "close_raw": [None, None],
                            "source": ["SBI画面", "SBI画面"], "note": [None, None]}, index=D(["2026-10-05", "2026-10-06"]))
        out, flags = manual.apply_manual(df, man, 0.005)
        self.assertEqual(out.loc["2026-10-05", "close"], 105.0)
        self.assertEqual(out.loc["2026-10-05", "src"], "manual")
        self.assertEqual(out.loc["2026-10-06", "close"], 110.0)            # yfinanceを優先
        self.assertEqual(sorted(f["kind"] for f in flags), ["manual_conflict", "manual_filled"])

    def test_bad_adjusted_value_message(self):
        import tempfile, pathlib
        p = pathlib.Path(tempfile.mkdtemp()) / "x.csv"
        p.write_text("date,close_adj,adjusted\n2026-10-05,100,foo\n", encoding="utf-8")
        with self.assertRaises(manual.ManualError) as cm:
            manual.read_manual(p)
        self.assertIn("none / split / split+div", str(cm.exception))


class TestDatasets(unittest.TestCase):
    def _setup(self):
        cfg = tmp_cfg()
        cfg["yfinance"]["tickers"] = [
            {"ticker": "^N225", "name": "n", "role": "index", "market": "JP", "enabled": True},
            {"ticker": "A.T", "name": "a", "role": "jp_stock", "market": "JP", "enabled": True},
            {"ticker": "B.T", "name": "b", "role": "jp_stock", "market": "JP", "enabled": True},
            {"ticker": "C.T", "name": "c", "role": "jp_stock", "market": "JP", "enabled": True},
            {"ticker": "D.T", "name": "d", "role": "jp_stock", "market": "JP", "enabled": True}]
        cfg["basket"]["members"] = ["A.T", "B.T", "C.T", "D.T"]
        cfg["fred"]["series"] = []
        store = Store(cfg)
        days = pd.bdate_range("2026-09-28", periods=10)        # 0..9
        base = {"A.T": 100.0, "B.T": 200.0, "C.T": 300.0, "D.T": 400.0}
        for t, b in base.items():
            close = [b * (1 + 0.01 * i) for i in range(10)]
            vol = [1000.0] * 10
            if t == "A.T":
                vol[5] = 0.0                       # 1銘柄だけ出来高0 -> 要確認
            if t in base:
                vol[3] = 0.0 if True else 1000.0   # 全銘柄が出来高0 -> 非取引日扱い
            store.write(t.replace("^", ""), px_frame(days, close, vol))
        n225 = px_frame(days, [1000.0 * (1 + 0.005 * i) for i in range(10)], [0.0] * 10)
        n225 = n225.drop(days[7])                  # 日経平均の1日が取得元欠損
        n225 = n225.drop(days[3])
        store.write("N225", n225)
        return cfg, store, days

    def test_flags_calendar_and_basket(self):
        cfg, store, days = self._setup()
        d = load_all(cfg, store)
        kinds = {(f["kind"], f["series"], str(pd.Timestamp(f["date"]).date())) for f in d.flags}
        self.assertIn(("zero_volume_check", "A.T", str(days[5].date())), kinds)         # 要確認(断定しない)
        self.assertIn(("zero_volume_excluded", "B.T", str(days[3].date())), kinds)      # 全銘柄0
        self.assertNotIn(days[3], d.jp_cal)                                              # 非取引日はカレンダーから外す
        self.assertIn(("missing_vs_calendar", "^N225", str(days[7].date())), kinds)
        self.assertIn(("relative_excluded", "BASKET_REL", str(days[7].date())), kinds)
        # 日1(i=1)のバスケット日次リターン: 全銘柄 +1%/(1.00) -> 各銘柄 1.01/1.00-1 = 1%
        self.assertAlmostEqual(d.basket.loc[days[1], "ret"], 0.01)
        # 全銘柄が出来高0の日(i=3)はカレンダー外なので、i=4 のリターンは i=2 比で span=1 の通常の1日リターン
        self.assertEqual(d.stock_ret["B.T"].loc[days[4], "span"], 1)
        self.assertAlmostEqual(d.stock_ret["B.T"].loc[days[4], "ret"], 1.04 / 1.02 - 1)
        # A.T の i=6 は、除外された i=5 をまたぐ(span=2)ので1日リターンとして扱わない
        self.assertEqual(d.stock_ret["A.T"].loc[days[6], "span"], 2)
        self.assertTrue(np.isnan(d.stock_ret["A.T"].loc[days[6], "ret"]))
        # A.T は i=5 が除外 → i=6 のリターンは span=2 で除外、バスケットは残り3銘柄の平均
        self.assertEqual(d.basket.loc[days[6], "n_used"], 3)
        # 日経平均: 欠損日(i=7)は前日値で埋めない。i=8 は span=2 で相対計算から除外
        self.assertTrue(np.isnan(d.basket.loc[days[8], "rel_ret"]))


class TestIndexVolume(unittest.TestCase):
    def test_index_with_zero_volume_is_kept(self):
        # 回帰テスト: 指数は出来高が常に0。個別株向けの「出来高0を除外」を指数に適用してはいけない
        from semimacro.datasets import _tradable
        df = px_frame(D(["2026-10-01", "2026-10-02"]), [100.0, 101.0], volume=[0.0, 0.0])
        self.assertEqual(_tradable(df, "index").tolist(), [True, True])
        self.assertEqual(_tradable(df, "jp_stock").tolist(), [False, False])


class TestHypothesisSynthetic(unittest.TestCase):
    def _cfg(self):
        cfg = tmp_cfg()
        cfg["hypothesis"]["stats"].update(n_bootstrap=200, n_permutations=200)
        return cfg

    def test_detects_planted_lead_relation(self):
        L, P = synthetic_pair(n=3000, beta=1.0, shift=3, seed=1)
        r = H.run_pair(L, "US", P, self._cfg())
        self.assertTrue(r["verdict"].startswith("支持する"), (r["verdict"], r["reasons"]))

    def test_pure_noise_is_not_supported(self):
        for seed in (11, 12):
            L, P = synthetic_pair(n=3000, beta=0.0, seed=seed)
            r = H.run_pair(L, "US", P, self._cfg())
            self.assertFalse(r["verdict"].startswith("支持する"), (seed, r["verdict"], r["reasons"]))

    def test_short_sample_20day_windows_not_eligible(self):
        L, P = synthetic_pair(n=780, beta=0.0, seed=3)         # ICE系OASと同程度の長さ
        r = H.run_pair(L, "US", P, self._cfg())
        self.assertNotIn((20, 20), r["eligible_kh"])
        self.assertNotIn((20, 5), r["eligible_kh"])
        self.assertIn((5, 5), r["eligible_kh"])

    def test_too_short_is_undecidable(self):
        L, P = synthetic_pair(n=300, beta=1.0, shift=3, seed=4)
        r = H.run_pair(L, "US", P, self._cfg())
        self.assertEqual(r["verdict"], "判断できない")

    def test_jp_target_uses_strictly_previous_us_date(self):
        L, P = synthetic_pair(n=400, beta=0.0, seed=5)
        jp_days = P.index + pd.Timedelta(days=0)               # 同じ暦日の日本日付
        r = H.run_pair(L, "JP", P, self._cfg(), inference=False)
        dm = r["date_map"]
        self.assertTrue((pd.DatetimeIndex(dm["us_date_used"]) < dm.index).all())   # 同日の米国値は使わない


if __name__ == "__main__":
    unittest.main(verbosity=2)
