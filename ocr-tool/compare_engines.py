"""読み取りエンジンの比較：同じ書類を Tesseract / 手書きモデル / Google / Azure で読み、文字誤り率(CER)などを並べる。
  - 正解テキスト（foo.png に対して foo.gt.txt）があれば CER（小さいほど良い）を出す
  - 各エンジンの全文は out_engines/<エンジン>/ に保存するので、目で見比べられる
  - クラウドを含めると、ページ数×エンジン数だけ送信（無料枠を消費）する。実行前に確認する（--yes で省略）

使い方:
    python compare_engines.py --input ./samples --engines tesseract,google,azure
    python compare_engines.py --input ./samples --engines tesseract,handwriting --yes
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

from ocr_tool import cloud, engine, handwriting, loader, pipeline
from ocr_tool.config import load_config, validate
from ocr_tool.errors import OcrToolError, explain_exception
from ocr_tool.metrics import cer

ALL = ("tesseract", "handwriting", "google", "azure")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="読み取りエンジンの比較")
    ap.add_argument("--config", default=str(Path(__file__).with_name("config.yaml")))
    ap.add_argument("--input", default="./samples")
    ap.add_argument("--output", default="./out_engines")
    ap.add_argument("--engines", default="tesseract", help="カンマ区切り。例: tesseract,google,azure,handwriting")
    ap.add_argument("--yes", action="store_true", help="クラウド送信の確認を省略する")
    args = ap.parse_args(argv)
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(errors="replace")
    engines = [e.strip() for e in args.engines.split(",") if e.strip()]
    try:
        bad = [e for e in engines if e not in ALL]
        if bad:
            raise OcrToolError(f"未対応のエンジンです: {', '.join(bad)}", f"{' / '.join(ALL)} から選んでください。")
        cfg = validate(load_config(args.config))
        files = loader.find_inputs(args.input, recursive=True)
        if not files:
            raise OcrToolError(f"比較対象の画像・PDFがありません: {args.input}", "画像かPDFを置いてください。")
        pages = [(f, p) for f in files for p in loader.load_pages(f, cfg)]
        clouds = [e for e in engines if e in cloud.PROVIDERS]
        if "tesseract" in engines:
            engine.setup_tesseract(cfg)
        if "handwriting" in engines:
            handwriting.check(cfg)
        if clouds:
            cloud.check(cfg, clouds)
            n = len(pages)
            print(f"※ {n} ページを、{', '.join(clouds)} に送信します（各 {n} 回。無料枠を消費します）。書類の画像が外部に送信されます。")
            if not args.yes and input("続けますか？ (y/N): ").strip().lower() != "y":
                print("中止しました。")
                return 1
    except OcrToolError as e:
        print(f"エラー: {e.message}\n対処: {e.hint}", file=sys.stderr)
        return 2

    out = Path(args.output)
    rows = []
    by_file: dict = {}
    for f, page in pages:
        by_file.setdefault(f, []).append(page)
    for f, fpages in by_file.items():
        # 複数ページのPDFは、全ページをつないだ文字列を、1つの正解テキストと比べる
        gt_path = f.with_suffix(".gt.txt")
        gt = gt_path.read_text(encoding="utf-8") if gt_path.exists() else None
        for eng in engines:
            c = {**cfg, "ocr": {**cfg["ocr"], "engine": eng}}
            t0 = time.perf_counter()
            lines = []
            try:
                for page in fpages:
                    lines += pipeline.ocr_page(page, c, want_pdf=False).ocr.lines
            except Exception as e:  # noqa: BLE001  1つのエンジンの失敗で止めない
                cause, _ = explain_exception(e)
                print(f"  失敗 {f.name} / {eng}: {cause}")
                continue
            text = "\n".join(ln.text for ln in lines)
            (out / eng).mkdir(parents=True, exist_ok=True)
            (out / eng / (f.name + ".txt")).write_text(text + "\n", encoding="utf-8")
            n = sum(len(ln.text) for ln in lines)
            mean = sum(ln.conf * len(ln.text) for ln in lines) / n if n else None
            rows.append({"ファイル": f.name, "エンジン": eng, "文字数": n, "平均信頼度": "" if mean is None else round(mean, 1),
                         "CER": "" if gt is None else round(cer(gt, text), 3), "秒": round(time.perf_counter() - t0, 1)})
            print(f"{f.name:26s} {eng:12s} 文字数{n:5d} 信頼度{str(rows[-1]['平均信頼度']):>5s} CER{str(rows[-1]['CER']):>6s} {rows[-1]['秒']}秒")
    if rows:
        out.mkdir(parents=True, exist_ok=True)
        with open(out / "engines.csv", "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"\n結果: {out / 'engines.csv'} / 各エンジンの全文: {out}\\<エンジン>\\")
        print("CER は正解テキスト(.gt.txt)がある場合のみ（小さいほど良い）。信頼度はエンジンごとに意味が違うため、エンジン間の比較には使えません。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
