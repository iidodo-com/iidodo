import type { Preset, RawGraph, Settings } from '../types';

const PRESET_HINT: Record<Preset, string> = {
  relation: '人物・組織の相関図。ノードは人物/組織、エッジは関係性（例: 主従, 義兄弟, 敵対）。',
  causal: '因果関係・対立の図。ノードは出来事/要因/結果、エッジは原因→結果または対立。',
  flow: '業務フロー/時系列。ノードは工程やイベント、エッジは順序・遷移。分岐は label に条件を書く。',
};

const SYSTEM = `あなたはテキストから図解用の構造化データを抽出するエンジンです。
出力は次のJSONのみ（説明文・コードフェンス禁止）:
{"nodes":[{"id":"n1","label":"短い名称(最大20字)","category":"カテゴリ","note":"補足(任意)"}],
 "edges":[{"source":"n1","target":"n2","label":"関係名(最大12字)","kind":"normal|conflict","bidirectional":false}]}
ルール:
- label は簡潔に。同一対象は1ノードに統合する。
- category は「人物」「組織」「工程」「判断」「完了」「原因」「結果」「リスク」「概念」などから選ぶ。
- 敵対・対立は kind を "conflict"、bidirectional を true にする。
- ノードは最大40個。edges の source/target は nodes の id を参照する。`;

export async function extractWithLLM(text: string, preset: Preset, s: Settings): Promise<RawGraph> {
  const user = `図解タイプ: ${PRESET_HINT[preset]}\n\n--- テキスト ---\n${text}`;
  let content: string;

  if (s.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({
        model: s.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    content = (await res.json()).choices?.[0]?.message?.content ?? '';
  } else if (s.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: s.model,
        max_tokens: 4096,
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    content = (json.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
  } else {
    throw new Error('provider not configured');
  }
  return parseLLMJson(content);
}

/** Exported for tests. Accepts LLM output (possibly fenced) and normalizes to RawGraph. */
export function parseLLMJson(content: string): RawGraph {
  const a = content.indexOf('{');
  const b = content.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('JSONが見つかりません');
  const data = JSON.parse(content.slice(a, b + 1));
  return normalizeGraphJson(data);
}

export function normalizeGraphJson(data: unknown): RawGraph {
  const d = data as { nodes?: unknown; edges?: unknown };
  if (!d || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) throw new Error('nodes / edges 配列が必要です');
  const idToLabel = new Map<string, string>();
  const nodes: RawGraph['nodes'] = [];
  const seen = new Set<string>();
  for (const n of d.nodes as Record<string, unknown>[]) {
    const label = String(n.label ?? n.id ?? '').trim();
    if (!label || seen.has(label)) {
      if (label && n.id != null) idToLabel.set(String(n.id), label);
      continue;
    }
    seen.add(label);
    if (n.id != null) idToLabel.set(String(n.id), label);
    nodes.push({
      label,
      category: n.category ? String(n.category) : undefined,
      explicit: !!n.category,
      note: n.note ? String(n.note) : undefined,
    });
  }
  const edges: RawGraph['edges'] = [];
  for (const e of d.edges as Record<string, unknown>[]) {
    const s = idToLabel.get(String(e.source)) ?? String(e.source);
    const t = idToLabel.get(String(e.target)) ?? String(e.target);
    if (!seen.has(s) || !seen.has(t)) continue;
    edges.push({
      source: s,
      target: t,
      label: e.label ? String(e.label) : '',
      kind: e.kind === 'conflict' ? 'conflict' : 'normal',
      bidirectional: !!e.bidirectional,
    });
  }
  return { nodes, edges };
}
