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
  const padR = 52, N = m.length, top = 8, bot = h - 14, bwid = Math.min((w - padR) / N, 40), x00 = (w - padR) - bwid * N;
  const mx = Math.max(...m.map(d => Math.max(d.buy, d.sell))) * 1.1;
  const y = v => bot - v / mx * (bot - top);
  g.font = '10px sans-serif'; g.fillStyle = COL.tx; g.fillText(fmtVol(mx), w - padR + 4, top + 8);
  m.forEach((d, i) => {
    const x0 = x00 + i * bwid + 1;
    g.fillStyle = COL.up + 'cc'; g.fillRect(x0, y(d.buy), bwid * 0.42, bot - y(d.buy));
    g.fillStyle = COL.dn + 'cc'; g.fillRect(x0 + bwid * 0.45, y(d.sell), bwid * 0.42, bot - y(d.sell));
  });
  const rat = m.map(d => d.sell ? d.buy / d.sell : null), rmx = Math.max(...rat.filter(v => v != null)) * 1.1;
  const ry = v => bot - v / rmx * (bot - top);
  g.strokeStyle = '#facc15'; g.lineWidth = 1.6; g.beginPath();
  rat.forEach((v, i) => v == null ? 0 : i ? g.lineTo(x00 + i * bwid + bwid * 0.45, ry(v)) : g.moveTo(x00 + i * bwid + bwid * 0.45, ry(v))); g.stroke(); g.lineWidth = 1;
  if (N === 1) { g.fillStyle = '#facc15'; g.beginPath(); g.arc(x00 + bwid * 0.45, ry(rat[0]), 3, 0, 7); g.fill(); }
  g.fillStyle = '#facc15'; g.fillText(fmt(rat[N - 1], 2) + '倍', w - padR + 4, ry(rat[N - 1]) + 3);
  g.fillStyle = COL.tx; g.textAlign = 'left';
  if (N > 1) { g.fillText(m[0].t.slice(5), x00 + 2, h - 2); g.textAlign = 'right'; } else g.textAlign = 'right';
  g.fillText(m[N - 1].t.slice(5), w - padR, h - 2);
  if (N === 1) { g.textAlign = 'left'; g.fillText('週次の履歴は更新のたびに蓄積', 6, top + 8); }

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
  $('demoTag').textContent = statusText();
}

function renderAll() {
  hover = null; renderQuote(); renderAI(cur); renderStats(); renderTab();
  $('delBtn').hidden = !(cur.custom || cur.live);
}

// ---------- データ取得(スナップショット / ライブ API) ----------
const DEFAULT_CODES = ['7203', '6758', '8306', '9984', '7974'];
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const cfg = { proxy: store.get('kabusapo.proxy.v1', window.KABU_PROXY || ''), auto: store.get('kabusapo.auto.v1', true) };
let snapshot = null, busy = false, api = null, lastRefresh = 0, activeTab = 'tech';   // api: null=接続なし, '.'=同一サーバー, それ以外=中継URL

const watchList = () => store.get('kabusapo.watch.v1', null) || DEFAULT_CODES.slice();
function setStatus(t, cls = '') { const e = $('status'); e.textContent = t; e.className = 'status ' + cls; }
const hhmm = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function marketOpen() {   // 東証の場中(JST 9:00-11:30, 12:30-15:30、平日)。祝日は考慮しない
  const j = new Date(Date.now() + 9 * 3600e3), d = j.getUTCDay(), m = j.getUTCHours() * 60 + j.getUTCMinutes();
  return d > 0 && d < 6 && ((m >= 540 && m < 690) || (m >= 750 && m <= 930));
}

// 週次の信用残高は公表が最新週のみのため、更新のたびに端末へ蓄積する
function mergeMargin(code, latest) {
  const all = store.get('kabusapo.margin.v1', {}), m = new Map((all[code] || []).map(d => [d.t, d]));
  (latest || []).forEach(d => m.set(d.t, d));
  const out = [...m.values()].sort((x, y) => x.t < y.t ? -1 : 1).slice(-52);
  all[code] = out; store.set('kabusapo.margin.v1', all); return out;
}
const mergeDaily = (old, neu) => { const m = new Map(old.map(b => [b.t, b])); neu.forEach(b => m.set(b.t, b)); return [...m.values()].sort((x, y) => x.t < y.t ? -1 : 1); };

function adopt(st) {
  const i = stocks.findIndex(s => s.code === st.code), old = i >= 0 ? stocks[i] : null;
  if (st.quick && old && old.daily.length > 400) { st.daily = mergeDaily(old.daily, st.daily); st.perf = old.perf; }
  st.live = true; st.margin = mergeMargin(st.code, st.margin);
  i >= 0 ? stocks[i] = st : stocks.push(st);
  return st;
}
async function fetchLive(code, quick) {
  const r = await fetch(`${api.replace(/\/$/, '')}/api/stock?code=${encodeURIComponent(code)}${quick ? '&mode=quick' : ''}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return adopt(j);
}
async function detectApi() {
  if (window.KABU_ARTIFACT || location.protocol === 'file:') return null;
  if (cfg.proxy) return cfg.proxy.replace(/\/$/, '');
  try { const r = await fetch('api/ping', { cache: 'no-store' }); if (r.ok && (await r.json()).ok) return '.'; } catch {}
  return null;
}
const needFull = c => { const s = stocks.find(x => x.code === c); return !(s && s.live && s.daily.length > 400); };

async function refresh() {
  if (window.KABU_ARTIFACT) { setStatus('この画面は公開時点のスナップショットです。最新にするには、Claude に「株サポを更新して」と依頼してください。', 'err'); return; }
  if (api == null) { setStatus('最新データの取得には接続先が必要です(⚙ または README の手順)。いまは同梱データの表示です。', 'err'); return; }
  if (busy) return;
  busy = true; $('refBtn').classList.add('busy');
  const keep = cur && cur.code, codes = [...new Set([keep, ...watchList()].filter(Boolean))];
  let ok = 0, last = '';
  await Promise.all(codes.map(c => fetchLive(c, !needFull(c)).then(() => ok++).catch(e => { last = e.message; })));
  busy = false; $('refBtn').classList.remove('busy');
  if (!ok) {
    if (!stocks.length) { stocks = DEMO(); selectStock(); }
    setStatus('取得に失敗しました: ' + last, 'err'); document.body.classList.remove('loading'); return;
  }
  lastRefresh = Date.now();
  const w = watchList();
  stocks = stocks.filter(s => s.custom || w.includes(s.code) || s.code === keep && s.live);
  stocks.sort((x, y) => (w.indexOf(x.code) + 1 || 99) - (w.indexOf(y.code) + 1 || 99));
  selectStock(keep); document.body.classList.remove('loading');
  setStatus(`最新取得 ${hhmm(new Date())}(${ok}/${codes.length}銘柄)・自動更新 ${cfg.auto ? (marketOpen() ? '60秒毎' : '10分毎(場外)') : 'OFF'}`, 'ok');
}
function selectStock(code) { cur = stocks.find(s => s.code === code) || stocks[0]; refreshSel(cur.code); renderAll(); }

function statusText() {
  if (cur.demo) return '※ デモ用の疑似データ。接続先を設定すると実データになります。';
  const t = cur.fetchedAt ? hhmm(cur.fetchedAt) : '手入力';
  return `データ取得 ${t} / 日足は最終取引日 ${cur.daily[cur.daily.length - 1].t}` + (cur.intraDate ? ` / 5分足 ${cur.intraDate}` : '');
}

// ---------- ファンダメンタル分析 ----------
const yen = m => m == null ? '-' : Math.abs(m) >= 1e6 ? fmt(m / 1e6, 2) + '兆円' : fmt(m / 100, 0) + '億円';
const pct = (a, b) => (a != null && b != null && b > 0) ? (a / b - 1) * 100 : null;

function fundAnalysis(s) {
  const f = s.fund; if (!f) return null;
  const P = (s.perf || []), a = P[0], b = P[1];
  const sg = pct(a && a.sales, b && b.sales), og = pct(a && a.op, b && b.op);
  const opm = a && a.sales ? a.op / a.sales * 100 : null;
  const ax = [];
  const add = (name, lv, why) => ax.push({ name, lv, why });   // lv: 1=良, 0=普通, -1=注意

  // バリュー
  { const per = f.per, pbr = f.pbr; let lv = 0, why = [];
    if (per == null) { lv = -1; why.push('PER算出不可(赤字または予想なし)'); }
    else if (per < 12) { why.push(`PER ${fmt(per, 1)}倍は割安圏`); lv++; } else if (per > 25) { why.push(`PER ${fmt(per, 1)}倍は割高圏`); lv--; } else why.push(`PER ${fmt(per, 1)}倍は標準的`);
    if (pbr != null) { if (pbr < 1) { why.push(`PBR ${fmt(pbr, 2)}倍は解散価値割れ`); lv++; } else if (pbr > 4) { why.push(`PBR ${fmt(pbr, 2)}倍は高め`); lv--; } else why.push(`PBR ${fmt(pbr, 2)}倍`); }
    add('バリュー', Math.max(-1, Math.min(1, lv)), why.join('。')); }
  // 収益性
  { let lv = 0, why = [];
    if (f.roe != null) { if (f.roe >= 10) { lv++; why.push(`ROE ${fmt(f.roe, 1)}%(10%以上)`); } else if (f.roe < 5) { lv--; why.push(`ROE ${fmt(f.roe, 1)}%(5%未満)`); } else why.push(`ROE ${fmt(f.roe, 1)}%`); }
    if (opm != null) { if (opm >= 10) { lv++; why.push(`営業利益率 ${fmt(opm, 1)}%`); } else if (opm < 3) { lv--; why.push(`営業利益率 ${fmt(opm, 1)}%(低い)`); } else why.push(`営業利益率 ${fmt(opm, 1)}%`); }
    add('収益性', Math.max(-1, Math.min(1, lv)), why.join('。') || 'データなし'); }
  // 安全性
  { let lv = 0, why = '自己資本比率のデータなし';
    if (f.equityRatio != null) { lv = f.equityRatio >= 40 ? 1 : f.equityRatio < 20 ? -1 : 0; why = `自己資本比率 ${fmt(f.equityRatio, 1)}%` + (lv > 0 ? '(40%以上で健全)' : lv < 0 ? '(20%未満で財務に注意。金融業は構造上低くなります)' : ''); }
    add('安全性', lv, why); }
  // 成長性(良い面と悪い面が混ざるときは「普通」)
  { let pos = 0, neg = 0, why = [];
    const tag = a && a.forecast ? '会社予想' : '直近期';
    if (sg != null) { why.push(`売上高 ${tag}は前期比 ${sg >= 0 ? '+' : ''}${fmt(sg, 1)}%`); if (sg >= 5) pos++; else if (sg <= -5) neg++; }
    if (og != null) { why.push(`営業利益 ${og >= 0 ? '+' : ''}${fmt(og, 1)}%`); if (og >= 10) pos++; else if (og <= -5) neg++; }
    add('成長性', pos && !neg ? 1 : neg && !pos ? -1 : 0, why.join('。') || '業績データなし'); }
  // 株主還元
  { const y = f.divYield; add('株主還元', y != null && y >= 3 ? 1 : 0, y == null ? '配当データなし' : `配当利回り ${fmt(y, 2)}%` + (y >= 3 ? '(3%以上)' : y < 1 ? '(低め。成長投資型の可能性)' : '')); }
  const score = ax.reduce((t, x) => t + x.lv, 0);
  const label = score >= 3 ? '良好' : score >= 1 ? 'やや良好' : score > -1 ? '中立' : score > -3 ? 'やや注意' : '注意';
  return { ax, score, label, sg, og, opm };
}

const LV = { 1: ['良', 'good'], 0: ['普通', 'mid'], '-1': ['注意', 'bad'] };
function renderFund() {
  const s = cur, F = fundAnalysis(s);
  if (!F) {
    $('fundVerdict').innerHTML = '<h2>ファンダメンタル</h2>この銘柄のファンダメンタルデータがありません(デモ・CSV銘柄、または未取得)。接続先を設定して最新データを取得すると表示されます。';
    $('fundAxes').innerHTML = ''; $('fundTable').innerHTML = ''; $('perfTable').innerHTML = ''; return;
  }
  const j = judge(s), tsc = j ? j.sc : 0, fs = F.score;
  let comment;
  if (fs >= 2 && tsc >= 20) comment = 'ファンダ・テクニカルとも良好。順張りで検討しやすい局面です。';
  else if (fs >= 2 && tsc <= -20) comment = 'ファンダは良好ですがトレンドは下向き。25日線の回復やゴールデンクロスなど、底打ちの確認を待つ局面です。';
  else if (fs <= -2 && tsc >= 20) comment = '株価は上向きですが、業績・財務面に不安があります。短期の値動き重視で、損切りを厳格にしてください。';
  else if (fs <= -2 && tsc <= -20) comment = 'ファンダ・テクニカルとも弱い状態。見送りが妥当です。';
  else comment = 'どちらかが中立で決め手に欠けます。「戦略」タブのシグナルが点灯するまで待つのが無難です。';
  const cls = fs >= 1 ? 'up' : fs <= -1 ? 'dn' : '';
  $('fundVerdict').innerHTML = `<h2>ファンダ × テクニカル 総合コメント</h2>
    <div class="kv"><div>ファンダ: <b class="${cls}">${F.label}</b>(${fs > 0 ? '+' : ''}${fs})</div><div>テクニカル: <b>${j ? j.label : '-'}</b>(${tsc > 0 ? '+' : ''}${tsc})</div></div><p>${comment}</p>
    <p class="hint">評価は一般的な目安による機械的な判定です。業種によって基準は異なります(銀行は自己資本比率が低く、成長株はPERが高く出ます)。</p>`;
  $('fundAxes').innerHTML = F.ax.map(x => { const [t, c] = LV[x.lv]; return `<div class="axis"><div class="hd"><span class="chip ${c}">${t}</span><b>${x.name}</b></div><div class="why">${x.why}</div></div>`; }).join('');

  const f = s.fund, p = s.daily[s.daily.length - 1].c;
  const pos = f.yHigh && f.yLow && f.yHigh > f.yLow ? (p - f.yLow) / (f.yHigh - f.yLow) * 100 : null;
  const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  $('fundTable').innerHTML =
    row('PER(会社予想)', f.per != null ? fmt(f.per, 2) + '倍' : '-') + row('PBR(実績)', f.pbr != null ? fmt(f.pbr, 2) + '倍' : '-') +
    row('EPS(予想)', f.eps != null ? fmt(f.eps, 2) + '円' : '-') + row('BPS(実績)', f.bps != null ? fmt(f.bps, 2) + '円' : '-') +
    row('ROE(実績)', f.roe != null ? fmt(f.roe, 2) + '%' : '-') + row('自己資本比率', f.equityRatio != null ? fmt(f.equityRatio, 1) + '%' : '-') +
    row('配当利回り(予想)', f.divYield != null ? fmt(f.divYield, 2) + '%' : '-') + row('1株配当(予想)', f.dps != null ? fmt(f.dps, 1) + '円' : '-') +
    row('時価総額', yen(f.mcap)) + row('年初来高値 / 安値', `${fmt(f.yHigh, 0)} / ${fmt(f.yLow, 0)}`) +
    row('年初来レンジでの位置', pos != null ? fmt(pos, 0) + '%(0%=安値, 100%=高値)' : '-') +
    row('単元株数 / 最低購入代金', `${fmt(f.lot)}株 / ${fmt(f.minBuy)}円`);

  const P = s.perf || [];
  $('perfTable').innerHTML = P.length ? '<tr><th>期</th><th>売上高</th><th>営業利益</th><th>営業利益率</th><th>純利益</th><th>売上前期比</th></tr>' +
    P.slice(0, 4).map((r, i) => { const g = pct(r.sales, P[i + 1] && P[i + 1].sales);
      return `<tr><td>${r.fy}${r.forecast ? '<small>(予想)</small>' : ''}</td><td>${yen(r.sales)}</td><td>${yen(r.op)}</td><td>${r.sales ? fmt(r.op / r.sales * 100, 1) + '%' : '-'}</td><td>${yen(r.ni)}</td><td class="${g > 0 ? 'up' : g < 0 ? 'dn' : ''}">${g == null ? '-' : (g >= 0 ? '+' : '') + fmt(g, 1) + '%'}</td></tr>`; }).join('') : '<tr><td>業績データなし</td></tr>';
}

// ---------- バックテスト・戦略 ----------
let btCache = null, btAll = false;
function getBT() {
  const list = stocks.filter(s => s.daily && s.daily.length > BT.WARMUP + 250);
  const key = list.map(s => s.code + s.daily.length + s.daily[s.daily.length - 1].t).join();
  if (btCache && btCache.key === key) return btCache.r;
  const r = list.length ? BT.run(list) : null; btCache = { key, r }; return r;
}
const f2 = (x, d = 2) => fmt(x, d);
const exitText = (c, k) => ({ tp2: `${k}ATR損切り・2R利確`, tp3: `${k}ATR損切り・3R利確`, trail: `${k}ATR損切り・トレーリング`, sig: `${k}ATR損切り・指標で手仕舞い` })[c];

function renderBT() {
  const r = getBT(), A = $('btAdopt');
  if (!r) { A.innerHTML = '<h2>採用戦略</h2>バックテストには10年分の実データが必要です(デモ・CSV銘柄は対象外)。接続先を設定して最新データを取得してください。'; ['btPlan', 'btNotes'].forEach(i => $(i).innerHTML = ''); $('btTable').innerHTML = ''; $('btMore').hidden = true; clearCanvas($('btCurve')); return; }
  const ad = r.adopted, C = BT.CRITERIA;
  const stat = (t, a) => `<tr><td>${t}</td><td>${a[0]}</td><td>${a[1]}</td></tr>`;
  if (ad) {
    const S = BT.STRATEGIES[ad.cand.id], i = ad.is, o = ad.oos;
    A.innerHTML = `<h2>採用戦略(バックテストで選定)</h2>
      <div class="big">${S.name}</div><div class="kv"><div>${exitText(ad.cand.exit, ad.cand.k)}</div></div>
      <p class="hint">エントリー条件: ${S.desc}。翌営業日の寄付で買い。1R=エントリーから損切りまでの値幅。</p>
      <table><tr><th></th><th>前半(選定)</th><th>後半(検証)</th></tr>
      ${stat('取引数', [i.n, o.n])}${stat('勝率', [f2(i.win * 100, 0) + '%', f2(o.win * 100, 0) + '%'])}
      ${stat('平均利益 / 平均損失(R)', [`+${f2(i.avgW)} / -${f2(i.avgL)}`, `+${f2(o.avgW)} / -${f2(o.avgL)}`])}
      ${stat('<b>実現リスクリワード</b>', [`<b>${f2(i.rr)}</b>`, `<b>${f2(o.rr)}</b>`])}${stat('プロフィットファクター', [f2(i.pf), f2(o.pf)])}
      ${stat('期待値(R/回)', [f2(i.exp), f2(o.exp)])}${stat('最大ドローダウン(R)', [f2(i.mdd, 1), f2(o.mdd, 1)])}</table>`;
  } else {
    const best = r.eligible[0];
    A.innerHTML = `<h2>採用戦略</h2><div class="big dn">採用なし</div><p>前半で基準を満たした候補が後半の検証で基準を割り込んだ、または前半で基準を満たす候補がありませんでした。優位性を確認できない戦略は採用しません。${best ? `<br>参考: 前半の最上位は「${best.cand.label}」(後半 PF ${f2(best.oos.pf)}、リスクリワード ${f2(best.oos.rr)})です。` : ''}</p>`;
  }
  $('btMore').hidden = false; renderPlan(r); drawCurve(r); renderBtTable(r); renderBtNotes(r);
}

function renderPlan(r) {
  const el = $('btPlan'), ad = r.adopted;
  if (!ad) { el.innerHTML = ''; return; }
  const sg = BT.currentSignal(cur, ad.cand);
  if (!sg) { el.innerHTML = `<h2>${cur.code} ${cur.name} の売買プラン</h2>この銘柄は日足のデータが不足しています。`; return; }
  const S = BT.STRATEGIES[ad.cand.id], c = store.get('kabusapo.calc.v1', { cap: 3000000, risk: 1 });
  const stopP = (sg.stop / sg.entry - 1) * 100, tgt = sg.target ? `¥${fmt(sg.target, pd(sg.target))}(${fmt((sg.target / sg.entry - 1) * 100, 1)}%)` : (ad.cand.exit === 'trail' ? '利確は固定せず、高値からATR×3下にストップを切り上げ(トレーリング)' : '5日線が25日線を割ったら翌寄付で手仕舞い');
  const per = ad.per[cur.code], lot = cur.fund && cur.fund.lot || 100;
  el.innerHTML = `<h2>${cur.code} ${cur.name} の売買プラン <span class="sig ${sg.on ? 'on' : 'off'}">${sg.on ? '買いシグナル点灯' : 'シグナルなし'}</span></h2>
    <p class="hint">${sg.on ? `${sg.date} の終値でエントリー条件を満たしています。` : `${sg.date} 時点では条件(${S.desc})を満たしていません。下記は「いま入る場合の目安」です。`}</p>
    <div class="plan">エントリー: 翌営業日の寄付(目安 <b>¥${fmt(sg.entry, pd(sg.entry))}</b>)<br>
      損切り: <b>¥${fmt(sg.stop, pd(sg.stop))}</b>(${fmt(stopP, 1)}%)<br>利確: <b>${tgt}</b>${sg.rr ? `<br>リスクリワード: <b>1 : ${sg.rr}</b>` : ''}</div>
    <div class="calc"><label>資金(円)<input id="calcCap" inputmode="numeric" value="${c.cap}"></label><label>1回の許容損失(%)<input id="calcRisk" inputmode="decimal" value="${c.risk}"></label></div>
    <div id="calcOut" class="plan"></div>
    ${per && per.n ? `<p class="hint">この銘柄での過去成績: ${per.n}回 / 勝率${f2(per.win * 100, 0)}% / PF ${f2(per.pf)} / 期待値 ${f2(per.exp)}R</p>` : ''}`;
  const calc = () => {
    const cap = +$('calcCap').value.replace(/,/g, ''), rk = +$('calcRisk').value; store.set('kabusapo.calc.v1', { cap, risk: rk });
    const per1 = sg.entry - sg.stop, loss = cap * rk / 100, sh = Math.floor(loss / per1 / lot) * lot, amt = sh * sg.entry;
    $('calcOut').innerHTML = !(cap > 0 && rk > 0) ? '資金と許容損失を入力してください。' : sh > 0
      ? `許容損失 <b>¥${fmt(loss)}</b> → 購入株数の目安 <b>${fmt(sh)}株</b>(${fmt(sh / lot)}単元)<br>投入額 約¥${fmt(amt)}(資金の${fmt(amt / cap * 100, 0)}%)${amt > cap ? '<br><span class="dn">資金を超えています。株数を減らしてください。</span>' : ''}`
      : `この資金・許容損失では1単元(${fmt(lot)}株)も買えません。最低購入代金は約¥${fmt(sg.entry * lot)}、1単元の損切り時損失は約¥${fmt(per1 * lot)}です。`;
  };
  $('calcCap').oninput = $('calcRisk').oninput = calc; calc();
}

function clearCanvas(cv) { const { g } = setupCanvas(cv); return g; }
function drawCurve(r) {
  const ad = r.adopted, cv = $('btCurve'), { g, w, h } = setupCanvas(cv);
  $('btLegend').innerHTML = `<span><b style="background:#94a3b8"></b>前半(選定に使った期間)</span><span><b style="background:${COL.ma25}"></b>後半(未見データ)</span>`;
  if (!ad) { g.fillStyle = COL.tx; g.fillText('採用戦略なし', 10, 20); return; }
  const tr = [...ad.isT, ...ad.ooT].sort((a, b) => a.tx < b.tx ? -1 : 1);
  let eq = 0; const pts = tr.map(t => (eq += t.r, eq)), n = pts.length;
  const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), padR = 44, padT = 10, padB = 16;
  const x = i => 4 + i * (w - padR - 8) / Math.max(1, n - 1), y = v => padT + (hi - v) / (hi - lo || 1) * (h - padT - padB);
  g.font = '10px sans-serif'; g.strokeStyle = COL.grid; g.fillStyle = COL.tx;
  [lo, 0, hi].forEach(v => { g.beginPath(); g.moveTo(0, y(v)); g.lineTo(w - padR, y(v)); g.stroke(); g.fillText(fmt(v, 0) + 'R', w - padR + 4, y(v) + 3); });
  const k = tr.findIndex(t => t.t >= r.cutDate);
  const seg = (a, b, col) => { g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath(); for (let i = a; i < b; i++) i === a ? g.moveTo(x(i), y(pts[i])) : g.lineTo(x(i), y(pts[i])); g.stroke(); g.lineWidth = 1; };
  const kk = k < 0 ? n : k;
  seg(0, kk, '#94a3b8'); if (kk < n) seg(Math.max(0, kk - 1), n, COL.ma25);
  if (kk > 0 && kk < n) { g.setLineDash([3, 3]); g.strokeStyle = '#64748b'; g.beginPath(); g.moveTo(x(kk), padT); g.lineTo(x(kk), h - padB); g.stroke(); g.setLineDash([]); g.textAlign = 'left'; g.fillText('検証開始 ' + r.cutDate.slice(0, 7), x(kk) + 4, padT + 8); }
  g.textAlign = 'center'; g.fillText(tr[0].tx.slice(0, 7), 24, h - 3); g.fillText(tr[n - 1].tx.slice(0, 7), w - padR - 20, h - 3);
  g.textAlign = 'left'; g.fillStyle = '#e2e8f0'; g.fillText('+' + fmt(pts[n - 1], 1) + 'R', w - padR + 4, y(pts[n - 1]) - 4);
}

function renderBtTable(r) {
  const rows = [...r.rows].sort((a, b) => (b === r.adopted) - (a === r.adopted) || (b.passIS - a.passIS) || b.is.exp - a.is.exp);
  const show = btAll ? rows : rows.slice(0, 10);
  $('btTable').innerHTML = '<tr><th>戦略</th><th>前半 PF/RR</th><th>後半 PF/RR</th><th>判定</th></tr>' + show.map(x => {
    const S = BT.STRATEGIES[x.cand.id], v = x === r.adopted ? '採用' : x.passIS && x.passOOS ? '基準OK' : x.passIS ? '検証NG' : '不合格';
    const cls = x === r.adopted ? 'good' : x.passIS && x.passOOS ? 'mid' : 'bad';
    return `<tr class="${x === r.adopted ? 'adopted-row' : ''}"><td>${S.name}<br><small>${exitText(x.cand.exit, x.cand.k)}</small></td><td>${f2(x.is.pf)} / ${f2(x.is.rr)}</td><td>${f2(x.oos.pf)} / ${f2(x.oos.rr)}</td><td><span class="chip ${cls}">${v}</span></td></tr>`;
  }).join('');
  $('btMore').textContent = btAll ? '上位だけ表示' : `すべて表示(${rows.length}件)`;
}

function renderBtNotes(r) {
  const ad = r.adopted, C = BT.CRITERIA, avg = r.bh.reduce((a, b) => a + b.ret, 0) / r.bh.length * 100;
  const o = ad && ad.oos, pctApprox = o ? o.totalR : null;
  $('btNotes').innerHTML = `<h2>検証の前提と注意</h2><ul class="bt-notes">
    <li>対象は登録中の${r.nStocks}銘柄・${r.from}〜${r.to}の日足。<b>前半60%(〜${r.cutDate})で選び、後半40%は未見データとして検証</b>しました。</li>
    <li>採用基準は結果を見る前に固定: 前半 取引${C.is.minTrades}件以上・期待値>${C.is.minExp}R・PF≥${C.is.minPF}・リスクリワード≥${C.is.minRR}。後半 ${C.oos.minTrades}件以上・期待値>0・PF≥${C.oos.minPF}・リスクリワード≥${C.oos.minRR}。基準を満たした中で期待値が最大のものを採用します。</li>
    <li>約定は翌営業日の始値、損切りは窓開けなら始値で約定、往復コスト${BT.COST * 100}%(手数料・スリッページ)を差し引き。配当・税金・空売りは考慮していません。</li>
    ${o ? `<li><b>買い持ちとの比較:</b> 後半の買い持ちは平均 +${fmt(avg, 0)}%。この戦略の後半成績は累計 ${f2(pctApprox, 1)}R(1回の損失を資金の1%にそろえると約 +${f2(pctApprox, 0)}%、最大ドローダウン約 ${f2(o.mdd, 0)}%)で、<b>上昇相場では買い持ちに及びません</b>。価値は、損失を限定して値動きに耐えやすくする点にあります。</li>` : ''}
    <li>候補${r.rows.length}件から選ぶため選択バイアスが残ります。少数の大型株・後半が上昇相場という偏りもあります。過去の成績は将来を保証しません。</li></ul>`;
}


// ---------- 銘柄選択・追加・タブ ----------
function refreshSel(sel) {
  $('stockSel').innerHTML = stocks.map(s => `<option value="${s.code}">${s.code} ${s.name}${s.custom ? ' ★' : ''}</option>`).join('');
  if (sel) $('stockSel').value = sel;
}
function parseCSV(txt) {
  return txt.trim().split(/\r?\n/).map(l => l.split(/[,\t]/).map(x => x.trim())).filter(r => r.length >= 5 && !isNaN(+r[1]))
    .map(r => ({ t: r[0].replace(/\//g, '-'), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +(r[5] || 0) }));
}
function parseMarginCSV(txt) {
  return txt.trim() ? txt.trim().split(/\r?\n/).map(l => l.split(/[,\t]/).map(x => x.trim())).filter(r => r.length >= 3 && !isNaN(+r[1]))
    .map(r => ({ t: r[0].replace(/\//g, '-'), buy: +r[1], sell: +r[2] })) : [];
}
const addErr = t => { $('addErr').textContent = t; };

function renderTab() {
  if (!cur) return;
  if (activeTab === 'tech') { drawChart(); drawMargin(); } else if (activeTab === 'fund') renderFund(); else renderBT();
}
function showTab(t) {
  activeTab = t;
  ['tech', 'fund', 'bt'].forEach(k => { $('tab-' + k).hidden = k !== t; });
  [...$('tabs').children].forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  renderTab();
}
$('tabs').onclick = e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); };
$('btMore').onclick = () => { btAll = !btAll; renderBT(); };

$('stockSel').onchange = e => selectStock(e.target.value);
$('addBtn').onclick = () => { addErr(''); $('liveHint').textContent = api != null ? '' : '※ 最新データの取得先に接続しているときだけ使えます(⚙)。'; $('dlg').showModal(); };
$('setBtn').onclick = () => {
  $('proxyUrl').value = cfg.proxy; $('autoRef').checked = cfg.auto; $('setMsg').textContent = '';
  $('connInfo').textContent = api == null ? '接続: なし(同梱データまたはデモを表示中)' : api === '.' ? '接続: このサイトの API(自動検出)' : '接続: 中継 ' + api;
  $('setDlg').showModal();
};
$('refBtn').onclick = () => refresh();
$('setSave').onclick = async () => {
  const u = $('proxyUrl').value.trim();
  if (u && !/^https?:\/\//.test(u)) { $('setMsg').textContent = 'https:// から始まるURLを入力してください。'; return; }
  cfg.proxy = u; cfg.auto = $('autoRef').checked; store.set('kabusapo.proxy.v1', u); store.set('kabusapo.auto.v1', cfg.auto);
  api = await detectApi(); $('setDlg').close(); await refresh();
};
$('liveAdd').onclick = async () => {
  const code = $('fCode').value.trim().toUpperCase();
  if (!/^[0-9A-Z]{4}$/.test(code)) { addErr('証券コード(4桁)を入力してください。'); return; }
  if (api == null) { addErr('最新データの取得先に接続されていません(⚙)。'); return; }
  addErr('取得中…(10年分の日足と財務を読み込みます)');
  try {
    const st = await fetchLive(code, false), w = watchList();
    if (!w.includes(code)) store.set('kabusapo.watch.v1', [...w, code]);
    selectStock(code); $('dlg').close(); setStatus(`${code} ${st.name} を追加しました`, 'ok');
  } catch (e) { addErr('取得できませんでした: ' + e.message); }
};
$('addForm').onsubmit = e => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  const daily = parseCSV($('fDaily').value), intra = parseCSV($('fIntra').value), margin = parseMarginCSV($('fMargin').value);
  const code = $('fCode').value.trim(), name = $('fName').value.trim() || code;
  if (daily.length < 30) { addErr('CSV取り込みは日足が30本以上必要です。'); e.preventDefault(); return; }
  const custom = loadCustom().filter(s => s.code !== code);
  custom.push({ code, name, daily, intra, margin, custom: true });
  saveCustom(custom); $('addForm').reset(); stocks = stocks.filter(s => s.code !== code); init(code);
};
let delArm = 0;
$('delBtn').onclick = () => {
  if (!cur || !(cur.custom || cur.live)) return;
  if (Date.now() - delArm > 4000) { delArm = Date.now(); $('delBtn').textContent = 'もう一度押すと削除します'; return; }
  const code = cur.code;
  saveCustom(loadCustom().filter(s => s.code !== code));
  store.set('kabusapo.watch.v1', watchList().filter(c => c !== code));
  stocks = stocks.filter(s => s.code !== code);
  $('delBtn').textContent = 'この銘柄を削除'; delArm = 0; $('dlg').close();
  stocks.length ? selectStock() : init();
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
addEventListener('resize', renderTab);

async function loadSnapshot() {
  if (window.__SNAPSHOT__) return window.__SNAPSHOT__;
  try { const r = await fetch('data/latest.json', { cache: 'no-cache' }); if (r.ok) return await r.json(); } catch {}
  return null;
}
function init(select) {
  const custom = loadCustom().map(s => ({ ...s, custom: true }));
  let base = [];
  if (snapshot && snapshot.stocks.length) base = snapshot.stocks.map(s => ({ ...s, margin: mergeMargin(s.code, s.margin) }));
  else if (api == null) base = DEMO();
  const live = stocks.filter(s => s.live && !base.some(b => b.code === s.code) && !custom.some(c => c.code === s.code));
  stocks = [...base.map(b => stocks.find(s => s.live && s.code === b.code) || b), ...live, ...custom];
  if (!stocks.length) return false;
  selectStock(select); return true;
}

// 自動更新: 場中は60秒、場外は10分ごと(画面が表示されているときだけ)。アプリに戻ったときも更新する。
setInterval(() => { if (api != null && cfg.auto && !document.hidden && !busy && Date.now() - lastRefresh >= (marketOpen() ? 60e3 : 600e3)) refresh(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && api != null && cfg.auto && !busy && Date.now() - lastRefresh > 30e3) refresh(); });

(async () => {
  snapshot = await loadSnapshot(); api = await detectApi();
  const shown = init();
  if (!shown) document.body.classList.add('loading');
  if (snapshot) setStatus(`スナップショット表示(${hhmm(snapshot.fetchedAt)} 取得)`);
  if (api != null) refresh();
  else if (!snapshot) setStatus('デモ表示です。最新データを取得するには接続先の設定が必要です(⚙ / README)。');
})();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
