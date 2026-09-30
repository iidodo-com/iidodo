#!/usr/bin/env python3
"""script.json -> frames(PNG) -> output/short.mp4 (+ script.md, frames/, render_log.json)."""
import json, re, subprocess, sys, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import budoux

ROOT = Path(__file__).parent
OUT = ROOT / "output"
BUILD = ROOT / "build"
FONT = str(ROOT / "fonts" / "NotoSansJP_700Bold.ttf")
BG, ACCENT, TEXT, DIM = (14, 23, 38), (255, 200, 87), (244, 246, 250), (154, 167, 188)
ACCENT_DIM = (98, 84, 52)      # accent at ~30% over BG (figure fill for non-emphasised parts)
W, H = 1080, 1920
SAFE = 192                      # top/bottom 10%: no ink
MARGIN = 60
BASE, BIG = 88, 150
NUM_RE = re.compile(r"\d[\d,]*万")
_fonts = {}


def font(sz):
    sz = int(round(sz))
    return _fonts.setdefault(sz, ImageFont.truetype(FONT, sz))


def fail(msg):
    print("ERROR:", msg, file=sys.stderr)
    sys.exit(1)


def wrap(text, scale, max_chars, max_w):
    """Split into lines (phrase-aware, pixel-aware). Returns list of lines; each line = list of (str,is_num)."""
    spans = [m.span() for m in NUM_RE.finditer(text)]
    isnum = [any(a <= i < b for a, b in spans) for i in range(len(text))]
    # phrase boundaries (budoux), never inside a number token
    cuts, pos = set(), 0
    for ph in budoux.load_default_japanese_parser().parse(text):
        pos += len(ph)
        cuts.add(pos)
    cuts |= {i + 1 for i, ch in enumerate(text) if ch in '＋・：／'}
    cuts = {c for c in cuts if not any(a < c < b for a, b in spans) and c < len(text)}
    phrases, s = [], 0
    for c in sorted(cuts):
        phrases.append((s, c)); s = c
    if s < len(text):
        phrases.append((s, len(text)))

    def cw(i):
        return font((BIG if isnum[i] else BASE) * scale).getlength(text[i])

    def pw(a, b):
        return sum(cw(i) for i in range(a, b))

    lines, cur = [], None
    for a, b in phrases:
        if cur and pw(cur[0], b) <= max_w and (b - cur[0]) <= max_chars:
            cur = (cur[0], b)
        else:
            if cur:
                lines.append(cur)
            cur = (a, b)
    lines.append(cur)
    res = []
    for a, b in lines:
        if pw(a, b) > max_w or b - a > max_chars:
            fail(f"line does not fit ({b-a} chars, {pw(a,b):.0f}px): {text[a:b]}")
        runs, i = [], a
        while i < b:
            j = i
            while j < b and isnum[j] == isnum[i]:
                j += 1
            runs.append((text[i:j], isnum[i])); i = j
        res.append(runs)
    return res


def draw_telop(d, text, scale, cy, log):
    lines = wrap(text, scale, 25, W - 2 * MARGIN)
    assert "".join(t for l in lines for t, _ in l) == text
    metrics = []
    for runs in lines:
        big = any(n for _, n in runs)
        size = (BIG if big else BASE) * scale
        metrics.append((runs, size, size * (1.35 if big else 1.8)))
    total = sum(m[2] for m in metrics)
    y = cy - total / 2
    boxes, out_lines = [], []
    for runs, size, pitch in metrics:
        base_y = y + pitch / 2 + size * 0.35
        widths = [font((BIG if n else BASE) * scale).getlength(t) for t, n in runs]
        x = (W - sum(widths)) / 2
        for (t, n), w in zip(runs, widths):
            f = font((BIG if n else BASE) * scale)
            d.text((x, base_y), t, font=f, fill=ACCENT if n else TEXT, anchor="ls")
            boxes.append(d.textbbox((x, base_y), t, font=f, anchor="ls"))
            x += w
        out_lines.append("".join(t for t, _ in runs))
        y += pitch
    log["telop_lines"] = out_lines
    log["telop_bbox"] = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]
    return log["telop_bbox"]


def fmt(v):
    return f"{v:,}万"


def ctext(d, x, y, s, sz, fill, anchor="mm"):
    d.text((x, y), s, font=font(sz), fill=fill, anchor=anchor)
    return d.textbbox((x, y), s, font=font(sz), anchor=anchor)


def draw_figure(d, fig, log):
    L, R = 90, 990
    BW = R - L                      # 900px == full scale
    boxes = []
    t = fig["type"]
    if t == "stack":
        (n1, v1), (n2, v2) = fig["parts"]
        tot = fig["total"]
        assert v1 + v2 == tot
        w1 = BW * v1 / tot
        y0, y1 = 1150, 1270
        boxes.append(ctext(d, W / 2, 1010, fmt(tot), 130, ACCENT))
        d.line([(L, 1090), (R, 1090)], fill=TEXT, width=6)
        d.line([(L, 1074), (L, 1106)], fill=TEXT, width=6); d.line([(R, 1074), (R, 1106)], fill=TEXT, width=6)
        d.rectangle([L, y0, L + w1, y1], fill=ACCENT)
        d.rectangle([L + w1, y0, R, y1], fill=ACCENT_DIM)
        d.line([(L + w1, y0), (L + w1, y1)], fill=BG, width=6)
        for (n, v), a, b in ((fig["parts"][0], L, L + w1), (fig["parts"][1], L + w1, R)):
            boxes.append(ctext(d, (a + b) / 2, 1330, n, 46, DIM))
            boxes.append(ctext(d, (a + b) / 2, 1410, fmt(v), 84, ACCENT))
        boxes.append((L, 1074, R, y1))
        log["fig_geom"] = {"bar_px": BW, "seg_px": [w1, BW - w1], "values": [v1, v2, tot]}
    elif t == "share":
        part, tot = fig["part"], fig["total"]
        wp = BW * part / tot
        y0, y1 = 1150, 1270
        boxes.append(ctext(d, W / 2, 1010, fmt(tot), 130, ACCENT))
        d.line([(L, 1090), (R, 1090)], fill=TEXT, width=6)
        d.line([(L, 1074), (L, 1106)], fill=TEXT, width=6); d.line([(R, 1074), (R, 1106)], fill=TEXT, width=6)
        d.rectangle([L, y0, R, y1], fill=ACCENT_DIM)
        d.rectangle([L, y0, L + wp, y1], fill=ACCENT)
        boxes.append(ctext(d, L + wp / 2, 1330, fig["label"], 46, DIM))
        boxes.append(ctext(d, L + wp / 2, 1410, fmt(part), 84, ACCENT))
        boxes.append((L, 1074, R, y1))
        log["fig_geom"] = {"bar_px": BW, "seg_px": [wp, BW - wp], "values": [part, tot]}
    elif t == "cycle":
        tot = fig["total"]
        y0, y1 = 1150, 1270
        boxes.append(ctext(d, W / 2, 1010, fmt(tot), 130, ACCENT))
        d.line([(L, 1090), (R, 1090)], fill=TEXT, width=6)
        d.line([(L, 1074), (L, 1106)], fill=TEXT, width=6); d.line([(R, 1074), (R, 1106)], fill=TEXT, width=6)
        d.rectangle([L, y0, R, y1], fill=ACCENT_DIM)
        cx, cy, r = W // 2, 1440, 100
        d.arc([cx - r, cy - r, cx + r, cy + r], start=30, end=330, fill=ACCENT, width=18)
        a = math.radians(330); ex, ey = cx + r * math.cos(a), cy + r * math.sin(a)
        tx, ty = -math.sin(a), math.cos(a)   # clockwise tangent
        nx, ny = math.cos(a), math.sin(a)
        d.polygon([(ex + tx * 40, ey + ty * 40), (ex + nx * 32, ey + ny * 32), (ex - nx * 32, ey - ny * 32)], fill=ACCENT)
        boxes.append((L, 1074, R, y1)); boxes.append((cx - r - 20, cy - r - 20, cx + r + 20, cy + r + 20))
        log["fig_geom"] = {"bar_px": BW, "seg_px": [BW], "values": [tot]}
    elif t == "compare":
        top = max(v for _, v in fig["rows"])
        widths = []
        for k, (name, v) in enumerate(fig["rows"]):
            yl = 1030 + k * 260
            w = BW * v / top
            widths.append(w)
            boxes.append(ctext(d, L, yl, name, 46, DIM, "lm"))
            boxes.append(ctext(d, R, yl, fmt(v), 84, ACCENT, "rm"))
            d.rectangle([L, yl + 60, L + w, yl + 160], fill=ACCENT)
            boxes.append((L, yl + 60, L + w, yl + 160))
        log["fig_geom"] = {"bar_px": BW, "seg_px": widths, "values": [v for _, v in fig["rows"]]}
    log["fig_bbox"] = [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def main():
    data = json.loads((ROOT / "script.json").read_text(encoding="utf-8"))
    meta, screens = data["meta"], data["screens"]
    mat = data["material"]
    # consistency of material numbers
    assert mat["つみたて投資枠(年間)"] + mat["成長投資枠(年間)"] == mat["年間投資枠(合計)"], "資料の数値が矛盾"
    # timeline sanity
    t = 0.0
    for s in screens:
        assert abs(s["start"] - t) < 1e-9, f"gap before screen {s['no']}"
        t = s["end"]
    assert abs(t - meta["total_sec"]) < 1e-9
    BUILD.mkdir(exist_ok=True); (OUT / "frames").mkdir(parents=True, exist_ok=True)
    logs = []
    for s in screens:
        img = Image.new("RGB", (W, H), BG)
        d = ImageDraw.Draw(img)
        log = {"no": s["no"], "telop": s["telop"]}
        fig = s.get("figure")
        cy = 640 if fig else 960
        b = draw_telop(d, s["telop"], s.get("scale", 1.0), cy, log)
        if fig:
            draw_figure(d, fig, log)
        img.save(BUILD / f"screen_{s['no']:02d}.png")
        logs.append(log)
    (OUT / "render_log.json").write_text(json.dumps(logs, ensure_ascii=False, indent=1), encoding="utf-8")

    # ffmpeg: xfade chain, fade centred on each script boundary
    fps, fd = meta["fps"], meta["fade_sec"]
    h = fd / 2
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    n = len(screens)
    for i, s in enumerate(screens):
        dur = s["end"] - s["start"]
        ln = dur + (h if i == 0 else 0) + (fd if 0 < i < n - 1 else 0) + (h if i == n - 1 else 0)
        if i == 0: ln = dur + h
        elif i == n - 1: ln = dur + h
        else: ln = dur + fd
        cmd += ["-loop", "1", "-framerate", str(fps), "-t", f"{ln:.3f}", "-i", str(BUILD / f"screen_{s['no']:02d}.png")]
    fc, prev = [], "[0:v]"
    for i in range(1, n):
        off = screens[i]["start"] - h
        out = f"[x{i}]" if i < n - 1 else "[vout]"
        fc.append(f"{prev}[{i}:v]xfade=transition=fade:duration={fd}:offset={off:.3f}{out}")
        prev = out
    fc[-1] = fc[-1].replace("[vout]", "[vraw]")
    fc.append("[vraw]format=yuv420p[vout]")
    cmd += ["-filter_complex", ";".join(fc), "-map", "[vout]", "-r", str(fps), "-t", str(meta["total_sec"]),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-an", "-movflags", "+faststart", str(OUT / "short.mp4")]
    subprocess.run(cmd, check=True)

    # representative frames (mid-screen) taken from the video
    for s in screens:
        tm = (s["start"] + s["end"]) / 2
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{tm:.3f}", "-i", str(OUT / "short.mp4"),
                        "-frames:v", "1", str(OUT / "frames" / f"{s['no']:02d}.png")], check=True)

    # script.md
    rows = ["| # | 時間(秒) | テロップ | 根拠（資料の該当箇所） |", "|---|---|---|---|"]
    for s in screens:
        fig = "（図形あり）" if s.get("figure") else ""
        rows.append(f"| {s['no']} | {s['start']:.1f}–{s['end']:.1f} | {s['telop']}{fig} | {s['basis']} |")
    (OUT / "script.md").write_text("# 台本と根拠の対応表\n\n" + "\n".join(rows) + "\n", encoding="utf-8")
    print("done")


if __name__ == "__main__":
    main()
