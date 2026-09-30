// 依存ゼロのローカルサーバー: 静的ファイル配信 + Yahoo Finance の株価取得プロキシ
// 使い方: node server.js  →  http://localhost:8787
const http = require("http");
const https = require("https");
const tls = require("tls");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const RANGES = new Set(["6mo", "1y", "2y", "5y"]);
const cache = new Map(); // key -> {t, body}

// プロキシ: 環境変数 PROXY / HTTPS_PROXY (例: http://proxy.example:8080 または user:pass@host:port)
function proxyConf() {
  let v = process.env.PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || "";
  if (!v) return null;
  const m = v.match(/https=([^;]+)/); if (m) v = m[1]; else if (v.includes("=")) v = v.split(";")[0].split("=")[1];
  try { return new URL(/^https?:\/\//.test(v) ? v : "http://" + v); } catch { return null; }
}

// Windows統合認証(NTLM/Kerberos)プロキシ用: curl.exe が現在のログインでプロキシ認証する
function fetchViaCurl(url, px) {
  const args = ["-sS", "-m", "20", "-A", "Mozilla/5.0", "-x", `${px.protocol}//${px.host}`, "--proxy-anyauth", "--ssl-no-revoke", "-U", px.username ? `${decodeURIComponent(px.username)}:${decodeURIComponent(px.password)}` : ":", url];
  return new Promise((resolve, reject) =>
    execFile(process.platform === "win32" ? "curl.exe" : "curl", args, { maxBuffer: 20e6 }, (err, out, errText) =>
      err ? reject(new Error("curl失敗: " + (errText || err.message).trim().slice(0, 120))) : resolve(out)));
}

function fetchYahoo(symbol, range) {
  const host = "query1.finance.yahoo.com";
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const px = proxyConf();
  const viaProxy = () => new Promise((resolve, reject) => {
    const get = (extra) => https.get({ host, path, headers: { "User-Agent": "Mozilla/5.0" }, timeout: 15000, ...extra }, (r) => {
      let data = "";
      r.on("data", (c) => (data += c));
      r.on("end", () => (r.statusCode === 200 ? resolve(data) : reject(new Error("upstream " + r.statusCode))));
    }).on("error", (e) => reject(new Error(e.code || e.message))).on("timeout", function () { this.destroy(new Error(px ? "timeout(プロキシ " + px.host + " 経由)" : "timeout(プロキシ未設定)")); });
    if (!px) return get({});
    const headers = { Host: host + ":443" };
    if (px.username) headers["Proxy-Authorization"] = "Basic " + Buffer.from(decodeURIComponent(px.username) + ":" + decodeURIComponent(px.password)).toString("base64");
    http.request({ host: px.hostname, port: px.port || 80, method: "CONNECT", path: host + ":443", headers, timeout: 15000 })
      .on("connect", (r, socket) => {
        if (r.statusCode !== 200) { socket.destroy(); return reject(new Error("プロキシ応答 " + r.statusCode)); }
        get({ agent: false, createConnection: () => tls.connect({ socket, servername: host }) });
      })
      .on("error", (e) => reject(new Error("プロキシ接続失敗 " + (e.code || e.message))))
      .on("timeout", function () { this.destroy(new Error("プロキシ接続timeout")); })
      .end();
  });
  if (!px) return viaProxy();
  return viaProxy().catch((e) => (/407|プロキシ/.test(e.message) ? fetchViaCurl(`https://${host}${path}`, px) : Promise.reject(e)));
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
}).on("error", (e) => {
  console.log(e.code === "EADDRINUSE" ? `ポート ${PORT} は使用中です。古い黒い画面(node)をすべて閉じてからやり直してください。` : "起動失敗: " + e.message);
  process.exit(1);
}).listen(PORT, HOST, () => console.log(`予測アプリ起動: http://${HOST}:${PORT}` + (proxyConf() ? `  (プロキシ: ${proxyConf().host})` : "  (プロキシなし)")));
