import type { DiffResult } from '../core/diff';
import type { GraphRequest, GraphResult } from '../core/graph';
import type { AnalysisResult, WorkbookModel } from '../core/types';

export type Slot = 'main' | 'cmpA' | 'cmpB';

export type WorkerRequest =
  | { id: number; type: 'load'; slot: Slot; fileName: string; buffer: ArrayBuffer }
  | { id: number; type: 'graph'; slot: Slot; req: GraphRequest }
  | { id: number; type: 'compare' };

export interface LoadPayload { model: WorkbookModel; analysis: AnalysisResult }

export type WorkerResponse =
  | { id: number; type: 'progress'; message: string }
  | { id: number; type: 'load'; payload: LoadPayload }
  | { id: number; type: 'graph'; payload: GraphResult }
  | { id: number; type: 'compare'; payload: DiffResult }
  | { id: number; type: 'error'; message: string };
