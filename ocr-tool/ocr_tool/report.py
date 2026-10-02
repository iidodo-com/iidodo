"""突合結果の出力：CSV（読み取り結果・判定）と、画像つきの確認用HTML（1ファイル完結・外部通信なし）。"""
from __future__ import annotations

import base64
import csv
import html
from pathlib import Path

import cv2

from .matching import HAND, NG, OK, REVIEW, EMPTY, SKIP, Judgement

COLORS = {OK: "#1b7f3b", SKIP: "#6b7280", REVIEW: "#a15c00", HAND: "#a15c00", EMPTY: "#b42318", NG: "#b42318"}
BGS = {OK: "#e7f6ec", SKIP: "#f3f4f6", REVIEW: "#fff4d6", HAND: "#fff4d6", EMPTY: "#fde7e5", NG: "#fde7e5"}


def _png_b64(img) -> str:
    ok, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf.tobytes()).decode("ascii") if ok else ""


def write_csvs(out_dir: Path, docs: list[dict]) -> None:
    """読み取り結果（1書類1行）と、突合判定（1項目1行）をCSVに出す。Excelで開けるUTF-8(BOM付き)。"""
    labels: list[str] = []
    for d in docs:
        for j in d["judgements"]:
            if not j.id.startswith("check:") and j.label not in labels:
                labels.append(j.label)
    with open(out_dir / "form_results.csv", "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["書類", "判定", "突合元の行", *labels])
        for d in docs:
            by = {j.label: j for j in d["judgements"]}
            w.writerow([d["name"], d["status"], d["ref_note"] or d["ref_key"], *[by[l].read_value if l in by else "" for l in labels]])
    with open(out_dir / "match_result.csv", "w", encoding="utf-8-sig", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["書類", "項目", "読取値", "突合元の値", "判定", "理由", "信頼度"])
        for d in docs:
            for j in d["judgements"]:
                w.writerow([d["name"], j.label, j.read_value, j.ref_value, j.status, j.reason, "" if j.conf is None else round(j.conf)])


def write_html(out_dir: Path, docs: list[dict], title: str) -> Path:
    """確認用HTML。要確認・不一致・手書きの項目は、切り出し画像を並べて表示する。"""
    esc = html.escape
    parts = [f"""<!doctype html><meta charset="utf-8"><title>{esc(title)}</title>
<style>body{{font-family:'Yu Gothic UI','Meiryo',sans-serif;margin:24px;color:#1f2937}}
table{{border-collapse:collapse;width:100%;margin:8px 0 28px}}td,th{{border:1px solid #d1d5db;padding:6px 8px;vertical-align:top;font-size:14px}}
th{{background:#f3f4f6;text-align:left}}.s{{font-weight:700;white-space:nowrap}}img{{max-width:420px;max-height:90px;border:1px solid #ccc}}
h2{{margin-top:32px}}.sum span{{margin-right:16px}}</style><h1>{esc(title)}</h1>"""]
    sums = {}
    for d in docs:
        sums[d["status"]] = sums.get(d["status"], 0) + 1
    parts.append("<p class=sum>" + "".join(f"<span style='color:{COLORS[k]}'><b>{esc(k)}</b> {v}件</span>" for k, v in sums.items()) + "</p>")
    parts.append("<p>※ 画像は元の書類から切り出した各項目です。「要確認」「不一致」「要目視」は、必ず元の書類と見比べてください。</p>")
    for d in docs:
        c = COLORS[d["status"]]
        parts.append(f"<h2>{esc(d['name'])} — <span style='color:{c}'>{esc(d['status'])}</span></h2>")
        if d["ref_note"]:
            parts.append(f"<p style='color:#a15c00'>突合元: {esc(d['ref_note'])}</p>")
        parts.append("<table><tr><th>項目</th><th>判定</th><th>読取値</th><th>突合元の値</th><th>理由</th><th>切り出し画像</th></tr>")
        for j in d["judgements"]:
            img = ""
            if j.result is not None and j.result.crop is not None and j.status not in (OK, SKIP):
                img = f"<img src='data:image/png;base64,{_png_b64(j.result.crop)}'>"
            parts.append(f"<tr style='background:{BGS[j.status]}'><td>{esc(j.label)}</td><td class=s style='color:{COLORS[j.status]}'>{esc(j.status)}</td>"
                         f"<td>{esc(str(j.read_value))}</td><td>{esc(j.ref_value)}</td><td>{esc(j.reason)}</td><td>{img}</td></tr>")
        parts.append("</table>")
    path = out_dir / "report.html"
    path.write_text("".join(parts), encoding="utf-8")
    return path
