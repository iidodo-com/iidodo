import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/Noise.js';
import { colored, jitter, hash3, up } from './Props.js';
import { firstMesh } from '../core/Assets.js';

const GLOW = (hex, k = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });

/** 石/金属素材。テクスチャがあれば map として使い、頂点カラーで陰影を付ける */
function surface(assets, key, o = {}) {
  const t = assets?.tex?.[key]?.d;
  return new THREE.MeshStandardMaterial({ vertexColors: true, map: t || null, roughness: 0.88, metalness: 0, ...o });
}

/** 共通の配置関数を作る (平坦ゾーン回避・高さ/傾斜フィルタ・コライダー登録) */
function makePlacer(terrain, area, rand) {
  const lim = terrain.half * 0.86, wl = terrain.waterLevel, zones = area.flat || [];
  const blocked = (x, z) => zones.some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r * 1.5 + 2);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();

  /**
   * geo/mat のインスタンスを count 個配置。
   * opts: scale() 一様スケール, yScale, radius(sc) コライダー半径(省略で無し), maxSlope, maxY, tilt, lift,
   *       colorFn(color,rand) → instanceColor, shadow, extra: 同じ行列を共有する追加メッシュ [{geo,mat}]
   */
  return (geo, mat, count, opts = {}) => {
    const { scale = () => 1, yScale = 1, zScale = null, radius = null, maxSlope = 0.1, maxY = 99, minY = wl + 0.7, tilt = 0, lift = 0, colorFn = null, shadow = true, extra = [], onPlace = null, spread = 1 } = opts;
    const meshes = [new THREE.InstancedMesh(geo, mat, count), ...extra.map((e) => new THREE.InstancedMesh(e.geo, e.mat, count))];
    const col = new THREE.Color();
    if (colorFn) meshes[0].setColorAt(0, col.set(1, 1, 1));
    let placed = 0, tries = 0;
    while (placed < count && tries++ < count * 30) {
      const x = (rand() * 2 - 1) * lim * spread, z = (rand() * 2 - 1) * lim * spread;
      if (blocked(x, z)) continue;
      const y = terrain.height(x, z);
      if (y > maxY || y < minY || terrain.slopeAt(x, z, y) > maxSlope) continue;
      const sc = scale();
      const yaw = rand() * Math.PI * 2;
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * tilt, yaw, (rand() - 0.5) * tilt, 'YXZ'));
      s.set(sc, sc * yScale * (0.85 + rand() * 0.3), zScale ? sc * zScale() : sc); p.set(x, y + lift, z);
      m4.compose(p, q, s);
      for (const m of meshes) m.setMatrixAt(placed, m4);
      if (colorFn) { colorFn(col, rand); meshes[0].setColorAt(placed, col); }
      if (radius) terrain.colliders.push({ x, z, r: radius(sc) });
      onPlace?.({ x, y, z, yaw, sc });
      placed++;
    }
    for (const m of meshes) {
      m.count = placed; m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = shadow; m.receiveShadow = true;
      terrain.group.add(m);
    }
    return meshes[0];
  };
}

// ---------------------------------------------------------------- geometry builders
function pillarGeo({ h = 4.8, r = 0.52, broken = true, tone = 0.7 } = {}) {
  const shaft = new THREE.CylinderGeometry(r * 0.88, r, h, 12, 5); shaft.translate(0, h / 2 + 0.3, 0);
  if (broken) {
    const p = shaft.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > h * 0.75) p.setY(i, y - hash3(p.getX(i), y, p.getZ(i)) * h * 0.28); }
  }
  const base = new THREE.BoxGeometry(r * 2.8, 0.34, r * 2.8); base.translate(0, 0.17, 0);
  const parts = [shaft, base].map((g) => colored(g, (x, y, z, c) => { const v = tone + hash3(x * 2, y, z * 2) * 0.16; c.setRGB(v, v * 0.98, v * 0.94); }, true));
  return mergeGeometries(parts);
}

function wallGeo(w = 6, h = 2.8, d = 0.9, tone = 0.68) {
  const g = new THREE.BoxGeometry(w, h, d, 8, 3, 1); g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > h * 0.9) p.setY(i, y - hash3(p.getX(i), 1, p.getZ(i)) * h * 0.55); }
  g.computeVertexNormals();
  return colored(g, (x, y, z, c) => { const v = tone + hash3(x, y, z) * 0.14; c.setRGB(v, v * 0.97, v * 0.92); }, true);
}

function stalagGeo(tone = [0.3, 0.34, 0.45]) {
  const g = new THREE.ConeGeometry(1, 1, 7, 4); g.translate(0, 0.5, 0);
  jitter(g, 0.35);
  return colored(g, (x, y, z, c) => { const t = Math.max(0, Math.min(1, y)); const v = 0.55 + t * 0.6 + hash3(x, y, z) * 0.15; c.setRGB(tone[0] * v, tone[1] * v, tone[2] * v); });
}

function columnGeo() {
  const g = new THREE.CylinderGeometry(0.8, 1, 1, 9, 6); g.translate(0, 0.5, 0);
  jitter(g, 0.3);
  return colored(g, (x, y, z, c) => { const v = 0.4 + hash3(x, y, z) * 0.2; c.setRGB(v * 0.75, v * 0.82, v); });
}

// ---------------------------------------------------------------- biomes
export function buildBiome(kind, terrain, assets, quality, area, out) {
  const rand = rng(area.terrain.seed + 555);
  const place = makePlacer(terrain, area, rand);
  const detail = quality?.detail ?? 1;
  ({ ruins, cave, lab, sky })[kind]?.({ terrain, assets, area, rand, place, out, detail });
}

function ruins({ terrain, assets, place, rand, detail }) {
  const stone = surface(assets, 'boulder', { color: '#d8d0c4' });
  // 折れた柱
  place(pillarGeo({ h: 5.2 }), stone, Math.round(46 * Math.max(detail, 0.6)), { scale: () => 0.9 + rand() * 0.6, radius: (s) => 0.7 * s, maxSlope: 0.08, tilt: 0.12, lift: -0.15 });
  place(pillarGeo({ h: 2.2, broken: false, tone: 0.62 }), stone, 30, { scale: () => 0.9 + rand() * 0.5, radius: (s) => 0.7 * s, maxSlope: 0.08 });
  // 崩れた壁 (向きに合わせて 3 つのコライダー)
  const wall = place(wallGeo(), stone, Math.round(26 * Math.max(detail, 0.6)), {
    scale: () => 0.8 + rand() * 0.6, maxSlope: 0.07,
    onPlace: ({ x, z, yaw, sc }) => {
      for (const o of [-2.2, 0, 2.2]) terrain.colliders.push({ x: x + Math.cos(yaw) * o * sc, z: z - Math.sin(yaw) * o * sc, r: 0.85 * sc });
    },
  });
  // 倒れた柱・瓦礫
  const rubble = new THREE.DodecahedronGeometry(0.7, 0); jitter(rubble, 0.4);
  place(colored(rubble, (x, y, z, c) => { const v = 0.55 + hash3(x, y, z) * 0.2; c.setRGB(v, v * 0.96, v * 0.9); }), stone, 160, { scale: () => 0.4 + rand() * 0.9, yScale: 0.7, radius: (s) => 0.55 * s, maxSlope: 0.12 });
  // 枯れ木
  const deadG = (() => {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.12, 0.3, 3.4, 6); trunk.translate(0, 1.7, 0); parts.push(trunk);
    for (let i = 0; i < 4; i++) { const b = new THREE.CylinderGeometry(0.04, 0.12, 1.5, 5); b.translate(0, 0.75, 0); b.rotateZ(0.8 + i * 0.1); b.rotateY(i * 1.6); b.translate(0, 1.9 + i * 0.35, 0); parts.push(b); }
    return mergeGeometries(parts.map((g) => colored(g, (x, y, z, c) => { const v = 0.22 + hash3(x, y, z) * 0.08; c.setRGB(v, v * 0.85, v * 0.7); })));
  })();
  place(deadG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 60, { scale: () => 0.9 + rand() * 0.7, radius: (s) => 0.35 * s, maxSlope: 0.08 });
}

function cave({ terrain, assets, place, rand, detail, out }) {
  const rockMat = surface(assets, 'darkrock', { color: '#9aa4c0', roughness: 0.82 });
  const flat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
  // 石筍
  place(stalagGeo(), flat, Math.round(170 * Math.max(detail, 0.5)), { scale: () => 0.6 + Math.pow(rand(), 2) * 1.8, yScale: 2.4, radius: (s) => 0.5 * s, maxSlope: 0.14, minY: -99 });
  // 大きな岩柱 (視界を遮り、洞窟らしい奥行きを出す)
  place(columnGeo(), rockMat, 26, { scale: () => 2.2 + rand() * 1.8, yScale: 7, radius: (s) => 0.9 * s, maxSlope: 0.12, minY: -99 });
  // 天井の鍾乳石 (見上げた時の雰囲気)
  const stalac = place(stalagGeo([0.25, 0.28, 0.4]), flat, 90, { scale: () => 1 + rand() * 2, yScale: 3, shadow: false, lift: 21, minY: -99, maxSlope: 1 });
  // flip: 先端を下に向ける
  const dummy = new THREE.Object3D(), m = new THREE.Matrix4();
  for (let i = 0; i < stalac.count; i++) { stalac.getMatrixAt(i, m); m.decompose(dummy.position, dummy.quaternion, dummy.scale); dummy.rotation.set(Math.PI, 0, 0); dummy.updateMatrix(); stalac.setMatrixAt(i, dummy.matrix); }
  stalac.instanceMatrix.needsUpdate = true;
  // 発光キノコ
  const stem = new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6); stem.translate(0, 0.25, 0);
  const cap = new THREE.SphereGeometry(0.28, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(0, 0.5, 0);
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const caps = place(cap, capMat, 150, {
    scale: () => 0.7 + rand() * 1.1, shadow: false, minY: -99, maxSlope: 0.12,
    colorFn: (c, r) => { const t = r(); c.set(t < 0.45 ? '#3de0ff' : t < 0.8 ? '#ff5ad8' : '#6dffa0').multiplyScalar(2.2); },
    extra: [{ geo: stem, mat: new THREE.MeshStandardMaterial({ color: '#cfd8ee', roughness: 0.7 }) }],
  });
}

function lab({ terrain, assets, place, rand, detail, out }) {
  const plate = surface(assets, 'tiles', { color: '#aac4e0', roughness: 0.5, metalness: 0.5 });
  const metalFlat = new THREE.MeshStandardMaterial({ color: '#4a5560', roughness: 0.45, metalness: 0.85 });
  // 魔導ピラー: 本体 + 光る芯 (同じ行列を共有)
  const body = new THREE.BoxGeometry(1.3, 0.5, 1.3); body.translate(0, 0.25, 0);
  const core = new THREE.CylinderGeometry(0.16, 0.16, 4.2, 10); core.translate(0, 2.6, 0);
  const ring = new THREE.TorusGeometry(0.5, 0.06, 8, 20); ring.rotateX(Math.PI / 2); ring.translate(0, 4.7, 0);
  const glowGeo = mergeGeometries([core, ring]);
  const spots = [];
  place(body, metalFlat, 38, { scale: () => 0.9 + rand() * 0.4, radius: (s) => 0.75 * s, maxSlope: 0.06, extra: [{ geo: glowGeo, mat: GLOW('#4fd8ff', 3.2) }], onPlace: ({ x, y, z }) => spots.push({ x, y: y + 3, z, color: 0x4fd8ff }) });
  out.lightSpots.push(...spots.filter((_, i) => i % 2 === 0));
  // 発電塔
  const tower = new THREE.CylinderGeometry(1.2, 1.5, 6.5, 14); tower.translate(0, 3.25, 0);
  const rings = mergeGeometries([2, 3.6, 5.2].map((y) => { const g = new THREE.TorusGeometry(1.32 - y * 0.02, 0.07, 6, 24); g.rotateX(Math.PI / 2); g.translate(0, y, 0); return g; }));
  place(tower, metalFlat, 14, { scale: () => 0.9 + rand() * 0.5, radius: (s) => 1.5 * s, maxSlope: 0.06, extra: [{ geo: rings, mat: GLOW('#6af0ff', 3) }] });
  // コンテナ (クレート)
  const crate = new THREE.BoxGeometry(1.7, 1.5, 1.7); crate.translate(0, 0.75, 0);
  place(colored(crate, (x, y, z, c) => c.setRGB(0.85 + hash3(x, y, z) * 0.15, 0.85, 0.9), true), plate, 56, { scale: () => 0.8 + rand() * 0.6, radius: (s) => 1.05 * s, maxSlope: 0.06 });
  // 床の導光ライン
  const strip = new THREE.BoxGeometry(1, 0.2, 1); strip.translate(0, 0.1, 0.5);
  place(strip, GLOW('#38d8ff', 2.4), 90, { scale: () => 0.1 + rand() * 0.08, yScale: 1, zScale: () => 50 + rand() * 110, shadow: false, maxSlope: 0.05, lift: 0.02 });
  // 隔壁パネル
  place(wallGeo(8, 3.4, 0.6, 0.9), plate, 20, {
    scale: () => 0.9 + rand() * 0.4, maxSlope: 0.06,
    onPlace: ({ x, z, yaw, sc }) => { for (const o of [-3, 0, 3]) terrain.colliders.push({ x: x + Math.cos(yaw) * o * sc, z: z - Math.sin(yaw) * o * sc, r: 1.1 * sc }); },
  });
}

function sky({ terrain, assets, area, place, rand, detail }) {
  const marble = surface(assets, 'marble', { color: '#ffffff', roughness: 0.4 });
  // 大理石の柱 (一部は欠けている)
  place(pillarGeo({ h: 6.2, r: 0.6, broken: false, tone: 0.95 }), marble, 36, { scale: () => 0.95 + rand() * 0.35, radius: (s) => 0.8 * s, maxSlope: 0.07 });
  place(pillarGeo({ h: 3.6, r: 0.6, broken: true, tone: 0.9 }), marble, 22, { scale: () => 0.9 + rand() * 0.4, radius: (s) => 0.8 * s, maxSlope: 0.07 });
  place(wallGeo(6, 1.6, 0.8, 0.95), marble, 16, {
    scale: () => 0.8 + rand() * 0.5, maxSlope: 0.06,
    onPlace: ({ x, z, yaw, sc }) => { for (const o of [-2, 2]) terrain.colliders.push({ x: x + Math.cos(yaw) * o * sc, z: z - Math.sin(yaw) * o * sc, r: 0.9 * sc }); },
  });
  // 遠景の浮遊岩
  const v = (assets?.rocks || []).map(firstMesh).filter(Boolean);
  const r = rng(area.terrain.seed + 909);
  if (v.length) {
    for (let i = 0; i < 16; i++) {
      const src = v[i % v.length], bb = src.geometry.boundingBox, size = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      const m = new THREE.Mesh(src.geometry, src.material);
      const a = r() * Math.PI * 2, d = terrain.half + 30 + r() * 110, s = (14 + r() * 26) / size;
      m.position.set(Math.cos(a) * d, -6 + r() * 36, Math.sin(a) * d);
      m.rotation.set(r() * 0.4, r() * 6, r() * 0.4); m.scale.set(s, s * 0.8, s);
      m.userData.sharedGeo = true;
      terrain.group.add(m);
    }
  }
}
