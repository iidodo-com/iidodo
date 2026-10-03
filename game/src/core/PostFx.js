import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// リニアHDR空間でのカラーグレード: 彩度・暖色ティント・ビネット
const Grade = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.14 },
    uVig: { value: 0.38 },
    uTint: { value: new THREE.Vector3(1.04, 1.0, 0.95) },
    uPulse: { value: 0 }, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Vector3(1, 1, 1) }, uLines: { value: 0 }, uSlow: { value: 0 }, uTime: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat; uniform float uVig; uniform vec3 uTint; varying vec2 vUv;
    uniform float uPulse; uniform float uFlash; uniform vec3 uFlashCol; uniform float uLines; uniform float uSlow; uniform float uTime;
    float hash(float n){ return fract(sin(n * 91.345) * 47453.5453); }
    void main(){
      vec2 dd = vUv - 0.5;
      vec4 c;
      if (uPulse > 0.002) {
        // 放射ブラー + 色収差 (ヒット/回避の衝撃)
        float k = uPulse * (0.25 + length(dd) * 1.4);
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 5; i++) acc += texture2D(tDiffuse, vUv - dd * k * 0.055 * float(i)).rgb;
        acc /= 5.0;
        float r = texture2D(tDiffuse, vUv - dd * k * 0.05).r;
        float b = texture2D(tDiffuse, vUv + dd * k * 0.05).b;
        c = vec4(vec3(r, acc.g, b) * 0.5 + acc * 0.5, 1.0);
      } else c = texture2D(tDiffuse, vUv);
      if (uLines > 0.01) {
        float a = atan(dd.y, dd.x), rr = length(dd);
        float n = hash(floor(a * 70.0) + floor(uTime * 22.0));
        float ln = step(0.8, n) * smoothstep(0.22, 0.75, rr);
        c.rgb += vec3(0.85, 0.95, 1.0) * ln * uLines * 0.6;
      }
      if (uSlow > 0.01) {
        float ls = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
        c.rgb = mix(c.rgb, vec3(ls) * vec3(0.72, 0.95, 1.3), uSlow * 0.55);
        c.rgb *= 1.0 - uSlow * 0.35 * smoothstep(0.2, 0.8, length(dd));
      }
      c.rgb += uFlashCol * uFlash;
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat) * uTint;
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.9);
      float v = smoothstep(0.9, 0.22, length(d));
      c.rgb *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = c;
    }`,
};

export class PostFx {
  constructor(renderer, scene, camera, q) {
    const size = renderer.getSize(new THREE.Vector2());
    const dpr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(size.x * dpr, size.y * dpr, { type: THREE.HalfFloatType, samples: q.msaa });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(dpr);
    this.composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      // 接地影 (木の根元・岩の足元の暗がり)。高画質のみ。
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.ao.blendIntensity = 0.9;
      this.composer.addPass(this.ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), q.bloom, 0.6, 2.2);
    this.composer.addPass(this.bloom);
    this.gradePass = new ShaderPass(Grade); this.fx = this.gradePass.uniforms;
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass()); // ACES トーンマッピング + sRGB 変換
  }
  setSize(w, h, dpr) { this.composer.setPixelRatio(dpr); this.composer.setSize(w, h); }
  render(dt) { this.composer.render(dt); }
}
