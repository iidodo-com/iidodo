(() => {
  const $ = (id) => document.getElementById(id);
  const SAMPLES = ["7203.T", "6758.T", "9984.T", "AAPL", "NVDA", "^N225", "^GSPC", "BTC-USD", "USDJPY=X"];
  $("chips").innerHTML = SAMPLES.map((s) => `<span>${s}</span>`).join("");
  $("chips").onclick = (e) => { if (e.target.tagName === "SPAN") { $("sym").value = e.target.textContent; run(); } };
  $("go").onclick = run; $("sym").onkeydown = (e) => e.key === "Enter" && run();

  const fmt = (n) => (n >= 1000 ? n.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) : n.toFixed(2));
  const pct = (x) => `<span class="${x >= 0 ? "up" : "dn"}">${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%</span>`;

  async function run() {
    $("msg").textContent = "取得中…"; $("go").disabled = true;
    try {
      const r = await fetch(`/api/history?symbol=${encodeURIComponent($("sym").value.trim())}&range=2y`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (d.rows.length < 80) throw new Error("データが少なすぎます(80営業日以上必要)");
      const H = +$("hor").value, closes = d.rows.map((x) => x.c), f = Forecast.forecast(closes, H);
      render(d, closes, f); $("msg").textContent = "";
    } catch (e) { $("msg").textContent = e.message; }
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
  run();
})();
