'use strict';
/* 株サポ: 株取引サポートアプリ (VWAP / 移動平均 / RSI / 信用残高 / 出来高) */

// ---------- 指標計算 ----------
const sma = (a, n) => a.map((_, i) => i < n - 1 ? null : a.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n);

function rsi(closes, n = 14) {
  const out = Array(closes.length).fill(null);
  if (closes.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; d >= 0 ? g += d : l -= d; }
  g /= n; l /= n;
  const val = () => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  out[n] = val();
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

// 日中: 当日累積VWAP / 日足: 直近n日のローリングVWAP
function vwap(bars, rolling) {
  const tp = b => (b.h + b.l + b.c) / 3;
  if (!rolling) {
    let pv = 0, v = 0;
    return bars.map(b => { pv += tp(b) * b.v; v += b.v; return v ? pv / v : null; });
  }
  return bars.map((_, i) => {
    if (i < rolling - 1) return null;
    const s = bars.slice(i - rolling + 1, i + 1);
    const v = s.reduce((a, b) => a + b.v, 0);
    return v ? s.reduce((a, b) => a + tp(b) * b.v, 0) / v : null;
  });
}

// ---------- デモデータ(疑似) ----------
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const gauss = r => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const iso = d => d.toISOString().slice(0, 10);

function genStock(code, name, base, vol, seed) {
  const r = rng(seed), daily = [];
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  const days = [];
  while (days.length < 160) { if (d.getUTCDay() % 6) days.unshift(iso(d)); d.setUTCDate(d.getUTCDate() - 1); }
  let p = base * 0.9, trend = 0;
  days.forEach(date => {
    trend = trend * 0.95 + gauss(r) * 0.002;
    const o = p * (1 + gauss(r) * 0.004), ret = trend + gauss(r) * vol;
    const c = o * (1 + ret);
    const h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * 0.005);
    const l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * 0.005);
    const v = Math.round(base < 5000 ? 8e6 : 2e6) * Math.exp(gauss(r) * 0.3 + Math.abs(ret) * 25);
    daily.push({ t: date, o, h, l, c, v: Math.round(v) });
    p = c;
  });
  const last = daily[daily.length - 1];
  // 5分足(当日: 9:00-11:30, 12:30-15:30)
  const intra = []; let q = last.o, total = last.v;
  const slots = [];
  for (let m = 540; m < 690; m += 5) slots.push(m);
  for (let m = 750; m < 930; m += 5) slots.push(m);
  const w = slots.map(m => 1 + 2.2 * Math.exp(-(m - 540) / 25) + 1.8 * Math.exp(-(930 - m) / 25) + 0.4 * Math.exp(-Math.abs(m - 750) / 10));
  const ws = w.reduce((a, b) => a + b, 0);
  const drift = Math.log(last.c / last.o) / slots.length;
  slots.forEach((m, i) => {
    const o = q, c = o * Math.exp(drift + gauss(r) * vol / 7);
    const h = Math.max(o, c) * (1 + Math.abs(gauss(r)) * 0.0007), l = Math.min(o, c) * (1 - Math.abs(gauss(r)) * 0.0007);
    const v = Math.round(total * w[i] / ws * (0.7 + r() * 0.6));
    intra.push({ t: `${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`, o, h, l, c, v });
    q = c;
  });
  // 信用残高(週次・金曜)
  const margin = []; let buy = base < 5000 ? 2.0e7 : 4e6, sell = buy * (0.3 + r() * 0.8);
  const wk = new Date(); wk.setUTCDate(wk.getUTCDate() - ((wk.getUTCDay() + 2) % 7));
  for (let i = 25; i >= 0; i--) {
    const dt = new Date(wk); dt.setUTCDate(dt.getUTCDate() - 7 * i);
    buy *= 1 + gauss(r) * 0.05; sell *= 1 + gauss(r) * 0.07;
    margin.push({ t: iso(dt), buy: Math.round(buy), sell: Math.round(sell) });
  }
  return { code, name, demo: true, daily, intra, margin };
}

const DEMO = () => [
  genStock('7203', 'トヨタ自動車', 3000, 0.013, 7203),
  genStock('6758', 'ソニーグループ', 3500, 0.015, 6758),
  genStock('8306', '三菱UFJ FG', 2200, 0.014, 8306),
  genStock('9984', 'ソフトバンクG', 9000, 0.022, 9984),
  genStock('7974', '任天堂', 12000, 0.017, 7974),
];

// ---------- 保存 ----------
const KEY = 'kabusapo.custom.v1';
const loadCustom = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
const saveCustom = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} };

let stocks = [], cur = null, tf = 'D', range = 60, hover = null, view = null;
const $ = id => document.getElementById(id);
const fmt = (x, d = 0) => x == null ? '-' : x.toLocaleString('ja-JP', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtVol = v => v < 0 ? '-' + fmtVol(-v) : v >= 1e8 ? fmt(v / 1e8, 2) + '億' : v >= 1e4 ? fmt(v / 1e4, 0) + '万' : fmt(v);
const pd = p => p >= 1000 ? 0 : p >= 100 ? 1 : 2;

// ---------- 計算まとめ ----------
function compute(s) {
  const bars = tf === 'D' ? s.daily : (s.intra.length ? s.intra : []);
  const closes = bars.map(b => b.c);
  const ind = {
    bars,
    ma: tf === 'D' ? [5, 25, 75].map(n => ({ n, d: sma(closes, n) })) : [5, 25].map(n => ({ n, d: sma(closes, n) })),
    vwap: tf === 'D' ? vwap(bars, 20) : vwap(bars, 0),
    rsi: rsi(closes, 14),
    volAvg: sma(bars.map(b => b.v), 20),
  };
  return ind;
}

// ---------- AI判定(ルールベース) ----------
function judge(s) {
  const D = s.daily, c = D.map(b => b.c), n = c.length - 1;
  if (n < 30) return null;
  const m5 = sma(c, 5), m25 = sma(c, 25), r = rsi(c), va = vwap(D, 20), vv = sma(D.map(b => b.v), 20);
  const why = []; let sc = 0;
  const add = (p, t) => { sc += p; why.push([p, t]); };

  c[n] > m25[n] ? add(15, `終値が25日線を上回る(乖離 ${fmt((c[n] / m25[n] - 1) * 100, 1)}%)`) : add(-15, `終値が25日線を下回る(乖離 ${fmt((c[n] / m25[n] - 1) * 100, 1)}%)`);
  m5[n] > m25[n] ? add(15, '5日線が25日線の上(短期上向き)') : add(-15, '5日線が25日線の下(短期下向き)');
  for (let i = n; i > n - 3; i--) {
    if (m5[i - 1] <= m25[i - 1] && m5[i] > m25[i]) { add(10, `直近${n - i + 1}日以内にゴールデンクロス`); break; }
    if (m5[i - 1] >= m25[i - 1] && m5[i] < m25[i]) { add(-10, `直近${n - i + 1}日以内にデッドクロス`); break; }
  }
  m25[n] > m25[n - 5] ? add(10, '25日線が上向き') : add(-10, '25日線が下向き');

  const R = r[n];
  if (R >= 80) add(-25, `RSI ${fmt(R, 1)}: 買われ過ぎ(強い過熱)`);
  else if (R >= 70) add(-12, `RSI ${fmt(R, 1)}: 買われ過ぎ圏`);
  else if (R <= 20) add(25, `RSI ${fmt(R, 1)}: 売られ過ぎ(反発余地)`);
  else if (R <= 30) add(12, `RSI ${fmt(R, 1)}: 売られ過ぎ圏`);
  else if (R >= 50) add(8, `RSI ${fmt(R, 1)}: 50超で買い優勢`);
  else add(-8, `RSI ${fmt(R, 1)}: 50未満で売り優勢`);

  c[n] > va[n] ? add(10, `終値が20日VWAP(${fmt(va[n], pd(va[n]))})より上=平均取得コスト超え`) : add(-10, `終値が20日VWAP(${fmt(va[n], pd(va[n]))})より下=戻り売り圧力`);

  const vr = D[n].v / vv[n], up = c[n] >= c[n - 1];
  if (vr >= 1.5) up ? add(10, `出来高が平均の${fmt(vr, 1)}倍で上昇(買い本気)`) : add(-10, `出来高が平均の${fmt(vr, 1)}倍で下落(売り圧力)`);
  else if (vr <= 0.6) why.push([0, `出来高は平均の${fmt(vr, 1)}倍と閑散(方向感に欠ける)`]);

  const m = s.margin;
  if (m && m.length) {
    const L = m[m.length - 1], ratio = L.sell ? L.buy / L.sell : null;
    if (ratio != null) {
      if (ratio >= 5) add(-10, `信用倍率 ${fmt(ratio, 2)}倍: 買い残が重く将来の売り圧力`);
      else if (ratio <= 1.5) add(8, `信用倍率 ${fmt(ratio, 2)}倍: 売り残が多く踏み上げ余地`);
      else why.push([0, `信用倍率 ${fmt(ratio, 2)}倍: 需給は中立圏`]);
    }
  }
  sc = Math.max(-100, Math.min(100, sc));
  const label = sc >= 50 ? '強気' : sc >= 20 ? 'やや強気' : sc > -20 ? '中立' : sc > -50 ? 'やや弱気' : '弱気';
  return { sc, label, why };
}

function renderAI(s) {
  const j = judge(s), el = $('ai');
  if (!j) { el.innerHTML = '<h2>テクニカル総合判定</h2>データ不足(30本以上必要)'; return; }
  const col = j.sc >= 20 ? 'up' : j.sc <= -20 ? 'dn' : '';
  el.innerHTML = `<h2>テクニカル総合判定(ルールベース)</h2>
    <div class="score"><span class="badge ${col}">${j.label}</span>
    <div class="bar"><i style="left:${(j.sc + 100) / 2}%"></i></div><b>${j.sc > 0 ? '+' : ''}${j.sc}</b></div>
    <ul>${j.why.map(([p, t]) => `<li class="${p > 0 ? 'up' : p < 0 ? 'dn' : ''}">${p > 0 ? '▲' : p < 0 ? '▼' : '・'} ${t}</li>`).join('')}</ul>`;
}

// ---------- 描画 ----------
function setupCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h); return { g, w, h };
}
const COL = { up: '#ef4444', dn: '#22c55e', ma5: '#facc15', ma25: '#38bdf8', ma75: '#c084fc', vwap: '#fb923c', grid: '#1f2a3d', tx: '#7b8aa3' };

function drawChart() {
  const cv = $('chart'), { g, w, h } = setupCanvas(cv), s = cur;
  const I = compute(s), total = I.bars.length;
  if (!total) { g.fillStyle = COL.tx; g.fillText('データがありません', 10, 20); return; }
  const N = tf === 'D' ? Math.min(range, total) : total, off = total - N;
  const sl = a => a.slice(off);
  const bars = sl(I.bars), vw = sl(I.vwap), rs = sl(I.rsi), mas = I.ma.map(m => ({ n: m.n, d: sl(m.d) }));
  view = { off, N, I };

  const padL = 4, padR = 52, gap = 6;
  const hP = (h - 2 * gap - 16) * 0.62, hV = (h - 2 * gap - 16) * 0.16, hR = (h - 2 * gap - 16) * 0.22;
  const yP = 0, yV = hP + gap, yR = hP + hV + 2 * gap;
  const x = i => padL + (i + 0.5) * (w - padL - padR) / N, bw = Math.max(1, (w - padL - padR) / N * 0.65);

  // 価格レンジ
  let lo = Infinity, hi = -Infinity;
  bars.forEach(b => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
  [...mas.map(m => m.d), vw].forEach(a => a.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
  const mg = (hi - lo) * 0.06 || 1; lo -= mg; hi += mg;
  const py = v => yP + 8 + (hi - v) / (hi - lo) * (hP - 8);

  g.font = '10px sans-serif'; g.textAlign = 'left';
  // グリッド+価格軸
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, y = py(v);
    g.strokeStyle = COL.grid; g.beginPath(); g.moveTo(0, y); g.lineTo(w - padR, y); g.stroke();
    g.fillStyle = COL.tx; g.fillText(fmt(v, pd(v)), w - padR + 4, y + 3);
  }
  // ローソク
  bars.forEach((b, i) => {
    const c = b.c >= b.o ? COL.up : COL.dn; g.strokeStyle = g.fillStyle = c;
    g.beginPath(); g.moveTo(x(i), py(b.h)); g.lineTo(x(i), py(b.l)); g.stroke();
    const t = py(Math.max(b.o, b.c)), bt = py(Math.min(b.o, b.c));
    g.fillRect(x(i) - bw / 2, t, bw, Math.max(1, bt - t));
  });
  const line = (arr, color, wd = 1.3, Y = py) => {
    g.strokeStyle = color; g.lineWidth = wd; g.beginPath(); let st = false;
    arr.forEach((v, i) => { if (v == null) { st = false; return; } st ? g.lineTo(x(i), Y(v)) : g.moveTo(x(i), Y(v)); st = true; });
    g.stroke(); g.lineWidth = 1;
  };
  mas.forEach(m => line(m.d, COL['ma' + m.n]));
  line(vw, COL.vwap, 1.8);

  // 出来高
  const vmax = Math.max(...bars.map(b => b.v)) * 1.05;
  const vy = v => yV + hV - v / vmax * hV;
  g.fillStyle = COL.tx; g.fillText('出来高 ' + fmtVol(vmax), 4, yV + 10);
  bars.forEach((b, i) => {
    g.fillStyle = (b.c >= b.o ? COL.up : COL.dn) + 'aa';
    g.fillRect(x(i) - bw / 2, vy(b.v), bw, yV + hV - vy(b.v));
  });
  const va = sl(I.volAvg); g.strokeStyle = '#e2e8f0'; g.setLineDash([3, 3]); g.beginPath(); let st = false;
  va.forEach((v, i) => { if (v == null) { st = false; return; } st ? g.lineTo(x(i), vy(v)) : g.moveTo(x(i), vy(v)); st = true; });
  g.stroke(); g.setLineDash([]);

  // RSI
  const ry = v => yR + (100 - v) / 100 * hR;
  g.fillStyle = 'rgba(239,68,68,.08)'; g.fillRect(0, ry(100), w - padR, ry(70) - ry(100));
  g.fillStyle = 'rgba(34,197,94,.08)'; g.fillRect(0, ry(30), w - padR, ry(0) - ry(30));
  [30, 50, 70].forEach(v => { g.strokeStyle = COL.grid; g.beginPath(); g.moveTo(0, ry(v)); g.lineTo(w - padR, ry(v)); g.stroke(); g.fillStyle = COL.tx; g.fillText(v, w - padR + 4, ry(v) + 3); });
  g.fillStyle = COL.tx; g.fillText('RSI(14)', 4, yR + 10);
  line(rs, '#f472b6', 1.5, ry);

  // X軸ラベル
  g.fillStyle = COL.tx; g.textAlign = 'center';
  const step = Math.ceil(N / 5);
  for (let i = 0; i < N; i += step) g.fillText(tf === 'D' ? bars[i].t.slice(5) : bars[i].t, x(i), h - 2);

  // クロスヘア
  const hi_ = hover == null ? N - 1 : Math.max(0, Math.min(N - 1, hover));
  if (hover != null) {
    g.strokeStyle = '#94a3b8'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x(hi_), 0); g.lineTo(x(hi_), yR + hR); g.stroke(); g.setLineDash([]);
  }
  // 凡例と読み取り
  $('legend').innerHTML = mas.map(m => `<span><b style="background:${COL['ma' + m.n]}"></b>MA${m.n}</span>`).join('') +
    `<span><b style="background:${COL.vwap}"></b>VWAP${tf === 'D' ? '(20日)' : '(当日)'}</span><span><b style="background:#f472b6"></b>RSI</span><span><b style="background:#e2e8f0"></b>出来高20平均</span>`;
  const b = bars[hi_], pv = hi_ > 0 ? bars[hi_ - 1].c : b.o, ch = (b.c / pv - 1) * 100;
  const dp = pd(b.c);
  $('readout').innerHTML = `<b>${b.t}</b> 始${fmt(b.o, dp)} 高${fmt(b.h, dp)} 安${fmt(b.l, dp)} 終${fmt(b.c, dp)} <span class="${ch >= 0 ? 'up' : 'dn'}">(${ch >= 0 ? '+' : ''}${fmt(ch, 2)}%)</span><br>` +
    mas.map(m => `MA${m.n} ${fmt(m.d[hi_], dp)}`).join(' / ') + ` / VWAP ${fmt(vw[hi_], dp)} / RSI ${fmt(rs[hi_], 1)} / 出来高 ${fmtVol(b.v)}`;
}

function drawMargin() {
  const m = cur.margin || [], cv = $('margin'), { g, w, h } = setupCanvas(cv);
  $('mLegend').innerHTML = `<span><b style="background:${COL.up}"></b>買い残</span><span><b style="background:${COL.dn}"></b>売り残</span><span><b style="background:#facc15"></b>信用倍率</span>`;
  if (!m.length) { g.fillStyle = COL.tx; g.fillText('信用残高データなし', 10, 20); $('mTable').innerHTML = ''; return; }
  const padR = 52, N = m.length, top = 8, bot = h - 14, bwid = (w - padR) / N;
  const mx = Math.max(...m.map(d => Math.max(d.buy, d.sell))) * 1.1;
  const y = v => bot - v / mx * (bot - top);
  g.font = '10px sans-serif'; g.fillStyle = COL.tx; g.fillText(fmtVol(mx), w - padR + 4, top + 8);
  m.forEach((d, i) => {
    const x0 = i * bwid + 1;
    g.fillStyle = COL.up + 'cc'; g.fillRect(x0, y(d.buy), bwid * 0.42, bot - y(d.buy));
    g.fillStyle = COL.dn + 'cc'; g.fillRect(x0 + bwid * 0.45, y(d.sell), bwid * 0.42, bot - y(d.sell));
  });
  const rat = m.map(d => d.sell ? d.buy / d.sell : null), rmx = Math.max(...rat.filter(v => v != null)) * 1.1;
  const ry = v => bot - v / rmx * (bot - top);
  g.strokeStyle = '#facc15'; g.lineWidth = 1.6; g.beginPath();
  rat.forEach((v, i) => v == null ? 0 : i ? g.lineTo(i * bwid + bwid * 0.45, ry(v)) : g.moveTo(i * bwid + bwid * 0.45, ry(v))); g.stroke(); g.lineWidth = 1;
  g.fillStyle = '#facc15'; g.fillText(fmt(rat[N - 1], 2) + '倍', w - padR + 4, ry(rat[N - 1]) + 3);
  g.fillStyle = COL.tx; g.textAlign = 'left';
  g.fillText(m[0].t.slice(5), 2, h - 2); g.textAlign = 'right'; g.fillText(m[N - 1].t.slice(5), w - padR, h - 2);

  const rows = m.slice(-4).reverse().map((d, i, a) => {
    const prev = m[m.length - 1 - i - 1], r = d.sell ? d.buy / d.sell : null;
    const df = prev ? d.buy - prev.buy : null;
    return `<tr><td>${d.t.slice(5)}</td><td>${fmtVol(d.buy)}</td><td>${fmtVol(d.sell)}</td><td>${fmt(r, 2)}倍</td><td class="${df > 0 ? 'up' : df < 0 ? 'dn' : ''}">${df == null ? '-' : (df > 0 ? '+' : '') + fmtVol(df)}</td></tr>`;
  }).join('');
  $('mTable').innerHTML = `<tr><th>週</th><th>買残</th><th>売残</th><th>倍率</th><th>買残前週比</th></tr>${rows}`;
}

function renderStats() {
  const D = cur.daily, c = D.map(b => b.c), n = c.length - 1;
  const m5 = sma(c, 5)[n], m25 = sma(c, 25)[n], m75 = sma(c, 75)[n], va = vwap(D, 20)[n], r = rsi(c)[n];
  const vavg = sma(D.map(b => b.v), 20)[n], p = c[n], dp = pd(p);
  const dev = (a) => a ? `${fmt((p / a - 1) * 100, 1)}%` : '-';
  const row = (k, v, e = '') => `<tr><td>${k}</td><td>${v}</td><td>${e}</td></tr>`;
  const rsiTxt = r >= 70 ? '買われ過ぎ' : r <= 30 ? '売られ過ぎ' : '中立';
  $('stats').innerHTML =
    row('終値', fmt(p, dp)) + row('5日移動平均', fmt(m5, dp), dev(m5)) + row('25日移動平均', fmt(m25, dp), dev(m25)) +
    row('75日移動平均', fmt(m75, dp), dev(m75)) + row('VWAP(20日)', fmt(va, dp), dev(va)) +
    row('RSI(14)', fmt(r, 1), rsiTxt) + row('出来高', fmtVol(D[n].v), `平均比 ${fmt(D[n].v / vavg, 2)}倍`);
}

function renderQuote() {
  const D = cur.daily, b = D[D.length - 1], pv = D[D.length - 2].c, ch = b.c - pv, dp = pd(b.c);
  $('qName').textContent = `${cur.code} ${cur.name}`;
  $('qPrice').textContent = fmt(b.c, dp);
  $('qChg').textContent = `${ch >= 0 ? '+' : ''}${fmt(ch, dp)} (${ch >= 0 ? '+' : ''}${fmt(ch / pv * 100, 2)}%)`;
  $('qChg').className = ch >= 0 ? 'up' : 'dn';
  $('demoTag').textContent = cur.demo ? '※ デモ用の疑似データ' : '';
}

function renderAll() {
  hover = null; renderQuote(); renderAI(cur); drawChart(); drawMargin(); renderStats();
  $('delBtn').hidden = !!cur.demo;
}

// ---------- 銘柄選択・追加 ----------
function refreshSel(sel) {
  $('stockSel').innerHTML = stocks.map(s => `<option value="${s.code}">${s.code} ${s.name}${s.demo ? '' : ' ★'}</option>`).join('');
  if (sel) $('stockSel').value = sel;
}
function parseCSV(txt, intra) {
  return txt.trim().split(/\r?\n/).map(l => l.split(/[,\t]/).map(x => x.trim())).filter(r => r.length >= 5 && !isNaN(+r[1]))
    .map(r => ({ t: r[0].replace(/\//g, '-'), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +(r[5] || 0) }));
}
function parseMargin(txt) {
  return txt.trim() ? txt.trim().split(/\r?\n/).map(l => l.split(/[,\t]/).map(x => x.trim())).filter(r => r.length >= 3 && !isNaN(+r[1]))
    .map(r => ({ t: r[0].replace(/\//g, '-'), buy: +r[1], sell: +r[2] })) : [];
}

$('stockSel').onchange = e => { cur = stocks.find(s => s.code === e.target.value); renderAll(); };
$('addBtn').onclick = () => $('dlg').showModal();
$('addForm').onsubmit = e => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  const daily = parseCSV($('fDaily').value), intra = parseCSV($('fIntra').value), margin = parseMargin($('fMargin').value);
  if (daily.length < 30) { alert('日足は30本以上必要です'); e.preventDefault(); return; }
  const code = $('fCode').value.trim(), custom = loadCustom().filter(s => s.code !== code);
  custom.push({ code, name: $('fName').value.trim(), daily, intra, margin });
  saveCustom(custom); stocks = [...DEMO(), ...custom]; refreshSel(code);
  cur = stocks.find(s => s.code === code); renderAll(); $('addForm').reset();
};
$('delBtn').onclick = () => {
  if (!cur || cur.demo || !confirm(`${cur.name} を削除しますか?`)) return;
  saveCustom(loadCustom().filter(s => s.code !== cur.code)); init();
  $('dlg').close();
};
$('tfSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; tf = b.dataset.tf;
  [...$('tfSeg').children].forEach(x => x.classList.toggle('on', x === b));
  $('rangeSeg').style.display = tf === 'D' ? '' : 'none'; hover = null; drawChart(); };
$('rangeSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; range = +b.dataset.n;
  [...$('rangeSeg').children].forEach(x => x.classList.toggle('on', x === b)); hover = null; drawChart(); };

const cv = $('chart');
const pos = e => { const r = cv.getBoundingClientRect(); if (!view) return; const i = Math.floor((e.clientX - r.left - 4) / ((r.width - 56) / view.N)); hover = i; drawChart(); };
cv.addEventListener('pointerdown', pos); cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'mouse') pos(e); });
cv.addEventListener('pointerleave', () => { hover = null; drawChart(); });
addEventListener('resize', () => { drawChart(); drawMargin(); });

function init() {
  stocks = [...DEMO(), ...loadCustom()];
  cur = stocks[0]; refreshSel(cur.code); renderAll();
}
init();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
