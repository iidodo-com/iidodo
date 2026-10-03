import * as THREE from 'three';

/** グラデーションの空ドーム + フォグ色合わせ */
export function createSky(scene) {
  const top = new THREE.Color('#2f6fc4'), horizon = new THREE.Color('#bcdcf2');
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: top }, horizon: { value: horizon } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float t = pow(max(vP.y,0.0),0.6); gl_FragColor = vec4(mix(horizon, top, t),1.0); }',
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), mat);
  dome.renderOrder = -1;
  scene.add(dome);
  scene.fog = new THREE.Fog(horizon.clone(), 60, 210);
  return dome;
}
