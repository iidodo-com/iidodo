import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
let total = 0, pass = 0, bad = 0;
for (const f of ['unit.test.mjs', 'e2e.test.mjs']) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr || '');
  const m = r.stdout.match(/RESULT \S+ total=(\d+) pass=(\d+) fail=(\d+)/);
  if (!m) { bad++; console.log(`!! ${f}: 結果行なし`); continue; }
  total += +m[1]; pass += +m[2]; bad += +m[3];
}
console.log(`\n==== 合計 ${total}件 / PASS ${pass} / FAIL ${bad} ====`);
process.exit(bad ? 1 : 0);
