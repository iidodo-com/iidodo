/* localStorage ラッパー。APIキーも履歴もブラウザ内にのみ保存する */
(function (g) {
  const MP = g.MP;
  const K_SET = 'mjp.settings.v1';
  const K_HIS = 'mjp.history.v1';
  const MAX_HISTORY = 200;

  const DEFAULTS = {
    apiKey: '',
    model: 'gemini-3.8-flash',
    customModel: '',
    forceDemo: false,
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { MP.toast('保存に失敗しました（容量超過またはストレージ無効）', 'err'); return false; }
  }

  MP.store = {
    DEFAULTS,
    getSettings() { return Object.assign({}, DEFAULTS, read(K_SET, {})); },
    saveSettings(s) { return write(K_SET, s); },
    /** 実際に使うモデルID（カスタム選択時は customModel） */
    effectiveModel(s) {
      return s.model === '__custom' ? (s.customModel || '').trim() || DEFAULTS.model : s.model;
    },
    isDemo(s) { return !!s.forceDemo || !s.apiKey.trim(); },

    listHistory() { return read(K_HIS, []); },
    getRecord(id) { return this.listHistory().find((r) => r.id === id) || null; },
    saveRecord(rec) {
      const list = this.listHistory().filter((r) => r.id !== rec.id);
      list.unshift(rec);
      return write(K_HIS, list.slice(0, MAX_HISTORY));
    },
    deleteRecord(id) { return write(K_HIS, this.listHistory().filter((r) => r.id !== id)); },
    clearHistory() { try { localStorage.removeItem(K_HIS); } catch (e) {} },
    clearAll() {
      try { localStorage.removeItem(K_HIS); localStorage.removeItem(K_SET); } catch (e) {}
    },
  };
})(window);
