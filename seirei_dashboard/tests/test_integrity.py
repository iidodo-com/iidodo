"""取得・整形データの整合性テスト（data/dataset.json と data/manifest.json が対象）。

  python -m unittest discover -s tests -v   （seirei_dashboard/ で実行）

先に fetch_data.py → build_data.py を実行しておくこと。
国勢調査（e-Stat API）が未取得の場合、該当テストは skip（理由を表示）する。
"""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT / "data" / "dataset.json"
MANIFEST = ROOT / "data" / "manifest.json"

STAFF_PARTS = ["一般管理", "福祉関係", "一般行政計", "教育", "警察", "消防", "普通会計計", "公営企業等会計", "合計"]


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DATASET.exists():
            raise unittest.SkipTest("data/dataset.json がありません（fetch_data.py と build_data.py を先に実行）")
        cls.d = json.loads(DATASET.read_text(encoding="utf-8"))
        cls.m = json.loads(MANIFEST.read_text(encoding="utf-8"))
        cls.ind = {i["id"]: i for i in cls.d["indicators"]}
        cls.codes = [c["code"] for c in cls.d["cities"]]
        cls.name = {c["code"]: c["name"] for c in cls.d["cities"]}
        cls.integ = cls.d["integrity"]

    def val(self, iid, code):
        v = self.ind[iid]["values"][code]
        self.assertEqual(v["status"], "ok", f"{iid}/{self.name[code]} が ok でない: {v}")
        return v["value"]


class TestCities(Base):
    def test_20_designated_cities(self):
        self.assertEqual(len(self.codes), 20)
        self.assertEqual(len(set(self.codes)), 20)
        self.assertIn(self.d["highlight"], self.codes)
        self.assertEqual(self.name[self.d["highlight"]], "広島市")

    def test_every_indicator_has_all_cities(self):
        for i in self.d["indicators"]:
            self.assertEqual(set(i["values"]), set(self.codes), i["id"])


class TestStaff(Base):
    def test_staff_rows_present_for_all_cities(self):
        cities = self.integ["teiin"]["cities"]
        self.assertEqual(set(cities), set(self.name.values()))

    def test_staff_parts_add_up(self):
        """一般管理＋福祉＝一般行政計、一般行政＋教育＋警察＋消防＝普通会計計、普通会計＋公営企業等＝合計。"""
        for n, r in self.integ["teiin"]["cities"].items():
            self.assertEqual(r["一般管理"] + r["福祉関係"], r["一般行政計"], n)
            self.assertEqual(r["一般行政計"] + r["教育"] + r["警察"] + r["消防"], r["普通会計計"], n)
            self.assertEqual(r["普通会計計"] + r["公営企業等会計"], r["合計"], n)

    def test_staff_column_sums_match_total_row(self):
        """20市の合計が、資料の「合計」行と一致する（全9列）。"""
        total = self.integ["teiin"]["total_row"]
        self.assertIsNotNone(total, "資料の合計行を読み取れていない")
        for col in STAFF_PARTS:
            s = sum(r[col] for r in self.integ["teiin"]["cities"].values())
            self.assertEqual(s, total[col], col)

    def test_staff_indicators_equal_parsed_values(self):
        cols = {"staff_total": "合計", "staff_general": "普通会計計", "staff_admin": "一般行政計",
                "staff_edu": "教育", "staff_fire": "消防", "staff_welfare": "福祉関係"}
        for iid, col in cols.items():
            for c in self.codes:
                self.assertEqual(self.val(iid, c), self.integ["teiin"]["cities"][self.name[c]][col])


class TestPopulation(Base):
    def test_sex_sum_equals_total_and_wards_equal_city(self):
        for sid in ("jyuki_r6", "jyuki_r7"):
            for c, r in self.integ["jyuki"][sid].items():
                n = self.name[c]
                self.assertEqual(r["male"] + r["female"], r["total"], f"{sid}/{n} 男＋女≠計")
                self.assertGreater(r["ward_count"], 0, f"{sid}/{n} 区の行がない")
                for k in ("male", "female", "total", "households"):
                    self.assertEqual(r["ward_sum"][k], r[k], f"{sid}/{n} 区合計≠市計({k})")

    def test_all_cities_found_in_resident_register(self):
        for sid in ("jyuki_r6", "jyuki_r7"):
            self.assertEqual(set(self.integ["jyuki"][sid]), set(self.codes), sid)

    def test_resident_register_matches_finance_workbook_population(self):
        """住基人口（総務省・令和6.1.1）が、財政状況資料集に記載の令06.01.01人口と一致（別ファイル間の突合）。"""
        for c in self.codes:
            self.assertEqual(self.val("pop_r6", c), self.integ["zaisei"]["extra"][c]["pop_r6"], self.name[c])

    def test_workbook_city_name_matches_expected(self):
        """市別ファイルの取り違え防止（ファイル内の市町村名＝想定の市）。"""
        for c in self.codes:
            self.assertEqual(self.integ["zaisei"]["extra"][c]["city"], self.name[c])

    def test_census_consistency(self):
        cs = self.integ["census"]
        if not cs:
            self.skipTest("国勢調査(e-Stat API)が未取得: " + str(self.m["sources"][-1].get("reason")))
        for c in self.codes:
            self.assertEqual(cs[c]["male"] + cs[c]["female"], cs[c]["total"], self.name[c])
            self.assertEqual(self.val("pop_census", c), cs[c]["total"])

    # 2つの公的資料（e-Stat API と 財政状況資料集の「令和2年国調」欄）の突合。
    # 確認済みの差異のみ許容する。差異が増減・変化したらテストが失敗して気づける。
    KNOWN_CENSUS_DIFF = {"14150": {"estat": 725493, "zaisei": 725489}}  # 相模原市（4人差）

    def test_census_matches_finance_workbook_except_known(self):
        cs = self.integ["census"]
        if not cs:
            self.skipTest("国勢調査(e-Stat API)が未取得")
        actual = {c: {"estat": cs[c]["total"], "zaisei": self.integ["zaisei"]["extra"][c]["pop_census"]}
                  for c in self.codes
                  if cs[c]["total"] != self.integ["zaisei"]["extra"][c]["pop_census"]}
        self.assertEqual(actual, self.KNOWN_CENSUS_DIFF)
        self.assertEqual(self.integ["census_vs_zaisei_diff"], self.KNOWN_CENSUS_DIFF)
        self.assertIn("差異", self.ind["pop_census"]["note"])  # 画面注記に反映されている


class TestDerived(Base):
    def test_derived_values_recompute_from_inputs(self):
        for i in self.d["indicators"]:
            if i["kind"] != "derived":
                continue
            for c in self.codes:
                v = i["values"][c]
                if v["status"] != "ok":
                    continue
                self.assertAlmostEqual(v["value"], v["numerator"] / v["denominator"] * i["multiplier"],
                                       places=3, msg=f"{i['id']}/{self.name[c]}")

    def test_derived_inputs_equal_source_indicators(self):
        """派生指標が保持する入力値が、元指標の値と一致する（元の値を併記しているため）。"""
        for i in self.d["indicators"]:
            if i["kind"] != "derived":
                continue
            for c in self.codes:
                v = i["values"][c]
                if v["status"] != "ok":
                    continue
                for iid, x in v["inputs"].items():
                    self.assertEqual(x, self.ind[iid]["values"][c]["value"], f"{i['id']}/{iid}/{self.name[c]}")

    def test_per_10k_denominator_is_resident_register_r6(self):
        for iid in [k for k in self.ind if k.endswith("_per10k")]:
            for c in self.codes:
                self.assertEqual(self.ind[iid]["values"][c]["denominator"], self.val("pop_r6", c))

    def test_derived_have_formula_and_year_basis(self):
        for i in self.d["indicators"]:
            self.assertTrue(i["basis"], i["id"])
            if i["kind"] == "derived":
                self.assertTrue(i["formula"], i["id"])
                self.assertTrue(i["inputs"], i["id"])
                self.assertTrue(i["numerator_label"] and i["denominator_label"], i["id"])

    def test_per10k_not_mixed_with_other_population_year(self):
        """人口あたり指標の分母は住基令和6.1.1に固定（国調・令和7年人口と混在させない）。"""
        for iid in [k for k in self.ind if k.endswith("_per10k") or k.endswith("_percap")]:
            self.assertIn("pop_r6", self.ind[iid]["inputs"], iid)
            self.assertNotIn("pop_r7", self.ind[iid]["inputs"], iid)
            self.assertNotIn("pop_census", self.ind[iid]["inputs"], iid)


class TestFinance(Base):
    def test_finance_values_in_plausible_range(self):
        """明らかな読み取り誤り（桁・列ずれ）の検出。範囲は資料の定義上あり得る広めの幅。"""
        rng = {"fin_zaiseiryoku": (0.3, 1.5), "fin_keijo": (70, 110), "fin_jissitsu_kousai": (-5, 25)}
        for iid, (lo, hi) in rng.items():
            for c in self.codes:
                v = self.val(iid, c)
                self.assertTrue(lo <= v <= hi, f"{iid}/{self.name[c]}={v}")

    def test_revenue_not_less_than_expenditure(self):
        """歳入総額 ≧ 歳出総額（実質収支が黒字・赤字いずれでも歳入歳出差引は非負という会計上の前提）。"""
        for c in self.codes:
            self.assertGreaterEqual(self.val("fin_saisyutsu_in", c), self.val("fin_saisyutsu", c), self.name[c])

    def test_dash_values_are_not_ranked_or_numeric(self):
        for i in self.d["indicators"]:
            for c, v in i["values"].items():
                if v["status"] == "dash":
                    self.assertIsNone(v["value"])
                    self.assertTrue(v["raw_text"])

    def test_hiroshima_spot_check(self):
        """資料（広島市 総括表）の値を直接確認した広島市の値（令和5年度）。"""
        h = "34100"
        self.assertEqual(self.val("fin_keijo", h), 98.7)
        self.assertEqual(self.val("fin_zaiseiryoku", h), 0.78)
        self.assertEqual(self.val("fin_shorai", h), 165.4)
        self.assertEqual(self.val("staff_total", h), 15824)
        self.assertEqual(self.val("pop_r6", h), 1178773)


class TestProvenance(Base):
    def test_every_source_has_required_record(self):
        for s in self.d["sources"]:
            for k in ("name", "stat_id", "page_url", "estat_url", "survey_date", "retrieved_at", "status"):
                self.assertTrue(s.get(k), f"{s['id']}.{k} がない")
            self.assertTrue(s["files"], s["id"])
            if s["status"] == "ok":
                self.assertTrue(s.get("updated"), f"{s['id']} の更新時期が記録されていない")
                for f in s["files"]:
                    self.assertTrue(f["url"].startswith("https://"), f["url"])
                    self.assertEqual(len(f["sha256"] or ""), 64, f["name"])

    def test_sources_only_public_domains(self):
        ok = ("https://www.soumu.go.jp/", "https://www.e-stat.go.jp/", "https://api.e-stat.go.jp/")
        for s in self.d["sources"]:
            for u in [s["page_url"], s["estat_url"]] + [f["url"] for f in s["files"]]:
                self.assertTrue(u.startswith(ok), f"公的統計以外のURL: {u}")

    def test_indicators_reference_known_sources(self):
        ids = {s["id"] for s in self.d["sources"]}
        for i in self.d["indicators"]:
            self.assertTrue(set(i["sources"]) <= ids, i["id"])

    def test_missing_is_explicit_never_filled(self):
        for i in self.d["indicators"]:
            for c, v in i["values"].items():
                if v["status"] == "missing":
                    self.assertIsNone(v["value"], f"{i['id']}/{c} 未取得なのに値がある")
                    self.assertTrue(v.get("reason"))
                if v["status"] == "ok":
                    self.assertIsNotNone(v["value"])

    def test_no_secret_in_saved_files(self):
        """appId 等の秘密情報が保存物に混入していない。"""
        for p in (DATASET, MANIFEST):
            t = p.read_text(encoding="utf-8")
            self.assertNotIn("appId=", t, p.name)


if __name__ == "__main__":
    unittest.main()
