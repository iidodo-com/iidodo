#!/usr/bin/env python3
"""script.json -> animated frames piped to ffmpeg -> output/short_buzz.mp4 (テロップ文言・数値は script.json のまま)."""
import json, math, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import make_video as mv

mv.BASE, mv.BIG, mv.MARGIN = 92, 160, 40
ROOT, OUT = mv.ROOT, mv.OUT
W, H, FPS, FADE = 1080, 1920, 30, 0.2
ACC, INK = mv.ACCENT, (8, 12, 24)
ACC_DIM, LABEL = (122, 104, 60), (200, 208, 224)
STROKE = 9


def ease_out_back(x, c=2.2):
    x = min(max(x, 0), 1)
    return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2


def ease_out(x):
    x = min(max(x, 0), 1)
    return 1 - (1 - x) ** 3


_y = np.linspace(0, 1, H)[:, None, None]
BG_BASE = (np.array([9, 14, 30]) * (1 - _y) + np.array([30, 20, 58]) * _y) * np.ones((1, W, 1))
_yy, _xx = np.mgrid[0:H, 0:W]
GLOW_D = np.sqrt(((_xx - W / 2) / 700) ** 2 + ((_yy - 960) / 900) ** 2)
_r = random.Random(7)
PARTS = [(_r.uniform(0, W), _r.uniform(0, H), _r.uniform(3, 8), _r.uniform(60, 220)) for _ in range(46)]


def background(t):
    pulse = 0.5 + 0.5 * math.sin(t * 2 * math.pi * 1.2)
    glow = np.clip(1 - GLOW_D, 0, 1) ** 2 * (0.10 + 0.08 * pulse)
    a = BG_BASE + glow[:, :, None] * np.array(ACC)
    img = Image.fromarray(np.clip(a, 0, 255).astype("uint8"), "RGB")
    d = ImageDraw.Draw(img, "RGBA")
    for x, y, r, sp in PARTS:
        py = (y - t * sp) % H
        d.ellipse([x - r, py - r, x + r, py + r], fill=ACC + (70,))
    return img


def line_layer(runs, scale):
    widths = [mv.font((mv.BIG if n else mv.BASE) * scale).getlength(t) for t, n in runs]
    big = any(n for _, n in runs)
    size = (mv.BIG if big else mv.BASE) * scale
    pad = 40
    lw, lh = int(sum(widths)) + pad * 2, int(size * 1.6) + pad * 2
    lay = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    glow = Image.new("RGBA", (lw, lh), (0, 0, 0, 0))
    d, gd = ImageDraw.Draw(lay), ImageDraw.Draw(glow)
    x, by = pad, pad + size * 1.15
    for (t, n), w in zip(runs, widths):
        f = mv.font((mv.BIG if n else mv.BASE) * scale)
        if scale < 1:      # 出典表示: 装飾なし
            d.text((x, by), t, font=f, fill=ACC if n else mv.TEXT, anchor="ls")
        else:
            d.text((x, by), t, font=f, fill=ACC if n else (255, 255, 255), anchor="ls", stroke_width=STROKE, stroke_fill=INK)
            if n:
                gd.text((x, by), t, font=f, fill=ACC + (255,), anchor="ls", stroke_width=STROKE + 6, stroke_fill=ACC + (255,))
        x += w
    if scale < 1:
        return lay
    glow = glow.filter(ImageFilter.GaussianBlur(22))
    glow.putalpha(glow.split()[3].point(lambda v: int(v * 0.55)))
    return Image.alpha_composite(glow, lay)


def layout(s):
    scale = s.get("scale", 1.0)
    text = s["telop"]
    lines = mv.wrap(text, scale, 25, W - 2 * mv.MARGIN)
    assert "".join(t for l in lines for t, _ in l) == text
    ms = []
    for runs in lines:
        big = any(n for _, n in runs)
        size = (mv.BIG if big else mv.BASE) * scale
        ms.append((runs, size, size * (1.3 if big else 1.75)))
    y = (620 if s.get("figure") else 960) - sum(m[2] for m in ms) / 2
    res = []
    for runs, size, pitch in ms:
        res.append({"layer": line_layer(runs, scale), "cx": W / 2, "cy": y + pitch / 2,
                    "text": "".join(t for t, _ in runs), "size": size})
        y += pitch
    return res


def draw_fig(img, fig, t):
    d = ImageDraw.Draw(img)
    L, R = 90, 990
    BW = R - L
    p = ease_out(t / 0.7)
    show = t > 0.55
    pop = ease_out_back((t - 0.55) / 0.3) if show else 0

    def lab(x, y, s, sz, fill, anchor="mm", k=1.0):
        d.text((x, y), s, font=mv.font(max(4, sz * k)), fill=fill, anchor=anchor, stroke_width=6, stroke_fill=INK)

    def bracket(total, y=1090):
        d.line([(L, y), (L + BW * p, y)], fill=(255, 255, 255), width=8)
        d.line([(L, y - 16), (L, y + 16)], fill=(255, 255, 255), width=8)
        if p >= 0.999:
            d.line([(R, y - 16), (R, y + 16)], fill=(255, 255, 255), width=8)
        if show:
            lab(W / 2, 1000, mv.fmt(total), 140, ACC, k=pop)

    ty, y0, y1 = fig["type"], 1150, 1270
    if ty == "stack":
        (n1, v1), (n2, v2) = fig["parts"]; tot = fig["total"]
        w1 = BW * v1 / tot
        bracket(tot)
        d.rectangle([L, y0, L + w1 * p, y1], fill=ACC)
        d.rectangle([L + w1, y0, L + w1 + (BW - w1) * p, y1], fill=ACC_DIM)
        if show:
            for (n, v), a, b in ((fig["parts"][0], L, L + w1), (fig["parts"][1], L + w1, R)):
                lab((a + b) / 2, 1330, n, 46, LABEL, k=pop)
                lab((a + b) / 2, 1410, mv.fmt(v), 92, ACC, k=pop)
    elif ty == "share":
        part, tot = fig["part"], fig["total"]
        wp = BW * part / tot
        bracket(tot)
        d.rectangle([L, y0, L + BW * p, y1], fill=ACC_DIM)
        d.rectangle([L, y0, L + wp * p, y1], fill=ACC)
        if show:
            lab(L + wp / 2, 1330, fig["label"], 46, LABEL, k=pop)
            lab(L + wp / 2, 1410, mv.fmt(part), 92, ACC, k=pop)
    elif ty == "cycle":
        bracket(fig["total"])
        d.rectangle([L, y0, L + BW * p, y1], fill=ACC_DIM)
        cx, cy, r = W // 2, 1440, 100
        rot = t * 300
        d.arc([cx - r, cy - r, cx + r, cy + r], start=rot + 30, end=rot + 330, fill=ACC, width=18)
        a = math.radians(rot + 330); ex, ey = cx + r * math.cos(a), cy + r * math.sin(a)
        tx, ty2, nx, ny = -math.sin(a), math.cos(a), math.cos(a), math.sin(a)
        d.polygon([(ex + tx * 40, ey + ty2 * 40), (ex + nx * 32, ey + ny * 32), (ex - nx * 32, ey - ny * 32)], fill=ACC)
    elif ty == "compare":
        top = max(v for _, v in fig["rows"])
        for k, (name, v) in enumerate(fig["rows"]):
            yl = 1030 + k * 260
            w = BW * v / top
            pk = ease_out((t - 0.15 * k) / 0.7)
            lab(L, yl, name, 46, LABEL, "lm")
            d.rectangle([L, yl + 60, L + w * pk, yl + 160], fill=ACC)
            if pk > 0.7:
                lab(R, yl, mv.fmt(v), 92, ACC, "rm")


def render_screen(s, lay, t, bg):
    img = bg.copy().convert("RGBA")
    last = s["no"] == 10
    for i, L in enumerate(lay):
        ti = t - 0.07 * i
        if ti < 0:
            continue
        k = max(min(ti / 0.2, 1) if last else ease_out_back(ti / 0.28), 0.01)
        sh = 0 if last else math.sin(ti * 80) * 10 * max(0, 1 - ti / 0.25)
        lw, lh = L["layer"].size
        im = L["layer"].resize((max(1, int(lw * k)), max(1, int(lh * k))), Image.BILINEAR)
        img.paste(im, (int(L["cx"] - im.width / 2 + sh), int(L["cy"] - im.height / 2)), im)
    if s.get("figure"):
        draw_fig(img, s["figure"], max(0, t - 0.25))
    return img.convert("RGB")


def main():
    data = json.loads((ROOT / "script.json").read_text(encoding="utf-8"))
    screens = data["screens"]
    layouts = {s["no"]: layout(s) for s in screens}
    nf = int(round(data["meta"]["total_sec"] * FPS))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-an", "-movflags", "+faststart", str(OUT / "short_buzz.mp4")]
    pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    half = FADE / 2
    for f in range(nf):
        t = f / FPS
        idx = max(i for i, s in enumerate(screens) if s["start"] <= t + 1e-9)
        s = screens[idx]
        bg = background(t)
        img = render_screen(s, layouts[s["no"]], t - s["start"], bg)
        if idx + 1 < len(screens) and t >= screens[idx + 1]["start"] - half - 1e-9:
            n = screens[idx + 1]
            a = (t - (n["start"] - half)) / FADE
            img = Image.blend(img, render_screen(n, layouts[n["no"]], 0, bg), min(max(a, 0), 1))
        pr.stdin.write(img.tobytes())
        if f % 300 == 0:
            print("frame", f, flush=True)
    pr.stdin.close(); pr.wait()
    (OUT / "frames_buzz").mkdir(exist_ok=True)
    for s in screens:
        tm = s["start"] + min(1.6, (s["end"] - s["start"]) - 0.3)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{tm:.3f}", "-i", str(OUT / "short_buzz.mp4"), "-frames:v", "1",
                        str(OUT / "frames_buzz" / f"{s['no']:02d}.png")], check=True)
    print("done")


if __name__ == "__main__":
    main()
