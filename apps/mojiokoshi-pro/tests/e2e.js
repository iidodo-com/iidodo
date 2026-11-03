/* E2E 自己テスト（Playwright / Chromium ヘッドレス）
 *
 *   NODE_PATH=$(npm root -g) node tests/e2e.js          # グローバルの playwright を使う場合
 *   （プロジェクトに playwright を入れている場合は `node tests/e2e.js`）
 *
 * - 静的サーバーを内蔵（Python等は不要）。テスト用の音声はこのファイルが生成する。
 * - Gemini API は Playwright の route でモックする（実際のGoogleへは通信しない）。
 * - 終了コード: 全件合格=0 / 失敗あり=1
 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mjp-e2e-'));

/* ---------- fixtures ---------- */
function wav(file, { secs, amp, sr = 16000 }) {
  const n = sr * secs, buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(amp * 32767 * Math.sin(2 * Math.PI * 220 * i / sr) * (0.6 + 0.4 * Math.sin(i / 1500)) + (amp ? 3 : 0)), 44 + i * 2);
  fs.writeFileSync(file, buf); return file;
}
const F = {
  loud: wav(path.join(TMP, 'loud.wav'), { secs: 3, amp: 0.5 }),
  quiet: wav(path.join(TMP, 'quiet.wav'), { secs: 3, amp: 0.003 }),
  silent: wav(path.join(TMP, 'silent.wav'), { secs: 3, amp: 0 }),
  big: wav(path.join(TMP, 'big.wav'), { secs: 480, amp: 0.3 }), // 約15MB（inline上限超）
  huge: path.join(TMP, 'huge.wav'), mid: path.join(TMP, 'mid.wav'),
};
fs.closeSync(fs.openSync(F.huge, 'w')); fs.truncateSync(F.huge, 201 * 1024 * 1024); // 200MB超（スパース）
fs.closeSync(fs.openSync(F.mid, 'w')); fs.truncateSync(F.mid, 35 * 1024 * 1024);    // マスキング上限(30MB)超

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});

/* ---------- harness ---------- */
let pass = 0, fail = 0; const failed = [];
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; failed.push(m); console.log('FAIL ' + m); } };
const eqIn = async (loc, text, m) => ok((await loc.innerText()).includes(text), m);
let BASE, browser;
const KEY = 'AIzaTESTKEY1234567890';

async function fresh(opts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], ...(opts.ctx || {}) });
  const p = await ctx.newPage();
  p.errs = []; p.csp = []; p.reqs = [];
  await p.addInitScript(() => {
    window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    if (window.__noStorage) { Storage.prototype.setItem = () => { throw new DOMException('x', 'SecurityError'); }; }
  });
  if (opts.noStorage) await p.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('x', 'SecurityError'); }; });
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('request', (r) => p.reqs.push({ url: r.url(), headers: r.headers(), method: r.method() }));
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE);
  return p;
}
const setKey = async (p, key = KEY, model = 'gemini-3.8-flash') => {
  await p.goto(BASE + '#/settings'); await p.fill('#set-key', key); await p.selectOption('#set-model', model); await p.click('#set-save');
};
const waitRunnable = (p) => p.waitForFunction(() => !document.querySelector('#btn-run').disabled && !document.querySelector('#run-card').hidden);
const pickFile = async (p, f) => { await p.goto(BASE + '#/app'); await p.setInputFiles('#file', f); await p.waitForFunction(() => !document.querySelector('#run-card').hidden || !document.querySelector('#file-error').hidden); };
const errText = (p) => p.locator('#run-error').innerText();

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-goog-upload-url', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const GOOD = { transcript: [{ speaker: 'A', start: '00:01', text: 'こんにちは', uncertain: false }, { speaker: 'B', start: '00:05', text: '山田太郎です', uncertain: false }],
  polished: [{ speaker: 'A', text: 'こんにちは。' }, { speaker: 'B', text: '山田太郎です。' }], summary: ['山田太郎が挨拶'], decisions: ['決定A'], todos: [{ task: 'タスク1', owner: '山田太郎', due: '不明' }], audio_notes: '' };
const cand = (obj, extra = {}) => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP', ...extra }] });

/** Gemini API モック。st.gen(req) -> {status, body} | 'abort' | 'hang' */
async function mockApi(p, st = {}) {
  st.calls = []; st.polls = 0; st.deleted = false; st.mode = st.mode || 'ok';
  await p.route('**/generativelanguage.googleapis.com/**', async (r) => {
    const q = r.request(), u = q.url(), m = q.method();
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const json = (status, body, h = {}) => r.fulfill({ status, headers: { ...CORS, ...h }, contentType: 'application/json', body: JSON.stringify(body) });
    if (/\/v1beta\/models\/[^:]+$/.test(u) && m === 'GET') { st.testReq = { url: u, key: q.headers()['x-goog-api-key'] }; return st.models ? st.models(json) : json(200, { name: 'models/x', displayName: 'Gemini X', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent'] }); }
    if (u.includes('/upload/v1beta/files/sess') && m === 'POST') return st.mode === 'upfail' ? json(403, { error: { message: 'upload denied' } }) : json(200, { file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'audio/wav', state: 'PROCESSING' } });
    if (u.includes('/upload/v1beta/files') && m === 'POST') { st.started = { h: q.headers(), body: q.postData() }; return r.fulfill({ status: 200, headers: { ...CORS, 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files/sess1' }, body: '{}' }); }
    if (u.endsWith('/v1beta/files/abc') && m === 'GET') { st.polls++; return json(200, { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', mimeType: 'audio/wav', state: st.mode === 'failed' ? 'FAILED' : 'ACTIVE', error: st.mode === 'failed' ? { message: 'bad audio' } : undefined }); }
    if (u.endsWith('/v1beta/files/abc') && m === 'DELETE') { st.deleted = true; return json(200, {}); }
    if (u.includes(':generateContent')) {
      const body = JSON.parse(q.postData()); st.calls.push(body);
      const out = st.gen ? st.gen(st.calls.length, body) : { status: 200, body: cand(GOOD) };
      if (out === 'abort') return r.abort('failed');
      if (out === 'hang') return; // 応答しない（タイムアウト/キャンセル検証）
      return json(out.status, out.body);
    }
    return r.continue();
  });
  return st;
}
const parseWav = (b64) => { const b = Buffer.from(b64, 'base64'); const u8 = Uint8Array.from(b.subarray(44)); return { riff: b.toString('ascii', 0, 4), sr: b.readUInt32LE(24), ch: b.readUInt16LE(22), s: new Int16Array(u8.buffer), bytes: b.length }; };

/* ===================================================== */
(async () => {
  await new Promise((r) => server.listen(0, r)); BASE = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
  let p, st;

  /* ---------- A. デモモード基本フロー・音量チェック ---------- */
  console.log('\n## A. デモモード基本フロー');
  p = await fresh();
  ok(await p.locator('#mode-banner').isVisible(), 'デモバナー表示');
  ok(await p.locator('#welcome').isVisible(), '初回案内カード表示');
  await p.click('#welcome-close'); await p.reload(); ok(!(await p.locator('#welcome').isVisible()), '案内を閉じると次回以降は非表示');
  for (const [name, f, want] of [['小さい音量', F.quiet, '問題あり'], ['無音', F.silent, '問題あり'], ['正常', F.loud, '音量OK']]) {
    await pickFile(p, f); await p.waitForFunction(() => document.querySelector('#check-badge .badge'));
    await p.waitForTimeout(150); await eqIn(p.locator('#check-badge'), want, `音量チェック（${name}）→ ${want}`);
  }
  await pickFile(p, F.quiet); await p.waitForFunction(() => document.querySelector('#check-badge .badge'));
  ok(await p.locator('#btn-run').isDisabled() && await p.locator('#force-row').isVisible(), '音量「問題あり」は確認チェックなしで実行不可');
  await p.click('#btn-sample'); await p.click('#btn-run'); await p.waitForURL(/#\/result\//, { timeout: 15000 });
  ok(await p.locator('.segs li.unc').count() === 1, '聞き取れない発言をハイライト');
  ok((await p.locator('.seg-edit').nth(3).inputValue()).includes('聞き取れませんでした'), '「聞き取れませんでした」表示');
  for (const t of ['整文', '要約', '決定事項とToDo']) await p.click(`.tab:has-text("${t}")`);
  ok(await p.locator('#result-root .tbl').count() === 1, '決定事項/ToDo タブ');
  await p.click('.tab:has-text("文字起こし全文")');
  await p.fill('.spk input >> nth=0', '田中'); await p.press('.spk input >> nth=0', 'Tab');
  ok((await p.locator('.segs li >> nth=0 >> select option:checked').innerText()) === '田中', '話者名の変更');
  await p.selectOption('.segs li >> nth=1 >> select', 'C'); ok(await p.locator('.segs li >> nth=1 >> select').inputValue() === 'C', '発言ごとの話者付け替え');
  await p.click('button:has-text("全体をコピー")'); const clip = await p.evaluate(() => navigator.clipboard.readText());
  ok(['■ 文字起こし全文', '■ 整文', '■ 要約', '■ 決定事項とToDo'].every((k) => clip.includes(k)) && clip.includes('田中'), 'コピーに4部構成と話者名が含まれる');
  const [d1] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("TXTで")')]); const [d2] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Markdownで")')]);
  ok(fs.readFileSync(await d2.path(), 'utf8').includes('## 決定事項とToDo') && fs.readFileSync(await d1.path(), 'utf8').includes('■ 要約'), 'TXT/Markdown ダウンロード');
  await p.click('a[data-nav=history]'); await p.waitForSelector('.hist-item'); ok(await p.locator('.hist-item').count() === 1, '履歴に保存');
  await p.fill('#hist-q', '料金ページ'); ok(await p.locator('.hist-item').count() === 1, '履歴検索（ヒット）');
  await p.fill('#hist-q', '存在しない語zzz'); ok(await p.locator('.hist-item').count() === 0, '履歴検索（該当なし）');
  await p.fill('#hist-q', ''); await p.click('.hist-item a.btn'); await p.waitForSelector('.seg-edit'); ok((await p.locator('.segs li >> nth=0 >> select option:checked').innerText()) === '田中', '履歴から再表示（編集内容が保持）');
  for (const r of ['help', 'pricing', 'terms', 'privacy', 'settings']) { await p.goto(BASE + '#/' + r); ok(await p.locator('#view-' + r).isVisible(), `ページ表示: ${r}`); }
  await p.goto(BASE + '#/pricing'); await p.click('[data-plan=Pro]'); ok(await p.locator('.toast').count() > 0, '料金ページ（ダミー）');
  ok(p.errs.length === 0, 'JSエラーなし'); await p.context().close();

  /* ---------- B. 本文編集 ---------- */
  console.log('\n## B. 本文の直接編集');
  p = await fresh(); await p.click('#btn-sample'); await p.click('#btn-run'); await p.waitForURL(/#\/result\//, { timeout: 15000 });
  await p.locator('.seg-edit').nth(1).fill('編集後の発言ZZZ'); await p.selectOption('.segs li >> nth=1 >> select', 'C');
  ok((await p.locator('.seg-edit').nth(1).inputValue()) === '編集後の発言ZZZ' && await p.locator('.segs li >> nth=1 >> select').inputValue() === 'C', '編集と話者付け替えが競合しない');
  ok((await p.locator('.segs li >> nth=1').innerText()).includes('編集済'), '「編集済」表示');
  await p.locator('.seg-edit').nth(3).fill('実は「はい」'); ok(await p.locator('.segs li.unc').count() === 0 && !(await p.locator('#unc-warn').isVisible()), '編集で「要確認」解除と件数警告の更新');
  await p.locator('.seg-edit').nth(3).fill('【聞き取れませんでした】'); ok(await p.locator('.segs li.unc').count() === 1, 'マーカー復活で「要確認」に戻る');
  await p.click('.tab:has-text("整文")'); await p.locator('.seg-edit').nth(0).fill('整文を編集LLL');
  await p.click('.tab:has-text("要約")'); await p.locator('.edit-item').first().fill('編集した要約ABC'); await p.click('button:has-text("＋要約を追加")'); await p.keyboard.type('追加項目XYZ');
  await p.click('a[data-nav=history]'); await p.waitForSelector('#view-history:not([hidden])');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('mjp.history.v1'))[0]);
  ok(saved.transcript[1].text === '編集後の発言ZZZ' && saved.polished[0].text === '整文を編集LLL' && saved.summary[0] === '編集した要約ABC' && saved.summary.includes('追加項目XYZ'), '画面遷移の直前の編集も履歴に保存（デバウンスのフラッシュ）');
  await p.fill('#hist-q', '整文を編集LLL'); ok(await p.locator('.hist-item').count() === 1, '編集内容が履歴検索に反映'); await p.fill('#hist-q', '');
  await p.click('.hist-item a.btn'); await p.reload(); ok((await p.locator('.seg-edit').nth(1).inputValue()) === '編集後の発言ZZZ', 'リロード後も保持');
  await p.click('button:has-text("全体をコピー")'); const c2 = await p.evaluate(() => navigator.clipboard.readText());
  const [t1] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("TXTで")')]); const [m1] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Markdownで")')]);
  const txt = fs.readFileSync(await t1.path(), 'utf8'), md = fs.readFileSync(await m1.path(), 'utf8');
  ok([c2, txt, md].every((x) => x.includes('編集後の発言ZZZ') && x.includes('整文を編集LLL') && x.includes('編集した要約ABC')), '編集がコピー・TXT・Markdown出力に反映');
  await p.context().close();

  /* ---------- C. Files API ---------- */
  console.log('\n## C. Files API');
  p = await fresh(); await p.click('#btn-sample'); ok((await p.locator('#route-note').innerText()).includes('inline'), 'デモ: 小サイズ→inline案内');
  await p.click('#btn-sample-large'); const note = await p.locator('#route-note').innerText(); ok(note.includes('Files API') && note.includes('ACTIVE'), 'デモ: 大サイズ→Files API案内');
  await p.evaluate(() => { window.__t = []; new MutationObserver(() => window.__t.push(document.querySelector('#progress-text').textContent)).observe(document.querySelector('#progress-text'), { childList: true, characterData: true, subtree: true }); });
  await p.click('#btn-run'); await p.waitForURL(/#\/result\//, { timeout: 15000 }); const tt = await p.evaluate(() => window.__t.join('|'));
  ok(tt.includes('アップロード中') && tt.includes('PROCESSING') && tt.includes('ACTIVE'), 'デモ: Files API の進捗（アップロード→処理待ち→ACTIVE）');
  await eqIn(p.locator('#result-root > p.muted').first(), 'Files API', '結果に送信方式を記録');
  await pickFile(p, F.big); ok((await p.locator('#route-note').innerText()).includes('Files API'), '実ファイル15MB→Files API案内');
  await pickFile(p, F.huge); await eqIn(p.locator('#file-error'), '大きすぎます', '200MB超は拒否'); await eqIn(p.locator('#file-error'), '次にやること', '拒否メッセージに次の行動');
  await p.context().close();

  p = await fresh(); st = await mockApi(p); await setKey(p);
  const runBig = async () => { await pickFile(p, F.big); await waitRunnable(p); await p.evaluate(() => { window.__t = []; new MutationObserver(() => window.__t.push(document.querySelector('#progress-text').textContent)).observe(document.querySelector('#progress-text'), { childList: true, characterData: true, subtree: true }); }); await p.click('#btn-run'); };
  await runBig(); await p.waitForURL(/#\/result\//, { timeout: 30000 });
  const g0 = st.calls[0].contents[0].parts[0];
  ok(g0.fileData && g0.fileData.fileUri.endsWith('/files/abc') && !g0.inlineData, '実API(モック): generateContent は fileData 参照');
  ok(st.started.h['x-goog-upload-command'] === 'start' && st.started.h['x-goog-api-key'] === KEY && !st.started.body.includes('big.wav'), 'resumable開始ヘッダ・元のファイル名は送信しない');
  await p.waitForTimeout(300); ok(st.deleted, '処理後にアップロードファイルを削除');
  st.mode = 'failed'; await runBig(); await p.waitForSelector('#run-error:not([hidden])', { timeout: 20000 });
  let e = await errText(p); ok(e.includes('ファイル処理に失敗') && e.includes('bad audio') && e.includes('次にやること'), 'Files処理FAILED→理由と次の行動');
  st.mode = 'upfail'; await runBig(); await p.waitForSelector('#run-error:not([hidden])', { timeout: 20000 }); e = await errText(p); ok(e.includes('アップロードに失敗') && e.includes('upload denied') && e.includes('次にやること'), 'アップロード失敗→理由と次の行動');
  await p.context().close();

  /* ---------- D. 接続テスト ---------- */
  console.log('\n## D. 接続テスト');
  p = await fresh(); st = await mockApi(p); await p.goto(BASE + '#/settings');
  await p.click('#set-test'); ok((await p.locator('#test-result').innerText()).includes('未入力') && p.reqs.filter((r) => r.url.includes('googleapis')).length === 0, 'キー未入力: 通信せず案内');
  await p.fill('#set-key', '全角キー'); await p.click('#set-test'); await eqIn(p.locator('#test-result'), '使えない文字', '不正な文字のキーは通信前に拒否');
  await p.fill('#set-key', KEY); await p.selectOption('#set-model', 'gemini-3.8-flash'); await p.click('#set-test'); await p.waitForFunction(() => document.querySelector('#test-result').innerText.includes('成功'));
  ok(st.testReq.url.endsWith('/models/gemini-3.8-flash') && st.testReq.key === KEY, '成功: 選択モデル・入力キーで確認'); ok(!(await p.evaluate(() => localStorage.getItem('mjp.settings.v1'))), 'テストは設定を保存しない');
  const cases = [['nogen', (j) => j(200, { supportedGenerationMethods: ['embedContent'] }), '使えません'], ['badkey', (j) => j(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }), 'APIキーが無効'],
    ['403', (j) => j(403, { error: { message: 'denied' } }), '権限'], ['429', (j) => j(429, { error: { message: 'q' } }), '上限'], ['503', (j) => j(503, { error: { message: 'x' } }), '一時的なエラー']];
  for (const [k, fn, want] of cases) { st.models = fn; await p.click('#set-test'); await p.waitForFunction((w) => document.querySelector('#test-result').innerText.includes(w), want); ok((await p.locator('#test-result').innerText()).includes('次にやること') || k === 'nogen', `接続テスト失敗(${k})→理由${k === 'nogen' ? '' : 'と次の行動'}`); }
  st.models = (j) => j(404, { error: { message: 'not found' } }); await p.selectOption('#set-model', '__custom'); await p.fill('#set-custom', 'models/gemini-zzz'); await p.click('#set-test'); await p.waitForFunction(() => document.querySelector('#test-result').innerText.includes('404'));
  const t404 = await p.locator('#test-result').innerText(); ok(t404.includes('存在しない可能性') && t404.includes('カスタム') && st.testReq.url.endsWith('/models/gemini-zzz'), '404: モデルID案内（models/接頭辞を除去）');
  await p.context().close();

  /* ---------- E. 送信前マスキング ---------- */
  console.log('\n## E. 送信前マスキング / 伏せ字');
  p = await fresh(); st = await mockApi(p); await setKey(p);
  await p.goto(BASE + '#/settings'); await p.fill('#set-mask-terms', '山田太郎\n株式会社サンプル, 山田太郎'); await p.click('#set-mask-save');
  ok((await p.locator('#set-mask-count').innerText()).includes('2語'), '辞書の保存（重複除去）');
  await p.click('#set-save'); ok((await p.evaluate(() => JSON.parse(localStorage.getItem('mjp.settings.v1')).maskTerms.length)) === 2, 'キー保存で辞書が消えない');
  await pickFile(p, F.loud); await waitRunnable(p);
  ok(await p.locator('#mask-card').isVisible(), '送信前マスキングUI表示');
  await p.fill('#mask-start', 'abc'); await p.fill('#mask-end', '2'); await p.click('#mask-add'); await eqIn(p.locator('.toast').last(), '入力してください', '不正な時刻は案内');
  await p.fill('#mask-start', '2'); await p.fill('#mask-end', '1'); await p.click('#mask-add'); await eqIn(p.locator('.toast').last(), '後の時刻', '終了<開始は案内');
  await p.fill('#mask-start', '5'); await p.fill('#mask-end', '6'); await p.click('#mask-add'); await eqIn(p.locator('.toast').last(), '超えています', '音声長を超える開始は案内');
  await p.fill('#mask-start', '1'); await p.fill('#mask-end', '1.6'); await p.click('#mask-add'); await p.fill('#mask-start', '1.5'); await p.fill('#mask-end', '2'); await p.click('#mask-add');
  ok(await p.locator('#mask-list li').count() === 1 && (await p.locator('#mask-total').innerText()).includes('1区間'), '重なる区間は結合');
  await p.fill('#glossary', '山田太郎\n田中部長\nProject X'); const sp = await p.locator('#send-list').textContent(); ok(sp.includes('無音化した16kHzモノラルWAV') && sp.includes('除外'), '送信内容プレビュー（マスキング・用語ヒント除外）');
  await p.click('#mask-preview'); await p.waitForSelector('#mask-preview-audio:not([hidden])'); await eqIn(p.locator('#mask-preview-info'), '作成しました', 'マスク後の試聴を作成');
  await p.click('#btn-run'); await p.waitForURL(/#\/result\//, { timeout: 30000 });
  const call = st.calls[0], part = call.contents[0].parts[0], prompt = call.contents[0].parts[1].text;
  const w = parseWav(part.inlineData.data);
  const zero = w.s.slice(16000, 32000).every((v) => v === 0), outside = [...w.s.slice(0, 16000), ...w.s.slice(32000)]; const nz = outside.filter((v) => v !== 0).length / outside.length;
  ok(w.riff === 'RIFF' && w.sr === 16000 && w.ch === 1, '送信音声は16kHzモノラルWAV（元ファイルではない）');
  ok(zero && nz > 0.9 && w.s.length >= 47990, '送信データの指定区間(1〜2秒)が完全な無音、区間外は音声のまま（タイムライン維持）');
  ok(prompt.includes('無音化') && prompt.includes('Project X') && prompt.includes('田中部長') && !prompt.includes('山田太郎'), '用語ヒントから辞書の語を除外して送信（他の語は送信）');
  ok(!JSON.stringify(call).includes('loud.wav'), '元のファイル名は送信しない');
  await eqIn(p.locator('#result-root > p.muted').first(), '送信前マスキング: 1区間', '結果に送信前マスキングを記録');
  const [mt] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("TXTで")')]); const mtx = fs.readFileSync(await mt.path(), 'utf8');
  ok(!mtx.includes('山田太郎') && mtx.includes('■■■■') && mtx.includes('送信前マスキング: 1区間') && mtx.includes('出力時の伏せ字: 適用済み'), '出力の伏せ字（辞書の語→■）と処理履歴の明記');
  ok((await p.locator('.seg-edit').nth(1).inputValue()).includes('山田太郎'), '画面表示は変更されない（出力時のみ伏せ字）');
  await p.click('#mask-output'); const [mt2] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("TXTで")')]); ok(fs.readFileSync(await mt2.path(), 'utf8').includes('山田太郎'), '伏せ字OFFで原文のまま出力');
  await p.click('button:has-text("全体をコピー")'); ok((await p.evaluate(() => navigator.clipboard.readText())).includes('山田太郎'), 'コピーにも設定が反映');
  /* 上限超 */
  await pickFile(p, F.mid); await eqIn(p.locator('#mask-unavail'), '送信前マスキングを使えません', '30MB超は送信前マスキング不可（理由と対処を表示）');
  ok(!(await p.locator('#mask-controls').isVisible()), '不可のときは操作UIを隠す');
  await p.context().close();

  /* ---------- F. エラーハンドリング ---------- */
  console.log('\n## F. エラーハンドリング総点検');
  p = await fresh(); st = await mockApi(p); await setKey(p);
  await p.evaluate(() => { MP.gemini._retryDelays.splice(0, 2, 40, 40); });
  const runLoud = async () => { await pickFile(p, F.loud); await waitRunnable(p); await p.click('#btn-run'); };
  const expectErr = async (label, fn, words) => {
    st.gen = fn; st.calls = []; await runLoud(); await p.waitForSelector('#run-error:not([hidden])', { timeout: 20000 }); const t = await errText(p);
    ok(words.every((x) => t.includes(x)) && t.includes('次にやること'), `${label} → 原因＋次の行動`); return t;
  };
  const H = (status, message, extra = {}) => () => ({ status, body: { error: { message, ...extra } } });
  await expectErr('400 不正リクエスト', H(400, 'bad'), ['HTTP 400', 'MP3']);
  await expectErr('400 キー無効', H(400, 'API key not valid. Please pass a valid API key.'), ['APIキーが無効']);
  await expectErr('401', H(401, 'x'), ['APIキーが無効']);
  await expectErr('403', H(403, 'denied'), ['HTTP 403']);
  await expectErr('404', H(404, 'nf'), ['モデルIDが存在しない可能性があります。設定のカスタムモデル欄で別のモデルIDを試せます']);
  await expectErr('413', H(413, 'big'), ['大きすぎます']);
  await expectErr('429', H(429, 'quota'), ['リクエスト上限（レート/クォータ）に達しました']);
  await expectErr('400 地域/課金', H(400, 'User location is not supported', { status: 'FAILED_PRECONDITION' }), ['地域']);
  await expectErr('503（自動再試行も失敗）', H(503, 'busy'), ['一時的なエラー']); ok(st.calls.length === 3, '5xxは自動で2回再試行（計3回）');
  st.gen = (n) => (n < 2 ? { status: 503, body: { error: { message: 'busy' } } } : { status: 200, body: cand(GOOD) }); st.calls = []; await runLoud(); await p.waitForURL(/#\/result\//, { timeout: 20000 }); ok(st.calls.length === 2, '503→再試行で成功すると結果表示');
  await expectErr('ネットワーク遮断', () => 'abort', ['接続できませんでした']);
  await p.evaluate(() => { MP.gemini._timeouts.inline = 400; }); await expectErr('タイムアウト', () => 'hang', ['タイムアウト']); await p.evaluate(() => { MP.gemini._timeouts.inline = 300000; });
  await expectErr('安全性ブロック', () => ({ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' } } }), ['安全性フィルタ']);
  await expectErr('空応答', () => ({ status: 200, body: { candidates: [{ content: { parts: [] }, finishReason: 'OTHER' }] } }), ['応答が空']);
  await expectErr('不正JSON', () => ({ status: 200, body: cand('これはJSONではない') }), ['解釈できませんでした']);
  await expectErr('出力打ち切り(MAX_TOKENS)', () => ({ status: 200, body: cand('{"transcript":[', { finishReason: 'MAX_TOKENS' }) }), ['打ち切られました']);
  await expectErr('文字起こしが空', () => ({ status: 200, body: cand({ ...GOOD, transcript: [] }) }), ['空でした']);
  await expectErr('応答形式が不正', () => ({ status: 200, body: cand('[1,2]') }), ['想定と異なり']);
  st.gen = () => 'hang'; await runLoud(); await p.waitForSelector('#btn-cancel:not([hidden])'); await p.click('#btn-cancel'); await p.waitForSelector('#run-error:not([hidden])'); e = await errText(p); ok(e.includes('キャンセルしました') && e.includes('次にやること'), 'キャンセル → 案内');
  const genBefore = p.reqs.filter((r) => r.url.includes(':generateContent')).length; await p.context().setOffline(true); st.gen = null; await runLoud(); await p.waitForSelector('#run-error:not([hidden])'); e = await errText(p);
  ok(e.includes('オフライン') && e.includes('次にやること') && p.reqs.filter((r) => r.url.includes(':generateContent')).length === genBefore, 'オフライン → 通信せず案内'); await p.context().setOffline(false);
  /* ファイル検証 */
  await p.goto(BASE + '#/app');
  const fileCase = async (label, file, words) => { await p.setInputFiles('#file', file); await p.waitForSelector('#file-error:not([hidden])'); const t = await p.locator('#file-error').innerText(); ok(words.every((x) => t.includes(x)) && t.includes('次にやること'), `${label} → 原因＋次の行動`); };
  fs.writeFileSync(path.join(TMP, 'empty.mp3'), ''); fs.writeFileSync(path.join(TMP, 'note.txt'), 'hello'); fs.writeFileSync(path.join(TMP, 'clip.mp4'), 'x');
  await fileCase('0バイト', path.join(TMP, 'empty.mp3'), ['空のファイル']);
  await fileCase('音声以外', path.join(TMP, 'note.txt'), ['音声ファイルとして認識できません']);
  await fileCase('動画', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('x') }, ['動画ファイル']);
  await p.setInputFiles('#file', { name: 'a.wma', mimeType: 'audio/x-ms-wma', buffer: fs.readFileSync(F.loud) }); await p.waitForFunction(() => !document.querySelector('#run-card').hidden);
  await eqIn(p.locator('#check-msgs'), '明記されていません', '公式対応形式外の拡張子は警告（変換の案内付き）');
  await p.setInputFiles('#file', { name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('not really an mp3 file at all'.repeat(50)) }); await p.waitForFunction(() => document.querySelector('#check-badge .badge') && document.querySelector('#check-msgs').innerText.includes('解析できませんでした'));
  await eqIn(p.locator('#check-msgs'), 'MP3 または WAV に変換', '壊れた音声は解析不能と変換の案内（送信は可能）');
  /* 設定: 不正キー */
  await p.goto(BASE + '#/settings'); await p.fill('#set-key', 'キー'); await p.click('#set-save'); await eqIn(p.locator('.toast').last(), '使えない文字', '不正文字のキーは保存せず案内');
  /* 履歴保存失敗でも結果を失わない */
  await p.goto(BASE + '#/settings'); await p.fill('#set-key', KEY); await p.check('#set-demo'); await p.click('#set-save');
  await p.goto(BASE + '#/app'); await p.click('#btn-sample'); await p.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('q', 'QuotaExceededError'); }; });
  await p.click('#btn-run'); await p.waitForURL(/#\/result\//, { timeout: 15000 }); await eqIn(p.locator('#result-root'), '履歴に保存されていません', '保存失敗時も結果を表示し、ダウンロードを促す');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("TXTで")')]); ok(fs.readFileSync(await dl.path(), 'utf8').includes('文字起こし結果'), '保存失敗時でもTXTで保全できる');
  await p.context().close();
  /* localStorage 不可（プライベートモード相当） */
  p = await fresh({ noStorage: true }); ok(await p.locator('#storage-banner').isVisible(), 'localStorage不可: 警告バナー');
  await p.goto(BASE + '#/settings'); await p.fill('#set-key', KEY); await p.click('#set-save'); await p.goto(BASE + '#/app'); ok(!(await p.locator('#mode-banner').isVisible()), 'localStorage不可でもそのタブ内では設定が機能');
  await p.context().close();
  /* 壊れた履歴データ */
  p = await fresh(); await p.evaluate(() => localStorage.setItem('mjp.history.v1', JSON.stringify([null, 5, { id: 'bad1', transcript: 'x', polished: [null, { spk: 9 }], todos: 'q', speakers: [] }, { id: 'ok2', fileName: 'ok', transcript: [{ spk: 'A', text: 't' }] }])));
  await p.goto(BASE + '#/history'); ok(await p.locator('.hist-item').count() === 2, '壊れた履歴が混在してもクラッシュしない（有効な2件を表示）');
  await p.goto(BASE + '#/result/bad1'); ok(await p.locator('.tab').count() === 4 && p.errs.length === 0, '壊れたレコードも補正して表示');
  await p.evaluate(() => localStorage.setItem('mjp.history.v1', '{not json')); await p.goto(BASE + '#/history'); await p.reload(); ok(await p.locator('#view-history').isVisible() && p.errs.length === 0, '履歴JSONが壊れていても起動できる');
  await p.goto(BASE + '#/result/nonexistent'); await p.waitForURL(/#\/history/); ok(true, '存在しない履歴ID→履歴一覧へ誘導');
  await p.context().close();

  /* ---------- G. セキュリティ ---------- */
  console.log('\n## G. セキュリティ（XSS / CSP / APIキー）');
  const X = '<img src=x onerror="window.__xss=1">', S2 = '<script>window.__xss=2</script>', Q = '"><svg onload="window.__xss=3">';
  p = await fresh(); st = await mockApi(p, { gen: () => ({ status: 200, body: cand({
    transcript: [{ speaker: X, start: Q, text: X + S2 + Q, uncertain: true }, { speaker: S2, start: '00:02', text: '`**bold**` <b>b</b>', uncertain: false }], polished: [{ speaker: X, text: X }],
    summary: [X, S2], decisions: [Q], todos: [{ task: X, owner: S2, due: Q }], audio_notes: X }) }) });
  await setKey(p); await p.goto(BASE + '#/settings'); await p.fill('#set-mask-terms', X); await p.click('#set-mask-save');
  await p.goto(BASE + '#/app'); await p.setInputFiles('#file', { name: '<b id="pwn">x</b><img src=x onerror=window.__xss=4>.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(F.loud) });
  await waitRunnable(p); await p.fill('#glossary', X); await p.fill('#spk-hint', '3'); await p.click('#btn-run'); await p.waitForURL(/#\/result\//, { timeout: 20000 });
  const sweep = async (label) => {
    const r = await p.evaluate(() => ({ xss: window.__xss, pwn: !!document.querySelector('#pwn'), imgs: document.querySelectorAll('img[src="x"]').length, svg: document.querySelectorAll('svg[onload]').length, scripts: [...document.scripts].filter((s) => !s.src).length, onerr: document.querySelectorAll('[onerror],[onload]').length }));
    ok(r.xss === undefined && !r.pwn && r.imgs === 0 && r.svg === 0 && r.scripts === 0 && r.onerr === 0, `XSS無害化: ${label}`);
  };
  await sweep('結果-文字起こし');
  for (const t of ['整文', '要約', '決定事項とToDo']) { await p.click(`.tab:has-text("${t}")`); await sweep(`結果-${t}`); }
  await p.fill('.spk input >> nth=0', X); await p.press('.spk input >> nth=0', 'Tab'); await sweep('話者名にペイロード入力');
  await p.fill('#result-root .tbl input[type=text] >> nth=0', S2); await p.press('#result-root .tbl input[type=text] >> nth=0', 'Tab'); await sweep('ToDoにペイロード入力');
  await p.goto(BASE + '#/history'); await sweep('履歴一覧'); await p.fill('#hist-q', 'img'); await sweep('履歴検索');
  await p.goto(BASE + '#/settings'); await sweep('設定（辞書にペイロード）'); ok((await p.locator('#set-mask-terms').inputValue()).includes('<img'), '辞書はテキストとして保持');
  await p.goto(BASE + '#/app'); await p.setInputFiles('#file', { name: Q + '.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(F.loud) }); await p.waitForFunction(() => !document.querySelector('#run-card').hidden); await sweep('取込画面（ファイル名にペイロード）');
  await p.goto(BASE + '#/result/' + (await p.evaluate(() => JSON.parse(localStorage.getItem('mjp.history.v1'))[0].id))); await p.click('.tab:has-text("文字起こし全文")');
  await p.goto(BASE + '#/settings'); await p.uncheck('#set-mask-output'); await p.click('#set-mask-save'); await p.goBack(); await p.waitForSelector('.seg-edit');
  const [mdl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Markdownで")')]); const md2 = fs.readFileSync(await mdl.path(), 'utf8');
  ok(!/(^|[^\\])<img/.test(md2) && !/(^|[^\\])<script/.test(md2) && md2.includes('\\<img'), 'Markdown出力は<>をエスケープ（レンダラでのHTML実行を防ぐ）');
  /* CSP */
  const cspMeta = await p.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
  ok(/default-src 'none'/.test(cspMeta) && /script-src 'self'/.test(cspMeta) && !/unsafe-inline|unsafe-eval/.test(cspMeta) && /connect-src 'self' https:\/\/generativelanguage\.googleapis\.com/.test(cspMeta), 'CSP: unsafe-inline/eval なし・通信先はGoogle APIのみ');
  const csp0 = await p.evaluate(() => window.__csp.length);
  await p.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__cspInline=1'; document.head.append(s); });
  const blocked = await p.evaluate(() => fetch('https://example.com/').then(() => 'allowed', () => 'blocked')); await p.waitForTimeout(200);
  ok(await p.evaluate(() => window.__cspInline) === undefined && blocked === 'blocked' && (await p.evaluate(() => window.__csp.length)) >= csp0 + 2, 'CSPが実際にインラインスクリプトと外部通信を遮断');
  ok(csp0 === 0, 'ここまでの全フローでCSP違反なし');
  /* APIキー */
  const all = p.reqs; ok(all.every((r) => !r.url.includes(KEY)), 'APIキーがURLに含まれない');
  const withKey = all.filter((r) => r.headers['x-goog-api-key']); ok(withKey.length > 0 && withKey.every((r) => new URL(r.url).host === 'generativelanguage.googleapis.com'), 'APIキーはGoogle APIへのヘッダでのみ送信');
  ok(all.every((r) => ['localhost', 'generativelanguage.googleapis.com'].includes(new URL(r.url).hostname)), '通信先は自ドメインとGoogle APIのみ（外部の第三者へ通信しない）');
  const store = await p.evaluate(() => ({ his: localStorage.getItem('mjp.history.v1'), set: localStorage.getItem('mjp.settings.v1'), cookie: document.cookie, ss: sessionStorage.length, keys: Object.keys(localStorage) }));
  ok(!store.his.includes('AIzaTESTKEY') && store.set.includes('AIzaTESTKEY') && store.cookie === '' && store.ss === 0, 'APIキーは設定のlocalStorageにのみ。履歴・Cookie・sessionStorageには無い');
  const sawKeyInSettings = await p.evaluate(() => { location.hash = '#/settings'; return new Promise((r) => setTimeout(() => r(document.querySelector('#set-key').value), 100)); });
  await p.goto(BASE + '#/app'); ok(sawKeyInSettings === KEY && (await p.evaluate(() => document.querySelector('#set-key').value)) === '' && (await p.locator('#set-key').getAttribute('type')) === 'password', 'キー入力欄はpassword型・設定画面を離れるとDOMからも消去');
  await p.goto(BASE + '#/settings'); await p.click('#set-keydel'); ok(!(await p.evaluate(() => JSON.parse(localStorage.getItem('mjp.settings.v1')).apiKey)), 'APIキーだけ削除');
  await p.click('#set-wipe'); ok((await p.evaluate(() => localStorage.length)) === 0, 'すべて削除でlocalStorageが空');
  ok(p.errs.length === 0, 'JSエラーなし（XSSペイロード処理中も）');
  await p.context().close();

  /* ---------- H. ヘルプ・PWA ---------- */
  console.log('\n## H. ヘルプ・PWA');
  p = await fresh(); await p.goto(BASE + '#/help');
  const secs = ['start', 'key', 'screen', 'privacy', 'error', 'faq']; for (const k of secs) ok(await p.locator('#help-' + k).count() === 1, `ヘルプ見出し: ${k}`);
  await p.click('.toc a[href="#/help/error"]'); await p.waitForTimeout(200); ok(await p.locator('#view-help').isVisible() && await p.evaluate(() => { const r = document.getElementById('help-error').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), '目次リンクで該当セクションへ移動（ルーターと衝突しない）');
  ok(await p.locator('.help-tbl tbody tr').count() >= 12, 'エラー対処表（12行以上）');
  const m = await p.evaluate(() => fetch('manifest.webmanifest').then((r) => r.json())); ok(m.icons.length >= 3 && m.start_url && m.display === 'standalone', 'manifest');
  const icons = await Promise.all(m.icons.map((i) => p.evaluate((u) => fetch(u).then((r) => r.status), i.src))); ok(icons.every((s) => s === 200), 'アイコン取得');
  await p.evaluate(() => navigator.serviceWorker.ready); const cached = await p.evaluate(() => caches.open('mojiokoshi-pro-v2').then((c) => c.keys()).then((k) => k.map((r) => new URL(r.url).pathname)));
  ok(['/js/mask.js', '/js/errors.js', '/js/app.js', '/index.html'].every((x) => cached.includes(x)), 'Service Worker: アプリシェルをキャッシュ（新規モジュール含む）');
  await p.context().close();

  await browser.close(); server.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n==== 結果: ${pass} 件合格 / ${fail} 件失敗 ====`);
  if (fail) { console.log('失敗項目:\n - ' + failed.join('\n - ')); process.exit(1); }
})().catch((e) => { console.error('FATAL', e); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) { /* ignore */ } process.exit(1); });
