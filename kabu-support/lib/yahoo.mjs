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
    out.push({ t: intraday ? d.slice(11, 16) : d.slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
  });
  return { bars: out, meta: res.meta, date: new Date((res.timestamp[res.timestamp.length - 1] + off) * 1000).toISOString().slice(0, 10) };
}

// 信用残高(最新週のみ): Yahoo!ファイナンス銘柄ページから抽出
export function parseMargin(html, now = new Date()) {
  const s = html.replace(/\\"/g, '"');
  const pick = k => { const m = s.match(new RegExp(`"name":"${k}","primary":\\{"value":"([^"]*)".*?"updateDate":"([^"]*)"`)); return m ? { v: +m[1].replace(/,/g, ''), d: m[2] } : null; };
  const buy = pick('信用買残'), sell = pick('信用売残');
  if (!buy || !sell || !isFinite(buy.v) || !isFinite(sell.v)) return null;
  const [mo, da] = buy.d.split('/').map(Number);
  let y = now.getUTCFullYear(); if (mo > now.getUTCMonth() + 2) y--;
  return { t: `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`, buy: buy.v, sell: sell.v };
}

export async function fetchStock(code, { f = fetch, range = '1y' } = {}) {
  if (!/^[0-9A-Z]{4}$/.test(code)) throw new Error('invalid code');
  const base = 'https://query1.finance.yahoo.com/v8/finance/chart/' + code + '.T';
  const [d, i, page] = await Promise.all([
    get(`${base}?range=${range}&interval=1d`, f).then(r => r.json()),
    get(`${base}?range=1d&interval=5m`, f).then(r => r.json()).catch(() => null),
    get(`https://finance.yahoo.co.jp/quote/${code}.T`, f).then(r => r.text()).catch(() => ''),
  ]);
  const daily = parseChart(d, false), intra = i ? parseChart(i, true) : { bars: [], date: null };
  const rawName = (page.match(/<title>(.*?)【/) || [])[1] || d.chart.result[0].meta.shortName || code;
  const name = rawName.normalize('NFKC').replace(/\(株\)/g, '').trim();
  const m = parseMargin(page);
  return {
    code, name, daily: daily.bars, intra: intra.bars, intraDate: intra.date,
    margin: m ? [m] : [], fetchedAt: new Date().toISOString(),
    marketState: daily.meta.marketState || null,
  };
}
