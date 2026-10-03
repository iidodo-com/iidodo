import * as THREE from 'three';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0, ...o });
const outlineMat = new THREE.MeshBasicMaterial({ color: '#0d1220', side: THREE.BackSide });

function add(parent, geo, mat, x = 0, y = 0, z = 0, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (o.s) m.scale.set(...o.s);
  if (o.r) m.rotation.set(...o.r);
  m.castShadow = true;
  if (o.out) m.add(new THREE.Mesh(geo, outlineMat)).scale.setScalar(1 + o.out);
  parent.add(m);
  return m;
}

/** 戻り値: { root, mats (被弾フラッシュ用), parts, height (HPバー位置) } */
export function buildEnemyModel(id, assets) {
  const builders = { gel: gel, goblin: goblin, wisp: wisp, brute: (a) => brute(a) };
  const m = (builders[id] || gel)(assets);
  m.mats = [];
  m.root.traverse((o) => { if (o.isMesh && o.material.emissive && o.material !== outlineMat && !o.material.userData.noFlash) m.mats.push(o.material); });
  return m;
}

function gel() {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const jelly = M('#5fe08a', { roughness: 0.15, transmission: 0.0, transparent: true, opacity: 0.88, emissive: '#0a3a1c', emissiveIntensity: 0.3 });
  add(body, new THREE.SphereGeometry(0.72, 24, 16), jelly, 0, 0.55, 0, { s: [1, 0.82, 1], out: 0.04 });
  add(body, new THREE.SphereGeometry(0.28, 12, 10), M('#c8ffd8', { roughness: 0.1, transparent: true, opacity: 0.55 }), 0.2, 0.55, -0.05); // 核
  const eye = M('#10241a', { roughness: 0.1 });
  for (const s of [-1, 1]) {
    add(body, new THREE.SphereGeometry(0.09, 10, 8), eye, s * 0.24, 0.78, 0.6);
    add(body, new THREE.SphereGeometry(0.03, 6, 6), new THREE.MeshBasicMaterial({ color: '#fff' }), s * 0.22, 0.82, 0.67);
  }
  return { root, parts: { body }, height: 1.5 };
}

function goblin() {
  const root = new THREE.Group();
  const rig = new THREE.Group(); rig.position.y = 0.62; root.add(rig);
  const skin = M('#6fae4a', { roughness: 0.6 }), cloth = M('#6b4a2c'), dark = M('#2b2118'), wood = M('#7a5530');
  add(rig, new THREE.CapsuleGeometry(0.2, 0.25, 4, 12), cloth, 0, 0.12, 0, { s: [1, 1, 0.85], out: 0.05 });
  const head = new THREE.Group(); head.position.y = 0.62; rig.add(head);
  add(head, new THREE.SphereGeometry(0.21, 16, 12), skin, 0, 0, 0, { s: [1.1, 1, 1], out: 0.05 });
  for (const s of [-1, 1]) {
    add(head, new THREE.ConeGeometry(0.07, 0.34, 6), skin, s * 0.27, 0.02, -0.02, { r: [0, 0, -s * 1.35] });
    add(head, new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd23a').multiplyScalar(2) }), s * 0.09, 0.03, 0.18);
  }
  add(head, new THREE.ConeGeometry(0.06, 0.14, 6), skin, 0, -0.03, 0.2, { r: [Math.PI / 2, 0, 0] });
  const legs = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(s * 0.1, -0.08, 0); add(g, new THREE.CapsuleGeometry(0.07, 0.3, 4, 8), dark, 0, -0.22, 0); rig.add(g); return g; });
  const armL = new THREE.Group(); armL.position.set(-0.26, 0.3, 0); add(armL, new THREE.CapsuleGeometry(0.06, 0.28, 4, 8), skin, 0, -0.18, 0); rig.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.26, 0.3, 0); armR.rotation.order = 'YXZ'; rig.add(armR);
  add(armR, new THREE.CapsuleGeometry(0.06, 0.26, 4, 8), skin, 0, -0.17, 0);
  const club = add(armR, new THREE.CylinderGeometry(0.07, 0.13, 0.75, 8), wood, 0, -0.42, 0.14, { r: [0.5, 0, 0] });
  add(club, new THREE.SphereGeometry(0.03, 6, 6), dark, 0.1, 0.1, 0);
  return { root, parts: { rig, legs, armL, armR, head }, height: 1.7 };
}

function wisp() {
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const robe = M('#3c2a6e', { roughness: 0.7, side: THREE.DoubleSide });
  add(rig, new THREE.ConeGeometry(0.42, 1.0, 14, 1, true), robe, 0, 0.5, 0, { out: 0.03 });
  add(rig, new THREE.SphereGeometry(0.2, 14, 10), M('#e9d9ff', { roughness: 0.4 }), 0, 1.12, 0);
  add(rig, new THREE.ConeGeometry(0.3, 0.35, 10), robe, 0, 1.32, 0);
  for (const s of [-1, 1]) add(rig, new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6af0').multiplyScalar(2.5) }), s * 0.08, 1.14, 0.17);
  const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c27bff').multiplyScalar(3) }); orbMat.userData.noFlash = true;
  const orb = add(rig, new THREE.SphereGeometry(0.17, 14, 10), orbMat, 0.5, 0.95, 0.25);
  return { root, parts: { rig, orb }, height: 2.0 };
}

function brute(assets) {
  const root = new THREE.Group();
  const rig = new THREE.Group(); rig.position.y = 1.3; root.add(rig);
  const rockTex = assets?.ground?.rockD;
  const stone = rockTex ? M('#a79c8e', { map: rockTex, roughness: 0.95 }) : M('#8a8478', { roughness: 0.95, flatShading: true });
  const moss = M('#4d7a35', { roughness: 0.9 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2a').multiplyScalar(3) }); glow.userData.noFlash = true;
  add(rig, new THREE.DodecahedronGeometry(0.85, 1), stone, 0, 0.2, 0, { s: [1.15, 1.2, 0.9], out: 0.03 });
  add(rig, new THREE.DodecahedronGeometry(0.45, 1), stone, 0, 1.15, 0.1, { s: [1, 0.9, 1], out: 0.04 });
  add(rig, new THREE.SphereGeometry(0.38, 10, 8), moss, -0.3, 0.9, -0.3, { s: [1.3, 0.5, 1.3] });
  for (const s of [-1, 1]) add(rig, new THREE.SphereGeometry(0.07, 8, 6), glow, s * 0.17, 1.2, 0.5);
  add(rig, new THREE.SphereGeometry(0.2, 10, 8), glow, 0, 0.35, 0.72, { s: [1, 1, 0.4] }); // 胸の核
  const legs = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(s * 0.45, -0.55, 0); add(g, new THREE.DodecahedronGeometry(0.4, 0), stone, 0, -0.35, 0, { s: [1, 1.5, 1] }); rig.add(g); return g; });
  const mkArm = (s) => { const g = new THREE.Group(); g.position.set(s * 1.05, 0.65, 0); g.rotation.order = 'YXZ';
    add(g, new THREE.DodecahedronGeometry(0.38, 1), stone, 0, -0.55, 0, { s: [1, 1.7, 1], out: 0.03 });
    add(g, new THREE.DodecahedronGeometry(0.5, 1), stone, 0, -1.25, 0.05, { out: 0.03 });
    rig.add(g); return g; };
  const armL = mkArm(-1), armR = mkArm(1);
  return { root, parts: { rig, legs, armL, armR }, height: 3.6 };
}
