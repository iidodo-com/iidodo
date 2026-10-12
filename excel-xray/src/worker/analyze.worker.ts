/// <reference lib="webworker" />
// 解析はすべてこのワーカー内（ブラウザ内）で行う。ネットワーク通信は一切行わない。
import { analyzeWorkbook } from '../core/analyze';
import { diffWorkbooks } from '../core/diff';
import { buildIndex } from '../core/formulaTable';
import { GraphContext } from '../core/graph';
import { ExcelXrayError, parseWorkbook } from '../core/parse';
import type { WorkbookModel } from '../core/types';
import type { Slot, WorkerRequest, WorkerResponse } from './protocol';

interface SlotState { model: WorkbookModel; graph: GraphContext }
const slots = new Map<Slot, SlotState>();

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'load') {
      slots.delete(msg.slot);
      const model = await parseWorkbook(msg.buffer, {
        fileName: msg.fileName,
        onProgress: (message) => post({ id: msg.id, type: 'progress', message }),
      });
      post({ id: msg.id, type: 'progress', message: '数式を解析し、検査しています' });
      const ix = buildIndex(model);
      const analysis = analyzeWorkbook(model, ix);
      slots.set(msg.slot, { model, graph: new GraphContext(ix) });
      post({ id: msg.id, type: 'load', payload: { model, analysis } });
    } else if (msg.type === 'graph') {
      const s = slots.get(msg.slot);
      if (!s) throw new ExcelXrayError('ファイルが読み込まれていません。');
      post({ id: msg.id, type: 'graph', payload: s.graph.query(msg.req) });
    } else if (msg.type === 'compare') {
      const a = slots.get('cmpA');
      const b = slots.get('cmpB');
      if (!a || !b) throw new ExcelXrayError('旧版・新版の両方のファイルを読み込んでください。');
      post({ id: msg.id, type: 'compare', payload: diffWorkbooks(a.model, b.model) });
    }
  } catch (e) {
    post({
      id: msg.id, type: 'error',
      message: e instanceof ExcelXrayError ? e.message : `予期しないエラーが発生しました: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
};
