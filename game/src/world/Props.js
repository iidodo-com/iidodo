import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../core/Config.js';
import { rng } from '../core/Noise.js';
import { addWind } from './Wind.js';
import { firstMesh } from '../core/Assets.js';
import { fbm } from '../core/Noise.js';

const up = new THREE.Vector3(0, 1, 0);

/** 非インデックス化して、頂点ごとに fn で色を付ける */
function colored(geo, fn, keepUV = false) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!keepUV) g.deleteAttribute('uv');
  return g;
}
const hash3 = (x, y, z) => {
  const s = Math.sin(Math.round(x * 40) * 12.9898 + Math.round(y * 40) * 78.233 + Math.round(z * 40) * 37.719) * 43758.5453;
  return s - Math.floor(s);
};
/** 同一位置の頂点は同じ変位 → 割れずに歪む */
function jitter(geo, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hash3(x, y, z) - 0.5) * amt;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  return geo;
}

function trunkGeo(h, r0, r1) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 7); g.translate(0, h / 2, 0);
  return colored(g, (x, y, z, c) => { const t = y / h; c.setRGB(0.28 - t * 0.06, 0.18 - t * 0.04, 0.1); }, true);
}

function pineFoliage() {
  const tiers = [[1.75, 1.7, 1.1], [1.45, 1.6, 2.0], [1.1, 1.5, 2.85], [0.7, 1.4, 3.65]];
  const parts = tiers.map(([r, h, y]) => {
    const g = new THREE.ConeGeometry(r, h, 8, 1); g.translate(0, y + h / 2, 0);
    jitter(g, 0.12);
    return colored(g, (x, yy, z, c) => { const t = (yy - y) / h; const v = 0.55 + t * 0.55 + hash3(x, yy, z) * 0.12; c.setRGB(v * 0.8, v, v * 0.8); });
  });
  return mergeGeometries(parts);
}

function oakFoliage() {
  const blobs = [[1.5, 0, 3.4, 0], [1.1, 1.0, 2.9, 0.35], [1.15, -0.9, 3.0, -0.4], [1.05, 0.15, 4.2, 0.1], [0.9, -0.2, 3.0, 1.0]];
  const parts = blobs.map(([r, x, y, z]) => {
    const g = new THREE.IcosahedronGeometry(r, 1); jitter(g, 0.32); g.translate(x, y, z);
    return colored(g, (px, py, pz, c) => { const t = (py - (y - r)) / (2 * r); const v = 0.6 + t * 0.55 + hash3(px, py, pz) * 0.12; c.setRGB(v, v, v); });
  });
  return mergeGeometries(parts);
}

function rockGeo() {
  const g = new THREE.DodecahedronGeometry(1, 1);
  jitter(g, 0.45);
  const ng = g.index ? g.toNonIndexed() : g; ng.computeVertexNormals();
  const nrm = ng.attributes.normal, pos = ng.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const v = 0.55 + hash3(pos.getX(i) * 3, pos.getY(i) * 3, pos.getZ(i) * 3) * 0.3;
    if (nrm.getY(i) > 0.5) c.setRGB(0.18 * v * 1.6, 0.33 * v * 1.6, 0.1 * v * 1.6); // 苔
    else c.setRGB(0.42 * v, 0.43 * v, 0.46 * v);
    arr.set([c.r, c.g, c.b], i * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  ng.deleteAttribute('uv');
  return ng;
}

function radialTexture(color = '#7fe6ff') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color); g.addColorStop(0.4, color + '66'); g.addColorStop(1, '#00000000');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildProps(terrain, assets = null, quality = null) {
  const detail = quality?.detail ?? 1;
  const group = terrain.group;
  const rand = rng(CONFIG.world.seed + 5);
  const lim = terrain.half * 0.86;
  const wl = terrain.waterLevel;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();

  const flat = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, ...o });

  // 配置の共通処理: meshes は同じ行列を共有する InstancedMesh 群
  const scatter = ({ count, meshes, minDist, maxY = 11, radius, scale, yScale = 1, sink = 0, colorFn, maxSlope = 0.1 }) => {
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 30) {
      const x = (rand() * 2 - 1) * lim, z = (rand() * 2 - 1) * lim;
      if (Math.hypot(x, z) < minDist) continue;
      const y = terrain.height(x, z);
      if (y > maxY || y < wl + 0.7) continue;
      if (terrain.slopeAt(x, z, y) > maxSlope) continue;
      const sc = scale();
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      s.set(sc, sc * yScale * (0.9 + rand() * 0.25), sc);
      p.set(x, y - sink * sc, z);
      m4.compose(p, q, s);
      for (const m of meshes) m.setMatrixAt(placed, m4);
      if (colorFn) { colorFn(col, rand); for (const m of meshes) if (m.userData.tinted) m.setColorAt(placed, col); }
      terrain.colliders.push({ x, z, r: radius(sc) });
      placed++;
    }
    for (const m of meshes) {
      m.count = placed; m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
  };

  // 幹: 樹皮の PBR テクスチャ (あれば)。無ければ頂点カラー
  const B = assets?.bark;
  const trunkMat = () => {
    if (!(B?.diff && B?.nor)) return flat({});
    const mat = new THREE.MeshStandardMaterial({ map: B.diff, normalMap: B.nor, normalScale: new THREE.Vector2(1.2, 1.2), color: '#d8c8b4', roughness: 0.92, flatShading: false });
    for (const t of [B.diff, B.nor]) t.repeat.set(2, 3);
    return mat;
  };

  const mk = (geo, mat, n, tinted = false) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.userData.tinted = tinted;
    if (tinted) m.setColorAt(0, new THREE.Color(1, 1, 1));
    return m;
  };

  // --- 松
  const pineMat = flat({}); addWind(pineMat, { strength: 0.012, heightStart: 1.0 });
  const pineLeaf = mk(pineFoliage(), pineMat, 340, true);
  const pineTrunk = mk(trunkGeo(1.8, 0.3, 0.2), trunkMat(), 340);
  const pineCols = ['#2d6a3e', '#25594a', '#3a7d3f', '#2f6f56'];
  scatter({
    count: 340, meshes: [pineLeaf, pineTrunk], minDist: 11, radius: (sc) => 0.32 * sc + 0.2,
    scale: () => 0.8 + rand() * 0.9,
    colorFn: (c, r) => c.set(pineCols[Math.floor(r() * pineCols.length)]).multiplyScalar(0.85 + r() * 0.3),
  });

  // --- 広葉樹 (一部は桜・紅葉)
  const oakMat = flat({}); addWind(oakMat, { strength: 0.02, heightStart: 2.2 });
  const oakLeaf = mk(oakFoliage(), oakMat, 200, true);
  const oakTrunk = mk(trunkGeo(3.0, 0.34, 0.2), trunkMat(), 200);
  const oakCols = ['#68ad3c', '#7cb83f', '#58a044', '#8cc044'];
  scatter({
    count: 200, meshes: [oakLeaf, oakTrunk], minDist: 10, radius: (sc) => 0.34 * sc + 0.2,
    scale: () => 0.75 + rand() * 0.8,
    colorFn: (c, r) => {
      const t = r();
      if (t < 0.14) c.set('#f6a9c8');            // 桜
      else if (t < 0.22) c.set('#e3922e');       // 紅葉
      else c.set(oakCols[Math.floor(r() * oakCols.length)]);
      c.multiplyScalar(0.9 + r() * 0.25);
    },
  });

  // --- 岩: 写真測量の本物モデル (あれば) / 手続き生成の苔岩 (フォールバック)
  const rockVariants = (assets?.rocks || []).map(firstMesh).filter(Boolean);
  if (rockVariants.length) {
    const perVariant = Math.round(34 * Math.max(detail, 0.5));
    for (const v of rockVariants) {
      const bb = v.geometry.boundingBox;
      const size = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      v.material.envMapIntensity = 0.8;
      const m = mk(v.geometry, v.material, perVariant);
      scatter({
        count: perVariant, meshes: [m], minDist: 8, radius: (sc) => 0.4 * size * sc, yScale: 0.9, sink: 0.12,
        scale: () => (0.9 + Math.pow(rand(), 2) * 1.8) * (1.6 / size), maxSlope: 0.16,
      });
    }
  } else {
    const rocks = mk(rockGeo(), flat({ roughness: 0.95 }), 110);
    scatter({
      count: 110, meshes: [rocks], minDist: 8, radius: (sc) => 0.8 * sc, yScale: 0.75, sink: 0.25,
      scale: () => 0.7 + Math.pow(rand(), 2) * 2.2, maxSlope: 0.16,
    });
  }

  // --- 下草: 写真測量のシダ・草の塊・黄色い花 (軽量化済みモデルを大量インスタンス)
  const undergrowth = (gltf, { count, scale, wind = 0.5, clump = 0, minY = 0.6, tint = null, maxSlope = 0.09, shadow = false }) => {
    const v = firstMesh(gltf);
    if (!v) return;
    const mat = v.material.clone();
    mat.alphaTest = 0.5; mat.transparent = false; mat.side = THREE.DoubleSide; mat.depthWrite = true;
    if (tint) mat.color.set(tint);
    addWind(mat, { strength: wind, heightStart: 0, fade: (quality?.grassDist ?? 80) * 1.1 });
    const n = Math.round(count * detail);
    const m = new THREE.InstancedMesh(v.geometry, mat, n);
    let placed = 0, tries = 0;
    while (placed < n && tries++ < n * 40) {
      const x = (rand() * 2 - 1) * lim * 0.95, z = (rand() * 2 - 1) * lim * 0.95;
      if (clump && fbm(x * 0.06 + clump, z * 0.06, 31, 2) < 0.55) continue;
      if (Math.hypot(x, z) < 3) continue;
      const y = terrain.height(x, z);
      if (y < wl + minY || y > 8 || terrain.slopeAt(x, z, y) > maxSlope) continue;
      const sc = scale();
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      s.set(sc, sc * (0.85 + rand() * 0.3), sc); p.set(x, y - 0.02, z);
      m4.compose(p, q, s); m.setMatrixAt(placed++, m4);
    }
    m.count = placed; m.instanceMatrix.needsUpdate = true;
    m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
    group.add(m);
  };
  undergrowth(assets?.fern, { count: 380, scale: () => 0.8 + rand() * 0.9, clump: 5, minY: 0.8 });
  undergrowth(assets?.grassClump, { count: 900, scale: () => 0.9 + rand() * 0.9, wind: 0.6, clump: 17 });
  undergrowth(assets?.celandine, { count: 320, scale: () => 0.8 + rand() * 0.6, wind: 0.8, clump: 47, maxSlope: 0.06 });

  // --- 光る結晶 (ランドマーク / ブルームの見せ場)
  const crystalGeo = new THREE.OctahedronGeometry(1, 0); crystalGeo.scale(0.22, 1, 0.22); crystalGeo.translate(0, 1, 0);
  const crystalCols = ['#4fd8ff', '#b07cff', '#5dffc0'];
  const glowTex = radialTexture('#9fe9ff');
  let clusters = 0, tries = 0;
  const spots = [[16, -12]]; // 1つ目は初期位置の近くに置いて目に入るように
  while (clusters < 9 && tries++ < 400) {
    let x, z;
    if (spots.length) [x, z] = spots.shift();
    else { x = (rand() * 2 - 1) * lim; z = (rand() * 2 - 1) * lim; if (Math.hypot(x, z) < 22) continue; }
    const y = terrain.height(x, z);
    if (y > 9 || y < wl + 0.8 || terrain.slopeAt(x, z, y) > 0.1) continue;
    const cc = new THREE.Color(crystalCols[clusters % crystalCols.length]);
    const mat = new THREE.MeshStandardMaterial({
      color: cc.clone().multiplyScalar(0.5), emissive: cc, emissiveIntensity: 4.5, roughness: 0.15, metalness: 0.2, flatShading: true,
    });
    const g = new THREE.Group(); g.position.set(x, y - 0.1, z);
    const n = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(crystalGeo, mat);
      const a = rand() * Math.PI * 2, d = i === 0 ? 0 : 0.5 + rand() * 0.6, hgt = i === 0 ? 2.2 : 0.8 + rand() * 1.2;
      m.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      m.scale.set(1, hgt, 1).multiplyScalar(i === 0 ? 1.1 : 0.7 + rand() * 0.4);
      m.rotation.set((rand() - 0.5) * 0.5, rand() * 6, (rand() - 0.5) * 0.5);
      m.castShadow = true;
      g.add(m);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({
      map: glowTex, color: cc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7,
    }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = 0.25;
    g.add(glow);
    group.add(g);
    terrain.colliders.push({ x, z, r: 0.9 });
    clusters++;
  }
}
