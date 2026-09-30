// 依存ゼロのローカルサーバー: 静的ファイル配信 + Yahoo Finance の株価取得プロキシ
// 使い方: node server.js  →  http://localhost:8787
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const RANGES = new Set(["6mo", "1y", "2y", "5y"]);
const cache = new Map(); // key -> {t, body}

function fetchYahoo(symbol, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000 }, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => (r.statusCode === 200 ? resolve(data) : reject(new Error("upstream " + r.statusCode))));
    }).on("error", reject).on("timeout", function () { this.destroy(new Error("timeout")); });
  });
}

function toSeries(raw) {
  const res = JSON.parse(raw).chart.result?.[0];
  if (!res) throw new Error("銘柄が見つかりません");
  const q = res.indicators.quote[0];
  const adj = res.indicators.adjclose?.[0]?.adjclose;
  const rows = [];
  res.timestamp.forEach((ts, i) => {
    const close = adj?.[i] ?? q.close[i];
    if (close == null) return;
    rows.push({ d: new Date(ts * 1000).toISOString().slice(0, 10), c: close });
  });
  return { symbol: res.meta.symbol, currency: res.meta.currency, name: res.meta.longName || res.meta.shortName || res.meta.symbol, rows };
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/history") {
    const symbol = (u.searchParams.get("symbol") || "").trim();
    const range = u.searchParams.get("range") || "2y";
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!/^[A-Za-z0-9.^=\-]{1,20}$/.test(symbol) || !RANGES.has(range)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: "銘柄コードが不正です" }));
    }
    const key = symbol + "|" + range;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < 5 * 60e3) return res.end(hit.body);
    try {
      const body = JSON.stringify(toSeries(await fetchYahoo(symbol, range)));
      cache.set(key, { t: Date.now(), body });
      res.end(body);
    } catch (e) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: "取得失敗: " + e.message }));
    }
    return;
  }
  const name = u.pathname === "/" ? "index.html" : path.basename(u.pathname);
  const file = path.join(__dirname, name);
  if (!TYPES[path.extname(name)] || !fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(name)]);
  fs.createReadStream(file).pipe(res);
}).listen(PORT, HOST, () => console.log(`予測アプリ起動: http://${HOST}:${PORT}`));
