export type Preset = 'relation' | 'causal' | 'flow';
export type Theme = 'light' | 'dark';
export type EdgeKind = 'normal' | 'conflict';

export interface DNode {
  id: string;
  label: string;
  category: string;
  note?: string;
  /** center position */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: EdgeKind;
  /** draw arrowheads on both ends */
  bidirectional?: boolean;
}

export interface Graph {
  nodes: DNode[];
  edges: DEdge[];
}

/** Graph before layout: nodes have no geometry */
export interface RawNode {
  label: string;
  category?: string;
  /** category was written by the user / LLM (not inferred) */
  explicit?: boolean;
  note?: string;
}
export interface RawEdge {
  source: string; // node label
  target: string;
  label?: string;
  kind?: EdgeKind;
  bidirectional?: boolean;
}
export interface RawGraph {
  nodes: RawNode[];
  edges: RawEdge[];
}

export interface View {
  x: number;
  y: number;
  k: number;
}

export type Provider = 'none' | 'openai' | 'anthropic';
export interface Settings {
  provider: Provider;
  apiKey: string;
  model: string;
}
