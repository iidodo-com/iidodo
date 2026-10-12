import { useMemo, useRef } from 'react';
import { toCsv, toHtml, toJson } from '../core/report';
import { useApp } from './ctx';
import { baseName, download, stamp } from './format';

export function ReportView() {
  const { loaded } = useApp();
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => (loaded ? toHtml(loaded.model, loaded.analysis) : ''), [loaded]);
  if (!loaded) return null;
  const { model, analysis } = loaded;
  const base = `${baseName(model.fileName)}_xray_${stamp()}`;

  const print = () => {
    // 生成したレポートHTML（スクリプトなし・CSPあり）を非表示iframeに読み込んで印刷する
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    f.src = url;
    f.onload = () => {
      try { f.contentWindow?.focus(); f.contentWindow?.print(); } finally {
        setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000);
      }
    };
    document.body.appendChild(f);
  };

  return (
    <div className="page fill">
      <h2 className="page-title">レポート出力</h2>
      <p className="lead">検査結果を保存・印刷します。出力はすべてブラウザ内で生成され、元ファイルは変更されません。</p>
      <div className="export-grid">
        <button className="btn primary big" onClick={() => download(`${base}.html`, 'text/html;charset=utf-8', html)}>
          HTMLレポートを保存<small>集計・検査範囲・重要度別の警告一覧（単体で開けます）</small>
        </button>
        <button className="btn big" onClick={() => download(`${base}_warnings.csv`, 'text/csv;charset=utf-8', toCsv(analysis.findings))}>
          警告一覧をCSVで保存<small>{analysis.findings.length}件・Excelで開けるUTF-8(BOM付き)</small>
        </button>
        <button className="btn big" onClick={() => download(`${base}.json`, 'application/json;charset=utf-8', toJson(model, analysis))}>
          検査結果をJSONで保存<small>集計・検出・構造・検査範囲</small>
        </button>
        <button className="btn big" onClick={print}>
          レポートを印刷<small>ブラウザの印刷ダイアログ（PDF保存も可）</small>
        </button>
      </div>
      <p className="small">CSVでは、セルの内容が「=」「+」「-」「@」で始まる場合に先頭へ「'」を付けています（Excelで開いたときに数式として実行されるのを防ぐため）。</p>
      <h3 className="section">プレビュー</h3>
      <iframe ref={frame} className="preview" title="HTMLレポートのプレビュー" sandbox="" srcDoc={html} />
    </div>
  );
}
