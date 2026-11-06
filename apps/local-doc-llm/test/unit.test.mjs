import assert from 'node:assert/strict';
import net from 'node:net';
import { test, summary } from './harness.mjs';
import { startMock } from './mock-server.mjs';
import * as C from '../lib/core.js';

const settingsFor = (url, over = {}) => ({ baseUrl: url + '/v1', model: 'qwen2.5-7b-instruct', contextTokens: 4096, maxOutputTokens: 512, temperature: 0.2, timeoutSec: 20, ...over });
const jp = (n) => Array.from({ length: n }, (_, i) => `これは${i}番目の文章です。会議で予算について議論しました。`).join('');

console.log('== URL・エンドポイント ==');
await test('Ollama形式 http://localhost:11434 に /v1 を補う', () => assert.equal(C.normalizeBaseUrl('http://localhost:11434').url, 'http://localhost:11434/v1'));
await test('Foundry形式 /v1 付きはそのまま、末尾/chat/completionsは除去', () => {
  assert.equal(C.normalizeBaseUrl('http://localhost:5272/v1/').url, 'http://localhost:5272/v1');
  assert.equal(C.normalizeBaseUrl('127.0.0.1:5272/v1/chat/completions').url, 'http://127.0.0.1:5272/v1');
});
await test('外部ホストは拒否（外部送信防止）', () => {
  for (const u of ['https://api.openai.com/v1', 'http://192.168.1.5:11434', 'http://example.com', 'http://localhost.evil.com']) {
    assert.ok(C.normalizeBaseUrl(u).error, u);
  }
  assert.ok(C.normalizeBaseUrl('http://[::1]:11434').url);
});
await test('callChatは外部URLに対してfetchを一切呼ばない', async () => {
  let called = 0;
  await assert.rejects(() => C.callChat({ baseUrl: 'https://api.example.com/v1', model: 'm', messages: [], maxTokens: 1, fetchImpl: () => { called++; } }), (e) => e.kind === 'blocked');
  assert.equal(called, 0);
});

console.log('== トークン見積り・チャンク分割 ==');
await test('splitText: 全チャンクが上限以下・内容欠落なし', () => {
  const text = (jp(300) + '\n\n').repeat(3) + 'a'.repeat(5000) + '\n' + 'ＡＢＣ'.repeat(800);
  const chunks = C.splitText(text, 700);
  assert.ok(chunks.length > 5);
  for (const c of chunks) assert.ok(C.estimateTokens(c) <= 700, `chunk ${C.estimateTokens(c)}`);
  const strip = (s) => s.replace(/\s+/g, '');
  assert.equal(strip(chunks.join('')), strip(text));
});
await test('splitText: 句読点なし超長文・サロゲートペアも安全に分割', () => {
  const text = '𠮷'.repeat(3000);
  const chunks = C.splitText(text, 500);
  for (const c of chunks) assert.ok(C.estimateTokens(c) <= 500);
  assert.equal(chunks.join(''), text);
});
await test('短文は1チャンク／空は0チャンク', () => { assert.equal(C.splitText('短い文', 500).length, 1); assert.equal(C.splitText('  \n ', 500).length, 0); });
await test('chunkBudget: 上限が小さすぎるとエラー', () => {
  assert.throws(() => C.chunkBudget({ contextTokens: 1024, maxOutputTokens: 900 }, C.TASKS.summary_short.final), /余裕がありません/);
});
await test('planJobs: 全リクエストが ctx−出力上限 に収まる（推定値）', () => {
  const s = settingsFor('http://x', { contextTokens: 2048, maxOutputTokens: 512 });
  const jobs = C.planJobs({ taskId: 'summary_short', docs: [{ name: 'a.txt', text: jp(1500) }], settings: s });
  assert.equal(jobs[0].mode, 'mapreduce');
  assert.ok(jobs[0].requests.length >= 5);
  for (const r of jobs[0].requests) assert.ok(C.estimateTokens(r.messages.map((m) => m.content).join('')) <= s.contextTokens - s.maxOutputTokens);
});

console.log('== 個人情報検出・マスキング ==');
const sample = '連絡先: taro.yamada@example.co.jp、電話 03-1234-5678 / 090-1234-5678 / 09012345678。〒100-0001 東京。' +
  'マイナンバー 123456789012、カード 4111 1111 1111 1111、全角 ０９０－１２３４－５６７８。日付 2026-11-06 と 通常の数字 12345 は対象外。';
await test('検出: メール/電話/郵便/長い数字列、日付と短い数字は除外', () => {
  const f = C.findPII(sample);
  const by = (t) => f.filter((x) => x.type === t).map((x) => x.value);
  assert.deepEqual(by('email'), ['taro.yamada@example.co.jp']);
  assert.equal(by('phone').length, 4);
  assert.equal(by('zip').length, 1);
  assert.deepEqual(by('number'), ['123456789012', '4111 1111 1111 1111']);
  assert.ok(!f.some((x) => x.value.includes('2026-11-06') || x.value === '12345'));
});
await test('マスク: 個人情報が残らず、同一値は同一プレースホルダ、復元で元に戻る', () => {
  const st = C.createMaskState();
  const m = C.maskText(sample + sample, st);
  for (const v of ['taro.yamada', '03-1234-5678', '123456789012', '4111', '100-0001']) assert.ok(!m.includes(v), v);
  assert.ok(m.includes('[EMAIL_1]') && !m.includes('[EMAIL_2]'));
  assert.equal(C.unmaskText(m, st), sample + sample);
});
await test('マスク: PII無しの文はそのまま', () => assert.equal(C.maskText('ただの文章です。', C.createMaskState()), 'ただの文章です。'));
await test('テキスト復号: UTF-8とShift_JIS', () => {
  assert.equal(C.decodeText(new TextEncoder().encode('こんにちは')).text, 'こんにちは');
  const sjis = new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]); // こんにちは
  const r = C.decodeText(sjis); assert.equal(r.text, 'こんにちは'); assert.equal(r.encoding, 'Shift_JIS');
});

console.log('== モックサーバー: リクエスト形式・処理フロー ==');
const mock = await startMock({ ctxLimit: 4096 });
await test('リクエスト形式: POST /v1/chat/completions, model/messages/stream:false/max_tokens, Authorizationなし', async () => {
  const s = settingsFor(mock.url);
  const r = await C.callChat({ baseUrl: s.baseUrl, model: s.model, messages: C.buildMessages('要約して', '本文です'), maxTokens: 256 });
  assert.match(r.text, /^\[MOCK\]/);
  const rec = mock.log.at(-1);
  assert.equal(rec.method, 'POST'); assert.equal(rec.url, '/v1/chat/completions');
  assert.equal(rec.body.model, 'qwen2.5-7b-instruct'); assert.equal(rec.body.stream, false); assert.equal(rec.body.max_tokens, 256);
  assert.deepEqual(rec.body.messages.map((m) => m.role), ['system', 'user']);
  assert.match(rec.body.messages[1].content, /<document>\n本文です\n<\/document>/);
  assert.equal(rec.headers.authorization, undefined);
  assert.match(rec.headers['content-type'], /application\/json/);
});
await test('接続テスト: /models で成功しモデル一覧を返す', async () => {
  const r = await C.testConnection({ baseUrl: mock.url, model: 'qwen2.5-7b-instruct' });
  assert.ok(r.ok); assert.deepEqual(r.models, ['qwen2.5-7b-instruct']);
});
await test('接続テスト: モデル名違いは 404 → 利用可能モデルを提示', async () => {
  const r = await C.testConnection({ baseUrl: mock.url, model: 'no-such-model' });
  assert.ok(!r.ok); assert.match(r.message, /利用可能なモデル: qwen2.5-7b-instruct/);
});
await test('長文要約: チャンク分割→各リクエストがモックのctx内→統合1回で完了', async () => {
  mock.log.length = 0;
  const s = settingsFor(mock.url, { contextTokens: 4096, maxOutputTokens: 512 });
  const [job] = C.planJobs({ taskId: 'summary_short', docs: [{ name: 'long.txt', text: jp(2500) }], settings: s });
  assert.ok(job.requests.length >= 4, `chunks=${job.requests.length}`);
  const r = await C.runJob({ taskId: 'summary_short', job, settings: s });
  const posts = mock.log.filter((x) => x.method === 'POST');
  assert.ok(posts.length >= job.requests.length + 1);
  assert.ok(posts.every((p) => p.promptTokens + 512 <= 4096)); // モックのctx超過(400)が1件も起きていない
  assert.match(posts.at(-1).body.messages[1].content, /【部分 1】/); // 最後は統合リクエスト
  assert.match(r.text, /^\[MOCK\]/);
});
await test('統合が収まらない場合は階層的に中間統合してから最終統合', async () => {
  mock.log.length = 0;
  const s = settingsFor(mock.url, { contextTokens: 1400, maxOutputTokens: 600 });
  const big = await startMock({ ctxLimit: 1400 });
  const s2 = { ...s, baseUrl: big.url + '/v1' };
  const [job] = C.planJobs({ taskId: 'keypoints', docs: [{ name: 'x.txt', text: jp(2500) }], settings: s2 });
  const r = await C.runJob({ taskId: 'keypoints', job, settings: s2 });
  const posts = big.log.filter((x) => x.method === 'POST');
  assert.ok(posts.every((p) => p.promptTokens + 600 <= 1400));
  assert.ok(posts.length > job.requests.length + 1, `posts=${posts.length} map=${job.requests.length}`);
  assert.ok(r.text.length > 0);
  await big.close();
});
await test('Q&A: 複数文書→ファイル名見出し付きで送信、質問が全リクエストに含まれる', async () => {
  mock.log.length = 0;
  const s = settingsFor(mock.url);
  const jobs = C.planJobs({ taskId: 'qa', question: '予算はいくら？', docs: [{ name: 'a.txt', text: 'Aの内容。予算は100万円。' }, { name: 'b.md', text: 'Bの内容。' }], settings: s });
  assert.equal(jobs.length, 1);
  await C.runJob({ taskId: 'qa', job: jobs[0], settings: s });
  const body = mock.log.filter((x) => x.method === 'POST')[0].body.messages[1].content;
  assert.match(body, /質問: 予算はいくら？/); assert.match(body, /【ファイル: a\.txt】/); assert.match(body, /【ファイル: b\.md】/);
});
await test('整文: チャンクごとに送り、連結して返す（統合呼び出しなし）', async () => {
  mock.log.length = 0;
  const s = settingsFor(mock.url, { contextTokens: 2048, maxOutputTokens: 512 });
  const [job] = C.planJobs({ taskId: 'proofread', docs: [{ name: 'p.txt', text: jp(900) }], settings: s });
  assert.equal(job.mode, 'sequential');
  await C.runJob({ taskId: 'proofread', job, settings: s });
  assert.equal(mock.log.filter((x) => x.method === 'POST').length, job.requests.length);
});
await test('マスク有効時: モックが受信した全リクエストに個人情報が含まれない', async () => {
  mock.log.length = 0;
  const s = settingsFor(mock.url);
  const st = C.createMaskState();
  const text = C.maskText('担当 yamada@example.com 電話 03-1234-5678。' + jp(20), st);
  const [job] = C.planJobs({ taskId: 'summary_short', docs: [{ name: 'm.txt', text }], settings: s });
  await C.runJob({ taskId: 'summary_short', job, settings: s });
  const raw = mock.log.map((x) => x.rawBody).join('\n');
  assert.ok(!raw.includes('yamada@example.com') && !raw.includes('03-1234-5678'));
  assert.ok(raw.includes('[EMAIL_1]') && raw.includes('[PHONE_1]'));
});

console.log('== エラー表示 ==');
await test('コンテキスト超過(400)は原因と対処つきのエラー', async () => {
  const s = settingsFor(mock.url, { contextTokens: 100000, maxOutputTokens: 512 }); // UI設定がモック実ctxより大きい
  const [job] = C.planJobs({ taskId: 'summary_short', docs: [{ name: 'a.txt', text: jp(2000) }], settings: s });
  await assert.rejects(() => C.runJob({ taskId: 'summary_short', job, settings: s }), (e) => e.kind === 'http' && e.status === 400 && /コンテキスト/.test(e.message));
});
await test('500エラー: HTTPステータスと対処を表示', async () => {
  mock.ctl.mode = 'http500';
  await assert.rejects(() => C.callChat({ baseUrl: mock.url, model: 'qwen2.5-7b-instruct', messages: C.buildMessages('x', 'y'), maxTokens: 8 }), (e) => e.kind === 'http' && e.status === 500 && /サーバー内部エラー/.test(e.message));
  mock.ctl.mode = 'ok';
});
await test('タイムアウト: 応答が遅い場合に原因つきエラー', async () => {
  mock.ctl.mode = 'slow';
  await assert.rejects(() => C.callChat({ baseUrl: mock.url, model: 'qwen2.5-7b-instruct', messages: C.buildMessages('x', 'y'), maxTokens: 8, timeoutMs: 300 }), (e) => e.kind === 'timeout' && /タイムアウト/.test(e.message));
  mock.ctl.mode = 'ok';
});
await test('中止(AbortSignal)で abort エラー', async () => {
  mock.ctl.mode = 'slow';
  const ac = new AbortController(); setTimeout(() => ac.abort(), 100);
  await assert.rejects(() => C.callChat({ baseUrl: mock.url, model: 'qwen2.5-7b-instruct', messages: C.buildMessages('x', 'y'), maxTokens: 8, signal: ac.signal }), (e) => e.kind === 'abort');
  mock.ctl.mode = 'ok';
});
await test('serve.mjs 静的配信: index.html/.mjs のMIME、test/とパストラバーサルは404', async () => {
  const { createServer } = await import('../serve.mjs');
  const srv = createServer(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const get = (p) => fetch(b + p);
  assert.equal((await get('/')).status, 200);
  assert.match((await get('/vendor/pdfjs/pdf.worker.min.mjs')).headers.get('content-type'), /javascript/);
  assert.equal((await get('/test/mock-server.mjs')).status, 404);
  assert.equal((await get('/..%2f..%2fetc%2fpasswd')).status, 404);
  await new Promise((r) => srv.close(r));
});
await mock.close();
await test('エンドポイント停止時: 接続テスト・実行ともに原因（起動/URL/CORS）を示すエラー', async () => {
  const r = await C.testConnection({ baseUrl: mock.url, model: 'qwen2.5-7b-instruct' });
  assert.ok(!r.ok); assert.match(r.message, /接続できませんでした/); assert.match(r.message, /起動していない/);
  await assert.rejects(() => C.callChat({ baseUrl: mock.url, model: 'm', messages: C.buildMessages('x', 'y'), maxTokens: 8 }), (e) => e.kind === 'network');
});
await test('未使用ポートへの接続は ECONNREFUSED を含むエラー', async () => {
  const srv = net.createServer().listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  const port = srv.address().port; await new Promise((r) => srv.close(r));
  const r = await C.testConnection({ baseUrl: `http://127.0.0.1:${port}`, model: 'm' });
  assert.ok(!r.ok); assert.match(r.message, /ECONNREFUSED/);
});
summary('unit');
