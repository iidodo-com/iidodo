"""帳票突合の実行：入力ファイルの各ページ → 項目別読み取り → 突合 → CSV/HTML出力。
1ページの失敗では止まらず、error.log に記録して次へ進む。"""
from __future__ import annotations

import logging
import traceback
from pathlib import Path

from . import form, loader, matching, report
from .errors import explain_exception

log = logging.getLogger("ocr_tool")


def run(cfg: dict, tpl: form.Template, reference: list[dict] | None, out_dir: Path) -> dict:
    """入力フォルダの全ページを処理して out_dir に出力する。件数サマリを返す。"""
    files = loader.find_inputs(cfg["input_dir"], cfg["recursive"])
    summary = {"docs": 0, "failed": 0, "status": {}}
    if not files:
        print(f"入力フォルダに画像・PDFがありません: {cfg['input_dir']}")
        return summary
    out_dir.mkdir(parents=True, exist_ok=True)
    mcfg = tpl.match or {}
    docs: list[dict] = []
    print(f"{len(files)} 件のファイルを処理します（テンプレート: {tpl.name}、突合元: {'あり' if reference else 'なし'}）")
    for fi, src in enumerate(files, start=1):
        try:
            for page in loader.load_pages(src, cfg):
                name = src.name if page.total == 1 else f"{src.name} p.{page.page_no}"
                try:
                    results, frame, angle = form.read_form(page.image, tpl, cfg, page.dpi)
                    ref_row, ref_note, key_conf = None, "", "none"
                    if reference is not None:
                        key = next((r for r in results if r.id == mcfg.get("key")), None)
                        key_text = None if key is None or key.value is None else str(key.value)
                        ref_row, ref_note, key_conf = matching.find_reference_row(reference, mcfg["key_column"], key_text)
                    js = matching.judge_document(results, tpl, ref_row, cfg["review"]["threshold"])
                    status = matching.document_status(js)
                    if reference is not None and key_conf != "exact":
                        status = matching.NG if key_conf == "none" else max((status, matching.REVIEW), key=lambda s: matching.SEVERITY[s])
                    docs.append({"name": name, "status": status, "judgements": js, "ref_note": ref_note,
                                 "ref_key": "" if ref_row is None else ref_row.get(mcfg.get("key_column", ""), "")})
                    summary["docs"] += 1
                    summary["status"][status] = summary["status"].get(status, 0) + 1
                    bad = [j.label for j in js if matching.SEVERITY[j.status] >= 1]
                    print(f"[{fi}/{len(files)}] {name}: {status}" + (f"（確認: {', '.join(bad[:6])}{'…' if len(bad) > 6 else ''}）" if bad else ""))
                    if ref_note:
                        print(f"    突合元: {ref_note}")
                except Exception as e:  # noqa: BLE001  1ページの失敗では止まらない
                    cause, hint = explain_exception(e)
                    log.error("%s: %s 【対処】%s\n%s", name, cause, hint, traceback.format_exc())
                    print(f"[{fi}/{len(files)}] {name}: 失敗: {cause}")
                    summary["failed"] += 1
        except Exception as e:  # noqa: BLE001  ファイル単位の失敗（読み込み不可など）
            cause, hint = explain_exception(e)
            log.error("%s: %s 【対処】%s\n%s", src, cause, hint, traceback.format_exc())
            print(f"[{fi}/{len(files)}] {src.name}: 失敗: {cause}")
            summary["failed"] += 1
    if docs:
        report.write_csvs(out_dir, docs)
        summary["report"] = report.write_html(out_dir, docs, f"帳票突合レポート — {tpl.name}")
    return summary
