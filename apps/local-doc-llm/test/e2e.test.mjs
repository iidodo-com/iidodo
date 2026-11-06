// Playwright(Chromium)でUIを通しで検証。ページが発行する全リクエストがループバック宛であることも確認。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test, summary } from './harness.mjs';
import { startMock } from './mock-server.mjs';
import { createServer } from '../serve.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

function makePdf(lines) {
  const content = 'BT /F1 14 Tf 72 720 Td 18 TL ' + lines.map((l) => `(${l}) Tj T*`).join(' ') + ' ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ldl-'));
const txt = path.join(tmp, 'memo.txt');
const md = path.join(tmp, 'notes.md');
const pdf = path.join(tmp, 'report.pdf');
fs.writeFileSync(txt, '会議メモ。担当は山田（yamada@example.com、電話 03-1234-5678）。予算は100万円で決定。\n\n' + Array.from({ length: 40 }, (_, i) => `議題${i}について議論した。`).join(''));
fs.writeFileSync(md, '# ノート\n\n- 来週までに見積書を送る\n');
fs.writeFileSync(pdf, makePdf(['Quarterly Report PDF Sample', 'Contact: sato@example.org', 'Revenue grew by ten percent.']));

const mock = await startMock({ ctxLimit: 4096 });
const app = createServer();
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${app.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appUrl.slice(0, -1) }).catch(() => {});
const page = await ctx.newPage();
const reqs = [];
page.on('request', (r) => reqs.push(r.url()));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const setBase = async (url) => { await page.fill('#baseUrl', url); };
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });

await page.goto(appUrl);

await test('UI: APIキー入力欄が存在しない／初期値（モデル名・Ollama URL）', async () => {
  assert.equal(await page.locator('input[type=password], [name*=key i], [id*=key i], [placeholder*="API" i]').count(), 0);
  assert.equal(await page.inputValue('#model'), 'qwen2.5-7b-instruct');
  assert.equal(await page.inputValue('#baseUrl'), 'http://localhost:11434');
  assert.match(await page.textContent('#effectiveUrl'), /http:\/\/localhost:11434\/v1/);
});

await test('接続テスト成功: モデル確認表示とモデル候補チップ', async () => {
  await setBase(mock.url + '/v1');
  await page.click('#btnTest');
  await page.waitForFunction(() => document.querySelector('#testResult').textContent.includes('接続OK'));
  assert.match(await page.textContent('#testResult'), /GET .*\/v1\/models → OK/);
  assert.equal(await page.locator('#modelChips button').count(), 1);
});

await test('接続テスト: 外部URLは拒否され、ネットワークリクエストも発生しない', async () => {
  const before = reqs.length;
  await setBase('https://api.openai.com/v1');
  await page.click('#btnTest');
  await page.waitForFunction(() => document.querySelector('#testResult').textContent.includes('✖'));
  assert.match(await page.textContent('#testResult'), /このPC内.*ではありません|外部/);
  assert.ok(!reqs.slice(before).some((u) => u.includes('openai.com')));
  await setBase(mock.url + '/v1');
});

await test('ファイル投入: txt/md/pdf（PDFはブラウザ内で抽出）、非対応形式はエラー', async () => {
  const bad = path.join(tmp, 'x.docx'); fs.writeFileSync(bad, 'x');
  await page.setInputFiles('#fileInput', [txt, md, pdf, bad]);
  await page.waitForFunction(() => document.querySelectorAll('#fileList li').length === 3, null, { timeout: 15000 });
  const list = await page.textContent('#fileList');
  assert.match(list, /memo\.txt/); assert.match(list, /notes\.md/); assert.match(list, /report\.pdf.*PDF 1ページ/s);
  assert.match(await page.textContent('#fileMsg'), /x\.docx.*非対応/);
  const pdfText = await page.evaluate(() => window.__app.state.docs.find((d) => d.name === 'report.pdf').text);
  assert.match(pdfText, /Quarterly Report PDF Sample/); assert.match(pdfText, /sato@example\.org/);
});

await test('プレビュー: PII警告（メール/電話）を表示、マスク有効で送信内容が置換済み', async () => {
  await page.selectOption('#task', 'summary_short');
  await page.check('#mask');
  await page.click('#btnPreview');
  await page.waitForSelector('#piiBox:not([hidden])');
  const pii = await page.textContent('#piiBox');
  assert.match(pii, /メールアドレス 2件/); assert.match(pii, /電話番号 1件/);
  const preview = await page.evaluate(() => [...document.querySelectorAll('#previewList pre')].map((p) => p.textContent).join('\n'));
  assert.ok(!preview.includes('yamada@example.com') && !preview.includes('sato@example.org') && !preview.includes('03-1234-5678'));
  assert.match(preview, /\[EMAIL_1\]/); assert.match(preview, /\[PHONE_1\]/);
  assert.equal(await page.isEnabled('#btnRun'), true);
});

await test('設定変更でプレビューが無効化され、実行ボタンが無効に戻る', async () => {
  await page.fill('#ctx', '8192'); await page.fill('#ctx', '4096');
  assert.equal(await page.isEnabled('#btnRun'), false);
  await page.click('#btnPreview');
});

await test('実行（マスクON）: 全ファイル要約、モック受信内容にPIIなし、結果表示・コピー・.mdダウンロード', async () => {
  mock.log.length = 0;
  await page.click('#btnRun');
  await page.waitForFunction(() => document.querySelector('#runMsg').textContent.includes('完了'), null, { timeout: 30000 });
  const result = await page.textContent('#result');
  assert.match(result, /## memo\.txt/); assert.match(result, /## notes\.md/); assert.match(result, /## report\.pdf/); assert.match(result, /\[MOCK\]/);
  const raw = mock.log.filter((x) => x.method === 'POST').map((x) => x.rawBody).join('\n');
  assert.ok(raw.length > 0);
  assert.ok(!/yamada@example\.com|sato@example\.org|03-1234-5678/.test(raw));
  assert.ok(raw.includes('Quarterly Report PDF Sample')); // PDF抽出テキストが送られている
  assert.equal(dialogs.length, 0); // マスクONなので確認ダイアログなし
  // コピー
  await page.click('#btnCopy');
  await page.waitForFunction(() => document.querySelector('#copyMsg').textContent.includes('コピー'));
  const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) assert.equal(clip, result);
  // ダウンロード
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnDownload')]);
  assert.match(dl.suggestedFilename(), /^result-summary_short-.*\.md$/);
  const body = fs.readFileSync(await dl.path(), 'utf8');
  assert.match(body, /^# 要約（短め）/); assert.match(body, /個人情報マスキング: あり/);
});

await test('Q&Aの質問文もマスクされて送信され、「元に戻して表示」トグルで手元の結果だけ復元される', async () => {
  mock.log.length = 0;
  await page.selectOption('#task', 'qa');
  await page.fill('#question', '連絡先を教えて（担当: yamada@example.com）');
  await page.click('#btnPreview');
  await page.waitForSelector('#previewList details');
  await page.click('#btnRun');
  await page.waitForFunction(() => document.querySelector('#runMsg').textContent.includes('完了'), null, { timeout: 30000 });
  const raw = mock.log.filter((x) => x.method === 'POST').map((x) => x.rawBody).join('\n');
  assert.match(raw, /質問: 連絡先を教えて（担当: \[EMAIL_1\]）/);
  assert.ok(!raw.includes('yamada@example.com'));
  // モックは文書の先頭を返すだけなので、結果にプレースホルダが出る入力で復元表示のみ確認
  await page.evaluate(() => { const a = window.__app.state; a.results = { taskId: 'qa', results: [{ title: 't', text: '担当 [EMAIL_1] 電話 [PHONE_1]', warnings: [] }] }; });
  await page.uncheck('#unmask'); await page.check('#unmask');
  assert.equal(await page.textContent('#result'), '担当 yamada@example.com 電話 03-1234-5678');
  await page.uncheck('#unmask');
  assert.equal(await page.textContent('#result'), '担当 [EMAIL_1] 電話 [PHONE_1]');
});

await test('マスクOFF: 確認ダイアログが出て、承認すると生の値が送信される', async () => {
  mock.log.length = 0; dialogs.length = 0;
  await page.selectOption('#task', 'keypoints');
  await page.uncheck('#mask');
  await page.click('#btnPreview');
  await page.waitForSelector('#piiBox:not([hidden])');
  assert.match(await page.textContent('#piiBox'), /マスキング無効/);
  await page.click('#btnRun');
  await page.waitForFunction(() => document.querySelector('#runMsg').textContent.includes('完了'), null, { timeout: 30000 });
  assert.equal(dialogs.length, 1); assert.match(dialogs[0], /マスキングなし/);
  const raw = mock.log.filter((x) => x.method === 'POST').map((x) => x.rawBody).join('\n');
  assert.match(raw, /yamada@example\.com/);
});

await test('長文チャンク分割: ctx小さめ設定で複数リクエストになり進捗が出る／モックのctx内', async () => {
  mock.log.length = 0;
  const longTxt = path.join(tmp, 'long.txt');
  fs.writeFileSync(longTxt, Array.from({ length: 1800 }, (_, i) => `第${i}段落。本件の進捗について報告する。`).join('\n\n'));
  await page.evaluate(() => { window.__app.state.docs.length = 0; });
  await page.setInputFiles('#fileInput', [longTxt]);
  await page.waitForFunction(() => document.querySelectorAll('#fileList li').length === 1);
  await page.check('#mask'); await page.selectOption('#task', 'summary_long');
  await page.click('#btnPreview');
  await page.waitForSelector('#previewList details');
  const n = await page.locator('#previewList details').count();
  assert.ok(n >= 4, `chunks=${n}`);
  assert.match(await page.textContent('#previewSummary'), /統合ステップ/);
  await page.click('#btnRun');
  await page.waitForFunction(() => document.querySelector('#runMsg').textContent.includes('完了'), null, { timeout: 60000 });
  const posts = mock.log.filter((x) => x.method === 'POST');
  assert.ok(posts.length >= n + 1);
  assert.ok(posts.every((p) => p.promptTokens + 1024 <= 4096));
});

await test('エンドポイント停止時: 実行・接続テストが原因つきエラーを表示', async () => {
  await mock.close();
  await page.click('#btnRun');
  await page.waitForFunction(() => document.querySelector('#runMsg').textContent.includes('実行に失敗'), null, { timeout: 30000 });
  const run = await page.textContent('#runMsg');
  assert.match(run, /接続できませんでした/); assert.match(run, /起動していない/);
  await page.click('#btnTest');
  await page.waitForFunction(() => document.querySelector('#testResult').textContent.includes('✖'));
  assert.match(await page.textContent('#testResult'), /接続できませんでした/);
  assert.equal(await page.getAttribute('#testResult', 'class'), 'status err');
});

await test('外部通信ゼロ: ページが発行した全リクエストが127.0.0.1/localhost宛（CDNなし）', async () => {
  const hosts = new Set(reqs.map((u) => new URL(u).hostname).filter(Boolean));
  const bad = [...hosts].filter((h) => !['127.0.0.1', 'localhost'].includes(h));
  assert.deepEqual(bad, [], `非ローカル宛: ${bad}`);
  assert.ok(reqs.some((u) => u.includes('/vendor/pdfjs/pdf.worker.min.mjs'))); // 同梱pdf.jsのworkerを使用
});

await test('コンソールエラー／ページ例外なし（停止テスト時の接続エラーは除く）', async () => {
  const real = errors.filter((e) => !/Failed to load resource|net::ERR|Content Security Policy.*api\.openai/i.test(e));
  assert.deepEqual(real, [], JSON.stringify(real));
});

await browser.close(); app.close();
summary('e2e');
