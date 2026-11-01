(function () {
  "use strict";

  var D = window.KW_DATE;
  var state = window.KW_STORE.load();
  var view = "list";
  var calMonth = new Date(); calMonth.setDate(1);
  var VERDICTS = [["", "未評価"], ["positive", "良好"], ["neutral", "中立"], ["negative", "懸念"]];

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function today() { return D.toYmd(new Date()); }
  function dayDiff(ymd) {
    var a = ymd.split("-").map(Number), t = new Date();
    var d1 = Date.UTC(a[0], a[1] - 1, a[2]), d2 = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
    return Math.round((d1 - d2) / 86400000);
  }
  function key(e) { return e.code + "|" + e.period; }
  function stockOf(code) { return state.stocks.filter(function (s) { return s.code === code; })[0]; }
  function save() { if (!window.KW_STORE.save(state)) toast("保存に失敗しました（ブラウザの保存領域が使えません）"); }
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function validYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)); }

  function statusOf(e) {
    var chk = state.checks[key(e)], d = dayDiff(e.date);
    if (chk && chk.done) return { cls: "done", label: "通過確認済", d: d };
    if (d < 0) return { cls: "passed", label: "通過済・要確認", d: d };
    if (d === 0) return { cls: "today", label: "本日発表", d: d };
    if (d <= Number(state.settings.warnDays || 0)) return { cls: "near", label: "あと" + d + "日（設定した警戒日数内）", d: d };
    return { cls: "far", label: "あと" + d + "日", d: d };
  }
  function sortedEvents() {
    return state.events.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  function badge(e) { var s = statusOf(e); return h("span", { class: "badge " + s.cls, text: s.label }); }

  /* ---------- sync via adapter ---------- */
  function sync(silent) {
    var adapter = window.KW_ADAPTERS.get(state.settings.adapter);
    return adapter.fetchSchedule(state.stocks, { apiKey: state.settings.apiKey, today: today() }).then(function (evs) {
      var manual = state.events.filter(function (e) { return e.source === "manual"; });
      var mk = {}; manual.forEach(function (e) { mk[key(e)] = 1; });
      var codes = {}; state.stocks.forEach(function (s) { codes[s.code] = 1; });
      var fetched = evs.filter(function (e) { return codes[e.code] && !mk[key(e)] && validYmd(e.date); });
      state.events = manual.concat(fetched);
      save(); render();
      if (!silent) toast(adapter.name + " から " + fetched.length + " 件を取得しました");
    }).catch(function (err) { toast("取得失敗: " + err.message); });
  }

  /* ---------- rendering ---------- */
  function render() {
    var adapter = window.KW_ADAPTERS.get(state.settings.adapter);
    $("dummyBanner").hidden = !adapter.isDummy;
    ["list", "calendar", "stocks", "check"].forEach(function (v) {
      $("tab-" + v).setAttribute("aria-selected", String(v === view));
      $("view-" + v).hidden = v !== view;
    });
    if (view === "list") renderList();
    if (view === "calendar") renderCalendar();
    if (view === "stocks") renderStocks();
    if (view === "check") renderCheck();
  }

  function eventRow(e) {
    var s = stockOf(e.code) || { name: e.code };
    return h("tr", { class: "clickable", onclick: function () { openCheck(key(e)); } }, [
      h("td", { text: e.date }),
      h("td", {}, [h("strong", { text: e.code }), " " + s.name]),
      h("td", { text: e.period }),
      h("td", {}, [badge(e)]),
      h("td", { text: checkSummary(e) })
    ]);
  }
  function checkSummary(e) {
    var c = state.checks[key(e)]; if (!c) return "未記録";
    var n = ["results", "guidance", "reaction"].filter(function (k) { return c[k] && (c[k].text || c[k].verdict); }).length;
    return n + "/3 欄記録";
  }

  function renderList() {
    var box = $("view-list"); box.textContent = "";
    var fl = $("listFilter").value, evs = sortedEvents().filter(function (e) {
      var s = statusOf(e);
      if (fl === "upcoming") return s.d >= 0 && s.cls !== "done";
      if (fl === "unchecked") return s.cls === "passed";
      return true;
    });
    if (!evs.length) { box.appendChild(h("p", { class: "empty", text: "該当する決算予定がありません。" })); return; }
    var tb = h("tbody");
    evs.forEach(function (e) { tb.appendChild(eventRow(e)); });
    box.appendChild(h("div", { class: "tablewrap" }, [h("table", {}, [
      h("thead", {}, [h("tr", {}, ["決算日", "銘柄", "対象期", "状態", "通過チェック"].map(function (t) { return h("th", { text: t }); }))]), tb])]));
  }

  function renderCalendar() {
    var box = $("view-calendar"); box.textContent = "";
    var y = calMonth.getFullYear(), m = calMonth.getMonth();
    box.appendChild(h("div", { class: "calnav" }, [
      h("button", { type: "button", onclick: function () { calMonth = new Date(y, m - 1, 1); render(); }, text: "◀ 前月" }),
      h("strong", { text: y + "年" + (m + 1) + "月" }),
      h("button", { type: "button", onclick: function () { calMonth = new Date(y, m + 1, 1); render(); }, text: "翌月 ▶" }),
      h("button", { type: "button", onclick: function () { var n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); render(); }, text: "今月" })
    ]));
    var grid = h("div", { class: "calgrid" });
    ["日", "月", "火", "水", "木", "金", "土"].forEach(function (w) { grid.appendChild(h("div", { class: "calhead", text: w })); });
    var first = new Date(y, m, 1).getDay(), dim = new Date(y, m + 1, 0).getDate(), t = today();
    var byDate = {}; state.events.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e); });
    for (var i = 0; i < first; i++) grid.appendChild(h("div", { class: "calcell blank" }));
    for (var d = 1; d <= dim; d++) {
      var ymd = D.toYmd(new Date(y, m, d)), evs = byDate[ymd] || [];
      var cell = h("div", { class: "calcell" + (ymd === t ? " today" : "") }, [h("div", { class: "daynum", text: String(d) })]);
      evs.slice(0, 3).forEach(function (e) {
        var s = stockOf(e.code) || { name: e.code };
        cell.appendChild(h("button", { type: "button", class: "chip " + statusOf(e).cls, title: s.name + " " + e.period, onclick: function () { openCheck(key(e)); }, text: s.name }));
      });
      if (evs.length > 3) cell.appendChild(h("div", { class: "more", text: "他 " + (evs.length - 3) + " 件" }));
      grid.appendChild(cell);
    }
    box.appendChild(grid);
  }

  function renderStocks() {
    var box = $("view-stocks"); box.textContent = "";
    if (!state.stocks.length) { box.appendChild(h("p", { class: "empty", text: "ウォッチ銘柄がありません。「銘柄を追加」から登録してください。" })); return; }
    var tb = h("tbody");
    state.stocks.forEach(function (s) {
      var next = sortedEvents().filter(function (e) { return e.code === s.code && dayDiff(e.date) >= 0; })[0];
      tb.appendChild(h("tr", {}, [
        h("td", {}, [h("strong", { text: s.code })]), h("td", { text: s.name }), h("td", { text: s.market === "US" ? "米国" : "日本" }),
        h("td", { text: s.theme || "" }), h("td", { text: next ? next.date : "未設定" }), h("td", { class: "memo", text: s.memo || "" }),
        h("td", { class: "actions" }, [
          h("button", { type: "button", onclick: function () { openStock(s.code); }, text: "編集" }),
          h("button", { type: "button", class: "danger", onclick: function () { delStock(s.code); }, text: "削除" })
        ])
      ]));
    });
    box.appendChild(h("div", { class: "tablewrap" }, [h("table", {}, [
      h("thead", {}, [h("tr", {}, ["コード", "銘柄名", "市場", "テーマ", "次回決算日", "メモ", ""].map(function (t) { return h("th", { text: t }); }))]), tb])]));
  }

  function renderCheck() {
    var box = $("view-check"); box.textContent = "";
    var evs = sortedEvents().filter(function (e) { var s = statusOf(e); return s.cls === "passed" || s.cls === "today" || s.cls === "done"; }).reverse();
    box.appendChild(h("p", { class: "hint", text: "決算発表日を過ぎた銘柄が「通過済・要確認」として並びます。行をクリックして3欄（実績／ガイダンス／株価反応）を記録します。" }));
    if (!evs.length) { box.appendChild(h("p", { class: "empty", text: "通過済みの決算はまだありません。" })); return; }
    var tb = h("tbody");
    evs.forEach(function (e) { tb.appendChild(eventRow(e)); });
    box.appendChild(h("div", { class: "tablewrap" }, [h("table", {}, [
      h("thead", {}, [h("tr", {}, ["決算日", "銘柄", "対象期", "状態", "通過チェック"].map(function (t) { return h("th", { text: t }); }))]), tb])]));
  }

  /* ---------- stock dialog ---------- */
  var editingCode = null;
  function openStock(code) {
    editingCode = code || null;
    var s = code ? stockOf(code) : { code: "", name: "", market: "JP", theme: "", memo: "" };
    var ev = code ? sortedEvents().filter(function (e) { return e.code === code && e.source === "manual"; })[0] : null;
    $("stockTitle").textContent = code ? "銘柄を編集" : "銘柄を追加";
    $("f-code").value = s.code; $("f-code").readOnly = !!code;
    $("f-name").value = s.name; $("f-market").value = s.market; $("f-theme").value = s.theme || ""; $("f-memo").value = s.memo || "";
    $("f-date").value = ev ? ev.date : ""; $("f-period").value = ev ? ev.period : "";
    $("stockDlg").showModal();
  }
  function submitStock(ev) {
    ev.preventDefault();
    var code = $("f-code").value.trim().toUpperCase(), name = $("f-name").value.trim();
    if (!code || !name) { toast("コードと銘柄名は必須です"); return; }
    if (!editingCode && stockOf(code)) { toast("同じコードが既に登録されています"); return; }
    var date = $("f-date").value.trim(), period = $("f-period").value.trim() || "次回";
    if (date && !validYmd(date)) { toast("決算日は YYYY-MM-DD 形式で入力してください"); return; }
    var rec = { code: code, name: name, market: $("f-market").value, theme: $("f-theme").value.trim(), memo: $("f-memo").value.trim() };
    if (editingCode) state.stocks = state.stocks.map(function (s) { return s.code === code ? rec : s; });
    else state.stocks.push(rec);
    state.events = state.events.filter(function (e) { return !(e.code === code && e.source === "manual"); });
    if (date) state.events.push({ code: code, date: date, period: period, source: "manual" });
    save(); $("stockDlg").close(); render();
  }
  function delStock(code) {
    if (!confirm(code + " を削除しますか？（決算予定とチェック記録も削除されます）")) return;
    state.stocks = state.stocks.filter(function (s) { return s.code !== code; });
    state.events = state.events.filter(function (e) { return e.code !== code; });
    Object.keys(state.checks).forEach(function (k) { if (k.indexOf(code + "|") === 0) delete state.checks[k]; });
    save(); render();
  }

  /* ---------- checklist dialog ---------- */
  var checkKey = null;
  var SECTIONS = [
    ["results", "① 実績（売上・利益）", "売上高・営業利益・純利益など、会社予想やコンセンサスとの差を自分の言葉で記録"],
    ["guidance", "② ガイダンス（業績予想・見通し）", "通期予想の修正有無、次四半期の見通し、コメントを記録"],
    ["reaction", "③ 株価反応", "発表後の値動き（例: 寄り付き -x%、終値 +y%）と出来高、自分の所感を記録"]
  ];
  function openCheck(k) {
    var e = state.events.filter(function (x) { return key(x) === k; })[0]; if (!e) return;
    checkKey = k;
    var s = stockOf(e.code) || { name: e.code }, c = state.checks[k] || {};
    $("checkTitle").textContent = e.code + " " + s.name + " / " + e.period;
    $("checkMeta").textContent = "決算日: " + e.date + "　" + statusOf(e).label;
    var wrap = $("checkFields"); wrap.textContent = "";
    SECTIONS.forEach(function (sec) {
      var v = c[sec[0]] || {};
      var sel = h("select", { id: "c-" + sec[0] + "-v" }, VERDICTS.map(function (o) {
        var op = h("option", { value: o[0], text: o[1] }); if (v.verdict === o[0]) op.selected = true; return op;
      }));
      var ta = h("textarea", { id: "c-" + sec[0] + "-t", rows: "3", placeholder: sec[2] }); ta.value = v.text || "";
      wrap.appendChild(h("fieldset", {}, [h("legend", { text: sec[1] }), h("label", {}, ["自己評価 ", sel]), ta]));
    });
    $("c-memo").value = c.memo || ""; $("c-done").checked = !!c.done;
    $("checkDlg").showModal();
  }
  function submitCheck(ev) {
    ev.preventDefault();
    var c = { memo: $("c-memo").value.trim(), done: $("c-done").checked, updatedAt: new Date().toISOString() };
    SECTIONS.forEach(function (sec) { c[sec[0]] = { text: $("c-" + sec[0] + "-t").value.trim(), verdict: $("c-" + sec[0] + "-v").value }; });
    state.checks[checkKey] = c; save(); $("checkDlg").close(); render();
  }

  /* ---------- settings / backup ---------- */
  function openSettings() {
    var sel = $("s-adapter"); sel.textContent = "";
    window.KW_ADAPTERS.list().forEach(function (a) {
      var o = h("option", { value: a.id, text: a.name }); if (a.id === state.settings.adapter) o.selected = true; sel.appendChild(o);
    });
    $("s-warn").value = state.settings.warnDays; $("s-key").value = state.settings.apiKey || "";
    $("settingsDlg").showModal();
  }
  function submitSettings(ev) {
    ev.preventDefault();
    state.settings.adapter = $("s-adapter").value;
    var w = parseInt($("s-warn").value, 10); state.settings.warnDays = isNaN(w) || w < 0 ? 7 : Math.min(w, 60);
    state.settings.apiKey = $("s-key").value.trim();
    save(); $("settingsDlg").close(); sync(false);
  }
  function exportJson() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = h("a", { href: URL.createObjectURL(blob), download: "kessan-watch-backup-" + today() + ".json" });
    document.body.appendChild(a); a.click(); a.remove();
  }
  function importJson(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var o = JSON.parse(r.result);
        if (!Array.isArray(o.stocks)) throw new Error("形式が不正です");
        if (!confirm("現在のデータを置き換えます。よろしいですか？")) return;
        window.KW_STORE.save(o); state = window.KW_STORE.load(); render(); toast("読み込みました");
      } catch (e) { toast("読み込み失敗: " + e.message); }
    };
    r.readAsText(file);
  }
  function resetSample() {
    if (!confirm("すべてのデータを消去してサンプルデータに戻します。よろしいですか？")) return;
    window.KW_STORE.clear(); state = window.KW_STORE.load(); seed();
  }
  function seed() {
    state.stocks = JSON.parse(JSON.stringify(window.KW_SAMPLE.stocks)); state.seeded = true;
    sync(true).then(function () { toast("サンプルデータ（ダミー）を読み込みました"); });
  }

  /* ---------- init ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    ["list", "calendar", "stocks", "check"].forEach(function (v) {
      $("tab-" + v).addEventListener("click", function () { view = v; render(); });
    });
    $("listFilter").addEventListener("change", render);
    $("btnAdd").addEventListener("click", function () { openStock(); });
    $("stockForm").addEventListener("submit", submitStock);
    $("checkForm").addEventListener("submit", submitCheck);
    $("settingsForm").addEventListener("submit", submitSettings);
    $("btnSettings").addEventListener("click", openSettings);
    $("btnSync").addEventListener("click", function () { sync(false); });
    $("btnExport").addEventListener("click", exportJson);
    $("fileImport").addEventListener("change", function (e) { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; });
    $("btnReset").addEventListener("click", resetSample);
    document.querySelectorAll("[data-close]").forEach(function (b) {
      b.addEventListener("click", function () { b.closest("dialog").close(); });
    });
    if (!state.seeded && !state.stocks.length) seed(); else render();
  });
})();
