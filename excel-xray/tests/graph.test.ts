import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWorkbook } from '../src/core/parse';
import { buildIndex } from '../src/core/formulaTable';
import { GraphContext, type GraphRequest } from '../src/core/graph';
import * as fx from '../scripts/fixtures-lib';

async function ctxOf(b: fx.Builder) {
  const m = await parseWorkbook(await b(), { fileName: 'g.xlsx' });
  return new GraphContext(buildIndex(m));
}
const req = (o: Partial<GraphRequest> & { sheet: string; address: string }): GraphRequest =>
  ({ mode: 'both', depth: 3, maxNodes: 100, rangeExpandLimit: 10, ...o });

/** B2 → D2 → F2 → H2 の鎖 */
async function chainWb() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S');
  ws.getCell('B2').value = 5;
  ws.getCell('D2').value = { formula: 'B2*2', result: 10 };
  ws.getCell('F2').value = { formula: 'D2+1', result: 11 };
  ws.getCell('H2').value = { formula: 'F2*3', result: 33 };
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

describe('依存関係グラフ', () => {
  it('B2 → D2 → F2 → H2 の上流・下流・両方向', async () => {
    const g = new GraphContext(buildIndex(await parseWorkbook(await chainWb(), { fileName: 'c.xlsx' })));
    const down = g.query(req({ sheet: 'S', address: 'B2', mode: 'down' }));
    expect(down.nodes.map((n) => n.id).sort()).toEqual(['S!B2', 'S!D2', 'S!F2', 'S!H2']);
    expect(down.edges.map((e) => e.id).sort()).toEqual(['S!B2->S!D2', 'S!D2->S!F2', 'S!F2->S!H2']);
    const up = g.query(req({ sheet: 'S', address: 'H2', mode: 'up' }));
    expect(up.nodes.find((n) => n.id === 'S!B2')!.level).toBe(-3);
    const both = g.query(req({ sheet: 'S', address: 'F2', mode: 'both' }));
    expect(both.nodes).toHaveLength(4);
    expect(both.nodes.find((n) => n.id === 'S!F2')!.isRoot).toBe(true);
  });
  it('探索階層を制限すると先がある印(hasMore)が付く', async () => {
    const g = new GraphContext(buildIndex(await parseWorkbook(await chainWb(), { fileName: 'c.xlsx' })));
    const r = g.query(req({ sheet: 'S', address: 'H2', mode: 'up', depth: 1 }));
    expect(r.nodes.map((n) => n.id).sort()).toEqual(['S!F2', 'S!H2']);
    expect(r.nodes.find((n) => n.id === 'S!F2')!.hasMore).toBe(true);
  });
  it('セルの数式・保存値を持つ', async () => {
    const g = new GraphContext(buildIndex(await parseWorkbook(await chainWb(), { fileName: 'c.xlsx' })));
    const r = g.query(req({ sheet: 'S', address: 'D2', mode: 'up' }));
    const d2 = r.nodes.find((n) => n.id === 'S!D2')!;
    expect(d2).toMatchObject({ formula: '=B2*2', value: '10', isFormula: true });
  });
  it('他シート参照: シート名つきで表示し、範囲は集約する', async () => {
    const g = await ctxOf(fx.crossSheet);
    const r = g.query(req({ sheet: '集計', address: 'A3', mode: 'up' }));
    const ids = r.nodes.map((n) => n.id);
    expect(ids).toContain('明細!B2');
    expect(ids).toContain('明細!B2:B10');
    expect(ids).toContain('集計!A1');
    const d = g.query(req({ sheet: '明細', address: 'B2', mode: 'down' }));
    expect(d.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['集計!A1', '集計!A2', '集計!A3']));
  });
  it('巨大な範囲参照でノードが爆発せず、上限で打ち切る', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Big');
    for (let r = 1; r <= 500; r++) ws.getCell(`A${r}`).value = { formula: `${r}*2`, result: r * 2 };
    ws.getCell('C1').value = { formula: 'SUM(A:A)', result: 0 };
    ws.getCell('C2').value = { formula: 'SUM(A1:A500)', result: 0 };
    const g = new GraphContext(buildIndex(await parseWorkbook(new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer), { fileName: 'b.xlsx' })));
    const r = g.query(req({ sheet: 'Big', address: 'C1', mode: 'up', rangeExpandLimit: 5, maxNodes: 50 }));
    expect(r.nodes.length).toBeLessThanOrEqual(8);
    const range = r.nodes.find((n) => n.kind === 'range')!;
    expect(range.address).toBe('A:A');
    expect(range.note).toContain('先頭 5 個');
    const small = g.query(req({ sheet: 'Big', address: 'C2', mode: 'up', rangeExpandLimit: 1000, maxNodes: 20 }));
    expect(small.nodes.length).toBeLessThanOrEqual(20);
    expect(small.truncated).toBe(true);
    expect(small.notes.join()).toContain('上限');
  });
  it('循環参照を警告する', async () => {
    const g = await ctxOf(fx.circular);
    const r = g.query(req({ sheet: 'Loop', address: 'A1', mode: 'both' }));
    expect(r.cycleDetected).toBe(true);
    expect(r.notes.join()).toContain('循環参照');
    expect(r.nodes.find((n) => n.id === 'Loop!B1')!.inCycle).toBe(true);
  });
  it('INDIRECT/OFFSET は完全に特定できない旨を明示する', async () => {
    const g = await ctxOf(fx.dynamicRefs);
    const r = g.query(req({ sheet: 'Dyn', address: 'B1', mode: 'up' }));
    expect(r.notes.join()).toContain('完全に特定できません');
    expect(r.nodes.find((n) => n.id === 'Dyn!B1')!.dynamic).toBe(true);
  });
  it('外部ブック参照・存在しないシート・名前定義を扱う', async () => {
    const g = await ctxOf(fx.externalRef);
    const r = g.query(req({ sheet: 'Main', address: 'A1', mode: 'up' }));
    expect(r.nodes.some((n) => n.kind === 'external')).toBe(true);
    const gn = await ctxOf(fx.definedNames);
    const rn = gn.query(req({ sheet: 'Calc', address: 'B2', mode: 'up' }));
    expect(rn.nodes.map((n) => n.id)).toContain('Calc!A1');
    const ge = await ctxOf(fx.errorValues);
    const re = ge.query(req({ sheet: 'Err', address: 'B2', mode: 'up' }));
    expect(re.nodes.some((n) => n.kind === 'unresolved')).toBe(true);
  });
  it('不正な入力はエラーとして返す', async () => {
    const g = await ctxOf(fx.crossSheet);
    expect(g.query(req({ sheet: '集計', address: 'ZZZ' })).ok).toBe(false);
    expect(g.query(req({ sheet: 'nope', address: 'A1' })).ok).toBe(false);
  });
});
