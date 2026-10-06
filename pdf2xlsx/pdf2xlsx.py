#!/usr/bin/env python3
"""システム出力PDF（支出一覧表）→ Excel 転記ツール。ネットワーク通信なし。

使い方: python pdf2xlsx.py <入力PDF> <転記先テンプレート.xlsx> <出力.xlsx> [--config config.json]
検証が1つでも外れたら出力ファイルを作らず終了コード1で止まる。
画面には件数・合計・検証結果のみ表示し、明細の中身は表示しない。
"""
import argparse
import datetime
import json
import os
import re
import sys

import openpyxl
import pdfplumber

# exe化(PyInstaller)時は exe と同じフォルダの config.json を読む（設定を差し替え可能にするため）
_BASE = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
DEFAULT_CONFIG = os.path.join(_BASE, "config.json")


class ExtractError(Exception):
    pass


def load_config(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


# ---------- PDF 読み取り ----------

def group_lines(words, tol):
    """単語をy座標で行にまとめ、上から順に [(top, [word,...]), ...] を返す。"""
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(w["top"] - lines[-1][0]) <= tol:
            lines[-1][1].append(w)
        else:
            lines.append((w["top"], [w]))
    return [(t, sorted(ws, key=lambda w: w["x0"])) for t, ws in lines]


def split_columns(line_words, bounds):
    cells = [[] for _ in range(len(bounds) + 1)]
    for w in line_words:
        idx = sum(1 for b in bounds if w["x0"] >= b)
        cells[idx].append(w["text"])
    return [" ".join(c).strip() for c in cells]


def parse_pdf(pdf_path, cfg):
    """PDFから構造を取り出す。返り値: dict(pages=[{rows, subtotal}], count, total, errors)"""
    pats = {k: re.compile(v) for k, v in cfg["patterns"].items()}
    headers = cfg["headers"]
    tol = cfg["row_y_tolerance"]
    bounds = cfg["column_x_boundaries"]
    errors = []
    pages = []
    summary = None
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            lines = group_lines(page.extract_words(), tol)
            hdr_idx = None
            for i, (_, ws) in enumerate(lines):
                if split_columns(ws, bounds) == headers:
                    hdr_idx = i
                    break
            if hdr_idx is None:
                errors.append(f"[検証5 見出し行] {pno}ページ: 見出し行が想定と異なる/見つからない "
                              f"(期待: {' / '.join(headers)})")
                continue
            rows, subtotal = [], None
            for top, ws in lines[hdr_idx + 1:]:
                text = " ".join(w["text"] for w in ws)
                m_sub = pats["subtotal_line"].match(text)
                m_sum = pats["summary_line"].match(text)
                if m_sub:
                    if subtotal is not None:
                        errors.append(f"[検証1 小計] {pno}ページ: 小計行が複数ある")
                    subtotal = int(m_sub.group(1).replace(",", ""))
                elif m_sum:
                    summary = (int(m_sum.group(1)), int(m_sum.group(2).replace(",", "")))
                else:
                    rows.append((pno, split_columns(ws, bounds)))
            pages.append({"page": pno, "rows": rows, "subtotal": subtotal})
    return {"pages": pages, "summary": summary, "errors": errors}


# ---------- 変換・検証 ----------

def convert_date(text, cfg):
    m = re.match(cfg["patterns"]["date"], text)
    if not m:
        raise ValueError("日付形式が不正")
    era = text[:2]
    if era not in cfg["era_offset"]:
        raise ValueError("元号が未対応")
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return datetime.datetime(cfg["era_offset"][era] + y, mo, d)


def build_records(parsed, cfg):
    """行を検証・変換する。(records, errors) を返す。records は転記用タプルのリスト。"""
    pats = {k: re.compile(v) for k, v in cfg["patterns"].items()}
    errors = list(parsed["errors"])
    records = []
    for p in parsed["pages"]:
        for pno, cells in p["rows"]:
            vno, date, code, name, memo, payee, amt = cells
            where = f"{pno}ページ 伝票番号 {vno or '(空)'}"
            if not all(cells):
                errors.append(f"[検証6 列] {where}: 空の列がある、または列数が想定と異なる")
                continue
            if not pats["voucher"].match(vno):
                errors.append(f"[検証6 型] {where}: 伝票番号の形式が不正")
            if not pats["code"].match(code):
                errors.append(f"[検証6 型] {where}: 科目コードが4桁数字でない")
            if not pats["amount"].match(amt):
                errors.append(f"[検証6 型] {where}: 金額が数値として読めない")
                continue
            try:
                dt = convert_date(date, cfg)
            except ValueError as e:
                errors.append(f"[検証6 型] {where}: 執行日 {e}")
                continue
            records.append((pno, vno, dt, code, name, memo, payee, int(amt.replace(",", ""))))

    # 検証1: ページ小計
    for p in parsed["pages"]:
        actual = sum(r[7] for r in records if r[0] == p["page"])
        if p["subtotal"] is None:
            errors.append(f"[検証1 小計] {p['page']}ページ: 小計行が見つからない")
        elif actual != p["subtotal"]:
            errors.append(f"[検証1 小計] {p['page']}ページ: 期待(PDF小計)={p['subtotal']:,} 実際(明細合計)={actual:,}")
    # 検証2・3: 合計・件数
    if parsed["summary"] is None:
        errors.append("[検証2/3 合計・件数] 最終ページの件数・合計行が見つからない")
    else:
        pdf_count, pdf_total = parsed["summary"]
        total = sum(r[7] for r in records)
        if total != pdf_total:
            errors.append(f"[検証2 合計] 期待(PDF合計)={pdf_total:,} 実際(明細合計)={total:,}")
        if len(records) != pdf_count:
            errors.append(f"[検証3 件数] 期待(PDF件数)={pdf_count} 実際(明細行数)={len(records)}")
    # 検証4: 伝票番号の重複
    seen, dups = set(), set()
    for r in records:
        (dups if r[1] in seen else seen).add(r[1])
    if dups:
        errors.append(f"[検証4 重複] 伝票番号が重複: {', '.join(sorted(dups))}")
    return records, errors


# ---------- Excel 書き込み ----------

def write_excel(template, output, records, pdf_total, cfg):
    x = cfg["excel"]
    wb = openpyxl.load_workbook(template)
    ws = wb[x["sheet"]]
    col_a = x["columns"][0]
    last = x["first_data_row"] - 1
    for r in range(x["first_data_row"], x["last_data_row"] + 1):
        if ws[f"{col_a}{r}"].value not in (None, ""):
            last = r
    start = last + 1
    if start + len(records) - 1 > x["last_data_row"]:
        raise ExtractError(f"転記先の行数が足りない (最終行 {x['last_data_row']} を超える)")
    existing = {ws[f"{col_a}{r}"].value for r in range(x["first_data_row"], last + 1)}
    clash = existing & {r[1] for r in records}
    if clash:
        raise ExtractError(f"転記先に既にある伝票番号と重複: {len(clash)}件")
    for i, rec in enumerate(records):
        for col, val in zip(x["columns"], rec[1:]):
            c = ws[f"{col}{start + i}"]
            c.value = val
            if col in x["number_formats"]:
                c.number_format = x["number_formats"][col]
    ws[x["pdf_total_cell"]].value = pdf_total
    wb.save(output)
    return start


def run(pdf, template, output, cfg):
    """処理本体。(ok, messages) を返す。ok でなければ出力ファイルは作らない。"""
    parsed = parse_pdf(pdf, cfg)
    records, errors = build_records(parsed, cfg)
    msgs = []
    if errors:
        return False, ["検証NG: 出力ファイルは作成しません"] + errors
    total = sum(r[7] for r in records)
    pdf_count, pdf_total = parsed["summary"]
    start = write_excel(template, output, records, pdf_total, cfg)
    msgs += [
        "検証OK（全6項目）",
        f"  1 ページ小計: {len(parsed['pages'])}ページとも一致",
        f"  2 合計: 明細合計 {total:,} = PDF合計 {pdf_total:,}",
        f"  3 件数: 明細 {len(records)} = PDF件数 {pdf_count}",
        "  4 伝票番号の重複: なし",
        "  5 見出し行: 想定どおり",
        "  6 列数・型: 想定どおり",
        f"転記件数: {len(records)} 件（{start}行目から）",
        f"転記合計: {total:,} 円",
        f"出力: {output}",
    ]
    return True, msgs


def main(argv=None):
    ap = argparse.ArgumentParser(description="PDF明細をExcelへ転記（検証付き）")
    ap.add_argument("pdf")
    ap.add_argument("template")
    ap.add_argument("output")
    ap.add_argument("--config", default=DEFAULT_CONFIG)
    a = ap.parse_args(argv)
    for src in (a.pdf, a.template):
        if os.path.abspath(a.output) == os.path.abspath(src):
            print("エラー: 出力先が入力ファイルと同じです（入力は上書きしません）", file=sys.stderr)
            return 2
    try:
        ok, msgs = run(a.pdf, a.template, a.output, load_config(a.config))
    except Exception as e:  # 想定外もファイルを作らず止める
        print(f"エラー: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    print("\n".join(msgs), file=sys.stderr if not ok else sys.stdout)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
