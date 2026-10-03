import * as THREE from 'three';

/** 剣の軌跡リボン。刃の根元と切先のワールド座標を毎フレーム記録して帯にする。 */
export class SwordTrail {
  constructor(scene, N = 22) {
    this.N = N;
    this.samples = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3);
    this.age = new Float32Array(N * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float aAge; varying float vA; varying float vE; void main(){ vA = 1.0 - aAge; vE = mod(float(gl_VertexID), 2.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying float vA; varying float vE; void main(){
        vec3 c = mix(vec3(0.7, 1.8, 3.5), vec3(3.0, 3.6, 4.0), vE);
        gl_FragColor = vec4(c, vA * vA * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  /** recording 中は刃の位置を記録、止めたら尾を縮めて消す */
  update(sword, recording, baseZ = 0.6, tipZ = 1.72) {
    if (recording) {
      sword.updateWorldMatrix(true, false);
      this._a.set(0, 0, baseZ); this._b.set(0, 0, tipZ);
      sword.localToWorld(this._a); sword.localToWorld(this._b);
      this.samples.unshift([this._a.clone(), this._b.clone()]);
      if (this.samples.length > this.N) this.samples.pop();
    } else if (this.samples.length) {
      this.samples.pop(); if (this.samples.length) this.samples.pop();
    }
    const s = this.samples;
    this.mesh.visible = s.length >= 2;
    if (!this.mesh.visible) return;
    for (let i = 0; i < this.N; i++) {
      const [a, b] = s[Math.min(i, s.length - 1)];
      this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
      const t = i >= s.length ? 1 : i / (this.N - 1);
      this.age[i * 2] = this.age[i * 2 + 1] = t;
    }
    const at = this.mesh.geometry.attributes;
    at.position.needsUpdate = at.aAge.needsUpdate = true;
  }
}
