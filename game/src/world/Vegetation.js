import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { fbm, rng } from '../core/Noise.js';
import { addWind } from './Wind.js';

const up = new THREE.Vector3(0, 1, 0);
const CHUNK = 20;

/** 先細りの草の葉 (表裏両面を持つ) */
function bladeGeometry() {
  const rows = [[0, 1], [0.35, 0.85], [0.7, 0.55], [1, 0]];
  const pos = [], col = [], nor = [], idx = [];
  rows.forEach(([y, w], i) => {
    const hw = 0.05 * w, bend = y * y * 0.12;
    pos.push(-hw, y, bend, hw, y, bend);
    const c = 0.55 + 0.9 * y;
    col.push(c, c, c, c, c, c);
    nor.push(0, 1, 0, 0, 1, 0);
    if (i < rows.length - 1) {
      const a = i * 2, b = a + 1, c2 = a + 2, d = a + 3;
      idx.push(a, b, c2, b, d, c2,  a, c2, b, b, c2, d);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * 風に揺れる草と花。ワールドを 20m チャンクに分け、プレイヤー周辺のチャンクだけ表示する。
 * 草の色は地面の色 (terrain.colorAt) に合わせ、遠距離はディザで溶かす。
 */
export class Vegetation {
  constructor(scene, terrain, q) {
    this.chunks = [];
    this.far = q.grassDist;
    const rand = rng(CONFIG.world.seed + 77);
    const half = terrain.half, n = Math.floor(CONFIG.world.size / CHUNK);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    addWind(mat, { strength: 0.55, fade: this.far });
    const blade = bladeGeometry();
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const wl = terrain.waterLevel;

    for (let cx = 0; cx < n; cx++) for (let cz = 0; cz < n; cz++) {
      const x0 = -half + cx * CHUNK, z0 = -half + cz * CHUNK;
      if (Math.max(Math.abs(x0 + CHUNK / 2), Math.abs(z0 + CHUNK / 2)) > half - 12) continue;
      const mesh = new THREE.InstancedMesh(blade, mat, q.grass);
      mesh.setColorAt(0, col.set(1, 1, 1));
      let placed = 0;
      for (let i = 0; i < q.grass * 1.4 && placed < q.grass; i++) {
        const x = x0 + rand() * CHUNK, z = z0 + rand() * CHUNK;
        const y = terrain.height(x, z);
        if (y < wl + 0.35 || y > 10) continue;
        const slope = terrain.slopeAt(x, z, y);
        if (slope > 0.075) continue;
        const patch = fbm(x * 0.05 + 9, z * 0.05, 5, 3);
        if (patch < 0.3 && rand() < 0.7) continue; // 地面が覗く場所
        qt.setFromAxisAngle(up, rand() * Math.PI * 2);
        const h = (0.38 + rand() * 0.5) * (0.8 + patch * 0.7);
        sc.set(0.9 + rand() * 0.8, h, 1);
        p.set(x, y - 0.02, z);
        m4.compose(p, qt, sc);
        mesh.setMatrixAt(placed, m4);
        terrain.colorAt(x, z, col, y, slope).multiplyScalar(0.9 + rand() * 0.35);
        col.r *= 1.1; col.g *= 1.18; // 地面より少し明るく鮮やかに
        mesh.setColorAt(placed, col);
        placed++;
      }
      if (!placed) continue;
      mesh.count = placed;
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      this.chunks.push({ mesh, x: x0 + CHUNK / 2, z: z0 + CHUNK / 2 });
    }
    this._buildFlowers(scene, terrain, q, rand);
  }

  _buildFlowers(scene, terrain, q, rand) {
    const stemGeo = new THREE.CylinderGeometry(0.008, 0.012, 0.3, 4); stemGeo.translate(0, 0.15, 0);
    const headGeo = new THREE.IcosahedronGeometry(0.06, 0); headGeo.scale(1, 0.55, 1); headGeo.translate(0, 0.31, 0);
    const stemMat = new THREE.MeshLambertMaterial({ color: '#3f8a3c' });
    const headMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#332a20' });
    const N = q.flowers;
    const stems = new THREE.InstancedMesh(stemGeo, stemMat, N);
    const heads = new THREE.InstancedMesh(headGeo, headMat, N);
    const palette = ['#ffffff', '#ffe066', '#ff8fb8', '#b69cff', '#ff7a59', '#8fd3ff'].map((c) => new THREE.Color(c));
    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const lim = terrain.half * 0.8;
    let placed = 0, tries = 0;
    while (placed < N && tries++ < N * 40) {
      const x = (rand() * 2 - 1) * lim, z = (rand() * 2 - 1) * lim;
      const clump = fbm(x * 0.07 + 3, z * 0.07 + 8, 21, 2);
      if (clump < 0.58) continue;
      const y = terrain.height(x, z);
      if (y < terrain.waterLevel + 0.6 || y > 8 || terrain.slopeAt(x, z, y) > 0.06) continue;
      qt.setFromAxisAngle(up, rand() * 6.28);
      const s = 0.8 + rand() * 0.8;
      sc.set(s, s, s); p.set(x, y, z);
      m4.compose(p, qt, sc);
      stems.setMatrixAt(placed, m4); heads.setMatrixAt(placed, m4);
      heads.setColorAt(placed, palette[Math.floor(clump * 37 + rand() * 3) % palette.length]);
      placed++;
    }
    stems.count = heads.count = placed;
    stems.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    addWind(stemMat, { strength: 0.9 }); addWind(headMat, { strength: 0.9 });
    scene.add(stems, heads);
  }

  update(playerPos) {
    const r = this.far + CHUNK;
    for (const c of this.chunks) {
      c.mesh.visible = Math.hypot(c.x - playerPos.x, c.z - playerPos.z) < r;
    }
  }
}
