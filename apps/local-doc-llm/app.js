import {
  DEFAULTS, TASKS, PII_LABELS, normalizeBaseUrl, testConnection, planJobs, runJob,
  findPII, summarizePII, createMaskState, maskText, unmaskText, decodeText, toMarkdown, estimateTokens,
} from './lib/core.js';

const $ = (id) => document.getElementById(id);
const el = {};
for (const id of ['baseUrl', 'model', 'ctx', 'maxOut', 'timeout', 'btnTest', 'effectiveUrl', 'testResult', 'modelChips', 'modelList',
  'drop', 'fileInput', 'fileList', 'fileMsg', 'task', 'mask', 'unmask', 'questionWrap', 'question',
  'btnPreview', 'previewMsg', 'piiBox', 'previewSummary', 'previewList', 'btnRun', 'btnCancel', 'progress', 'progressText', 'runMsg',
  'btnCopy', 'btnDownload', 'copyMsg', 'result']) el[id] = $(id);

const STORE_KEY = 'local-doc-llm.settings.v1';
const state = { docs: [], plan: null, snapshot: null, maskState: null, results: null, running: null, nextId: 1 };

/* ---------- 設定の保存（文書内容は保存しない） ---------- */
function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { /* 無視 */ }
  el.baseUrl.value = s.baseUrl || DEFAULTS.baseUrl;
  el.model.value = s.model || DEFAULTS.model;
  el.ctx.value = s.contextTokens || DEFAULTS.contextTokens;
  el.maxOut.value = s.maxOutputTokens || DEFAULTS.maxOutputTokens;
  el.timeout.value = s.timeoutSec || DEFAULTS.timeoutSec;
  if (typeof s.mask === 'boolean') el.mask.checked = s.mask;
  if (typeof s.unmask === 'boolean') el.unmask.checked = s.unmask;
}
function readSettings() {
  return {
    baseUrl: el.baseUrl.value.trim(),
    model: el.model.value.trim(),
    contextTokens: Math.max(512, parseInt(el.ctx.value, 10) || DEFAULTS.contextTokens),
    maxOutputTokens: Math.max(64, parseInt(el.maxOut.value, 10) || DEFAULTS.maxOutputTokens),
    timeoutSec: Math.max(10, parseInt(el.timeout.value, 10) || DEFAULTS.timeoutSec),
    temperature: DEFAULTS.temperature,
  };
}
function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...readSettings(), mask: el.mask.checked, unmask: el.unmask.checked }));
  } catch { /* localStorage不可でも動作する */ }
}

function setStatus(node, kind, text) {
  node.className = `status ${kind || ''}`.trim();
  node.textContent = text || '';
}

function updateEffectiveUrl() {
  const n = normalizeBaseUrl(el.baseUrl.value);
  el.effectiveUrl.textContent = n.error ? '' : `実際の接続先: ${n.url}`;
}

/* ---------- 接続テスト ---------- */
el.btnTest.addEventListener('click', async () => {
  const s = readSettings();
  setStatus(el.testResult, '', '接続確認中…');
  el.modelChips.replaceChildren();
  el.btnTest.disabled = true;
  try {
    const r = await testConnection({ baseUrl: s.baseUrl, model: s.model });
    const detail = r.steps.length ? '\n' + r.steps.map((x) => '・' + x).join('\n') : '';
    setStatus(el.testResult, r.ok ? 'ok' : 'err', (r.ok ? '✔ ' : '✖ ') + r.message + detail);
    if (r.models?.length) {
      el.modelList.replaceChildren(...r.models.map((m) => { const o = document.createElement('option'); o.value = m; return o; }));
      el.modelChips.replaceChildren(...r.models.map((m) => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = m;
        b.addEventListener('click', () => { el.model.value = m; invalidate(); saveSettings(); });
        return b;
      }));
    }
  } catch (e) {
    setStatus(el.testResult, 'err', '✖ ' + e.message);
  } finally {
    el.btnTest.disabled = false;
  }
});

/* ---------- ファイル投入 ---------- */
const MAX_BYTES = 50 * 1024 * 1024;
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('./vendor/pdfjs/pdf.min.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
  }
  return pdfjsPromise;
}

async function extractPdf(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: new URL('./vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const pages = [];
  const pageCount = doc.numPages;
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let t = '';
    for (const it of tc.items) { t += it.str; if (it.hasEOL) t += '\n'; }
    pages.push(t.trim());
  }
  await doc.destroy();
  return { text: pages.filter(Boolean).join('\n\n'), pageCount };
}

async function addFiles(fileList) {
  const msgs = [];
  for (const f of fileList) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['txt', 'md', 'markdown', 'pdf'].includes(ext)) { msgs.push(`✖ ${f.name}: 非対応の形式です（.txt / .md / .pdf のみ）`); continue; }
    if (f.size > MAX_BYTES) { msgs.push(`✖ ${f.name}: ${(f.size / 1048576).toFixed(0)}MB は大きすぎます（上限50MB）`); continue; }
    try {
      const buf = await f.arrayBuffer();
      let text; let note = '';
      if (ext === 'pdf') {
        const r = await extractPdf(buf);
        text = r.text; note = `PDF ${r.pageCount}ページ`;
        if (!text.trim()) { msgs.push(`✖ ${f.name}: テキストを抽出できませんでした（スキャン画像のPDFはOCR非対応です）`); continue; }
      } else {
        const r = decodeText(buf);
        text = r.text; note = r.encoding;
        if (!text.trim()) { msgs.push(`✖ ${f.name}: 中身が空です`); continue; }
      }
      state.docs.push({ id: state.nextId++, name: f.name, text, note });
    } catch (e) {
      msgs.push(`✖ ${f.name}: 読み込みに失敗しました（${e.message}）`);
    }
  }
  renderFiles();
  setStatus(el.fileMsg, msgs.length ? 'err' : '', msgs.join('\n'));
  invalidate();
}

function renderFiles() {
  el.fileList.replaceChildren(...state.docs.map((d) => {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = d.name;
    const meta = document.createElement('span'); meta.className = 'muted';
    meta.textContent = `${d.text.length.toLocaleString()}文字（約${estimateTokens(d.text).toLocaleString()}トークン）／${d.note}`;
    const rm = document.createElement('button'); rm.type = 'button'; rm.textContent = '削除';
    rm.addEventListener('click', () => { state.docs = state.docs.filter((x) => x.id !== d.id); renderFiles(); invalidate(); });
    li.append(name, meta, rm);
    return li;
  }));
}

el.fileInput.addEventListener('change', async () => { await addFiles([...el.fileInput.files]); el.fileInput.value = ''; });
for (const ev of ['dragenter', 'dragover']) el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) el.drop.addEventListener(ev, (e) => { e.preventDefault(); el.drop.classList.remove('over'); });
el.drop.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));

/* ---------- 処理選択 ---------- */
for (const [id, t] of Object.entries(TASKS)) {
  const o = document.createElement('option'); o.value = id; o.textContent = t.label; el.task.append(o);
}
function syncTaskUi() { el.questionWrap.hidden = el.task.value !== 'qa'; }
el.task.addEventListener('change', () => { syncTaskUi(); invalidate(); });

/* ---------- プレビュー ---------- */
function invalidate() {
  state.plan = null; state.snapshot = null; state.maskState = null;
  el.btnRun.disabled = true;
  setStatus(el.previewMsg, '', '');
  el.piiBox.hidden = true; el.piiBox.replaceChildren();
  el.previewSummary.textContent = ''; el.previewList.replaceChildren();
  updateEffectiveUrl();
}
for (const id of ['baseUrl', 'model', 'ctx', 'maxOut', 'timeout', 'mask', 'question']) {
  el[id].addEventListener('input', () => { invalidate(); saveSettings(); });
  el[id].addEventListener('change', () => { invalidate(); saveSettings(); });
}
el.unmask.addEventListener('change', () => { saveSettings(); if (state.results) renderResult(); });

function buildPii(docs, question) {
  const items = [];
  for (const d of docs) for (const f of findPII(d.text)) items.push({ doc: d.name, ...f });
  if (question) for (const f of findPII(question)) items.push({ doc: '（質問文）', ...f });
  return items;
}

el.btnPreview.addEventListener('click', () => {
  invalidate();
  const settings = readSettings();
  const n = normalizeBaseUrl(settings.baseUrl);
  if (n.error) { setStatus(el.previewMsg, 'err', n.error); return; }
  if (!settings.model) { setStatus(el.previewMsg, 'err', 'モデル名を入力してください。'); return; }
  const taskId = el.task.value;
  const masking = el.mask.checked;
  const question = el.question.value;
  try {
    const pii = buildPii(state.docs, taskId === 'qa' ? question : '');
    const ms = createMaskState();
    const docs = state.docs.map((d) => ({ name: d.name, text: masking ? maskText(d.text, ms) : d.text }));
    const q = taskId === 'qa' ? (masking ? maskText(question, ms) : question) : '';
    const jobs = planJobs({ taskId, docs, question: q, settings });
    state.plan = jobs; state.maskState = masking ? ms : null;
    state.snapshot = { settings: { ...settings, baseUrl: n.url }, taskId, masking, piiCount: pii.length };
    renderPreview(jobs, pii, masking, ms, settings);
    el.btnRun.disabled = false;
  } catch (e) {
    setStatus(el.previewMsg, 'err', e.message);
  }
});

function renderPreview(jobs, pii, masking, ms, settings) {
  if (pii.length) {
    const counts = summarizePII(pii);
    const box = el.piiBox; box.hidden = false;
    const head = document.createElement('strong');
    head.textContent = `⚠ 個人情報らしいパターンを検出: ${Object.entries(counts).map(([k, v]) => `${PII_LABELS[k]} ${v}件`).join(' / ')}`;
    const note = document.createElement('div');
    note.textContent = masking ? '→ マスキング有効：下のプレビューは [EMAIL_1] 等に置換済みの、実際に送る内容です。' : '→ マスキング無効：検出された値はそのままLLMへ送られます（接続先はローカルのみ）。';
    const ul = document.createElement('ul');
    for (const p of pii.slice(0, 50)) {
      const li = document.createElement('li');
      const code = document.createElement('code'); code.textContent = p.value;
      li.append(`${p.doc}: ${PII_LABELS[p.type]} `, code);
      ul.append(li);
    }
    if (pii.length > 50) { const li = document.createElement('li'); li.textContent = `…ほか${pii.length - 50}件`; ul.append(li); }
    box.replaceChildren(head, note, ul);
  }
  const reqCount = jobs.reduce((a, j) => a + j.requests.length, 0);
  const estCalls = jobs.reduce((a, j) => a + j.estCalls, 0);
  const tokens = jobs.reduce((a, j) => a + j.requests.reduce((b, r) => b + estimateTokens(r.messages.map((m) => m.content).join('')), 0), 0);
  const needReduce = jobs.some((j) => j.mode === 'mapreduce' || (j.mode === 'qa' && j.requests.length > 1));
  el.previewSummary.textContent =
    `送信先: ${state.snapshot.settings.baseUrl} ／ モデル: ${settings.model} ／ 1チャンク最大約${Math.min(...jobs.map((j) => j.budget)).toLocaleString()}トークン（上限${settings.contextTokens.toLocaleString()}）\n` +
    `第1段階のリクエスト: ${reqCount}件（推定 計約${tokens.toLocaleString()}トークン）` +
    (needReduce ? ` ／ 統合ステップを含む推定LLM呼び出し: 約${estCalls}回（統合の入力は第1段階の出力から作られるため、ここには表示されません）` : '');
  el.previewSummary.style.whiteSpace = 'pre-wrap';
  const frag = [];
  for (const j of jobs) for (const r of j.requests) {
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = `${j.title} — ${r.label}（約${estimateTokens(r.messages.map((m) => m.content).join('')).toLocaleString()}トークン）`;
    const pre = document.createElement('pre');
    pre.textContent = r.messages.map((m) => `--- ${m.role} ---\n${m.content}`).join('\n\n');
    det.append(sum, pre);
    frag.push(det);
  }
  el.previewList.replaceChildren(...frag);
  setStatus(el.previewMsg, 'ok', '送信内容を生成しました。内容を確認し、問題なければ「確認した内容で送信して実行」を押してください。');
}

/* ---------- 実行 ---------- */
el.btnRun.addEventListener('click', async () => {
  if (!state.plan || !state.snapshot) return;
  const snap = state.snapshot;
  if (snap.piiCount > 0 && !snap.masking) {
    if (!confirm(`個人情報らしいパターンが ${snap.piiCount} 件あります。マスキングなしでローカルLLMへ送信します。続行しますか？`)) return;
  }
  const ctl = new AbortController();
  state.running = ctl;
  el.btnRun.disabled = true; el.btnPreview.disabled = true; el.btnCancel.disabled = false;
  el.progress.hidden = false; el.progress.value = 0;
  setStatus(el.runMsg, '', ''); state.results = null; renderResult();
  const total = state.plan.reduce((a, j) => a + j.estCalls, 0);
  let done = 0;
  el.progress.max = total; el.progressText.textContent = `0 / 約${total}`;
  const results = [];
  try {
    for (const job of state.plan) {
      const r = await runJob({
        taskId: snap.taskId, job, settings: snap.settings,
        hooks: {
          signal: ctl.signal,
          onCall: (label) => { el.progressText.textContent = `${done} / 約${total} — 処理中: ${label}`; },
          onProgress: () => { done++; el.progress.value = Math.min(done, total); el.progressText.textContent = `${done} / 約${total}`; },
        },
      });
      results.push({ title: job.title, text: r.text, warnings: r.warnings });
      state.results = { taskId: snap.taskId, results: [...results] };
      renderResult();
    }
    const warns = results.flatMap((r) => r.warnings);
    setStatus(el.runMsg, warns.length ? 'warn' : 'ok', warns.length ? '完了（注意あり）\n' + warns.join('\n') : '✔ 完了しました。');
  } catch (e) {
    const partial = results.length ? `\n（ここまでの ${results.length} 件の結果は下に表示しています）` : '';
    setStatus(el.runMsg, e.kind === 'abort' ? 'warn' : 'err', (e.kind === 'abort' ? '中止しました。' : '✖ 実行に失敗しました。\n' + e.message) + partial);
  } finally {
    state.running = null;
    el.btnCancel.disabled = true; el.btnPreview.disabled = false; el.btnRun.disabled = false;
    el.progress.hidden = true; el.progressText.textContent = '';
  }
});
el.btnCancel.addEventListener('click', () => state.running?.abort());

/* ---------- 結果 ---------- */
function displayResults() {
  if (!state.results) return null;
  const ms = state.maskState;
  return state.results.results.map((r) => ({ ...r, text: el.unmask.checked && ms ? unmaskText(r.text, ms) : r.text }));
}
function renderResult() {
  const res = displayResults();
  if (!res) { el.result.textContent = ''; el.btnCopy.disabled = true; el.btnDownload.disabled = true; return; }
  el.result.textContent = res.map((r) => (res.length > 1 ? `## ${r.title}\n\n` : '') + r.text).join('\n\n');
  el.btnCopy.disabled = false; el.btnDownload.disabled = false;
}
function resultMarkdown() {
  const res = displayResults();
  return toMarkdown({
    taskLabel: TASKS[state.results.taskId].label, results: res,
    model: state.snapshot?.settings.model || el.model.value, masked: !!state.snapshot?.masking,
  });
}
el.btnCopy.addEventListener('click', async () => {
  const text = el.result.textContent;
  try { await navigator.clipboard.writeText(text); el.copyMsg.textContent = 'コピーしました'; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); el.copyMsg.textContent = 'コピーしました'; } catch { el.copyMsg.textContent = 'コピーに失敗しました（手動で選択してください）'; }
    ta.remove();
  }
  setTimeout(() => { el.copyMsg.textContent = ''; }, 3000);
});
el.btnDownload.addEventListener('click', () => {
  const blob = new Blob([resultMarkdown()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = URL.createObjectURL(blob); a.download = `result-${state.results.taskId}-${stamp}.md`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

loadSettings(); syncTaskUi(); updateEffectiveUrl(); renderFiles();
// テスト用フック（外部通信はしない）
window.__app = { state };
