import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const BASE = `${import.meta.env.BASE_URL}assets/`;

/** 地面テクスチャのプール (d=ベースカラー, n=法線)。エリア定義の ground.* がここのキーを指す */
export const TEXFILES = {
  forest: { d: 'grass_diff.jpg', n: 'grass_nor.jpg' }, dry: { d: 'dirt_diff.jpg' }, rock: { d: 'rock_diff.jpg', n: 'rock_nor.jpg' }, sand: { d: 'sand_diff.jpg' },
  dust: { d: 'dust_d.jpg', n: 'dust_n.jpg' }, cobble: { d: 'cobble_d.jpg' }, boulder: { d: 'boulder_d.jpg', n: 'boulder_n.jpg' }, leafgravel: { d: 'leafgravel_d.jpg' },
  darkrock: { d: 'darkrock_d.jpg', n: 'darkrock_n.jpg' }, gravel: { d: 'gravel_d.jpg' },
  plate: { d: 'plate_d.jpg', n: 'plate_n.jpg' }, plate2: { d: 'plate2_d.jpg' }, grid: { d: 'grid_d.jpg', n: 'grid_n.jpg' }, tiles: { d: 'tiles_d.jpg' },
  marble: { d: 'marble_d.jpg', n: 'marble_n.jpg' }, sandbrick: { d: 'sandbrick_d.jpg', n: 'sandbrick_n.jpg' },
};
const flatNormal = (() => {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();

/**
 * 外部アセットの読み込み。1つ失敗しても残りは使えるよう個別に try/catch し、
 * 失敗したものは null (= 各システムが手続き生成にフォールバック)。
 */
export async function loadAssets(onProgress = () => {}) {
  const tex = new THREE.TextureLoader();
  const gltf = new GLTFLoader();
  const hdr = new RGBELoader();
  let done = 0, total = 0;
  const tick = () => onProgress(++done / total);
  const safe = (p) => { total++; return p.then((v) => { tick(); return v; }, (e) => { console.warn('asset failed', e?.message || e); tick(); return null; }); };

  const loadTex = (name, { srgb = true, repeat = true, aniso = 8 } = {}) => safe(tex.loadAsync(`${BASE}textures/${name}`).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    return t;
  }));
  const loadModel = (name) => safe(gltf.loadAsync(`${BASE}models/${name}.glb`));

  const assets = { env: null, tex: {}, bark: {}, rocks: [], fern: null, grassClump: null, celandine: null };

  /** 指定した地面テクスチャを (未読込なら) 読み込む。失敗したキーは未登録のまま */
  assets.ensureTex = async (keys) => {
    await Promise.all([...new Set(keys)].filter((k) => TEXFILES[k] && !assets.tex[k]).map(async (k) => {
      const f = TEXFILES[k];
      const [d, n] = await Promise.all([loadTex(f.d), f.n ? loadTex(f.n, { srgb: false }) : Promise.resolve(flatNormal)]);
      if (d) assets.tex[k] = { d, n: n || flatNormal };
    }));
  };

  const [env, barkD, barkN, b3, b4, b5, fern, grassClump, celandine] = await Promise.all([
    safe(hdr.loadAsync(`${BASE}env/sky.hdr`)),
    loadTex('bark_diff.jpg'), loadTex('bark_nor.jpg', { srgb: false }),
    loadModel('namaqualand_boulder_03'), loadModel('namaqualand_boulder_04'), loadModel('namaqualand_boulder_05'),
    loadModel('fern_02'), loadModel('grass_medium_01'), loadModel('celandine_01'),
    assets.ensureTex(['forest', 'dry', 'rock', 'sand']),
  ]);
  Object.assign(assets, { env, bark: { diff: barkD, nor: barkN }, rocks: [b3, b4, b5].filter(Boolean), fern, grassClump, celandine });
  return assets;
}

/** glTF 内の最初のメッシュから geometry / material を取り出す (InstancedMesh 用) */
export function firstMesh(gltf) {
  let found = null;
  gltf?.scene.traverse((o) => { if (!found && o.isMesh) found = o; });
  if (!found) return null;
  found.updateWorldMatrix(true, false);
  const geometry = found.geometry.clone();
  geometry.applyMatrix4(found.matrixWorld);
  geometry.computeBoundingBox();
  return { geometry, material: found.material };
}

/** HDRI の最も明るい点 (=太陽) の方向と、地平線付近・天頂付近の平均色を求める */
export function analyzeHdri(tex) {
  const { data, width: w, height: h } = tex.image;
  const dec = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (x) => x;
  let best = -1, bi = 0;
  const horizon = new THREE.Color(0, 0, 0), zenith = new THREE.Color(0, 0, 0);
  let hn = 0, zn = 0;
  for (let y = 0; y < h; y += 2) {
    const v = 1 - (y + 0.5) / h; // flipY 済み: 画像の上端 = v 1
    const elev = (v - 0.5) * Math.PI;
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const r = dec(data[i]), g = dec(data[i + 1]), b = dec(data[i + 2]);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > best) { best = l; bi = y * w + x; }
      if (elev > 0.05 && elev < 0.2) { horizon.r += r; horizon.g += g; horizon.b += b; hn++; }
      else if (elev > 1.05) { zenith.r += r; zenith.g += g; zenith.b += b; zn++; }
    }
  }
  const y = Math.floor(bi / w), x = bi % w;
  const u = (x + 0.5) / w, v = 1 - (y + 0.5) / h;
  const phi = (u - 0.5) * Math.PI * 2, th = (v - 0.5) * Math.PI;
  const sun = new THREE.Vector3(Math.cos(phi) * Math.cos(th), Math.sin(th), Math.sin(phi) * Math.cos(th));
  horizon.multiplyScalar(1 / Math.max(hn, 1)); zenith.multiplyScalar(1 / Math.max(zn, 1));
  return { sun, horizon, zenith, sunLum: best };
}
