/**
 * テスト用Excelファイルのビルダー。外部通信なし、ローカルのExcelJS/JSZipだけで生成する。
 * 数式セルには「保存された計算結果」を result として明示的に書き込む（Excelの再計算は行わない）。
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

export type Builder = () => Promise<Uint8Array>;

async function toBuf(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const b = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return new Uint8Array(b);
}

function newWb(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'excel-xray-fixture';
  return wb;
}

/** 売上表: A=商品 B=数量 C=単価 D=金額(=B*C) */
function salesSheet(wb: ExcelJS.Workbook, name: string, rows: number, opts: { mutate?: (ws: ExcelJS.Worksheet) => void } = {}) {
  const ws = wb.addWorksheet(name);
  ws.addRow(['商品', '数量', '単価', '金額']);
  for (let i = 0; i < rows; i++) {
    const r = i + 2;
    const q = 10 + i;
    const p = 100 + i * 5;
    ws.getCell(`A${r}`).value = `商品${i + 1}`;
    ws.getCell(`B${r}`).value = q;
    ws.getCell(`C${r}`).value = p;
    ws.getCell(`D${r}`).value = { formula: `B${r}*C${r}`, result: q * p };
  }
  opts.mutate?.(ws);
  return ws;
}

/** 1. 正常な数式が並んだファイル（合計行つき。誤検知してはいけない） */
export const cleanFormulas: Builder = async () => {
  const wb = newWb();
  const ws = salesSheet(wb, '売上', 20);
  let total = 0;
  for (let i = 0; i < 20; i++) total += (10 + i) * (100 + i * 5);
  ws.getCell('A22').value = '合計';
  ws.getCell('D22').value = { formula: 'SUM(D2:D21)', result: total };
  ws.getCell('F1').value = '税率';
  ws.getCell('G1').value = 0.1;
  for (let r = 2; r <= 21; r++) {
    const d = (10 + r - 2) * (100 + (r - 2) * 5);
    ws.getCell(`E${r}`).value = { formula: `D${r}*$G$1`, result: d * 0.1 };
  }
  return toBuf(wb);
};

/** 2. 数式が1箇所だけ違う（D6 = B6*C7） */
export const oneOffFormula: Builder = async () => {
  const wb = newWb();
  salesSheet(wb, '売上', 5, {
    mutate: (ws) => { ws.getCell('D6').value = { formula: 'B6*C7', result: 0 }; },
  });
  return toBuf(wb);
};

/** 3. 数式領域に固定値が混在（E4=15000） */
export const hardcodedInFormulas: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('明細');
  ws.addRow(['品目', '', 'C', 'D', 'E']);
  for (let r = 2; r <= 8; r++) {
    ws.getCell(`C${r}`).value = r;
    ws.getCell(`D${r}`).value = 1000;
    if (r === 4) ws.getCell(`E${r}`).value = 15000;
    else ws.getCell(`E${r}`).value = { formula: `C${r}*D${r}`, result: r * 1000 };
  }
  return toBuf(wb);
};

/** 4. 非表示シート / Very Hiddenシート */
export const hiddenSheets: Builder = async () => {
  const wb = newWb();
  wb.addWorksheet('公開').getCell('A1').value = 'visible';
  const h = wb.addWorksheet('隠しシート');
  h.state = 'hidden';
  h.getCell('A1').value = 123;
  const vh = wb.addWorksheet('超隠し');
  vh.state = 'veryHidden';
  vh.getCell('A1').value = 'secret';
  return toBuf(wb);
};

/** 5. 非表示の行・列 */
export const hiddenRowsCols: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('Data');
  for (let r = 1; r <= 8; r++) for (let c = 1; c <= 4; c++) ws.getCell(r, c).value = r * c;
  ws.getRow(3).hidden = true;
  ws.getRow(4).hidden = true;
  ws.getRow(7).hidden = true;
  ws.getColumn(3).hidden = true;
  return toBuf(wb);
};

/** 6. 数式エラー（保存結果がエラー）と、エラー値の定数 */
export const errorValues: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('Err');
  ws.getCell('A1').value = 10;
  ws.getCell('A2').value = 0;
  ws.getCell('B1').value = { formula: 'A1/A2', result: { error: '#DIV/0!' } as ExcelJS.CellErrorValue };
  ws.getCell('B2').value = { formula: 'Gone!A1+1', result: { error: '#REF!' } as ExcelJS.CellErrorValue };
  ws.getCell('B3').value = { formula: 'VLOOKUP(5,A1:A2,1,FALSE)', result: { error: '#N/A' } as ExcelJS.CellErrorValue };
  ws.getCell('B4').value = { formula: 'FOO(1)', result: { error: '#NAME?' } as ExcelJS.CellErrorValue };
  ws.getCell('B5').value = { formula: '#REF!+A1', result: { error: '#REF!' } as ExcelJS.CellErrorValue };
  ws.getCell('B6').value = { formula: 'A1+"x"', result: { error: '#VALUE!' } as ExcelJS.CellErrorValue };
  ws.getCell('B7').value = { formula: 'SQRT(-1)', result: { error: '#NUM!' } as ExcelJS.CellErrorValue };
  ws.getCell('B8').value = { formula: 'A1 A2', result: { error: '#NULL!' } as ExcelJS.CellErrorValue };
  ws.getCell('C1').value = { error: '#N/A' } as ExcelJS.CellErrorValue; // 定数のエラー値
  ws.getCell('D1').value = { formula: 'A1+1' }; // 保存結果なし
  return toBuf(wb);
};

/** 7. 他シート参照 */
export const crossSheet: Builder = async () => {
  const wb = newWb();
  const d = wb.addWorksheet('明細');
  d.addRow(['x']);
  for (let r = 2; r <= 10; r++) d.getCell(`B${r}`).value = r;
  const s = wb.addWorksheet('集計');
  s.getCell('A1').value = { formula: '明細!B2+明細!B3', result: 5 };
  s.getCell('A2').value = { formula: 'SUM(明細!B2:B10)', result: 54 };
  s.getCell('A3').value = { formula: 'A1+A2', result: 59 };
  return toBuf(wb);
};

/** 8. 外部ブック参照（externalLinks パーツを手動で注入） */
export const externalRef: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('Main');
  ws.getCell('A1').value = { formula: "[1]Sheet1!$A$1*2", result: 20 };
  ws.getCell('A2').value = { formula: "SUM([1]Sheet1!A1:A3)", result: 60 };
  ws.getCell('A3').value = 5;
  const buf = await toBuf(wb);
  const zip = await JSZip.loadAsync(buf);
  zip.file('xl/externalLinks/externalLink1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><externalLink xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><externalBook r:id="rId1"><sheetNames><sheetName val="Sheet1"/></sheetNames></externalBook></externalLink>');
  zip.file('xl/externalLinks/_rels/externalLink1.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="file:///C:/Users/someone/Budget%202024.xlsx" TargetMode="External"/></Relationships>');
  let ct = await zip.file('[Content_Types].xml')!.async('string');
  ct = ct.replace('</Types>', '<Override PartName="/xl/externalLinks/externalLink1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml"/></Types>');
  zip.file('[Content_Types].xml', ct);
  let rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  rels = rels.replace('</Relationships>', '<Relationship Id="rIdExt1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="externalLinks/externalLink1.xml"/></Relationships>');
  zip.file('xl/_rels/workbook.xml.rels', rels);
  let wbx = await zip.file('xl/workbook.xml')!.async('string');
  wbx = wbx.replace('</sheets>', '</sheets><externalReferences><externalReference r:id="rIdExt1"/></externalReferences>');
  zip.file('xl/workbook.xml', wbx);
  return zip.generateAsync({ type: 'uint8array' });
};

/** 9. 名前定義（正常 / 壊れた名前 / ローカル名） */
export const definedNames: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('Calc');
  ws.getCell('A1').value = 0.08;
  ws.getCell('A2').value = 100;
  ws.getCell('B2').value = { formula: 'A2*TaxRate', result: 8 };
  wb.definedNames.add('Calc!$A$1', 'TaxRate');
  const buf = await toBuf(wb);
  const zip = await JSZip.loadAsync(buf);
  let wbx = await zip.file('xl/workbook.xml')!.async('string');
  const extra = '<definedName name="BrokenName">#REF!</definedName><definedName name="LocalRate" localSheetId="0">Calc!$A$2</definedName>';
  if (wbx.includes('</definedNames>')) wbx = wbx.replace('</definedNames>', extra + '</definedNames>');
  else wbx = wbx.replace('</sheets>', '</sheets><definedNames>' + extra + '</definedNames>');
  zip.file('xl/workbook.xml', wbx);
  return zip.generateAsync({ type: 'uint8array' });
};

/** 10. 大きめのデータ（20,000行 × 4列、うち2列が数式） */
export const largeData = (rows = 20000): Builder => async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('Big');
  ws.addRow(['a', 'b', 'a*b', 'a+b']);
  for (let i = 0; i < rows; i++) {
    const r = i + 2;
    const a = i % 97;
    const b = (i % 13) + 1;
    ws.addRow([a, b, { formula: `A${r}*B${r}`, result: a * b }, { formula: `A${r}+B${r}`, result: a + b }]);
  }
  return toBuf(wb);
};

/** 11. 相対参照と絶対参照が混在（正常。誤検知してはいけない） */
export const mixedReferences: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('Mix');
  ws.getCell('H1').value = 2;
  for (let r = 2; r <= 8; r++) {
    ws.getCell(`A${r}`).value = r;
    ws.getCell(`B${r}`).value = { formula: `A${r}*$H$1`, result: r * 2 };
    ws.getCell(`C${r}`).value = { formula: `$A${r}*B$1`, result: 0 };
    ws.getCell(`D${r}`).value = { formula: `A${r}+B${r}`, result: r + r * 2 };
  }
  ws.getCell('B1').value = 1;
  return toBuf(wb);
};

/** 12. 動的参照 (INDIRECT / OFFSET) */
export const dynamicRefs: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('Dyn');
  ws.getCell('A1').value = 1;
  ws.getCell('A2').value = 2;
  ws.getCell('B1').value = { formula: 'INDIRECT("A"&ROW())', result: 1 };
  ws.getCell('B2').value = { formula: 'OFFSET(A1,1,0)', result: 2 };
  return toBuf(wb);
};

/** 追加: 循環参照 */
export const circular: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('Loop');
  ws.getCell('A1').value = { formula: 'B1+1', result: 0 };
  ws.getCell('B1').value = { formula: 'A1+1', result: 0 };
  ws.getCell('C1').value = { formula: 'C1+1', result: 0 };
  return toBuf(wb);
};

/** 追加: 結合セル・ハイパーリンク・テーブル・入力規則 */
export const structures: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('構造');
  ws.getCell('A1').value = 'タイトル';
  ws.mergeCells('A1:C1');
  ws.mergeCells('A3:A5');
  ws.getCell('E1').value = { text: 'サイト', hyperlink: 'https://example.com/a?b=1' };
  ws.getCell('E2').value = { text: '内部', hyperlink: '#構造!A1' };
  ws.getCell('B7').dataValidation = { type: 'list', allowBlank: true, formulae: ['"はい,いいえ"'] };
  ws.addTable({
    name: 'Tbl1', ref: 'G1', headerRow: true,
    columns: [{ name: 'X' }, { name: 'Y' }],
    rows: [[1, 2], [3, 4]],
  });
  return toBuf(wb);
};

/** 追加: 比較用（旧版／新版） */
export const compareOld: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('売上');
  ws.addRow(['商品', '数量', '単価', '金額']);
  for (let r = 2; r <= 6; r++) {
    ws.getCell(`A${r}`).value = `P${r}`;
    ws.getCell(`B${r}`).value = r;
    ws.getCell(`C${r}`).value = 100;
    ws.getCell(`D${r}`).value = { formula: `B${r}*C${r}`, result: r * 100 };
  }
  wb.addWorksheet('旧シート').getCell('A1').value = 'old';
  wb.addWorksheet('改名前').getCell('A1').value = 'keep me';
  return toBuf(wb);
};

export const compareNew: Builder = async () => {
  const wb = newWb();
  const ws = wb.addWorksheet('売上');
  ws.addRow(['商品', '数量', '単価', '金額']);
  for (let r = 2; r <= 6; r++) {
    ws.getCell(`A${r}`).value = `P${r}`;
    ws.getCell(`B${r}`).value = r === 3 ? 99 : r; // 値の変更
    ws.getCell(`C${r}`).value = 100;
    if (r === 4) ws.getCell(`D${r}`).value = 400; // 数式→固定値
    else if (r === 5) ws.getCell(`D${r}`).value = { formula: `B${r}*C${r - 1}`, result: 0 }; // 参照先の変更
    else ws.getCell(`D${r}`).value = { formula: `B${r}*C${r}`, result: r * 100 };
  }
  ws.getCell('E2').value = { formula: 'D2*2', result: 400 }; // 追加
  wb.addWorksheet('新シート').getCell('A1').value = 'new';
  const rn = wb.addWorksheet('改名後');
  rn.getCell('A1').value = 'keep me';
  rn.state = 'hidden';
  return toBuf(wb);
};

export const ALL_FIXTURES: Record<string, Builder> = {
  '01_clean_formulas': cleanFormulas,
  '02_one_off_formula': oneOffFormula,
  '03_hardcoded_in_formulas': hardcodedInFormulas,
  '04_hidden_sheets': hiddenSheets,
  '05_hidden_rows_cols': hiddenRowsCols,
  '06_error_values': errorValues,
  '07_cross_sheet': crossSheet,
  '08_external_ref': externalRef,
  '09_defined_names': definedNames,
  '10_large_data': largeData(20000),
  '11_mixed_references': mixedReferences,
  '12_dynamic_refs': dynamicRefs,
  '13_circular': circular,
  '14_structures': structures,
  '15_compare_old': compareOld,
  '16_compare_new': compareNew,
};
