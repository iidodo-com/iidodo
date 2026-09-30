// 予測エンジン(ブラウザ/Node両対応)。入力: 終値配列 -> 将来H営業日の分布と売買シグナル
(function (root) {
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
  function quantile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]; }
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function sma(c, n) { return mean(c.slice(-n)); }
  function rsi(c, n = 14) {
    let g = 0, l = 0;
    for (let i = c.length - n; i < c.length; i++) { const d = c[i] - c[i - 1]; d > 0 ? (g += d) : (l -= d); }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }

  // EWMAボラ(λ=0.94) と 直近ブートストラップによるモンテカルロ
  function monteCarlo(closes, H, paths = 3000, seed = 42) {
    const r = []; for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
    let v = std(r.slice(0, 30)) ** 2;
    for (const x of r) v = 0.94 * v + 0.06 * x * x;
    const sigma = Math.sqrt(v);
    const recent = r.slice(-250), mu = mean(recent) * 0.5; // ドリフトは過信しないため半分に縮小
    const z = recent.map((x) => (x - mean(recent)) / std(recent)); // 標準化残差(ファットテール再現)
    const rand = rng(seed), last = closes[closes.length - 1];
    const byDay = Array.from({ length: H }, () => []);
    for (let p = 0; p < paths; p++) {
      let lp = Math.log(last);
      for (let d = 0; d < H; d++) { lp += mu + sigma * z[Math.floor(rand() * z.length)]; byDay[d].push(Math.exp(lp)); }
    }
    const bands = byDay.map((a) => { a.sort((x, y) => x - y); return { p5: quantile(a, .05), p25: quantile(a, .25), p50: quantile(a, .5), p75: quantile(a, .75), p95: quantile(a, .95) }; });
    const fin = byDay[H - 1];
    return { bands, sigmaDaily: sigma, probUp: fin.filter((x) => x > last).length / fin.length };
  }

  // 対数線形トレンド外挿(直近120日)
  function trend(closes, H, W = 120) {
    const y = closes.slice(-W).map(Math.log), n = y.length, xm = (n - 1) / 2, ym = mean(y);
    let sxy = 0, sxx = 0; y.forEach((v, i) => { sxy += (i - xm) * (v - ym); sxx += (i - xm) ** 2; });
    const b = sxy / sxx, a = ym - b * xm;
    const res = std(y.map((v, i) => v - (a + b * i)));
    return { slopeDaily: b, path: Array.from({ length: H }, (_, d) => Math.exp(a + b * (n + d))), resid: res };
  }

  function signal(closes, mc, tr) {
    const last = closes[closes.length - 1], s20 = sma(closes, 20), s50 = sma(closes, 50), R = rsi(closes);
    let score = 0; const why = [];
    if (last > s20 && s20 > s50) { score++; why.push("短期>中期の上昇配列"); } else if (last < s20 && s20 < s50) { score--; why.push("下降配列"); }
    if (R > 70) { score--; why.push(`RSI ${R.toFixed(0)}: 買われ過ぎ`); } else if (R < 30) { score++; why.push(`RSI ${R.toFixed(0)}: 売られ過ぎ`); }
    if (tr.slopeDaily * 252 > 0.1) { score++; why.push("トレンド年率+10%超"); } else if (tr.slopeDaily * 252 < -0.1) { score--; why.push("トレンド年率-10%超"); }
    if (mc.probUp > 0.55) { score++; why.push(`上昇確率 ${(mc.probUp * 100).toFixed(0)}% (55%超)`); } else if (mc.probUp < 0.45) { score--; why.push(`上昇確率 ${(mc.probUp * 100).toFixed(0)}% (45%未満)`); }
    const label = score >= 2 ? "強気" : score <= -2 ? "弱気" : "中立";
    return { score, label, why, rsi: R, sma20: s20, sma50: s50 };
  }

  function forecast(closes, H = 20) {
    const mc = monteCarlo(closes, H), tr = trend(closes, H), sig = signal(closes, mc, tr);
    const last = closes[closes.length - 1], end = mc.bands[H - 1];
    return { last, H, mc, tr, sig, expected: { low: end.p5, mid: end.p50, high: end.p95, retMid: end.p50 / last - 1 } };
  }
  const api = { forecast };
  if (typeof module !== "undefined") module.exports = api; else root.Forecast = api;
})(this);
