import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/core/parse';
import { analyzeWorkbook } from '../src/core/analyze';
import { diffWorkbooks } from '../src/core/diff';
import { toCsv, toHtml, toJson, csvCell, escapeHtml } from '../src/core/report';
import * as fx from '../scripts/fixtures-lib';

async function load(b: fx.Builder, name = 'f.xlsx') {
  const model = await parseWorkbook(await b(), { fileName: name });
  return { model, res: analyzeWorkbook(model) };
}

describe('レポート出力', () => {
  it('CSV: 件数・列・数式を含み、数式インジェクションを無効化する', async () => {
    const { res } = await load(fx.oneOffFormula);
    const csv = toCsv(res.findings);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('D6');
    expect(csv).toContain("'=B6*C7"); // 先頭の = は ' で無効化
    expect(csv.trim().split('\r\n').length).toBeGreaterThan(res.findings.length);
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('通常')).toBe('"通常"');
    expect(csvCell('a,b\n"c"')).toBe('"a,b\n""c"""');
  });
  it('JSON: パース可能で、サマリ・検出・検査範囲を含む', async () => {
    const { model, res } = await load(fx.errorValues);
    const j = JSON.parse(toJson(model, res));
    expect(j.summary.formulaErrorCells).toBe(8);
    expect(j.findings.length).toBe(res.findings.length);
    expect(j.coverage.notChecked.length).toBeGreaterThan(0);
    expect(j.file.name).toBe('f.xlsx');
  });
  it('HTML: 必要項目を含む', async () => {
    const { model, res } = await load(fx.oneOffFormula, '検査対象.xlsx');
    const html = toHtml(model, res);
    expect(html).toContain('検査対象.xlsx');
    expect(html).toContain('売上!D6');
    expect(html).toContain('=B6*C7');
    expect(html).toContain('検査範囲');
    expect(html).toContain('Content-Security-Policy');
    expect(html).not.toMatch(/<script/i);
  });
  it('HTML: ファイル名・シート名・値・数式の中のHTML/スクリプトを実行可能な形で出力しない', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('<img src=x onerror=alert(1)>');
    ws.getCell('A1').value = { formula: '1/0', result: { error: '#DIV/0!' } as ExcelJS.CellErrorValue };
    ws.getCell('A2').value = { formula: '"<script>alert(2)</script>"&A1', result: 'x' };
    wb.definedNames.add("'<img src=x onerror=alert(1)>'!$A$1", '<svg/onload=alert(3)>');
    const buf = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const model = await parseWorkbook(buf, { fileName: '"><script>alert(4)</script>.xlsx' });
    const html = toHtml(model, analyzeWorkbook(model));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img /i);
    expect(html).not.toMatch(/<svg/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
});

describe('ファイル比較', () => {
  it('シート追加・削除・改名、値/数式の変更、数式→固定値、参照先変更、構造変更を検出する', async () => {
    const a = await load(fx.compareOld);
    const b = await load(fx.compareNew);
    const d = diffWorkbooks(a.model, b.model);
    const by = (t: string) => d.items.filter((i) => i.type === t);
    expect(by('sheet-added').map((i) => i.sheet)).toEqual(['新シート']);
    expect(by('sheet-removed').map((i) => i.sheet)).toEqual(['旧シート']);
    expect(by('sheet-renamed')).toHaveLength(1);
    expect(by('sheet-renamed')[0]).toMatchObject({ oldSheet: '改名前', sheet: '改名後' });
    expect(by('value-changed').map((i) => i.address)).toEqual(['B3']);
    expect(by('value-changed')[0]).toMatchObject({ before: '3', after: '99' });
    expect(by('formula-to-value').map((i) => i.address)).toEqual(['D4']);
    expect(by('formula-to-value')[0].severity).toBe('high');
    expect(by('ref-changed').map((i) => i.address)).toEqual(['D5']);
    expect(by('ref-changed')[0].before).toContain('B5*C5');
    expect(by('ref-changed')[0].after).toContain('B5*C4');
    expect(by('cell-added').map((i) => i.address)).toContain('E2');
    expect(by('state-changed').map((i) => i.after)).toEqual(['hidden']);
    expect(d.totalChanges).toBe(d.items.length);
  });
  it('同一ファイル同士では差分なし', async () => {
    const a = await load(fx.compareOld);
    const b = await load(fx.compareOld);
    expect(diffWorkbooks(a.model, b.model).items).toHaveLength(0);
  });
});
