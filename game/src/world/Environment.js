import * as THREE from 'three';
import { analyzeHdri } from '../core/Assets.js';
import { createSky } from './Sky.js';

/**
 * 空と環境光。HDRI があれば「背景 + IBL(反射/環境光) + 太陽方向 + フォグ色」をすべて HDRI から決める。
 * 無ければ手続き的な大気スカイにフォールバック。
 */
export function createEnvironment(scene, renderer, assets) {
  const env = assets?.env;
  if (!env) {
    const sun = new THREE.Vector3(0.55, 0.62, 0.45).normalize();
    const sky = createSky(scene, sun);
    return { sunDir: sun, horizon: new THREE.Color('#b4d2ee'), zenith: new THREE.Color('#4f8fd8'), hdri: false, texture: null, update: (p) => sky.update(p) };
  }
  const info = analyzeHdri(env);
  env.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(env).texture;
  pm.dispose();
  scene.background = env;
  scene.backgroundIntensity = 1.0;
  scene.environmentIntensity = 0.85;
  // 太陽が低すぎる/不明な HDRI は安全な既定値に
  const sun = info.sun.y > 0.25 ? info.sun.clone().normalize() : new THREE.Vector3(0.5, 0.65, 0.4).normalize();
  const fog = info.horizon.clone().multiplyScalar(0.92);
  scene.fog = new THREE.FogExp2(fog, 0.0040);
  return { sunDir: sun, horizon: info.horizon, zenith: info.zenith, hdri: true, texture: env, update() {} };
}
