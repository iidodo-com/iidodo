/* 単体テスト共通: ブラウザ用スクリプトを vm 上で読み込む（ビルド不要・外部依存なし） */
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");

function loadBrowserScripts(files, extra) {
  const sandbox = Object.assign({ setTimeout, clearTimeout, AbortController, TextEncoder, URL, Promise, console }, extra || {});
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f }));
  return sandbox;
}

let pass = 0, fail = 0; const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS " + name); }
  else { fail++; failures.push(name); console.log("  FAIL " + name + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}
function section(t) { console.log("\n## " + t); }
function summary() { console.log("\n結果: " + pass + " passed / " + fail + " failed"); if (fail) { console.log("失敗: " + failures.join(", ")); } return fail === 0; }
function counts() { return { pass, fail }; }

module.exports = { ROOT, loadBrowserScripts, check, section, summary, counts };
