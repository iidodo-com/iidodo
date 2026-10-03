import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { fbm } from '../core/Noise.js';
import { buildProps } from './Props.js';

// 周期境界つき value-noise のディテールテクスチャ (地面の質感用)
function makeDetailTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const grid = (cells, seed) => {
    const g = new Float32Array(cells * cells);
    let a = seed;
    for (let i = 0; i < g.length; i++) { a = (Math.imul(a, 1664525) + 1013904223) | 0; g[i] = ((a >>> 8) & 0xffff) / 65535; }
    return (x, y) => {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[((j % cells) * cells) + (i % cells)];
      const a0 = at(x0, y0), b0 = at(x0 + 1, y0), a1 = at(x0, y0 + 1), b1 = at(x0 + 1, y0 + 1);
      return (a0 + (b0 - a0) * sx) + ((a1 + (b1 - a1) * sx) - (a0 + (b0 - a0) * sx)) * sy;
    };
  };
  const g1 = grid(8, 11), g2 = grid(32, 23), g3 = grid(96, 37);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = g1(x, y) * 0.45 + g2(x, y) * 0.35 + g3(x, y) * 0.2;
    const k = Math.max(0, Math.min(255, Math.round(v * 255)));
    const o = (y * size + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = k; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const C = {
  grassA: new THREE.Color('#58b03c'), grassB: new THREE.Color('#a2d054'), grassC: new THREE.Color('#3f8a3c'),
  dirt: new THREE.Color('#8a6a42'), rock: new THREE.Color('#8a8c94'), snow: new THREE.Color('#f1f5f8'),
  sand: new THREE.Color('#dccb94'), wet: new THREE.Color('#4a5d44'),
};

/**
 * 高さマップ地形。
 *  - getHeightAt(x,z) / colorAt(x,z) / colliders はプレイヤー・敵・カメラ・植生が共有
 *  - 描画は頂点カラー + ワールド座標のディテールテクスチャ (2スケール) の PBR マテリアル
 */
export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.colliders = [];
    this.half = CONFIG.world.size / 2;
    this.waterLevel = CONFIG.world.waterLevel;
    scene.add(this.group);
  }

  height(x, z) {
    const { size, maxHeight, spawnClearRadius, seed } = CONFIG.world;
    const s = 0.018;
    let h = (fbm(x * s, z * s, seed, 5) - 0.5) * 2 * maxHeight;
    h += (fbm(x * 0.05, z * 0.05, seed + 99, 2) - 0.5) * 1.2;
    const d = Math.hypot(x, z);
    const flat = THREE.MathUtils.smoothstep(d, spawnClearRadius * 0.5, spawnClearRadius * 2.2);
    h *= flat;
    const edge = Math.max(Math.abs(x), Math.abs(z)) / (size / 2);
    h += Math.pow(THREE.MathUtils.smoothstep(edge, 0.82, 1.0), 1.5) * 22;
    return h;
  }
  getHeightAt(x, z) { return this.height(x, z); }

  slopeAt(x, z, y = this.height(x, z)) {
    const e = 0.8;
    const gx = (this.height(x + e, z) - y) / e, gz = (this.height(x, z + e) - y) / e;
    return 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz); // 0=平坦, 大きいほど急斜面
  }

  /** 地面の色 (リニア)。頂点カラーと草の色合わせに共用 */
  colorAt(x, z, out = new THREE.Color(), y = this.height(x, z), slope = this.slopeAt(x, z, y)) {
    const n = fbm(x * 0.09, z * 0.09, 7, 3);
    const m = fbm(x * 0.021 + 40, z * 0.021, 13, 2);
    out.copy(C.grassA).lerp(C.grassB, n).lerp(C.grassC, THREE.MathUtils.smoothstep(m, 0.55, 0.75) * 0.7);
    out.lerp(C.dirt, THREE.MathUtils.smoothstep(slope, 0.025, 0.07) * 0.85);
    out.lerp(C.rock, THREE.MathUtils.smoothstep(slope, 0.06, 0.14));
    out.lerp(C.rock, THREE.MathUtils.smoothstep(y, 9, 15));
    out.lerp(C.snow, THREE.MathUtils.smoothstep(y, 17, 23));
    const wl = this.waterLevel;
    out.lerp(C.sand, THREE.MathUtils.smoothstep(y, wl + 0.9, wl + 0.15));
    out.lerp(C.wet, THREE.MathUtils.smoothstep(y, wl + 0.05, wl - 0.8));
    return out;
  }

  clampToWorld(pos, margin = 3) {
    const lim = this.half - margin;
    pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
    pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);
  }

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

  /** 水中の深さ (0 以下は陸) */
  waterDepthAt(x, z) { return this.waterLevel - this.height(x, z); }

  build() {
    this._buildGround();
    buildProps(this);
  }

  _buildGround() {
    const { size, segments } = CONFIG.world;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.height(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();

    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      this.colorAt(pos.getX(i), pos.getZ(i), tmp, pos.getY(i));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const detail = makeDetailTexture();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: detail };
      shader.vertexShader = 'varying vec3 vWPos;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = 'uniform sampler2D uDetail; varying vec3 vWPos;\n' + shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        {
          float a = texture2D(uDetail, vWPos.xz * 0.045).r;
          float b = texture2D(uDetail, vWPos.xz * 0.37).r;
          float c = texture2D(uDetail, vWPos.xz * 1.9).r;
          float k = a * 0.4 + b * 0.35 + c * 0.25;
          diffuseColor.rgb *= 0.55 + 0.95 * k;
        }`);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.groundMesh = mesh;
  }
}
