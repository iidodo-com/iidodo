/* localStorage 永続化（失敗しても動作継続） */
(function () {
  "use strict";
  var KEY = "kessanwatch.v1";

  function defaults() {
    return { stocks: [], events: [], checks: {}, settings: { adapter: "dummy", warnDays: 7, apiKey: "" }, seeded: false };
  }

  window.KW_STORE = {
    load: function () {
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return defaults();
        var obj = JSON.parse(raw);
        var d = defaults();
        d.stocks = Array.isArray(obj.stocks) ? obj.stocks : [];
        d.events = Array.isArray(obj.events) ? obj.events : [];
        d.checks = obj.checks && typeof obj.checks === "object" ? obj.checks : {};
        d.settings = Object.assign(d.settings, obj.settings || {});
        d.seeded = !!obj.seeded;
        return d;
      } catch (e) { return defaults(); }
    },
    save: function (state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
      catch (e) { return false; }
    },
    clear: function () { try { localStorage.removeItem(KEY); } catch (e) {} }
  };
})();
