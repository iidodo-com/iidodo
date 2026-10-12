import type { AnalysisResult, Finding, WorkbookModel } from './types';
import { CERTAINTY_LABEL, KIND_LABEL, SEVERITY_LABEL } from './types';

export const TOOL_NAME = 'Excel X-Ray';
export const TOOL_VERSION = '1.0.0';

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/`/g, '&#96;');
}

/** CSV数式インジェクション対策: 先頭が = + - @ タブ CR のセルは ' を前置してテキスト扱いにする */
export function csvCell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(findings: Finding[]): string {
  const head = ['重要度', '判定の確実性', '種別', 'シート名', 'セル番地', '数式', '見出し', '検出理由', '確認すべき内容', '根拠', '件数'];
  const lines = [head.map(csvCell).join(',')];
  for (const f of findings) {
    lines.push([
      SEVERITY_LABEL[f.severity], CERTAINTY_LABEL[f.certainty], KIND_LABEL[f.kind], f.sheet ?? '', f.address ?? '',
      f.formula ?? '', f.title, f.reason, f.advice, f.evidence ?? '', f.count ?? '',
    ].map(csvCell).join(','));
  }
  // Excelで文字化けしないようBOMを付与
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function toJson(model: WorkbookModel, analysis: AnalysisResult): string {
  return JSON.stringify({
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    note: 'この結果はブラウザ内で生成されました。元ファイルは変更・送信されていません。「候補」「可能性」の項目は誤りの断定ではありません。',
    file: { name: model.fileName, size: model.fileSize, format: model.format, application: model.application },
    analyzedAt: analysis.analyzedAt,
    summary: analysis.summary,
    sheets: model.sheets.map((s) => ({
      name: s.name, state: s.state, usedRange: s.usedRange, formulaCount: s.formulaCount, valueCount: s.valueCount,
      hiddenRows: s.hiddenRows.length, hiddenCols: s.hiddenCols.length, merges: s.merges.length,
    })),
    coverage: analysis.coverage,
    notes: analysis.truncatedNotes,
    findings: analysis.findings,
    structure: analysis.structure,
  }, null, 2);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

const CSS = `
:root{--navy:#14213d;--ink:#1f2937;--muted:#5b6472;--line:#d6dbe3;--bg:#f4f6f9;--high:#c0262d;--medium:#b45f06;--low:#2b6cb0;--info:#5b6472}
*{box-sizing:border-box}body{margin:0;font:14px/1.6 -apple-system,"Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;color:var(--ink);background:var(--bg)}
header{background:var(--navy);color:#fff;padding:20px 28px}header h1{margin:0;font-size:20px}header p{margin:4px 0 0;color:#c8d0e0;font-size:13px}
main{max-width:1180px;margin:0 auto;padding:20px 28px 48px}h2{font-size:16px;margin:28px 0 8px;border-left:4px solid var(--navy);padding-left:10px}
table{border-collapse:collapse;width:100%;background:#fff;font-size:13px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{background:#e9edf3}
code,.mono{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;word-break:break-all}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;color:#fff;font-size:12px;white-space:nowrap}
.sev-high{background:var(--high)}.sev-medium{background:var(--medium)}.sev-low{background:var(--low)}.sev-info{background:var(--info)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}.card{background:#fff;border:1px solid var(--line);padding:8px 12px}.card b{display:block;font-size:20px}
.note{background:#fff8e1;border:1px solid #f0d68a;padding:8px 12px;margin:8px 0}.small{color:var(--muted);font-size:12px}
@media print{header{background:#fff;color:#000;border-bottom:2px solid #000}body{background:#fff}.badge{border:1px solid #000;color:#000!important;background:#fff!important}tr{break-inside:avoid}}
`;

export function toHtml(model: WorkbookModel, a: AnalysisResult): string {
  const s = a.summary;
  const E = escapeHtml;
  const card = (label: string, v: string | number) => `<div class="card"><span class="small">${E(label)}</span><b>${E(v)}</b></div>`;
  const rows = (['high', 'medium', 'low', 'info'] as const).map((sev) => {
    const list = a.findings.filter((f) => f.severity === sev);
    if (!list.length) return '';
    const body = list.map((f) => `<tr>
<td><span class="badge sev-${sev}">${E(SEVERITY_LABEL[sev])}</span></td>
<td>${E(KIND_LABEL[f.kind])}<br><span class="small">${E(CERTAINTY_LABEL[f.certainty])}</span></td>
<td class="mono">${E(f.sheet ?? '')}${f.address ? '!' + E(f.address) : ''}</td>
<td class="mono">${E(f.formula ?? '')}</td>
<td><b>${E(f.title)}</b><br>${E(f.reason)}${f.evidence ? `<br><span class="small">根拠: ${E(f.evidence)}</span>` : ''}${f.cells && f.cells.length ? `<br><span class="small">対象: ${E(f.cells.join(', '))}${f.count && f.count > f.cells.length ? ` ほか${E(f.count - f.cells.length)}件` : ''}</span>` : ''}</td>
<td>${E(f.advice)}</td></tr>`).join('');
    return `<h2>重要度「${E(SEVERITY_LABEL[sev])}」 ${list.length}件</h2>
<table><thead><tr><th>重要度</th><th>種別・確実性</th><th>シート!セル</th><th>数式</th><th>検出内容と理由</th><th>確認すべき内容</th></tr></thead><tbody>${body}</tbody></table>`;
  }).join('');

  const sheetRows = model.sheets.map((sh) => `<tr><td>${E(sh.name)}</td><td>${E(sh.state === 'visible' ? '表示' : sh.state === 'hidden' ? '非表示' : 'Very Hidden')}</td><td class="mono">${E(sh.usedRange ?? 'なし')}</td><td>${sh.formulaCount}</td><td>${sh.valueCount}</td><td>${sh.hiddenRows.length}行 / ${sh.hiddenCols.length}列</td></tr>`).join('');
  const structRows = a.structure.filter((x) => x.category !== 'sheet' && x.category !== 'cross-sheet-ref').slice(0, 1000).map((x) =>
    `<tr><td>${E(x.name)}</td><td>${E(x.sheet ?? '')}</td><td class="mono">${E(x.address ?? '')}</td><td class="mono">${E(x.evidence)}</td></tr>`).join('');

  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${E(TOOL_NAME)} 検査レポート - ${E(model.fileName)}</title><style>${CSS}</style></head><body>
<header><h1>${E(TOOL_NAME)} 検査レポート</h1><p>検査対象: ${E(model.fileName)} ／ 検査日時: ${E(new Date(a.analyzedAt).toLocaleString('ja-JP'))}</p></header>
<main>
<div class="note">このレポートはブラウザ内で生成されました。元ファイルは変更・外部送信されていません。「要確認の候補」「可能性」と表示された項目は、誤りと断定できないものです。</div>
<h2>集計結果</h2>
<div class="grid">
${card('ファイル形式', s.fileFormat)}${card('ファイルサイズ', fmtBytes(s.fileSize))}
${card('シート総数', s.sheetCount)}${card('表示 / 非表示 / Very Hidden', `${s.visibleSheets} / ${s.hiddenSheets} / ${s.veryHiddenSheets}`)}
${card('使用範囲のあるシート', s.sheetsWithData)}${card('数式の総数', s.formulaCount)}
${card('数式エラー（保存結果）', s.formulaErrorCells)}${card('パターン不一致候補', s.patternMismatch)}
${card('固定値混入候補', s.hardcodeCandidates)}${card('外部ブック参照の数式', s.externalRefs)}
${card('外部リンク', s.externalLinks)}${card('非表示の行 / 列', `${s.hiddenRows} / ${s.hiddenCols}`)}
${card('名前定義', s.definedNames)}${card('結合セル', s.mergedCells)}
${card('循環参照の可能性（グループ）', s.circularGroups)}${card('動的参照(INDIRECT/OFFSET)', s.dynamicFormulas)}
${card('重要度 高', s.bySeverity.high)}${card('重要度 中', s.bySeverity.medium)}${card('重要度 低', s.bySeverity.low)}${card('重要度 情報', s.bySeverity.info)}
</div>
<h2>検査範囲</h2>
<table><tbody>
<tr><th>検査できた項目</th><td><ul>${a.coverage.checked.map((x) => `<li>${E(x)}</li>`).join('')}</ul></td></tr>
<tr><th>検査対象外の項目</th><td><ul>${a.coverage.notChecked.map((x) => `<li>${E(x)}</li>`).join('')}</ul></td></tr>
<tr><th>制約事項</th><td><ul>${a.coverage.limitations.map((x) => `<li>${E(x)}</li>`).join('')}</ul></td></tr>
</tbody></table>
${a.truncatedNotes.length ? `<div class="note">${a.truncatedNotes.map(E).join('<br>')}</div>` : ''}
<h2>シート一覧</h2>
<table><thead><tr><th>シート名</th><th>表示状態</th><th>使用範囲</th><th>数式数</th><th>値のあるセル数</th><th>非表示</th></tr></thead><tbody>${sheetRows}</tbody></table>
${rows || '<p>検出項目はありません（上記「検査範囲」の範囲内で）。</p>'}
<h2>構造情報（名前定義・外部参照・結合セルなど）</h2>
<table><thead><tr><th>名称</th><th>シート</th><th>番地</th><th>検出根拠</th></tr></thead><tbody>${structRows}</tbody></table>
<p class="small">${E(TOOL_NAME)} v${E(TOOL_VERSION)}</p>
</main></body></html>`;
}
