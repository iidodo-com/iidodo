"""帳票突合ツール 実行入口。様式の決まった帳票（請求書など）を項目ごとに読み取り、突合元CSVと照合する。

使い方:
    python reconcile.py --template templates/hiroshima_invoice.yaml --input ./in --reference ./reference.csv --output ./out_form
    python reconcile.py --template templates/hiroshima_invoice.yaml --input ./in          # 突合せず、項目の読み取りだけ
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from ocr_tool import __version__, engine, formrun, handwriting, logger
from ocr_tool.config import load_config, validate
from ocr_tool.errors import OcrToolError
from ocr_tool.form import load_template
from ocr_tool.matching import load_reference


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="帳票の項目読み取りと突合（Tesseract使用・完全ローカル処理）")
    ap.add_argument("--config", default=str(Path(__file__).with_name("config.yaml")))
    ap.add_argument("--template", required=True, help="帳票テンプレート(YAML)")
    ap.add_argument("--input", help="入力フォルダ")
    ap.add_argument("--output", default="./out_form", help="出力フォルダ（既定: ./out_form）")
    ap.add_argument("--reference", help="突合元CSV（なければ読み取りのみ）")
    ap.add_argument("--lang", help="言語（既定: config.yaml の ocr.language）")
    args = ap.parse_args(argv)
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(errors="replace")
    try:
        cfg = load_config(args.config)
        if args.input:
            cfg["input_dir"] = args.input
        if args.lang:
            cfg["ocr"]["language"] = args.lang
        cfg = validate(cfg)
        version = engine.setup_tesseract(cfg)
        if cfg["handwriting"]["enabled"]:
            handwriting.check(cfg)  # 手書き欄を手書き用モデルで読む設定のとき、準備できているか先に確認する
        out = Path(args.output)
        log_path = logger.setup_error_log(out)
        tpl = load_template(args.template)
        ref = load_reference(args.reference) if args.reference else None
        print(f"OCRツール {__version__} / Tesseract {version} を使用します。")
        summary = formrun.run(cfg, tpl, ref, out)
    except OcrToolError as e:
        print(f"エラー: {e.message}\n対処: {e.hint}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\n中断しました。", file=sys.stderr)
        return 130
    print("\n===== 完了 =====")
    print(f"処理 {summary['docs']} 枚 / 失敗 {summary['failed']} 枚 / 判定: " + (", ".join(f"{k} {v}" for k, v in summary["status"].items()) or "なし"))
    if "report" in summary:
        print(f"確認用レポート（ブラウザで開く）: {summary['report']}")
        print(f"CSV: {out / 'match_result.csv'} / {out / 'form_results.csv'}")
    if summary["failed"]:
        print(f"失敗の詳細: {log_path}")
    return 1 if summary["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
