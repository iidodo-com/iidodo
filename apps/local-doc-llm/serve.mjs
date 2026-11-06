// ローカル静的サーバー（依存なし）。127.0.0.1 のみで待ち受け。
// 使い方: node serve.mjs [--port 8787] [--target http://localhost:5272]
//   --target を付けると /llm/* を指定のローカルLLMへ中継します（CORS回避用）。
//   その場合、アプリのベースURLに http://127.0.0.1:8787/llm/v1 を指定してください。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLoopbackHost } from './lib/core.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const port = Number(opt('--port', process.env.PORT || 8787));
const targetArg = opt('--target', '');

let target = null;
if (targetArg) {
  try { target = new URL(targetArg); } catch { console.error(`--target の形式が不正です: ${targetArg}`); process.exit(2); }
  if (!isLoopbackHost(target.hostname)) { console.error('--target はローカル（localhost/127.x/::1）のみ指定できます。'); process.exit(2); }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.bcmap': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

export function createServer() {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (target && u.pathname.startsWith('/llm/')) {
      const headers = { ...req.headers, host: target.host };
      delete headers.origin; delete headers.referer;
      const up = http.request({
        hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || 80,
        path: u.pathname.slice(4) + u.search, method: req.method, headers,
      }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', (e) => { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`ローカルLLMに中継できません: ${e.code || e.message}`); });
      req.pipe(up);
      return;
    }
    let rel = decodeURIComponent(u.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    const skip = ['test', 'node_modules'].some((d) => file.startsWith(path.join(root, d) + path.sep));
    if (!file.startsWith(root + path.sep) || skip || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer().listen(port, '127.0.0.1', () => {
    console.log(`手元資料LLM処理: http://127.0.0.1:${port}/`);
    if (target) console.log(`中継: /llm/* → ${target.origin}  （ベースURL例: http://127.0.0.1:${port}/llm/v1）`);
    console.log('終了は Ctrl+C');
  });
}
