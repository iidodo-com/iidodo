import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { TIME } from './Wind.js';

/** 大気散乱スカイ + 流れる雲 + 遠景に溶けるフォグ */
export function createSky(scene, sunDir) {
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const u = sky.material.uniforms;
  u.turbidity.value = 5;
  u.rayleigh.value = 3.2;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  scene.fog = new THREE.FogExp2(new THREE.Color('#9dbfe6'), 0.0042);

  // 雲レイヤー: カメラに追従する大きな板に fbm ノイズ
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: TIME, uSun: { value: sunDir.clone() } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec2(7.1,3.3); a*=.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.0016 + vec2(uTime * 0.004, uTime * 0.0015);
        float d = fbm(p);
        float cov = smoothstep(0.50, 0.78, d);
        float lit = fbm(p + vec2(0.04, 0.03));
        float shade = clamp(0.5 + (d - lit) * 5.0, 0.0, 1.0);
        vec3 col = mix(vec3(0.78, 0.84, 0.95), vec3(2.2, 2.1, 1.95), shade);
        float dist = length(vW.xz - cameraPosition.xz);
        float fade = smoothstep(900.0, 250.0, dist);
        gl_FragColor = vec4(col, cov * fade * 0.9);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 260;
  clouds.renderOrder = -1;
  clouds.frustumCulled = false;
  scene.add(clouds);

  return {
    sky, clouds,
    update(camPos) { clouds.position.x = camPos.x; clouds.position.z = camPos.z; },
  };
}


/** 空中城の足元に広がる雲海 (カメラ追従の板)。darker=false で明るい白い雲 */
export function createCloudSea(scene, y = -18) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime: TIME },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `
      uniform float uTime; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p=p*2.03+vec2(7.1,3.3); a*=.5; } return s; }
      void main(){
        vec2 p = vW.xz * 0.006 + vec2(uTime * 0.01, uTime * 0.004);
        float d = fbm(p), lit = fbm(p + vec2(0.05, 0.04));
        float shade = clamp(0.55 + (d - lit) * 4.0, 0.0, 1.0);
        vec3 col = mix(vec3(0.62, 0.7, 0.86), vec3(2.3, 2.25, 2.2), shade);
        float dist = length(vW.xz - cameraPosition.xz);
        float a = smoothstep(0.28, 0.6, d) * smoothstep(1100.0, 300.0, dist);
        gl_FragColor = vec4(col, 0.35 + a * 0.6);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.frustumCulled = false; m.renderOrder = -1; m.visible = false;
  scene.add(m);
  return m;
}
