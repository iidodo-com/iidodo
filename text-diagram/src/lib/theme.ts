import type { Theme } from '../types';

export interface Swatch {
  fill: string;
  stroke: string;
  text: string;
  sub: string;
  accent: string;
}

type Key = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet';
export const KEYS: Key[] = ['blue', 'emerald', 'amber', 'rose', 'violet'];

const SWATCHES: Record<Theme, Record<Key, Swatch>> = {
  light: {
    blue: { fill: '#eff6ff', stroke: '#93c5fd', text: '#1e3a8a', sub: '#3b82f6', accent: '#3b82f6' },
    emerald: { fill: '#ecfdf5', stroke: '#6ee7b7', text: '#064e3b', sub: '#059669', accent: '#10b981' },
    amber: { fill: '#fffbeb', stroke: '#fcd34d', text: '#78350f', sub: '#d97706', accent: '#f59e0b' },
    rose: { fill: '#fff1f2', stroke: '#fda4af', text: '#881337', sub: '#e11d48', accent: '#f43f5e' },
    violet: { fill: '#f5f3ff', stroke: '#c4b5fd', text: '#4c1d95', sub: '#7c3aed', accent: '#8b5cf6' },
  },
  dark: {
    blue: { fill: '#172554', stroke: '#2563eb', text: '#dbeafe', sub: '#93c5fd', accent: '#60a5fa' },
    emerald: { fill: '#052e2b', stroke: '#059669', text: '#d1fae5', sub: '#6ee7b7', accent: '#34d399' },
    amber: { fill: '#3b2506', stroke: '#d97706', text: '#fef3c7', sub: '#fcd34d', accent: '#fbbf24' },
    rose: { fill: '#4c0519', stroke: '#e11d48', text: '#ffe4e6', sub: '#fda4af', accent: '#fb7185' },
    violet: { fill: '#2e1065', stroke: '#7c3aed', text: '#ede9fe', sub: '#c4b5fd', accent: '#a78bfa' },
  },
};

export const CANVAS = {
  light: { bg: '#f8fafc', dot: '#cbd5e1', edge: '#94a3b8', edgeText: '#475569', labelBg: '#f8fafc', conflict: '#e11d48' },
  dark: { bg: '#0b1120', dot: '#1e293b', edge: '#64748b', edgeText: '#cbd5e1', labelBg: '#0b1120', conflict: '#fb7185' },
} as const;

const RULES: [RegExp, Key][] = [
  [/対立|敵|リスク|問題|課題|障害|失敗|risk|conflict|enemy|原因|悪役/i, 'rose'],
  [/完了|成功|結果|ゴール|終了|status|ステータス|成果|goal|done/i, 'emerald'],
  [/アクション|工程|手順|処理|action|step|作業|行動|タスク/i, 'amber'],
  [/概念|イベント|場所|判断|分岐|event|place|決定|会議|条件/i, 'violet'],
  [/人物|組織|エンティティ|entity|person|勢力|会社|チーム|要因|武将/i, 'blue'],
];

export function colorKey(category: string): Key {
  for (const [re, key] of RULES) if (re.test(category)) return key;
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return KEYS[h % KEYS.length];
}

export function swatch(category: string, theme: Theme): Swatch {
  return SWATCHES[theme][colorKey(category)];
}
