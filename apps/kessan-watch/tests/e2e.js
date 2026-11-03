/* E2E（Playwright / headless Chromium）。J-Quants への通信は route でモックし、実通信は行わない。
 * 実行: node tests/e2e.js [出力ICSパス]   ※ Playwright が必要 */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), H = require("./harness");
const { check, section } = H;
const URL_ = "file://" + path.join(H.ROOT, "index.html");
const ymd = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const rec = (pub, sch, code) => ({ PubDate: pub, SchDate: sch, FQName: "2Q", FYE: "0331", Code: code + "0", CoName: "x", CoNameEn: "x" });

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  const pageErrors = []; p.on("pageerror", e => pageErrors.push(e.message));
  p.on("dialog", d => d.accept());
  // ---- モック J-Quants ----
  let mode = "ok", scripts = {}; const hits = [];
  await p.route("https://api.jquants.com/**", r => {
    const u = new URL(r.request().url()), code = u.searchParams.get("code");
    hits.push({ code, key: r.request().headers()["x-api-key"] });
    const cors = { "access-control-allow-origin": "*" };
    if (mode === "abort") return r.abort("failed");
    if (mode === "503") return r.fulfill({ status: 503, body: "{}", headers: cors, contentType: "application/json" });
    if (mode === "401") return r.fulfill({ status: 401, body: "{}", headers: cors, contentType: "application/json" });
    const f = scripts[code]; if (f === "400") return r.fulfill({ status: 400, body: "{}", headers: cors, contentType: "application/json" });
    r.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ data: f || [] }) });
  });
  const rows = () => p.locator("#view-list tbody tr").count();
  const listText = async () => (await p.locator("#view-list tbody").innerText()).replace(/\t/g, " ");
  const setAdapter = async (a, key) => { await p.click("#btnSettings"); await p.selectOption("#s-adapter", a); await p.fill("#s-key", key || ""); await p.click("#settingsForm button[type=submit]"); await p.waitForTimeout(400); };
  const banner = async () => (await p.locator("#errBanner").isHidden()) ? "" : (await p.locator("#errBanner").innerText());

  await p.goto(URL_); await p.waitForTimeout(400);
  section("E1. 初期表示（ダミー）");
  check("E1-1 サンプル14銘柄が一覧に表示", (await rows()) === 14);
  check("E1-2 ダミー表示バナーが出る", await p.locator("#dummyBanner").isVisible());
  check("E1-3 取得状況が表示される", /ダミーデータ/.test(await p.locator("#syncStatus").innerText()), await p.locator("#syncStatus").innerText());

  section("E2. 通過チェックの記録（後の保持確認用）");
  await p.click("#tab-check"); await p.locator("#view-check tbody tr", { hasText: "6857" }).click();
  await p.fill("#c-results-t", "売上・利益とも予想超過（テスト）"); await p.selectOption("#c-results-v", "positive");
  await p.fill("#c-guidance-t", "通期予想を据え置き"); await p.fill("#c-reaction-t", "寄付き+3%"); await p.check("#c-done");
  await p.click("#checkForm button[type=submit]");
  check("E2-1 3欄を記録し通過確認済みになる", (await p.locator("#view-check tbody tr", { hasText: "6857" }).innerText()).includes("通過確認済") );

  section("E3. J-Quants 成功 / 予定変更の反映 / チェック記録の保持");
  scripts = { "8035": [rec("2026-10-01", ymd(20), "8035"), rec("2026-10-25", ymd(8), "8035")], "6920": [rec("2026-10-01", ymd(30), "6920")] };
  await setAdapter("jquants", "TEST-KEY");
  await p.click("#tab-list");
  let t = await listText();
  check("E3-1 8035 は最新公表日の予定(8日後)を採用", t.includes(ymd(8)) && !t.includes(ymd(20)), t);
  check("E3-2 6920 も取得され、取得結果に無い銘柄(ダミー分)は消える", t.includes("6920") && !t.includes("9984"), t);
  check("E3-3 チェック記録済みの6857(ダミー)は一覧から消えず保持される", t.includes("6857"), t);
  check("E3-4 x-api-key ヘッダが送られている", hits.length > 0 && hits.every(h => h.key === "TEST-KEY"));
  check("E3-5 米国銘柄は対象外の警告が出る", /取得対象外/.test(await banner()), await banner());
  check("E3-6 取得状況に J-Quants と最終取得時刻", /J-Quants/.test(await p.locator("#syncStatus").innerText()) && /最終取得/.test(await p.locator("#syncStatus").innerText()));
  const before = await listText();

  section("E4. 障害時: 既存表示を保持し、理由・対処・再試行を出す");
  mode = "503"; await p.click("#btnSync"); await p.waitForTimeout(2200);   // 5xx は1回自動再試行(既定0.8s)
  let bn = await banner();
  check("E4-1 失敗理由(HTTP 503)が表示される", /503/.test(bn) && /取得に失敗/.test(bn), bn);
  check("E4-2 対処方法が表示される", /対処:/.test(bn), bn);
  check("E4-3 既存の予定は保持される旨と最終取得時刻が表示される", /保持/.test(bn) && /最終取得/.test(bn), bn);
  check("E4-4 一覧の内容は障害前と完全に同一", (await listText()) === before);
  check("E4-5 再試行/ダミー切替/閉じるボタンがある", (await p.locator("#errBanner button").allInnerTexts()).join("|").includes("再試行") && (await p.locator("#errBanner button").allInnerTexts()).join("|").includes("ダミーデータに切り替える"));
  mode = "401"; await p.locator("#errBanner button", { hasText: "再試行" }).click(); await p.waitForTimeout(500);
  bn = await banner();
  check("E4-6 401 → 認証エラーと『設定を開く』導線", /認証エラー/.test(bn) && (await p.locator("#errBanner button", { hasText: "設定を開く" }).count()) === 1, bn);
  mode = "ok"; await p.locator("#errBanner button", { hasText: "再試行" }).click(); await p.waitForTimeout(500);
  check("E4-7 復旧後に再試行すると警告以外のエラーが消え、取得が成功", !/取得に失敗/.test(await banner()));
  check("E4-8 取得ボタンが再び押せる", await p.locator("#btnSync").isEnabled() && (await p.locator("#btnSync").innerText()) === "予定を再取得");

  section("E5. 部分失敗: 失敗した銘柄は前回の表示を保持");
  scripts = { "8035": [rec("2026-10-25", ymd(8), "8035"), rec("2026-11-01", ymd(15), "8035")], "6920": "400" };
  await p.click("#btnSync"); await p.waitForTimeout(500);
  t = await listText();
  check("E5-1 成功銘柄(8035)は新しい予定(15日後)に更新", t.includes(ymd(15)) && !t.includes(ymd(8)), t);
  check("E5-2 失敗銘柄(6920)の前回予定(30日後)は保持", t.includes(ymd(30)), t);
  bn = await banner();
  check("E5-3 失敗銘柄が警告に明示され『前回の表示を保持』と案内", /6920/.test(bn) && /保持/.test(bn), bn);
  scripts = { "8035": [rec("2026-11-01", ymd(15), "8035")], "6920": [rec("2026-11-02", "", "6920")] };
  await p.click("#btnSync"); await p.waitForTimeout(500);
  check("E5-4 6920 が『未定』に変更されると、成功応答なので予定は消える（誤った日付を残さない）", !(await listText()).includes(ymd(30)));

  section("E6. 通信/CORS失敗 → 理由表示 → ダミーへ切替");
  mode = "abort"; await p.click("#btnSync"); await p.waitForTimeout(400);
  bn = await banner();
  check("E6-1 通信失敗の理由と CORS の可能性を説明", /通信に失敗/.test(bn) && /CORS/.test(bn), bn);
  await p.locator("#errBanner button", { hasText: "ダミーデータに切り替える" }).click(); await p.waitForTimeout(500);
  check("E6-2 ダミーに切替後、サンプル14銘柄が表示されダミー表示バナーが出る", (await rows()) >= 14 && await p.locator("#dummyBanner").isVisible(), await rows());
  check("E6-3 エラーバナーが閉じる", await p.locator("#errBanner").isHidden());

  section("E7. 手入力予定の優先・バックアップ");
  await p.click("#tab-stocks"); await p.click("#btnAdd"); await p.fill("#f-code", "7203"); await p.fill("#f-name", "手入力銘柄"); await p.fill("#f-date", ymd(5)); await p.fill("#f-period", "第2四半期");
  await p.click("#stockForm button[type=submit]");
  mode = "ok"; await setAdapter("jquants", "SECRET-KEY-ZZZ");
  scripts = { "7203": [rec("2026-10-01", ymd(40), "7203")] };
  await p.click("#btnSync"); await p.waitForTimeout(500); await p.click("#tab-list");
  t = await listText();
  check("E7-1 手入力予定は保持される", t.includes("7203") && t.includes(ymd(5)), t);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#btnExport")]);
  const json = fs.readFileSync(await dl.path(), "utf8");
  check("E7-2 バックアップJSONにAPIキーが含まれない", !json.includes("SECRET-KEY-ZZZ") && JSON.parse(json).settings.apiKey === "");
  const bad = path.join(os.tmpdir(), "kw-bad.json"); fs.writeFileSync(bad, "{ not json");
  await p.setInputFiles("#fileImport", bad); await p.waitForTimeout(200);
  check("E7-3 壊れたバックアップは拒否され、データは変わらない", /読み込み失敗/.test(await p.locator("#toast").innerText()) && (await rows()) > 0);
  const junk = path.join(os.tmpdir(), "kw-junk.json"); fs.writeFileSync(junk, JSON.stringify({ stocks: [{ code: "9999", name: "<img src=x onerror=alert(1)>" }, { name: "コード無し" }], events: [{ code: "9999", date: "2026-12-01", period: "p", source: "manual" }, { code: "9999", date: "bad" }], checks: [], settings: { adapter: "jquants", apiKey: "k" } }));
  await p.setInputFiles("#fileImport", junk); await p.waitForTimeout(300);
  await p.click("#tab-stocks");
  check("E7-4 不正項目を除去して読み込み。HTMLは文字列として表示（XSSなし）", (await p.locator("#view-stocks tbody tr").count()) === 1 && (await p.locator("#view-stocks img").count()) === 0 && (await p.locator("#view-stocks tbody").innerText()).includes("<img"));

  section("E8. ICS出力（UI経由）");
  await p.click("#btnReset"); await p.waitForTimeout(600);   // サンプルへ戻す(確認ダイアログは自動承認)
  await p.click("#tab-list");
  const n1 = await rows();
  let [d1] = await Promise.all([p.waitForEvent("download"), p.click("#btnIcs")]);
  let ics1 = fs.readFileSync(await d1.path(), "utf8");
  check("E8-1 リスト表示の全件がVEVENTとして出力", (ics1.match(/BEGIN:VEVENT/g) || []).length === n1 && n1 === 14, [n1]);
  check("E8-2 ファイル名は .ics", /\.ics$/.test(d1.suggestedFilename()), d1.suggestedFilename());
  await p.selectOption("#listFilter", "unchecked");
  const n2 = await rows();
  [d1] = await Promise.all([p.waitForEvent("download"), p.click("#btnIcs")]);
  check("E8-3 フィルタ後の表示件数だけ出力", ((fs.readFileSync(await d1.path(), "utf8")).match(/BEGIN:VEVENT/g) || []).length === n2 && n2 < 14, n2);
  await p.selectOption("#listFilter", "all"); await p.click("#tab-calendar");
  const chips = await p.locator(".chip").count();
  [d1] = await Promise.all([p.waitForEvent("download"), p.click("#btnIcs")]);
  const ics3 = fs.readFileSync(await d1.path(), "utf8");
  check("E8-4 カレンダー表示月の予定だけ出力（月内チップ数≦出力数）", (ics3.match(/BEGIN:VEVENT/g) || []).length >= Math.min(chips, 1), { chips });
  if (process.argv[2]) fs.writeFileSync(process.argv[2], ics1);

  section("E9. レイアウト・例外");
  await p.setViewportSize({ width: 375, height: 800 }); await p.click("#tab-list");
  check("E9-1 スマホ幅(375px)でページが横にはみ出さない", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
  check("E9-2 JavaScript例外なし", pageErrors.length === 0, pageErrors);
  await b.close();
  process.exitCode = H.summary() ? 0 : 1;
})().catch(e => { console.error("E2E 異常終了:", e); process.exit(2); });
