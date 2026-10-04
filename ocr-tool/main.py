"""日本語OCRツール 実行入口。

使い方:
    python main.py --input ./in --output ./out
    python main.py --input ./in --output ./out --lang jpn_vert      # 縦書き
    python main.py --input ./in --output ./out --no-preprocess      # 前処理なし
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ocr_tool import __version__, cloud, engine, handwriting, logger, pipeline
from ocr_tool.config import load_config, validate
from ocr_tool.errors import OcrToolError


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="日本語OCRツール（Tesseract使用・完全ローカル処理）")
    p.add_argument("--config", default=str(Path(__file__).with_name("config.yaml")), help="設定ファイル（既定: config.yaml）")
    p.add_argument("--input", help="入力フォルダ（config.yaml の input_dir を上書き）")
    p.add_argument("--output", help="出力フォルダ（config.yaml の output_dir を上書き）")
    p.add_argument("--lang", help="言語（例: jpn / jpn_vert / jpn+eng）")
    p.add_argument("--engine", choices=["tesseract", "handwriting", "google", "azure"], help="読み取りエンジン（handwriting=手書き用、google/azure=クラウド。クラウドは画像を外部に送信します）")
    p.add_argument("--recursive", action="store_true", help="サブフォルダも対象にする")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--preprocess", dest="preprocess", action="store_true", default=None, help="前処理を有効にする")
    g.add_argument("--no-preprocess", dest="preprocess", action="store_false", help="前処理を無効にする")
    p.add_argument("--threshold", type=float, help="要確認とする信頼度のしきい値（0-100）")
    p.add_argument("--word-level", action="store_true", help="単語単位の低信頼度もreview.csvに出す")
    p.add_argument("--no-pdf", action="store_true", help="検索可能PDFを作らない")
    return p.parse_args(argv)


def build_config(args: argparse.Namespace) -> dict:
    """config.yaml を読み、コマンドライン引数で上書きして検証する。"""
    cfg = load_config(args.config)
    if args.input:
        cfg["input_dir"] = args.input
    if args.output:
        cfg["output_dir"] = args.output
    if args.lang:
        cfg["ocr"]["language"] = args.lang
    if args.engine:
        cfg["ocr"]["engine"] = args.engine
    if args.recursive:
        cfg["recursive"] = True
    if args.preprocess is not None:
        cfg["preprocess"]["enabled"] = args.preprocess
    if args.threshold is not None:
        cfg["review"]["threshold"] = args.threshold
    if args.word_level:
        cfg["review"]["word_level"] = True
    if args.no_pdf:
        cfg["output"]["searchable_pdf"] = False
    return validate(cfg)


def main(argv: list[str] | None = None) -> int:
    # Windowsのコンソールで日本語が出力できない文字に当たっても落ちないようにする
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(errors="replace")
    try:
        cfg = build_config(parse_args(argv))
        version = engine.setup_tesseract(cfg) if cfg["ocr"]["engine"] == "tesseract" else "（このエンジンでは使用しません）"
        if cfg["ocr"]["engine"] == "handwriting":
            handwriting.check(cfg)
        elif cfg["ocr"]["engine"] in cloud.PROVIDERS:
            cloud.check(cfg, [cfg["ocr"]["engine"]])
            print(f"※ クラウドOCR（{cfg['ocr']['engine']}）を使います。書類の画像が外部に送信されます。")
        if cfg["ocr"]["engine"] != "tesseract":
            cfg["output"]["searchable_pdf"] = False  # Tesseract以外では検索可能PDFを作らない
        log_path = logger.setup_error_log(Path(cfg["output_dir"]))
        print(f"OCRツール {__version__} / Tesseract {version} を使用します。")
        summary = pipeline.run(cfg)
    except OcrToolError as e:
        print(f"エラー: {e.message}\n対処: {e.hint}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\n中断しました。ここまでの結果は出力フォルダに残っています。", file=sys.stderr)
        return 130

    print("\n===== 完了 =====")
    print(f"成功 {summary.ok_files} 件 / 一部失敗 {summary.partial_files} 件 / 失敗 {summary.failed_files} 件"
          f"（処理ページ {summary.pages}、失敗ページ {summary.failed_pages}）")
    print(f"要確認箇所: {summary.review_rows} 件 → {Path(cfg['output_dir']) / 'review.csv'}")
    if summary.failures:
        print(f"失敗の詳細は {log_path} を見てください:")
        for f in summary.failures[:10]:
            print(f"  - {f}")
    return 1 if (summary.failed_files or summary.failed_pages) else 0


if __name__ == "__main__":
    sys.exit(main())
