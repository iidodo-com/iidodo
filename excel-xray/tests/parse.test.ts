import { describe, it, expect } from 'vitest';
import { parseWorkbook, ExcelXrayError } from '../src/core/parse';
import * as fx from '../scripts/fixtures-lib';

const parse = async (b: fx.Builder, name = 'test.xlsx') => parseWorkbook(await b(), { fileName: name });

describe('parseWorkbook', () => {
  it('シート・数式・保存値を読み取る', async () => {
    const m = await parse(fx.oneOffFormula);
    const s = m.sheets[0];
    expect(s.name).toBe('売上');
    expect(s.formulaCount).toBe(5);
    const d6 = s.cells.find((c) => c.r === 6 && c.c === 4)!;
    expect(d6.f).toBe('B6*C7');
    expect(d6.cached).toBe(true);
    expect(s.usedRange).toBe('A1:D6');
  });
  it('非表示/Very Hiddenシートを区別する', async () => {
    const m = await parse(fx.hiddenSheets);
    expect(m.sheets.map((s) => s.state)).toEqual(['visible', 'hidden', 'veryHidden']);
  });
  it('非表示の行・列を検出する', async () => {
    const s = (await parse(fx.hiddenRowsCols)).sheets[0];
    expect(s.hiddenRows).toEqual([3, 4, 7]);
    expect(s.hiddenCols).toEqual([3]);
  });
  it('エラー結果・保存結果なし・定数エラーを区別する', async () => {
    const s = (await parse(fx.errorValues)).sheets[0];
    const get = (a: string) => s.cells.find((c) => c.r === Number(a.slice(1)) && c.c === a.charCodeAt(0) - 64)!;
    expect(get('B1')).toMatchObject({ t: 'error', v: '#DIV/0!', f: 'A1/A2', cached: true });
    expect(get('D1')).toMatchObject({ t: 'empty', cached: false, f: 'A1+1' });
    expect(get('C1')).toMatchObject({ t: 'error', v: '#N/A' });
    expect(get('C1').f).toBeUndefined();
  });
  it('外部リンク・名前定義を生のXMLから読む', async () => {
    const e = await parse(fx.externalRef);
    expect(e.externalLinks).toHaveLength(1);
    expect(e.externalLinks[0].target).toContain('Budget%202024.xlsx');
    const n = await parse(fx.definedNames);
    const names = Object.fromEntries(n.definedNames.map((d) => [d.name, d]));
    expect(names.TaxRate.ref).toBe('Calc!$A$1');
    expect(names.BrokenName.ref).toBe('#REF!');
    expect(names.LocalRate.scope).toBe('Calc');
  });
  it('結合セル・ハイパーリンク・テーブル・入力規則を読む', async () => {
    const s = (await parse(fx.structures)).sheets[0];
    expect(s.merges).toEqual(['A1:C1', 'A3:A5']);
    expect(s.hyperlinks.map((h) => h.external)).toEqual([true, false]);
    expect(s.tables[0]).toEqual({ name: 'Tbl1', ref: 'G1:H3' });
    expect(s.validations[0].type).toBe('list');
    // 結合セルの従属セルは値としてカウントしない
    expect(s.cells.filter((c) => c.r === 1 && (c.c === 2 || c.c === 3))).toHaveLength(0);
  });
  it('壊れたファイル・未対応形式は ExcelXrayError', async () => {
    await expect(parseWorkbook(new Uint8Array([1, 2, 3, 4, 5]), { fileName: 'a.xlsx' })).rejects.toBeInstanceOf(ExcelXrayError);
    await expect(parseWorkbook(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), { fileName: 'a.xls' })).rejects.toThrow(/xls/);
    await expect(parseWorkbook(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9]), { fileName: 'a.xlsx' })).rejects.toBeInstanceOf(ExcelXrayError);
  });
  it('HTMLを含むシート名・値もそのまま保持される（エスケープは出力側）', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('<img src=x onerror=alert(1)>').getCell('A1').value = '<script>alert(1)</script>';
    const buf = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const m = await parseWorkbook(buf, { fileName: '<b>.xlsx' });
    expect(m.sheets[0].name).toContain('<img');
    expect(m.sheets[0].cells[0].v).toBe('<script>alert(1)</script>');
  });
});
