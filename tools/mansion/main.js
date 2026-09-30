import * as THREE from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';

const W=480,H=270,FOV=0.66;
const $=id=>document.getElementById(id);
const rnd0=Math.random;
const ri=n=>Math.floor(rnd0()*n);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

/* ---------------- 音 ---------------- */
let AC=null,MASTER=null;
function ac(){
  if(!AC){try{AC=new (window.AudioContext||window.webkitAudioContext)();MASTER=AC.createGain();MASTER.gain.value=SET.vol;MASTER.connect(AC.destination);
    const o=AC.createOscillator(),g=AC.createGain();o.type='sawtooth';o.frequency.value=48;g.gain.value=.025;o.connect(g);g.connect(MASTER);o.start();}catch(e){AC=null}}
  if(AC&&AC.state==='suspended')AC.resume();
  return AC;
}
function noise(dur,vol,freq,q,slide){
  const a=ac();if(!a)return;
  const n=a.sampleRate*dur|0,b=a.createBuffer(1,n,a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n);
  const s=a.createBufferSource();s.buffer=b;
  const f=a.createBiquadFilter();f.type='lowpass';f.frequency.value=freq;f.Q.value=q||1;
  if(slide)f.frequency.exponentialRampToValueAtTime(Math.max(40,slide),a.currentTime+dur);
  const g=a.createGain();g.gain.value=vol;
  s.connect(f);f.connect(g);g.connect(MASTER);s.start();
}
function tone(freq,dur,vol,type,to){
  const a=ac();if(!a)return;
  const o=a.createOscillator(),g=a.createGain();o.type=type||'sine';o.frequency.value=freq;
  if(to)o.frequency.exponentialRampToValueAtTime(to,a.currentTime+dur);
  g.gain.setValueAtTime(vol,a.currentTime);g.gain.exponentialRampToValueAtTime(.0001,a.currentTime+dur);
  o.connect(g);g.connect(MASTER);o.start();o.stop(a.currentTime+dur);
}
const SND={
  pistol:()=>{noise(.18,.6,3000,1,300);tone(160,.1,.3,'square',60)},
  shotgun:()=>{noise(.4,1,2200,1,120);tone(90,.25,.5,'sawtooth',35)},
  smg:()=>{noise(.09,.45,4000,1,400);tone(200,.05,.2,'square',90)},
  magnum:()=>{noise(.5,1,1800,1,90);tone(70,.35,.7,'sawtooth',30)},
  click:()=>tone(900,.04,.15,'square'),
  reload:()=>{tone(300,.05,.2,'square');setTimeout(()=>tone(500,.06,.2,'square'),350)},
  hit:()=>{noise(.12,.5,900,1,200)},
  pain:()=>{noise(.25,.7,500,1,100);tone(110,.25,.4,'sawtooth',60)},
  groan:()=>tone(70+Math.random()*30,.7,.10,'sawtooth',45+Math.random()*10),
  bark:()=>{noise(.15,.35,1400,3,500);tone(320,.15,.15,'sawtooth',180)},
  pick:()=>{tone(700,.08,.2,'triangle');setTimeout(()=>tone(1100,.1,.2,'triangle'),70)},
  heal:()=>{tone(500,.15,.2,'sine',800);setTimeout(()=>tone(800,.2,.2,'sine',1200),120)},
  buy:()=>{tone(1000,.06,.2,'square');setTimeout(()=>tone(1500,.1,.2,'square'),60)},
  boom:()=>{noise(.9,1,700,1,60);tone(50,.8,.6,'sine',25)},
  die:()=>{noise(.35,.5,500,1,80);tone(90,.4,.3,'sawtooth',40)},
};
const snd=n=>{try{SND[n]&&SND[n]()}catch(e){}};

/* ---------------- 設定 / セーブデータ ---------------- */
const SKEY='dead_mansion_slot_',SETKEY='dead_mansion_settings';
let SET={sens:1,vol:.6,inv:false,q:2};
try{Object.assign(SET,JSON.parse(localStorage.getItem(SETKEY)||'{}'))}catch(e){}
function saveSet(){try{localStorage.setItem(SETKEY,JSON.stringify(SET))}catch(e){}if(MASTER)MASTER.gain.value=SET.vol}

const WEAPONS={
  pistol :{name:'ハンドガン',ammo:'9mm',dmg:24,rate:.32,mag:12,spread:.012,pellets:1,auto:false,price:0,reload:1.2,base:400},
  shotgun:{name:'ショットガン',ammo:'shell',dmg:11,rate:.95,mag:6,spread:.075,pellets:8,auto:false,price:1500,reload:2.3,base:600},
  smg    :{name:'サブマシンガン',ammo:'9mm',dmg:13,rate:.085,mag:30,spread:.028,pellets:1,auto:true,price:2400,reload:1.9,base:800},
  magnum :{name:'マグナム',ammo:'mag',dmg:150,rate:1.05,mag:6,spread:.005,pellets:1,auto:false,price:5200,reload:2.7,base:1200},
};
const WORDER=['pistol','shotgun','smg','magnum'];
const AMMO={
  '9mm' :{name:'9mm弾',n:30,price:90},
  'shell':{name:'散弾',n:8,price:140},
  'mag'  :{name:'マグナム弾',n:6,price:260},
};
const BODY={
  hp   :{name:'体力強化',d:'最大HP +15',max:10,base:200},
  armor:{name:'防弾装備',d:'被ダメージ -6%',max:5,base:350},
  spd  :{name:'脚力強化',d:'移動速度 +6%',max:5,base:250},
  rl   :{name:'手さばき',d:'リロード時間 -10%',max:5,base:250},
  luck :{name:'幸運',d:'アイテム・金のドロップ増加',max:5,base:300},
  heal :{name:'薬学知識',d:'ハーブ回復量 +10',max:5,base:200},
};
function defState(){
  return {v:1,money:400,xp:0,lv:1,maxStage:1,sel:1,herbs:2,kills:0,
    own:{pistol:true},
    wp:{pistol:{pow:0,cap:0},shotgun:{pow:0,cap:0},smg:{pow:0,cap:0},magnum:{pow:0,cap:0}},
    res:{'9mm':48,shell:0,mag:0},
    up:{hp:0,armor:0,spd:0,rl:0,luck:0,heal:0},
    savedAt:0,eq:'pistol'};
}
let S=defState();
function merge(t,s){for(const k in s){if(s[k]&&typeof s[k]==='object'&&!Array.isArray(s[k])&&t[k]&&typeof t[k]==='object')merge(t[k],s[k]);else t[k]=s[k]}return t}
function slotInfo(n){try{const j=localStorage.getItem(SKEY+n);return j?JSON.parse(j):null}catch(e){return null}}
function saveTo(n){try{S.savedAt=Date.now();localStorage.setItem(SKEY+n,JSON.stringify(S));return true}catch(e){return false}}
function loadFrom(n){const d=slotInfo(n);if(!d)return false;S=merge(defState(),d);return true}
const xpNeed=()=>Math.round(60*Math.pow(S.lv,1.5));
const maxHp=()=>100+15*S.up.hp+5*(S.lv-1);
const wCap=id=>Math.round(WEAPONS[id].mag*(1+.25*S.wp[id].cap));
const wDmg=id=>WEAPONS[id].dmg*(1+.18*S.wp[id].pow)*(1+.02*(S.lv-1));
const upCost=(base,lv)=>Math.round(base*(lv+1)*(1+lv*.35)/10)*10;

/* ---------------- Three.js 初期化 ---------------- */
const WH=1.5,EY=0.9; // 壁高さ / 目線の高さ
const stageEl=$('stage');
const renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
const cv=renderer.domElement;cv.id='view';stageEl.insertBefore(cv,stageEl.firstChild);
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x020203);
scene.fog=new THREE.FogExp2(0x030405,.13);
const camera=new THREE.PerspectiveCamera(72,16/9,.02,60);
camera.rotation.order='YXZ';scene.add(camera);
const MAXANI=renderer.capabilities.getMaxAnisotropy();

/* ---------------- 手続き型テクスチャ ---------------- */
function hash(x,y,s){let h=Math.imul(x|0,374761393)+Math.imul(y|0,668265263)+Math.imul(s|0,1274126177);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296}
function vn(x,y,s,px,py){
  const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const x0=((xi%px)+px)%px,x1=(x0+1)%px,y0=((yi%py)+py)%py,y1=(y0+1)%py;
  const a=hash(x0,y0,s),b=hash(x1,y0,s),c=hash(x0,y1,s),d=hash(x1,y1,s);
  return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
}
function fbm(u,v,s,fx,fy,oct){ // 周期的fBm(0..1)
  let a=.5,t=0,m=0;fy=fy||fx;
  for(let i=0;i<(oct||4);i++){const X=fx<<i,Y=fy<<i;t+=a*vn(u*X,v*Y,s+i*17,X,Y);m+=a;a*=.5}
  return t/m;
}
const sstep=(a,b,x)=>{x=clamp((x-a)/(b-a),0,1);return x*x*(3-2*x)};
function genTex(size,fn,post,opt){
  opt=opt||{};
  const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');
  const hc=document.createElement('canvas');hc.width=hc.height=size;const hg=hc.getContext('2d');
  const im=g.createImageData(size,size),hi=hg.createImageData(size,size),o=[0,0,0,0];
  for(let py=0;py<size;py++){const v=1-(py+.5)/size;
    for(let px=0;px<size;px++){
      const u=(px+.5)/size;o[3]=.5;fn(u,v,o);
      const i=(py*size+px)*4;
      im.data[i]=clamp(o[0],0,255);im.data[i+1]=clamp(o[1],0,255);im.data[i+2]=clamp(o[2],0,255);im.data[i+3]=255;
      const h=clamp(o[3]*255,0,255);hi.data[i]=hi.data[i+1]=hi.data[i+2]=h;hi.data[i+3]=255;
    }}
  g.putImageData(im,0,0);hg.putImageData(hi,0,0);
  if(post)post(g,size,hg);
  const map=new THREE.CanvasTexture(c),bump=new THREE.CanvasTexture(hc);
  map.colorSpace=THREE.SRGBColorSpace;
  for(const t of [map,bump]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=MAXANI}
  return {map,bump};
}
const RS=mulberry(77);
function splat(g,size,n,col,rmin,rmax,drip){
  for(let i=0;i<n;i++){
    const x=RS()*size,y=RS()*size,r=rmin+RS()*(rmax-rmin);
    g.fillStyle=col;g.beginPath();g.ellipse(x,y,r,r*(.6+RS()*.6),RS()*3,0,7);g.fill();
    for(let k=0;k<5;k++){g.beginPath();g.arc(x+(RS()-.5)*r*2.4,y+(RS()-.5)*r*2.4,r*(.1+RS()*.25),0,7);g.fill()}
    if(drip){g.fillRect(x-1.5,y,3,r*(2+RS()*7));}
  }
}
const TX={};
function buildTextures(){
  const S5=512;
  // 煉瓦
  TX.brick=genTex(S5,(u,v,o)=>{
    const rows=16,cols=5,row=Math.floor(v*rows),off=(row&1)?.5:0;
    let bu=u*cols+off;const col=Math.floor(bu);bu-=col;const bv=v*rows-row;
    const w=(fbm(u,v,3,8,8,2)-.5)*.05;
    const mort=bu<.05+w||bu>.97+w||bv<.1||bv>.95;
    const id=hash(((col%cols)+cols)%cols,row,7);
    const gr=fbm(u,v,11,10,10,5),st=Math.pow(fbm(u*1,v,21,6,2,3),2);
    let r,g,b,h;
    if(mort){const k=.6+gr*.5;r=78*k;g=72*k;b=64*k;h=.12+gr*.1}
    else{const k=.6+gr*.75;r=(110+id*55)*k;g=(52+id*22)*k;b=(42+id*15)*k;
      const e=Math.min(bu,.97-bu,bv-.1,.95-bv)*8;h=.55+id*.15+Math.min(e,.3)*.5+(fbm(u,v,5,32,32,3)-.5)*.35}
    const k2=(.7+.3*sstep(0,.35,v))*(1-.45*st)*(.8+.2*sstep(1,.8,v));
    o[0]=r*k2;o[1]=g*k2;o[2]=b*k2;o[3]=h;
  },(g,s)=>{g.globalAlpha=.55;g.fillStyle='#4a0606';splat(g,s,3,'#4a0606',6,20,true);g.globalAlpha=1});
  // 板張り壁（壁紙＋腰壁）
  TX.wood=genTex(S5,(u,v,o)=>{
    let r,g,b,h;
    const n=fbm(u,v,31,4,4,5);
    if(v<.36){ // 腰壁 羽目板
      const pl=Math.floor(u*4),pu=u*4-pl,gr=fbm(u,v*.2,41,24,2,4);
      const seam=pu<.03||pu>.97;const k=.55+gr*.7+hash(pl,1,3)*.2;
      r=105*k;g=64*k;b=34*k;h=seam?.05:.5+gr*.2;
      if(v>.335){r=50;g=30;b=16;h=.85}
    }else{ // 縞の壁紙
      const st=Math.sin(u*Math.PI*2*6)*.5+.5,dm=Math.sin((u*6+v*8)*Math.PI*2)*Math.sin((u*6-v*8)*Math.PI*2);
      const k=.5+n*.6;const p=.85+.15*st+.06*dm;
      r=150*k*p;g=128*k*p;b=92*k*p;
      const stn=Math.pow(fbm(u,v,51,3,1,4),2.2);r*=1-.55*stn;g*=1-.5*stn;b*=1-.45*stn;
      h=.5+.06*st+.03*dm;
    }
    o[0]=r;o[1]=g;o[2]=b;o[3]=h;
  },(g,s)=>{g.globalAlpha=.6;g.fillStyle='#500808';splat(g,s,2,'#500808',8,22,true);g.globalAlpha=1;
    g.fillStyle='rgba(20,10,4,.6)';g.fillRect(0,s*(1-.36)-2,s,4)});
  // コンクリ
  TX.concrete=genTex(S5,(u,v,o)=>{
    const n=fbm(u,v,61,6,6,6),cr=Math.abs(fbm(u,v,63,5,5,5)-.5);
    const crack=sstep(.012,0,cr);const st=Math.pow(fbm(u,v,65,8,2,4),1.8);
    const seam=(Math.abs(u-.5)<.004||Math.abs(v-.5)<.004)?.5:1;
    let k=(.5+n*.7)*(1-.5*st)*seam*(1-.7*crack);
    o[0]=118*k;o[1]=120*k;o[2]=116*k;o[3]=.55+n*.3-crack*.5;
  },(g,s)=>{splat(g,s,5,'rgba(88,6,6,.7)',8,26,true);
    g.fillStyle='rgba(200,170,0,.55)';for(let i=0;i<12;i++){g.save();g.translate(i*s/6-20,s-18);g.rotate(-.6);g.fillRect(0,0,16,60);g.restore()}
    g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,s-20,s,20)});
  // 大理石の柱
  TX.marble=genTex(S5,(u,v,o)=>{
    const t=fbm(u,v,71,3,3,5),vein=Math.abs(Math.sin((u*3+t*3.5+v*.5)*Math.PI*2));
    const vv=sstep(.15,0,vein);let k=.7+t*.5;
    let band=(v<.06||v>.94)?.45:1;
    o[0]=(190*k-vv*90)*band;o[1]=(186*k-vv*88)*band;o[2]=(172*k-vv*80)*band;o[3]=.6+t*.2-vv*.2;
  });
  // 出口扉
  TX.door=genTex(S5,(u,v,o)=>{
    const n=fbm(u,v,81,10,10,4);
    const panel=(u>.1&&u<.9&&((v>.08&&v<.46)||(v>.52&&v<.9)));
    const edge=panel?Math.min(u-.1,.9-u,Math.abs(v-.08),Math.abs(v-.46),Math.abs(v-.52),Math.abs(v-.9)):0;
    let k=(.55+n*.6)*(panel?(edge<.02?1.3:.95):.75);
    o[0]=88*k;o[1]=94*k;o[2]=100*k;o[3]=panel?(edge<.02?.9:.55):.35;
    const rv=((u*20)%1<.12&&(Math.abs((v*20)%1)<.12));if(rv&&!panel){o[0]*=1.5;o[1]*=1.5;o[2]*=1.5;o[3]=.9}
    if(v<.06){o[0]=40;o[1]=36;o[2]=34}
  },(g,s)=>{
    g.fillStyle='#1a0505';g.fillRect(s*.3,s*.2,s*.4,s*.14);
    g.fillStyle='#ff3b2a';g.font='bold '+(s*.11)+'px monospace';g.textAlign='center';g.fillText('EXIT',s*.5,s*.31);
    g.fillStyle='#c22';g.beginPath();g.arc(s*.5,s*.55,s*.03,0,7);g.fill();
    g.fillStyle='#bbb';g.fillRect(s*.72,s*.5,s*.05,s*.14);
    g.fillStyle='rgba(255,255,0,.85)';for(let i=0;i<8;i++){g.save();g.translate(s*.12+i*s*.1,s*.94);g.rotate(-.7);g.fillRect(0,0,s*.05,s*.12);g.restore()}
  });
  // 床（タイル）
  TX.floor=genTex(S5,(u,v,o)=>{
    const tx=Math.floor(u*4),ty=Math.floor(v*4),fu=u*4-tx,fv=v*4-ty;
    const grout=fu<.03||fu>.97||fv<.03||fv>.97;
    const chk=((tx+ty)&1)?1:0,id=hash(tx,ty,5);
    const n=fbm(u,v,91,8,8,5),dirt=fbm(u,v,93,3,3,4);
    let k=(chk?.85:.45)*(.65+n*.6)*(.7+dirt*.5)*(.85+id*.3);
    let r=170*k,g=165*k,b=155*k;
    if(grout){r=30*(.5+n);g=28*(.5+n);b=26*(.5+n)}
    const sc=fbm(u*1,v,95,64,64,1)>.86?1.25:1;
    o[0]=r*sc;o[1]=g*sc;o[2]=b*sc;o[3]=grout?.05:.6+n*.3;
  },(g,s)=>{splat(g,s,4,'rgba(78,4,4,.75)',10,32,false)});
  TX.ceil=genTex(S5,(u,v,o)=>{
    const n=fbm(u,v,101,6,6,5),st=Math.pow(fbm(u,v,103,3,3,4),1.6);
    const gx=Math.abs(((u*2)%1)-.5)>.47||Math.abs(((v*2)%1)-.5)>.47;
    let k=(.55+n*.5)*(1-.6*st)*(gx?.4:1);
    o[0]=100*k;o[1]=96*k;o[2]=88*k;o[3]=gx?.1:.6;
  });
  // 木箱・樽
  TX.crate=genTex(256,(u,v,o)=>{
    const pl=Math.floor(v*4),gr=fbm(u*.3,v,111,2,12,4),seam=(v*4-pl)<.05;
    const edge=u<.08||u>.92||v<.08||v>.92;
    let k=(.55+gr*.8)*(edge?.7:1)*(seam?.4:1);
    o[0]=118*k;o[1]=80*k;o[2]=46*k;o[3]=seam?.1:.55+gr*.3;
  });
  TX.barrel=genTex(256,(u,v,o)=>{
    const n=fbm(u,v,121,6,6,5),rust=Math.pow(fbm(u,v,123,5,5,4),1.5);
    const ring=(Math.abs(v-.15)<.03||Math.abs(v-.85)<.03||Math.abs(v-.5)<.02);
    let r=90+120*rust,g=40+50*rust,b=30+15*rust;
    const k=(.5+n*.7)*(ring?1.25:1);
    o[0]=r*k*.7;o[1]=g*k*.7;o[2]=b*k*.7;o[3]=ring?.9:.5+n*.2;
  });
  // ゾンビ肌 / 服 / ズボン
  const skin=(seed,base)=>genTex(256,(u,v,o)=>{
    const n=fbm(u,v,seed,6,6,5),bru=Math.pow(fbm(u,v,seed+3,3,3,4),2),ve=sstep(.05,0,Math.abs(fbm(u,v,seed+7,8,8,4)-.5));
    let r=base[0]*(.6+n*.7),g=base[1]*(.6+n*.7),b=base[2]*(.6+n*.7);
    r=r*(1-bru*.4)+60*bru*.4;b=b*(1-bru*.3)+90*bru*.3;
    r*=1-ve*.5;g*=1-ve*.2;b*=1-ve*.1;
    o[0]=r;o[1]=g;o[2]=b;o[3]=.5+n*.4;
  },(g,s)=>{splat(g,s,6,'rgba(110,4,4,.8)',5,22,true)});
  TX.skinZ=skin(131,[105,118,90]);TX.skinB=skin(141,[100,105,85]);TX.skinBoss=skin(151,[85,80,105]);
  const cloth=(seed,base)=>genTex(256,(u,v,o)=>{
    const w=(Math.sin(u*256*1.5)*Math.sin(v*256*1.5))*.08,n=fbm(u,v,seed,6,6,5),dirt=fbm(u,v,seed+3,3,3,4);
    const k=(.5+n*.7)*(.6+dirt*.6)+w;
    o[0]=base[0]*k;o[1]=base[1]*k;o[2]=base[2]*k;o[3]=.5+w+n*.2;
  },(g,s)=>{splat(g,s,7,'rgba(100,5,5,.85)',6,26,true);g.strokeStyle='rgba(0,0,0,.6)';g.lineWidth=3;for(let i=0;i<5;i++){g.beginPath();g.moveTo(RS()*s,RS()*s);g.lineTo(RS()*s,RS()*s);g.stroke()}});
  TX.clothZ=cloth(161,[100,86,68]);TX.clothB=cloth(171,[46,58,78]);TX.clothBoss=cloth(181,[34,34,40]);
  TX.pantsZ=cloth(191,[52,56,74]);
  // 円形グロー・血・穴（スプライト用）
  const rad=(stops,size)=>{const c=document.createElement('canvas');c.width=c.height=size||64;const g=c.getContext('2d');const gr=g.createRadialGradient(c.width/2,c.width/2,0,c.width/2,c.width/2,c.width/2);for(const [p,col] of stops)gr.addColorStop(p,col);g.fillStyle=gr;g.fillRect(0,0,c.width,c.width);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t};
  TX.glow=rad([[0,'rgba(255,255,255,1)'],[.3,'rgba(255,255,255,.4)'],[1,'rgba(255,255,255,0)']]);
  TX.dot=rad([[0,'rgba(255,255,255,1)'],[.6,'rgba(255,255,255,.9)'],[1,'rgba(255,255,255,0)']],32);
  TX.hole=rad([[0,'rgba(0,0,0,1)'],[.5,'rgba(10,8,6,.9)'],[.7,'rgba(30,25,20,.35)'],[1,'rgba(0,0,0,0)']],64);
  TX.pool=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d');
    g.fillStyle='rgba(70,0,0,.92)';for(let i=0;i<14;i++){const a=RS()*6.28,d=RS()*28;g.beginPath();g.ellipse(64+Math.cos(a)*d,64+Math.sin(a)*d,14+RS()*20,12+RS()*18,RS()*3,0,7);g.fill()}
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t})();
}

/* ---------------- ワールド構築 ---------------- */
let world=null,enemyGroup=null,itemGroup=null,propList=[];
const MAT={};
function stdMat(t,opt){return new THREE.MeshStandardMaterial(Object.assign({map:t.map,bumpMap:t.bump,bumpScale:2.2,roughness:.85,metalness:0},opt||{}))}
function buildMaterials(){
  MAT[1]=stdMat(TX.brick);MAT[2]=stdMat(TX.wood,{roughness:.8});MAT[3]=stdMat(TX.concrete,{roughness:.95});
  MAT[4]=stdMat(TX.marble,{roughness:.35,bumpScale:.6});
  MAT[9]=stdMat(TX.door,{roughness:.45,metalness:.6,emissive:0x220000,emissiveMap:TX.door.map,emissiveIntensity:.5});
  MAT.floor=stdMat(TX.floor,{roughness:.42,metalness:.05,bumpScale:1.5});
  MAT.ceil=stdMat(TX.ceil,{roughness:.9});
  MAT.crate=stdMat(TX.crate);MAT.barrel=stdMat(TX.barrel,{roughness:.55,metalness:.6});
  MAT.lamp=new THREE.MeshStandardMaterial({color:0x222222,emissive:0xffcc88,emissiveIntensity:4});
  MAT.lampDead=new THREE.MeshStandardMaterial({color:0x222222,emissive:0x000000});
  MAT.lampRed=new THREE.MeshStandardMaterial({color:0x220000,emissive:0xff2010,emissiveIntensity:4});
  for(const k of [1,2,3,4,9])MAT[k].map.repeat.set(1,1);
  MAT.floor.map.repeat.set(N,N);MAT.floor.bumpMap.repeat.set(N,N);
  MAT.ceil.map.repeat.set(N,N);MAT.ceil.bumpMap.repeat.set(N,N);
}
const LIGHTS={pool:[],rooms:[]};
function disposeWorld(){
  for(const g of [world,enemyGroup,itemGroup]){if(!g)continue;scene.remove(g);g.traverse(o=>{if(o.geometry)o.geometry.dispose()})}
  world=enemyGroup=itemGroup=null;
}
const isOpen=c=>c===0||c===5;
function buildWorld(){
  disposeWorld();
  world=new THREE.Group();enemyGroup=new THREE.Group();itemGroup=new THREE.Group();
  scene.add(world,enemyGroup,itemGroup);
  const geo={};
  const add=(t,q)=>{const g=geo[t]||(geo[t]={p:[],n:[],u:[],i:[]});const b=g.p.length/3;
    for(const v of q.v)g.p.push(...v);for(let k=0;k<4;k++)g.n.push(...q.n);
    g.u.push(0,0,1,0,1,1,0,1);g.i.push(b,b+1,b+2,b,b+2,b+3)};
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    const t=MAP[y*N+x];if(t===0||t===5)continue;
    if(isOpen(cell(x,y-1)))add(t,{n:[0,0,-1],v:[[x+1,0,y],[x,0,y],[x,WH,y],[x+1,WH,y]]});
    if(isOpen(cell(x,y+1)))add(t,{n:[0,0,1],v:[[x,0,y+1],[x+1,0,y+1],[x+1,WH,y+1],[x,WH,y+1]]});
    if(isOpen(cell(x-1,y)))add(t,{n:[-1,0,0],v:[[x,0,y],[x,0,y+1],[x,WH,y+1],[x,WH,y]]});
    if(isOpen(cell(x+1,y)))add(t,{n:[1,0,0],v:[[x+1,0,y+1],[x+1,0,y],[x+1,WH,y],[x+1,WH,y+1]]});
  }
  for(const t in geo){
    const g=geo[t],bg=new THREE.BufferGeometry();
    bg.setAttribute('position',new THREE.Float32BufferAttribute(g.p,3));
    bg.setAttribute('normal',new THREE.Float32BufferAttribute(g.n,3));
    bg.setAttribute('uv',new THREE.Float32BufferAttribute(g.u,2));
    bg.setIndex(g.i);
    const m=new THREE.Mesh(bg,MAT[t]);m.castShadow=true;m.receiveShadow=true;world.add(m);
  }
  const fl=new THREE.Mesh(new THREE.PlaneGeometry(N,N),MAT.floor);fl.rotation.x=-Math.PI/2;fl.position.set(N/2,0,N/2);fl.receiveShadow=true;world.add(fl);
  const ce=new THREE.Mesh(new THREE.PlaneGeometry(N,N),MAT.ceil);ce.rotation.x=Math.PI/2;ce.position.set(N/2,WH,N/2);ce.receiveShadow=true;world.add(ce);
  // 照明器具・小道具
  LIGHTS.rooms=[];
  ROOMS.forEach((r,i)=>{
    const red=hash(i,LV.seed,5)<.28,dead=!red&&hash(i,LV.seed,9)<.25;
    const lx=r.x+r.w/2,lz=r.y+r.h/2;
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(.5,.04,.16),red?MAT.lampRed:dead?MAT.lampDead:MAT.lamp);
    lamp.position.set(lx,WH-.02,lz);world.add(lamp);
    const hang=new THREE.Mesh(new THREE.BoxGeometry(.02,.1,.02),MAT.lampDead);hang.position.set(lx,WH-.06,lz);
    LIGHTS.rooms.push({x:lx,z:lz,y:WH-.2,col:red?0xff2a18:0xffc890,inten:dead?0:(red?5:9),fl:dead||hash(i,3,3)<.4,ph:hash(i,1,1)*50});
    // 小道具（部屋の隅）
    const corners=[[r.x,r.y],[r.x+r.w-1,r.y],[r.x,r.y+r.h-1],[r.x+r.w-1,r.y+r.h-1]];
    for(const [cx,cy] of corners){
      if(MAP[cy*N+cx]!==0||hash(cx,cy,LV.seed)>.55||(cx===LV.start.cx&&cy===LV.start.cy))continue;
      if(Math.abs(cx-LV.start.cx)<2&&Math.abs(cy-LV.start.cy)<2)continue;
      MAP[cy*N+cx]=5;
      const barrel=hash(cx,cy,LV.seed+1)<.5;let m;
      if(barrel){m=new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.72,20),MAT.barrel);m.position.set(cx+.5,.36,cy+.5)}
      else{const s=.62+hash(cx,cy,4)*.12;m=new THREE.Mesh(new THREE.BoxGeometry(s,s,s),MAT.crate);m.position.set(cx+.5,s/2,cy+.5);m.rotation.y=hash(cx,cy,6)*.6}
      m.castShadow=m.receiveShadow=true;world.add(m);
      if(!barrel&&hash(cx,cy,8)<.5){const s2=.42;const m2=new THREE.Mesh(new THREE.BoxGeometry(s2,s2,s2),MAT.crate);m2.position.set(cx+.5,.66+s2/2-.04,cy+.5);m2.rotation.y=hash(cx,cy,7);m2.castShadow=m2.receiveShadow=true;world.add(m2)}
    }
  });
  // 出口の赤ランプ
  const ex=LV.exitDoor;
  const dl=new THREE.Sprite(new THREE.SpriteMaterial({map:TX.glow,color:0xff2010,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}));
  dl.scale.set(1.4,1.4,1);
  // 扉に面した床側へずらす
  let ox=0,oz=0;for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]])if(isOpen(cell(ex[0]+a,ex[1]+b))){ox=a;oz=b}
  dl.position.set(ex[0]+.5+ox*.35,WH*.72,ex[1]+.5+oz*.35);world.add(dl);LV.doorGlow=dl;
  // ブラッドデカール
  LV.decals=[];
  for(let i=0;i<10+P.stage;i++){
    const r=ROOMS[ri(ROOMS.length)],x=r.x+rnd0()*r.w,z=r.y+rnd0()*r.h;
    if(cell(x,z)!==0)continue;addDecal(x,z,.5+rnd0()*.7,true);
  }
}
const decalGeo=new THREE.PlaneGeometry(1,1);
const decalMat=new THREE.MeshBasicMaterial({map:null,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2,fog:true});
function addDecal(x,z,size,static_){
  if(!decalMat.map)decalMat.map=TX.pool;
  const m=new THREE.Mesh(decalGeo,static_?decalMat:decalMat);
  m.rotation.set(-Math.PI/2,0,rnd0()*6.28);m.position.set(x,.006+rnd0()*.002,z);m.scale.setScalar(size);
  m.renderOrder=1;world.add(m);
  if(!static_){m.scale.setScalar(.01);LV.decals.push({m,t:0,size})}
  return m;
}

/* ---------------- 敵モデル ---------------- */
const CAP=(r,l)=>new THREE.CapsuleGeometry(r,l,4,10);
const G={
  cap:{},
};
function mesh(geo,mat,x,y,z){const m=new THREE.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);m.castShadow=true;return m}
const eyeMat=c=>new THREE.MeshStandardMaterial({color:0x000000,emissive:c,emissiveIntensity:5});
function mkMats(kind){
  const skin=stdMat(kind==='boss'?TX.skinBoss:kind==='brute'?TX.skinB:TX.skinZ,{roughness:.6,bumpScale:1,emissive:0x000000});
  const cloth=stdMat(kind==='boss'?TX.clothBoss:kind==='brute'?TX.clothB:TX.clothZ,{roughness:.9,bumpScale:1.4,emissive:0x000000});
  const pants=stdMat(TX.pantsZ,{roughness:.9,bumpScale:1.4,emissive:0x000000});
  if(kind==='zombie'){const h=rnd0();const tint=[[1,1,1],[.9,.85,1.1],[1.1,1.05,.85],[.85,1,.95]][ri(4)];skin.color.setRGB(...tint);cloth.color.setRGB(...[[1,1,1],[1.2,.8,.8],[.8,1,.9],[.9,.9,1.2]][ri(4)])}
  return {skin,cloth,pants,eye:eyeMat(kind==='boss'?0xffd020:kind==='brute'?0xff6a10:0xff1808)};
}
function buildHuman(kind){
  const M=mkMats(kind),g=new THREE.Group(),rig={};
  const boss=kind==='boss',brute=kind==='brute';
  // 脚
  rig.legs=[];
  for(const sx of [-1,1]){
    const hip=new THREE.Group();hip.position.set(sx*.075,.46,0);
    hip.add(mesh(CAP(.055,.14),M.pants,0,-.11,0));
    const knee=new THREE.Group();knee.position.y=-.22;hip.add(knee);
    knee.add(mesh(CAP(.045,.14),M.pants,0,-.11,0));
    knee.add(mesh(new THREE.BoxGeometry(.07,.04,.14),new THREE.MeshStandardMaterial({color:0x111111,roughness:.6}),0,-.22,.03));
    g.add(hip);rig.legs.push({hip,knee});
  }
  g.add(mesh(new THREE.BoxGeometry(.24,.12,.14),M.pants,0,.48,0));
  // 上半身
  const up=new THREE.Group();up.position.set(0,.5,0);g.add(up);rig.up=up;
  const torso=mesh(CAP(.12,.16),M.cloth,0,.17,0);torso.scale.set(1.05,1,.66);up.add(torso);
  if(boss){ // 黒いロングコート
    const coat=mesh(new THREE.CylinderGeometry(.14,.2,.45,14,1,true),M.cloth,0,-.02,0);coat.scale.z=.7;coat.material.side=THREE.DoubleSide;g.add(coat);coat.position.set(0,.36,0);
    for(const sx of [-1,1]){const sp=mesh(new THREE.ConeGeometry(.04,.18,8),new THREE.MeshStandardMaterial({color:0x151515,metalness:.6,roughness:.4}),sx*.2,.36,0);sp.rotation.z=-sx*1.0;up.add(sp)}
  }
  up.add(mesh(new THREE.CylinderGeometry(.04,.05,.08,8),M.skin,0,.34,0));
  const head=new THREE.Group();head.position.set(0,.34,.01);up.add(head);rig.head=head;
  const hs=mesh(new THREE.SphereGeometry(.085,20,16),M.skin,0,.09,0);hs.scale.set(1,1.15,1.05);head.add(hs);
  const jaw=mesh(new THREE.BoxGeometry(.07,.03,.06),M.skin,0,.02,.04);head.add(jaw);rig.jaw=jaw;
  for(const sx of [-1,1]){const e=new THREE.Mesh(new THREE.SphereGeometry(.014,8,8),M.eye);e.position.set(sx*.035,.105,.078);head.add(e)}
  const hair=mesh(new THREE.SphereGeometry(.089,16,10,0,Math.PI*2,0,Math.PI*.42),new THREE.MeshStandardMaterial({color:boss?0x111111:0x2a2018,roughness:1}),0,.1,-.006);hair.scale.set(1,1.15,1.05);head.add(hair);
  // 腕
  rig.arms=[];
  for(const sx of [-1,1]){
    const sh=new THREE.Group();sh.position.set(sx*.17,.28,0);up.add(sh);
    sh.add(mesh(CAP(.042,.1),M.cloth,0,-.1,0));
    const el=new THREE.Group();el.position.y=-.2;sh.add(el);
    el.add(mesh(CAP(.035,.1),M.skin,0,-.09,0));
    const hand=mesh(new THREE.SphereGeometry(.04,10,8),M.skin,0,-.2,0);hand.scale.set(.8,1.2,.6);el.add(hand);
    if(boss&&sx>0){for(let k=-1;k<=1;k++){const cl=mesh(new THREE.ConeGeometry(.012,.14,6),new THREE.MeshStandardMaterial({color:0xbbbbcc,metalness:.8,roughness:.3}),k*.025,-.3,.0);cl.rotation.x=Math.PI;el.add(cl)}}
    rig.arms.push({sh,el});
  }
  if(brute){torso.scale.set(1.35,1.1,.9)}
  g.userData={rig,M,kind};
  return g;
}
function buildDog(){
  const M={skin:stdMat(TX.skinB,{roughness:.7,bumpScale:1}),eye:eyeMat(0xff2010)};
  M.skin.color.setRGB(.45,.36,.3);M.skin.emissive=new THREE.Color(0);
  const g=new THREE.Group(),rig={};
  const body=mesh(CAP(.11,.28),M.skin,0,.28,0);body.rotation.x=Math.PI/2;g.add(body);
  const head=new THREE.Group();head.position.set(0,.36,.28);g.add(head);rig.head=head;
  head.add(mesh(new THREE.SphereGeometry(.1,14,12),M.skin,0,0,0));
  const snout=mesh(new THREE.BoxGeometry(.09,.07,.14),M.skin,0,-.03,.11);head.add(snout);
  const jaw=mesh(new THREE.BoxGeometry(.075,.02,.11),M.skin,0,-.075,.09);head.add(jaw);rig.jaw=jaw;
  for(const sx of [-1,1]){
    const e=new THREE.Mesh(new THREE.SphereGeometry(.014,8,8),M.eye);e.position.set(sx*.045,.03,.08);head.add(e);
    const ear=mesh(new THREE.ConeGeometry(.03,.08,6),M.skin,sx*.06,.1,-.02);ear.rotation.z=-sx*.3;head.add(ear);
  }
  rig.legs=[];
  for(const [sx,sz] of [[-1,.17],[1,.17],[-1,-.17],[1,-.17]]){
    const hip=new THREE.Group();hip.position.set(sx*.07,.26,sz);
    hip.add(mesh(CAP(.03,.14),M.skin,0,-.1,0));g.add(hip);rig.legs.push({hip});
  }
  const tail=mesh(CAP(.02,.12),M.skin,0,.34,-.36);tail.rotation.x=-.9;g.add(tail);
  g.userData={rig,M,kind:'dog'};
  return g;
}
const ETYPE={
  zombie:{hp:60,spd:.85,dmg:12,scale:1,h:1.03,r:.2,range:.9,rate:1.1,money:30,xp:10,sight:9,snd:'groan'},
  dog   :{hp:35,spd:2.9,dmg:8,scale:1,h:.5,r:.24,range:.95,rate:.7,money:40,xp:12,sight:12,snd:'bark'},
  brute :{hp:220,spd:.7,dmg:28,scale:1.15,h:1.18,r:.27,range:1.0,rate:1.4,money:120,xp:45,sight:9,snd:'groan'},
  boss  :{hp:1400,spd:1.15,dmg:38,scale:1.32,h:1.36,r:.32,range:1.3,rate:1.2,money:1200,xp:300,sight:22,snd:'groan'},
};
function makeEnemyMesh(e){
  const m=e.t==='dog'?buildDog():buildHuman(e.t);
  const s=ETYPE[e.t].scale*(0.95+rnd0()*.1);
  m.scale.setScalar(s);e.sc=s;e.mesh=m;e.rig=m.userData.rig;e.mats=Object.values(m.userData.M).filter(x=>x.emissive&&x.emissiveIntensity!==5);
  e.ph=rnd0()*10;
  enemyGroup.add(m);
  if(e.t==='boss'){const l=new THREE.PointLight(0xffb020,2.5,4,2);l.position.set(0,.9,0);m.add(l)}
}
function animEnemy(e,dt){
  const m=e.mesh,r=e.rig,t=P.t+e.ph;
  m.position.set(e.x,0,e.y);
  if(!e.dead&&e.face===undefined)e.face=0;
  const dx=P.x-e.x,dz=P.y-e.y;
  if(!e.dead&&(e.state==='chase'||e.face===0)){
    const want=Math.atan2(dx,dz);let d=want-(e.yaw||0);d=Math.atan2(Math.sin(d),Math.cos(d));e.yaw=(e.yaw||0)+d*Math.min(1,dt*8);
    if(e.face===0&&e.state==='idle')e.yaw=e.yaw0===undefined?(e.yaw0=rnd0()*6.28):e.yaw0;
  }
  m.rotation.y=e.yaw||0;
  const dog=e.t==='dog';
  if(e.dead){
    const f=Math.min(1,e.deadT/(dog?.35:.7)),ff=f*f*(3-2*f);
    m.rotation.x=dog?0:-ff*1.45;m.rotation.z=dog?ff*1.5:0;
    m.position.y=(dog?.1:.1)*ff;
    if(r.jaw)r.jaw.position.y=.0;
    const sink=Math.max(0,e.deadT-25);m.position.y-=sink*.05;
    return;
  }
  m.rotation.x=e.flash>0?-.12:0;
  const chase=e.state==='chase'&&e.stun<=0;
  const w=e.anim*(dog?1.4:1.2);
  if(dog){
    const s=Math.sin(w*2.2),lift=chase?1:0;
    r.legs.forEach((l,i)=>{l.hip.rotation.x=(i%2?-1:1)*(i<2?1:-1)*s*.8*lift+(i<2?0:0)});
    m.position.y=lift*Math.abs(Math.sin(w*2.2))*.05;
    r.head.rotation.x=e.atk>0?-.3:.1;r.jaw.rotation.x=e.atk>0?.7:.15+Math.sin(t*10)*.05*lift;
    m.rotation.x+=e.atk>0?-.25:0;
  }else{
    const boss=e.t==='boss',sp=boss?1.5:1;
    const s=Math.sin(w*3*sp),c=Math.cos(w*3*sp);
    const wk=chase?1:.0;
    r.legs.forEach((l,i)=>{const ph=i?1:-1;l.hip.rotation.x=ph*s*.55*wk;l.knee.rotation.x=Math.max(0,-ph*c)*.7*wk});
    r.up.rotation.x=.18+(chase?.12:0)+Math.sin(t*1.3)*.03;
    r.up.rotation.z=Math.sin(w*3*sp)*.08*wk+Math.sin(t*.9)*.03;
    r.up.position.y=.5+Math.abs(s)*.012*wk;
    r.head.rotation.z=Math.sin(t*.7)*.18+(chase?Math.sin(t*3)*.08:0);
    r.head.rotation.x=.2+Math.sin(t*1.1)*.08;
    r.jaw.rotation.x=e.atk>0?.9:.25+Math.sin(t*2)*.1;
    r.arms.forEach((a,i)=>{
      const ph=i?1:-1;
      if(e.atk>0){const k=1-e.atk/.35;a.sh.rotation.x=-2.3+Math.sin(k*3.1)*1.1;a.el.rotation.x=-.4}
      else{a.sh.rotation.x=(chase?-1.35:-.55)+ph*Math.sin(w*3*sp)*.15*wk+Math.sin(t*1.7+i)*.06;a.el.rotation.x=-.5-(chase?.2:0)}
      a.sh.rotation.z=(i?1:-1)*.1;
    });
    r.legs.forEach(()=>{});
  }
  const f=Math.max(0,e.flash*8);
  for(const mat of e.mats)mat.emissive.setRGB(f*.9,f*.35,f*.3);
}

/* ---------------- 部屋ライト ---------------- */
let flashlight,fillLight,muzzleLight,lightPool=[];
function initLights(){
  scene.add(new THREE.HemisphereLight(0x556080,0x20180f,.6));
  flashlight=new THREE.SpotLight(0xfff0d8,15,22,.55,.6,1.0);
  flashlight.position.set(.12,-.08,0);flashlight.target.position.set(0,-.02,-5);
  flashlight.castShadow=true;flashlight.shadow.mapSize.set(1024,1024);flashlight.shadow.bias=-.0004;flashlight.shadow.normalBias=.02;
  flashlight.shadow.camera.near=.05;flashlight.shadow.camera.far=20;
  camera.add(flashlight,flashlight.target);
  fillLight=new THREE.PointLight(0xa0b0ff,.6,3.2,2);fillLight.position.set(0,.05,0);camera.add(fillLight);
  muzzleLight=new THREE.PointLight(0xffa040,0,7,2);muzzleLight.position.set(.1,-.05,-.5);camera.add(muzzleLight);
  for(let i=0;i<4;i++){const l=new THREE.PointLight(0xffc890,0,9,2);l.userData={base:0,tgt:null};scene.add(l);lightPool.push(l)}
}
let lightT=0;
function updateRoomLights(dt){
  lightT-=dt;
  if(lightT<=0&&LIGHTS.rooms.length){
    lightT=.4;
    const ds=LIGHTS.rooms.map(r=>({r,d:Math.hypot(r.x-P.x,r.z-P.y)})).sort((a,b)=>a.d-b.d).slice(0,4);
    ds.forEach((o,i)=>{const l=lightPool[i];l.userData.tgt=o.r;l.position.set(o.r.x,o.r.y,o.r.z);l.color.setHex(o.r.col)});
  }
  for(const l of lightPool){
    const r=l.userData.tgt;if(!r){l.intensity=0;continue}
    let k=1;
    if(r.fl){const n=Math.sin(P.t*23+r.ph)*Math.sin(P.t*7.3+r.ph*2);k=n>.55?.05:n>.2?.5:1;if(r.inten===0)k=n>.85?1:0}
    l.intensity=r.inten*k;
  }
}

/* ---------------- ステージ生成 ---------------- */
const N=34;
let MAP,ROOMS,EXIT,FLOW=new Int16Array(N*N),SEEN=new Uint8Array(N*N);
const cell=(x,y)=>(x<0||y<0||x>=N||y>=N)?1:MAP[(y|0)*N+(x|0)];
function genLevel(stage){
  for(let tries=0;tries<50;tries++){
    MAP=new Uint8Array(N*N).fill(1);ROOMS=[];
    const want=7+Math.min(4,stage>>1);
    for(let t=0;t<300&&ROOMS.length<want;t++){
      const w=4+ri(5),h=4+ri(5),x=1+ri(N-w-2),y=1+ri(N-h-2);
      if(ROOMS.some(r=>x<r.x+r.w+2&&x+w+2>r.x&&y<r.y+r.h+2&&y+h+2>r.y))continue;
      ROOMS.push({x,y,w,h,cx:x+(w>>1),cy:y+(h>>1)});
      for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)MAP[j*N+i]=0;
    }
    if(ROOMS.length<5)continue;
    ROOMS.sort((a,b)=>a.cx-b.cx);
    const link=(a,b)=>{let x=a.cx,y=a.cy;while(x!==b.cx){MAP[y*N+x]=0;x+=Math.sign(b.cx-x)}while(y!==b.cy){MAP[y*N+x]=0;y+=Math.sign(b.cy-y)}MAP[y*N+x]=0};
    for(let i=0;i<ROOMS.length-1;i++){link(ROOMS[i],ROOMS[i+1]);if(i+2<ROOMS.length&&rnd0()<.35)link(ROOMS[i],ROOMS[i+2])}
    const start=ROOMS[ri(ROOMS.length)];
    const dist=(a,b)=>Math.hypot(a.cx-b.cx,a.cy-b.cy);
    const others=ROOMS.filter(r=>r!==start).sort((a,b)=>dist(b,start)-dist(a,start));
    const exit=others[0];
    const keyRoom=others[1+ri(others.length-1)];
    // 出口扉
    let door=null;
    for(let i=exit.x;i<exit.x+exit.w&&!door;i++){ if(MAP[(exit.y-1)*N+i]===1&&exit.y-1>0)door=[i,exit.y-1] }
    for(let i=exit.x;i<exit.x+exit.w&&!door;i++){ if(MAP[(exit.y+exit.h)*N+i]===1&&exit.y+exit.h<N-1)door=[i,exit.y+exit.h] }
    if(!door)continue;
    // 柱
    const saved=MAP.slice();
    for(const r of ROOMS){if(r.w>=6&&r.h>=6){MAP[(r.y+2)*N+r.x+2]=4;MAP[(r.y+r.h-3)*N+r.x+r.w-3]=4}}
    MAP[door[1]*N+door[0]]=9;EXIT=door;
    // 到達確認
    const fl=bfs(start.cx+.5,start.cy+.5);
    let ok=true;for(const r of ROOMS)if(fl[r.cy*N+r.cx]>=9999)ok=false;
    const dn=[[1,0],[-1,0],[0,1],[0,-1]].some(([a,b])=>{const x=door[0]+a,y=door[1]+b;return x>=0&&y>=0&&x<N&&y<N&&fl[y*N+x]<9999});
    if(!ok||!dn){MAP=saved;continue}
    // 壁テクスチャ割当
    for(let y=0;y<N;y++)for(let x=0;x<N;x++)if(MAP[y*N+x]===1){const h=((x>>2)*7+(y>>2)*13+(x>>2)*(y>>2))%3;MAP[y*N+x]=1+h}
    return {start,exit,keyRoom,seed:(Math.random()*1e6)|0,exitDoor:door};
  }
  throw new Error('gen failed');
}
function bfs(px,py,out){
  const f=out||new Int16Array(N*N);f.fill(9999);
  const q=[],sx=px|0,sy=py|0;if(cell(sx,sy)!==0&&!out&&cell(sx,sy)===1)return f;
  f[sy*N+sx]=0;q.push(sx,sy);
  for(let i=0;i<q.length;i+=2){
    const x=q[i],y=q[i+1],d=f[y*N+x]+1;
    for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx=x+a,ny=y+b;if(nx<0||ny<0||nx>=N||ny>=N)continue;
      if(MAP[ny*N+nx]!==0||f[ny*N+nx]<=d)continue;
      f[ny*N+nx]=d;q.push(nx,ny);
    }
  }
  return f;
}

/* ---------------- ゲーム状態 ---------------- */
let state='title';
const P={x:2,y:2,a:0,pitch:0,hp:100,maxHp:100,wid:'pistol',mag:{},cd:0,rl:0,rlNeed:0,herbs:0,key:false,
  bloom:0,recoil:0,walkT:0,hurt:0,turn:0,flash:0,hitm:0,gain:0,kills:0,stage:1,bossDead:false,t:0,hbT:0};
let ENEMIES=[],ITEMS=[],LV=null;
const keys={},mouse={l:0,r:0,rb:false,back:0};
/* ---------------- アイテム ---------------- */
const glowMat=c=>new THREE.SpriteMaterial({map:TX.glow,color:c,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:.8});
function makeItemMesh(it){
  const g=new THREE.Group(),k=it.kind;let col=0x88ff88;
  const met=(c,m,r)=>new THREE.MeshStandardMaterial({color:c,metalness:m??.5,roughness:r??.5});
  if(k==='herb'){
    const lm=new THREE.MeshStandardMaterial({color:0x1e8a2c,roughness:.6,emissive:0x0a3a10,side:THREE.DoubleSide});
    for(let i=0;i<5;i++){const l=mesh(new THREE.SphereGeometry(.06,10,8),lm,0,.08,0);l.scale.set(.5,.12,1.4);l.rotation.set(-.5,i*1.256,0);l.position.set(Math.sin(i*1.256)*.05,.07,Math.cos(i*1.256)*.05);g.add(l)}
    g.add(mesh(new THREE.SphereGeometry(.02,8,8),new THREE.MeshStandardMaterial({color:0xff2222,emissive:0x550000}),0,.1,0));
    col=0x40ff60;
  }else if(k==='money'){
    for(let i=0;i<4;i++){const b=mesh(new THREE.BoxGeometry(.16,.012,.08),new THREE.MeshStandardMaterial({color:0x4aa060,roughness:.7}),0,.01+i*.013,0);b.rotation.y=i*.25;g.add(b)}
    g.add(mesh(new THREE.BoxGeometry(.05,.02,.083),new THREE.MeshStandardMaterial({color:0xddd8a0}),0,.03,0));col=0x80ffa0;
  }else if(k==='key'){
    g.add(mesh(new THREE.BoxGeometry(.16,.012,.1),new THREE.MeshStandardMaterial({color:0xd8a010,metalness:.9,roughness:.25,emissive:0x604000}),0,.1,0));
    g.add(mesh(new THREE.BoxGeometry(.16,.014,.02),new THREE.MeshStandardMaterial({color:0x111111}),0,.1,.02));
    g.add(mesh(new THREE.BoxGeometry(.03,.014,.02),new THREE.MeshStandardMaterial({color:0xff2020,emissive:0xff0000,emissiveIntensity:2}),0,.1,-.03));col=0xffd040;
  }else{ // 弾薬
    const c={ '9mm':0x8a8a30,shell:0xa02828,mag:0x30303c}[k];col={ '9mm':0xffe070,shell:0xff6060,mag:0x90a0ff}[k];
    g.add(mesh(new THREE.BoxGeometry(.16,.08,.1),met(c,.2,.7),0,.05,0));
    const bm=met(0xc8a040,.9,.3);
    for(let i=0;i<4;i++){const b=mesh(new THREE.CylinderGeometry(k==='shell'?.014:.008,k==='shell'?.014:.008,k==='shell'?.06:.05,8),k==='shell'?met(0xd02020,.1,.6):bm,-.05+i*.034,.11,0);b.rotation.z=Math.PI/2*0;g.add(b)}
  }
  const gl=new THREE.Sprite(glowMat(col));gl.scale.set(.55,.55,1);gl.position.y=.12;g.add(gl);
  g.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true}});
  g.position.set(it.x,.06,it.y);g.userData.gl=gl;
  itemGroup.add(g);it.mesh=g;
}
function addItem(x,y,kind,amt){const it={x,y,kind,amt};ITEMS.push(it);if(itemGroup)makeItemMesh(it);return it}
function removeItem(it){if(it.mesh){itemGroup.remove(it.mesh);it.mesh.traverse(o=>{if(o.geometry)o.geometry.dispose()})}}

/* ---------------- ビューモデル（銃） ---------------- */
const VM=new THREE.Group();
const gunScene=new THREE.Scene(),gunCam=new THREE.PerspectiveCamera(58,16/9,.01,5);
gunScene.add(VM,gunCam);
gunScene.add(new THREE.HemisphereLight(0xb8c0d8,0x2a2018,.55));
const gunSun=new THREE.DirectionalLight(0xffe6c8,1.9);gunSun.position.set(-.6,1,.8);gunScene.add(gunSun);
const gunFlash=new THREE.PointLight(0xffa040,0,2,2);gunScene.add(gunFlash);
const gunModels={};
let muzzleSprite;
function buildGuns(){
  const env=(()=>{const pm=new THREE.PMREMGenerator(renderer);const t=pm.fromScene(new RoomEnvironment(),.04).texture;pm.dispose();return t})();
  const metal=(c,r)=>new THREE.MeshStandardMaterial({color:c,metalness:.85,roughness:r??.4,envMap:env,envMapIntensity:.45});
  const poly=new THREE.MeshStandardMaterial({color:0x18181a,roughness:.55,metalness:.2,envMap:env,envMapIntensity:.5});
  const wood=new THREE.MeshStandardMaterial({color:0x6a3e1c,roughness:.5,metalness:0,envMap:env,envMapIntensity:.3});
  const skin=new THREE.MeshStandardMaterial({color:0xc89478,roughness:.7});
  const sleeve=new THREE.MeshStandardMaterial({color:0x2a3040,roughness:.9});
  const B=(w,h,d,m,x,y,z)=>{const q=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);q.position.set(x,y,z);return q};
  const Cy=(r,l,m,x,y,z,ax)=>{const q=new THREE.Mesh(new THREE.CylinderGeometry(r,r,l,16),m);q.rotation.x=Math.PI/2;q.position.set(x,y,z);return q};
  const hand=(x,y,z,rx)=>{const g=new THREE.Group();g.add(B(.045,.05,.09,skin,0,0,0));const a=B(.06,.06,.4,sleeve,0,-.02,.24);a.rotation.x=.25;g.add(a);g.position.set(x,y,z);g.rotation.x=rx||0;return g};
  const mk=(id,fn)=>{const g=new THREE.Group();const muz=new THREE.Object3D();g.add(muz);fn(g,muz);g.traverse(o=>{if(o.isMesh)o.castShadow=false});g.userData.muz=muz;g.visible=false;VM.add(g);gunModels[id]=g};
  // ハンドガン
  mk('pistol',(g,m)=>{
    g.add(B(.034,.042,.2,metal(0x2a2c30),0,0,-.1));           // スライド
    g.add(B(.03,.02,.19,metal(0x111214,.5),0,-.032,-.09));     // フレーム
    g.add(B(.03,.085,.045,poly,0,-.075,-.02)).rotation.x=.18;  // グリップ
    g.add(Cy(.008,.05,metal(0x000000),0,.004,-.225));          // バレル先端
    g.add(B(.006,.01,.008,metal(0x888888),0,.026,-.2));g.add(B(.014,.01,.008,metal(0x888888),0,.026,-.02));
    g.add(hand(.005,-.1,.03,.0));
    g.position.set(.13,-.15,-.32);m.position.set(0,.004,-.255);
  });
  mk('shotgun',(g,m)=>{
    g.add(Cy(.016,.55,metal(0x1c1d20),0,.01,-.3));g.add(Cy(.014,.42,metal(0x2a2b2e),0,-.028,-.24));
    g.add(B(.05,.06,.18,metal(0x25262a),0,-.005,-.02));
    g.add(B(.042,.038,.16,wood,0,-.035,-.29));
    g.add(B(.04,.1,.2,wood,0,-.05,.13)).rotation.x=-.25;
    g.add(B(.01,.014,.01,metal(0xcccccc),0,.03,-.55));
    const lh=hand(-.02,-.06,-.28,.0);g.add(lh);g.add(hand(.03,-.1,.02,.1));
    g.position.set(.12,-.16,-.25);m.position.set(0,.01,-.58);
  });
  mk('smg',(g,m)=>{
    g.add(B(.05,.06,.26,metal(0x24252a),0,0,-.1));
    g.add(Cy(.012,.16,metal(0x111111),0,.005,-.31));g.add(Cy(.018,.11,metal(0x1b1b1e),0,.005,-.28));
    g.add(B(.03,.16,.045,metal(0x18181a,.5),0,-.11,-.09));
    g.add(B(.036,.075,.05,poly,0,-.07,.03)).rotation.x=.25;
    g.add(B(.03,.05,.14,metal(0x2a2a2e),0,-.01,.2));
    g.add(B(.012,.02,.05,metal(0x1a1a1a),0,.04,-.02));
    g.add(hand(0.0,-.1,-.06,0));const lh=hand(-.005,-.04,-.24,.0);g.add(lh);
    g.position.set(.12,-.14,-.25);m.position.set(0,.005,-.4);
  });
  mk('magnum',(g,m)=>{
    g.add(B(.036,.05,.16,metal(0x8a8c92,.22),0,.005,-.04));
    g.add(Cy(.03,.075,metal(0x9a9ca2,.25),0,.004,-.14));
    g.add(Cy(.014,.24,metal(0x8a8c92,.22),0,.012,-.29));g.add(B(.008,.014,.22,metal(0x777777),0,.032,-.29));
    g.add(B(.036,.1,.055,wood,0,-.075,.0)).rotation.x=.3;
    g.add(B(.008,.014,.01,metal(0x111111),0,.04,-.4));
    g.add(hand(.005,-.1,.04,0));
    g.position.set(.13,-.15,-.3);m.position.set(0,.012,-.42);
  });
  muzzleSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:TX.glow,color:0xffc060,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,depthTest:false}));
  muzzleSprite.scale.set(.35,.35,1);muzzleSprite.visible=false;muzzleSprite.renderOrder=10;
}
let curGun=null;
function showGun(id){
  for(const k in gunModels)gunModels[k].visible=(k===id);
  curGun=gunModels[id];
  if(muzzleSprite.parent)muzzleSprite.parent.remove(muzzleSprite);
  curGun.userData.muz.add(muzzleSprite);
}
let vmKick=0;

/* ---------------- パーティクル ---------------- */
const PART=[];
const partMats=[];
function initParticles(){
  for(let i=0;i<220;i++){
    const m=new THREE.SpriteMaterial({map:TX.dot,transparent:true,depthWrite:false});
    const s=new THREE.Sprite(m);s.visible=false;scene.add(s);
    PART.push({s,life:0,vx:0,vy:0,vz:0,g:0,size:.05,grow:0,add:false,max:1});
  }
}
let partI=0;
function emit(x,y,z,vx,vy,vz,life,size,color,g,opt){
  const p=PART[partI++%PART.length];opt=opt||{};
  p.s.position.set(x,y,z);p.vx=vx;p.vy=vy;p.vz=vz;p.life=p.max=life;p.g=g;p.size=size;p.grow=opt.grow||0;
  p.s.material.color.setHex(color);p.s.material.blending=opt.add?THREE.AdditiveBlending:THREE.NormalBlending;
  p.s.material.opacity=1;p.s.material.needsUpdate=true;p.s.visible=true;p.s.scale.set(size,size,1);
}
function updateParticles(dt){
  for(const p of PART){
    if(p.life<=0)continue;p.life-=dt;
    if(p.life<=0){p.s.visible=false;continue}
    p.vy-=p.g*dt;p.s.position.x+=p.vx*dt;p.s.position.y+=p.vy*dt;p.s.position.z+=p.vz*dt;
    if(p.s.position.y<.01&&p.g>0){p.s.position.y=.01;p.vx*=.3;p.vz*=.3;p.vy=0}
    const k=p.life/p.max,s=p.size*(1+p.grow*(1-k));p.s.scale.set(s,s,1);p.s.material.opacity=Math.min(1,k*1.6);
  }
}
const bloodBurst=(x,y,z,n,big)=>{for(let i=0;i<n;i++)emit(x,y,z,(rnd0()-.5)*1.8,rnd0()*1.6,(rnd0()-.5)*1.8,.5+rnd0()*.6,.015+rnd0()*(big?.03:.02),0x5a0000,5)};
const sparkBurst=(x,y,z,nx,nz)=>{
  for(let i=0;i<7;i++)emit(x,y,z,nx*1.5+(rnd0()-.5)*1.5,rnd0()*1.5,nz*1.5+(rnd0()-.5)*1.5,.2+rnd0()*.2,.012,0x9a6a28,6,{add:true});
  for(let i=0;i<4;i++)emit(x,y,z,nx*.3+(rnd0()-.5)*.3,.15+rnd0()*.2,nz*.3+(rnd0()-.5)*.3,.7,.04,0x3a3733,-.05,{grow:1.8});
};
// 弾痕
const HOLES=[];let holeI=0;
function initHoles(){
  const m=new THREE.MeshBasicMaterial({map:TX.hole,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4});
  const geo=new THREE.PlaneGeometry(.12,.12);
  for(let i=0;i<40;i++){const h=new THREE.Mesh(geo,m);h.visible=false;scene.add(h);HOLES.push(h)}
}
function addHole(x,y,z,nx,ny,nz){
  const h=HOLES[holeI++%HOLES.length];h.position.set(x+nx*.003,y+ny*.003,z+nz*.003);h.lookAt(x+nx,y+ny,z+nz);h.rotateZ(rnd0()*6);h.visible=true;
}

/* ---------------- ポストプロセス ---------------- */
let composer,bloomPass,finalPass;
const FinalShader={
  uniforms:{tDiffuse:{value:null},time:{value:0},hurt:{value:0},low:{value:0},aspect:{value:1.78}},
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader:`uniform sampler2D tDiffuse;uniform float time,hurt,low,aspect;varying vec2 vUv;
  float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
  void main(){
    vec2 c=vUv-.5;float r=dot(c,c);
    float ca=.0008+r*.010+hurt*.008;
    vec3 col=vec3(texture2D(tDiffuse,vUv+c*ca*3.).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-c*ca*3.).b);
    float l=dot(col,vec3(.299,.587,.114));
    col=mix(col,vec3(l),low*.55);
    col*=mix(vec3(.93,1.0,1.06),vec3(1.06,1.0,.94),smoothstep(.1,.7,l));
    col=(col-.5)*1.08+.5;
    col=mix(col,col*vec3(1.7,.35,.3),hurt*.55);
    col*=1.-smoothstep(.12,.62,r*1.5)*.72;
    col+=(h(vUv*vec2(aspect,1.)*900.+fract(time)*37.)-.5)*.075;
    gl_FragColor=vec4(max(col,0.),1.);
  }`
};
function initPost(){
  const size=renderer.getSize(new THREE.Vector2());
  const rt=new THREE.WebGLRenderTarget(size.x,size.y,{type:THREE.HalfFloatType,samples:4});
  composer=new EffectComposer(renderer,rt);
  composer.addPass(new RenderPass(scene,camera));
  const gp=new RenderPass(gunScene,gunCam);gp.clear=false;gp.clearDepth=true;composer.addPass(gp);
  bloomPass=new UnrealBloomPass(new THREE.Vector2(size.x,size.y),.4,.6,.9);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  finalPass=new ShaderPass(FinalShader);composer.addPass(finalPass);
}
function applyQuality(){
  const q=SET.q??2;
  renderer.setPixelRatio(q===0?.75:q===1?1:Math.min(window.devicePixelRatio||1,1.5));
  flashlight.castShadow=q>0;
  renderer.shadowMap.enabled=q>0;
  bloomPass.enabled=q>0;
  resize();
}
function resize(){
  const w=stageEl.clientWidth||innerWidth,h=stageEl.clientHeight||innerHeight;
  renderer.setSize(w,h,false);cv.style.width='100%';cv.style.height='100%';
  camera.aspect=gunCam.aspect=w/h;camera.updateProjectionMatrix();gunCam.updateProjectionMatrix();
  if(composer){composer.setSize(w,h);finalPass.uniforms.aspect.value=w/h}
}
window.addEventListener('resize',resize);

/* ---------------- レンダリング ---------------- */
function syncCamera(dt){
  const bob=P.moving?Math.sin(P.walkT*2.9)*.014:Math.sin(P.t*1.3)*.003;
  const sway=P.moving?Math.cos(P.walkT*1.45)*.008:0;
  camera.position.set(P.x,EY+bob,P.y);
  const shake=P.recoil*.008;
  camera.rotation.y=-P.a-Math.PI/2+sway*.5;
  camera.rotation.x=P.pitch/95*.8+P.recoil*.025+(rnd0()-.5)*shake;
  camera.rotation.z=sway;
  camera.updateMatrixWorld(true);
}
function render(dt){
  if(!composer)return;
  syncCamera(dt);
  updateRoomLights(dt);
  // 懐中電灯の揺れ・ちらつき
  flashlight.intensity=15*(1+(Math.sin(P.t*47)*Math.sin(P.t*13)>.93?-.35:0));
  flashlight.position.x=.12+Math.sin(P.t*1.7)*.01;
  muzzleLight.intensity=P.flash>0?45:0;
  if(curGun){curGun.userData.muz.getWorldPosition(gunFlash.position);gunFlash.intensity=P.flash>0?4:0}
  // 敵・アイテム
  for(const e of ENEMIES){
    if(!e.mesh)continue;
    const d=Math.hypot(e.x-P.x,e.y-P.y);
    e.mesh.visible=d<22;if(e.mesh.visible)animEnemy(e,dt);
  }
  for(const it of ITEMS){if(!it.mesh)continue;
    it.mesh.rotation.y=P.t*1.4+it.x;it.mesh.position.y=.06+Math.sin(P.t*2.4+it.x*3)*.02;
    it.mesh.userData.gl.material.opacity=.55+Math.sin(P.t*4+it.y)*.25}
  if(LV&&LV.decals)for(const d of LV.decals){if(d.t<1){d.t=Math.min(1,d.t+dt*1.6);d.m.scale.setScalar(d.size*(1-Math.pow(1-d.t,3)))}}
  if(LV&&LV.doorGlow)LV.doorGlow.material.opacity=.5+Math.sin(P.t*3)*.3;
  // ビューモデル
  const bobx=P.moving?Math.sin(P.walkT*1.45)*.008:Math.sin(P.t*1.2)*.0015,boby=P.moving?Math.abs(Math.cos(P.walkT*1.45))*.008:Math.sin(P.t*1.6)*.0015;
  const rl=P.rl>0?Math.sin((1-P.rl/P.rlNeed)*Math.PI):0;
  VM.position.set(bobx,boby-rl*.13,P.recoil*.05);
  VM.rotation.set(P.recoil*.18+rl*.6,0,rl*.35);
  if(curGun){
    muzzleSprite.visible=P.flash>0;
    muzzleSprite.material.rotation=rnd0()*6;
    const s=.25+rnd0()*.2;muzzleSprite.scale.set(s,s,1);
  }
  updateParticles(dt);
  finalPass.uniforms.time.value=performance.now()/1000;
  finalPass.uniforms.hurt.value=Math.min(1,P.hurt);
  finalPass.uniforms.low.value=clamp(1-P.hp/(P.maxHp*.5),0,1)*(.7+.3*Math.sin(P.t*6));
  composer.render();
}
function initGfx(){
  buildTextures();buildMaterials();initLights();buildGuns();initParticles();initHoles();initPost();applyQuality();
  showGun('pistol');
}


let msgT=0;
function msg(t,sec){$('msg').textContent=t;$('msg').style.opacity=1;msgT=sec||3}

function startMission(stage){
  LV=genLevel(stage);P.stage=stage;buildWorld();
  const s=LV.start;
  P.x=s.cx+.5;P.y=s.cy+.5;P.a=rnd0()*6.28;P.pitch=0;
  P.maxHp=maxHp();P.hp=P.maxHp;P.herbs=S.herbs;P.key=false;P.stage=stage;P.gain=0;P.kills=0;P.bossDead=false;P.t=0;
  P.rl=0;P.cd=.5;P.turn=0;P.hurt=0;
  // マガジン装填（予備弾から）
  P.mag={};const res={...S.res};
  for(const id of WORDER){if(!S.own[id])continue;const w=WEAPONS[id],n=Math.min(wCap(id),res[w.ammo]);P.mag[id]=n;res[w.ammo]-=n}
  S.res=res;
  P.wid=S.own[S.eq]?S.eq:'pistol';showGun(P.wid);
  SEEN.fill(0);
  ENEMIES=[];ITEMS=[];
  const boss=stage%5===0;
  // 敵配置
  const cells=[];
  for(const r of ROOMS)for(let j=r.y;j<r.y+r.h;j++)for(let i=r.x;i<r.x+r.w;i++)if(MAP[j*N+i]===0&&Math.hypot(i-s.cx,j-s.cy)>7)cells.push([i,j]);
  const cnt=Math.min(30,(boss?5:7)+stage*2);
  const hpMul=1+.12*(stage-1);
  for(let i=0;i<cnt&&cells.length;i++){
    const [cx,cy]=cells.splice(ri(cells.length),1)[0];
    let t='zombie';const r=rnd0();
    if(stage>=2&&r<Math.min(.35,(stage-1)*.1))t='dog';
    else if(stage>=3&&r>1-Math.min(.2,(stage-2)*.06))t='brute';
    addEnemy(t,cx+.5,cy+.5,hpMul);
  }
  if(boss)addEnemy('boss',LV.exit.cx+.5,LV.exit.cy+.5,1+.15*(stage/5-1));
  // アイテム配置
  const free=[];
  for(const r of ROOMS)for(let j=r.y;j<r.y+r.h;j++)for(let i=r.x;i<r.x+r.w;i++)if(MAP[j*N+i]===0)free.push([i,j]);
  const put=(kind,amt,room)=>{
    let c;if(room){const l=free.filter(([i,j])=>i>=room.x&&i<room.x+room.w&&j>=room.y&&j<room.y+room.h);c=l[ri(l.length)]}else c=free[ri(free.length)];
    addItem(c[0]+.3+rnd0()*.4,c[1]+.3+rnd0()*.4,kind,amt);
  };
  if(!boss)put('key',1,LV.keyRoom);
  const ammoKinds=[...new Set(WORDER.filter(id=>S.own[id]).map(id=>WEAPONS[id].ammo))];
  const ni=6+stage+S.up.luck*2;
  for(let i=0;i<ni;i++){
    const r=rnd0();
    if(r<.35){const k=ammoKinds[ri(ammoKinds.length)];put(k,Math.ceil(AMMO[k].n*(.3+rnd0()*.5)))}
    else if(r<.55)put('herb',1);
    else put('money',Math.round((40+rnd0()*90)*(1+stage*.2)));
  }
  state='ready';showReady();
}
function addEnemy(t,x,y,mul){
  const d=ETYPE[t];
  const e={t,x,y,hp:d.hp*mul,maxhp:d.hp*mul,state:'idle',cd:.5,anim:rnd0()*5,flash:0,stun:0,atk:0,dead:false,deadT:0,gT:2+rnd0()*4,dmgMul:1+.05*(P.stage-1)};
  ENEMIES.push(e);makeEnemyMesh(e);
}

/* ---------------- 入力 ---------------- */
document.addEventListener('keydown',e=>{
  keys[e.code]=true;
  if(e.code==='Escape'&&noLock&&state==='play'){mouse.l=mouse.r=0;state='pause';showPause()}
  if(state==='play'){
    if(e.code==='KeyR')reload();
    else if(e.code==='KeyE')useHerb();
    else if(e.code==='Space'){if(!P.turn)P.turn=Math.PI;e.preventDefault()}
    else if(e.code==='Tab'){showMini=!showMini;e.preventDefault()}
    else if(e.code>='Digit1'&&e.code<='Digit4'){const id=WORDER[+e.code.slice(5)-1];if(S.own[id])equip(id)}
  }
});
document.addEventListener('keyup',e=>{keys[e.code]=false});
let showMini=true;
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('mousedown',e=>{
  if(state!=='play')return;
  if(document.pointerLockElement!==cv&&!noLock){lockPointer();return}
  if(e.button===0){mouse.l=1;fire(true)}
  else if(e.button===2){mouse.r=1;mouse.rb=e.ctrlKey||e.altKey||e.shiftKey}
  else if(e.button===3){mouse.back=1;e.preventDefault()}
  else if(e.button===4){mouse.r=1;mouse.rb=false;e.preventDefault()}
  else if(e.button===1){reload();e.preventDefault()}
});
document.addEventListener('mouseup',e=>{if(e.button===0)mouse.l=0;if(e.button===2||e.button===4)mouse.r=0;if(e.button===3){mouse.back=0;e.preventDefault()}});
let noLock=false,mpos={x:.5,y:.5};
document.addEventListener('mousemove',e=>{
  if(noLock){const b=cv.getBoundingClientRect();mpos.x=clamp((e.clientX-b.left)/b.width,0,1);mpos.y=clamp((e.clientY-b.top)/b.height,0,1);return}
  if(state!=='play'||document.pointerLockElement!==cv)return;
  P.a+=e.movementX*.0022*SET.sens;
  P.pitch=clamp(P.pitch-e.movementY*.32*SET.sens*(SET.inv?-1:1),-95,95);
});
document.addEventListener('wheel',e=>{
  if(state!=='play')return;
  const own=WORDER.filter(id=>S.own[id]);if(own.length<2)return;
  const i=own.indexOf(P.wid),d=e.deltaY>0?1:-1;
  equip(own[(i+d+own.length)%own.length]);
},{passive:true});
function lockPointer(){try{const r=cv.requestPointerLock();if(r&&r.catch)r.catch(()=>{})}catch(e){}}
document.addEventListener('pointerlockchange',()=>{
  if(document.pointerLockElement===cv){noLock=false;if(state==='pause'||state==='ready'){state='play';hideScreen()}}
  else if(state==='play'){mouse.l=mouse.r=0;state='pause';showPause()}
});
window.addEventListener('blur',()=>{mouse.l=mouse.r=0});

/* ---------------- 武器 ---------------- */
function equip(id){if(P.wid===id||!S.own[id])return;P.wid=id;S.eq=id;P.rl=0;P.cd=.3;P.recoil=.6;showGun(id);snd('click')}
function reserve(id){return S.res[WEAPONS[id].ammo]}
function reload(){
  const id=P.wid,w=WEAPONS[id];
  if(P.rl>0||P.mag[id]>=wCap(id)||reserve(id)<=0)return;
  P.rlNeed=w.reload*(1-.1*S.up.rl);P.rl=P.rlNeed;snd('reload');
}
function fire(first){
  const id=P.wid,w=WEAPONS[id];
  if(P.cd>0||P.rl>0)return;
  if(P.mag[id]<=0){if(first){snd('click');reload()}return}
  P.mag[id]--;P.cd=w.rate;P.recoil=1;P.flash=.06;P.bloom=Math.min(1,P.bloom+(w.pellets>1?.5:.25));
  snd(id);
  const moving=P.moving?1.6:1,sp=w.spread*moving*(1+P.bloom*.8)*W;
  const dmg=wDmg(id);
  camera.updateMatrixWorld(true);
  let hitAny=false;
  for(let p=0;p<w.pellets;p++){
    const jx=(rnd0()*2-1)*sp,jy=(rnd0()*2-1)*sp*.8;
    if(shoot(jx/(W/2),-jy/(H/2),dmg,w.pellets>1))hitAny=true;
  }
  if(hitAny){P.hitm=.15}
  // 銃声で敵が気づく
  for(const e of ENEMIES)if(!e.dead&&e.state==='idle'&&Math.hypot(e.x-P.x,e.y-P.y)<(id==='smg'?9:13))e.state='chase';
  if(P.mag[id]<=0&&reserve(id)>0)setTimeout(()=>{if(state==='play')reload()},250);
}
const _v=new THREE.Vector3();
function wallRay(ox,oz,dx,dz){
  if(dx===0)dx=1e-9;if(dz===0)dz=1e-9;
  let mx=Math.floor(ox),mz=Math.floor(oz);
  const ddx=Math.abs(1/dx),ddz=Math.abs(1/dz);let sx,sz,sdx,sdz;
  if(dx<0){sx=-1;sdx=(ox-mx)*ddx}else{sx=1;sdx=(mx+1-ox)*ddx}
  if(dz<0){sz=-1;sdz=(oz-mz)*ddz}else{sz=1;sdz=(mz+1-oz)*ddz}
  for(let k=0;k<90;k++){
    let t,side;
    if(sdx<sdz){t=sdx;sdx+=ddx;mx+=sx;side=0}else{t=sdz;sdz+=ddz;mz+=sz;side=1}
    const c=cell(mx,mz);if(c!==0&&c!==5)return {t,nx:side===0?-sx:0,nz:side===1?-sz:0};
  }
  return {t:99,nx:0,nz:0};
}
function shoot(nx,ny,dmg,pel){
  _v.set(nx,ny,.5).unproject(camera).sub(camera.position).normalize();
  const ox=camera.position.x,oy=camera.position.y,oz=camera.position.z,dx=_v.x,dy=_v.y,dz=_v.z;
  const tw=wallRay(ox,oz,dx,dz);
  let tImp=Math.min(tw.t,60),kind='wall';
  if(dy<-1e-4){const tf=oy/-dy;if(tf<tImp){tImp=tf;kind='floor'}}
  else if(dy>1e-4){const tc=(WH-oy)/dy;if(tc<tImp){tImp=tc;kind='ceil'}}
  let best=null,bt=tImp,head=false;
  const a=dx*dx+dz*dz;
  if(a>1e-8)for(const e of ENEMIES){
    if(e.dead)continue;
    const d=ETYPE[e.t],rx=ox-e.x,rz=oz-e.y,b=rx*dx+rz*dz,c=rx*rx+rz*rz-d.r*d.r,disc=b*b-a*c;
    if(disc<0)continue;
    const t=(-b-Math.sqrt(disc))/a;if(t<0||t>=bt)continue;
    const y=oy+dy*t;if(y<0||y>d.h)continue;
    best=e;bt=t;head=y>d.h*(e.t==='dog'?.7:.8);
  }
  const px=ox+dx*bt,py=oy+dy*bt,pz=oz+dz*bt;
  if(best){
    let dm=dmg*(pel?Math.max(.35,Math.min(1,4.5/bt)):1);
    if(head)dm*=2.5;
    hurtEnemy(best,dm,head,px,py,pz);return true;
  }
  if(kind==='wall'){sparkBurst(px,py,pz,tw.nx,tw.nz);addHole(px,py,pz,tw.nx,0,tw.nz)}
  else if(kind==='floor'){sparkBurst(px,.02,pz,0,0)}
  return false;
}
function hurtEnemy(e,dm,head,px,py,pz){
  const d=ETYPE[e.t];
  e.hp-=dm;e.flash=.1;e.state='chase';
  if(e.t!=='boss')e.stun=head?.5:.22;
  snd('hit');
  if(px!==undefined)bloodBurst(px,py,pz,head?14:8,head);
  if(e.hp<=0){
    addDecal(e.x,e.y,.9+rnd0()*.4,false);
    e.dead=true;e.deadT=0;P.kills++;S.kills++;
    const luck=1+.15*S.up.luck,m=Math.round(d.money*(1+.1*(P.stage-1))*luck);
    S.money+=m;P.gain+=m;addXp(d.xp+P.stage);
    snd('die');
    if(e.t==='boss'){P.bossDead=true;msg('ボスを倒した！\n出口の扉が開く',4);snd('boom')}
    if(rnd0()<.16+.05*S.up.luck){
      const r=rnd0(),own=WORDER.filter(id=>S.own[id]);
      if(r<.5&&own.length){const k=WEAPONS[own[ri(own.length)]].ammo;addItem(e.x,e.y,k,Math.ceil(AMMO[k].n*.4))}
      else addItem(e.x,e.y,'herb',1);
    }
  }
}
function addXp(n){
  S.xp+=n;
  while(S.xp>=xpNeed()){S.xp-=xpNeed();S.lv++;P.maxHp=maxHp();P.hp=Math.min(P.maxHp,P.hp+15);msg('LEVEL UP!  Lv.'+S.lv+'\n最大HP・攻撃力が上がった',3);snd('heal')}
}
function useHerb(){
  if(P.herbs<=0){msg('ハーブがない',1.5);return}
  if(P.hp>=P.maxHp){msg('体力は満タンだ',1.5);return}
  P.herbs--;P.hp=Math.min(P.maxHp,P.hp+40+10*S.up.heal);snd('heal');msg('ハーブを使った',1.5);
}

/* ---------------- 更新 ---------------- */
function blocked(x,y,r){return cell(x-r,y-r)!==0||cell(x+r,y-r)!==0||cell(x-r,y+r)!==0||cell(x+r,y+r)!==0}
function tryMove(o,dx,dy,r){
  if(!blocked(o.x+dx,o.y,r))o.x+=dx;
  if(!blocked(o.x,o.y+dy,r))o.y+=dy;
}
function los(ax,ay,bx,by){
  const d=Math.hypot(bx-ax,by-ay),n=Math.ceil(d/.2);
  for(let i=1;i<n;i++){const t=i/n;if(cell(ax+(bx-ax)*t,ay+(by-ay)*t)!==0)return false}
  return true;
}
let flowT=0,doorT=0;
function update(dt){
  P.t+=dt;
  // 視点・移動
  if(P.turn>0){const s=Math.min(P.turn,dt*13);P.a+=s;P.turn-=s}
  let fx=0,fy=0;
  const mBack=mouse.back||(mouse.r&&(mouse.rb||(noLock&&mpos.y>.8)));
  if(keys.KeyW||keys.ArrowUp||(mouse.r&&!mBack))fy+=1;
  if(keys.KeyS||keys.ArrowDown||mBack)fy-=1;
  if(keys.KeyD)fx+=1;if(keys.KeyA)fx-=1;
  if(keys.ArrowLeft)P.a-=dt*2.2;if(keys.ArrowRight)P.a+=dt*2.2;
  if(noLock){
    const dxm=mpos.x-.5,dym=mpos.y-.5;
    if(Math.abs(dxm)>.06)P.a+=(dxm-Math.sign(dxm)*.06)*5*dt*SET.sens;
    P.pitch=clamp(-dym*200*(SET.inv?-1:1),-95,95);
  }
  P.moving=!!(fx||fy);
  if(P.moving){
    const l=Math.hypot(fx,fy);fx/=l;fy/=l;
    const sp=2.5*(1+.06*S.up.spd)*(keys.ShiftLeft?1.45:1)*(fy<0?.8:1)*(P.rl>0?.85:1);
    const c=Math.cos(P.a),s=Math.sin(P.a);
    tryMove(P,(c*fy-s*fx)*sp*dt,(s*fy+c*fx)*sp*dt,.22);
    P.walkT+=dt*sp;
  }
  P.cd-=dt;P.bloom=Math.max(0,P.bloom-dt*1.5);P.recoil=Math.max(0,P.recoil-dt*6);P.flash-=dt;P.hitm-=dt;P.hurt=Math.max(0,P.hurt-dt*1.8);
  if(P.rl>0){P.rl-=dt;if(P.rl<=0){const id=P.wid,n=Math.min(wCap(id)-P.mag[id],reserve(id));P.mag[id]+=n;S.res[WEAPONS[id].ammo]-=n;P.rl=0}}
  if(mouse.l&&WEAPONS[P.wid].auto)fire(false);
  // 探索済みマップ
  for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++){const x=(P.x|0)+i,y=(P.y|0)+j;if(x>=0&&y>=0&&x<N&&y<N&&los(P.x,P.y,x+.5,y+.5))SEEN[y*N+x]=1}
  // 出口扉判定
  doorT-=dt;
  for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]])if(cell(P.x+a*.4,P.y+b*.4)===9&&doorT<=0){doorTouch();doorT=1.5}
  // 敵
  flowT-=dt;if(flowT<=0){bfs(P.x,P.y,FLOW);flowT=.3}
  let alive=0;
  for(const e of ENEMIES){updateEnemy(e,dt);if(!e.dead)alive++}
  P.alive=alive;
  // アイテム取得
  for(let i=ITEMS.length-1;i>=0;i--){
    const it=ITEMS[i];if(Math.hypot(it.x-P.x,it.y-P.y)>.6)continue;
    let ok=true;
    if(it.kind==='herb'){if(P.herbs>=9){ok=false}else{P.herbs++;msg('ハーブを拾った',2)}}
    else if(it.kind==='money'){S.money+=it.amt;P.gain+=it.amt;msg('¥'+it.amt+' 入手',2)}
    else if(it.kind==='key'){P.key=true;msg('カードキーを手に入れた！\n出口の扉へ向かえ',4)}
    else{S.res[it.kind]=Math.min(999,S.res[it.kind]+it.amt);msg(AMMO[it.kind].name+' x'+it.amt,2)}
    if(ok){removeItem(it);ITEMS.splice(i,1);snd('pick')}
  }
  // 低体力の鼓動
  if(P.hp<P.maxHp*.3){P.hbT-=dt;if(P.hbT<=0){tone(60,.25,.5,'sine',40);P.hbT=.9}}
  if(msgT>0){msgT-=dt;if(msgT<.6)$('msg').style.opacity=Math.max(0,msgT/.6)}
  if(P.hp<=0)gameOver();
}
function doorTouch(){
  const boss=P.stage%5===0;
  if(boss&&!P.bossDead)msg('扉はロックされている…\nボスを倒せ！',2.5);
  else if(!boss&&!P.key)msg('扉に鍵がかかっている\nカードキーを探せ',2.5);
  else clearMission();
}
function updateEnemy(e,dt){
  const d=ETYPE[e.t];
  if(e.dead){e.deadT+=dt;return}
  e.flash-=dt;e.atk-=dt;e.stun-=dt;
  const dx=P.x-e.x,dy=P.y-e.y,dist=Math.hypot(dx,dy);
  if(e.state==='idle'){
    if(dist<d.sight&&los(e.x,e.y,P.x,P.y)&&(e.t==='boss'||dist<d.sight*.9))e.state='chase';
    return;
  }
  e.anim+=dt*(e.t==='dog'?9:4);
  e.gT-=dt;if(e.gT<=0){e.gT=3+rnd0()*5;if(dist<14)snd(d.snd)}
  if(e.stun>0)return;
  if(dist<d.range){
    e.cd-=dt;
    if(e.cd<=0){
      e.cd=d.rate;e.atk=.35;
      const dm=d.dmg*e.dmgMul*(1-.06*S.up.armor);
      P.hp-=dm;P.hurt=1;snd('pain');
      if(e.t==='dog')P.a+=(rnd0()-.5)*.1;
    }
    return;
  }
  e.cd=Math.min(e.cd,.35);
  let tx=P.x,ty=P.y;
  if(!(dist<6&&los(e.x,e.y,P.x,P.y))){
    const cx=e.x|0,cy=e.y|0;let best=FLOW[cy*N+cx],bx=cx,by=cy;
    for(const [a,b] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=cx+a,ny=cy+b;if(nx<0||ny<0||nx>=N||ny>=N)continue;const f=FLOW[ny*N+nx];if(f<best){best=f;bx=nx;by=ny}}
    tx=bx+.5;ty=by+.5;
  }
  const vx=tx-e.x,vy=ty-e.y,l=Math.hypot(vx,vy)||1;
  const sp=d.spd*(1+.02*(P.stage-1));
  let mx=vx/l*sp*dt,my=vy/l*sp*dt;
  // 敵同士の押し合い
  for(const o of ENEMIES){if(o===e||o.dead)continue;const ox=e.x-o.x,oy=e.y-o.y,od=Math.hypot(ox,oy);if(od<.5&&od>.001){mx+=ox/od*dt*.8;my+=oy/od*dt*.8}}
  tryMove(e,mx,my,.2);
}

function drawMini(){
  const m=$('mini'),g=m.getContext('2d'),S2=120/N;
  g.clearRect(0,0,120,120);
  if(!showMini)return;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
    if(!SEEN[y*N+x])continue;const c=MAP[y*N+x];
    g.fillStyle=c===0?'#555':c===9?'#e33':'#222';g.fillRect(x*S2,y*S2,S2+.5,S2+.5);
  }
  for(const it of ITEMS)if(it.kind==='key'&&SEEN[(it.y|0)*N+(it.x|0)]){g.fillStyle='#fc0';g.fillRect(it.x*S2-1,it.y*S2-1,3,3)}
  g.fillStyle='#4f4';g.beginPath();g.arc(P.x*S2,P.y*S2,2.2,0,7);g.fill();
  g.strokeStyle='#4f4';g.beginPath();g.moveTo(P.x*S2,P.y*S2);g.lineTo(P.x*S2+Math.cos(P.a)*7,P.y*S2+Math.sin(P.a)*7);g.stroke();
}
const cache={};
function setT(id,v){if(cache[id]!==v){cache[id]=v;$(id).textContent=v}}
function updateHud(){
  const id=P.wid,w=WEAPONS[id],hp=Math.max(0,Math.ceil(P.hp)),r=P.hp/P.maxHp;
  setT('hHp',hp+' / '+P.maxHp);
  setT('hCond',r>.6?'FINE':r>.3?'CAUTION':'DANGER');
  const b=$('hBar');b.style.width=(r*100)+'%';b.style.background=r>.6?'#3c3':r>.3?'#ec3':'#e33';
  $('hCond').style.color=r>.6?'#5d5':r>.3?'#ec3':'#e44';
  setT('hHerb',P.herbs);setT('hMoney',S.money);
  setT('hWn',w.name+'  ['+(WORDER.indexOf(id)+1)+']');
  setT('hMag',P.mag[id]);setT('hRes',reserve(id));
  setT('hRl',P.rl>0?'RELOADING...':(P.mag[id]<=0&&reserve(id)<=0?'弾切れ！':''));
  setT('hStage','STAGE '+P.stage+(P.stage%5===0?'  ☠BOSS':''));
  setT('hEnemy','残り敵 '+(P.alive||0));
  setT('hKey',P.stage%5===0?(P.bossDead?'扉: OPEN':'ボスを倒せ'):(P.key?'🔑 カードキー所持':'🔑 カードキーを探せ'));
  const sp=(WEAPONS[id].spread*(P.moving?1.6:1)*(1+P.bloom*.8)*W/W*100*0.5);
  const gap=Math.max(3,sp*(cv.clientWidth/100)*.9);
  $('cl').style.left=(-gap-8)+'px';$('cr').style.left=gap+'px';$('cu').style.top=(-gap-8)+'px';$('cd').style.top=gap+'px';
  $('hitm').style.opacity=P.hitm>0?1:0;
  const bs=ENEMIES.find(e=>e.t==='boss'&&!e.dead&&e.state==='chase');
  const bb=$('bossbar');bb.style.display=bs?'block':'none';if(bs)$('bossfill').style.width=(Math.max(0,bs.hp/bs.maxhp)*100)+'%';
  drawMini();
}

/* ---------------- 画面（DOM） ---------------- */
const scr=$('screen');
function showScreen(html){scr.innerHTML=html;scr.style.display='block';$('hud').style.display='none';scr.scrollTop=0}
function hideScreen(){scr.style.display='none';if(state==='play')$('hud').style.display='block'}
function showReady(){
  cv.style.filter='none';
  scr.style.display='flex';scr.style.alignItems='center';scr.style.justifyContent='center';
  scr.innerHTML=`<div class="c"><h2 style="font-size:2em">STAGE ${P.stage}${P.stage%5===0?' ☠':''}</h2>
  <p style="color:#aaa;line-height:1.9">${P.stage%5===0?'この階のどこかにボスが潜んでいる。倒せば出口が開く。':'カードキーを見つけて出口の扉へ向かえ。'}</p>
  <p style="margin:1em 0"><button class="big" data-act="go">▶ クリックして開始</button></p>
  <p style="color:#777">Esc: 一時停止</p></div>`;
  $('hud').style.display='none';
}
function showPause(){
  scr.style.display='flex';scr.style.alignItems='center';scr.style.justifyContent='center';
  scr.innerHTML=`<div class="c"><h2 style="font-size:2em">PAUSE</h2>
  <p><button class="big" data-act="go">▶ 再開</button></p>
  <p style="margin-top:1em">感度 <input type="range" min="0.3" max="3" step="0.1" value="${SET.sens}" data-set="sens"> 音量 <input type="range" min="0" max="1" step="0.05" value="${SET.vol}" data-set="vol"></p>
  <p style="margin-top:1em"><button data-act="retreat">拠点へ撤退（獲得品は持ち帰る）</button></p></div>`;
}
const TABS=[['sortie','出撃'],['shop','ショップ'],['train','育成'],['save','セーブ/ロード'],['opt','設定/操作']];
let tab='sortie';
function showTitle(){
  state='title';
  scr.style.display='block';scr.style.alignItems='';scr.style.justifyContent='';$('hud').style.display='none';
  const slots=[1,2,3].map(n=>slotHtml(n,'title')).join('');
  scr.innerHTML=`<h1>DEAD MANSION</h1><p class="sub">マウスで戦え。撃て、拾え、買え、鍛えろ。</p>
  <div class="c"><button class="big" data-act="new">NEW GAME</button></div>
  <div style="max-width:40em;margin:1.2em auto"><h2>CONTINUE</h2>${slots}</div>
  <div class="help">${helpHtml()}</div>`;
}
function helpHtml(){return `<b>操作（マウス中心）</b><br>
  <kbd>マウス移動</kbd> 視点（上下も狙える。頭部は大ダメージ）<br>
  <kbd>左クリック</kbd> 発砲（長押しでSMGは連射）／ <kbd>右クリック長押し</kbd> 前進 ／ <kbd>Shift</kbd>+右クリック長押し or マウスの<kbd>戻るボタン</kbd> or <kbd>S</kbd> 後退<br>
  <kbd>ホイール</kbd> 武器切替 ／ <kbd>中クリック</kbd> or <kbd>R</kbd> リロード<br>
  補助: <kbd>WASD</kbd> 移動 <kbd>Shift</kbd> ダッシュ <kbd>Space</kbd> 180°ターン <kbd>E</kbd> ハーブ <kbd>1-4</kbd> 武器 <kbd>Tab</kbd> マップ <kbd>Esc</kbd> 一時停止<br>
  <b>目的</b>：館を探索してカードキーを入手し、出口の扉へ。5階ごとにボス。稼いだ金で拠点のショップ・育成を活用しよう。`}
function slotHtml(n,mode){
  const d=slotInfo(n);
  const info=d?`Lv.${d.lv} ／ ¥${d.money} ／ 最高到達 STAGE ${d.maxStage} ／ 撃破 ${d.kills}<br><small style="color:#888">${new Date(d.savedAt).toLocaleString('ja-JP')}</small>`:'<span style="color:#666">— 空き —</span>';
  let btn='';
  if(mode==='title')btn=d?`<button data-act="load:${n}">ロード</button>`:'';
  else btn=`<button data-act="save:${n}">セーブ</button><button data-act="load:${n}" ${d?'':'disabled'}>ロード</button><button data-act="del:${n}" ${d?'':'disabled'}>削除</button>`;
  return `<div class="slot"><b>SLOT ${n}</b><div class="i">${info}</div>${btn}</div>`;
}
function renderHub(){
  state='hub';
  scr.style.display='block';scr.style.alignItems='';scr.style.justifyContent='';$('hud').style.display='none';
  let body='';
  if(tab==='sortie'){
    let st='';for(let i=1;i<=S.maxStage&&i<=99;i++)st+=`<button class="${S.sel===i?'':''}" data-act="sel:${i}" style="${S.sel===i?'background:#7a1e1e;border-color:#e66':''}">${i}${i%5===0?'☠':''}</button>`;
    const own=WORDER.filter(id=>S.own[id]);
    body=`<h2>出撃ステージ選択</h2><div>${st}</div>
    <h2 style="margin-top:1em">装備</h2><div>${own.map(id=>`<button data-act="eq:${id}" style="${S.eq===id?'background:#7a1e1e;border-color:#e66':''}">${WEAPONS[id].name} (${wCap(id)}発) 予備:${S.res[WEAPONS[id].ammo]}</button>`).join('')}</div>
    <p style="margin:.8em 0;color:#aaa">ハーブ: ${S.herbs} ／ 最大HP: ${maxHp()}</p>
    <div class="c" style="margin-top:1.5em"><button class="big" data-act="sortie">▶ STAGE ${S.sel} へ出撃</button></div>`;
  }else if(tab==='shop'){
    body=`<h2>武器</h2><div class="grid">${WORDER.filter(id=>id!=='pistol').map(id=>{const w=WEAPONS[id];return `<div class="card"><div class="n">${w.name}</div><div class="d">威力${w.dmg}${w.pellets>1?'×'+w.pellets:''} ／ 連射${(1/w.rate).toFixed(1)}/秒 ／ 装弾${w.mag} ／ ${AMMO[w.ammo].name}</div>${S.own[id]?'<span class="lv">購入済み</span>':`<button data-act="buyw:${id}" ${S.money>=w.price?'':'disabled'}>¥${w.price} 購入</button>`}</div>`}).join('')}</div>
    <h2 style="margin-top:1em">弾薬</h2><div class="grid">${Object.keys(AMMO).map(k=>`<div class="card"><div class="n">${AMMO[k].name} ×${AMMO[k].n}</div><div class="d">所持: ${S.res[k]}</div><button data-act="buya:${k}" ${S.money>=AMMO[k].price&&S.res[k]<999?'':'disabled'}>¥${AMMO[k].price}</button></div>`).join('')}</div>
    <h2 style="margin-top:1em">回復</h2><div class="grid"><div class="card"><div class="n">🌿 ハーブ</div><div class="d">HPを回復 (所持 ${S.herbs}/9)</div><button data-act="buyh" ${S.money>=120&&S.herbs<9?'':'disabled'}>¥120</button></div></div>`;
  }else if(tab==='train'){
    body=`<h2>身体・スキル育成</h2><div class="grid">${Object.keys(BODY).map(k=>{const b=BODY[k],lv=S.up[k],c=upCost(b.base,lv);return `<div class="card"><div class="n">${b.name} <span class="lv">Lv.${lv}/${b.max}</span></div><div class="d">${b.d}</div>${lv>=b.max?'<span class="lv">MAX</span>':`<button data-act="upb:${k}" ${S.money>=c?'':'disabled'}>¥${c} 強化</button>`}</div>`}).join('')}</div>
    <h2 style="margin-top:1em">武器改造</h2><div class="grid">${WORDER.filter(id=>S.own[id]).map(id=>{const w=WEAPONS[id],u=S.wp[id];const cp=upCost(w.base,u.pow),cc=upCost(w.base*.8,u.cap);return `<div class="card"><div class="n">${w.name}</div>
      <div class="d">威力 <span class="lv">Lv.${u.pow}/5</span>（+18%/Lv） ／ 装弾 <span class="lv">Lv.${u.cap}/5</span>（+25%/Lv）</div>
      ${u.pow>=5?'<span class="lv">威力MAX</span>':`<button data-act="upw:${id}:pow" ${S.money>=cp?'':'disabled'}>威力 ¥${cp}</button>`}
      ${u.cap>=5?'<span class="lv">装弾MAX</span>':`<button data-act="upw:${id}:cap" ${S.money>=cc?'':'disabled'}>装弾 ¥${cc}</button>`}</div>`}).join('')}</div>
    <p style="margin-top:1em;color:#aaa">キャラクターLv.${S.lv}（XP ${S.xp}/${xpNeed()}）— 敵を倒すと成長し、最大HPと攻撃力が上がる。</p>`;
  }else if(tab==='save'){
    body=`<h2>タイプライター（セーブ / ロード）</h2><p style="color:#aaa;margin-bottom:.6em">拠点でのみセーブできる。出撃・帰還時はオートセーブ(SLOT 1以外のデータは変更されません)。</p>
    ${[1,2,3].map(n=>slotHtml(n,'hub')).join('')}
    <h2 style="margin-top:1em">データ引き継ぎコード</h2><textarea id="code" placeholder="ここにコードを貼り付けて「読込」"></textarea>
    <button data-act="export">現在のデータをコード化</button><button data-act="import">コードから読込</button>`;
  }else{
    body=`<h2>設定</h2><p>マウス感度 <input type="range" min="0.3" max="3" step="0.1" value="${SET.sens}" data-set="sens"> 音量 <input type="range" min="0" max="1" step="0.05" value="${SET.vol}" data-set="vol"> <label><input type="checkbox" data-set="inv" ${SET.inv?'checked':''}> 上下反転</label></p>
    <p style="margin-top:.6em">画質 <select data-set="q" style="font:inherit;background:#222;color:#eee"><option value="0" ${SET.q===0?'selected':''}>低（軽量）</option><option value="1" ${SET.q===1?'selected':''}>中</option><option value="2" ${SET.q===2?'selected':''}>高（影・ブルーム）</option></select></p>
    <h2 style="margin-top:1em">操作説明</h2><div class="help" style="margin:0">${helpHtml()}</div>
    <p style="margin-top:1em"><button data-act="title">タイトルへ</button></p>`;
  }
  scr.innerHTML=`<div class="top2"><b>SAFE ROOM</b><span>Lv.${S.lv}</span><span>XP ${S.xp}/${xpNeed()}</span><span>¥ ${S.money}</span><span>最高到達 ${S.maxStage}</span></div>
  <div class="tabs">${TABS.map(([k,n])=>`<button class="${tab===k?'on':''}" data-act="tab:${k}">${n}</button>`).join('')}</div>${body}`;
  const keep=scr.scrollTop;scr.scrollTop=keep;
}
function autosave(){saveTo(0)}
scr.addEventListener('input',e=>{
  const k=e.target.dataset&&e.target.dataset.set;if(!k)return;
  SET[k]=e.target.type==='checkbox'?e.target.checked:+e.target.value;saveSet();if(k==='q')applyQuality();
});
scr.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b||b.disabled)return;
  ac();act(b.dataset.act);
});
function act(a){
  const [c,x,y]=a.split(':');
  const keep=scr.scrollTop;
  switch(c){
    case 'new':S=defState();tab='sortie';renderHub();return;
    case 'load':if(loadFrom(+x)){snd('buy');tab='sortie';renderHub()}return;
    case 'title':showTitle();return;
    case 'home':tab='sortie';renderHub();return;
    case 'tab':tab=x;break;
    case 'sel':S.sel=+x;break;
    case 'eq':S.eq=x;break;
    case 'sortie':autosave();startMission(S.sel);return;
    case 'go':lockPointer();
      setTimeout(()=>{if((state==='ready'||state==='pause')&&document.pointerLockElement!==cv){noLock=true;state='play';hideScreen();msg('マウスをカーソル位置で操作モード:\n左右端で旋回・上下で視線 / 画面下部で右クリック=後退 (Esc:一時停止)',5)}},300);return;
    case 'retreat':endMission(false);return;
    case 'save':if(saveTo(+x))snd('buy');break;
    case 'del':if(confirm('SLOT '+x+' を削除しますか？')){localStorage.removeItem(SKEY+x)}break;
    case 'buyw':{const w=WEAPONS[x];if(S.money>=w.price&&!S.own[x]){S.money-=w.price;S.own[x]=true;S.eq=x;snd('buy')}break}
    case 'buya':{const a2=AMMO[x];if(S.money>=a2.price){S.money-=a2.price;S.res[x]=Math.min(999,S.res[x]+a2.n);snd('buy')}break}
    case 'buyh':if(S.money>=120&&S.herbs<9){S.money-=120;S.herbs++;snd('buy')}break;
    case 'upb':{const b=BODY[x],lv=S.up[x],cs=upCost(b.base,lv);if(lv<b.max&&S.money>=cs){S.money-=cs;S.up[x]++;snd('buy')}break}
    case 'upw':{const w=WEAPONS[x],u=S.wp[x],cs=y==='pow'?upCost(w.base,u.pow):upCost(w.base*.8,u.cap);if(u[y]<5&&S.money>=cs){S.money-=cs;u[y]++;snd('buy')}break}
    case 'export':{$('code').value=btoa(unescape(encodeURIComponent(JSON.stringify(S))));return}
    case 'import':{try{const j=JSON.parse(decodeURIComponent(escape(atob($('code').value.trim()))));S=merge(defState(),j);snd('buy')}catch(er){alert('コードが不正です')}break}
  }
  renderHub();scr.scrollTop=keep;
}

/* ---------------- ミッション終了 ---------------- */
function returnAmmo(){
  for(const id of WORDER){if(S.own[id]&&P.mag[id]>0){S.res[WEAPONS[id].ammo]+=P.mag[id];P.mag[id]=0}}
  S.herbs=P.herbs;
}
function endMission(){
  state='hub';returnAmmo();autosave();
  if(document.pointerLockElement)document.exitPointerLock();
  tab='sortie';renderHub();
}
function clearMission(){
  if(state!=='play')return;
  state='clear';snd('boom');
  if(document.pointerLockElement)document.exitPointerLock();
  const bonus=300+150*P.stage;S.money+=bonus;addXp(40+20*P.stage);
  S.maxStage=Math.max(S.maxStage,P.stage+1);S.sel=Math.min(99,P.stage+1);
  returnAmmo();autosave();
  scr.style.display='flex';scr.style.alignItems='center';scr.style.justifyContent='center';$('hud').style.display='none';
  scr.innerHTML=`<div class="c"><h1 style="margin:0">STAGE CLEAR</h1>
  <p style="line-height:2;color:#ccc;margin:1em 0">撃破数 ${P.kills}<br>戦利品 ¥${P.gain}<br>クリアボーナス ¥${bonus}<br>所持金 ¥${S.money} ／ Lv.${S.lv}</p>
  <button class="big" data-act="home">拠点へ戻る</button></div>`;
}
function gameOver(){
  if(state!=='play')return;
  state='dead';snd('die');
  if(document.pointerLockElement)document.exitPointerLock();
  const lost=Math.round(S.money*.2);S.money-=lost;returnAmmo();autosave();
  scr.style.display='flex';scr.style.alignItems='center';scr.style.justifyContent='center';$('hud').style.display='none';
  scr.innerHTML=`<div class="c"><h1 style="margin:0">YOU DIED</h1>
  <p style="line-height:2;color:#ccc;margin:1em 0">撃破数 ${P.kills}<br>逃走中に ¥${lost} を落とした…</p>
  <button class="big" data-act="home">拠点へ戻る</button></div>`;
}

/* ---------------- メインループ ---------------- */
let last=performance.now();
function loop(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  if(state==='play'){update(dt);}
  const show=state==='play'||state==='pause'||state==='ready'||state==='dead'||state==='clear';
  cv.style.visibility=show?'visible':'hidden';
  if(show){
    render(dt);
    if(state==='play')updateHud();
  }
  requestAnimationFrame(loop);
}
window.__G={P,get S(){return S},get state(){return state},set state(v){state=v},get ENEMIES(){return ENEMIES},get ITEMS(){return ITEMS},startMission,fire,update,render:()=>render(.016),act,get MAP(){return MAP},LVinfo:()=>LV,renderer,scene,camera};
const boot=$('screen');boot.style.display='flex';boot.style.alignItems='center';boot.style.justifyContent='center';
boot.innerHTML='<div class="c"><h1 style="margin:0">DEAD MANSION</h1><p class="sub">テクスチャを生成中…</p></div>';
setTimeout(()=>{initGfx();resize();showTitle();requestAnimationFrame(loop)},60);
