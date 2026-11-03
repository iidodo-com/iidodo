/* Gemini API 呼び出し（ブラウザから直接。キーはx-goog-api-keyヘッダで送り、URLには載せない） */
(function (g) {
  const MP = g.MP;
  const U = MP.UNINTELLIGIBLE;
  const AppError = MP.AppError;
  const API = 'https://generativelanguage.googleapis.com/';
  const ENDPOINT = API + 'v1beta/models/';
  const MAX_INLINE_BYTES = 14 * 1024 * 1024; // inline_data は base64化で約1.33倍。リクエスト上限(20MB)を考慮
  const FILES_MAX_BYTES = 200 * 1024 * 1024; // 本アプリの上限（ブラウザのメモリ・待ち時間を考慮した保守的な値）
  const GEN_TIMEOUT_MS = { inline: 5 * 60 * 1000, files: 10 * 60 * 1000 };
  const POLL_MS = 2000;
  const ACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
  const RETRY_STATUS = [500, 502, 503, 504];
  const RETRY_DELAYS_MS = [3000, 8000];

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

  /* Gemini 公式ドキュメント（音声理解）に記載の対応形式:
   * WAV, MP3, AIFF, AAC, OGG, FLAC, MPEG, M4A, L16, Opus, ALAW, MULAW, WebM */
  const MIME_BY_EXT = {
    mp3: 'audio/mp3', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac',
    aiff: 'audio/aiff', aif: 'audio/aiff', m4a: 'audio/m4a', webm: 'audio/webm', opus: 'audio/opus', mpeg: 'audio/mpeg', mpga: 'audio/mpeg',
  };
  const SUPPORTED_EXT = Object.keys(MIME_BY_EXT);

  const extOf = (file) => (file.name.split('.').pop() || '').toLowerCase();
  function mimeOf(file) { return MIME_BY_EXT[extOf(file)] || file.type || 'audio/mpeg'; }

  function toBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new AppError('ファイルを読み込めませんでした。', 'ファイルが移動・削除されていないか確認し、もう一度選択してください。'));
      r.readAsDataURL(file);
    });
  }

  function userPrompt(opts) {
    let p = '添付の音声を、システム指示に従って処理してください。';
    if (opts.speakerHint) p += `\n話者数の目安: ${opts.speakerHint}人（目安であり、実際に聞き分けられる範囲で区別すること）。`;
    if (opts.glossary) p += `\n用語ヒント（表記の参考のみ。発話されていなければ出力しない）:\n${opts.glossary}`;
    if (opts.maskedSeconds > 0) {
      p += `\nこの音声は、個人情報保護のため利用者が一部の区間（合計${Math.round(opts.maskedSeconds)}秒）を無音化しています。` +
        '無音の区間は意図的な伏せ区間なので、発言として出力せず省略すること。その区間で何が話されていたかを推測して補ってはならない。';
    }
    return p;
  }

  /* ---- エラー分類（すべて「何が起きたか」＋「次の行動」を返す） ---- */
  function httpError(status, body, ctx) {
    const msg = (body && body.error && body.error.message) || '';
    const st = (body && body.error && body.error.status) || '';
    const detail = msg ? `（詳細: ${msg.slice(0, 200)}）` : '';
    let e;
    if (/API key|API_KEY/i.test(msg) || status === 401) {
      e = new AppError('APIキーが無効です。' + detail, '設定画面でキーを確認し（コピー漏れ・余分な空白・失効）、「接続テスト」で有効か確かめてください。', 'key');
    } else if (status === 400 && /location|billing|FAILED_PRECONDITION/i.test(msg + ' ' + st)) {
      e = new AppError('お使いの地域またはアカウント設定では、このAPIを利用できません。' + detail, 'Google AI Studio で利用可否と課金設定を確認してください。', 'region');
    } else if (status === 400) {
      e = new AppError('リクエストが受け付けられませんでした（HTTP 400）。' + detail,
        '音声の形式が正しいか確認し、MP3 または WAV に変換して再試行してください。モデルIDが不正な場合は「接続テスト」で確認できます。', 'bad_request');
    } else if (status === 403) {
      e = new AppError('このAPIキーでは実行できません（HTTP 403）。' + detail,
        'キーの利用制限（リファラ・IP・API制限）と、Generative Language API が有効なプロジェクトのキーかを確認してください。', 'forbidden');
    } else if (status === 404) {
      e = ctx === 'files'
        ? new AppError('アップロードしたファイルが見つかりません（期限切れまたは削除済み）。' + detail, 'もう一度実行してください（再アップロードされます）。', 'file_gone')
        : new AppError('モデルが見つかりません（HTTP 404）。モデルIDが存在しない可能性があります。設定のカスタムモデル欄で別のモデルIDを試せます。' + detail,
          '設定画面の「接続テスト」で、モデルの存在とキーの有効性を確認できます。', 'model');
    } else if (status === 413) {
      e = new AppError('送信するデータが大きすぎます（HTTP 413）。' + detail, '音声を短く分割するか、MP3 など小さい形式に変換して再試行してください。', 'too_large');
    } else if (status === 429) {
      e = new AppError('リクエスト上限（レート/クォータ）に達しました。' + detail,
        '1〜数分待ってから再実行してください。頻繁に出る場合は、Google側の利用枠・課金設定の確認、または別モデル（設定のカスタム欄）をお試しください。', 'quota');
    } else if (status >= 500) {
      e = new AppError(`Google側で一時的なエラーが発生しました（HTTP ${status}）。` + detail,
        '数分待って再実行してください。続く場合は別のモデルIDをお試しください。', 'server');
    } else {
      e = new AppError(`APIエラー（HTTP ${status}）。` + detail, '時間をおいて再試行してください。改善しない場合は、デモモードで画面の動作を確認してください。', 'http');
    }
    return e;
  }
  const withPrefix = (e, prefix) => { e.message = prefix + e.message; return e; };

  const cancelErr = () => Object.assign(new Error('キャンセルしました。'), { name: 'AbortError' });
  const cleanModel = (m) => String(m || '').trim().replace(/^models\//, '');

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(cancelErr());
      const t = setTimeout(resolve, ms);
      if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(cancelErr()); }, { once: true });
    });
  }

  const NET_HINT = 'インターネット接続を確認してください。社内プロキシ・VPN・ブラウザ拡張機能が googleapis.com への通信を遮断していないかも確認し、もう一度実行してください。';
  async function call(url, init, signal) {
    if (g.navigator && g.navigator.onLine === false) {
      throw new AppError('オフラインです。', 'インターネットに接続してから、もう一度実行してください（デモモードならオフラインでも画面を確認できます）。', 'offline');
    }
    try { return await fetch(url, Object.assign({}, init, { signal })); }
    catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new AppError('Google のサーバーに接続できませんでした（ネットワークエラー、またはブラウザのセキュリティ制限）。', NET_HINT, 'network');
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
    if (!res.ok) throw withPrefix(httpError(res.status, await readJson(res), 'upload'), 'アップロードの開始に失敗しました。');
    const url = res.headers.get('x-goog-upload-url');
    if (!url) {
      throw new AppError('アップロード先URLを取得できませんでした（ブラウザからのFiles API利用がCORS等で制限されている可能性があります）。',
        '14MB以下の音声に分割して再試行してください。それでも解決しない場合は、サーバー経由のアップロードが必要です（README参照）。', 'upload_url');
    }
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
        else reject(withPrefix(httpError(x.status, j, 'upload'), 'アップロードに失敗しました。'));
      };
      x.onerror = () => reject(new AppError('アップロード中に通信が途切れました。', NET_HINT, 'network'));
      x.ontimeout = () => reject(new AppError('アップロードがタイムアウトしました。', '回線が安定した環境でもう一度お試しください。ファイルを小さくする（MP3化・分割）と改善する場合があります。', 'timeout'));
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
        throw new AppError('Google側でのファイル処理に失敗しました' + (f.error && f.error.message ? `（${f.error.message}）` : '') + '。',
          '音声の形式が未対応、またはファイルが破損している可能性があります。MP3 または WAV に変換して再試行してください。', 'file_failed');
      }
      if (Date.now() - t0 > ACTIVE_TIMEOUT_MS) {
        throw new AppError(`ファイルの処理待ちがタイムアウトしました（${Math.round(ACTIVE_TIMEOUT_MS / 60000)}分）。`, '時間をおいて再実行してください。長い音声は分割すると改善する場合があります。', 'timeout');
      }
      onStatus({ text: `Google側でファイルを処理中…（${Math.round((Date.now() - t0) / 1000)}秒経過 / 状態: ${st}）`, pct: null, stage: 'processing' });
      await sleep(POLL_MS, signal);
      const res = await call(`${API}v1beta/${f.name}`, { headers: { 'x-goog-api-key': apiKey } }, signal);
      const j = await readJson(res);
      if (!res.ok) throw withPrefix(httpError(res.status, j, 'files'), 'ファイル状態の確認に失敗しました。');
      f = j;
    }
  }

  async function deleteFile(name, apiKey) { // 後始末（失敗しても無視。未削除でも自動期限切れになる想定）
    try { await fetch(`${API}v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': apiKey } }); } catch (e) { /* ignore */ }
  }

  /* ---- 応答の検証・正規化 ---- */
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

  function normalize(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new AppError('モデルの応答の形式が想定と異なりました。', 'もう一度実行してください。続く場合は別のモデルIDをお試しください。', 'shape');
    const sp = speakerMapper();
    const str = (v) => (typeof v === 'string' ? v : '');
    const arr = (v) => (Array.isArray(v) ? v : []);
    const transcript = arr(obj.transcript).filter((s) => s && typeof s === 'object').map((s) => ({
      spk: sp(s.speaker), start: str(s.start), text: str(s.text) || U,
      uncertain: !!s.uncertain || str(s.text).includes(U) || !str(s.text).trim(),
    }));
    if (!transcript.length) {
      throw new AppError('文字起こし結果が空でした。音声に発話が含まれていない可能性があります。',
        '音量チェックの結果と音声の内容を確認し、発話のある音声でもう一度実行してください。');
    }
    const polished = arr(obj.polished).filter((s) => s && typeof s === 'object').map((s) => ({ spk: sp(s.speaker), text: str(s.text) }));
    const speakers = {};
    [...transcript, ...polished].forEach((s) => { speakers[s.spk] = speakers[s.spk] || `話者${s.spk}`; });
    return {
      speakers, transcript, polished,
      summary: arr(obj.summary).map(str).filter(Boolean),
      decisions: arr(obj.decisions).map(str).filter(Boolean),
      todos: arr(obj.todos).filter((t) => t && typeof t === 'object')
        .map((t) => ({ task: str(t.task), owner: str(t.owner) || '不明', due: str(t.due) || '不明' })).filter((t) => t.task),
      audio_notes: str(obj.audio_notes),
    };
  }

  function parseJson(text, finishReason) {
    const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { return JSON.parse(t); }
    catch (e) {
      if (finishReason === 'MAX_TOKENS') {
        throw new AppError('出力が長すぎて、結果が途中で打ち切られました。', '音声を10〜20分程度に分割して、それぞれ処理してください。', 'max_tokens');
      }
      throw new AppError('モデルの応答を解釈できませんでした。', 'もう一度実行してください。続く場合は、音声を分割するか別のモデルIDをお試しください。', 'parse');
    }
  }

  MP.gemini = {
    SYSTEM, SCHEMA, MAX_INLINE_BYTES, FILES_MAX_BYTES, SUPPORTED_EXT, normalize, mimeOf, extOf, cleanModel, userPrompt,
    _timeouts: GEN_TIMEOUT_MS, _retryDelays: RETRY_DELAYS_MS, // テスト用フック（E2Eでタイムアウト/再試行間隔を短縮するため）

    /** 送信方式の判定: 'inline'（<=14MB） | 'files'（<=200MB） | 'too_large' */
    route(size) { return size <= MAX_INLINE_BYTES ? 'inline' : size <= FILES_MAX_BYTES ? 'files' : 'too_large'; },

    /** 実API呼び出し。opts: {file, apiKey, model, glossary, speakerHint, maskedSeconds, signal, onStatus({text,pct,stage}|string)} */
    async run(opts) {
      const say = (o) => { if (opts.onStatus) opts.onStatus(typeof o === 'string' ? { text: o, pct: null } : o); };
      const mode = this.route(opts.file.size);
      if (mode === 'too_large') {
        throw new AppError(`ファイルが大きすぎます（${MP.fmtSize(opts.file.size)} / 上限 ${MP.fmtSize(FILES_MAX_BYTES)}）。`, '音声を分割するか、MP3 など小さい形式に変換してください。', 'too_large');
      }
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

        const body = JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [audioPart, { text: userPrompt(opts) }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
        });
        const timeoutMs = GEN_TIMEOUT_MS[mode];
        let res, json;
        for (let attempt = 0; ; attempt++) {
          const ctrl = new AbortController();
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
          const onAbort = () => ctrl.abort();
          if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
          say({ text: 'Gemini で文字起こし・整文・要約を生成中…（長い音声では数分かかります）', pct: null, stage: 'generate' });
          try {
            res = await call(`${ENDPOINT}${encodeURIComponent(model)}:generateContent`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey }, body,
            }, ctrl.signal);
            json = await readJson(res);
          } catch (e) {
            if (e.name === 'AbortError' && timedOut) {
              throw new AppError(`生成がタイムアウトしました（${timeoutMs / 60000}分）。`, '音声が長い場合は分割して処理してください。通信が不安定でないか確認し、もう一度実行してください。', 'timeout');
            }
            throw e;
          } finally { clearTimeout(timer); if (opts.signal) opts.signal.removeEventListener('abort', onAbort); }
          if (!res.ok && RETRY_STATUS.includes(res.status) && attempt < RETRY_DELAYS_MS.length) {
            const wait = RETRY_DELAYS_MS[attempt];
            say({ text: `Google側の一時的なエラー（HTTP ${res.status}）。${wait / 1000}秒後に自動で再試行します（${attempt + 1}/${RETRY_DELAYS_MS.length}）…`, pct: null, stage: 'retry' });
            await sleep(wait, opts.signal);
            continue;
          }
          break;
        }
        if (!res.ok) throw httpError(res.status, json, 'generate');
        if (json && json.promptFeedback && json.promptFeedback.blockReason) {
          throw new AppError('安全性フィルタにより処理がブロックされました（' + json.promptFeedback.blockReason + '）。',
            '音声の内容を確認してください。別の音声、または区間を分けて再実行すると通る場合があります。', 'blocked');
        }
        const cand = json && json.candidates && json.candidates[0];
        const parts = (cand && cand.content && cand.content.parts) || [];
        const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
        if (!text) {
          if (cand && cand.finishReason === 'SAFETY') {
            throw new AppError('安全性フィルタにより応答が生成されませんでした。', '音声の内容を確認し、別の音声または区間を分けて再実行してください。', 'blocked');
          }
          throw new AppError('応答が空でした' + (cand && cand.finishReason ? `（finishReason: ${cand.finishReason}）` : '') + '。',
            'もう一度実行してください。続く場合は、音声の形式を MP3/WAV にするか、別のモデルIDをお試しください。', 'empty');
        }
        const result = normalize(parseJson(text, cand && cand.finishReason));
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
      if (g.navigator && g.navigator.onLine === false) {
        return { ok: false, summary: 'オフラインです', detail: 'インターネットに接続してから、もう一度お試しください。' };
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      let res;
      try {
        res = await fetch(`${ENDPOINT}${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': opts.apiKey }, signal: ctrl.signal });
      } catch (e) {
        return { ok: false, summary: e.name === 'AbortError' ? 'タイムアウトしました（15秒）' : '通信に失敗しました', detail: NET_HINT };
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
      const e = httpError(res.status, j, 'test');
      const summary = { key: 'APIキーが無効です', forbidden: 'このキーには権限がありません', model: 'モデルが見つかりません（HTTP 404）',
        quota: 'リクエスト上限に達しています', server: 'Google側で一時的なエラーが発生しています' }[e.code] || `接続テストに失敗しました（HTTP ${res.status}）`;
      const extra = e.code === 'model' ? `モデルID「${model}」が存在しない可能性があります。「カスタム」欄で別のモデルIDを試せます。` : e.message;
      return { ok: false, summary, detail: `${extra} ▶ 次にやること: ${e.hint}` };
    },
  };
})(window);
