/* localStorage ラッパー。APIキーも履歴もブラウザ内にのみ保存する。
 * localStorage が使えない環境（プライベートモード等）では、そのタブの間だけメモリに保持する。 */
(function (g) {
  const MP = g.MP;
  const K_SET = 'mjp.settings.v1';
  const K_HIS = 'mjp.history.v1';
  const MAX_HISTORY = 200;
  const MAX_TERMS = 500;

  const DEFAULTS = {
    apiKey: '',
    model: 'gemini-3.8-flash',
    customModel: '',
    forceDemo: false,
    maskTerms: [],      // 伏せ字辞書（氏名・固有名詞）
    maskOutput: true,   // 出力（コピー/ダウンロード）に伏せ字を適用
  };

  const mem = new Map();
  let persistent = true;
  try { const k = '__mjp_probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); } catch (e) { persistent = false; }

  function read(key, fallback) {
    try {
      const raw = persistent ? localStorage.getItem(key) : mem.get(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    const raw = JSON.stringify(val);
    if (!persistent) { mem.set(key, raw); return true; }
    try { localStorage.setItem(key, raw); return true; }
    catch (e) {
      MP.toast('保存できませんでした（ブラウザの保存容量がいっぱいの可能性があります）。不要な履歴を削除してから、もう一度お試しください。', 'err');
      return false;
    }
  }

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v) => (typeof v === 'string' ? v : '');
  const arr = (v) => (Array.isArray(v) ? v : []);

  /** 履歴レコードの検証・補正（壊れたデータや旧形式でも画面が落ちないようにする） */
  function fix(r) {
    if (!isObj(r) || typeof r.id !== 'string') return null;
    const spk = (s) => (typeof s === 'string' && /^[A-Z]$/.test(s) ? s : 'A');
    const out = Object.assign({}, r);
    out.fileName = str(r.fileName) || '（無題）';
    out.createdAt = Number.isFinite(r.createdAt) ? r.createdAt : Date.now();
    out.transcript = arr(r.transcript).filter(isObj).map((s) => ({
      spk: spk(s.spk), start: str(s.start), text: str(s.text), uncertain: !!s.uncertain, edited: !!s.edited }));
    out.polished = arr(r.polished).filter(isObj).map((s) => ({ spk: spk(s.spk), text: str(s.text), edited: !!s.edited }));
    out.summary = arr(r.summary).map(str);
    out.decisions = arr(r.decisions).map(str);
    out.todos = arr(r.todos).filter(isObj).map((t) => ({ task: str(t.task), owner: str(t.owner) || '不明', due: str(t.due) || '不明', done: !!t.done }));
    out.audio_notes = str(r.audio_notes);
    const sp = {};
    if (isObj(r.speakers)) Object.keys(r.speakers).forEach((k) => { if (/^[A-Z]$/.test(k)) sp[k] = str(r.speakers[k]) || `話者${k}`; });
    [...out.transcript, ...out.polished].forEach((s) => { if (!sp[s.spk]) sp[s.spk] = `話者${s.spk}`; });
    out.speakers = sp;
    return out;
  }

  const cleanTerms = (list) => {
    const seen = new Set(), out = [];
    arr(list).forEach((t) => {
      const v = str(t).trim().slice(0, 60);
      if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
    });
    return out.slice(0, MAX_TERMS);
  };

  MP.store = {
    DEFAULTS,
    /** false の場合、設定・履歴はこのタブを閉じると失われる */
    get persistent() { return persistent; },
    getSettings() {
      const s = Object.assign({}, DEFAULTS, read(K_SET, {}));
      s.maskTerms = cleanTerms(s.maskTerms);
      return s;
    },
    saveSettings(s) { return write(K_SET, Object.assign({}, s, { maskTerms: cleanTerms(s.maskTerms) })); },
    /** 実際に使うモデルID（カスタム選択時は customModel） */
    effectiveModel(s) {
      return s.model === '__custom' ? (s.customModel || '').trim() || DEFAULTS.model : s.model;
    },
    isDemo(s) { return !!s.forceDemo || !String(s.apiKey || '').trim(); },

    /** 初回案内などの軽量フラグ */
    getFlag(name) { return !!(read('mjp.flags.v1', {}) || {})[name]; },
    setFlag(name) { const f = read('mjp.flags.v1', {}) || {}; f[name] = true; write('mjp.flags.v1', f); },

    listHistory() { return arr(read(K_HIS, [])).map(fix).filter(Boolean); },
    getRecord(id) { return this.listHistory().find((r) => r.id === id) || null; },
    saveRecord(rec) {
      const list = this.listHistory().filter((r) => r.id !== rec.id);
      list.unshift(rec);
      return write(K_HIS, list.slice(0, MAX_HISTORY));
    },
    deleteRecord(id) { return write(K_HIS, this.listHistory().filter((r) => r.id !== id)); },
    clearHistory() { try { persistent ? localStorage.removeItem(K_HIS) : mem.delete(K_HIS); } catch (e) { /* ignore */ } },
    clearAll() {
      try {
        if (persistent) { localStorage.removeItem(K_HIS); localStorage.removeItem(K_SET); localStorage.removeItem('mjp.flags.v1'); } else mem.clear();
      } catch (e) { /* ignore */ }
    },
  };
})(window);
