// 使い方: node scripts/build-worker.mjs
// アプリ本体(HTML/CSS/JS)と株価API中継を1つにまとめた Cloudflare Worker を worker/dist/kabusapo-worker.js に生成する。
// 生成物をダッシュボードに貼り付けるか `cd worker && npx wrangler deploy` で公開すると、そのURLがアプリになる。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const r = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = r('index.html')
  .replace('<link rel="stylesheet" href="style.css">', () => `<style>\n${r('style.css')}\n</style>`)
  .replace('<script src="lib/backtest.js"></script>', () => `<script>\n${r('lib/backtest.js').replace(/<\/script/g, '<\\/script')}\n</script>`)
  .replace('<script src="app.js"></script>', () => `<script>\n${r('app.js').replace(/<\/script/g, '<\\/script')}\n</script>`);
const assets = {
  '/index.html': ['text/html; charset=utf-8', html],
  '/manifest.webmanifest': ['application/manifest+json', r('manifest.webmanifest')],
  '/icon.svg': ['image/svg+xml', r('icon.svg')],
  '/sw.js': ['text/javascript', r('sw.js')],
};
const yahoo = r('lib/yahoo.mjs').replace(/^export /gm, '');
const worker = r('worker/index.js').replace(/^import .*\n/m, '').replace('export default {', 'const worker = {') + '\nexport default worker;\n';
const out = `// 株サポ: アプリ本体 + 株価API中継(自動生成。編集せず scripts/build-worker.mjs を使ってください)\nglobalThis.__ASSETS__ = ${JSON.stringify(assets)};\n${yahoo}\n${worker}`;
mkdirSync(new URL('../worker/dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../worker/dist/kabusapo-worker.js', import.meta.url), out);
console.log('worker/dist/kabusapo-worker.js', Math.round(out.length / 1024) + ' KB');
