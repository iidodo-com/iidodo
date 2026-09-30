// 使い方: cd tools/mansion && npm i && npm run build  →  dist/mansion-shooter.html を生成
import {build} from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const r=await build({entryPoints:[path.join(dir,'main.js')],bundle:true,minify:true,format:'iife',write:false,target:'es2020',legalComments:'none'});
const js=r.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const tpl=fs.readFileSync(path.join(dir,'template.html'),'utf8');
const out=path.join(dir,'../../dist/mansion-shooter.html');
fs.writeFileSync(out,tpl.replace('/*BUNDLE*/',()=>js));
console.log('built',out,(fs.statSync(out).size/1024|0)+'KB');
