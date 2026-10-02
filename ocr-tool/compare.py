"""前処理あり・なしの精度比較。
samples フォルダ内の画像・PDFを、前処理の組み合わせを変えて何通りも読み取り、結果を表にする。
  - 正解テキスト（foo.png に対して foo.gt.txt）があれば文字誤り率(CER)を出す
  - なければ、平均信頼度・認識文字数・要確認行数で比較する（信頼度は目安で、正解率そのものではない）

使い方:
    python compare.py --input ./samples
    python compare.py --input ./samples --quick     # 「前処理なし」と「設定どおり」だけ比べる
"""
from __future__ import annotations

import argparse
import copy
import csv
import sys
import time
from pathlib import Path

from ocr_tool import engine, loader, pipeline
from ocr_tool.config import load_config, validate
from ocr_tool.errors import OcrToolError, explain_exception
from ocr_tool.metrics import cer

OFF = {"enabled": False, "grayscale": False, "deskew": False, "denoise": "none", "flatten": False, "binarize": "none"}


def variants(base_pp: dict, quick: bool) -> dict[str, dict]:
    """比較する前処理の組み合わせ（名前 → preprocess設定）。"""
    def pp(**kw):
        d = dict(OFF, enabled=True)
        d.update(kw)
        return d

    v = {"前処理なし": dict(OFF), "設定どおり(config.yaml)": dict(base_pp)}
    if not quick:
        v.update({
            "グレースケールのみ": pp(grayscale=True),
            "+傾き補正": pp(grayscale=True, deskew=True),
            "+ノイズ除去(median)": pp(grayscale=True, denoise="median"),
            "+照明ムラ補正": pp(grayscale=True, flatten=True),
            "+二値化(otsu)": pp(grayscale=True, binarize="otsu"),
            "傾き+照明補正": pp(grayscale=True, deskew=True, flatten=True),
            "傾き+median+照明補正": pp(grayscale=True, deskew=True, denoise="median", flatten=True),
        })
    return v


def read_file(path: Path, cfg: dict) -> tuple[str, list[engine.PageOCR], float]:
    """ファイル全ページをOCRし、(全文, ページ結果, 秒) を返す。"""
    t0 = time.perf_counter()
    results = [pipeline.ocr_page(p, cfg, want_pdf=False).ocr for p in loader.load_pages(path, cfg)]
    return "\n".join(r.text for r in results), results, time.perf_counter() - t0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="前処理あり/なしの精度比較")
    ap.add_argument("--config", default=str(Path(__file__).with_name("config.yaml")))
    ap.add_argument("--input", default="./samples")
    ap.add_argument("--output", default="./out_compare")
    ap.add_argument("--lang", help="言語（縦書きサンプルは jpn_vert で別途比較してください）")
    ap.add_argument("--quick", action="store_true", help="2通りだけ比べる")
    args = ap.parse_args(argv)

    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(errors="replace")
    try:
        cfg = load_config(args.config)
        if args.lang:
            cfg["ocr"]["language"] = args.lang
        cfg = validate(cfg)
        engine.setup_tesseract(cfg)
        files = loader.find_inputs(args.input, recursive=True)
    except OcrToolError as e:
        print(f"エラー: {e.message}\n対処: {e.hint}", file=sys.stderr)
        return 2
    if not files:
        print(f"比較対象の画像・PDFがありません: {args.input}", file=sys.stderr)
        return 2

    rows: list[dict] = []
    for f in files:
        gt_path = f.with_suffix(".gt.txt")
        gt = gt_path.read_text(encoding="utf-8") if gt_path.exists() else None
        for name, pp in variants(cfg["preprocess"], args.quick).items():
            c = copy.deepcopy(cfg)
            c["preprocess"] = pp
            try:
                text, pages, sec = read_file(f, c)
            except Exception as e:  # noqa: BLE001
                cause, _ = explain_exception(e)
                print(f"  失敗 {f.name} / {name}: {cause}")
                continue
            lines = [ln for p in pages for ln in p.lines]
            n = sum(len(ln.text) for ln in lines)
            mean = sum(ln.conf * len(ln.text) for ln in lines) / n if n else None
            low = sum(1 for ln in lines if ln.conf < cfg["review"]["threshold"])
            rows.append({
                "ファイル": f.name, "前処理": name, "文字数": n,
                "平均信頼度": "" if mean is None else round(mean, 1),
                "要確認行数": low, "行数": len(lines),
                "CER": "" if gt is None else round(cer(gt, text), 3),
                "秒": round(sec, 1),
            })
            r = rows[-1]
            print(f"{f.name:22s} {name:24s} 文字数{r['文字数']:4d} 信頼度{str(r['平均信頼度']):>5s} "
                  f"要確認{low:2d}/{len(lines):2d} CER{str(r['CER']):>6s} {r['秒']}秒")

    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "compare.csv", "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\n結果を保存しました: {out / 'compare.csv'}")
    print("CER は正解テキスト(.gt.txt)がある場合のみ表示（小さいほど良い）。信頼度はTesseractの自己評価で、高くても誤りがあり得ます。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
