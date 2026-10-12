import { addr, cellKey } from './address';
import { parseFormula, type ParsedFormula } from './formula';
import type { CellData, SheetModel, WorkbookModel } from './types';

export interface FormulaEntry {
  sheet: string;
  r: number;
  c: number;
  f: string;
  cell: CellData;
  parsed: ParsedFormula;
}

/** 行→列で整列した、昇順の数値配列に対する二分探索付き索引 */
export class ColumnIndex {
  private cols = new Map<number, number[]>();
  private sortedCols: number[] = [];
  add(r: number, c: number) {
    let arr = this.cols.get(c);
    if (!arr) { arr = []; this.cols.set(c, arr); }
    arr.push(r);
  }
  finish() {
    for (const arr of this.cols.values()) arr.sort((a, b) => a - b);
    this.sortedCols = [...this.cols.keys()].sort((a, b) => a - b);
  }
  /** 矩形内の行・列を列挙する。limit に達したら打ち切り、打切りフラグを返す */
  query(r1: number, c1: number, r2: number, c2: number, limit: number, visit: (r: number, c: number) => void): boolean {
    let n = 0;
    for (const c of this.sortedCols) {
      if (c < c1) continue;
      if (c > c2) break;
      const arr = this.cols.get(c)!;
      let lo = 0, hi = arr.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < r1) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < arr.length && arr[i] <= r2; i++) {
        visit(arr[i], c);
        if (++n >= limit) return true;
      }
    }
    return false;
  }
  any(r1: number, c1: number, r2: number, c2: number): boolean {
    let found = false;
    this.query(r1, c1, r2, c2, 1, () => { found = true; });
    return found;
  }
}

export interface SheetIndex {
  sheet: SheetModel;
  byKey: Map<number, CellData>;
  formulas: Map<number, FormulaEntry>;
  allCells: ColumnIndex;
  formulaCells: ColumnIndex;
}

export interface WorkbookIndex {
  model: WorkbookModel;
  sheets: Map<string, SheetIndex>;
  /** 大文字小文字を無視したシート名検索 */
  sheetByLower: Map<string, SheetIndex>;
  entries: FormulaEntry[];
  parseFailures: FormulaEntry[];
}

export function buildIndex(model: WorkbookModel): WorkbookIndex {
  const sheets = new Map<string, SheetIndex>();
  const sheetByLower = new Map<string, SheetIndex>();
  const entries: FormulaEntry[] = [];
  const parseFailures: FormulaEntry[] = [];
  for (const sheet of model.sheets) {
    const si: SheetIndex = {
      sheet, byKey: new Map(), formulas: new Map(), allCells: new ColumnIndex(), formulaCells: new ColumnIndex(),
    };
    for (const cell of sheet.cells) {
      const k = cellKey(cell.r, cell.c);
      si.byKey.set(k, cell);
      si.allCells.add(cell.r, cell.c);
      if (cell.f !== undefined) {
        const parsed = parseFormula(cell.f, cell.r, cell.c);
        const e: FormulaEntry = { sheet: sheet.name, r: cell.r, c: cell.c, f: cell.f, cell, parsed };
        si.formulas.set(k, e);
        si.formulaCells.add(cell.r, cell.c);
        entries.push(e);
        if (!parsed.ok) parseFailures.push(e);
      }
    }
    si.allCells.finish();
    si.formulaCells.finish();
    sheets.set(sheet.name, si);
    sheetByLower.set(sheet.name.toLowerCase(), si);
  }
  return { model, sheets, sheetByLower, entries, parseFailures };
}

export function entryAddress(e: { r: number; c: number }): string {
  return addr(e.r, e.c);
}
