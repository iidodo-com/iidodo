/* localStorage / バックアップ読込時のデータ検証 */
"use strict";
const H = require("./harness"); const { check, section } = H;
const S = require("../js/storage.js");
section("storage.sanitize");
let s = S.sanitize(null);
check("S1 null/不正入力 → 既定値", s.stocks.length === 0 && s.settings.adapter === "dummy" && s.settings.warnDays === 7);
s = S.sanitize({ stocks: [{ code: "8035", name: "A", market: "XX" }, { code: "8035", name: "dup" }, { name: "コード無し" }, null, { code: " ", name: "空" }, { code: 123 }],
  events: [{ code: "8035", date: "2026-11-10", period: "p", source: "manual" }, { code: "8035", date: "2026/11/10" }, { code: "8035", date: "2026-13-45" }, "x"],
  checks: { "8035|p": { done: 1, results: { text: "ok", verdict: "evil" }, memo: 5 }, bad: 7 },
  settings: { warnDays: "999", adapter: 5, apiKey: "k" } });
check("S2 重複・コード無し・非文字列コードの銘柄を除外し、市場は JP/US に正規化", s.stocks.length === 1 && s.stocks[0].market === "JP", s.stocks);
check("S3 不正な日付形式・存在しない日付の予定を除外", s.events.length === 1 && s.events[0].date === "2026-11-10", s.events);
check("S4 チェック記録の型を正規化（verdict 不正値→空、非文字列→空文字、不正エントリ除外）", s.checks["8035|p"].results.verdict === "" && s.checks["8035|p"].memo === "" && s.checks["8035|p"].done === true && !s.checks.bad, s.checks);
check("S5 警戒日数は 0〜60 に丸める", s.settings.warnDays === 60);
check("S6 巨大な文字列は上限で切り詰める", S.sanitize({ stocks: [{ code: "A", name: "x".repeat(1000), memo: "y".repeat(9999) }] }).stocks[0].name.length === 60);
check("S7 配列でない checks / 配列の settings でも落ちない", (() => { try { S.sanitize({ checks: [], settings: [] , stocks: "x", events: 3 }); return true; } catch (e) { return false; } })());
process.exitCode = H.summary() ? 0 : 1;
