/* 共通ユーティリティ（ビルド不要・グローバル名前空間 MP） */
(function (g) {
  const MP = (g.MP = g.MP || {});

  /** DOM生成ヘルパー。文字列は常にテキストノードにするためXSSに強い */
  MP.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    const post = {};
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled') post[k] = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    for (const [k, v] of Object.entries(post)) el[k] = v;
    return el;
  };

  MP.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  MP.$ = (sel, root) => (root || document).querySelector(sel);
  MP.uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  MP.fmtTime = function (sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    const hh = Math.floor(m / 60);
    const p = (n) => String(n).padStart(2, '0');
    return hh ? `${hh}:${p(m % 60)}:${p(s)}` : `${p(m)}:${p(s)}`;
  };
  MP.fmtDate = (ts) => {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  MP.fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');

  MP.toast = function (msg, kind) {
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = MP.h('div', { class: 'toast ' + (kind || ''), role: 'status' }, msg);
    box.append(t);
    setTimeout(() => t.remove(), 3200);
  };

  MP.UNINTELLIGIBLE = '【聞き取れませんでした】';
})(window);
