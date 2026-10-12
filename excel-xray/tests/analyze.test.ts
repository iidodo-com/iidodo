import { describe, it, expect } from 'vitest';
import { parseWorkbook } from '../src/core/parse';
import { analyzeWorkbook } from '../src/core/analyze';
import type { Finding, FindingKind } from '../src/core/types';
import * as fx from '../scripts/fixtures-lib';

async function run(b: fx.Builder, name = 'f.xlsx') {
  const model = await parseWorkbook(await b(), { fileName: name });
  return { model, res: analyzeWorkbook(model) };
}
const of = (fs: Finding[], k: FindingKind) => fs.filter((f) => f.kind === k);

describe('正常ファイルの誤検知がない', () => {
  it('正常な数式（合計行・絶対参照つき）', async () => {
    const { res } = await run(fx.cleanFormulas);
    for (const k of ['pattern-mismatch', 'hardcode-in-formulas', 'formula-error', 'circular-ref', 'ref-sheet-missing', 'ref-blank', 'embedded-constant'] as const) {
      expect(of(res.findings, k), k).toHaveLength(0);
    }
    expect(res.summary.bySeverity.high).toBe(0);
    expect(res.summary.formulaCount).toBe(41);
    expect(res.summary.patternMismatch).toBe(0);
  });
  it('相対参照・絶対参照・複合参照が混在しても誤検知しない', async () => {
    const { res } = await run(fx.mixedReferences);
    expect(of(res.findings, 'pattern-mismatch')).toHaveLength(0);
    expect(of(res.findings, 'hardcode-in-formulas')).toHaveLength(0);
  });
  it('大きめのデータ(20,000行)でも誤検知せず、現実的な時間で終わる', async () => {
    const t0 = Date.now();
    const { res } = await run(fx.largeData(20000));
    expect(res.summary.formulaCount).toBe(40000);
    expect(res.summary.patternMismatch).toBe(0);
    expect(Date.now() - t0).toBeLessThan(30000);
  });
});

describe('異常候補の検出と根拠', () => {
  it('D6 = B6*C7 を参照ずれ候補として検出し、想定形を示す', async () => {
    const { res } = await run(fx.oneOffFormula);
    const f = of(res.findings, 'pattern-mismatch');
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ sheet: '売上', address: 'D6', formula: '=B6*C7', severity: 'medium', certainty: 'candidate' });
    expect(f[0].reason).toContain('C7');
    expect(f[0].advice).toContain('=B6*C6');
    expect(f[0].evidence).toContain('D5');
    expect(f[0].title).toContain('可能性');
  });
  it('数式領域に混在する固定値 E4 を候補として検出する（確定エラーとは扱わない）', async () => {
    const { res } = await run(fx.hardcodedInFormulas);
    const f = of(res.findings, 'hardcode-in-formulas');
    expect(f.map((x) => x.address)).toEqual(['E4']);
    expect(f[0].certainty).not.toBe('confirmed');
    expect(f[0].reason).toContain('15000');
    expect(f[0].advice).toContain('=C4*D4');
    expect(of(res.findings, 'pattern-mismatch')).toHaveLength(0);
  });
  it('エラー結果を種類ごとに検出し、保存結果なしと区別する', async () => {
    const { res } = await run(fx.errorValues);
    const errs = of(res.findings, 'formula-error');
    expect(errs.map((e) => e.address).sort()).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
    for (const e of errs) expect(e.certainty).toBe('confirmed');
    expect(res.summary.formulaErrorCells).toBe(8);
    expect(of(res.findings, 'error-constant').map((e) => e.address)).toEqual(['C1']);
    expect(of(res.findings, 'ref-error-in-formula').map((e) => e.address)).toEqual(['B5']);
    const nc = of(res.findings, 'no-cache');
    expect(nc).toHaveLength(1);
    expect(nc[0].cells).toEqual(['D1']);
    // 保存結果がないセルはエラーと判定しない
    expect(errs.find((e) => e.address === 'D1')).toBeUndefined();
    // 存在しないシート参照
    expect(of(res.findings, 'ref-sheet-missing').map((e) => e.address)).toEqual(['B2']);
  });
  it('循環参照（相互・自己）を検出する', async () => {
    const { res } = await run(fx.circular);
    const c = of(res.findings, 'circular-ref');
    expect(c).toHaveLength(2);
    expect(res.summary.circularGroups).toBe(2);
    expect(c.some((x) => x.count === 2)).toBe(true);
  });
  it('INDIRECT/OFFSET は動的参照として制約を明示する', async () => {
    const { res } = await run(fx.dynamicRefs);
    const d = of(res.findings, 'dynamic-ref');
    expect(d).toHaveLength(2);
    expect(d[0].reason).toContain('確定できません');
    expect(res.summary.dynamicFormulas).toBe(2);
  });
});

describe('隠れた構造', () => {
  it('非表示シートとVery Hiddenシート', async () => {
    const { res } = await run(fx.hiddenSheets);
    expect(of(res.findings, 'hidden-sheet').map((f) => f.sheet)).toEqual(['隠しシート']);
    expect(of(res.findings, 'very-hidden-sheet').map((f) => f.sheet)).toEqual(['超隠し']);
    expect(res.summary).toMatchObject({ sheetCount: 3, visibleSheets: 1, hiddenSheets: 1, veryHiddenSheets: 1 });
  });
  it('非表示の行・列', async () => {
    const { res } = await run(fx.hiddenRowsCols);
    expect(res.summary.hiddenRows).toBe(3);
    expect(res.summary.hiddenCols).toBe(1);
    expect(of(res.findings, 'hidden-rows')[0].reason).toContain('3-4, 7');
    expect(of(res.findings, 'hidden-cols')[0].reason).toContain('C');
    expect(res.structure.filter((s) => s.category === 'hidden-rows')).toHaveLength(2);
  });
  it('他シート参照は構造情報として列挙される', async () => {
    const { res } = await run(fx.crossSheet);
    const x = res.structure.filter((s) => s.category === 'cross-sheet-ref');
    expect(x.map((s) => s.address)).toEqual(['A1', 'A2']);
    expect(of(res.findings, 'ref-sheet-missing')).toHaveLength(0);
  });
  it('外部ブック参照と外部リンク（接続はしない）', async () => {
    const { res } = await run(fx.externalRef);
    expect(res.summary.externalRefs).toBe(2);
    expect(res.summary.externalLinks).toBe(1);
    const l = of(res.findings, 'external-link')[0];
    expect(l.reason).toContain('Budget%202024.xlsx');
    expect(l.advice).toContain('接続しません');
    expect(of(res.findings, 'external-ref').map((f) => f.address)).toEqual(['A1', 'A2']);
    expect(of(res.findings, 'ref-sheet-missing')).toHaveLength(0);
  });
  it('名前定義（正常・壊れた・ローカル）', async () => {
    const { res } = await run(fx.definedNames);
    expect(res.summary.definedNames).toBe(3);
    expect(of(res.findings, 'name-broken').map((f) => f.title)).toEqual(['壊れた名前定義「BrokenName」']);
  });
  it('結合セル・ハイパーリンク・テーブル・入力規則', async () => {
    const { res } = await run(fx.structures);
    expect(res.summary.mergedCells).toBe(2);
    expect(res.summary.hyperlinks).toBe(2);
    expect(res.structure.some((s) => s.category === 'table' && s.name === 'Tbl1')).toBe(true);
    expect(res.structure.some((s) => s.category === 'validation')).toBe(true);
    expect(of(res.findings, 'hyperlink')).toHaveLength(1);
  });
});

describe('結果の整合性', () => {
  it('重要度別件数の合計が findings 数と一致し、「検査できた/できなかった」が示される', async () => {
    const { res } = await run(fx.errorValues);
    const s = res.summary.bySeverity;
    expect(s.high + s.medium + s.low + s.info).toBe(res.findings.length);
    expect(res.coverage.checked.length).toBeGreaterThan(3);
    expect(res.coverage.notChecked.join()).toContain('再計算');
    // 重要度順に並んでいる
    const rank = { high: 0, medium: 1, low: 2, info: 3 } as const;
    for (let i = 1; i < res.findings.length; i++) {
      expect(rank[res.findings[i - 1].severity]).toBeLessThanOrEqual(rank[res.findings[i].severity]);
    }
  });
});

describe('実務的なレイアウトでの誤検知', () => {
  it('月次の横並び・小計行・合計列・見出し・メモ欄があっても誤検知しない', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('損益');
    ws.getCell('A1').value = '成長率';
    ws.getCell('B1').value = 0.05;
    ws.getCell('A3').value = '売上';
    ws.getCell('B3').value = 1000;
    // 12か月の横並び: 前月 × (1+成長率)
    const L = (c: number) => String.fromCharCode(64 + c);
    for (let c = 3; c <= 14; c++) ws.getCell(3, c).value = { formula: `${L(c - 1)}3*(1+$B$1)`, result: 1 };
    ws.getCell('O3').value = { formula: 'SUM(B3:N3)', result: 1 }; // 合計列
    // 縦: 費用の小計・総計
    for (let r = 5; r <= 7; r++) ws.getCell(`B${r}`).value = r * 10;
    ws.getCell('B8').value = { formula: 'SUM(B5:B7)', result: 180 };
    for (let r = 10; r <= 12; r++) ws.getCell(`B${r}`).value = r * 10;
    ws.getCell('B13').value = { formula: 'SUM(B10:B12)', result: 330 };
    ws.getCell('B14').value = { formula: 'B8+B13', result: 510 };
    ws.getCell('D16').value = 'メモ: 手入力';
    const model = await parseWorkbook(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), { fileName: 'pl.xlsx' });
    const res = analyzeWorkbook(model);
    expect(of(res.findings, 'pattern-mismatch')).toHaveLength(0);
    expect(of(res.findings, 'hardcode-in-formulas')).toHaveLength(0);
    expect(res.summary.bySeverity.high).toBe(0);
  });
  it('同一列の連続数式の中央で参照が飛んでいる場合は「構造の違い」でも検出する', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    for (let r = 2; r <= 9; r++) {
      ws.getCell(`A${r}`).value = r;
      ws.getCell(`B${r}`).value = r === 5 ? { formula: `A${r}+100`, result: 0 } : { formula: `A${r}*2`, result: r * 2 };
    }
    const model = await parseWorkbook(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), { fileName: 's.xlsx' });
    const f = of(analyzeWorkbook(model).findings, 'pattern-mismatch');
    expect(f.map((x) => x.address)).toEqual(['B5']);
    expect(f[0].certainty).toBe('likely');
    expect(f[0].title).toContain('構造');
  });
});
