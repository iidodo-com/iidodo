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
export function buildEnemyModel(def, assets) {
  const builders = { gel, goblin, wisp, brute, bat, sentry, pylon, archon };
  const m = (builders[def.model] || gel)(assets);
  const tint = def.tint ? new THREE.Color(def.tint) : null;
  m.mats = [];
  m.root.traverse((o) => {
    if (!o.isMesh || o.material === outlineMat || o.material.userData.noFlash || !o.material.emissive) return;
    if (tint && !o.material.userData.tinted) { o.material.color.multiply(tint); o.material.userData.tinted = true; }
    if (def.metal && o.material.metalness !== undefined) { o.material.metalness = Math.max(o.material.metalness, 0.7); o.material.roughness = Math.min(o.material.roughness, 0.45); }
    m.mats.push(o.material);
  });
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
  const rockTex = assets?.tex?.rock?.d;
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

function bat() {
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const fur = M('#4a4a66', { roughness: 0.8 });
  add(rig, new THREE.SphereGeometry(0.32, 14, 10), fur, 0, 0, 0, { s: [1, 0.9, 1.2], out: 0.05 });
  add(rig, new THREE.SphereGeometry(0.22, 12, 10), fur, 0, 0.08, 0.34, { out: 0.05 });
  for (const s of [-1, 1]) {
    add(rig, new THREE.ConeGeometry(0.07, 0.22, 5), fur, s * 0.14, 0.3, 0.32, { r: [0, 0, -s * 0.2] });
    add(rig, new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a6a').multiplyScalar(2.5) }), s * 0.09, 0.12, 0.52);
  }
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.lineTo(1.1, 0.35); wingShape.lineTo(1.5, -0.1); wingShape.lineTo(1.1, -0.15); wingShape.lineTo(0.8, -0.4); wingShape.lineTo(0.4, -0.2); wingShape.closePath();
  const wingGeo = new THREE.ShapeGeometry(wingShape); wingGeo.rotateX(-Math.PI / 2);
  const wingMat = M('#3a3a58', { roughness: 0.9, side: THREE.DoubleSide });
  const wingL = new THREE.Group(), wingR = new THREE.Group();
  const wl = add(wingL, wingGeo, wingMat); wl.scale.x = -1;
  add(wingR, wingGeo, wingMat);
  wingL.position.set(-0.2, 0.05, 0); wingR.position.set(0.2, 0.05, 0);
  rig.add(wingL, wingR);
  return { root, parts: { rig, wingL, wingR }, height: 1.1 };
}

function sentry() {
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const metal = M('#9aa8b4', { roughness: 0.35, metalness: 0.85 });
  const dark = M('#2c333a', { roughness: 0.5, metalness: 0.8 });
  add(rig, new THREE.SphereGeometry(0.5, 20, 14), metal, 0, 1.0, 0, { out: 0.04 });
  const ring = new THREE.Group(); ring.position.y = 1.0; rig.add(ring);
  add(ring, new THREE.TorusGeometry(0.75, 0.07, 8, 28), dark, 0, 0, 0, { r: [Math.PI / 2, 0, 0] });
  for (const a of [0, 2.1, 4.2]) add(ring, new THREE.BoxGeometry(0.1, 0.1, 0.3), dark, Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a3a').multiplyScalar(3) }); eyeMat.userData.noFlash = true;
  const eye = add(rig, new THREE.SphereGeometry(0.2, 12, 10), eyeMat, 0, 1.0, 0.38);
  add(rig, new THREE.ConeGeometry(0.16, 0.5, 6), dark, 0, 0.45, 0, { r: [Math.PI, 0, 0] });
  return { root, parts: { rig, ring, eye }, height: 2.4 };
}

function pylon() {
  const root = new THREE.Group();
  const rig = new THREE.Group(); root.add(rig);
  const dark = M('#2d3640', { roughness: 0.45, metalness: 0.85 });
  add(rig, new THREE.CylinderGeometry(0.9, 1.15, 0.7, 8), dark, 0, 0.35, 0, { out: 0.03 });
  add(rig, new THREE.CylinderGeometry(0.3, 0.45, 1.6, 8), dark, 0, 1.4, 0);
  const crystalMat = M('#3acfff', { roughness: 0.15, emissive: '#2fc0ff', emissiveIntensity: 2.5, flatShading: true });
  const crystal = add(rig, new THREE.OctahedronGeometry(0.65, 0), crystalMat, 0, 2.7, 0, { s: [0.8, 1.5, 0.8] });
  const halo = add(rig, new THREE.TorusGeometry(0.85, 0.05, 8, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color('#6af0ff').multiplyScalar(3) }), 0, 2.7, 0, { r: [Math.PI / 2, 0, 0] });
  halo.material.userData.noFlash = true;
  return { root, parts: { rig, crystal, halo }, height: 3.8 };
}

/** 終焉の王: 黒紫の鎧 + 大剣 + 輝く核。第2形態で翼と光輪が現れる (parts.wings / parts.halo は初期は非表示) */
function archon() {
  const root = new THREE.Group();
  const rig = new THREE.Group(); rig.position.y = 1.15; root.add(rig);
  const armor = M('#2a2038', { roughness: 0.35, metalness: 0.85 });
  const trim = M('#c9a14a', { roughness: 0.3, metalness: 0.95 });
  const cape = M('#4a1a5a', { roughness: 0.8, side: THREE.DoubleSide });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a7a').multiplyScalar(3) }); glow.userData.noFlash = true;
  add(rig, new THREE.CapsuleGeometry(0.36, 0.5, 6, 16), armor, 0, 0.3, 0, { s: [1.15, 1, 0.9], out: 0.03 });
  add(rig, new THREE.SphereGeometry(0.34, 16, 12), trim, 0, 0.5, 0.12, { s: [1.2, 0.6, 0.7] });
  add(rig, new THREE.SphereGeometry(0.13, 12, 10), glow, 0, 0.42, 0.34);                    // 胸の核
  const head = new THREE.Group(); head.position.y = 1.12; rig.add(head);
  add(head, new THREE.SphereGeometry(0.27, 16, 12), armor, 0, 0, 0, { s: [1, 1.12, 1], out: 0.04 });
  add(head, new THREE.BoxGeometry(0.34, 0.07, 0.1), glow, 0, 0.03, 0.24);                   // 目の光
  for (let i = -2; i <= 2; i++) add(head, new THREE.ConeGeometry(0.06, 0.38 - Math.abs(i) * 0.06, 5), trim, i * 0.12, 0.34, -0.02, { r: [0, 0, -i * 0.18] });  // 王冠
  // 脚
  const legs = [-1, 1].map((sx) => { const g = new THREE.Group(); g.position.set(sx * 0.2, -0.32, 0); add(g, new THREE.CapsuleGeometry(0.15, 0.55, 4, 10), armor, 0, -0.42, 0, { out: 0.03 }); add(g, new THREE.BoxGeometry(0.3, 0.12, 0.45), trim, 0, -0.9, 0.08); rig.add(g); return g; });
  // 左腕 / 右腕 (大剣)
  const armL = new THREE.Group(); armL.position.set(-0.62, 0.78, 0); add(armL, new THREE.CapsuleGeometry(0.13, 0.5, 4, 10), armor, 0, -0.35, 0, { out: 0.03 }); add(armL, new THREE.SphereGeometry(0.26, 12, 10), trim, -0.04, 0.06, 0, { s: [1, 0.7, 1] }); rig.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.62, 0.78, 0); armR.rotation.order = 'YXZ'; rig.add(armR);
  add(armR, new THREE.CapsuleGeometry(0.13, 0.5, 4, 10), armor, 0, -0.35, 0, { out: 0.03 }); add(armR, new THREE.SphereGeometry(0.26, 12, 10), trim, 0.04, 0.06, 0, { s: [1, 0.7, 1] });
  const swordMat = M('#d8d0ff', { metalness: 0.9, roughness: 0.2, emissive: '#7a3aff', emissiveIntensity: 0.9 });
  const sw = add(armR, new THREE.BoxGeometry(0.16, 2.3, 0.05), swordMat, 0, -1.7, 0.2, { r: [0.4, 0, 0] });
  add(sw, new THREE.BoxGeometry(0.7, 0.1, 0.14), trim, 0, 1.2, 0);
  // マント
  const capeG = new THREE.PlaneGeometry(1.2, 1.9, 1, 3); capeG.translate(0, -0.95, 0);
  const cp = add(rig, capeG, cape, 0, 1.05, -0.4);
  // 第2形態: 翼と光輪 (初期非表示)
  const wings = new THREE.Group(); wings.visible = false; rig.add(wings);
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0); wingShape.bezierCurveTo(1.2, 1.4, 3.0, 1.8, 3.9, 0.6); wingShape.lineTo(3.2, 0.5); wingShape.lineTo(3.4, -0.2); wingShape.lineTo(2.4, -0.1); wingShape.lineTo(2.2, -0.8); wingShape.lineTo(1.2, -0.4); wingShape.closePath();
  const wingMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#b06aff').multiplyScalar(2.4), transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }); wingMat.userData.noFlash = true;
  const wgL = new THREE.Group(), wgR = new THREE.Group();
  const wl = new THREE.Mesh(new THREE.ShapeGeometry(wingShape), wingMat); wl.scale.x = -1; wgL.add(wl);
  wgR.add(new THREE.Mesh(new THREE.ShapeGeometry(wingShape), wingMat));
  wgL.position.set(-0.3, 1.0, -0.4); wgR.position.set(0.3, 1.0, -0.4); wings.add(wgL, wgR);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(3) }));
  halo.material.userData.noFlash = true; halo.position.set(0, 1.9, -0.1); halo.rotation.x = Math.PI / 2.4; halo.visible = false; rig.add(halo);
  return { root, parts: { rig, legs, armL, armR, head, wings, wgL, wgR, halo, cape: cp }, height: 3.4 };
}
