/* Gemini API 呼び出し（ブラウザから直接。キーはx-goog-api-keyヘッダで送り、URLには載せない） */
(function (g) {
  const MP = g.MP;
  const U = MP.UNINTELLIGIBLE;
  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const MAX_INLINE_BYTES = 14 * 1024 * 1024; // inline_data は base64化で約1.33倍。リクエスト上限(約20MB)を考慮
  const API = 'https://generativelanguage.googleapis.com/';
  const FILES_MAX_BYTES = 200 * 1024 * 1024;  // 本アプリの上限（ブラウザのメモリ・待ち時間を考慮した保守的な値）
  const GEN_TIMEOUT_MS = { inline: 5 * 60 * 1000, files: 10 * 60 * 1000 };
  const POLL_MS = 2000;
  const ACTIVE_TIMEOUT_MS = 10 * 60 * 1000;

  /* ---- 捏造対策を中心にしたシステムプロンプト ---- */
  const SYSTEM = `あなたは正確性を最優先する日本語の文字起こしアシスタントです。以下のルールは絶対です。

【最重要：推測で埋めない】
1. 実際に音声から聞き取れた内容だけを書く。聞こえていない言葉・人名・数字・日付・固有名詞を推測や一般知識で補ってはならない。
2. 聞き取れない、声が小さい、雑音で判別できない、自信が持てない箇所は、推測せず、その部分の text を正確に「${U}」とする。部分的に聞き取れない場合は、その部分だけを「${U}」に置き換える。
3. 「${U}」を含む発言、または聞き取りに自信がない発言は uncertain を true にする。
4. 音声全体にほぼ音声が無い、または全く聞き取れない場合は、transcript を「${U}」1件のみとし、polished・summary・decisions・todos は空配列にし、audio_notes にその旨を書く。内容を創作してはならない。
5. ユーザーが「用語ヒント」を提示しても、それは表記ゆれ修正の参考にすぎない。音声で発話されていない語を出力に含めてはならない。

【出力の各部】
- transcript（文字起こし全文）: 発話をできるだけそのまま。フィラー（えー、あの）や言い直しも残す。話者ごとに区切り、話者は "A","B","C" のように英大文字1字で一貫して表す。start は発話開始時刻 "mm:ss"（不明なら "00:00" ではなく空文字）。
- polished（整文）: transcript の各発言について、フィラー除去・句読点付与・言い直し整理のみ行う。事実・数値・固有名詞・意味を変えず、新しい情報を足さない。「${U}」はそのまま残す。
- summary（要約）: 音声で述べられた内容のみから、3〜7個の箇条書き。聞き取れなかった部分について結論を作らない。
- decisions（決定事項）: 発話で明確に「決まった」と読み取れるものだけ。無ければ空配列。
- todos（ToDo）: 明確に依頼・約束された作業のみ。owner（担当者）と due（期限）は発話で明示されている場合だけ記載し、不明なら「不明」とする。無ければ空配列。
- audio_notes: 音質・聞き取れなかった箇所の所見を1〜2文。問題が無ければ空文字。

出力は指定のJSONスキーマのみ。前置きや説明文は一切含めない。`;

  const SCHEMA = {
    type: 'OBJECT',
    properties: {
      transcript: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        speaker: { type: 'STRING' }, start: { type: 'STRING' }, text: { type: 'STRING' }, uncertain: { type: 'BOOLEAN' } },
        required: ['speaker', 'start', 'text', 'uncertain'] } },
      polished: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        speaker: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['speaker', 'text'] } },
      summary: { type: 'ARRAY', items: { type: 'STRING' } },
      decisions: { type: 'ARRAY', items: { type: 'STRING' } },
      todos: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
        task: { type: 'STRING' }, owner: { type: 'STRING' }, due: { type: 'STRING' } },
        required: ['task', 'owner', 'due'] } },
      audio_notes: { type: 'STRING' },
    },
    required: ['transcript', 'polished', 'summary', 'decisions', 'todos', 'audio_notes'],
  };

  const MIME_BY_EXT = {
    mp3: 'audio/mp3', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
    aiff: 'audio/aiff', aif: 'audio/aiff', m4a: 'audio/mp4', mp4: 'audio/mp4', webm: 'audio/webm',
  };

  function mimeOf(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return MIME_BY_EXT[ext] || file.type || 'audio/mpeg';
  }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('ファイルの読み込みに失敗しました。'));
      r.readAsDataURL(file);
    });
  }

  function userPrompt(opts) {
    let p = '添付の音声を、システム指示に従って処理してください。';
    if (opts.speakerHint) p += `\n話者数の目安: ${opts.speakerHint}人（目安であり、実際に聞き分けられる範囲で区別すること）。`;
    if (opts.glossary) p += `\n用語ヒント（表記の参考のみ。発話されていなければ出力しない）:\n${opts.glossary}`;
    return p;
  }

  function httpMessage(status, body) {
    const detail = (body && body.error && body.error.message) ? ` 詳細: ${body.error.message}` : '';
    if (status === 400) return 'リクエストが不正です（APIキー不正・モデル名不正・形式未対応の可能性）。' + detail;
    if (status === 401 || status === 403) return 'APIキーが無効、または権限がありません。設定を確認してください。' + detail;
    if (status === 404) return 'モデルが見つかりません（HTTP 404）。モデルIDが存在しない可能性があります。設定のカスタムモデル欄で別のモデルIDを試せます。' + detail;
    if (status === 413) return 'ファイルが大きすぎます。';
    if (status === 429) return 'リクエスト上限（レート/クォータ）に達しました。しばらく待って再試行してください。' + detail;
    if (status >= 500) return 'Gemini API側のエラーです。時間をおいて再試行してください。' + detail;
    return `APIエラー (HTTP ${status})。` + detail;
  }

  /** speaker文字列を A,B,C… に正規化。戻り値は {id(raw)->id} を作る関数 */
  function speakerMapper() {
    const map = new Map();
    return (raw) => {
      const key = String(raw == null ? '' : raw).trim();
      if (/^[A-Z]$/.test(key)) { map.set(key, key); return key; }
      if (!map.has(key)) {
        const used = new Set(map.values());
        let c = 65; while (used.has(String.fromCharCode(c))) c++;
        map.set(key, String.fromCharCode(Math.min(c, 90)));
      }
      return map.get(key);
    };
  }

  /** モデル応答を検証・正規化して内部形式にする */
  function normalize(obj) {
    const sp = speakerMapper();
    const str = (v) => (typeof v === 'string' ? v : '');
    const arr = (v) => (Array.isArray(v) ? v : []);
    const transcript = arr(obj.transcript).map((s) => ({
      spk: sp(s.speaker), start: str(s.start), text: str(s.text) || U,
      uncertain: !!s.uncertain || str(s.text).includes(U) || !str(s.text).trim(),
    }));
    if (!transcript.length) throw new Error('文字起こし結果が空でした。音声に発話が無い可能性があります。');
    const polished = arr(obj.polished).map((s) => ({ spk: sp(s.speaker), text: str(s.text) }));
    const speakers = {};
    [...transcript, ...polished].forEach((s) => { speakers[s.spk] = speakers[s.spk] || `話者${s.spk}`; });
    return {
      speakers, transcript, polished,
      summary: arr(obj.summary).map(str).filter(Boolean),
      decisions: arr(obj.decisions).map(str).filter(Boolean),
      todos: arr(obj.todos).map((t) => ({ task: str(t.task), owner: str(t.owner) || '不明', due: str(t.due) || '不明' })).filter((t) => t.task),
      audio_notes: str(obj.audio_notes),
    };
  }

  function parseJson(text) {
    const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(t); }
    catch (e) { throw new Error('モデルの応答をJSONとして解釈できませんでした。再実行してください。'); }
  }

  const cancelErr = () => Object.assign(new Error('キャンセルしました。'), { name: 'AbortError' });
  const cleanModel = (m) => String(m || '').trim().replace(/^models\//, '');

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(cancelErr());
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(cancelErr()); }, { once: true });
    });
  }

  /** fetch ラッパー。中断・ネットワークエラーを利用者向けメッセージに変換 */
  async function call(url, init, signal) {
    try { return await fetch(url, Object.assign({}, init, { signal })); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('ネットワークエラー。接続を確認してください（ブラウザのCORS制限等で通信が遮断された可能性もあります）。');
    }
  }
  async function readJson(res) { try { return await res.json(); } catch (e) { return null; } }

  /* ---- Files API: ① 開始 → ② アップロード → ③ ACTIVE待ち → ④ fileData参照 → 後始末 ---- */
  async function startUpload(file, mime, apiKey, signal) {
    const res = await call(API + 'upload/v1beta/files', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey, 'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.size), 'X-Goog-Upload-Header-Content-Type': mime,
      },
      body: JSON.stringify({ file: { display_name: 'mojiokoshi-audio' } }), // 元のファイル名は送らない
    }, signal);
    if (!res.ok) throw new Error('アップロードの開始に失敗しました。' + httpMessage(res.status, await readJson(res)));
    const url = res.headers.get('x-goog-upload-url');
    if (!url) throw new Error('アップロード先URLを取得できませんでした（ブラウザからのFiles API利用がCORS等で制限されている可能性があります）。');
    return url;
  }

  function uploadBytes(url, file, signal, onProgress) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(cancelErr());
      const x = new XMLHttpRequest();
      x.open('POST', url);
      x.setRequestHeader('X-Goog-Upload-Offset', '0');
      x.setRequestHeader('X-Goog-Upload-Command', 'upload, finalize');
      x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      x.onload = () => {
        let j = null; try { j = JSON.parse(x.responseText); } catch (e) { /* ignore */ }
        if (x.status >= 200 && x.status < 300 && j) resolve(j.file || j);
        else reject(new Error('アップロードに失敗しました。' + httpMessage(x.status, j)));
      };
      x.onerror = () => reject(new Error('アップロード中にネットワークエラーが発生しました。通信状況を確認して再試行してください。'));
      x.ontimeout = () => reject(new Error('アップロードがタイムアウトしました。'));
      if (signal) signal.addEventListener('abort', () => { x.abort(); reject(cancelErr()); }, { once: true });
      x.send(file);
    });
  }

  async function waitActive(f, apiKey, signal, onStatus) {
    const t0 = Date.now();
    for (;;) {
      const st = f.state || 'ACTIVE'; // state が返らない場合はACTIVE扱い
      if (st === 'ACTIVE') return f;
      if (st === 'FAILED') {
        throw new Error('Google側でのファイル処理に失敗しました' + (f.error && f.error.message ? `（${f.error.message}）` : '') + '。音声の形式が未対応・破損の可能性があります。');
      }
      const sec = Math.round((Date.now() - t0) / 1000);
      if (Date.now() - t0 > ACTIVE_TIMEOUT_MS) throw new Error(`ファイルの処理待ちがタイムアウトしました（${Math.round(ACTIVE_TIMEOUT_MS / 60000)}分）。時間をおいて再試行してください。`);
      onStatus({ text: `Google側でファイルを処理中…（${sec}秒経過 / 状態: ${st}）`, pct: null, stage: 'processing' });
      await sleep(POLL_MS, signal);
      const res = await call(`${API}v1beta/${f.name}`, { headers: { 'x-goog-api-key': apiKey } }, signal);
      const j = await readJson(res);
      if (!res.ok) throw new Error('ファイル状態の確認に失敗しました。' + httpMessage(res.status, j));
      f = j;
    }
  }

  async function deleteFile(name, apiKey) { // 後始末（失敗しても無視。未削除でも自動期限切れになる想定）
    try { await fetch(`${API}v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } }); } catch (e) { /* ignore */ }
  }

  MP.gemini = {
    SYSTEM, SCHEMA, MAX_INLINE_BYTES, FILES_MAX_BYTES, normalize, mimeOf, cleanModel,

    /** 送信方式の判定: 'inline'（<=14MB） | 'files'（<=200MB） | 'too_large' */
    route(size) { return size <= MAX_INLINE_BYTES ? 'inline' : size <= FILES_MAX_BYTES ? 'files' : 'too_large'; },

    /** 実API呼び出し。opts: {file, apiKey, model, glossary, speakerHint, signal, onStatus({text,pct,stage}|string)} */
    async run(opts) {
      const say = (o) => { if (opts.onStatus) opts.onStatus(typeof o === 'string' ? { text: o, pct: null } : o); };
      const mode = this.route(opts.file.size);
      if (mode === 'too_large') throw new Error(`ファイルが大きすぎます（${MP.fmtSize(opts.file.size)} / 上限 ${MP.fmtSize(FILES_MAX_BYTES)}）。`);
      const mime = mimeOf(opts.file);
      const model = cleanModel(opts.model);
      let uploaded = null, audioPart;
      try {
        if (mode === 'inline') {
          say('音声を読み込み中…');
          audioPart = { inlineData: { mimeType: mime, data: await toBase64(opts.file) } };
        } else {
          say({ text: 'Files API: アップロードを開始しています…', pct: 0, stage: 'upload' });
          const url = await startUpload(opts.file, mime, opts.apiKey, opts.signal);
          const f0 = await uploadBytes(url, opts.file, opts.signal, (r) =>
            say({ text: `Files API: アップロード中… ${Math.round(r * 100)}%（${MP.fmtSize(opts.file.size * r)} / ${MP.fmtSize(opts.file.size)}）`, pct: r, stage: 'upload' }));
          uploaded = f0.name;
          const f = await waitActive(f0, opts.apiKey, opts.signal, say);
          audioPart = { fileData: { mimeType: f.mimeType || mime, fileUri: f.uri } };
        }

        const body = {
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [audioPart, { text: userPrompt(opts) }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
        };
        const ctrl = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, GEN_TIMEOUT_MS[mode]);
        if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
        say({ text: 'Gemini で文字起こし・整文・要約を生成中…（長い音声では数分かかります）', pct: null, stage: 'generate' });
        let res;
        try {
          res = await call(`${ENDPOINT}${encodeURIComponent(model)}:generateContent`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey }, body: JSON.stringify(body),
          }, ctrl.signal);
        } catch (e) {
          if (e.name === 'AbortError') throw timedOut ? new Error(`生成がタイムアウトしました（${GEN_TIMEOUT_MS[mode] / 60000}分）。`) : e;
          throw e;
        } finally { clearTimeout(timer); }

        const json = await readJson(res);
        if (!res.ok) throw new Error(httpMessage(res.status, json));
        if (json && json.promptFeedback && json.promptFeedback.blockReason) {
          throw new Error('安全性フィルタによりブロックされました: ' + json.promptFeedback.blockReason);
        }
        const cand = json && json.candidates && json.candidates[0];
        const parts = (cand && cand.content && cand.content.parts) || [];
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
        if (!text) throw new Error('応答が空でした' + (cand && cand.finishReason ? `（finishReason: ${cand.finishReason}）` : '') + '。');
        const result = normalize(parseJson(text));
        if (cand && cand.finishReason && cand.finishReason !== 'STOP') {
          result.audio_notes = (result.audio_notes ? result.audio_notes + ' ' : '') + `※出力が途中で終了した可能性があります（${cand.finishReason}）。`;
        }
        result.sendMode = mode;
        return result;
      } finally {
        if (uploaded) deleteFile(uploaded, opts.apiKey);
      }
    },

    /** 接続テスト: models.get でキーの有効性とモデルの存在を確認（生成は行わない＝課金対象の推論なし）。
     *  戻り値 {ok, summary, detail}。音声入力に対応するかまでは確認できない。 */
    async testConnection(opts) {
      const model = cleanModel(opts.model);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let res;
      try {
        res = await fetch(`${ENDPOINT}${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': opts.apiKey }, signal: ctrl.signal });
      } catch (e) {
        return { ok: false, summary: e.name === 'AbortError' ? 'タイムアウトしました（15秒）' : '通信に失敗しました',
          detail: 'ネットワーク接続を確認してください（ブラウザのCORS制限や、拡張機能・社内プロキシによる遮断の可能性もあります）。' };
      } finally { clearTimeout(timer); }
      const j = await readJson(res);
      const msg = (j && j.error && j.error.message) || '';
      if (res.ok) {
        const methods = Array.isArray(j.supportedGenerationMethods) ? j.supportedGenerationMethods : null;
        if (methods && !methods.includes('generateContent')) {
          return { ok: false, summary: 'モデルは存在しますが、文字起こしに使えません', detail: `モデル ${model} は generateContent に対応していません（対応: ${methods.join(', ')}）。別のモデルIDを選んでください。` };
        }
        const info = [j.displayName, j.inputTokenLimit ? `入力上限 ${j.inputTokenLimit.toLocaleString()} トークン` : ''].filter(Boolean).join(' / ');
        return { ok: true, summary: 'APIキーは有効で、モデルが存在します', detail: `モデル: ${model}${info ? '（' + info + '）' : ''}` };
      }
      const keyBad = /API key|API_KEY/i.test(msg) || (res.status === 400 && /key/i.test(msg));
      if (keyBad || res.status === 401) return { ok: false, summary: 'APIキーが無効です', detail: 'キーの入力ミス・失効・コピー漏れがないか確認してください。' + (msg ? ` 詳細: ${msg}` : '') };
      if (res.status === 403) return { ok: false, summary: 'このキーには権限がありません', detail: 'Generative Language API が有効なプロジェクトのキーか、キーの利用制限（リファラ/IP等）を確認してください。' + (msg ? ` 詳細: ${msg}` : '') };
      if (res.status === 404) return { ok: false, summary: 'モデルが見つかりません（HTTP 404）', detail: `モデルID「${model}」が存在しない可能性があります。「カスタム」欄で別のモデルIDを試せます。` + (msg ? ` 詳細: ${msg}` : '') };
      if (res.status === 429) return { ok: false, summary: 'リクエスト上限に達しています', detail: 'キーとモデルの存在までは確認できませんでした。しばらく待って再試行してください。' + (msg ? ` 詳細: ${msg}` : '') };
      return { ok: false, summary: `接続テストに失敗しました（HTTP ${res.status}）`, detail: msg };
    },
  };
})(window);
