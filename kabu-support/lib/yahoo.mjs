// Yahoo Finance から株価・出来高・信用残高を取得する(Node 18+ と Cloudflare Workers 共通)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

async function get(url, f = fetch) {
  const r = await f(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ja' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
}

function parseChart(json, intraday) {
  const res = json.chart && json.chart.result && json.chart.result[0];
  if (!res || !res.timestamp) throw new Error('chart data not found');
  const off = res.meta.gmtoffset || 0, q = res.indicators.quote[0], out = [];
  res.timestamp.forEach((ts, i) => {
    if (q.close[i] == null || q.open[i] == null || (intraday && !q.volume[i])) return;
    const d = new Date((ts + off) * 1000).toISOString();
    const r2 = x => Math.round(x * 100) / 100;
    out.push({ t: intraday ? d.slice(11, 16) : d.slice(0, 10), o: r2(q.open[i]), h: r2(q.high[i]), l: r2(q.low[i]), c: r2(q.close[i]), v: q.volume[i] || 0 });
  });
  return { bars: out, meta: res.meta, date: new Date((res.timestamp[res.timestamp.length - 1] + off) * 1000).toISOString().slice(0, 10) };
}

// 信用残高(最新週のみ): Yahoo!ファイナンス銘柄ページから抽出
export function parseMargin(html, now = new Date()) {
  const pick = label => {
    for (let i = html.indexOf(label); i >= 0; i = html.indexOf(label, i + 1)) {
      const w = html.slice(Math.max(0, i - 20), i + 400).replace(/\\"/g, '"');
      const m = w.match(new RegExp(`name":"${label}","primary":\\{"value":"([^"]*)".*?"updateDate":"([^"]*)"`));
      if (m) return { v: +m[1].replace(/,/g, ''), d: m[2] };
    }
    return null;
  };
  const buy = pick('信用買残'), sell = pick('信用売残');
  if (!buy || !sell || !isFinite(buy.v) || !isFinite(sell.v)) return null;
  const [mo, da] = buy.d.split('/').map(Number);
  let y = now.getUTCFullYear(); if (mo > now.getUTCMonth() + 2) y--;
  return { t: `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`, buy: buy.v, sell: sell.v };
}

const num = x => { const n = parseFloat(String(x).replace(/,/g, '')); return isFinite(n) ? n : null; };

// ファンダメンタル指標: Yahoo!ファイナンス銘柄ページ内のJSONから抽出(CPU時間節約のため必要な範囲だけ処理する)
export function parseFundamentals(html) {
  const keys = { per: 'per', eps: 'eps', pbr: 'pbr', bps: 'bps', roe: 'roe', equityRatio: 'equityRatio', shareDividendYield: 'divYield', dps: 'dps', totalPrice: 'mcap', roundLot: 'lot', yearHighPrice: 'yHigh', yearLowPrice: 'yLow', minPurchasePrice: 'minBuy' };
  const at = Object.keys(keys).map(k => html.indexOf(`\\"${k}\\":{\\"name\\"`)).filter(i => i >= 0);
  if (!at.length) return null;
  const s = html.slice(Math.min(...at), Math.max(...at) + 500).replace(/\\"/g, '"'), g = {};
  for (const [k, out] of Object.entries(keys)) {
    const m = s.match(new RegExp(`"${k}":\\{"name":"[^"]*"(?:,"subText":"[^"]*")?,"value":"([^"]*)"`));
    g[out] = m ? num(m[1]) : null;
  }
  return Object.values(g).some(v => v != null) ? g : null;
}

// 業績(通期): 売上高・営業利益・純利益(百万円)。会社予想行は forecast: true
export function parsePerformance(html) {
  const t = (html.match(/<table[\s\S]*?<\/table>/) || [])[0];
  if (!t) return [];
  const clean = x => x.replace(/<br\s*\/?>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const out = [];
  for (const r of t.match(/<tr[\s\S]*?<\/tr>/g) || []) {
    const c = (r.match(/<t[hd][\s\S]*?<\/t[hd]>/g) || []).map(clean);
    const m = /^(\d{4})年(\d{1,2})月期(（会社予想）)?/.exec(c[0] || '');
    if (!m || m[1] === '0000' || num(c[1]) == null) continue;
    out.push({ fy: `${m[1]}/${m[2]}`, forecast: !!m[3], sales: num(c[1]), op: num(c[4]), ni: num(c[8]) });
  }
  return out;
}

// quick: 自動更新用の軽量取得(直近1か月の日足のみ。業績ページは取らない)
export async function fetchStock(code, { f = fetch, range = '10y', quick = false } = {}) {
  if (!/^[0-9A-Z]{4}$/.test(code)) throw new Error('invalid code');
  const base = 'https://query1.finance.yahoo.com/v8/finance/chart/' + code + '.T';
  const [d, i, page, perfPage] = await Promise.all([
    get(`${base}?range=${quick ? '1mo' : range}&interval=1d`, f).then(r => r.json()),
    get(`${base}?range=1d&interval=5m`, f).then(r => r.json()).catch(() => null),
    get(`https://finance.yahoo.co.jp/quote/${code}.T`, f).then(r => r.text()).catch(() => ''),
    quick ? '' : get(`https://finance.yahoo.co.jp/quote/${code}.T/performance`, f).then(r => r.text()).catch(() => ''),
  ]);
  const daily = parseChart(d, false), intra = i ? parseChart(i, true) : { bars: [], date: null };
  const rawName = (page.match(/<title>(.*?)【/) || [])[1] || d.chart.result[0].meta.shortName || code;
  const name = rawName.normalize('NFKC').replace(/\(株\)/g, '').trim();
  const m = parseMargin(page);
  return {
    code, name, daily: daily.bars, intra: intra.bars, intraDate: intra.date,
    margin: m ? [m] : [], fund: parseFundamentals(page), perf: quick ? null : parsePerformance(perfPage), quick, fetchedAt: new Date().toISOString(),
    marketState: daily.meta.marketState || null,
  };
}
