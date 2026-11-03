/* localStorage 永続化（失敗しても動作継続）。読み込み時に型・形式を検証し、壊れた項目は捨てる。 */
(function () {
  "use strict";
  var KEY = "kessanwatch.v1";

  function defaults() {
    return { stocks: [], events: [], checks: {}, settings: { adapter: "dummy", warnDays: 7, apiKey: "" }, meta: { lastSync: null }, seeded: false };
  }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function validYmd(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)); }

  /** 任意のオブジェクト(localStorage / インポートファイル)を安全な state に正規化する */
  function sanitize(obj) {
    var d = defaults();
    if (!obj || typeof obj !== "object") return d;
    var seen = {};
    (Array.isArray(obj.stocks) ? obj.stocks : []).forEach(function (s) {
      if (!s || typeof s.code !== "string" || !s.code.trim() || seen[s.code]) return;
      seen[s.code] = 1;
      d.stocks.push({ code: str(s.code, 12), name: str(s.name, 60) || s.code, market: s.market === "US" ? "US" : "JP", theme: str(s.theme, 40), memo: str(s.memo, 500) });
    });
    (Array.isArray(obj.events) ? obj.events : []).forEach(function (e) {
      if (!e || typeof e.code !== "string" || !validYmd(e.date)) return;
      d.events.push({ code: e.code, date: e.date, period: str(e.period, 30) || "次回", source: str(e.source, 20) || "manual" });
    });
    if (obj.checks && typeof obj.checks === "object" && !Array.isArray(obj.checks)) {
      Object.keys(obj.checks).forEach(function (k) {
        var c = obj.checks[k]; if (!c || typeof c !== "object") return;
        var out = { memo: str(c.memo, 1000), done: !!c.done, updatedAt: str(c.updatedAt, 40) };
        ["results", "guidance", "reaction"].forEach(function (f) {
          var v = c[f] || {};
          out[f] = { text: str(v.text, 2000), verdict: ["", "positive", "neutral", "negative"].indexOf(v.verdict) >= 0 ? v.verdict : "" };
        });
        d.checks[k] = out;
      });
    }
    var st = obj.settings || {};
    d.settings.adapter = str(st.adapter, 20) || "dummy";
    var w = parseInt(st.warnDays, 10); d.settings.warnDays = isNaN(w) || w < 0 ? 7 : Math.min(w, 60);
    d.settings.apiKey = str(st.apiKey, 200);
    var ls = obj.meta && obj.meta.lastSync;
    if (ls && typeof ls === "object") d.meta.lastSync = { adapter: str(ls.adapter, 20), at: str(ls.at, 40), count: parseInt(ls.count, 10) || 0 };
    d.seeded = !!obj.seeded;
    return d;
  }

  var api = {
    sanitize: sanitize,
    load: function () {
      try { var raw = localStorage.getItem(KEY); return raw ? sanitize(JSON.parse(raw)) : defaults(); }
      catch (e) { return defaults(); }
    },
    save: function (state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch (e) { return false; }
    },
    clear: function () { try { localStorage.removeItem(KEY); } catch (e) {} }
  };
  if (typeof window !== "undefined") window.KW_STORE = api;
  if (typeof module !== "undefined") module.exports = api;
})();
