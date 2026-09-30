"""Procedural majestic-landscape video: golden-hour alpine lake, layered mountains, drifting clouds."""
import sys, subprocess, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from multiprocessing import Pool
import imageio_ffmpeg

W, H, FPS, SECS = 1280, 720, 24, 12
Y0 = 420  # horizon row
rng = np.random.default_rng(7)
T = rng.random((512, 512)).astype(np.float32)

def vnoise(x, y):
    xi = np.floor(x).astype(np.int32); yi = np.floor(y).astype(np.int32)
    xf = (x - xi).astype(np.float32); yf = (y - yi).astype(np.float32)
    u = xf * xf * (3 - 2 * xf); v = yf * yf * (3 - 2 * yf)
    a = T[xi & 511, yi & 511]; b = T[(xi + 1) & 511, yi & 511]
    c = T[xi & 511, (yi + 1) & 511]; d = T[(xi + 1) & 511, (yi + 1) & 511]
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v

def fbm(x, y, oct=5, ridged=False):
    s = 0; amp = 0.5; f = 1.0; tot = 0
    for i in range(oct):
        n = vnoise(x * f + 17.3 * i, y * f + 5.1 * i)
        if ridged: n = 1 - np.abs(2 * n - 1)
        s = s + amp * n; tot += amp; amp *= 0.5; f *= 2.03
    return s / tot

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def mix(a, b, t): return a + (b - a) * t

C = lambda *v: np.array(v, np.float32)
HORIZON = C(1.0, 0.66, 0.38); TOPSKY = C(0.13, 0.27, 0.58); MIDSKY = C(0.50, 0.58, 0.78)
SUNC = C(1.0, 0.86, 0.6)

# ---- foreground silhouette (static, wide for parallax) ----
FGW = W + 400
def build_fg():
    S = 2
    im = Image.new("L", (FGW * S, H * S), 0); d = ImageDraw.Draw(im)
    def pine(cx, base, h, w):
        for k in range(9):
            t0 = k / 9; t1 = (k + 1) / 9
            ytop = base - h * (1 - t0 * 0.0) + h * t0 * 0.92
            yb = base - h + h * (t1 + 0.12)
            ww = w * (0.15 + t1 * 0.85)
            d.polygon([(cx * S, (base - h + h * t0 * 0.95) * S), ((cx - ww) * S, yb * S), ((cx + ww) * S, yb * S)], fill=255)
        d.rectangle([(cx - 3) * S, (base - h * 0.08) * S, (cx + 3) * S, (base + 40) * S], fill=255)
    r = np.random.default_rng(3)
    # banks
    left = [(0, H)] + [(x, 610 + 60 * math.exp(-x / 220) * -1 + 40 * math.sin(x / 90) * 0.5 + x * 0.35) for x in range(0, 620, 20)] + [(620, H)]
    d.polygon([(x * S, y * S) for x, y in left], fill=255)
    right = [(FGW, H)] + [(x, 600 + (FGW - x) * 0.30 + 12 * math.sin(x / 70)) for x in range(FGW, FGW - 560, -20)] + [(FGW - 560, H)]
    d.polygon([(x * S, y * S) for x, y in right], fill=255)
    for _ in range(9):
        x = r.uniform(-20, 330); pine(x, 720 - x * 0.25 + 30, r.uniform(300, 520) * (1 - x / 900), r.uniform(45, 75))
    for _ in range(8):
        x = r.uniform(FGW - 380, FGW + 20); pine(x, 730 - (FGW - x) * 0.2, r.uniform(260, 470), r.uniform(42, 70))
    im = im.resize((FGW, H), Image.LANCZOS)
    return np.asarray(im, np.float32)[..., None] / 255.0
FG = build_fg()

xs = np.arange(W, dtype=np.float32)[None, :]
ys = np.arange(Y0, dtype=np.float32)[:, None]

LAYERS = [  # base, amp, freq, colour, haze, seed, parallax
    dict(base=70, amp=250, f=0.0030, col=C(0.62, 0.62, 0.76), haze=0.30, seed=11, p=0.15, snow=True),
    dict(base=45, amp=170, f=0.0042, col=C(0.36, 0.38, 0.52), haze=0.22, seed=23, p=0.30, snow=False),
    dict(base=30, amp=100, f=0.0060, col=C(0.18, 0.24, 0.32), haze=0.13, seed=37, p=0.55, snow=False),
    dict(base=14, amp=42, f=0.0100, col=C(0.04, 0.10, 0.09), haze=0.04, seed=51, p=0.90, snow=False),
]

def scene_above(t):
    cam = t * 9.0
    sunx = 0.66 * W - cam * 0.05; suny = Y0 - 130 + t * 0.8
    yn = ys / Y0
    sky = np.where(yn < 0.6, mix(TOPSKY, MIDSKY, sstep(0, 0.6, yn)), mix(MIDSKY, HORIZON, sstep(0.6, 1.0, yn) ** 1.4))
    sky = np.broadcast_to(sky[:, None, :], (Y0, W, 3)).astype(np.float32).copy()
    dx = xs - sunx; dy = ys - suny
    dist = np.sqrt(dx * dx + dy * dy)
    glow = (np.exp(-dist / 260) * 0.55 + np.exp(-dist / 70) * 0.9 + np.exp(-(dist / 24) ** 2) * 3.0)[..., None]
    sky += glow * SUNC * 0.9
    # clouds
    cx = xs + cam * 0.25 + t * 6.0
    n = fbm(cx * 0.0032, ys * 0.011 + 3.0, 6)
    n2 = fbm((cx + 14) * 0.0032, (ys + 6) * 0.011 + 3.0, 6)
    dens = sstep(0.47, 0.72, n) * sstep(0.0, 0.10, yn) * (1 - 0.55 * sstep(0.80, 1.0, yn))
    lit = np.clip(0.55 + (n - n2) * 9, 0, 1) * sstep(0.0, 260, 400 - dist * 0.4)
    warm = C(1.0, 0.72, 0.52); cool = C(0.42, 0.44, 0.60)
    cc = mix(cool, warm, np.clip(lit[..., None] * 0.7 + np.exp(-dist / 380)[..., None] * 0.8, 0, 1))
    cc = cc + np.exp(-dist / 90)[..., None] * SUNC * 0.5
    sky = mix(sky, cc, (dens * 0.88)[..., None])
    img = sky
    # mountains
    for L in LAYERS:
        off = cam * L['p'] * 3
        gx = xs[0] + off
        h = L['base'] + L['amp'] * fbm(gx * L['f'] + L['seed'], np.full_like(gx, L['seed'] * 0.3), 6, ridged=True) ** 2.2
        ridge = (Y0 - h)[None, :]
        mask = sstep(-1.2, 1.2, ys - ridge)[..., None]
        depth = (ys - ridge)
        gxx = xs + off
        tex = fbm(gxx * L['f'] * 5 + L['seed'], ys * L['f'] * 5 * 1.6, 4, ridged=True)
        tex2 = fbm((gxx + 5) * L['f'] * 5 + L['seed'], (ys + 3) * L['f'] * 5 * 1.6, 4, ridged=True)
        shade = np.clip(0.78 + (tex2 - tex) * 5.5 + (tex - 0.5) * 0.5, 0.35, 1.5)
        # rim light from sun on ridge tops
        rim = np.exp(-np.clip(depth, 0, None) / 6) * np.exp(-np.abs(xs - sunx) / 500)
        col = L['col'][None, None, :] * shade[..., None]
        if L['snow']:
            sn = sstep(0, 1, (105 - depth) / 60) * sstep(0.35, 0.6, tex + 0.3 * (1 - depth / 200))
            snowc = mix(C(0.78, 0.82, 0.95), C(1.0, 0.85, 0.7), np.clip(shade - 0.6, 0, 1)[..., None])
            col = mix(col, snowc * np.clip(shade[..., None] * 0.95 + 0.15, 0.5, 1.3), (sn * 0.9)[..., None])
        if L['p'] > 0.8:  # forest texture
            tr = fbm(gxx * 0.09, ys * 0.22, 3)
            col = col * (0.7 + 0.7 * tr[..., None])
        fog = np.exp(-(Y0 - ys) / 55.0)[..., None] * 0.30
        hz = mix(HORIZON * 0.95 + 0.05, MIDSKY, 0.35)
        col = mix(col, hz, L['haze'] * (1 - 0.0 * depth[..., None] / 200) + fog * (1 - L['p'] * 0.6))
        col = col + rim[..., None] * SUNC * 0.35 * (1 - L['haze'])
        img = mix(img, col, mask)
    return np.clip(img, 0, 1.6)

def frame(i):
    t = i / FPS
    above = scene_above(t)
    # ---- lake via reflection ----
    LH = H - Y0
    j = np.arange(LH, dtype=np.float32)[:, None]
    gx = xs
    rip = (fbm(gx * 0.018, j * 0.10 + t * 0.35, 4) - 0.5) * (2 + j * 0.16)
    rip2 = (fbm(gx * 0.06, j * 0.5 - t * 0.6, 3) - 0.5) * (1.5 + j * 0.05)
    srcx = np.clip((gx + rip + rip2 + 0).astype(np.int32), 0, W - 1)
    srcy = np.clip((Y0 - 1 - j * 0.95 - (rip2 * 0.4)).astype(np.int32), 0, Y0 - 1)
    refl = above[srcy, srcx]
    depthf = (j / LH)
    water = mix(refl * 0.78, C(0.05, 0.13, 0.17), (0.18 + 0.4 * depthf)[..., None])
    # ripples highlights / sun glitter
    sunx = 0.66 * W - t * 9 * 0.05
    streak = fbm(gx * 0.05 + t * 0.15, j * 0.9, 3)
    glit = sstep(0.68, 0.85, streak) * np.exp(-((gx - sunx) / (160 + j * 1.2)) ** 2) * (1 - 0.6 * depthf)
    water = water + glit[..., None] * SUNC * 0.9
    water = water * (1 - 0.25 * sstep(0.5, 1.0, depthf))[..., None]
    img = np.concatenate([above, water], 0)
    # foreground
    sway = 200 + (t * 9 * 1.6) % 400 * 0 + t * 4.0
    fg = FG[:, int(sway):int(sway) + W]
    fgcol = C(0.015, 0.03, 0.035) + np.broadcast_to(np.linspace(0, 1, W, dtype=np.float32)[None, :, None], (H, W, 1)) * 0.0
    rim = np.clip(fg[:, :, 0] - np.roll(fg[:, :, 0], -3, axis=1), 0, 1)[..., None]
    img = mix(img, fgcol + rim * SUNC * 0.25, fg)
    # mist drifting near horizon
    m = fbm(xs * 0.004 + t * 0.03, np.arange(H, dtype=np.float32)[:, None] * 0.03, 4)
    band = np.exp(-((np.arange(H, dtype=np.float32)[:, None] - (Y0 + 4)) / 22.0) ** 2)
    img = img + (m[..., None] * band[..., None]) * HORIZON * 0.28
    # post: tonemap, bloom, grade, vignette, grain
    img = 1 - np.exp(-img * 1.35)
    img = np.clip(img, 0, 1)
    pil = Image.fromarray((img * 255).astype(np.uint8))
    hi = np.clip(img - 0.7, 0, 1)
    bloom = Image.fromarray((hi * 255 * 1.5).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(22))
    img = np.clip(img + np.asarray(bloom, np.float32) / 255 * 0.7, 0, 1)
    # birds
    pil = Image.fromarray((img * 255).astype(np.uint8)); d = ImageDraw.Draw(pil)
    for k, (bx, by, sp) in enumerate([(200, 170, 30), (250, 195, 26), (160, 210, 33), (330, 150, 24)]):
        x = (bx + t * sp) % (W + 100) - 50; y = by + 8 * math.sin(t * 0.8 + k)
        fl = math.sin(t * 9 + k * 1.7) * 5
        d.line([(x - 9, y - fl * 0.6), (x - 4, y - 3 - fl * 0.5), (x, y)], fill=(22, 22, 30), width=2)
        d.line([(x + 9, y - fl * 0.6), (x + 4, y - 3 - fl * 0.5), (x, y)], fill=(22, 22, 30), width=2)
    a = np.asarray(pil, np.float32) / 255
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    v = 1 - 0.38 * (((xx / W - 0.5) * 1.6) ** 2 + ((yy / H - 0.5) * 1.6) ** 2)
    a = a * v[..., None]
    a = a * C(1.03, 1.0, 0.95) + 0.008
    a += (np.random.default_rng(i).standard_normal((H, W, 1)).astype(np.float32)) * 0.012
    return (np.clip(a, 0, 1) * 255).astype(np.uint8).tobytes()

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "nature.mp4"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else FPS * SECS
    ff = subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
        "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "medium", out], stdin=subprocess.PIPE)
    with Pool(4) as p:
        for k, fr in enumerate(p.imap(frame, range(n), chunksize=2)):
            ff.stdin.write(fr)
            if k % 24 == 0: print("frame", k, "/", n, flush=True)
    ff.stdin.close(); ff.wait()
