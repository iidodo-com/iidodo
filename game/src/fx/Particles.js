import * as THREE from 'three';

/** 画面解像度に依存しない点サイズ換算用 (Game._resize で更新) */
export const PX = { value: 700 };

const VS = `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  uniform float uPx; varying float vA; varying vec3 vC;
  void main(){
    vA = aAlpha; vC = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(aSize * uPx / max(-mv.z, 0.1), 0.0);
    gl_Position = projectionMatrix * mv;
  }`;
const FS = `
  varying float vA; varying vec3 vC;
  void main(){
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d); a *= a;
    gl_FragColor = vec4(vC, a * vA);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** CPU シミュレーションの小さなパーティクルプール。additive / normal を選べる。 */
export class ParticleSystem {
  constructor(scene, { max = 256, additive = false } = {}) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uPx: PX },
    });
    mat.uniforms.uPx = PX;
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit({ pos, vel, life = 0.6, size = 0.2, sizeEnd = 0, color = [1, 1, 1], gravity = 0, drag = 0 }) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.p.set([pos.x, pos.y, pos.z], i * 3);
    this.v.set([vel.x, vel.y, vel.z], i * 3);
    this.col.set(color, i * 3);
    this.life[i] = this.maxLife[i] = life;
    this.s0[i] = size; this.s1[i] = sizeEnd; this.grav[i] = gravity; this.drag[i] = drag;
  }

  update(dt) {
    for (let i = 0; i < this.n;) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._swapRemove(i); continue; }
      const k = 1 - this.life[i] / this.maxLife[i];
      const d = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= d; this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt; this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k;
      this.alpha[i] = (1 - k) * Math.min(1, k * 8);
      i++;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
  }

  _swapRemove(i) {
    const l = --this.n;
    if (i === l) { this.alpha[i] = 0; return; }
    const cp = (arr, w) => { for (let k = 0; k < w; k++) arr[i * w + k] = arr[l * w + k]; };
    cp(this.p, 3); cp(this.v, 3); cp(this.col, 3);
    for (const a of [this.size, this.alpha, this.life, this.maxLife, this.s0, this.s1, this.grav, this.drag]) a[i] = a[l];
  }
}
