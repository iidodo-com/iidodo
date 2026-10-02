"""入力フォルダの走査と、画像・PDFの読み込み（PDFは1ページずつ）。"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np
from PIL import Image, ImageOps, ImageSequence

from .errors import OcrToolError

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
PDF_EXTS = {".pdf"}


@dataclass
class PageImage:
    """1ページ分の画像（BGR, uint8）と付随情報。"""

    image: np.ndarray
    page_no: int      # 1始まり
    total: int        # 総ページ数
    dpi: int


def find_inputs(input_dir: str | Path, recursive: bool = False) -> list[Path]:
    """入力フォルダ内の対象ファイル（画像・PDF）を名前順で返す。"""
    root = Path(input_dir)
    if not root.is_dir():
        raise OcrToolError(
            f"入力フォルダが見つかりません: {root}",
            "--input で正しいフォルダを指定するか、フォルダを作成して画像・PDFを入れてください。",
        )
    it = root.rglob("*") if recursive else root.glob("*")
    files = [
        p for p in it
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS | PDF_EXTS and not p.name.startswith(("~", "."))
    ]
    return sorted(files, key=lambda p: str(p).lower())


def _pil_to_bgr(im: Image.Image) -> np.ndarray:
    """PillowImage → BGR配列。透過PNGは白背景に合成する。"""
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    return cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2BGR)


def _dpi_of(im: Image.Image, default: int) -> int:
    """画像のdpiメタデータが妥当ならそれを使い、なければ既定値。"""
    try:
        dpi = int(round(float(im.info.get("dpi", (0, 0))[0])))
    except (TypeError, ValueError, IndexError):
        dpi = 0
    return dpi if 70 <= dpi <= 1200 else default


def load_image_pages(path: Path, default_dpi: int) -> Iterator[PageImage]:
    """画像ファイルを読む。複数フレームのTIFFは1フレームずつ返す。
    ※ cv2.imread は日本語パスで失敗するため、Pillow経由で読む。"""
    try:
        with Image.open(path) as im:
            total = getattr(im, "n_frames", 1)
            for i, frame in enumerate(ImageSequence.Iterator(im), start=1):
                frame = ImageOps.exif_transpose(frame)  # スマホ写真の向き情報を反映
                yield PageImage(_pil_to_bgr(frame), i, total, _dpi_of(im, default_dpi))
    except OcrToolError:
        raise
    except Image.DecompressionBombError as e:
        raise OcrToolError(
            "画像が大きすぎて安全のため読み込みを中止しました。",
            "画像を縮小してから再実行してください。",
        ) from e
    except (OSError, ValueError) as e:
        raise OcrToolError(
            f"画像として読み込めませんでした（{e}）。",
            "ファイルが壊れていないか、拡張子と中身の形式が一致しているか確認してください。",
        ) from e


def load_pdf_pages(path: Path, render_dpi: int) -> Iterator[PageImage]:
    """PDFを1ページずつ画像化して返す（pypdfium2。Popplerは不要）。"""
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(str(path))
    except pdfium.PdfiumError as e:
        msg = str(e)
        if "password" in msg.lower():
            raise OcrToolError(
                "パスワード付きPDFのため開けません。",
                "パスワードを解除した（印刷→PDF保存などで再作成した）PDFを使ってください。",
            ) from e
        raise OcrToolError(
            f"PDFを開けませんでした（{msg}）。",
            "PDFが壊れていないか、別のビューアで開けるか確認してください。",
        ) from e
    try:
        total = len(pdf)
        if total == 0:
            raise OcrToolError("PDFにページがありません。", "空のPDFではないか確認してください。")
        for i in range(total):
            page = pdf[i]
            try:
                bitmap = page.render(scale=render_dpi / 72.0)  # 既定はBGR
                arr = bitmap.to_numpy()
                if arr.ndim == 3 and arr.shape[2] == 4:
                    arr = cv2.cvtColor(arr, cv2.COLOR_BGRA2BGR)
                yield PageImage(np.ascontiguousarray(arr), i + 1, total, render_dpi)
            finally:
                page.close()
    finally:
        pdf.close()


def load_pages(path: Path, cfg: dict) -> Iterator[PageImage]:
    """拡張子に応じて画像またはPDFを1ページずつ読み込む。"""
    if path.suffix.lower() in PDF_EXTS:
        return load_pdf_pages(path, cfg["pdf"]["render_dpi"])
    return load_image_pages(path, cfg["ocr"]["dpi"])
