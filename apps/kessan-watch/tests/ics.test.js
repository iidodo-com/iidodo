/* ICS 出力の構造検証（RFC 5545 の要点を独立したパーサで確認） */
"use strict";
const H = require("./harness"), fs = require("fs"), path = require("path");
const sb = H.loadBrowserScripts(["js/ics.js"]);
const { check, section } = H;
const NOW = new Date(Date.UTC(2026, 10, 3, 1, 2, 3));
const evs = [
  { code: "8035", date: "2026-11-10", period: "3月期 第2四半期", source: "jquants" },
  { code: "6857", date: "2026-12-31", period: "ダミー第2四半期", source: "dummy" },
  { code: "NVDA", date: "2027-02-28", period: "Q4, FY;27\\テスト", source: "manual" },
  { code: "TSM", date: "2028-02-28", period: "うるう年前日", source: "manual" },
  { code: "LONG", date: "2026-11-11", period: "とても長い対象期の名前".repeat(8), source: "manual" },
  { code: "8035", date: "2026-11-10", period: "3月期 第2四半期", source: "jquants" }   // 重複
];
const names = { "8035": "東京エレクトロン", "6857": "アドバンテスト", NVDA: "NVIDIA, Inc.;テスト\n改行", TSM: "TSMC", LONG: "長い名前" };
const text = sb.KW_ICS.build(evs, c => names[c], NOW);
if (process.argv[2]) fs.writeFileSync(process.argv[2], text);

function unfold(t) { return t.replace(/\r\n[ \t]/g, ""); }
function unesc(v) { return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1"); }
function parse(t) {
  const lines = unfold(t).split("\r\n"); lines.pop();
  const stack = [], comps = [], root = [];
  for (const l of lines) {
    const i = l.indexOf(":"), left = l.slice(0, i), val = l.slice(i + 1), name = left.split(";")[0], params = left.split(";").slice(1);
    if (name === "BEGIN") { const c = { type: val, props: [], kids: [] }; (stack.length ? stack[stack.length - 1].kids : root).push(c); stack.push(c); }
    else if (name === "END") { const c = stack.pop(); if (!c || c.type !== val) throw new Error("BEGIN/END 不整合: " + l); }
    else stack[stack.length - 1].props.push({ name, params, val });
  }
  if (stack.length) throw new Error("END 不足");
  return root;
}

section("ICS 構造検証");
check("I1 全行 CRLF、末尾も CRLF", /\r\n$/.test(text) && !/[^\r]\n/.test(text));
const lines = text.split("\r\n"); lines.pop();
check("I2 全行 75 オクテット以内", lines.every(l => Buffer.byteLength(l) <= 75), lines.filter(l => Buffer.byteLength(l) > 75).length);
check("I3 UTF-8 の途中で折り返していない（デコード結果に欠損文字なし）", !text.includes("�") && !unfold(text).includes("�"));
let cal; try { cal = parse(text); } catch (e) { cal = null; check("I4 BEGIN/END の入れ子が整合", false, e.message); }
if (cal) {
  check("I4 BEGIN/END の入れ子が整合", true);
  const vc = cal[0], get = (c, n) => c.props.filter(p => p.name === n);
  check("I5 VCALENDAR は1つ。VERSION:2.0 と PRODID を持つ", cal.length === 1 && vc.type === "VCALENDAR" && get(vc, "VERSION")[0].val === "2.0" && get(vc, "PRODID").length === 1);
  const ves = vc.kids;
  check("I6 VEVENT 数 = 5（重複1件は除外）", ves.length === 5 && ves.every(v => v.type === "VEVENT"), ves.length);
  check("I7 必須プロパティ UID/DTSTAMP/DTSTART を各1つ持つ", ves.every(v => ["UID", "DTSTAMP", "DTSTART"].every(n => get(v, n).length === 1)));
  check("I8 UID はユニーク", new Set(ves.map(v => get(v, "UID")[0].val)).size === ves.length);
  check("I9 DTSTAMP は UTC 形式 YYYYMMDDTHHMMSSZ", ves.every(v => /^\d{8}T\d{6}Z$/.test(get(v, "DTSTAMP")[0].val)) && get(ves[0], "DTSTAMP")[0].val === "20261103T010203Z");
  const allDay = ves.every(v => get(v, "DTSTART")[0].params.includes("VALUE=DATE") && /^\d{8}$/.test(get(v, "DTSTART")[0].val) && get(v, "DTEND")[0].params.includes("VALUE=DATE"));
  check("I10 終日イベント: DTSTART/DTEND とも VALUE=DATE", allDay);
  const addOne = s => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8) + 1)); return d.toISOString().slice(0, 10).replace(/-/g, ""); };
  check("I11 DTEND は DTSTART の翌日（排他的終了）。月末・年末・うるう年跨ぎも正しい", ves.every(v => get(v, "DTEND")[0].val === addOne(get(v, "DTSTART")[0].val)) && get(ves[1], "DTEND")[0].val === "20270101" && get(ves[3], "DTEND")[0].val === "20280229", ves.map(v => get(v, "DTSTART")[0].val + "→" + get(v, "DTEND")[0].val));
  const sumNvda = unesc(get(ves[2], "SUMMARY")[0].val);
  check("I12 , ; \\ 改行 のエスケープが往復で元に戻る", sumNvda === "決算 NVIDIA, Inc.;テスト\n改行(NVDA) Q4, FY;27\\テスト", sumNvda);
  check("I13 エスケープ前の値に生の改行・未エスケープ , ; が残らない(SUMMARY)", ves.every(v => { const raw = get(v, "SUMMARY")[0].val; return !/(?<!\\)[,;]/.test(raw.replace(/\\\\/g, "")); }));
  check("I14 ダミー由来は件名に【ダミー】、説明にも明記", get(ves[1], "SUMMARY")[0].val.startsWith("【ダミー】") && /ダミーデータ/.test(unesc(get(ves[1], "DESCRIPTION")[0].val)) && !get(ves[0], "SUMMARY")[0].val.includes("ダミー"));
  check("I15 長い件名は折り返され、展開すると完全に復元される", unesc(get(ves[4], "SUMMARY")[0].val) === "決算 長い名前(LONG) " + "とても長い対象期の名前".repeat(8));
  check("I16 UID は銘柄+対象期で安定（日付に依存しない）", get(ves[0], "UID")[0].val === sb.KW_ICS.build([Object.assign({}, evs[0], { date: "2026-12-01" })], c => names[c], NOW).split("\r\n").find(l => l.startsWith("UID:")).slice(4));
  check("I17 UID に日本語/記号の生文字が無い(ASCII のみ)", ves.every(v => /^[A-Za-z0-9_@\-.]+$/.test(get(v, "UID")[0].val)));
  check("I18 TRANSP:TRANSPARENT（空き時間を塞がない）", ves.every(v => get(v, "TRANSP")[0].val === "TRANSPARENT"));
}
check("I19 予定0件でも有効な VCALENDAR を返す", (() => { const t = sb.KW_ICS.build([], () => "", NOW); return /^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR\r\n$/.test(t) && !t.includes("VEVENT"); })());
process.exitCode = H.summary() ? 0 : 1;
