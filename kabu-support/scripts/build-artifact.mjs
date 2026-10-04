// 使い方: node scripts/build-artifact.mjs 出力先.html
// データを埋め込んだ単一HTML(アーティファクト用: 外部通信なし)を生成する
import { readFileSync, writeFileSync } from 'node:fs';
const r = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = r('index.html'), css = r('style.css'), js = r('app.js'), data = r('data/latest.json');
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const out = `<title>株サポ</title>
<style>
:root{color-scheme:dark}
${css}
body{background:var(--bg);color:var(--tx);padding-inline:0;margin:0}
.top{top:env(safe-area-inset-top,0px);padding:8px 16px}
main{padding:16px}
.status{padding-inline:16px}
.art #setBtn,.art #liveAdd,.art #liveHint{display:none!important}
</style>
<div class="art" id="root">
${body}
</div>
<script>window.KABU_ARTIFACT=true;window.__SNAPSHOT__=${data.replace(/</g, '\\u003c')};</script>
<script>
${js.replace(/<\/script/g, '<\\/script')}
</script>
`;
writeFileSync(process.argv[2], out);
console.log(out.length, 'bytes');
