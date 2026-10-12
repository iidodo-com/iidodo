import type { DiffResult } from '../core/diff';
import type { GraphRequest, GraphResult } from '../core/graph';
import type { LoadPayload, Slot, WorkerRequest, WorkerResponse } from './protocol';

type Pending = {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  onProgress?: (m: string) => void;
};

export class XrayClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { p.onProgress?.(m.message); return; }
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message));
      else (p.resolve as (v: unknown) => void)(m.payload);
    };
    this.worker.onerror = (ev) => {
      const err = new Error(`ワーカーでエラーが発生しました: ${ev.message}`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  private send<T>(req: Omit<WorkerRequest, 'id'>, onProgress?: (m: string) => void, transfer?: Transferable[]): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject, onProgress });
      this.worker.postMessage({ ...req, id }, transfer ?? []);
    });
  }

  load(slot: Slot, fileName: string, buffer: ArrayBuffer, onProgress?: (m: string) => void): Promise<LoadPayload> {
    return this.send<LoadPayload>({ type: 'load', slot, fileName, buffer } as Omit<WorkerRequest, 'id'>, onProgress, [buffer]);
  }
  graph(slot: Slot, req: GraphRequest): Promise<GraphResult> {
    return this.send<GraphResult>({ type: 'graph', slot, req } as Omit<WorkerRequest, 'id'>);
  }
  compare(): Promise<DiffResult> {
    return this.send<DiffResult>({ type: 'compare' } as Omit<WorkerRequest, 'id'>);
  }
  terminate() { this.worker.terminate(); }
}
