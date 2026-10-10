import type { EdgeKind, Preset, RawEdge, RawGraph, RawNode } from '../types';

const BULLET = /^(?:[-*+•・●○▪‣◆■□▶]|\d+[.)．、）]|[①-⑳]|\(\d+\))\s*/;
const ARROW_SPLIT = /\s*(<->|<=>|↔|⇔|<-+|←|-+>|={1,2}>|→|⇒|➡|⟶)\s*/;
const LABELED_ARROW = /^(.+?)(?:\s+[-─—]+|--+|──+)\s*\[?([^>\]→⇒]+?)\]?\s*[-─—]*(?:>|→|⇒)\s*(.+)$/;
const VS = /^(.+?)(?:\s+(?:vs\.?|VS|Vs|対|×)\s+|\s*\b(?:vs|VS)\.?\b\s*)(.+)$/;
const TRAILING_LABEL = /^(.*\S)\s*[:：]\s*([^:：]+)$/;
const NODE_CAT = /^(.*?)\s*[（(]([^）)]{1,12})[）)]$/;
const HEADER = /^(?:#{1,3}\s*(.+)|[【\[]([^】\]]+)[】\]])$/;

const MAX_LABEL = 28;
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

class Builder {
  nodes: RawNode[] = [];
  edges: RawEdge[] = [];
  private index = new Map<string, RawNode>();

  node(token: string, category?: string): RawNode | null {
    let label = token.trim().replace(/^[「『"'“]|[」』"'”]$/g, '').trim();
    let cat = category;
    let explicit = category !== undefined;
    const m = NODE_CAT.exec(label);
    if (m && m[1].trim()) {
      label = m[1].trim();
      cat = m[2].trim();
      explicit = true;
    }
    label = label.replace(/[。.、,]$/, '');
    if (!label) return null;
    if (label.length > MAX_LABEL) label = label.slice(0, MAX_LABEL - 1) + '…';
    const key = norm(label);
    let n = this.index.get(key);
    if (!n) {
      n = { label, category: cat, explicit };
      this.index.set(key, n);
      this.nodes.push(n);
    } else if (explicit && !n.explicit) {
      n.category = cat;
      n.explicit = true;
    }
    return n;
  }

  edge(a: RawNode, b: RawNode, label = '', kind: EdgeKind = 'normal', bidirectional = false) {
    if (a === b) return;
    const dup = this.edges.some(
      (e) =>
        e.label === label &&
        ((e.source === a.label && e.target === b.label) ||
          (bidirectional && e.source === b.label && e.target === a.label)),
    );
    if (!dup) this.edges.push({ source: a.label, target: b.label, label, kind, bidirectional });
  }
}

/** Japanese causal / contrast connectors */
const CAUSAL = /^(.{2,30}?)(ため|ので|ことで|ことにより|によって|により|結果|せいで|から)[、,]?\s*(.{2,40})$/;
const CONTRAST = /^(.{2,30}?)[、,]?\s*(一方|しかし|ところが|対して|反対に)[、,]?\s*(.{2,40})$/;
const SVO = /^(.{1,10}?)(?:は|が)(.{1,12}?)(を|に|と|へ|から|で)(.{1,16})$/;

function parseSentence(b: Builder, s: string, preset: Preset, cat?: string): RawNode | null {
  const c = CONTRAST.exec(s);
  if (c) {
    const x = b.node(c[1], cat);
    const y = b.node(c[3], cat);
    if (x && y) b.edge(x, y, c[2], 'conflict', true);
    return y;
  }
  if (preset === 'causal') {
    const m = CAUSAL.exec(s);
    if (m) {
      const x = b.node(m[1], cat);
      const y = b.node(m[3], cat);
      if (x && y) b.edge(x, y, m[2] === 'から' ? '原因' : m[2]);
      return y;
    }
  }
  const m = SVO.exec(s);
  if (m && preset !== 'flow') {
    const subj = b.node(m[1], cat);
    const obj = b.node(m[2], cat);
    if (subj && obj) {
      const verb = m[4];
      const conflict = /敗|倒|裏切|攻|戦|対立|殺|滅|争|破|奪|憎|恨/.test(m[4]);
      b.edge(subj, obj, verb.replace(/[。.]$/, ''), conflict ? 'conflict' : 'normal');
      return obj;
    }
  }
  return null;
}

export function parseText(text: string, preset: Preset): RawGraph {
  const b = new Builder();
  let section: string | undefined;
  let prev: RawNode | null = null; // previous plain item (flow chaining)

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;

    const h = HEADER.exec(line);
    if (h) {
      section = (h[1] ?? h[2]).trim();
      prev = null;
      continue;
    }
    line = line.replace(BULLET, '').trim();
    if (!line) continue;

    // 1) arrow chains: A → B → C : label
    let handled = false;
    const labeled = LABELED_ARROW.exec(line);
    if (labeled && !/^[^→⇒>]*$/.test(line)) {
      const a = b.node(labeled[1], section);
      const c = b.node(labeled[3].replace(TRAILING_LABEL, '$1'), section);
      if (a && c) {
        b.edge(a, c, labeled[2].trim());
        prev = c;
        handled = true;
      }
    }
    if (!handled && ARROW_SPLIT.test(line)) {
      let body = line;
      let label = '';
      const t = TRAILING_LABEL.exec(line);
      if (t && ARROW_SPLIT.test(t[1])) {
        body = t[1];
        label = t[2].trim();
      }
      const parts = body.split(ARROW_SPLIT); // [node, arrow, node, arrow, node...]
      const toks: { n: RawNode; arrow?: string }[] = [];
      for (let i = 0; i < parts.length; i += 2) {
        const n = b.node(parts[i], section);
        if (n) toks.push({ n, arrow: parts[i + 1] });
      }
      for (let i = 0; i + 1 < toks.length; i++) {
        const arrow = toks[i].arrow ?? '->';
        const l = i === toks.length - 2 ? label : '';
        const bi = /<.*>|↔|⇔/.test(arrow) && !/^<-+$/.test(arrow);
        if (/^(<-+|←)$/.test(arrow)) b.edge(toks[i + 1].n, toks[i].n, l);
        else b.edge(toks[i].n, toks[i + 1].n, l, 'normal', bi);
      }
      if (toks.length) {
        prev = toks[toks.length - 1].n;
        handled = true;
      }
    }

    // 2) versus
    if (!handled) {
      let body = line;
      let label = '対立';
      const t = TRAILING_LABEL.exec(line);
      if (t && VS.test(t[1])) {
        body = t[1];
        label = t[2].trim();
      }
      const v = VS.exec(body);
      if (v) {
        const a = b.node(v[1], section);
        const c = b.node(v[2], section);
        if (a && c) {
          b.edge(a, c, label, 'conflict', true);
          prev = c;
          handled = true;
        }
      }
    }
    if (handled) continue;

    // 3) "Name: description" → node with note
    const kv = TRAILING_LABEL.exec(line);
    if (kv && kv[1].length <= 16 && !/[。、]/.test(kv[1])) {
      const n = b.node(kv[1], section);
      if (n) {
        n.note = kv[2].trim();
        if (preset === 'flow' && prev) b.edge(prev, n);
        prev = n;
      }
      continue;
    }

    // 4) natural sentences
    let any = false;
    for (const s of line.split(/[。！!]/).map((x) => x.trim()).filter(Boolean)) {
      const r = parseSentence(b, s, preset, section);
      if (r) {
        any = true;
        prev = r;
        continue;
      }
      // 5) plain item
      const n = b.node(s, section);
      if (n) {
        if (preset === 'flow' && prev) b.edge(prev, n);
        prev = n;
        any = true;
      }
    }
    if (!any) prev = null;
  }

  inferCategories(b, preset);
  return { nodes: b.nodes, edges: b.edges };
}

function inferCategories(b: Builder, preset: Preset) {
  const hasIn = new Set(b.edges.map((e) => e.target));
  const hasOut = new Set(b.edges.map((e) => e.source));
  const inConflict = new Set(b.edges.filter((e) => e.kind === 'conflict').flatMap((e) => [e.source, e.target]));

  for (const n of b.nodes) {
    if (n.explicit) continue;
    const l = n.label;
    if (preset === 'flow') {
      if (/[?？]$|判断|承認|可否|分岐|か$/.test(l)) n.category = '判断';
      else if (/完了|終了|リリース$|公開|ゴール|成功|done|end$/i.test(l) || (hasIn.has(l) && !hasOut.has(l)))
        n.category = '完了';
      else n.category = '工程';
    } else if (preset === 'causal') {
      if (inConflict.has(l)) n.category = '対立';
      else if (hasOut.has(l) && !hasIn.has(l)) n.category = '原因';
      else if (hasIn.has(l) && !hasOut.has(l)) n.category = '結果';
      else n.category = '要因';
    } else {
      n.category = inConflict.has(l) && !hasOut.has(l) && !hasIn.has(l) ? '対立' : '人物';
    }
  }
}
