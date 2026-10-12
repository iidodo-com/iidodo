import { useApp } from './ctx';
import { fmtBytes } from './format';
import { SEVERITY_LABEL, type FindingKind, type Severity, type StructureCategory } from '../core/types';

interface CardProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Severity;
  onClick?: () => void;
  sub?: string;
}
function Card({ label, value, hint, tone, onClick, sub }: CardProps) {
  const body = (
    <>
      <span className="card-label">{label}</span>
      <b className={`card-value ${tone ? 'tone-' + tone : ''}`}>{value}</b>
      {sub && <span className="card-sub">{sub}</span>}
    </>
  );
  return onClick ? (
    <button className="card clickable" onClick={onClick} title={hint ?? 'クリックで該当の一覧へ移動'}>{body}</button>
  ) : (
    <div className="card" title={hint}>{body}</div>
  );
}

export function Dashboard() {
  const { loaded, goDiagnostics, goStructure, setTab, setCurrentSheet } = useApp();
  if (!loaded) return null;
  const { analysis: a, model } = loaded;
  const s = a.summary;
  const diag = (kind: FindingKind) => () => goDiagnostics({ kind });
  const struct = (c: StructureCategory) => () => goStructure(c);
  const nHighMed = s.bySeverity.high + s.bySeverity.medium;

  return (
    <div className="page">
      <h2 className="page-title">総合ダッシュボード</h2>
      <section className={`verdict ${nHighMed > 0 ? 'attn' : 'ok'}`} aria-live="polite">
        {nHighMed > 0 ? (
          <p><b>重要度「高」{s.bySeverity.high}件・「中」{s.bySeverity.medium}件</b>の確認項目があります。下のカードや一覧から確認してください。<span className="small">（「候補」は誤りと断定できないものです）</span></p>
        ) : (
          <p><b>重要度「高」「中」の検出はありません。</b> ただし「問題がない」とは限りません。下の「検査範囲」で、何を検査し何を検査していないかを確認してください。</p>
        )}
      </section>

      <h3 className="section">ファイル情報</h3>
      <div className="cards">
        <Card label="ファイル名" value={s.fileName} />
        <Card label="形式" value={s.fileFormat} />
        <Card label="ファイルサイズ" value={fmtBytes(s.fileSize)} />
        <Card label="作成アプリ（ファイル内の記載）" value={model.application ?? '取得できません'} />
      </div>

      <h3 className="section">重要度別の検出件数 <span className="small">クリックで数式診断へ</span></h3>
      <div className="cards">
        {(['high', 'medium', 'low', 'info'] as const).map((sev) => (
          <Card key={sev} label={`重要度「${SEVERITY_LABEL[sev]}」`} value={s.bySeverity[sev]} tone={s.bySeverity[sev] > 0 && sev !== 'info' ? sev : undefined}
            onClick={() => goDiagnostics({ severity: sev })} />
        ))}
      </div>

      <h3 className="section">構造</h3>
      <div className="cards">
        <Card label="シート総数" value={s.sheetCount} sub={`表示 ${s.visibleSheets} / 非表示 ${s.hiddenSheets} / Very Hidden ${s.veryHiddenSheets}`} onClick={struct('sheet')} />
        <Card label="使用範囲があるシート" value={s.sheetsWithData} onClick={() => setTab('sheets')} hint="シートエクスプローラーへ" />
        <Card label="非表示シート" value={s.hiddenSheets + s.veryHiddenSheets} tone={s.hiddenSheets + s.veryHiddenSheets ? 'medium' : undefined} onClick={struct('sheet')} />
        <Card label="非表示の行" value={s.hiddenRows} onClick={struct('hidden-rows')} />
        <Card label="非表示の列" value={s.hiddenCols} onClick={struct('hidden-cols')} />
        <Card label="名前定義" value={s.definedNames} onClick={struct('name')} />
        <Card label="結合セル" value={s.mergedCells} onClick={struct('merge')} />
        <Card label="外部リンク" value={s.externalLinks} tone={s.externalLinks ? 'medium' : undefined} onClick={struct('external-link')} />
        <Card label="外部ブック参照の数式" value={s.externalRefs} tone={s.externalRefs ? 'medium' : undefined} onClick={struct('external-ref')} />
        <Card label="ハイパーリンク" value={s.hyperlinks} onClick={struct('hyperlink')} />
      </div>

      <h3 className="section">数式の健康診断</h3>
      <div className="cards">
        <Card label="数式の総数" value={s.formulaCount} onClick={() => goDiagnostics({})} />
        <Card label="数式エラー（保存結果）" value={s.formulaErrorCells} tone={s.formulaErrorCells ? 'high' : undefined} onClick={diag('formula-error')} sub="保存された計算結果がエラーのセル" />
        <Card label="パターン不一致の候補" value={s.patternMismatch} tone={s.patternMismatch ? 'medium' : undefined} onClick={diag('pattern-mismatch')} sub="要確認の候補" />
        <Card label="固定値混入の候補" value={s.hardcodeCandidates} tone={s.hardcodeCandidates ? 'medium' : undefined} onClick={diag('hardcode-in-formulas')} sub="要確認の候補" />
        <Card label="循環参照の可能性" value={s.circularGroups} tone={s.circularGroups ? 'high' : undefined} onClick={diag('circular-ref')} />
        <Card label="動的参照（INDIRECT/OFFSET）" value={s.dynamicFormulas} onClick={diag('dynamic-ref')} sub="依存関係を完全には特定不可" />
      </div>

      <h3 className="section">シート別サマリー</h3>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>シート</th><th>表示状態</th><th>使用範囲</th><th className="num">数式</th><th className="num">値のあるセル</th><th className="num">警告</th></tr></thead>
          <tbody>
            {model.sheets.map((sh) => (
              <tr key={sh.name}>
                <td><button className="link" onClick={() => { setCurrentSheet(sh.name); setTab('sheets'); }}>{sh.name}</button></td>
                <td>{sh.state === 'visible' ? '表示' : sh.state === 'hidden' ? '非表示' : 'Very Hidden'}</td>
                <td className="mono">{sh.usedRange ?? '（なし）'}</td>
                <td className="num">{sh.formulaCount}</td>
                <td className="num">{sh.valueCount}</td>
                <td className="num">{a.findings.filter((f) => f.sheet === sh.name && f.severity !== 'info').length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="section">検査範囲（何を検査し、何を検査していないか）</h3>
      <div className="cover">
        <div><h4>検査できた項目</h4><ul>{a.coverage.checked.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><h4>検査対象外</h4><ul>{a.coverage.notChecked.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><h4>制約事項</h4><ul>{a.coverage.limitations.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      </div>
      {(a.truncatedNotes.length > 0 || model.warnings.length > 0) && (
        <div className="banner warn">{[...model.warnings, ...a.truncatedNotes].map((n, i) => <div key={i}>• {n}</div>)}</div>
      )}
    </div>
  );
}
