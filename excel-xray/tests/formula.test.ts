import { describe, it, expect } from 'vitest';
import { parseFormula, keyToFormulaAt, describeKeyDifference } from '../src/core/formula';

describe('parseFormula', () => {
  it('行が変わるだけの正常な数式は同一キーになる', () => {
    const a = parseFormula('B2*C2', 2, 4);
    const b = parseFormula('B3*C3', 3, 4);
    const c = parseFormula('B100*C100', 100, 4);
    expect(a.key).toBe(b.key);
    expect(a.key).toBe(c.key);
  });
  it('参照ずれ (B6*C7) は別キーになるが形(shape)は同じ', () => {
    const ok = parseFormula('B6*C6', 6, 4);
    const ng = parseFormula('B6*C7', 6, 4);
    expect(ok.key).not.toBe(ng.key);
    expect(ok.shape).toBe(ng.shape);
  });
  it('絶対参照・複合参照を区別する', () => {
    const rel = parseFormula('B2*A1', 2, 3);
    const abs = parseFormula('B2*$A$1', 2, 3);
    const abs2 = parseFormula('B3*$A$1', 3, 3);
    expect(abs.key).toBe(abs2.key);
    expect(abs.key).not.toBe(rel.key);
    const mixed1 = parseFormula('B2*$A2', 2, 3);
    const mixed2 = parseFormula('B3*$A3', 3, 3);
    expect(mixed1.key).toBe(mixed2.key);
    const mixedCol = parseFormula('B2*A$1', 2, 3);
    const mixedCol2 = parseFormula('B3*A$1', 3, 3);
    expect(mixedCol.key).toBe(mixedCol2.key);
  });
  it('他シート参照と外部ブック参照を抽出する', () => {
    const p = parseFormula("SUM('My Sheet'!A1:A5)+Sheet2!$B$2+[1]Ext!C3", 1, 1);
    expect(p.refs.map((r) => r.sheet)).toEqual(['My Sheet', 'Sheet2', 'Ext']);
    expect(p.refs[0].kind).toBe('range');
    expect(p.refs[1].kind).toBe('cell');
    expect(p.refs[2].external).toBe('1');
    expect(p.hasExternal).toBe(true);
  });
  it('列全体・行全体参照を処理する', () => {
    const p = parseFormula('SUM(A:A)+SUM(2:2)', 1, 3);
    expect(p.refs[0].kind).toBe('column');
    expect(p.refs[1].kind).toBe('row');
  });
  it('動的関数・名前・構造化参照・エラー表記・数値を検出する', () => {
    const p = parseFormula('INDIRECT("A"&B1)+OFFSET(A1,1,1)+Rate+Tbl[Col]+#REF!+1.08', 1, 1);
    expect(p.dynamicFunctions).toEqual(['INDIRECT', 'OFFSET']);
    expect(p.names).toEqual(['Rate']);
    expect(p.structured).toEqual(['Tbl[Col]']);
    expect(p.errorLiterals).toEqual(['#REF!']);
    expect(p.numbers).toContain(1.08);
  });
  it('期待される数式を別セルへ適用できる', () => {
    const k = parseFormula('B2*C2', 2, 4).key;
    expect(keyToFormulaAt(k, 6, 4)).toBe('B6*C6');
    const bad = parseFormula('B6*C7', 6, 4).key;
    expect(describeKeyDifference(bad, k, 6, 4)).toContain('C7');
  });
  it('文字列中の参照様テキストは参照にしない', () => {
    const p = parseFormula('"A1"&B1', 1, 3);
    expect(p.refs).toHaveLength(1);
  });
});
