"""python tests/test_core.py  — 各形式の作成→結合→編集を実ファイルで検証する(架空データ)。"""
import sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import core
from pypdf import PdfReader


def text_of(p, i=0):
    return PdfReader(str(p)).pages[i].extract_text()


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.td = Path(tempfile.mkdtemp())
        d = cls.td
        import docx, openpyxl, pptx
        from PIL import Image
        doc = docx.Document(); doc.add_paragraph("ワード文書 ALPHA"); doc.save(d / "a.docx")
        wb = openpyxl.Workbook(); wb.active["A1"] = "エクセル BETA"; wb.save(d / "b.xlsx")
        pr = pptx.Presentation(); s = pr.slides.add_slide(pr.slide_layouts[0]); s.shapes.title.text = "パワポ GAMMA"
        pr.save(d / "c.pptx")
        Image.new("RGB", (200, 100), "blue").save(d / "e.png")
        (d / "f.txt").write_text("テキスト DELTA\n二行目", encoding="utf-8")
        core.to_pdf(d / "f.txt", d / "base.pdf")

    def test_merge_all_formats(self):
        d = self.td
        out = core.merge([d / "a.docx", d / "b.xlsx", d / "c.pptx", d / "base.pdf", d / "e.png", d / "f.txt"], d / "all.pdf")
        r = PdfReader(str(out))
        self.assertGreaterEqual(len(r.pages), 6)
        allt = "".join(p.extract_text() for p in r.pages)
        for k in ("ALPHA", "BETA", "GAMMA", "DELTA"):
            self.assertIn(k, allt)
        self.assertEqual([o.title for o in r.outline], ["a", "b", "c", "base", "e", "f"])

    def test_edit_ops(self):
        d = self.td
        core.merge([d / "base.pdf", d / "base.pdf", d / "base.pdf"], d / "three.pdf")
        e = lambda op, **kw: core.edit(d / "three.pdf", d / f"o_{op}.pdf", op, kw)
        self.assertEqual(len(PdfReader(str(e("delete", pages="2"))).pages), 2)
        self.assertEqual(len(PdfReader(str(e("arrange", pages=[3, 1, 1]))).pages), 3)
        self.assertEqual(PdfReader(str(e("rotate", pages=[1], angle=90))).pages[0].rotation, 90)
        self.assertEqual(len(PdfReader(str(e("insert_blank", after=1, count=2))).pages), 5)
        self.assertIn("1 / 3", text_of(e("page_numbers")))
        self.assertIn("社外秘", text_of(e("watermark", text="社外秘")))
        self.assertIn("追記", text_of(e("add_text", page=1, x=100, y=100, text="追記")))
        e("rect", page=1, x=10, y=10, width=50, height=20, color="#000000")
        e("compress")
        self.assertEqual(PdfReader(str(e("metadata", title="題"))).metadata.title, "題")
        with self.assertRaises(core.PdfStudioError):
            e("delete", pages="1-3")
        with self.assertRaises(core.PdfStudioError):
            e("delete", pages="9")

    def test_rotated_page_overlay(self):
        d = self.td
        core.edit(d / "base.pdf", d / "rot.pdf", "rotate", {"angle": 90})
        core.edit(d / "rot.pdf", d / "rot2.pdf", "add_text", {"page": 1, "x": 50, "y": 50, "text": "ROT"})
        self.assertIn("ROT", text_of(d / "rot2.pdf"))

    def test_replace_text(self):
        d = self.td
        out = core.edit(d / "base.pdf", d / "rep.pdf", "replace_text", {"find": "DELTA", "replace": "OMEGA"})
        t = text_of(out)
        self.assertIn("OMEGA", t)
        with self.assertRaises(core.PdfStudioError):
            core.edit(d / "base.pdf", d / "rep2.pdf", "replace_text", {"find": "NOPE", "replace": "x"})

    def test_encrypt_split_flatten(self):
        d = self.td
        core.edit(d / "base.pdf", d / "enc.pdf", "encrypt", {"new_password": "pw"})
        with self.assertRaises(core.PdfStudioError):
            core.edit(d / "enc.pdf", d / "x.pdf", "rotate", {})
        core.edit(d / "enc.pdf", d / "dec.pdf", "decrypt", {}, password="pw")
        self.assertFalse(PdfReader(str(d / "dec.pdf")).is_encrypted)
        core.merge([d / "base.pdf"] * 3, d / "three2.pdf")
        self.assertEqual(len(core.split(d / "three2.pdf", d / "sp")), 3)
        self.assertEqual(len(core.split(d / "three2.pdf", d / "sp2", "1-2;3")), 2)
        fl = core.edit(d / "base.pdf", d / "flat.pdf", "flatten", {"dpi": 72})
        self.assertEqual(text_of(fl).strip(), "")

    def test_edit_text_segments(self):
        d = self.td
        segs = core.text_segments(d / "base.pdf", 1)["segments"]
        self.assertTrue(any("DELTA" in g["text"] for g in segs))
        g = next(g for g in segs if "DELTA" in g["text"])
        g.update(page=1, text="請求書 OMEGA")
        out = core.edit(d / "base.pdf", d / "et.pdf", "edit_text", {"items": [g]})
        self.assertIn("OMEGA", text_of(out))
        # 背景が白以外でも、周囲の色で塗られる(例外なく完了する)
        with self.assertRaises(core.PdfStudioError):
            core.edit(d / "base.pdf", d / "et2.pdf", "edit_text", {"items": []})

    def test_page_spec(self):
        self.assertEqual(core.parse_pages("1-2,4-", 5), [0, 1, 3, 4])
        self.assertEqual(core.parse_pages("odd", 4), [0, 2])


if __name__ == "__main__":
    unittest.main(verbosity=2)
