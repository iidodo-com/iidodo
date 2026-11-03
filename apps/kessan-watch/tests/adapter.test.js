/* J-Quants アダプタのモック検証（実キー・実通信は一切使わない） */
"use strict";
const H = require("./harness");
const sb = H.loadBrowserScripts(["data/sample.js", "js/adapters.js"]);
const jq = sb.KW_ADAPTERS.get("jquants");
const { check, section } = H;
const TODAY = "2026-11-03";
const rec = (pub, sch, fq, fye, code) => ({ PubDate: pub, SchDate: sch, FQName: fq || "2Q", FYE: fye || "0331", Code: (code || "8035") + "0", CoName: "テスト", CoNameEn: "Test" });
const ok = body => ({ ok: true, status: 200, json: async () => body });
const err = st => ({ ok: false, status: st, json: async () => ({ message: "x" }) });
function mkFetch(handler) { const calls = []; const f = async (url, opts) => { calls.push({ url, opts }); return handler(new URL(url), opts, calls.length); }; f.calls = calls; return f; }
const JP = (...codes) => codes.map(c => ({ code: c, name: "銘柄" + c, market: "JP" }));
const run = (stocks, f, extra) => jq.fetchSchedule(stocks, Object.assign({ apiKey: "TESTKEY-123", today: TODAY, fetch: f, retryDelayMs: 0, timeoutMs: 200 }, extra || {}));
const rejects = async p => { try { await p; return null; } catch (e) { return e; } };

(async () => {
  section("A. 正常系");
  {
    const f = mkFetch(() => ok({ data: [rec("2026-10-01", "2026-11-10", "2Q"), rec("2026-09-01", "2026-10-20", "1Q")] }));
    const r = await run(JP("8035"), f);
    check("A1 直近の予定1件＋通過済み1件を返す", r.events.length === 2, r.events);
    const up = r.events.find(e => e.date === "2026-11-10");
    check("A2 期ラベル・source・コードが正しい", up && up.period === "3月期 第2四半期" && up.source === "jquants" && up.code === "8035", up);
    check("A3 リクエスト: GET /v2/fins/earnings-date?code=8035", f.calls[0].url === "https://api.jquants.com/v2/fins/earnings-date?code=8035", f.calls[0].url);
    check("A4 x-api-key ヘッダで認証", f.calls[0].opts.headers["x-api-key"] === "TESTKEY-123");
    check("A5 APIキーが URL に含まれない", !f.calls.some(c => c.url.includes("TESTKEY")));
    check("A6 警告・失敗銘柄なし", r.warnings.length === 0 && r.failedCodes.length === 0, r);
  }
  {
    const f = mkFetch((u) => ok({ data: u.searchParams.get("pagination_key") ? [rec("2026-10-01", "2026-11-10")] : [rec("2026-05-01", "2026-08-01", "FY")], pagination_key: u.searchParams.get("pagination_key") ? undefined : "k1.k2." }));
    const r = await run(JP("8035"), f);
    check("A7 pagination_key を追従して2ページ取得", f.calls.length === 2 && f.calls[1].url.includes("pagination_key=k1.k2."), f.calls.map(c => c.url));
    check("A8 2ページ目のデータも反映", r.events.some(e => e.date === "2026-11-10"));
  }
  {
    const f = mkFetch(() => ok({ data: [rec("2026-10-01", "2026-11-10")], pagination_key: "more" }));
    const r = await run(JP("8035"), f);
    check("A9 ページ上限(5)で打ち切り、警告を出す", f.calls.length === 5 && r.warnings.some(w => w.includes("打ち切り")), { calls: f.calls.length, w: r.warnings });
  }
  {
    const f = mkFetch(() => ok({ data: [rec("2026-10-01", "2026-11-10")] }));
    const r = await run([{ code: "8035", name: "東エレ", market: "JP" }, { code: "NVDA", name: "NVIDIA", market: "US" }, { code: "AB", name: "x", market: "JP" }], f);
    check("A10 米国銘柄・4桁でないコードは問い合わせず警告", f.calls.length === 1 && r.warnings.some(w => w.includes("2 件")), { calls: f.calls.length, w: r.warnings });
  }

  section("B. 空応答");
  {
    const r = await run(JP("8035", "6857"), mkFetch(() => ok({ data: [] })));
    check("B1 data=[] は成功（予定0件・警告なし・失敗なし）", r.events.length === 0 && r.warnings.length === 0 && r.failedCodes.length === 0, r);
    const r2 = await run(JP("8035"), mkFetch(() => ok({ data: [rec("2026-10-01", "", "2Q")] })));
    check("B2 未定(SchDate空)のみ → 予定0件", r2.events.length === 0, r2.events);
    const r3 = await run([{ code: "NVDA", name: "N", market: "US" }], mkFetch(() => { throw new Error("呼ばれないはず"); }));
    check("B3 対象銘柄が無ければ通信せず空で返す", r3.events.length === 0 && r3.warnings.length === 1, r3);
  }

  section("C. エラー応答");
  for (const [st, kind] of [[401, "auth"], [403, "auth"], [400, "bad"], [429, "rate"], [500, "http"], [503, "http"], [404, "http"]]) {
    const e = await rejects(run(JP("8035"), mkFetch(() => err(st))));
    check(`C ${st} → kind=${kind}、理由と対処(hint)が付く`, e && e.kind === kind && e.message && e.hint, e && { kind: e.kind, m: e.message, h: e.hint });
  }
  {
    const f = mkFetch((u, o, n) => n === 1 ? err(503) : ok({ data: [rec("2026-10-01", "2026-11-10")] }));
    const r = await run(JP("8035"), f);
    check("C8 5xx は1回だけ自動再試行して成功", f.calls.length === 2 && r.events.length === 1, f.calls.length);
    const f2 = mkFetch(() => err(500)); const e2 = await rejects(run(JP("8035"), f2));
    check("C9 5xx が続けば再試行は1回だけで失敗", f2.calls.length === 2 && e2 && e2.kind === "http", f2.calls.length);
    const f3 = mkFetch(() => err(401)); await rejects(run(JP("8035"), f3));
    check("C10 401 は再試行しない", f3.calls.length === 1);
  }
  {
    const e = await rejects(run(JP("8035"), mkFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }))));
    check("C11 JSONでない応答 → kind=format", e && e.kind === "format" && e.hint, e && e.kind);
    const e2 = await rejects(run(JP("8035"), mkFetch(() => ok({ foo: 1 }))));
    check("C12 data 配列が無い応答 → kind=format", e2 && e2.kind === "format", e2 && e2.kind);
    const e3 = await rejects(run(JP("8035"), mkFetch(() => { throw new TypeError("Failed to fetch"); })));
    check("C13 fetch 例外(ネットワーク/CORS) → kind=network、CORSの可能性を説明", e3 && e3.kind === "network" && /CORS/.test(e3.message) && e3.hint, e3 && e3.message);
    const e4 = await rejects(run(JP("8035"), (url, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))), { timeoutMs: 30 }));
    check("C14 無応答はタイムアウト(kind=timeout)", e4 && e4.kind === "timeout", e4 && e4.kind);
    const e5 = await rejects(run(JP("8035"), mkFetch(() => err(401)), { apiKey: "SECRET-KEY-XYZ" }));
    check("C15 エラー文言・hint にAPIキーが含まれない", e5 && !(e5.message + e5.hint).includes("SECRET-KEY-XYZ"));
    const e6 = await rejects(jq.fetchSchedule(JP("8035"), { apiKey: "  ", today: TODAY, fetch: mkFetch(() => ok({ data: [] })) }));
    check("C16 APIキー未入力 → 通信せず kind=nokey", e6 && e6.kind === "nokey" && e6.hint, e6 && e6.kind);
  }
  section("C'. 部分失敗（既存表示を守るための failedCodes）");
  {
    const f = mkFetch((u) => u.searchParams.get("code") === "6857" ? err(400) : ok({ data: [rec("2026-10-01", "2026-11-10", "2Q", "0331", u.searchParams.get("code"))] }));
    const r = await run(JP("8035", "6857", "6920"), f);
    check("C17 1銘柄が400でも他は成功。failedCodes=[6857]、警告に銘柄コード", r.events.length === 2 && r.failedCodes.join() === "6857" && r.warnings.some(w => w.startsWith("6857")), r);
    const f2 = mkFetch((u, o, n) => n === 1 ? ok({ data: [rec("2026-10-01", "2026-11-10")] }) : err(429));
    const r2 = await run(JP("8035", "6857", "6920"), f2);
    check("C18 途中で429 → 取得済みは返し、残りは failedCodes、以降の通信は中断", r2.events.length === 1 && r2.failedCodes.join() === "6857,6920" && f2.calls.length === 2 && r2.warnings.some(w => w.includes("途中で中断")), { r2, calls: f2.calls.length });
    const e = await rejects(run(JP("8035", "6857"), mkFetch(() => err(400))));
    check("C19 全銘柄が失敗すれば reject（呼び出し側が既存表示を保持）", e && e.kind === "bad");
  }

  {
    const f = mkFetch(() => err(502));
    const e = await rejects(run(JP("8035", "6857", "6920", "7735", "3436"), f));
    check("C20 サービス障害(5xx)が続く場合は2銘柄連続失敗で中断（全銘柄を待たない）", e && e.kind === "http" && f.calls.length === 4, f.calls.length);
    const f2 = mkFetch((u, o, n) => u.searchParams.get("code") === "6857" ? err(500) : ok({ data: [rec("2026-10-01", "2026-11-10", "2Q", "0331", u.searchParams.get("code"))] }));
    const r = await run(JP("8035", "6857", "6920"), f2);
    check("C21 単発の5xxは継続し、その銘柄だけ failedCodes", r.events.length === 2 && r.failedCodes.join() === "6857", r);
  }

  section("D. 予定変更（複数回の開示 → 最新の公表日を採用）");
  const norm = (recs) => jq.normalize(recs, "8035", TODAY);
  {
    let r = norm([rec("2026-09-01", "2026-11-05"), rec("2026-10-10", "2026-11-12"), rec("2026-10-25", "2026-11-20")]);
    check("D1 3回開示 → 最新公表日(10-25)の 11-20 を採用", r.length === 1 && r[0].date === "2026-11-20", r);
    r = norm([rec("2026-10-25", "2026-11-20"), rec("2026-09-01", "2026-11-05"), rec("2026-10-10", "2026-11-12")]);
    check("D2 配列の並びが逆順でも結果は同じ（PubDate比較）", r.length === 1 && r[0].date === "2026-11-20", r);
    r = norm([rec("2026-09-01", "2026-11-05"), rec("2026-10-20", "")]);
    check("D3 後から「未定」に変更 → 予定なし（古い日付を出さない）", r.length === 0, r);
    r = norm([rec("2026-09-01", "2026-11-05"), rec("2026-10-20", ""), rec("2026-10-30", "2026-12-01")]);
    check("D4 未定 → 再度確定 → 最新の確定日を採用", r.length === 1 && r[0].date === "2026-12-01", r);
    r = norm([rec("2026-09-01", "2026-12-20"), rec("2026-10-10", "2026-11-04")]);
    check("D5 予定が前倒し(12-20→11-04)も最新を採用", r.length === 1 && r[0].date === "2026-11-04", r);
    r = norm([rec("2026-09-01", "2026-11-10", "2Q", "0331"), rec("2026-10-10", "2026-11-20", "2Q", "1231")]);
    check("D6 決算期末(FYE)変更で別レコードが併存 → 直近の予定1件のみ表示", r.length === 1 && r[0].date === "2026-11-10", r);
    r = norm([rec("2026-10-01", "2026-11-10", "2Q"), rec("2026-10-01", "2027-02-10", "3Q")]);
    check("D7 異なる決算区分は別系列。直近の予定(2Q)のみ", r.length === 1 && r[0].date === "2026-11-10", r);
    r = norm([rec("2026-10-01", "2026-11-03"), rec("2026-08-01", "2026-09-20", "1Q")]);
    check("D8 当日(SchDate=今日)は「今後の予定」扱い。45日以内の通過済み(1Q)も1件", r.length === 2 && r.some(e => e.date === "2026-11-03") && r.some(e => e.date === "2026-09-20"), r);
    r = norm([rec("2026-08-01", "2026-09-19", "1Q"), rec("2026-08-01", "2026-09-18", "FY")]);
    check("D9 通過済み: 45日前(09-19)は含め、46日前(09-18)は除外", r.length === 1 && r[0].date === "2026-09-19", r);
    r = norm([rec("2026-08-01", "2026-09-25", "1Q"), rec("2026-08-01", "2026-10-05", "FY")]);
    check("D10 通過済みが複数なら最も新しい1件のみ", r.length === 1 && r[0].date === "2026-10-05", r);
    r = norm([null, {}, { PubDate: 5 }, rec("2026-10-01", "2026-11-10"), rec("2026-10-02", "2026/11/11")]);
    check("D11 不正レコード・不正な日付形式は無視（最新の不正レコードが勝って予定なしになる）", r.length === 0, r);
  }
  {
    const f = mkFetch(() => ok({ data: [rec("2026-09-01", "2026-11-05"), rec("2026-10-10", "2026-11-12"), rec("2026-10-25", "2026-11-20")] }));
    const r = await run(JP("8035"), f);
    check("D12 fetchSchedule 経由でも最新の予定のみ(1件・11-20)", r.events.length === 1 && r.events[0].date === "2026-11-20", r.events);
  }
  process.exitCode = H.summary() ? 0 : 1;
})();
