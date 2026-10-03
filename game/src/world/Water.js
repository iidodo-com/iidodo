import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { TIME } from './Wind.js';

/**
 * 湖・池の水面。地形と同じ分割の板に「水深」を頂点属性として持たせ、
 * 浅瀬の透明化・岸辺の泡・フレネル反射・太陽のきらめきをシェーダで描く。
 */
export function createWater(scene, terrain, sunDir, colors = {}) {
  const { size, segments } = CONFIG.world;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const depth = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) depth[i] = terrain.waterLevel - terrain.height(pos.getX(i), pos.getZ(i));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSun: { value: sunDir.clone() },
      uShallow: { value: new THREE.Color('#5fd0c8') }, uDeep: { value: new THREE.Color('#0c4f86') },
      uHorizon: { value: (colors.horizon || new THREE.Color('#b4d2ee')).clone() }, uZenith: { value: (colors.zenith || new THREE.Color('#4f8fd8')).clone() },
      uLevel: { value: terrain.waterLevel },
    }]),
    vertexShader: `
      attribute float aDepth; varying float vDepth; varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){
        vDepth = aDepth;
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y = ${terrain.waterLevel.toFixed(3)};
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uSun, uShallow, uDeep, uHorizon, uZenith;
      varying float vDepth; varying vec3 vW;
      #include <fog_pars_fragment>
      void wave(inout vec2 g, vec2 p, vec2 dir, float freq, float speed, float amp){
        float ph = dot(dir, p) * freq + uTime * speed;
        g += dir * cos(ph) * freq * amp;
      }
      void main(){
        vec2 p = vW.xz;
        vec2 g = vec2(0.0);
        wave(g, p, normalize(vec2(1.0, 0.4)), 0.9, 1.3, 0.030);
        wave(g, p, normalize(vec2(-0.6, 1.0)), 1.7, 1.9, 0.020);
        wave(g, p, normalize(vec2(0.3, -1.0)), 3.4, 2.6, 0.012);
        wave(g, p, normalize(vec2(-1.0, -0.2)), 6.8, 3.4, 0.006);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 V = normalize(cameraPosition - vW);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 R = reflect(-V, n);
        vec3 sky = mix(uHorizon, uZenith, clamp(R.y * 1.4, 0.0, 1.0));
        vec3 body = mix(uShallow, uDeep, smoothstep(0.1, 2.4, vDepth));
        vec3 col = mix(body, sky, clamp(fres, 0.0, 1.0));
        float spec = pow(max(dot(R, normalize(uSun)), 0.0), 220.0) * 6.0;
        col += vec3(1.0, 0.95, 0.85) * spec;
        float foamBand = 1.0 - smoothstep(0.0, 0.28, vDepth + 0.05 * sin(uTime * 1.6 + p.x * 2.3 + p.y * 1.7));
        float foamNoise = 0.55 + 0.45 * sin(p.x * 5.0 + uTime * 0.8) * sin(p.y * 4.3 - uTime * 0.6);
        col = mix(col, vec3(1.0), foamBand * foamNoise * 0.75);
        float alpha = smoothstep(0.0, 0.3, vDepth) * mix(0.72, 0.97, smoothstep(0.2, 2.0, vDepth));
        alpha = max(alpha, foamBand * 0.6 * step(0.0, vDepth + 0.06));
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = TIME;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}
