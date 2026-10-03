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

// MathUtils.smoothstep は min>max (逆向きの境界) だと正しく動かないので自前版を使う
const ss = (x, a, b) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

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
  constructor(scene, assets = null, quality = null) {
    this.scene = scene;
    this.assets = assets;
    this.quality = quality;
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

  /** 地面の色 (リニア)。草の色合わせ・フォールバック描画用 */
  colorAt(x, z, out = new THREE.Color(), y = this.height(x, z), slope = this.slopeAt(x, z, y)) {
    const n = fbm(x * 0.09, z * 0.09, 7, 3);
    const m = fbm(x * 0.021 + 40, z * 0.021, 13, 2);
    out.copy(C.grassA).lerp(C.grassB, n).lerp(C.grassC, ss(m, 0.55, 0.75) * 0.7);
    out.lerp(C.dirt, ss(slope, 0.025, 0.07) * 0.85);
    out.lerp(C.rock, ss(slope, 0.06, 0.14));
    out.lerp(C.rock, ss(y, 9, 15));
    out.lerp(C.snow, ss(y, 17, 23));
    const wl = this.waterLevel;
    out.lerp(C.sand, ss(y, wl + 0.9, wl + 0.15));
    out.lerp(C.wet, ss(y, wl + 0.05, wl - 0.8));
    return out;
  }

  /** テクスチャ合成用のブレンド重み: [草, 土, 岩, 砂] と [雪, 濡れ] */
  splatAt(x, z, y, slope, w = new Float32Array(6)) {
    const wl = this.waterLevel;
    const m = fbm(x * 0.021 + 40, z * 0.021, 13, 2);
    const sand = ss(y, wl + 0.9, wl + 0.15);
    const rock = Math.max(ss(slope, 0.06, 0.14), ss(y, 9, 15)) * (1 - sand);
    const dirt = Math.min(1, ss(slope, 0.025, 0.07) + ss(m, 0.6, 0.8) * 0.65) * (1 - rock) * (1 - sand);
    w[0] = Math.max(0, 1 - dirt - rock - sand); w[1] = dirt; w[2] = rock; w[3] = sand;
    w[4] = ss(y, 17, 23); w[5] = ss(y, wl + 0.05, wl - 0.8);
    return w;
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
    buildProps(this, this.assets, this.quality);
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
    const G = this.assets?.ground;
    const pbr = !!(G && G.grassD && G.dirtD && G.rockD && G.sandD);
    const splat = new Float32Array(pos.count * 4), misc = new Float32Array(pos.count * 2), w = new Float32Array(6);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i);
      if (pbr) {
        const slope = this.slopeAt(x, z, y);
        this.splatAt(x, z, y, slope, w);
        splat.set(w.subarray(0, 4), i * 4); misc.set(w.subarray(4, 6), i * 2);
        // 草の色味のばらつき (テクスチャに乗算するティント)
        const n = fbm(x * 0.07, z * 0.07, 7, 3), m = fbm(x * 0.021 + 40, z * 0.021, 13, 2);
        tmp.setRGB(0.5 + n * 0.2 - m * 0.12, 0.84 + n * 0.22 - m * 0.1, 0.44 + n * 0.1);
      } else this.colorAt(x, z, tmp, y);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    let mat;
    if (pbr) {
      geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
      geo.setAttribute('aMisc', new THREE.BufferAttribute(misc, 2));
      mat = this._pbrMaterial(G);
    } else mat = this._fallbackMaterial();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.groundMesh = mesh;
  }

  /** アセット不要の簡易マテリアル (頂点カラー + 手続きディテール) */
  _fallbackMaterial() {
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
          diffuseColor.rgb *= 0.55 + 0.95 * (a * 0.4 + b * 0.35 + c * 0.25);
        }`);
    };
    return mat;
  }

  /**
   * PBR スプラットマテリアル: 草/土/岩/砂の写真テクスチャを頂点ウェイトで合成。
   * 岩はトライプレナー、草はタイリング抑制のため 2 スケールをブレンド。法線マップも反映。
   */
  _pbrMaterial(G) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        tGrassD: { value: G.grassD }, tGrassN: { value: G.grassN }, tDirtD: { value: G.dirtD },
        tRockD: { value: G.rockD }, tRockN: { value: G.rockN }, tSandD: { value: G.sandD },
      });
      shader.vertexShader = `
        attribute vec4 aSplat; attribute vec2 aMisc;
        varying vec4 vSplat; varying vec2 vMisc; varying vec3 vWPos; varying vec3 vWN;
      ` + shader.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vSplat = aSplat; vMisc = aMisc;`)
        .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
          vWN = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = `
        uniform sampler2D tGrassD, tGrassN, tDirtD, tRockD, tRockN, tSandD;
        varying vec4 vSplat; varying vec2 vMisc; varying vec3 vWPos; varying vec3 vWN;
        vec3 blend2(sampler2D t, vec2 p, float s){ return mix(texture2D(t, p * s).rgb, texture2D(t, p * s * 0.37 + vec2(0.31, 0.17)).rgb, 0.4); }
      ` + shader.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 p = vWPos.xz;
            vec3 an = pow(abs(normalize(vWN)), vec3(4.0)); an /= (an.x + an.y + an.z);
            vec3 g = blend2(tGrassD, p, 0.30) * vColor;
            vec3 d = blend2(tDirtD, p, 0.16);
            vec3 r = texture2D(tRockD, vWPos.zy * 0.14).rgb * an.x + texture2D(tRockD, vWPos.xz * 0.14).rgb * an.y + texture2D(tRockD, vWPos.xy * 0.14).rgb * an.z;
            vec3 sd = blend2(tSandD, p, 0.2);
            vec3 alb = g * vSplat.x + d * vSplat.y + r * vSplat.z + sd * vSplat.w;
            alb = mix(alb, vec3(0.9, 0.94, 1.0), vMisc.x);
            alb *= mix(1.0, 0.5, vMisc.y);
            diffuseColor.rgb = alb;
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            vec2 np = vWPos.xz;
            vec3 ng = mix(texture2D(tGrassN, np * 0.30).xyz, texture2D(tGrassN, np * 0.111 + vec2(0.31, 0.17)).xyz, 0.4) * 2.0 - 1.0;
            vec3 nr = texture2D(tRockN, vWPos.xz * 0.14).xyz * 2.0 - 1.0;
            vec3 nm = ng * (vSplat.x + vSplat.y * 0.8 + vSplat.w * 0.4) + nr * vSplat.z;
            vec3 wn = normalize(vWN + vec3(nm.x, 0.0, -nm.y) * 0.85);
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          }`);
    };
    return mat;
  }
}
