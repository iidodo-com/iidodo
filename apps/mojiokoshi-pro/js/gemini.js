/* Gemini API 呼び出し（ブラウザから直接。キーはx-goog-api-keyヘッダで送り、URLには載せない） */
(function (g) {
  const MP = g.MP;
  const U = MP.UNINTELLIGIBLE;
  const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const MAX_INLINE_BYTES = 14 * 1024 * 1024; // inline_data は base64化で約1.33倍。リクエスト上限(約20MB)を考慮
  const TIMEOUT_MS = 5 * 60 * 1000;

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
    if (status === 404) return 'モデルが見つかりません。設定のモデルIDを確認してください。' + detail;
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

  MP.gemini = {
    SYSTEM, SCHEMA, MAX_INLINE_BYTES, normalize, mimeOf,

    /** 実API呼び出し。opts: {file, apiKey, model, glossary, speakerHint, signal, onStatus} */
    async run(opts) {
      if (opts.file.size > MAX_INLINE_BYTES) {
        throw new Error(`ファイルが大きすぎます（上限 ${MP.fmtSize(MAX_INLINE_BYTES)}。File API対応は今後の課題）。`);
      }
      opts.onStatus && opts.onStatus('音声を読み込み中…');
      const data = await toBase64(opts.file);
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: mimeOf(opts.file), data } },
          { text: userPrompt(opts) },
        ] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA },
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort());
      opts.onStatus && opts.onStatus('Gemini で文字起こし・整文・要約を生成中…（長い音声では数分かかります）');
      let res;
      try {
        res = await fetch(`${ENDPOINT}${encodeURIComponent(opts.model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
      } catch (e) {
        if (e.name === 'AbortError') throw new Error(opts.signal && opts.signal.aborted ? 'キャンセルしました。' : 'タイムアウトしました（5分）。');
        throw new Error('ネットワークエラー。接続を確認してください。');
      } finally { clearTimeout(timer); }

      let json = null;
      try { json = await res.json(); } catch (e) { /* ignore */ }
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
      return result;
    },
  };
})(window);
