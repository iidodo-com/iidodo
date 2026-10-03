import * as THREE from 'three';
import { TIME } from '../world/Wind.js';
import { PX } from './Particles.js';

/** プレイヤー周辺を漂う光の粒 (花粉/精霊)。GPU 側でプレイヤー周りをトーラス状にラップする。 */
export class Ambient {
  constructor(scene, count = 140) {
    const g = new THREE.BufferGeometry();
    const seed = new Float32Array(count * 4);
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = { uTime: TIME, uCenter: { value: new THREE.Vector3() }, uPx: PX };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute vec4 aSeed; uniform float uTime; uniform vec3 uCenter; uniform float uPx; varying float vA;
        void main(){
          const float R = 34.0;
          vec3 p = vec3((aSeed.x * 2.0 - 1.0) * R, 0.0, (aSeed.y * 2.0 - 1.0) * R);
          p.xz += vec2(sin(uTime * 0.3 + aSeed.z * 20.0), cos(uTime * 0.27 + aSeed.w * 20.0)) * 1.5 + vec2(uTime * 0.35, uTime * 0.12);
          p.xz = mod(p.xz - uCenter.xz + R, 2.0 * R) - R + uCenter.xz;
          p.y = uCenter.y + 0.4 + aSeed.w * 4.5 + sin(uTime * 0.8 + aSeed.z * 30.0) * 0.5;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float tw = 0.55 + 0.45 * sin(uTime * 2.0 + aSeed.z * 40.0);
          vA = tw * smoothstep(R, R * 0.6, length(p.xz - uCenter.xz));
          gl_PointSize = (0.07 + aSeed.z * 0.07) * uPx / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `varying float vA; void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a;
        gl_FragColor = vec4(vec3(4.0, 3.4, 1.8), a * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  update(playerPos) { this.uniforms.uCenter.value.copy(playerPos); }
}
