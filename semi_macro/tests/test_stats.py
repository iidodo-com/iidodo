"""統計部品のテスト。小さなダミーデータで、手計算した既知の値と一致することを確認する。"""
import unittest

import numpy as np
import pandas as pd
from scipy import stats as sps

from semimacro import stats as S


class TestBasics(unittest.TestCase):
    def test_pearson_hand_calc(self):
        # x=[1,2,3], y=[2,4,5]: sxy=3, sxx=2, syy=14/3 -> r = 3/sqrt(28/3)
        r, n = S.pearson([1, 2, 3], [2, 4, 5])
        self.assertAlmostEqual(r, 3 / np.sqrt(28 / 3), places=12)
        self.assertEqual(n, 3)

    def test_pearson_matches_scipy(self):
        rng = np.random.default_rng(1)
        x, y = rng.normal(size=50), rng.normal(size=50)
        self.assertAlmostEqual(S.pearson(x, y)[0], sps.pearsonr(x, y)[0], places=12)

    def test_pearson_drops_nan_pairs(self):
        r, n = S.pearson([1, 2, np.nan, 3], [2, 4, 9, 5])
        self.assertEqual(n, 3)
        self.assertAlmostEqual(r, 3 / np.sqrt(28 / 3), places=12)

    def test_pearson_constant_is_nan(self):
        self.assertTrue(np.isnan(S.pearson([1, 1, 1, 1], [1, 2, 3, 4])[0]))

    def test_change_and_return_hand_calc(self):
        s = pd.Series([10.0, 11.0, 13.0, 12.0])
        self.assertEqual(S.change(s, 2).dropna().tolist(), [3.0, 1.0])            # 13-10, 12-11
        self.assertAlmostEqual(S.pct_return(s, 1).iloc[1], 0.1)                   # 11/10-1
        self.assertAlmostEqual(S.pct_return(s, 2).iloc[3], 12 / 11 - 1)

    def test_lagged_pairs_alignment(self):
        x = pd.Series([1.0, 2.0, 3.0, 4.0])
        y0 = pd.Series([10.0, 20.0, 30.0, 40.0])
        xa, ya = S.lagged_pairs(x, y0, 2)
        self.assertEqual(xa.tolist(), [1, 2, 3, 4])
        self.assertEqual(ya[:2].tolist(), [30.0, 40.0])      # y0[t+2]
        self.assertTrue(np.isnan(ya[2]) and np.isnan(ya[3]))

    def test_nonoverlap_picks_every_stride_rows(self):
        # offset=0, stride=2 -> 行 0,2,4: x=[1,3,5], y=[1,3,5] で r=1 / offset=1 -> 行 1,3: n=2 のため r は NaN(除外)
        x = pd.Series([1.0, 2, 3, 4, 5, 6])
        res = S.nonoverlap_corr(x, x, 0, 2)
        self.assertAlmostEqual(res["r_mean"], 1.0)
        self.assertAlmostEqual(res["n_mean"], 3.0)


class TestBlocks(unittest.TestCase):
    def test_block_indices_hand(self):
        # n=5, L=3, starts=[4,1] -> [4,0,1] + [1,2,3] -> 先頭5個
        self.assertEqual(S.block_indices([4, 1], 3, 5).tolist(), [4, 0, 1, 1, 2])

    def test_block_perm_indices_hand(self):
        # n=7, L=3: ブロック[0,1,2],[3,4,5],[6] を order=[2,0,1] で並べる
        self.assertEqual(S.block_perm_indices(7, 3, [2, 0, 1]).tolist(), [6, 0, 1, 2, 3, 4, 5])

    def test_maxstat_p_formula(self):
        # null=[0.1,0.6,0.5,0.2], obs=0.5 -> >=0.5 が2個 -> (1+2)/(4+1)
        self.assertAlmostEqual(S.maxstat_p(0.5, [0.1, 0.6, 0.5, 0.2]), 0.6)

    def test_bootstrap_ci_perfect_correlation(self):
        x = np.arange(100.0)
        lo, hi = S.bootstrap_ci(x, 2 * x + 1, 10, 200, 0.95, np.random.default_rng(0))
        self.assertAlmostEqual(lo, 1.0)
        self.assertAlmostEqual(hi, 1.0)

    def test_bootstrap_ci_contains_estimate_for_noisy_data(self):
        rng = np.random.default_rng(3)
        x = rng.normal(size=400)
        y = 0.5 * x + rng.normal(size=400)
        r = S.pearson(x, y)[0]
        lo, hi = S.bootstrap_ci(x, y, 10, 500, 0.95, np.random.default_rng(4))
        self.assertTrue(lo < r < hi)

    def test_bootstrap_wider_than_iid_for_autocorrelated(self):
        # 自己相関の強い系列では、ブロックブートストラップの区間が iid より広い(iidは過度に狭く出る)
        rng = np.random.default_rng(5)
        e = rng.normal(size=1000)
        x = np.cumsum(rng.normal(size=1000))
        y = np.cumsum(rng.normal(size=1000))
        lo_b, hi_b = S.bootstrap_ci(x, y, 40, 400, 0.95, np.random.default_rng(6))
        lo_i, hi_i = S.bootstrap_ci(x, y, 1, 400, 0.95, np.random.default_rng(6))
        self.assertGreater(hi_b - lo_b, hi_i - lo_i)

    def test_longest_run(self):
        self.assertEqual(S.longest_run([False, True, True, False, True, True, True]), (3, 4))
        self.assertEqual(S.longest_run([False, False]), (0, 0))


def _crit(**kw):
    c = dict(alpha=0.05, min_effective_n_total=100, min_effective_n_per_split=50, min_consecutive_lags=3,
             equivalence_r=0.10, require_split_sign_agreement=True)
    c.update(kw)
    return c


def _cells(r_by_lag, **over):
    n = len(r_by_lag)
    d = pd.DataFrame({"k": [5] * n, "h": [5] * n, "lag": list(range(n)), "r": r_by_lag,
                      "n_eff_total": 200.0, "n_eff_split_min": 100.0, "p_adj": 0.5,
                      "ci_lo": -0.2, "ci_hi": 0.2, "split_signs_neg": True})
    for k, v in over.items():
        d[k] = v
    return d


class TestDecide(unittest.TestCase):
    def test_insufficient_sample_is_undecidable(self):
        d = _cells([-0.3] * 5, n_eff_total=39.0, n_eff_split_min=19.0, p_adj=0.001, ci_hi=-0.1)
        self.assertEqual(S.decide(d, _crit())[0], "判断できない")

    def test_support_requires_all_conditions(self):
        r = [-0.05, -0.2, -0.22, -0.18, -0.04]
        d = _cells(r, p_adj=[0.5, 0.03, 0.01, 0.04, 0.5], ci_hi=[0.1, -0.05, -0.08, -0.03, 0.1])
        self.assertTrue(S.decide(d, _crit())[0].startswith("支持する"))
        # 分割期間で符号が一致しなければ支持しない(判断できない)
        d2 = d.copy(); d2["split_signs_neg"] = False
        self.assertEqual(S.decide(d2, _crit())[0], "判断できない")
        # 負の相関が1ラグだけ(連続しない)なら支持しない
        d3 = _cells([0.1, -0.3, 0.1, 0.1, 0.1], p_adj=[0.5, 0.001, 0.5, 0.5, 0.5], ci_hi=[0.3, -0.1, 0.3, 0.3, 0.3])
        self.assertEqual(S.decide(d3, _crit())[0], "判断できない")

    def test_opposite_direction_significant_is_not_supported(self):
        d = _cells([0.3, 0.25, 0.2], p_adj=0.01, ci_lo=0.1, ci_hi=0.4)
        self.assertEqual(S.decide(d, _crit())[0], "支持しない")

    def test_equivalence_not_supported(self):
        d = _cells([0.01, -0.02, 0.0, 0.02], ci_lo=-0.05, ci_hi=0.06)
        self.assertEqual(S.decide(d, _crit())[0], "支持しない")

    def test_wide_ci_no_signal_is_undecidable(self):
        d = _cells([0.01, -0.02, 0.0, 0.02], ci_lo=-0.18, ci_hi=0.2)
        self.assertEqual(S.decide(d, _crit())[0], "判断できない")


if __name__ == "__main__":
    unittest.main(verbosity=2)
