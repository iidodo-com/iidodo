import unittest, pandas as pd, numpy as np
from semimacro.align import align_us_to_jp, forward_return
D = pd.to_datetime

class T(unittest.TestCase):
    def test_tue_jp_gets_mon_us_not_same_day(self):
        us = pd.Series([1.0, 2.0, 3.0], index=D(["2026-10-05", "2026-10-06", "2026-10-07"]))  # 月火水
        r = align_us_to_jp(us, D(["2026-10-06", "2026-10-07"]))
        self.assertEqual(r.tolist(), [1.0, 2.0])          # 日本火=米月、日本水=米火(同日は使わない)
    def test_jp_monday_gets_us_friday(self):
        us = pd.Series([10.0, 20.0], index=D(["2026-10-02", "2026-10-05"]))  # 金・月
        r = align_us_to_jp(us, D(["2026-10-05"]))
        self.assertEqual(r.tolist(), [10.0])               # 日本月=米金(米金終値は土曜朝JST)
    def test_jp_holiday_same_us_level_gives_zero_change(self):
        us = pd.Series([10.0, 20.0], index=D(["2026-10-02", "2026-10-05"]))  # 金・月
        r = align_us_to_jp(us, D(["2026-10-05", "2026-10-07"]))  # 日本は月(取引)、火が休場→水
        self.assertEqual(r.tolist(), [10.0, 20.0])         # 水は米月(火の米値は無い想定)
    def test_us_holiday_repeats_level(self):
        us = pd.Series([10.0, 30.0], index=D(["2026-10-02", "2026-10-06"]))  # 米月(10/5)休場
        r = align_us_to_jp(us, D(["2026-10-05", "2026-10-06"]))  # 日本 月・火
        self.assertEqual(r.tolist(), [10.0, 10.0])         # 日本火も米金のまま -> 変化0=新情報なし
        self.assertEqual(r.diff().iloc[1], 0.0)
    def test_missing_us_value_not_filled_across_nan(self):
        us = pd.Series([10.0, np.nan, 30.0], index=D(["2026-10-01", "2026-10-02", "2026-10-05"]))
        r = align_us_to_jp(us, D(["2026-10-05"]))
        self.assertEqual(r.tolist(), [10.0])               # NaN日は飛ばし、直前の有効値(持ち越し)。持ち越しは別途記録する
    def test_forward_return_hand_calc(self):
        c = pd.Series([100., 110., 121., 133.1, 100.], index=range(5))
        f = forward_return(c, lag=0, h=2)
        self.assertAlmostEqual(f[0], 121 / 100 - 1)
        self.assertAlmostEqual(f[2], 100 / 121 - 1)
        self.assertTrue(np.isnan(f[3]) and np.isnan(f[4]))
        g = forward_return(c, lag=1, h=1)                   # close(j+2)/close(j+1)-1
        self.assertAlmostEqual(g[0], 121 / 110 - 1)
        self.assertAlmostEqual(g[2], 100 / 133.1 - 1)
    def test_no_lookahead_future_change_does_not_affect_past(self):
        c = pd.Series([100., 110., 121., 133.1, 100.], index=range(5))
        c2 = c.copy(); c2[4] = 999.0
        a, b = forward_return(c, 1, 1), forward_return(c2, 1, 1)
        self.assertEqual(a[:2].tolist(), b[:2].tolist())    # 最終日を変えても、窓が最終日に届かない日は不変
if __name__ == "__main__":
    unittest.main(verbosity=2)
