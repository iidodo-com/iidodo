export type Severity = 'high' | 'medium' | 'low' | 'info';
/** confirmed=ファイルに保存された事実 / likely=可能性が高い / candidate=要確認の候補 */
export type Certainty = 'confirmed' | 'likely' | 'candidate';
export type CellType = 'number' | 'string' | 'boolean' | 'date' | 'error' | 'empty';
export type SheetState = 'visible' | 'hidden' | 'veryHidden';

export interface CellData {
  /** 1始まりの行・列 */
  r: number;
  c: number;
  /** 保存されている値（数式セルの場合は保存された計算結果）の型 */
  t: CellType;
  v: string | number | boolean | null;
  /** 数式（先頭の = なし）。数式セルのみ */
  f?: string;
  /** 数式セルで、保存された計算結果が存在するか */
  cached?: boolean;
  /** 配列数式など */
  fkind?: 'normal' | 'array';
  nf?: string;
  link?: string;
}

export interface TableInfo { name: string; ref: string }
export interface ValidationInfo { ref: string; type: string; formulae: string[] }
export interface HyperlinkInfo { address: string; target: string; external: boolean }

export interface SheetModel {
  name: string;
  index: number;
  state: SheetState;
  /** 例: A1:F20。セルが無い場合 null */
  usedRange: string | null;
  maxRow: number;
  maxCol: number;
  cells: CellData[];
  formulaCount: number;
  valueCount: number;
  hiddenRows: number[];
  hiddenCols: number[];
  merges: string[];
  hyperlinks: HyperlinkInfo[];
  tables: TableInfo[];
  validations: ValidationInfo[];
}

export interface DefinedNameInfo {
  name: string;
  ref: string;
  /** null=ブック全体 */
  scope: string | null;
  hidden: boolean;
  builtin: boolean;
}

export interface ExternalLinkInfo { index: number; target: string | null; part: string }

export interface WorkbookModel {
  fileName: string;
  fileSize: number;
  format: string;
  sheets: SheetModel[];
  definedNames: DefinedNameInfo[];
  externalLinks: ExternalLinkInfo[];
  hasMacros: boolean;
  fullCalcOnLoad: boolean;
  application: string | null;
  /** 存在するが本ツールでは解析しない要素（グラフ・ピボット等） */
  unanalyzedParts: string[];
  warnings: string[];
}

export type FindingKind =
  | 'formula-error' | 'error-constant' | 'ref-error-in-formula'
  | 'pattern-mismatch' | 'hardcode-in-formulas' | 'embedded-constant'
  | 'ref-sheet-missing' | 'ref-blank' | 'circular-ref' | 'dynamic-ref' | 'no-cache'
  | 'hidden-sheet' | 'very-hidden-sheet' | 'hidden-rows' | 'hidden-cols'
  | 'merged-cells' | 'defined-name' | 'name-broken' | 'external-link' | 'external-ref'
  | 'hyperlink' | 'macro' | 'recalc-flag' | 'parse-failed';

export interface Finding {
  id: string;
  kind: FindingKind;
  severity: Severity;
  certainty: Certainty;
  sheet?: string;
  /** 代表セル／範囲（A1形式） */
  address?: string;
  formula?: string;
  title: string;
  reason: string;
  advice: string;
  evidence?: string;
  /** 同種のセルが複数ある場合の件数と一覧（上限あり） */
  count?: number;
  cells?: string[];
}

export type StructureCategory =
  | 'sheet' | 'hidden-rows' | 'hidden-cols' | 'merge' | 'name' | 'external-link'
  | 'external-ref' | 'hyperlink' | 'cross-sheet-ref' | 'table' | 'validation';

export interface StructureItem {
  category: StructureCategory;
  name: string;
  sheet?: string;
  address?: string;
  evidence: string;
}

export interface Summary {
  fileName: string;
  fileFormat: string;
  fileSize: number;
  sheetCount: number;
  visibleSheets: number;
  hiddenSheets: number;
  veryHiddenSheets: number;
  sheetsWithData: number;
  formulaCount: number;
  formulaErrorCells: number;
  patternMismatch: number;
  hardcodeCandidates: number;
  externalRefs: number;
  externalLinks: number;
  hiddenRows: number;
  hiddenCols: number;
  definedNames: number;
  mergedCells: number;
  hyperlinks: number;
  circularGroups: number;
  dynamicFormulas: number;
  bySeverity: Record<Severity, number>;
}

export interface Coverage {
  checked: string[];
  notChecked: string[];
  limitations: string[];
}

export interface AnalysisResult {
  summary: Summary;
  findings: Finding[];
  structure: StructureItem[];
  coverage: Coverage;
  analyzedAt: string;
  truncatedNotes: string[];
}

export const SEVERITY_LABEL: Record<Severity, string> = { high: '高', medium: '中', low: '低', info: '情報' };
export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
export const CERTAINTY_LABEL: Record<Certainty, string> = {
  confirmed: '事実（保存内容から確認）',
  likely: '可能性が高い',
  candidate: '要確認の候補',
};
export const KIND_LABEL: Record<FindingKind, string> = {
  'formula-error': '数式エラー（保存結果）',
  'error-constant': 'エラー値（定数）',
  'ref-error-in-formula': '数式内の #REF! 表記',
  'pattern-mismatch': '数式パターン不一致',
  'hardcode-in-formulas': '数式領域の固定値',
  'embedded-constant': '数式内の定数埋め込み',
  'ref-sheet-missing': '参照先シートが見つからない',
  'ref-blank': '空白セルを参照',
  'circular-ref': '循環参照の可能性',
  'dynamic-ref': '動的参照（静的解析の限界）',
  'no-cache': '計算結果が未保存',
  'hidden-sheet': '非表示シート',
  'very-hidden-sheet': 'Very Hiddenシート',
  'hidden-rows': '非表示の行',
  'hidden-cols': '非表示の列',
  'merged-cells': '結合セル',
  'defined-name': '名前定義',
  'name-broken': '壊れた名前定義',
  'external-link': '外部リンク',
  'external-ref': '外部ブック参照の数式',
  hyperlink: 'ハイパーリンク',
  macro: 'マクロ（VBA）を含む',
  'recalc-flag': '再計算フラグ',
  'parse-failed': '数式の解析失敗',
};
