import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { fbm, rng } from '../core/Noise.js';

/**
 * 高さマップ地形 + 木/岩の配置。
 *  - getHeightAt(x, z): 任意地点の地面高 (プレイヤー/敵/カメラが共通利用)
 *  - colliders: 円柱コライダー [{x,z,r}] (木・岩)。Phase 2 以降は敵も同じ配列で押し出し判定
 * 将来 Phase 4 で「エリア定義」を受け取って再構築できるよう、生成は build() に分離。
 */
export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.colliders = [];
    this.half = CONFIG.world.size / 2;
    scene.add(this.group);
  }

  height(x, z) {
    const { size, maxHeight, spawnClearRadius, seed } = CONFIG.world;
    const s = 0.018;
    let h = (fbm(x * s, z * s, seed, 5) - 0.5) * 2 * maxHeight;
    h += (fbm(x * 0.05, z * 0.05, seed + 99, 2) - 0.5) * 1.2;
    // スポーン地点(原点)付近を平坦に
    const d = Math.hypot(x, z);
    const flat = THREE.MathUtils.smoothstep(d, spawnClearRadius * 0.5, spawnClearRadius * 2.2);
    h *= flat;
    // 外周を山にして世界の端を塞ぐ
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (size / 2);
    h += Math.pow(THREE.MathUtils.smoothstep(edge, 0.82, 1.0), 1.5) * 22;
    return h;
  }

  getHeightAt(x, z) { return this.height(x, z); }

  clampToWorld(pos, margin = 3) {
    const lim = this.half - margin;
    pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
    pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);
  }

  /** 円コライダーとの押し出し。pos は直接更新される。 */
  resolveCollisions(pos, radius) {
    for (const c of this.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const min = radius + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (min - d) / d;
        pos.x += dx * push; pos.z += dz * push;
      }
    }
  }

  build() {
    this._buildGround();
    this._buildProps();
  }

  _buildGround() {
    const { size, segments } = CONFIG.world;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.height(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();

    // 高さ・傾斜で頂点カラー (草 / 土 / 岩 / 山頂)
    const nrm = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const grassA = new THREE.Color('#4f8f3a'), grassB = new THREE.Color('#79a944');
    const dirt = new THREE.Color('#7a6240'), rock = new THREE.Color('#7d7f86'), snow = new THREE.Color('#e8eef2');
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), slope = 1 - nrm.getY(i);
      const n = fbm(pos.getX(i) * 0.12, pos.getZ(i) * 0.12, 7, 3);
      tmp.copy(grassA).lerp(grassB, n);
      tmp.lerp(dirt, THREE.MathUtils.smoothstep(slope, 0.12, 0.3) * 0.8);
      tmp.lerp(rock, THREE.MathUtils.smoothstep(slope, 0.28, 0.5));
      tmp.lerp(rock, THREE.MathUtils.smoothstep(y, 10, 16));
      tmp.lerp(snow, THREE.MathUtils.smoothstep(y, 18, 24));
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.groundMesh = mesh;
  }

  _buildProps() {
    const rand = rng(CONFIG.world.seed + 5);
    const treeCount = 380, rockCount = 90;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.8, 6); trunkGeo.translate(0, 0.9, 0);
    const leafGeo = new THREE.ConeGeometry(1.5, 3.4, 7); leafGeo.translate(0, 3.3, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#5b3f26' }), treeCount);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: '#2f6b32' }), treeCount);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: '#8a8c93', flatShading: true }), rockCount);
    for (const m of [trunks, leaves, rocks]) { m.castShadow = true; m.receiveShadow = true; }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const lim = this.half * 0.85;
    const place = (count, mesh, extra, minDist, radiusFn, scaleFn) => {
      let placed = 0, tries = 0;
      while (placed < count && tries++ < count * 20) {
        const x = (rand() * 2 - 1) * lim, z = (rand() * 2 - 1) * lim;
        if (Math.hypot(x, z) < minDist) continue;
        const y = this.height(x, z);
        if (y > 11) continue; // 高山には置かない
        const sc = scaleFn();
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        s.set(sc, sc * (mesh === rocks ? 0.7 : 1), sc);
        p.set(x, y - (mesh === rocks ? 0.2 * sc : 0), z);
        m4.compose(p, q, s);
        mesh.setMatrixAt(placed, m4);
        extra?.setMatrixAt(placed, m4);
        this.colliders.push({ x, z, r: radiusFn(sc) });
        placed++;
      }
      mesh.count = placed;
      if (extra) extra.count = placed;
      mesh.instanceMatrix.needsUpdate = true;
      if (extra) extra.instanceMatrix.needsUpdate = true;
    };
    place(treeCount, trunks, leaves, 9, (sc) => 0.35 * sc + 0.15, () => 0.8 + rand() * 0.8);
    place(rockCount, rocks, null, 8, (sc) => 0.85 * sc, () => 0.8 + rand() * 1.6);
    this.group.add(trunks, leaves, rocks);
  }
}
