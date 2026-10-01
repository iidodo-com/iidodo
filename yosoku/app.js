(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = "yosoku.watch.v1";
  const DEFAULT = [["7203.T", "トヨタ自動車"], ["6758.T", "ソニーG"], ["9984.T", "ソフトバンクG"], ["AAPL", "Apple"], ["NVDA", "NVIDIA"], ["^N225", "日経平均"], ["^GSPC", "S&P500"], ["BTC-USD", "ビットコイン"], ["USDJPY=X", "ドル円"]];
  let watch = load(), rows = {};
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v) && v.length) return v; } catch {} return DEFAULT.map(([s, n]) => ({ s, n })); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(watch)); } catch {} }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // 入力の正規化: 全角→半角、空白除去、大文字化、東証コード(4桁 or 3桁+英字)は .T を補う
  function norm(v) {
    let t = String(v).normalize("NFKC").replace(/\s+/g, "").toUpperCase();
    if (/^\d{3}[0-9A-Z]$/.test(t)) t += ".T";
    return t;
  }

  function drawWatch() {
    $("chips").innerHTML = watch.map((w) => `<span data-s="${esc(w.s)}" title="${esc(w.n || "")}">${esc(w.s)}<i class="x" data-x="${esc(w.s)}">×</i></span>`).join("");
    $("tbl").innerHTML = "<tr><th>銘柄</th><th>現在値</th><th>変化(中央値)</th><th>上昇確率</th><th>シグナル</th></tr>" + watch.map((w) => {
      const r = rows[w.s];
      const cell = r ? (r.err ? `<td colspan="4">${esc(r.err)}</td>` : `<td>${fmt(r.f.last)}</td><td>${pct(r.f.expected.retMid)}</td><td>${(r.f.mc.probUp * 100).toFixed(0)}%</td><td class="${r.f.sig.label === "強気" ? "up" : r.f.sig.label === "弱気" ? "dn" : ""}">${r.f.sig.label}</td>`) : `<td colspan="4">-</td>`;
      return `<tr class="r" data-s="${esc(w.s)}"><td>${esc(w.s)} <small class="warn" data-rename="${esc(w.s)}" title="ダブルクリックで名前を変更">${esc(w.n || "名前を付ける")}</small></td>${cell}</tr>`;
    }).join("");
  }
  $("chips").onclick = (e) => {
    const x = e.target.dataset.x;
    if (x) { watch = watch.filter((w) => w.s !== x); save(); drawWatch(); return; }
    const sp = e.target.closest("span"); if (sp) { $("sym").value = sp.dataset.s; run(); }
  };
  $("tbl").ondblclick = (e) => {
    const k = e.target.dataset.rename; if (!k) return;
    const w = watch.find((x) => x.s === k), n = prompt(k + " の表示名(空にすると元に戻ります)", w.n || "");
    if (n !== null) { w.n = n.trim() || (rows[k] && rows[k].n) || ""; save(); drawWatch(); }
  };
  $("tbl").onclick = (e) => { const tr = e.target.closest("tr.r"); if (tr) { $("sym").value = tr.dataset.s; run(); } };
  $("go").onclick = () => run(); $("sym").onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) run(); };
  $("clr").onclick = () => { $("sym").value = ""; $("msg").textContent = ""; $("sym").focus(); };
  $("add").onclick = async () => {
    const s = norm($("sym").value);
    $("sym").value = s;
    if (!s) return;
    if (watch.some((w) => w.s === s)) { $("msg").textContent = s + " は登録済みです"; return; }
    await run(true);
    if (!$("msg").textContent && rows[s] && !rows[s].err) { watch.push({ s, n: rows[s].n }); save(); drawWatch(); $("msg").textContent = ""; }
  };
  $("refresh").onclick = async () => { $("refresh").disabled = true; for (const w of watch) { try { await load1(w.s, true); } catch {} drawWatch(); } $("refresh").disabled = false; };

  const fmt = (n) => (n >= 1000 ? n.toLocaleString("ja-JP", { maximumFractionDigits: 0 }) : n.toFixed(2));
  const pct = (x) => `<span class="${x >= 0 ? "up" : "dn"}">${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%</span>`;
  let cur = null;
  const getJson = async (url) => { const r = await fetch(url), d = await r.json(); if (!r.ok) throw new Error(d.error); return d; };
  const q = (sym) => encodeURIComponent(sym);

  // 予測の再計算(ネットワーク不要): 最新価格の反映・ニュース反映の有無・予測期間
  function calc(r) {
    const closes = r.base.slice();
    if (r.live) { if (r.dates[r.dates.length - 1] === r.live.date) closes[closes.length - 1] = r.live.price; else closes.push(r.live.price); }
    r.closes = closes;
    r.ns = Forecast.newsScore(r.news || []);
    r.f = Forecast.forecast(closes, +$("hor").value, $("usenews").checked && r.ns.count ? r.ns : null);
  }
  async function applyLive(r, sym) { r.live = await getJson(`/api/quote?symbol=${q(sym)}`); r.live.got = Date.now(); calc(r); }

  async function load1(sym, live) {
    try {
      const d = await getJson(`/api/history?symbol=${q(sym)}&range=2y`);
      if (d.rows.length < 80) throw new Error("データが少なすぎます(80営業日以上必要)");
      const r = { d, dates: d.rows.map((x) => x.d), base: d.rows.map((x) => x.c), n: d.name, news: [], live: null };
      try { r.news = (await getJson(`/api/news?symbol=${q(sym)}`)).items; } catch (e) { r.newsErr = e.message; }
      if (live) { try { r.live = await getJson(`/api/quote?symbol=${q(sym)}`); r.live.got = Date.now(); } catch {} }
      calc(r); rows[sym] = r;
    } catch (e) { rows[sym] = { err: e.message === "Failed to fetch" ? "サーバーに接続できません" : e.message }; throw e; }
    return rows[sym];
  }
  async function run(keep) {
    const sym = norm($("sym").value);
    $("sym").value = sym;
    if (!sym) { $("msg").textContent = "銘柄コードを入力してください"; return; }
    if (location.protocol === "file:") { $("msg").innerHTML = "このファイルを直接開いても株価を取得できません。start.bat で起動した http://localhost:8787 で使ってください。"; return; }
    $("msg").textContent = "取得中…"; $("go").disabled = true;
    try {
      const r = await load1(sym, false);
      cur = sym; render(r); $("msg").textContent = ""; drawWatch();
    } catch (e) { $("msg").textContent = rows[sym]?.err || e.message; delete rows[sym]; }
    $("go").disabled = false;
  }
  $("live").onclick = async () => {
    const r = rows[cur]; if (!r || r.err) return;
    $("live").disabled = true; $("livemsg").textContent = "取得中…";
    try { await applyLive(r, cur); render(r); drawWatch(); } catch (e) { $("livemsg").textContent = "最新価格の取得に失敗: " + e.message; }
    $("live").disabled = false;
  };
  const recalcAll = () => { for (const k in rows) if (!rows[k].err) calc(rows[k]); if (rows[cur]) render(rows[cur]); drawWatch(); };
  $("usenews").onchange = recalcAll;

  const ago = (t) => { const m = Math.max(0, (Date.now() / 1000 - t) / 60); return m < 60 ? Math.round(m) + "分前" : m < 1440 ? Math.round(m / 60) + "時間前" : Math.round(m / 1440) + "日前"; };
  function renderNews(r) {
    const used = $("usenews").checked;
    const head = r.ns.count ? `<p class="warn">直近${r.ns.count}件の見出しスコア: <b class="${r.ns.score > 0.05 ? "up" : r.ns.score < -0.05 ? "dn" : ""}">${r.ns.score >= 0 ? "+" : ""}${r.ns.score.toFixed(2)}</b>(−1〜+1) ${used ? "→ 予測に反映中" : "→ 反映OFF"}</p>` : `<p class="warn">${r.newsErr ? "ニュース取得失敗: " + esc(r.newsErr) : "この銘柄の関連ニュースは見つかりませんでした(予測には反映されません)"}</p>`;
    $("news").innerHTML = head + "<ul>" + r.ns.items.slice(0, 10).map((it) => {
      const tag = it.s > 0 ? '<span class="up">好</span>' : it.s < 0 ? '<span class="dn">悪</span>' : '<span class="warn">中</span>';
      const link = /^https?:\/\//.test(it.link || "") ? `<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>` : esc(it.title);
      return `<li>${tag} ${link} <small class="warn">${esc(it.publisher || "")} ${it.t ? ago(it.t) : ""}</small></li>`;
    }).join("") + "</ul>";
  }

  function render(r) {
    const d = r.d, closes = r.closes, f = r.f;
    $("out").hidden = false;
    $("name").textContent = `${d.name} (${d.symbol}) 通貨: ${d.currency}`;
    if (r.live) {
      const ch = r.live.prevClose ? (r.live.price / r.live.prevClose - 1) : null;
      const hm = (ms) => new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      const lag = Math.max(0, Math.round(((r.live.got || Date.now()) - r.live.time * 1000) / 60000));
      $("livemsg").innerHTML = `最新価格 <b>${fmt(r.live.price)}</b>${ch == null ? "" : " (前日比 " + pct(ch) + ")"} / 約定時刻 ${hm(r.live.time * 1000)} ・ 取得 ${hm(r.live.got || Date.now())} → <b>約${lag}分遅れ</b>のデータ <small>(無料データは取引所の仕様で10〜20分遅れが普通)</small>`;
    } else $("livemsg").textContent = "表示は前営業日までの終値です。「最新価格に更新」で現在の価格を反映できます。";
    const e = f.expected, sg = f.sig, cls = sg.label === "強気" ? "up" : sg.label === "弱気" ? "dn" : "";
    $("kpis").innerHTML = [
      [r.live ? "現在値(最新)" : "現在値(終値)", fmt(f.last)],
      [`${f.H}営業日後 中央値`, `${fmt(e.mid)} ${pct(e.retMid)}`],
      ["90%予測レンジ", `${fmt(e.low)} 〜 ${fmt(e.high)}`],
      ["上昇確率", `${(f.mc.probUp * 100).toFixed(0)}%`],
      ["年率ボラ(推定)", `${(f.mc.sigmaDaily * Math.sqrt(252) * 100).toFixed(0)}%`],
      ["総合シグナル", `<span class="${cls}">${sg.label}</span>`],
    ].map(([k, v]) => `<div class="kpi"><small>${k}</small><b>${v}</b></div>`).join("");
    $("score").textContent = `スコア ${sg.score > 0 ? "+" : ""}${sg.score} / ±${f.news ? 5 : 4}`;
    $("why").innerHTML = (sg.why.length ? sg.why : ["目立ったシグナルなし"]).concat([`SMA20 ${fmt(sg.sma20)} / SMA50 ${fmt(sg.sma50)} / RSI ${sg.rsi.toFixed(0)}`]).map((w) => `<li>${w}</li>`).join("");
    renderNews(r);
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
  $("hor").onchange = recalcAll;
})();
