import { describe, expect, it } from 'vitest';
import { parseText } from './parser';
import { buildGraph } from './layout';
import { parseLLMJson } from './llm';
import { SAMPLES } from './samples';

const labels = (g: ReturnType<typeof parseText>) => g.nodes.map((n) => n.label);

describe('parseText', () => {
  it('parses arrows with labels', () => {
    const g = parseText('A → B: 友人\nB -> C', 'relation');
    expect(labels(g)).toEqual(['A', 'B', 'C']);
    expect(g.edges).toMatchObject([
      { source: 'A', target: 'B', label: '友人' },
      { source: 'B', target: 'C', label: '' },
    ]);
  });
  it('parses chains, reverse and labeled-arrow forms', () => {
    const g = parseText('X → Y → Z: last\nP <- Q\nM --依頼--> N', 'flow');
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'Y', target: 'Z', label: 'last' }));
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'Q', target: 'P' }));
    expect(g.edges).toContainEqual(expect.objectContaining({ source: 'M', target: 'N', label: '依頼' }));
  });
  it('handles vs as bidirectional conflict', () => {
    const g = parseText('劉備 vs 曹操: 覇権争い\nA VS B', 'relation');
    expect(g.edges[0]).toMatchObject({ kind: 'conflict', bidirectional: true, label: '覇権争い' });
    expect(g.edges[1]).toMatchObject({ source: 'A', target: 'B', label: '対立' });
  });
  it('chains bullets in flow preset', () => {
    const g = parseText('- 設計\n- 実装\n- テスト', 'flow');
    expect(g.edges.map((e) => [e.source, e.target])).toEqual([
      ['設計', '実装'],
      ['実装', 'テスト'],
    ]);
  });
  it('extracts node category and section headers', () => {
    const g = parseText('# 蜀\n劉備(君主) → 関羽', 'relation');
    expect(g.nodes.find((n) => n.label === '劉備')?.category).toBe('君主');
    expect(g.nodes.find((n) => n.label === '関羽')?.category).toBe('蜀');
  });
  it('parses simple Japanese sentences', () => {
    const g = parseText('田中は佐藤にデザイン作成を依頼した。', 'relation');
    expect(g.edges[0]).toMatchObject({ source: '田中', target: '佐藤', label: 'デザイン作成を依頼した' });
  });
  it('does not create self loops or duplicates', () => {
    const g = parseText('A → A\nA → B\nA → B', 'relation');
    expect(g.edges).toHaveLength(1);
  });
  it('keeps hyphenated names intact', () => {
    expect(labels(parseText('e-mail → web', 'relation'))).toEqual(['e-mail', 'web']);
  });
  it('every sample yields a connected, finite layout', () => {
    for (const s of SAMPLES) {
      const raw = parseText(s.text, s.preset);
      expect(raw.nodes.length).toBeGreaterThan(3);
      expect(raw.edges.length).toBeGreaterThan(2);
      const g = buildGraph(raw, s.preset);
      expect(g.edges.length).toBe(raw.edges.length);
      for (const n of g.nodes) expect(Number.isFinite(n.x + n.y)).toBe(true);
    }
  });
});

describe('parseLLMJson', () => {
  it('accepts fenced output and maps ids to labels', () => {
    const g = parseLLMJson('```json\n{"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B","category":"人物"}],"edges":[{"source":"a","target":"b","label":"x","kind":"conflict"}]}\n```');
    expect(g.edges[0]).toMatchObject({ source: 'A', target: 'B', kind: 'conflict' });
  });
  it('rejects garbage', () => {
    expect(() => parseLLMJson('no json')).toThrow();
  });
});
