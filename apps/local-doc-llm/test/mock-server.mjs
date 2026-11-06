// OpenAI互換のモックサーバー（自己テスト用／UI動作確認用）。
// 単体起動: node test/mock-server.mjs [--port 8799] [--ctx 4096]
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CJK = /[　-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/g;
// モック側のトークン数（コア側より甘い数え方＝コアの見積りが保守的であることを検証できる）
export function mockTokens(s) { const c = (s.match(CJK) || []).length; return Math.ceil(c + (s.length - c) * 0.3); }

export function startMock({ port = 0, ctxLimit = 4096, models = ['qwen2.5-7b-instruct'] } = {}) {
  const log = [];
  const ctl = { mode: 'ok' }; // ok | http500 | slow
  const server = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const rec = { method: req.method, url: req.url, headers: req.headers, body: body ? safeJson(body) : null, rawBody: body };
      log.push(rec);
      const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
      if (ctl.mode === 'http500') return json(500, { error: { message: 'mock internal error' } });
      if (req.method === 'GET' && req.url === '/v1/models') return json(200, { object: 'list', data: models.map((id) => ({ id, object: 'model' })) });
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        const b = rec.body;
        if (!b || !Array.isArray(b.messages)) return json(400, { error: { message: 'messages required' } });
        if (!models.includes(b.model)) return json(404, { error: { message: `model '${b.model}' not found` } });
        const promptT = b.messages.reduce((a, m) => a + mockTokens(m.content) + 6, 0);
        rec.promptTokens = promptT;
        if (promptT + (b.max_tokens || 0) > ctxLimit) {
          return json(400, { error: { message: `This model's maximum context length is ${ctxLimit} tokens. However, you requested ${promptT + (b.max_tokens || 0)} tokens.`, code: 'context_length_exceeded' } });
        }
        const user = b.messages.filter((m) => m.role === 'user').pop().content;
        const doc = (user.match(/<document>\n([\s\S]*?)\n<\/document>/) || [, ''])[1];
        const respond = () => json(200, {
          id: 'mock-1', object: 'chat.completion', model: b.model,
          choices: [{ index: 0, message: { role: 'assistant', content: `[MOCK] doc=${doc.length}字 head="${doc.slice(0, 24).replace(/\n/g, ' ')}"` }, finish_reason: 'stop' }],
          usage: { prompt_tokens: promptT, completion_tokens: 20, total_tokens: promptT + 20 },
        });
        if (ctl.mode === 'slow') return setTimeout(respond, 3000);
        return respond();
      }
      json(404, { error: { message: `not found: ${req.method} ${req.url}` } });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    server, log, ctl, port: server.address().port, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  })));
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const o = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
  const m = await startMock({ port: Number(o('--port', 8799)), ctxLimit: Number(o('--ctx', 4096)) });
  console.log(`モックLLM: ${m.url}/v1  （モデル: qwen2.5-7b-instruct, ctx=${o('--ctx', 4096)}）`);
}
