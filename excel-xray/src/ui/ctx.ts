import { createContext, useContext } from 'react';
import { cellKey } from '../core/address';
import type { AnalysisResult, CellData, Finding, FindingKind, Severity, SheetModel, StructureCategory, WorkbookModel } from '../core/types';
import type { XrayClient } from '../worker/client';

export type Tab = 'home' | 'dashboard' | 'sheets' | 'diagnostics' | 'graph' | 'structure' | 'report' | 'compare';

export interface SheetView {
  sheet: SheetModel;
  cells: Map<number, CellData>;
  hiddenRows: Set<number>;
  hiddenCols: Set<number>;
}

export interface Loaded {
  model: WorkbookModel;
  analysis: AnalysisResult;
  sheets: Map<string, SheetView>;
  /** "シート名!A1" -> そのセルに関する検出 */
  findingsByCell: Map<string, Finding[]>;
}

export function makeLoaded(model: WorkbookModel, analysis: AnalysisResult): Loaded {
  const sheets = new Map<string, SheetView>();
  for (const s of model.sheets) {
    const cells = new Map<number, CellData>();
    for (const c of s.cells) cells.set(cellKey(c.r, c.c), c);
    sheets.set(s.name, { sheet: s, cells, hiddenRows: new Set(s.hiddenRows), hiddenCols: new Set(s.hiddenCols) });
  }
  const findingsByCell = new Map<string, Finding[]>();
  const put = (k: string, f: Finding) => {
    const l = findingsByCell.get(k);
    if (l) { if (!l.includes(f)) l.push(f); } else findingsByCell.set(k, [f]);
  };
  for (const f of analysis.findings) {
    if (f.sheet && f.address && /^[A-Z]+\d+$/.test(f.address)) put(`${f.sheet}!${f.address}`, f);
    for (const c of f.cells ?? []) {
      if (/^[A-Z]+\d+$/.test(c)) put(`${f.sheet}!${c}`, f);
      else if (/^.+!\$?[A-Z]+\d+$/.test(c)) put(c, f);
    }
  }
  return { model, analysis, sheets, findingsByCell };
}

export interface Selection { sheet?: string; address?: string; finding?: Finding }

export interface DiagFilter { severity?: Severity | 'all'; kind?: FindingKind | 'all'; sheet?: string | 'all'; text?: string }

export interface AppCtx {
  loaded: Loaded | null;
  client: XrayClient;
  selection: Selection;
  select: (s: Selection) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  currentSheet: string | null;
  setCurrentSheet: (s: string) => void;
  /** シートエクスプローラーで表示・選択する */
  goCell: (sheet: string, address: string) => void;
  goGraph: (sheet: string, address: string) => void;
  graphTarget: { sheet: string; address: string; nonce: number } | null;
  diagFilter: DiagFilter;
  goDiagnostics: (f: DiagFilter) => void;
  structureCategory: StructureCategory | 'all';
  goStructure: (c: StructureCategory | 'all') => void;
  openFile: (f: File) => void;
  openBuffer: (name: string, data: Uint8Array) => void;
  focusRequest: { sheet: string; address: string; nonce: number } | null;
}

export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppCtx missing');
  return c;
}
