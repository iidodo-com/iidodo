(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "yosoku.watch.v1";
  const DEFAULT = [["7203.T", "トヨタ自動車"], ["6758.T", "ソニーG"], ["9984.T", "ソフトバンクG"], ["AAPL", "Apple"], ["NVDA", "NVIDIA"], ["^N225", "日経平均"], ["^GSPC", "S&P500"], ["BTC-USD", "ビットコイン"], ["USDJPY=X", "ドル円"]];
  let watch = load(), rows = {};
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v) && v.length) return v; } catch {} return DEFAULT.map(([s, n]) => ({ s, n })); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(watch)); } catch {} }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function drawWatch() {
    $("chips").innerHTML = watch.map((w) => `<span data-s="${esc(w.s)}" title="${esc(w.n || "")}">${esc(w.s)}<i class="x" data-x="${esc(w.s)}">×</i></span>`).join("");
    $("tbl").innerHTML = "<tr><th>銘柄</th><th>現在値</th><th>変化(中央値)</th><th>上昇確率</th><th>シグナル</th></tr>" + watch.map((w) => {
      const r = rows[w.s];
      const cell = r ? (r.err ? `<td colspan="4">${esc(r.err)}</td>` : `<td>${fmt(r.f.last)}</td><td>${pct(r.f.expected.retMid)}</td><td>${(r.f.mc.probUp * 100).toFixed(0)}%</td><td class="${r.f.sig.label === "強気" ? "up" : r.f.sig.label === "弱気" ? "dn" : ""}">${r.f.sig.label}</td>`) : `<td colspan="4">-</td>`;
      return `<tr class="r" data-s="${esc(w.s)}"><td>${esc(w.s)} <small class="warn">${esc(w.n || "")}</small></td>${cell}</tr>`;
    }).join("");
  }
  $("chips").onclick = (e) => {
    const x = e.target.dataset.x;
    if (x) { watch = watch.filter((w) => w.s !== x); save(); drawWatch(); return; }
    const sp = e.target.closest("span"); if (sp) { $("sym").value = sp.dataset.s; run(); }
  };
  $("tbl").onclick = (e) => { const tr = e.target.closest("tr.r"); if (tr) { $("sym").value = tr.dataset.s; run(); } };
  $("go").onclick = () => run(); $("sym").onkeydown = (e) => e.key === "Enter" && run();
  $("add").onclick = async () => {
    const s = $("sym").value.trim().toUpperCase();
    if (!s) return;
    if (watch.some((w) => w.s === s)) { $("msg").textContent = s + " は登録済みです"; return; }
    await run(true);
    if (!$("msg").textContent && rows[s] && !rows[s].err) { watch.push({ s, n: rows[s].n }); save(); drawWatch(); $("msg").textContent = ""; }
  };
  $("refresh").onclick = async () => { $("refresh").disabled = true; for (const w of watch) { try { await load1(w.s); } catch {} drawWatch(); } $("refresh").disabled = false; };

  async function load1(sym) {
    try {
      const r = await fetch(`/api/history?symbol=${encodeURIComponent(sym)}&range=2y`), d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.rows.length < 80) throw new Error("データが少なすぎます(80営業日以上必要)");
      const closes = d.rows.map((x) => x.c);
      rows[sym] = { d, closes, n: d.name, f: Forecast.forecast(closes, +$("hor").value) };
    } catch (e) { rows[sym] = { err: e.message === "Failed to fetch" ? "サーバーに接続できません" : e.message }; throw e; }
    return rows[sym];
  }

  const fmt = (n) => (n >= 1000 ? n.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) : n.toFixed(2));
  const pct = (x) => `<span class="${x >= 0 ? "up" : "dn"}">${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%</span>`;

  async function run(keep) {
    const sym = $("sym").value.trim().toUpperCase();
    if (location.protocol === "file:") { $("msg").innerHTML = "このファイルを直接開いても株価を取得できません。start.bat で起動した http://localhost:8787 で使ってください。"; return; }
    $("msg").textContent = "取得中…"; $("go").disabled = true;
    try {
      const r = await load1(sym);
      render(r.d, r.closes, r.f); $("msg").textContent = ""; drawWatch();
    } catch (e) { $("msg").textContent = rows[sym]?.err || e.message; delete rows[sym]; }
    $("go").disabled = false;
  }

  function render(d, closes, f) {
    $("out").hidden = false;
    $("name").textContent = `${d.name} (${d.symbol}) 通貨: ${d.currency}`;
    const e = f.expected, sg = f.sig, cls = sg.label === "強気" ? "up" : sg.label === "弱気" ? "dn" : "";
    $("kpis").innerHTML = [
      ["現在値", fmt(f.last)],
      [`${f.H}営業日後 中央値`, `${fmt(e.mid)} ${pct(e.retMid)}`],
      ["90%予測レンジ", `${fmt(e.low)} 〜 ${fmt(e.high)}`],
      ["上昇確率", `${(f.mc.probUp * 100).toFixed(0)}%`],
      ["年率ボラ(推定)", `${(f.mc.sigmaDaily * Math.sqrt(252) * 100).toFixed(0)}%`],
      ["総合シグナル", `<span class="${cls}">${sg.label}</span>`],
    ].map(([k, v]) => `<div class="kpi"><small>${k}</small><b>${v}</b></div>`).join("");
    $("score").textContent = `スコア ${sg.score > 0 ? "+" : ""}${sg.score} / ±4`;
    $("why").innerHTML = (sg.why.length ? sg.why : ["目立ったシグナルなし"]).concat([`SMA20 ${fmt(sg.sma20)} / SMA50 ${fmt(sg.sma50)} / RSI ${sg.rsi.toFixed(0)}`]).map((w) => `<li>${w}</li>`).join("");
    draw(closes, f);
  }

  function draw(closes, f) {
    const cv = $("cv"), dpr = devicePixelRatio || 1, W = cv.clientWidth, Ht = cv.clientHeight;
    cv.width = W * dpr; cv.height = Ht * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    const past = closes.slice(-120), n = past.length, H = f.H, tot = n + H;
    const all = past.concat(f.mc.bands.map((b) => b.p5), f.mc.bands.map((b) => b.p95));
    const lo = Math.min(...all) * 0.98, hi = Math.max(...all) * 1.02;
    const X = (i) => 8 + (i / (tot - 1)) * (W - 70), Y = (v) => 10 + (1 - (v - lo) / (hi - lo)) * (Ht - 24);
    g.font = "11px sans-serif"; g.fillStyle = "#8b96b0"; g.strokeStyle = "#222d47";
    for (let k = 0; k <= 4; k++) { const v = lo + ((hi - lo) * k) / 4; g.beginPath(); g.moveTo(8, Y(v)); g.lineTo(W - 62, Y(v)); g.stroke(); g.fillText(fmt(v), W - 58, Y(v) + 4); }
    const band = (a, b, col) => {
      g.beginPath(); f.mc.bands.forEach((x, i) => g[i ? "lineTo" : "moveTo"](X(n - 1 + i + 1), Y(x[a])));
      for (let i = H - 1; i >= 0; i--) g.lineTo(X(n + i), Y(f.mc.bands[i][b]));
      g.closePath(); g.fillStyle = col; g.fill();
    };
    band("p5", "p95", "rgba(91,157,255,.15)"); band("p25", "p75", "rgba(91,157,255,.3)");
    const line = (pts, col, dash) => { g.beginPath(); g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = 2; pts.forEach(([i, v], k) => g[k ? "lineTo" : "moveTo"](X(i), Y(v))); g.stroke(); g.setLineDash([]); };
    line(past.map((v, i) => [i, v]), "#e8ecf5", []);
    line([[n - 1, f.last]].concat(f.mc.bands.map((b, i) => [n + i, b.p50])), "#5b9dff", [6, 4]);
    line([[n - 1, f.last]].concat(f.tr.path.map((v, i) => [n + i, v])), "#f5c542", [2, 3]);
  }
  drawWatch(); run();
  $("hor").onchange = () => { rows = {}; drawWatch(); run(); };
})();
