// 使い方: node scripts/fetch-data.mjs [コード...]  → data/latest.json を更新
import { writeFileSync } from 'node:fs';
import { fetchStock } from '../lib/yahoo.mjs';

const codes = process.argv.slice(2).length ? process.argv.slice(2) : ['7203', '6758', '8306', '9984', '7974'];
const stocks = [];
for (const c of codes) {
  try { const s = await fetchStock(c); stocks.push(s); console.log(c, s.name, s.daily.length, 'daily', s.intra.length, 'intra', s.margin.length ? 'margin ' + s.margin[0].t : 'no margin'); }
  catch (e) { console.error(c, 'FAILED', e.message); }
  await new Promise(r => setTimeout(r, 400));
}
if (!stocks.length) process.exit(1);
writeFileSync(new URL('../data/latest.json', import.meta.url), JSON.stringify({ fetchedAt: new Date().toISOString(), stocks }));
