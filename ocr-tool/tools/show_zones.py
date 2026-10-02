"""テンプレートの項目範囲を、帳票画像に重ねて表示する（位置の確認・調整用）。

使い方: python tools/show_zones.py --template templates/hiroshima_invoice.yaml --image 請求書.pdf --output zones.png
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ocr_tool import form, loader, preprocess  # noqa: E402
from ocr_tool.config import load_config  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", required=True)
    ap.add_argument("--image", required=True, help="画像またはPDF（1ページ目を使う）")
    ap.add_argument("--output", default="zones.png")
    a = ap.parse_args()
    cfg, tpl = load_config(None), form.load_template(a.template)
    page = next(iter(loader.load_pages(Path(a.image), cfg)))
    pp = {"enabled": True, "grayscale": True, "deskew": True, "denoise": "none", "flatten": True, "binarize": "none"}
    img = preprocess.to_gray(preprocess.preprocess(page.image, pp)[0])
    frame = form.detect_frame(img)
    vis = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    for f in tpl.fields:
        x0, y0, x1, y1 = form.field_box_px(f, frame, img.shape)
        color = (0, 0, 255) if f.handwritten else (0, 160, 0)
        cv2.rectangle(vis, (x0, y0), (x1, y1), color, 3)
        cv2.putText(vis, f.id, (x0 + 4, y0 + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)
    cv2.imencode(".png", vis)[1].tofile(a.output)
    print(f"枠: x={frame[0]} y={frame[1]} 幅={frame[2]}px / 緑=印刷項目、赤=手書き項目 → {a.output}")


if __name__ == "__main__":
    main()
