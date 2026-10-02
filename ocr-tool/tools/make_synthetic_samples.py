"""合成サンプル画像（動作確認用）を samples/synthetic/ に作る。
実際の文書ではなく、フォントで描いた文字に劣化（傾き・ノイズ・低解像度）を加えたもの。
正解テキスト(.gt.txt)も同時に出力するので、compare.py で文字誤り率を測れる。

使い方: python tools/make_synthetic_samples.py [--font フォントファイル]
"""
from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
    "C:/Windows/Fonts/meiryo.ttc",
    "C:/Windows/Fonts/msgothic.ttc",
    "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
]

NOTICE = [
    "令和八年十月二日",
    "",
    "山田　太郎　様",
    "",
    "介護保険料の納付に関するお知らせ",
    "",
    "平素より市政にご協力いただき、ありがとうございます。",
    "下記のとおり、令和八年度の保険料をお知らせいたします。",
    "納付期限は十一月三十日（月）です。期限までに最寄りの",
    "金融機関またはコンビニエンスストアでお支払いください。",
    "",
    "年間保険料額　七万二千四百円",
    "納付番号　〇四―一二三五―六七八九",
    "お問い合わせ　高齢福祉課　電話〇三―一二三四―五六七八",
]

TABLE = [
    ["品名", "数量", "単価", "金額"],
    ["事務用紙", "10", "450", "4,500"],
    ["封筒（大）", "5", "120", "600"],
    ["印刷代", "1", "3,800", "3,800"],
    ["合計", "", "", "8,900"],
]

VERTICAL = [
    "吾輩は猫である。名前はまだ無い。",
    "どこで生れたかとんと見当がつかぬ。",
    "何でも薄暗いじめじめした所で",
    "ニャーニャー泣いていた事だけは",
    "記憶している。",
]


def find_font(path: str | None) -> str:
    for c in ([path] if path else []) + FONT_CANDIDATES:
        if c and Path(c).exists():
            return c
    raise SystemExit("日本語フォントが見つかりません。--font でフォントファイルを指定してください。")


def page(size=(2480, 3508)) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("L", size, 255)
    return im, ImageDraw.Draw(im)


def draw_notice(font_path: str, lines=NOTICE, px=54) -> Image.Image:
    im, d = page()
    f = ImageFont.truetype(font_path, px)
    y = 300
    for ln in lines:
        d.text((250, y), ln, font=f, fill=20)
        y += int(px * 1.9)
    return im


def draw_table(font_path: str) -> Image.Image:
    im, d = page()
    f = ImageFont.truetype(font_path, 54)
    x0, y0, widths, rh = 250, 400, [800, 350, 450, 500], 130
    for r, row in enumerate(TABLE):
        x = x0
        for c, cell in enumerate(row):
            d.rectangle([x, y0 + r * rh, x + widths[c], y0 + (r + 1) * rh], outline=0, width=4)
            d.text((x + 30, y0 + r * rh + 35), cell, font=f, fill=20)
            x += widths[c]
    return im


def draw_vertical(font_path: str) -> Image.Image:
    """縦書き（右の行から左へ）。句読点・長音の字形は簡易処理のため、実際の縦書き文書より単純。"""
    im, d = page()
    px = 60
    f = ImageFont.truetype(font_path, px)
    x = 2480 - 400
    for ln in VERTICAL:
        y = 400
        for ch in ln:
            d.text((x, y), ch, font=f, fill=20)
            y += int(px * 1.15)
        x -= int(px * 2.0)
    return im


def degrade(im: Image.Image, angle=0.0, noise=0.0, blur=0.0, shade=0.0, scale=1.0, seed=0) -> Image.Image:
    """スキャン風の劣化：傾き・照明ムラ・ぼかし・ノイズ・解像度低下。"""
    rng = np.random.default_rng(seed)
    a = np.asarray(im).astype(np.float32)
    h, w = a.shape
    if angle:
        m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        a = cv2.warpAffine(a, m, (w, h), flags=cv2.INTER_LINEAR, borderValue=255)
    if shade:
        grad = np.linspace(1.0 - shade, 1.0, w, dtype=np.float32)[None, :] * np.linspace(1.0, 1.0 - shade / 2, h, dtype=np.float32)[:, None]
        a *= grad
    if noise:  # センサーノイズ：先にノイズを足してからぼかす（実機に近い、空間的に相関のあるノイズ）
        a += rng.normal(0, noise, a.shape).astype(np.float32)
    if blur:
        a = cv2.GaussianBlur(a, (0, 0), blur)
    if noise:  # ほこり・ゴミ（黒い点）
        a[rng.random(a.shape) < 0.0004] = 0
    if scale != 1.0:
        a = cv2.resize(a, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def save(im: Image.Image, out: Path, name: str, gt: str, dpi: int = 300, **kw) -> None:
    path = out / name
    if path.suffix.lower() in (".jpg", ".jpeg"):
        im.save(path, quality=70, dpi=(dpi, dpi))
    else:
        im.save(path, dpi=(dpi, dpi))
    (out / (path.stem + ".gt.txt")).write_text(gt + "\n", encoding="utf-8")
    print("作成:", path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "samples" / "synthetic"))
    args = ap.parse_args()
    font = find_font(args.font)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    gt_notice = "\n".join(NOTICE)

    clean = draw_notice(font)
    save(clean, out, "notice_clean.png", gt_notice)
    save(degrade(clean, angle=2.5, noise=25, blur=1.2, shade=0.35, seed=1), out, "notice_scan.jpg", gt_notice)
    save(degrade(clean, angle=-4.0, noise=10, blur=0.8, seed=2, scale=1 / 3), out, "notice_lowres.png", gt_notice, dpi=100)
    save(degrade(clean, noise=50, blur=2.2, shade=0.5, seed=3, angle=1.0), out, "notice_poor.jpg", gt_notice)
    save(degrade(draw_table(font), angle=1.5, noise=10, blur=0.8, seed=4), out, "form_table.png",
         "\n".join(" ".join(r) for r in TABLE))
    save(degrade(draw_vertical(font), angle=1.0, noise=10, blur=0.8, seed=5), out, "vertical.png", "\n".join(VERTICAL))

    # 複数ページのスキャンPDF（画像のみのPDF）
    p1 = degrade(clean, angle=-1.5, noise=12, blur=1.0, shade=0.25, seed=6).convert("RGB")
    p2 = degrade(draw_notice(font, lines=["お支払い方法について", "", "窓口・銀行・コンビニでお支払いいただけます。", "口座振替をご希望の方は、同封の用紙にご記入ください。"]),
                 angle=1.0, noise=12, blur=1.0, seed=7).convert("RGB")
    pdf = out / "notice_2pages.pdf"
    p1.save(pdf, save_all=True, append_images=[p2], resolution=300)
    gt2 = "お支払い方法について\n\n窓口・銀行・コンビニでお支払いいただけます。\n口座振替をご希望の方は、同封の用紙にご記入ください。"
    (out / "notice_2pages.gt.txt").write_text(gt_notice + "\n" + gt2 + "\n", encoding="utf-8")
    print("作成:", pdf)


if __name__ == "__main__":
    main()
