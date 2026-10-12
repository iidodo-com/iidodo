import { useRef, useState } from 'react';
import { useApp } from './ctx';

const SAMPLES: Array<[string, string]> = [
  ['02_one_off_formula', '数式が1箇所だけ違う（D6=B6*C7）'],
  ['03_hardcoded_in_formulas', '数式領域に固定値が混在（E4=15000）'],
  ['06_error_values', '数式エラー（#REF!・#DIV/0! ほか）'],
  ['04_hidden_sheets', '非表示シート・Very Hiddenシート'],
  ['08_external_ref', '外部ブック参照'],
  ['13_circular', '循環参照'],
  ['12_dynamic_refs', '動的参照（INDIRECT / OFFSET）'],
  ['01_clean_formulas', '正常な数式（誤検知しないことの確認用）'],
];

export function Home() {
  const { openFile, openBuffer } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [sampleBusy, setSampleBusy] = useState(false);

  const loadSample = async (key: string) => {
    setSampleBusy(true);
    try {
      const lib = await import('../../scripts/fixtures-lib');
      const build = lib.ALL_FIXTURES[key];
      const data = await build();
      await openBuffer(`${key}.xlsx`, data);
    } finally {
      setSampleBusy(false);
    }
  };

  return (
    <div className="home">
      <section
        className={`dropzone ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) openFile(f);
        }}
        aria-label="ファイルのドロップ領域"
      >
        <div className="dz-icon" aria-hidden="true">⌕</div>
        <h2>Excelファイルをここにドラッグ＆ドロップ</h2>
        <p>.xlsx / .xlsm に対応。ファイルはこのブラウザの中だけで解析され、外部へ送信されません。元ファイルは変更されません。</p>
        <button className="btn primary big" onClick={() => input.current?.click()}>ファイルを選択して検査を開始</button>
        <input
          ref={input} type="file" hidden
          accept=".xlsx,.xlsm,.xls,.xlsb,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }}
        />
      </section>

      <div className="home-grid">
        <section className="panel">
          <h3>何がわかるか</h3>
          <ul className="plain">
            <li>隠しシート／非表示の行・列／結合セル／名前定義／外部リンク</li>
            <li>数式エラー、数式パターンの不一致、数式領域に混ざった固定値</li>
            <li>セルの上流・下流の依存関係（グラフ表示）と循環参照の可能性</li>
            <li>検査結果のHTMLレポート・CSV・JSON出力、2ファイルの差分比較</li>
          </ul>
        </section>
        <section className="panel">
          <h3>ご注意</h3>
          <ul className="plain">
            <li>数式の再計算は行いません。ファイルに保存された計算結果だけを参照します。</li>
            <li>「候補」「可能性」と表示される項目は、誤りと断定できないものです。</li>
            <li>マクロは実行しません。外部リンク先へは接続しません。</li>
            <li>旧形式 .xls と .xlsb は未対応です（.xlsx で保存し直してください）。</li>
          </ul>
        </section>
        <section className="panel">
          <h3>サンプルで試す</h3>
          <p className="small">ブラウザ内で生成したサンプルブックを読み込みます（通信なし）。</p>
          <div className="sample-list">
            {SAMPLES.map(([k, label]) => (
              <button key={k} className="btn" disabled={sampleBusy} onClick={() => loadSample(k)}>{label}</button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
