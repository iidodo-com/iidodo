import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DEdge, DNode, Theme } from '../types';
import { Scene } from '../components/Scene';
import { bounds } from './layout';
import { CANVAS } from './theme';

export function buildSvg(nodes: DNode[], edges: DEdge[], theme: Theme, pad = 56) {
  const b = bounds(nodes);
  const x = b.minX - pad;
  const y = b.minY - pad;
  const w = Math.max(1, Math.round(b.maxX - b.minX + pad * 2));
  const h = Math.max(1, Math.round(b.maxY - b.minY + pad * 2));
  const inner = renderToStaticMarkup(createElement(Scene, { nodes, edges, selectedId: null, theme }));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${CANVAS[theme].bg}"/>` +
    inner +
    `</svg>`;
  return { svg, w, h };
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportSvg(nodes: DNode[], edges: DEdge[], theme: Theme) {
  const { svg } = buildSvg(nodes, edges, theme);
  download(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml' }), 'diagram.svg');
}

export async function exportPng(nodes: DNode[], edges: DEdge[], theme: Theme, scale = 2) {
  const { svg, w, h } = buildSvg(nodes, edges, theme);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('画像の生成に失敗しました'));
      img.src = url;
    });
    // keep within common canvas limits
    const s = Math.min(scale, 16000 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(h * s);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNGの書き出しに失敗しました');
    download(blob, 'diagram@2x.png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
