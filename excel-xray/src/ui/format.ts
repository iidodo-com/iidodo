import type { CellData } from '../core/types';

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

export function cellText(c: CellData | undefined): string {
  if (!c) return '';
  if (c.t === 'empty' || c.v === null) return '';
  if (c.t === 'boolean') return c.v ? 'TRUE' : 'FALSE';
  if (c.t === 'date') return String(c.v).replace('T00:00:00.000Z', '').replace('T', ' ').replace(/\.000Z$/, '');
  return String(c.v);
}

export const TYPE_LABEL: Record<string, string> = {
  number: '数値', string: '文字列', boolean: '真偽値', date: '日付', error: 'エラー値', empty: '空',
};

export function download(name: string, mime: string, content: string | Blob) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || 'excel';
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
