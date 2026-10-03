import * as THREE from 'three';

/**
 * 攻撃予兆の赤い床マーカー (扇形/円)。fill (0→1) が外側へ広がり、満ちた瞬間に攻撃が当たる。
 * 角度 arc は半角。arc=π で全周 (円)。
 */
export class Telegraph {
  constructor(scene, terrain) {
    this.scene = scene; this.terrain = terrain;
    const geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-Math.PI / 2);
    this.geo = geo;
    this.pool = [];
  }

  _make() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      uniforms: { uArc: { value: 1 }, uFill: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform float uArc; uniform float uFill; varying vec2 vP;
        void main(){
          float r = length(vP);
          float ang = abs(atan(vP.x, vP.y));
          if (r > 1.0 || (uArc < 3.1 && ang > uArc)) discard;
          float edge = smoothstep(0.93, 1.0, r) + (uArc < 3.1 ? smoothstep(uArc - 0.04, uArc, ang) : 0.0);
          float filled = step(r, uFill);
          vec3 col = mix(vec3(1.6, 0.12, 0.08), vec3(3.2, 0.5, 0.25), filled);
          float a = 0.22 + filled * 0.28 + edge * 0.6;
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.renderOrder = 6; mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  /** 表示開始。戻り値のハンドルで fill 更新 / 消去 */
  show({ x, z, dir = 0, range, arc = Math.PI }) {
    const mesh = this.pool.pop() || this._make();
    mesh.visible = true;
    mesh.position.set(x, this.terrain.height(x, z) + 0.15, z);
    mesh.rotation.y = dir;
    mesh.scale.setScalar(range);
    mesh.material.uniforms.uArc.value = arc;
    mesh.material.uniforms.uFill.value = 0;
    return {
      setFill: (f) => { mesh.material.uniforms.uFill.value = f; },
      setPos: (px, pz, d) => { mesh.position.set(px, this.terrain.height(px, pz) + 0.15, pz); if (d !== undefined) mesh.rotation.y = d; },
      remove: () => { mesh.visible = false; this.pool.push(mesh); },
    };
  }
}
