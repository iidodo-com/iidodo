#!/usr/bin/env python3
import json, re, subprocess, unicodedata
from pathlib import Path
from PIL import Image, ImageChops
import pytesseract
R = Path(__file__).parent; O = R / "output"
data = json.loads((R / "script.json").read_text(encoding="utf-8"))
logs = {l["no"]: l for l in json.loads((O / "render_log.json").read_text(encoding="utf-8"))}
BG = (14, 23, 38)

print("## 1 ffprobe")
p = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", str(O / "short.mp4")],
    capture_output=True, text=True).stdout)
print(p)
a = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv", str(O / "short.mp4")], capture_output=True, text=True).stdout.strip()
print("audio streams:", repr(a))

print("\n## 2 telop match (OCR of video frame / pixel diff vs source PNG)")
norm = lambda s: re.sub(r"\s+", "", unicodedata.normalize("NFKC", s))
for s in data["screens"]:
    fr = Image.open(O / "frames" / f"{s['no']:02d}.png").convert("RGB")
    x0, y0, x1, y1 = [int(v) for v in logs[s["no"]]["telop_bbox"]]
    crop = fr.crop((max(0, x0 - 20), max(0, y0 - 20), min(1080, x1 + 20), y1 + 20))
    crop = crop.resize((crop.width * 2, crop.height * 2)) if s.get("scale") else crop
    ocr = pytesseract.image_to_string(crop, lang="jpn", config="--psm 6")
    src = Image.open(R / "build" / f"screen_{s['no']:02d}.png").convert("RGB")
    diff = ImageChops.difference(fr, src).convert("L"); mae = sum(diff.getdata()) / (1080 * 1920)
    joined = "".join(logs[s["no"]]["telop_lines"])
    print(f"{s['no']:>2} script==render_text:{joined == s['telop']}  OCR==script:{norm(ocr) == norm(s['telop'])}  frameMAE:{mae:.3f}\n    OCR:{norm(ocr)}")

print("\n## 3 safe area (top/bottom 192px)")
ok = True
for s in data["screens"]:
    fr = Image.open(O / "frames" / f"{s['no']:02d}.png").convert("RGB")
    l = logs[s["no"]]
    bands = [fr.crop((0, 0, 1080, 192)), fr.crop((0, 1728, 1080, 1920))]
    maxdev = max(max(ImageChops.difference(b, Image.new("RGB", b.size, BG)).convert("L").getdata()) for b in bands)
    tb = l["telop_bbox"]; fb = l.get("fig_bbox")
    inside = tb[1] >= 192 and tb[3] <= 1728 and (not fb or (fb[1] >= 192 and fb[3] <= 1728))
    ok &= inside and maxdev <= 4
    print(f"{s['no']:>2} telop y={tb[1]:.0f}-{tb[3]:.0f}" + (f" fig y={fb[1]:.0f}-{fb[3]:.0f}" if fb else "") + f"  band max pixel deviation={maxdev}  {'OK' if inside and maxdev<=4 else 'NG'}")
print("ALL OK" if ok else "NG")

print("\n## 3b figure ratio (px vs material)")
for s in data["screens"]:
    g = logs[s["no"]].get("fig_geom")
    if g:
        print(s["no"], g)

print("\n## 4 numbers in video vs material")
mat = set(data["material"].values())
num_re = re.compile(r"\d[\d,]*")
seen = []
for s in data["screens"]:
    texts = [s["telop"]]
    f = s.get("figure")
    if f:
        t = f["type"]
        vals = {"stack": [v for _, v in f.get("parts", [])] + [f.get("total")], "share": [f.get("part"), f.get("total")],
                "cycle": [f.get("total")], "compare": [v for _, v in f.get("rows", [])]}[t]
        texts += [f"{v:,}万" for v in vals]
    for t in texts:
        for n in num_re.findall(t):
            seen.append((s["no"], n, "telop" if t == s["telop"] else "figure"))
for no, n, where in seen:
    v = int(n.replace(",", ""))
    src = "資料一致" if (v in mat and "万" in (data["screens"][no-1]["telop"] + "万")) and v in mat else "資料外(要確認)"
    print(f"screen {no:>2} [{where}] {n:>6} -> {src}")
