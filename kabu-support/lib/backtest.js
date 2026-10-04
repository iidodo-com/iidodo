/* バックテスト・エンジン(ブラウザ/Node 共通)
 * - 日足・現物ロングのみ。シグナルは当日終値で判定し、翌営業日の始値で約定(先読みなし)。
 * - 損切りは ATR ベース。1R = エントリー価格 - 損切り価格。損益は R 倍数で集計する。
 * - コスト: 往復 COST(売買手数料+スリッページ)を R に換算して差し引く。
 * - 選定は前半(IS)のみで行い、後半(OOS)は未見データとして検証にだけ使う。
 */
(function (root) {
  'use strict';

  const COST = 0.002;            // 往復コスト(0.2%)
  const WARMUP = 200;            // 指標が出そろうまでの本数
  const SPLIT = 0.6;             // 前半60%=選定用、後半40%=検証用

  // 採用基準(結果を見る前に固定)
  const CRITERIA = {
    is:  { minTrades: 40, minExp: 0.05, minPF: 1.3, minRR: 1.5 },
    oos: { minTrades: 15, minExp: 0.0,  minPF: 1.2, minRR: 1.3 },
  };

  // ---------- 指標 ----------
  const sma = (a, n) => { const o = Array(a.length).fill(null); let s = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
  function rsi(c, n) {
    const o = Array(c.length).fill(null); if (c.length <= n) return o;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d >= 0 ? g += d : l -= d; }
    g /= n; l /= n; o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
      o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return o;
  }
  function atr(b, n) {
    const o = Array(b.length).fill(null); let s = 0;
    for (let i = 1; i < b.length; i++) {
      const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c));
      if (i <= n) { s += tr; if (i === n) o[i] = s / n; } else o[i] = (o[i - 1] * (n - 1) + tr) / n;
    }
    return o;
  }
  function highestPrev(h, n) { // 当日を含まない直近n本の高値
    return h.map((_, i) => { if (i < n) return null; let m = -Infinity; for (let k = i - n; k < i; k++) if (h[k] > m) m = h[k]; return m; });
  }
  function vwapRoll(b, n) {
    return b.map((_, i) => { if (i < n - 1) return null; let pv = 0, v = 0;
      for (let k = i - n + 1; k <= i; k++) { pv += (b[k].h + b[k].l + b[k].c) / 3 * b[k].v; v += b[k].v; } return v ? pv / v : null; });
  }
  function prepare(bars) {
    const c = bars.map(b => b.c), v = bars.map(b => b.v);
    return {
      bars, c, ma5: sma(c, 5), ma25: sma(c, 25), ma75: sma(c, 75), ma200: sma(c, 200),
      rsi14: rsi(c, 14), rsi2: rsi(c, 2), atr: atr(bars, 14), vavg: sma(v, 20),
      hh20: highestPrev(bars.map(b => b.h), 20), vwap20: vwapRoll(bars, 20),
    };
  }

  // ---------- 戦略(エントリー条件) ----------
  const STRATEGIES = {
    pullback: { name: 'トレンド押し目', desc: '75日線の上で25日線が上向き。RSI(14)が40を下から上抜けた日', maxHold: 25,
      sig: (x, i) => x.ma75[i] != null && x.ma25[i - 5] != null && x.c[i] > x.ma75[i] && x.ma25[i] > x.ma25[i - 5] && x.rsi14[i - 1] < 40 && x.rsi14[i] >= 40 },
    breakout: { name: '高値ブレイク', desc: '20日高値を更新し、出来高が20日平均の1.5倍以上、75日線の上', maxHold: 60,
      sig: (x, i) => x.hh20[i] != null && x.ma75[i] != null && x.c[i] > x.hh20[i] && x.bars[i].v > 1.5 * x.vavg[i] && x.c[i] > x.ma75[i] },
    cross: { name: 'ゴールデンクロス', desc: '5日線が25日線を上抜け、終値が75日線の上', maxHold: 40,
      sig: (x, i) => x.ma75[i] != null && x.ma5[i - 1] <= x.ma25[i - 1] && x.ma5[i] > x.ma25[i] && x.c[i] > x.ma75[i],
      exitSig: (x, i) => x.ma5[i] < x.ma25[i] },
    rsi2: { name: 'RSI(2)逆張り', desc: '200日線の上でRSI(2)が10未満の売られ過ぎ。5日線超えで利確', maxHold: 8,
      sig: (x, i) => x.ma200[i] != null && x.c[i] > x.ma200[i] && x.rsi2[i] != null && x.rsi2[i] < 10,
      exitSig: (x, i) => x.c[i] > x.ma5[i] },
    vwap: { name: 'VWAP回復', desc: '終値が20日VWAPを下から上抜け。25日線が上向きで出来高が平均以上', maxHold: 25,
      sig: (x, i) => x.vwap20[i] != null && x.vwap20[i - 1] != null && x.ma25[i - 5] != null && x.c[i - 1] <= x.vwap20[i - 1] && x.c[i] > x.vwap20[i] && x.ma25[i] > x.ma25[i - 5] && x.bars[i].v >= x.vavg[i] },
  };
  const STOPS = [1.5, 2, 3];               // 損切り幅(ATR倍)
  const EXITS = ['tp2', 'tp3', 'trail'];   // 利確方式: 2R / 3R / ATR(3倍)トレーリング
  const EXIT_LABEL = { tp2: '利確2R', tp3: '利確3R', trail: 'トレーリング', sig: '指標で手仕舞い' };

  function candidates() {
    const out = [];
    for (const [id, s] of Object.entries(STRATEGIES)) {
      for (const k of STOPS) {
        const ex = s.exitSig ? [...EXITS, 'sig'] : EXITS;
        for (const e of ex) out.push({ id, k, exit: e, label: `${s.name} / 損切り${k}ATR / ${EXIT_LABEL[e]}` });
      }
    }
    return out;
  }

  // ---------- シミュレーション ----------
  // lo..hi: エントリーを許す日足インデックス範囲(hi は含まない)。データ末尾は hi 以降を使わない。
  function simulate(x, cand, lo, hi) {
    const S = STRATEGIES[cand.id], b = x.bars, trades = [], end = hi - 1;
    let i = Math.max(WARMUP, lo - 1);
    while (i < end) {
      if (!(x.atr[i] > 0) || !S.sig(x, i)) { i++; continue; }
      const ei = i + 1; if (ei > end) break;
      const entry = b[ei].o, R = cand.k * x.atr[i];
      if (!(entry - R > 0) || ei < lo) { i++; continue; }
      let stop = entry - R, bestClose = entry, exitP = null, exitI = null, reason = '';
      const tpMult = cand.exit === 'tp2' ? 2 : cand.exit === 'tp3' ? 3 : 0, target = tpMult ? entry + tpMult * R : null;
      for (let j = ei; j <= end; j++) {
        if (j > ei && b[j].o <= stop) { exitP = b[j].o; exitI = j; reason = '損切り(窓)'; break; }
        if (b[j].l <= stop) { exitP = stop; exitI = j; reason = cand.exit === 'trail' && stop > entry - R ? 'トレーリング' : '損切り'; break; }
        if (target) {
          if (j > ei && b[j].o >= target) { exitP = b[j].o; exitI = j; reason = '利確'; break; }
          if (b[j].h >= target) { exitP = target; exitI = j; reason = '利確'; break; }
        }
        if (cand.exit === 'trail') { bestClose = Math.max(bestClose, b[j].c); stop = Math.max(stop, bestClose - 3 * x.atr[j]); }
        if (j - ei + 1 >= S.maxHold) { exitP = b[j].c; exitI = j; reason = '期間満了'; break; }
        if (cand.exit === 'sig' && S.exitSig(x, j) && j < end) { exitP = b[j + 1].o; exitI = j + 1; reason = '指標手仕舞い'; break; }
        if (j === end) { exitP = b[j].c; exitI = j; reason = '期間末'; }
      }
      if (exitP == null) break;
      const r = (exitP - entry) / R - COST * entry / R;
      trades.push({ ei, xi: exitI, entry, exit: exitP, R, r, hold: exitI - ei + 1, reason, t: b[ei].t, tx: b[exitI].t });
      i = Math.max(exitI, i + 1);
    }
    return trades;
  }

  function stats(trades) {
    const n = trades.length;
    if (!n) return { n: 0, win: 0, avgW: 0, avgL: 0, rr: 0, exp: 0, pf: 0, totalR: 0, mdd: 0, hold: 0 };
    const w = trades.filter(t => t.r > 0), l = trades.filter(t => t.r <= 0);
    const sw = w.reduce((a, t) => a + t.r, 0), sl = -l.reduce((a, t) => a + t.r, 0);
    const avgW = w.length ? sw / w.length : 0, avgL = l.length ? sl / l.length : 0;
    const ord = [...trades].sort((a, b) => a.tx < b.tx ? -1 : 1);
    let eq = 0, pk = 0, mdd = 0;
    ord.forEach(t => { eq += t.r; pk = Math.max(pk, eq); mdd = Math.max(mdd, pk - eq); });
    return { n, win: w.length / n, avgW, avgL, rr: avgL ? avgW / avgL : (avgW ? 99 : 0), exp: (sw - sl) / n,
      pf: sl ? sw / sl : (sw ? 99 : 0), totalR: sw - sl, mdd, hold: trades.reduce((a, t) => a + t.hold, 0) / n };
  }

  const pass = (s, c) => s.n >= c.minTrades && s.exp > c.minExp && s.pf >= c.minPF && s.rr >= c.minRR;

  // ---------- 全体の実行 ----------
  // stocks: [{code, name, daily:[{t,o,h,l,c,v}]}]
  function run(stocks) {
    const data = stocks.filter(s => s.daily && s.daily.length > WARMUP + 250).map(s => ({ code: s.code, name: s.name, x: prepare(s.daily) }));
    if (!data.length) return null;
    const longest = data.reduce((a, d) => d.x.bars.length > a.x.bars.length ? d : a);
    const cutDate = longest.x.bars[Math.floor(longest.x.bars.length * SPLIT)].t;
    const cutIdx = d => { const k = d.x.bars.findIndex(b => b.t >= cutDate); return k < 0 ? d.x.bars.length : k; };

    const rows = candidates().map(cand => {
      const isT = [], ooT = [], per = {};
      for (const d of data) {
        const ci = cutIdx(d);
        const a = simulate(d.x, cand, 0, ci);                      // 前半のみ。後半のデータは見ない
        const o = simulate(d.x, cand, ci, d.x.bars.length);        // 後半: 未見データで検証
        a.forEach(t => (t.code = d.code, isT.push(t))); o.forEach(t => (t.code = d.code, ooT.push(t)));
        per[d.code] = stats([...a, ...o]);
      }
      const is = stats(isT), oos = stats(ooT);
      return { cand, is, oos, per, isT, ooT, passIS: pass(is, CRITERIA.is), passOOS: pass(oos, CRITERIA.oos) };
    });

    // 選定: 前半の基準を満たすものを期待値(R/トレード)順に並べ、後半の基準も満たす最上位を採用
    const eligible = rows.filter(r => r.passIS).sort((a, b) => b.is.exp - a.is.exp);
    const adopted = eligible.find(r => r.passOOS) || null;

    // 買い持ち(参考): 後半の期間の単純リターン
    const bh = data.map(d => { const ci = cutIdx(d), b = d.x.bars; return { code: d.code, ret: b[b.length - 1].c / b[Math.min(ci, b.length - 1)].c - 1 }; });
    return { rows, eligible, adopted, cutDate, bh, nStocks: data.length, from: longest.x.bars[0].t, to: longest.x.bars[longest.x.bars.length - 1].t, data };
  }

  // 現在のシグナル(最終足でエントリー条件が点灯しているか)と、売買プラン
  function currentSignal(stock, cand) {
    const x = prepare(stock.daily), i = x.bars.length - 1, S = STRATEGIES[cand.id];
    if (!(x.atr[i] > 0)) return null;
    const on = !!S.sig(x, i), entry = x.bars[i].c, R = cand.k * x.atr[i];
    const m = cand.exit === 'tp2' ? 2 : cand.exit === 'tp3' ? 3 : 0;
    return { on, entry, stop: entry - R, target: m ? entry + m * R : null, R, riskPct: R / entry, rr: m || null, date: x.bars[i].t };
  }

  const api = { run, simulate, stats, prepare, candidates, currentSignal, STRATEGIES, EXIT_LABEL, CRITERIA, COST, WARMUP, SPLIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BT = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
