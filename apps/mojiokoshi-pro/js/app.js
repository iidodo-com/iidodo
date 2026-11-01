/* 画面制御（ハッシュルーティング + 各ビュー） */
(function () {
  const MP = window.MP;
  const { h, $, clear, toast } = MP;
  const MAX_BYTES = MP.gemini.MAX_INLINE_BYTES;

  const state = { file: null, sample: false, check: null, running: false, ctrl: null, objUrl: null };

  /* ================= ルーター ================= */
  const VIEWS = ['app', 'result', 'history', 'settings', 'help', 'pricing', 'terms', 'privacy'];

  function route() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'app').split('/');
    let name = VIEWS.includes(parts[0]) ? parts[0] : 'app';
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== name; });
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === name || (name === 'result' && a.dataset.nav === 'history');
      on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current');
    });
    if (name === 'history') renderHistory();
    if (name === 'settings') loadSettingsForm();
    if (name === 'result') {
      if (!renderResult(parts[1])) { location.replace('#/history'); return; }
    }
    renderBanner();
    window.scrollTo(0, 0);
    $('#main').focus({ preventScroll: true });
  }

  function renderBanner() {
    const s = MP.store.getSettings();
    const b = $('#mode-banner');
    if (MP.store.isDemo(s)) {
      b.hidden = false;
      clear(b).append(h('div', { class: 'wrap' },
        h('strong', null, 'デモモード'),
        s.forceDemo ? '（強制ON）' : '（APIキー未設定）',
        ' — モックデータで全フローを確認できます。実際の文字起こしには ',
        h('a', { href: '#/settings' }, '設定'), ' でAPIキーを入力してください。'));
    } else {
      b.hidden = true;
    }
  }

  /* ================= 入力画面 ================= */
  function setStep(n) {
    document.querySelectorAll('.steps li').forEach((li, i) => li.classList.toggle('on', i === n));
  }

  function resetInput() {
    if (state.objUrl) { URL.revokeObjectURL(state.objUrl); state.objUrl = null; }
    state.file = null; state.sample = false; state.check = null;
    $('#check-card').hidden = true; $('#run-card').hidden = true;
    $('#file-info').textContent = '';
    $('#file').value = '';
    $('#player').hidden = true;
    $('#force').checked = false;
    $('#progress').hidden = true; $('#run-error').hidden = true;
    setStep(0);
  }

  function isAudio(f) {
    return /^audio\//.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|flac|aiff?|webm|mp4)$/i.test(f.name);
  }

  async function onFile(file) {
    resetInput();
    if (!file) return;
    if (!isAudio(file)) { toast('音声ファイルを選択してください', 'err'); return; }
    if (file.size > MAX_BYTES) {
      toast(`ファイルが大きすぎます（${MP.fmtSize(file.size)} / 上限 ${MP.fmtSize(MAX_BYTES)}）`, 'err');
      return;
    }
    state.file = file;
    $('#file-info').textContent = `${file.name}（${MP.fmtSize(file.size)}）を解析中…`;
    $('#check-card').hidden = false;
    state.objUrl = URL.createObjectURL(file);
    const p = $('#player'); p.src = state.objUrl; p.hidden = false;
    const check = await MP.audio.analyze(file);
    if (state.file !== file) return; // 解析中に別ファイルが選ばれた
    state.check = check;
    $('#file-info').textContent = `${file.name}（${MP.fmtSize(file.size)}）`;
    showCheck();
  }

  function onSample() {
    resetInput();
    state.sample = true;
    state.check = MP.mock.fakeCheck();
    $('#check-card').hidden = false;
    $('#file-info').textContent = 'サンプル音声（デモ）';
    showCheck();
  }

  const LEVEL_LABEL = {
    ok: ['ok', '✔ 音量OK'], warn: ['warn', '⚠ 注意：音量/品質に懸念あり'],
    bad: ['bad', '✖ 問題あり：このまま送ると聞き取れない可能性が高い'], unknown: ['warn', '？ 音量を確認できませんでした'],
  };

  function showCheck() {
    const c = state.check;
    const [cls, label] = LEVEL_LABEL[c.level];
    clear($('#check-badge')).append(h('span', { class: 'badge ' + cls }, label));
    const f = (v, u) => (v == null ? '—' : v.toFixed(1) + u);
    clear($('#check-metrics')).append(
      ...[['長さ', c.duration ? MP.fmtTime(c.duration) : '—'], ['平均音量(有音部)', f(c.rmsDb, ' dBFS')],
        ['ピーク', f(c.peakDb, ' dBFS')], ['無音の割合', c.silenceRatio == null ? '—' : (c.silenceRatio * 100).toFixed(0) + '%']]
        .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))));
    clear($('#check-msgs')).append(...c.messages.map((m) => h('li', null, m)));
    const cv = $('#wave');
    cv.hidden = !c.peaks.length;
    if (c.peaks.length) requestAnimationFrame(() => MP.audio.drawWave(cv, c.peaks, c.level));
    $('#force-row').hidden = c.level !== 'bad';
    $('#force').checked = false;
    $('#run-card').hidden = false;
    setStep(2);
    updateRunBtn();
  }

  function updateRunBtn() {
    const needForce = state.check && state.check.level === 'bad';
    $('#btn-run').disabled = state.running || !(state.file || state.sample) || (needForce && !$('#force').checked);
  }

  async function onRun() {
    const s = MP.store.getSettings();
    const demo = MP.store.isDemo(s);
    const errBox = $('#run-error'); errBox.hidden = true;
    const prog = $('#progress'); prog.hidden = false;
    const say = (t) => { prog.textContent = t; };
    state.running = true; updateRunBtn();
    $('#btn-cancel').hidden = false;
    state.ctrl = new AbortController();
    try {
      let content;
      const model = MP.store.effectiveModel(s);
      if (demo) {
        for (const step of ['（デモ）音声を取り込み中…', '（デモ）文字起こし中…', '（デモ）整文中…', '（デモ）要約・決定事項/ToDoを抽出中…']) {
          say(step);
          await new Promise((r, j) => { const t = setTimeout(r, 450); state.ctrl.signal.addEventListener('abort', () => { clearTimeout(t); j(new Error('キャンセルしました。')); }); });
        }
        content = MP.mock.make();
      } else {
        if (!state.file) throw new Error('サンプルは実APIでは使えません。ファイルを選択してください。');
        content = await MP.gemini.run({
          file: state.file, apiKey: s.apiKey.trim(), model,
          glossary: $('#glossary').value.trim(), speakerHint: $('#spk-hint').value.trim(),
          signal: state.ctrl.signal, onStatus: say,
        });
      }
      const rec = Object.assign({
        id: MP.uid(), createdAt: Date.now(),
        fileName: state.file ? state.file.name : 'サンプル音声（デモ）.mp3',
        size: state.file ? state.file.size : 0,
        duration: state.check ? state.check.duration : 0,
        model: demo ? 'demo' : model, demo,
        audioLevel: state.check ? state.check.level : 'unknown',
        audioRmsDb: state.check ? state.check.rmsDb : null,
      }, content);
      if (!MP.store.saveRecord(rec)) throw new Error('結果の保存に失敗しました（容量超過）。履歴を整理してください。');
      setStep(3);
      location.hash = '#/result/' + rec.id;
    } catch (e) {
      errBox.hidden = false; errBox.textContent = e.message || String(e);
    } finally {
      state.running = false; state.ctrl = null;
      prog.hidden = true; $('#btn-cancel').hidden = true; updateRunBtn();
    }
  }

  function initApp() {
    const drop = $('#drop');
    $('#file').addEventListener('change', (e) => onFile(e.target.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => onFile(e.dataTransfer.files[0]));
    $('#btn-sample').addEventListener('click', onSample);
    $('#force').addEventListener('change', updateRunBtn);
    $('#btn-run').addEventListener('click', onRun);
    $('#btn-cancel').addEventListener('click', () => state.ctrl && state.ctrl.abort());
  }

  /* ================= 結果画面 ================= */
  let cur = null;       // 表示中のレコード
  let curTab = 'transcript';

  const spName = (id) => cur.speakers[id] || `話者${id}`;
  const persist = () => MP.store.saveRecord(cur);

  function renderResult(id) {
    const prevId = cur && cur.id;
    cur = MP.store.getRecord(id);
    if (!cur) { toast('履歴が見つかりません', 'err'); return false; }
    if (cur.id !== prevId) curTab = 'transcript';
    // 旧データ保護
    cur.todos.forEach((t) => { if (t.done == null) t.done = false; });
    buildResult();
    return true;
  }

  function buildResult() {
    const root = clear($('#result-root'));
    const unc = cur.transcript.filter((s) => s.uncertain).length;
    const warns = [];
    if (unc) warns.push(`聞き取れなかった／自信のない発言が ${unc} 件あります（「要確認」表示）。原音で確認してください。`);
    if (cur.audioLevel === 'bad') warns.push('送信前の音量チェックで「問題あり」と判定された音声です。内容に誤りが含まれている可能性があります。');
    if (cur.audioLevel === 'bad' && !cur.demo && cur.transcript.length > 3 && unc === 0) warns.push('音量が極めて小さい音声なのに聞き取れなかった箇所がありません。推測で補われていないか、特に注意して確認してください。');
    if (cur.demo) warns.push('デモモードのモックデータです。実際の音声は処理されていません。');

    root.append(
      h('h1', null, '結果'),
      h('p', { class: 'muted' }, `${cur.fileName} ・ ${MP.fmtDate(cur.createdAt)} ・ ${cur.demo ? 'デモ' : cur.model}`,
        cur.duration ? ` ・ ${MP.fmtTime(cur.duration)}` : ''),
      ...warns.map((w) => h('p', { class: 'notice' }, '⚠ ' + w)),
      cur.audio_notes ? h('p', { class: 'muted small' }, 'AIの所見: ' + cur.audio_notes) : null,
      speakerPanel(),
      h('div', { class: 'tabs', role: 'tablist' },
        ...MP.exporter.SECTIONS.map((s, i) => h('button', {
          type: 'button', role: 'tab', class: 'tab' + (s.key === curTab ? ' on' : ''), 'aria-selected': String(s.key === curTab),
          onclick: () => { curTab = s.key; buildResult(); },
        }, `${'①②③④'[i]} ${s.title}`))),
      h('div', { class: 'card', role: 'tabpanel' }, tabBody()),
      h('div', { class: 'row actions' },
        h('button', { type: 'button', class: 'btn', onclick: () => MP.exporter.copy(MP.exporter.sectionText(cur, curTab, 'txt')) }, 'このタブをコピー'),
        h('button', { type: 'button', class: 'btn', onclick: () => MP.exporter.copy(MP.exporter.toText(cur)) }, '全体をコピー'),
        h('button', { type: 'button', class: 'btn', onclick: () => MP.exporter.download(MP.exporter.toText(cur), MP.exporter.baseName(cur) + '.txt', 'text/plain') }, 'TXTでダウンロード'),
        h('button', { type: 'button', class: 'btn', onclick: () => MP.exporter.download(MP.exporter.toMarkdown(cur), MP.exporter.baseName(cur) + '.md', 'text/markdown') }, 'Markdownでダウンロード'),
        h('a', { class: 'btn ghost', href: '#/app' }, '新しい音声を処理')));
  }

  /* --- 話者パネル（ラベル名の変更・話者追加） --- */
  function speakerPanel() {
    const ids = Object.keys(cur.speakers);
    const count = (id) => cur.transcript.filter((s) => s.spk === id).length;
    return h('div', { class: 'card' },
      h('h2', null, '話者ラベル'),
      h('p', { class: 'muted small' }, '名前を書き換えると、全タブ・コピー・ダウンロードに反映されます。各発言の話者は、下の一覧のプルダウンで個別に付け替えられます。'),
      h('div', { class: 'spk-list' }, ...ids.map((id) => h('label', { class: 'spk' },
        h('span', { class: 'chip c' + (id.charCodeAt(0) % 6) }, id),
        h('input', {
          type: 'text', value: cur.speakers[id], maxlength: '30', 'aria-label': `話者${id}の表示名`,
          onchange: (e) => renameSpeaker(id, e.target.value),
        }),
        h('span', { class: 'muted small' }, `${count(id)}件`)))),
      h('button', { type: 'button', class: 'btn ghost small-btn', onclick: addSpeaker }, '＋話者を追加'));
  }

  function renameSpeaker(id, val) {
    const next = val.trim() || `話者${id}`;
    const prev = cur.speakers[id];
    cur.speakers[id] = next;
    cur.todos.forEach((t) => { if (t.owner === prev) t.owner = next; }); // 担当者表記も追従
    persist(); buildResult();
  }

  function addSpeaker() {
    for (let c = 65; c <= 90; c++) {
      const id = String.fromCharCode(c);
      if (!cur.speakers[id]) { cur.speakers[id] = `話者${id}`; persist(); buildResult(); return; }
    }
    toast('これ以上追加できません', 'err');
  }

  function spkSelect(seg) {
    const sel = h('select', { class: 'spk-sel c' + (seg.spk.charCodeAt(0) % 6), 'aria-label': '話者を付け替え' },
      ...Object.keys(cur.speakers).map((id) => h('option', { value: id }, spName(id))));
    sel.value = seg.spk;
    sel.addEventListener('change', () => { seg.spk = sel.value; persist(); buildResult(); });
    return sel;
  }

  /* --- 各タブ --- */
  function tabBody() {
    if (curTab === 'transcript') {
      return h('ul', { class: 'segs' }, ...cur.transcript.map((s) => h('li', { class: s.uncertain ? 'unc' : '' },
        h('span', { class: 'time' }, s.start || '—'), spkSelect(s),
        h('span', { class: 'txt' }, s.text, s.uncertain ? h('em', { class: 'flag' }, '要確認') : null))));
    }
    if (curTab === 'polished') {
      if (!cur.polished.length) return h('p', { class: 'muted' }, '（整文結果はありません）');
      return h('ul', { class: 'segs' }, ...cur.polished.map((s) => h('li', { class: s.text.includes(MP.UNINTELLIGIBLE) ? 'unc' : '' },
        h('span', { class: 'time' }, ''), spkSelect(s), h('span', { class: 'txt' }, s.text))));
    }
    if (curTab === 'summary') {
      return h('div', null, editList(cur.summary, '要約'),
        h('p', { class: 'muted small' }, '各項目は直接編集できます（変更は自動で履歴に保存されます）。'));
    }
    // actions
    return h('div', null,
      h('h3', null, '決定事項'),
      editList(cur.decisions, '決定事項'),
      h('h3', null, 'ToDo'),
      cur.todos.length ? todoTable() : h('p', { class: 'muted' }, '（ToDoは検出されませんでした）'),
      h('p', { class: 'muted small' }, '担当・期限は、発話で明示されていない場合「不明」となります。ここで編集できます。'));
  }

  /* 配列(文字列)を直接編集できるリスト。変更は即時に履歴へ保存 */
  function editList(arr, label) {
    const fit = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    const box = h('div', { class: 'edit-list' });
    if (!arr.length) box.append(h('p', { class: 'muted' }, `（${label}はありません。追加できます）`));
    arr.forEach((text, i) => {
      const ta = h('textarea', { rows: '1', 'aria-label': `${label} ${i + 1}`, class: 'edit-item' });
      ta.value = text;
      ta.addEventListener('input', () => { arr[i] = ta.value; fit(ta); persist(); });
      ta.addEventListener('blur', () => { if (!ta.value.trim()) { arr.splice(i, 1); persist(); buildResult(); } });
      box.append(h('div', { class: 'edit-row' }, h('span', { 'aria-hidden': 'true' }, '・'), ta,
        h('button', { type: 'button', class: 'btn ghost small-btn', 'aria-label': `${label} ${i + 1} を削除`,
          onclick: () => { arr.splice(i, 1); persist(); buildResult(); } }, '削除')));
      requestAnimationFrame(() => fit(ta));
    });
    box.append(h('button', { type: 'button', class: 'btn ghost small-btn', onclick: () => { arr.push(''); buildResult(); const t = document.querySelectorAll('.edit-item'); if (t.length) t[t.length - 1].focus(); } }, `＋${label}を追加`));
    return box;
  }

  function todoTable() {
    const inp = (t, key, label) => h('input', {
      type: 'text', value: t[key], 'aria-label': label,
      onchange: (e) => { t[key] = e.target.value; persist(); },
    });
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, ...['完了', 'タスク', '担当', '期限'].map((c) => h('th', null, c)))),
      h('tbody', null, ...cur.todos.map((t) => h('tr', null,
        h('td', null, h('input', { type: 'checkbox', checked: !!t.done, 'aria-label': '完了', onchange: (e) => { t.done = e.target.checked; persist(); } })),
        h('td', null, inp(t, 'task', 'タスク')), h('td', null, inp(t, 'owner', '担当')), h('td', null, inp(t, 'due', '期限')))))));
  }

  /* ================= 履歴 ================= */
  function haystack(r) {
    return [r.fileName, ...Object.values(r.speakers), ...r.transcript.map((s) => s.text), ...r.polished.map((s) => s.text),
      ...r.summary, ...r.decisions, ...r.todos.map((t) => `${t.task} ${t.owner}`)].join('\n');
  }

  function renderHistory() {
    const q = $('#hist-q').value.trim().toLowerCase();
    const all = MP.store.listHistory();
    const list = q ? all.filter((r) => haystack(r).toLowerCase().includes(q)) : all;
    $('#hist-count').textContent = all.length ? `${list.length} / ${all.length} 件` : '';
    const ul = clear($('#hist-list'));
    if (!list.length) {
      ul.append(h('li', { class: 'empty' }, all.length ? '一致する履歴がありません。' : 'まだ履歴がありません。',
        all.length ? null : h('a', { href: '#/app' }, ' 文字起こしを始める')));
      return;
    }
    list.forEach((r) => {
      let snip = r.summary[0] || (r.transcript[0] && r.transcript[0].text) || '';
      if (q) {
        const hs = haystack(r), i = hs.toLowerCase().indexOf(q);
        if (i >= 0) snip = '…' + hs.slice(Math.max(0, i - 25), i + q.length + 45).replace(/\n/g, ' ') + '…';
      }
      ul.append(h('li', { class: 'hist-item' },
        h('div', { class: 'hist-main' },
          h('a', { href: '#/result/' + r.id, class: 'hist-title' }, r.fileName),
          h('span', { class: 'muted small' }, ` ${MP.fmtDate(r.createdAt)} ・ ${r.demo ? 'デモ' : r.model}`),
          r.demo ? h('span', { class: 'badge warn' }, 'DEMO') : null,
          h('p', { class: 'snip' }, snip.slice(0, 120))),
        h('div', { class: 'row' },
          h('a', { class: 'btn ghost', href: '#/result/' + r.id }, '開く'),
          h('button', { type: 'button', class: 'btn danger ghost', onclick: () => {
            if (confirm(`「${r.fileName}」を削除しますか？`)) { MP.store.deleteRecord(r.id); renderHistory(); }
          } }, '削除'))));
    });
  }

  function initHistory() {
    $('#hist-q').addEventListener('input', renderHistory);
    $('#hist-clear').addEventListener('click', () => {
      if (MP.store.listHistory().length && confirm('履歴をすべて削除します。よろしいですか？')) { MP.store.clearHistory(); renderHistory(); }
    });
  }

  /* ================= 設定 ================= */
  function loadSettingsForm() {
    const s = MP.store.getSettings();
    $('#set-key').value = s.apiKey;
    $('#set-model').value = s.model;
    $('#set-custom').value = s.customModel;
    $('#set-demo').checked = s.forceDemo;
    $('#set-custom-row').hidden = s.model !== '__custom';
    $('#set-model-note').hidden = s.model !== 'gemini-3.5-flash';
  }

  function initSettings() {
    $('#set-model').addEventListener('change', (e) => {
      $('#set-custom-row').hidden = e.target.value !== '__custom';
      $('#set-model-note').hidden = e.target.value !== 'gemini-3.5-flash';
    });
    $('#set-key-toggle').addEventListener('click', (e) => {
      const k = $('#set-key'); const show = k.type === 'password';
      k.type = show ? 'text' : 'password'; e.target.textContent = show ? '隠す' : '表示';
    });
    $('#set-save').addEventListener('click', () => {
      const s = {
        apiKey: $('#set-key').value.trim(), model: $('#set-model').value,
        customModel: $('#set-custom').value.trim(), forceDemo: $('#set-demo').checked,
      };
      if (s.model === '__custom' && !s.customModel) { toast('カスタムモデルIDを入力してください', 'err'); return; }
      if (MP.store.saveSettings(s)) { toast('設定を保存しました'); renderBanner(); }
    });
    $('#set-keydel').addEventListener('click', () => {
      const s = MP.store.getSettings(); s.apiKey = ''; MP.store.saveSettings(s);
      $('#set-key').value = ''; toast('APIキーを削除しました'); renderBanner();
    });
    $('#set-wipe').addEventListener('click', () => {
      if (confirm('履歴と設定（APIキー含む）をすべて削除します。よろしいですか？')) {
        MP.store.clearAll(); loadSettingsForm(); renderBanner(); toast('削除しました');
      }
    });
  }

  /* ================= 料金（ダミー） ================= */
  function initPricing() {
    document.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () =>
      toast(`${b.dataset.plan}：ダミー表示です。決済は未実装で、請求は発生しません。`)));
  }

  /* ================= 起動 ================= */
  initApp(); initHistory(); initSettings(); initPricing();
  window.addEventListener('hashchange', route);
  route();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* PWAは任意機能 */ });
  }
})();
