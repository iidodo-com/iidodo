import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// リニアHDR空間でのカラーグレード: 彩度・暖色ティント・ビネット
const Grade = {
  uniforms: {
    tDiffuse: { value: null },
    uSat: { value: 1.14 },
    uVig: { value: 0.38 },
    uTint: { value: new THREE.Vector3(1.04, 1.0, 0.95) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat; uniform float uVig; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
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
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), q.bloom, 0.6, 2.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(Grade));
    this.composer.addPass(new OutputPass()); // ACES トーンマッピング + sRGB 変換
  }
  setSize(w, h, dpr) { this.composer.setPixelRatio(dpr); this.composer.setSize(w, h); }
  render(dt) { this.composer.render(dt); }
}
