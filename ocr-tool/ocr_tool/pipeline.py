"""全体の処理の流れ：入力走査 → 1ページずつ前処理・OCR → 出力 → 要確認CSV。
1ファイル・1ページの失敗では止まらず、error.log に記録して次へ進む。"""
from __future__ import annotations

import csv
import io
import logging
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

from pypdf import PdfWriter

from . import cells as cells_mod
from . import cloud, engine, handwriting, loader, preprocess
from .config import is_vertical
from .errors import explain_exception
from .review import ReviewWriter, review_rows

log = logging.getLogger("ocr_tool")


@dataclass
class PageResult:
    page_no: int
    ocr: engine.PageOCR
    pdf_bytes: bytes | None
    applied: dict
    seconds: float


@dataclass
class Summary:
    ok_files: int = 0
    partial_files: int = 0
    failed_files: int = 0
    pages: int = 0
    failed_pages: int = 0
    review_rows: int = 0
    failures: list[str] = field(default_factory=list)


def ocr_page(page: loader.PageImage, cfg: dict, want_pdf: bool) -> PageResult:
    """1ページ分: 前処理 → 罫線のある書類はマス目ごとに読む（なければ文章として読む）→（任意で）検索可能PDF。
    検索可能PDFには、OCRに渡した画像（前処理後）が埋め込まれる。"""
    t0 = time.perf_counter()
    if cfg["ocr"]["engine"] == "handwriting":
        # 手書きモード: 傾き補正・照明ムラ補正までかけ、行ごとに手書き用モデルで読む（検索可能PDFは作らない）
        pp = {**cfg["preprocess"], "denoise": "none", "binarize": "none", "remove_lines": False}
        img, applied = preprocess.preprocess(page.image, pp)
        applied["engine"] = "handwriting"
        return PageResult(page.page_no, handwriting.recognize_page(preprocess.to_gray(img), cfg), None, applied, time.perf_counter() - t0)
    if cfg["ocr"]["engine"] in cloud.PROVIDERS:
        # クラウドOCR: 元の画像をそのまま送る（クラウド側で傾き・影・罫線に対処できる）。検索可能PDFは作らない
        res = cloud.recognize_page(page.image, cfg, cfg["ocr"]["engine"])
        return PageResult(page.page_no, res, None, {"engine": cfg["ocr"]["engine"]}, time.perf_counter() - t0)
    pp = dict(cfg["preprocess"])
    drop_lines = bool(pp.get("remove_lines")) and pp["enabled"]
    pp["remove_lines"] = False  # セル検出には罫線が必要なので、罫線除去は検出のあとで行う
    img, applied = preprocess.preprocess(page.image, pp, is_vertical(cfg))
    mode, found = cfg["layout"]["mode"], []
    # 前処理を切っているときは、影やノイズで罫線を誤検出しやすいので、mode: cells と明示した場合だけセル検出する
    if mode != "text" and not is_vertical(cfg) and (pp["enabled"] or mode == "cells"):
        found = cells_mod.detect_cells(preprocess.to_gray(img))
    use_cells = bool(found) and (len(found) >= cfg["layout"]["min_cells"] or mode == "cells")
    clean = preprocess.remove_lines(img) if (drop_lines or use_cells) else img
    if use_cells:
        result = cells_mod.recognize_cells(preprocess.to_gray(img), preprocess.to_gray(clean), found, cfg, page.dpi)
        applied["cells"] = len(found)
    else:
        result = engine.recognize(clean, cfg, page.dpi)
    if drop_lines:
        applied["remove_lines"] = True
    pdf = engine.make_searchable_pdf(clean, cfg, page.dpi) if want_pdf else None
    return PageResult(page.page_no, result, pdf, applied, time.perf_counter() - t0)


def output_dir_for(src: Path, input_root: Path, out_root: Path) -> Path:
    """入力ファイルごとの出力フォルダ。a.png と a.pdf が衝突しないよう拡張子を名前に含める。"""
    try:
        rel = src.relative_to(input_root)
    except ValueError:
        rel = Path(src.name)
    name = "__".join(rel.parent.parts + (rel.stem + "_" + rel.suffix.lstrip(".").lower(),))
    return out_root / name


def merge_pdfs(pages: list[bytes], dest: Path) -> None:
    """1ページずつのPDFを1つに結合する。"""
    writer = PdfWriter()
    for b in pages:
        writer.append(io.BytesIO(b))
    with open(dest, "wb") as f:
        writer.write(f)


def write_outputs(out_dir: Path, results: list[PageResult], cfg: dict) -> None:
    """ページ別txt・結合txt・検索可能PDFを書き出す（すべてUTF-8）。"""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = cfg["output"]
    combined: list[str] = []
    for r in results:
        if out["page_txt"]:
            (out_dir / f"page_{r.page_no:03d}.txt").write_text(r.ocr.text + "\n", encoding="utf-8")
        head = f"===== ページ {r.page_no} =====\n" if out["page_header"] else ""
        combined.append(head + r.ocr.text)
    (out_dir / "all.txt").write_text("\n\n".join(combined) + "\n", encoding="utf-8")
    cell_rows = [[r.page_no, ln.row_id + 1, i, *ln.box, ln.text, round(ln.conf, 1)]
                 for r in results for i, ln in enumerate((l for l in r.ocr.lines if l.is_cell), start=1)]
    if cell_rows:  # セルモードで読んだ場合: マスごとの結果（表の行番号・位置・文字・信頼度）
        with open(out_dir / "cells.csv", "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["ページ", "表の行", "セル番号", "x", "y", "幅", "高さ", "文字列", "信頼度"])
            w.writerows(cell_rows)
    pdfs = [r.pdf_bytes for r in results if r.pdf_bytes]
    if out["searchable_pdf"] and pdfs:
        merge_pdfs(pdfs, out_dir / "searchable.pdf")


def process_file(src: Path, input_root: Path, cfg: dict, out_root: Path,
                 writer: ReviewWriter, summary: Summary, tag: str = "") -> None:
    """1ファイルを処理する。ページ単位で失敗しても残りのページは続行する。"""
    want_pdf = cfg["output"]["searchable_pdf"]
    threshold = cfg["review"]["threshold"]
    results: list[PageResult] = []
    page_errors = 0
    try:
        pages = loader.load_pages(src, cfg)
        for page in pages:
            label = f"p.{page.page_no}/{page.total}"
            try:
                r = ocr_page(page, cfg, want_pdf)
            except Exception as e:  # noqa: BLE001  ページ単位で握りつぶして次へ
                cause, hint = explain_exception(e)
                log.error("%s %s: %s 【対処】%s\n%s", src, label, cause, hint, traceback.format_exc())
                print(f"{tag} {src.name} {label}  失敗: {cause}")
                page_errors += 1
                summary.failed_pages += 1
                summary.failures.append(f"{src.name} {label}: {cause}")
                continue
            results.append(r)
            summary.pages += 1
            rows = review_rows(src.name, r.page_no, r.ocr, threshold, cfg["review"]["word_level"])
            writer.write(rows)
            conf = r.ocr.mean_conf
            mode_note = f"  セル{r.applied['cells']}個" if r.applied.get("cells") else ""
            print(f"{tag} {src.name} {label}{mode_note}  文字数{sum(len(l.text) for l in r.ocr.lines)}"
                  f"  平均信頼度{'-' if conf is None else f'{conf:.1f}'}  要確認{len(rows)}件  {r.seconds:.1f}秒")
    except Exception as e:  # noqa: BLE001  ファイル単位の失敗（読み込み不可など）
        cause, hint = explain_exception(e)
        log.error("%s: %s 【対処】%s\n%s", src, cause, hint, traceback.format_exc())
        print(f"{tag} {src.name}  失敗: {cause}")
        summary.failures.append(f"{src.name}: {cause}")
        page_errors += 1

    if not results:  # 1ページも読み取れなかった
        summary.failed_files += 1
        return
    try:
        write_outputs(output_dir_for(src, input_root, out_root), results, cfg)
    except Exception as e:  # noqa: BLE001
        cause, hint = explain_exception(e)
        log.error("%s: 出力に失敗: %s 【対処】%s\n%s", src, cause, hint, traceback.format_exc())
        print(f"{tag} {src.name}  出力に失敗: {cause}")
        summary.failed_files += 1
        summary.failures.append(f"{src.name} (出力): {cause}")
        return
    if page_errors:
        summary.partial_files += 1
    else:
        summary.ok_files += 1


def run(cfg: dict) -> Summary:
    """設定に従い入力フォルダ全体を処理する。"""
    in_root = Path(cfg["input_dir"])
    out_root = Path(cfg["output_dir"])
    files = loader.find_inputs(in_root, cfg["recursive"])
    summary = Summary()
    if not files:
        print(f"入力フォルダに画像・PDFがありません: {in_root}（対応形式: png/jpg/bmp/tif/webp/pdf）")
        return summary
    out_root.mkdir(parents=True, exist_ok=True)
    print(f"{len(files)} 件のファイルを処理します（言語: {cfg['ocr']['language']}、"
          f"前処理: {'あり' if cfg['preprocess']['enabled'] else 'なし'}）")
    with ReviewWriter(out_root / "review.csv") as writer:
        for i, src in enumerate(files, start=1):
            process_file(src, in_root, cfg, out_root, writer, summary, tag=f"[{i}/{len(files)}]")
        summary.review_rows = writer.count
    return summary
