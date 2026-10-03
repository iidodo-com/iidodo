import * as THREE from 'three';
import { AREAS } from '../data/areas.js';
import { itemInfo } from '../data/items.js';
import { TIME } from './Wind.js';
import { radialTexture } from './Props.js';

const rr = (a, b) => a + Math.random() * (b - a);

const portalMat = (color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uTime: TIME, uColor: { value: new THREE.Color(color) }, uOpen: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform float uTime; uniform vec3 uColor; uniform float uOpen; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c * vec2(1.0, 0.85)), a = atan(c.y, c.x);
      float edge = smoothstep(0.5, 0.3, abs(c.x)) * smoothstep(0.5, 0.35, abs(c.y));
      // 開: 渦巻く光 / 閉: 赤い縦線のバリア
      float sw = n(vec2(a * 2.0 + uTime * 0.8, r * 6.0 - uTime * 1.6)) * 0.8 + n(vec2(a * 5.0 - uTime, r * 12.0)) * 0.4;
      float openA = (0.35 + sw) * smoothstep(0.55, 0.0, r) * edge;
      float lines = smoothstep(0.55, 0.9, n(vec2(vUv.x * 22.0, vUv.y * 2.0 - uTime * 0.6))) * edge;
      vec3 col = mix(vec3(2.6, 0.25, 0.2), uColor * 2.4, uOpen);
      float al = mix(lines * 0.55, openA, uOpen);
      gl_FragColor = vec4(col, al);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

const stoneMat = (assets, color = '#cfc6b8') => new THREE.MeshStandardMaterial({ color, map: assets?.tex?.rock?.d || null, roughness: 0.9 });
const metal = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: 0.35, ...o });
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };

/**
 * エリア内のインタラクト可能オブジェクト一式 (セーブポイント / 回復の泉 / 宝箱 / 門 / レバー / 障壁)。
 * 状態は game.flags に保存され、エリアを出入りしても維持される。
 */
export class WorldObjects {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.list = [];            // update(dt) を持つオブジェクト
    this.inter = [];           // インタラクト対象 {x,z,y,radius,label(),use()}
    this.barrier = null; this.gate = null; this.entranceGate = null;
    this.target = null;
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse((c) => { if (c.isMesh) { c.geometry?.dispose?.(); if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.()); else c.material?.dispose?.(); } });
    }
    this.list = []; this.inter = []; this.barrier = null; this.gate = null; this.entranceGate = null; this.target = null;
    this.game.hud.setPrompt(null);
  }

  get f() { return this.game.flags; }
  _flag(group) { return (this.f[group] ||= {}); }

  build(area) {
    this.area = area;
    this._savepoint(area.savepoint);
    this._spring(area.spring);
    (area.chests || []).forEach((c) => this._chest(area, c));
    if (area.entrance) this.entranceGate = this._gate(area, area.entrance, true);
    this.gate = area.exit ? this._gate(area, area.exit, false) : { locked: false };
    (area.levers || []).forEach((l) => this._lever(area, l));
    if (area.barrier) this._barrier(area, area.barrier);
  }

  /** 地面に置く (座標 + 地形の高さ) */
  _at(obj, x, z, dy = 0) { obj.position.set(x, this.game.terrain.height(x, z) + dy, z); this.group.add(obj); return obj; }

  // ------------------------------------------------------------------ savepoint
  _savepoint({ x, z }) {
    const g = new THREE.Group();
    const stone = stoneMat(this.game.assets, '#bfc8d8');
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, 0.5, 20), stone); base.position.y = 0.25; base.castShadow = base.receiveShadow = true; g.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color('#6af0ff').multiplyScalar(3) })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.52; g.add(ring);
    const ring2 = ring.clone(); ring2.scale.setScalar(0.65); g.add(ring2);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: '#7fe8ff', emissive: '#2fd0ff', emissiveIntensity: 3, roughness: 0.1, flatShading: true }));
    crystal.scale.set(0.8, 1.4, 0.8); crystal.position.y = 1.9; crystal.castShadow = true; g.add(crystal);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color('#7fe8ff').multiplyScalar(1.4), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 4.5; g.add(beam);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: radialTexture('#7fe8ff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.08; g.add(glow);
    this._at(g, x, z);
    const gm = this.game;
    this.game.terrain.colliders.push({ x, z, r: 1.5 });
    this.list.push({ update: (dt) => { crystal.rotation.y += dt * 1.2; crystal.position.y = 1.9 + Math.sin(TIME.value * 2) * 0.12; ring.rotation.z += dt * 0.6; ring2.rotation.z -= dt * 0.9; if (Math.random() < dt * 8) gm.effects.sparks.emit({ pos: { x: x + rr(-1.1, 1.1), y: g.position.y + 0.3, z: z + rr(-1.1, 1.1) }, vel: { x: 0, y: rr(1, 2.4), z: 0 }, life: 1.2, size: 0.09, sizeEnd: 0, color: [1.2, 3, 4] }); } });
    this.inter.push({ x, z, y: g.position.y, radius: 3.4, label: () => 'セーブポイント', use: () => gm.menu.openSavepoint() });
  }

  // ------------------------------------------------------------------ spring
  _spring({ x, z }) {
    const gm = this.game, t = gm.terrain;
    const g = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.38, 8, 36), stoneMat(gm.assets, '#c8c0b2')); rim.rotation.x = Math.PI / 2; rim.position.y = 0.3; rim.castShadow = rim.receiveShadow = true; g.add(rim);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uTime: TIME, uReady: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; uniform float uReady; varying vec2 vUv;
        void main(){ vec2 c = vUv - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
          float rip = 0.5 + 0.5 * sin(r * 22.0 - uTime * 2.5);
          vec3 a = vec3(0.1, 0.7, 0.95), b = vec3(0.6, 1.0, 1.0);
          vec3 col = mix(a, b, rip * 0.5 + (1.0 - r) * 0.5) * mix(0.35, 1.6, uReady);
          gl_FragColor = vec4(col, 0.88);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const water = new THREE.Mesh(new THREE.CircleGeometry(3.0, 40), mat); water.rotation.x = -Math.PI / 2; water.position.y = 0.32; g.add(water);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), new THREE.MeshBasicMaterial({ map: radialTexture('#6af0d0'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 })); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.1; g.add(glow);
    this._at(g, x, z);
    let cd = 0;
    this.list.push({ update: (dt) => { cd = Math.max(0, cd - dt); mat.uniforms.uReady.value += ((cd > 0 ? 0 : 1) - mat.uniforms.uReady.value) * Math.min(1, dt * 3); if (cd <= 0 && Math.random() < dt * 10) gm.effects.sparks.emit({ pos: { x: x + rr(-2.4, 2.4), y: g.position.y + 0.4, z: z + rr(-2.4, 2.4) }, vel: { x: 0, y: rr(0.8, 2), z: 0 }, life: 1.4, size: 0.1, sizeEnd: 0, color: [0.8, 3.2, 2.8] }); } });
    this.inter.push({
      x, z, y: g.position.y, radius: 4.2,
      label: () => (cd > 0 ? '回復の泉 (回復中…)' : '回復の泉'),
      use: () => {
        const st = gm.player.stats;
        if (cd > 0) { gm.hud.toast('泉はまだ力を取り戻していない', 1400); return; }
        if (st.hp >= st.maxHp && st.mp >= st.maxMp) { gm.hud.toast('すでに万全だ', 1200); return; }
        st.hp = st.maxHp; st.mp = st.maxMp; cd = 25;
        gm.hud.toast('泉の力でHPとMPが全回復した', 1800);
        gm.bus.emit('player:healed');
        for (let i = 0; i < 40; i++) gm.effects.sparks.emit({ pos: { x: gm.player.position.x + rr(-0.6, 0.6), y: gm.player.position.y + 0.2, z: gm.player.position.z + rr(-0.6, 0.6) }, vel: { x: 0, y: rr(2, 6), z: 0 }, life: 1, size: 0.14, sizeEnd: 0, color: [0.8, 3.4, 2.8] });
      },
    });
  }

  // ------------------------------------------------------------------ chest
  _chest(area, c) {
    const gm = this.game, key = `${area.id}:${c.id}`, opened = !!this._flag('chests')[key];
    const tier = { wood: { band: '#8a8f98', glow: '#ffe9a0', wood: '#7a5230' }, silver: { band: '#d8e0ec', glow: '#9fd0ff', wood: '#4a5668' }, gold: { band: '#f0c040', glow: '#ffd24a', wood: '#6a2f2f' } }[c.tier || 'wood'];
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: tier.wood, map: gm.assets?.bark?.diff || null, roughness: 0.75 });
    const band = metal(tier.band);
    g.add(box(1.5, 0.8, 1.0, wood, 0, 0.4, 0));
    for (const x of [-0.55, 0.55]) g.add(box(0.14, 0.86, 1.06, band, x, 0.42, 0));
    const lid = new THREE.Group(); lid.position.set(0, 0.8, -0.5);
    const lidMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 14, 1, false, 0, Math.PI), wood); lidMesh.rotation.z = Math.PI / 2; lidMesh.rotation.y = Math.PI / 2; lidMesh.position.set(0, 0, 0.5); lidMesh.castShadow = true;
    lid.add(lidMesh);
    for (const x of [-0.55, 0.55]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.14, 14, 1, false, 0, Math.PI), band); b.rotation.z = Math.PI / 2; b.rotation.y = Math.PI / 2; b.position.set(x, 0, 0.5); lid.add(b); }
    lid.add(box(0.22, 0.3, 0.1, metal('#ffd24a'), 0, -0.1, 1.02));
    g.add(lid);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.6, 6, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(tier.glow).multiplyScalar(1.6), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 3.2; g.add(beam);
    const yaw = (c.x * 0.37 + c.z * 0.11) % (Math.PI * 2);
    g.rotation.y = yaw;
    this._at(g, c.x, c.z);
    gm.terrain.colliders.push({ x: c.x, z: c.z, r: 0.9 });
    let open = opened ? 1 : 0, opening = false;
    lid.rotation.x = -open * 1.9; beam.visible = !opened;
    const obj = { update: (dt) => { if (opening) { open = Math.min(1, open + dt * 2.5); lid.rotation.x = -open * 1.9; beam.material.opacity = 0.18 * (1 - open); if (open >= 1) { opening = false; beam.visible = false; } } } };
    this.list.push(obj);
    this.inter.push({
      x: c.x, z: c.z, y: g.position.y, radius: 2.8,
      label: () => (this._flag('chests')[key] ? null : '宝箱を開ける'),
      use: () => {
        if (this._flag('chests')[key]) return;
        this._flag('chests')[key] = true; opening = true;
        const pos = new THREE.Vector3(c.x, g.position.y + 0.6, c.z);
        gm.bus.emit('chest:open', { pos, tier: c.tier });
        gm.drops.spawnLoot(pos, c.loot, tier.glow);
        for (let i = 0; i < 30; i++) gm.effects.sparks.emit({ pos, vel: { x: rr(-3, 3), y: rr(2, 7), z: rr(-3, 3) }, life: 0.9, size: 0.14, sizeEnd: 0, color: [4, 3, 1], gravity: 6 });
        gm.autosave('chest');
      },
    });
  }

  // ------------------------------------------------------------------ gate
  _gate(area, spec, isEntrance) {
    const gm = this.game, assets = gm.assets;
    const g = new THREE.Group();
    const stone = stoneMat(assets, '#d0c8bc');
    const dark = metal('#2a3038');
    g.add(box(1.5, 8, 1.5, stone, -4, 4, 0), box(1.5, 8, 1.5, stone, 4, 4, 0), box(10.4, 1.4, 1.9, stone, 0, 8.2, 0), box(0.9, 1, 1.4, dark, 0, 9.3, 0));
    for (const x of [-4, 4]) g.add(box(2.1, 0.8, 2.1, stone, x, 0.4, 0));
    const open0 = isEntrance || this._gateUnlocked(area, spec);
    const color = { plains: '#7fe8a0', ruins: '#ffd27a', cave: '#7fd0ff', lab: '#6af0ff', sky: '#fff2b0' }[area.id] || '#8fd0ff';
    const mat = portalMat(color); mat.uniforms.uOpen.value = open0 ? 1 : 0;
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 7.2), mat); portal.position.y = 3.9; g.add(portal);
    this._at(g, spec.x, spec.z);
    g.rotation.y = isEntrance ? Math.PI : 0;
    for (const x of [-4, 4]) gm.terrain.colliders.push({ x: spec.x + x, z: spec.z, r: 1.3 });
    const state = { locked: !open0, mat };
    const target = spec.to ? AREAS[spec.to] : null;
    this.list.push({ update: () => { const k = state.locked ? 0 : 1; mat.uniforms.uOpen.value += (k - mat.uniforms.uOpen.value) * 0.08; } });
    this.inter.push({
      x: spec.x, z: spec.z - (isEntrance ? 0 : 0), y: g.position.y, radius: 5.2,
      label: () => (state.locked ? `封印の門 (${itemInfo(spec.key).name}が必要)` : target ? `${target.name} へ (推奨Lv ${target.level[0]}-${target.level[1]})` : '王の間への扉'),
      use: () => {
        if (state.locked) {
          if (spec.key && gm.inventory.count(spec.key) > 0) {
            this._flag('gates')[area.id] = true; state.locked = false;
            gm.hud.toast(`${itemInfo(spec.key).name}を使った。門が開いた！`, 2200);
            gm.bus.emit('gate:open');
            gm.autosave('gate');
          } else gm.hud.toast(spec.lockedMsg, 2800);
          return;
        }
        if (!target) { gm.hud.toast(spec.lockedMsg, 3200); return; }
        gm.areas.load(target.id, { spawn: spec.toSpawn || (isEntrance ? 'exit' : 'entrance') });
      },
    });
    return state;
  }
  _gateUnlocked(area) { return !!this._flag('gates')[area.id]; }

  // ------------------------------------------------------------------ lever / barrier
  _lever(area, l) {
    const gm = this.game, key = `${area.id}:${l.id}`;
    const g = new THREE.Group();
    g.add(box(0.8, 0.4, 0.8, metal('#3a4048'), 0, 0.2, 0), box(0.2, 1.4, 0.2, metal('#5a626c'), 0, 0.9, 0));
    const handle = new THREE.Group(); handle.position.y = 1.2;
    const bar = box(0.12, 1.1, 0.12, metal('#8a929c'), 0, 0.55, 0); handle.add(bar);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4a3a').multiplyScalar(2.5) })); knob.position.y = 1.15; handle.add(knob);
    g.add(handle);
    this._at(g, l.x, l.z);
    gm.terrain.colliders.push({ x: l.x, z: l.z, r: 0.6 });
    const on = () => !!this._flag('levers')[key];
    handle.rotation.z = on() ? -0.9 : 0.9; knob.material.color.set(on() ? '#6aff8a' : '#ff4a3a').multiplyScalar(2.5);
    this.list.push({ update: (dt) => { const t = on() ? -0.9 : 0.9; handle.rotation.z += (t - handle.rotation.z) * Math.min(1, dt * 8); } });
    this.inter.push({
      x: l.x, z: l.z, y: g.position.y, radius: 2.6,
      label: () => (on() ? null : 'レバーを引く'),
      use: () => {
        if (on()) return;
        this._flag('levers')[key] = true; knob.material.color.set('#6aff8a').multiplyScalar(2.5);
        const all = area.levers.every((x) => this._flag('levers')[`${area.id}:${x.id}`]);
        gm.hud.toast(all ? '遠くで重い障壁が動く音がした……' : 'ガコン。何かが動いた', 2200);
        if (all) this.openBarrier();
        gm.autosave('lever');
      },
    });
  }

  _barrier(area, b) {
    const gm = this.game;
    const opened = !!this._flag('barrier')[area.id];
    const g = new THREE.Group();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uTime: TIME, uFade: { value: opened ? 0 : 1 }, uColor: { value: new THREE.Color(area.id === 'lab' ? '#4fd8ff' : '#b07cff') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; uniform float uFade; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          vec2 p = vUv * vec2(18.0, 5.0);
          vec2 q = fract(p) - 0.5;
          float hex = smoothstep(0.42, 0.5, max(abs(q.x), abs(q.y)));
          float sweep = 0.5 + 0.5 * sin(vUv.y * 9.0 - uTime * 2.0 + vUv.x * 6.0);
          float edge = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
          gl_FragColor = vec4(uColor * (1.5 + sweep), (0.14 + hex * 0.5 + sweep * 0.1) * edge * uFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(b.width, 8), mat); wall.position.y = 4; g.add(wall);
    // 両端の支柱
    for (const s of [-1, 1]) { const pst = box(1.0, 9, 1.0, metal('#2c343c'), s * (b.width / 2 + 0.3), 4.5, 0); g.add(pst); gm.terrain.colliders.push({ x: b.x + s * (b.width / 2 + 0.3), z: b.z, r: 0.8 }); }
    this._at(g, b.x, b.z);
    const cols = [];
    if (!opened) for (let x = -b.width / 2; x <= b.width / 2 + 0.1; x += 2) { const c = { x: b.x + x, z: b.z, r: 1.3, barrier: true }; cols.push(c); gm.terrain.colliders.push(c); }
    this.barrier = { mat, cols, group: g, opened };
    this.list.push({ update: (dt) => { const t = this.barrier.opened ? 0 : 1; mat.uniforms.uFade.value += (t - mat.uniforms.uFade.value) * Math.min(1, dt * 2.5); wall.visible = mat.uniforms.uFade.value > 0.02; } });
  }

  openBarrier() {
    const b = this.barrier; if (!b || b.opened) return;
    b.opened = true; this._flag('barrier')[this.area.id] = true;
    const t = this.game.terrain;
    t.colliders = t.colliders.filter((c) => !c.barrier);
    this.game.bus.emit('barrier:open');
    this.game.cam.shake(0.4);
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    for (const o of this.list) o.update(dt);
    const p = this.game.player.position;
    let best = null, bd = Infinity;
    if (this.game.player.state !== 'dead') for (const it of this.inter) {
      const d = Math.hypot(it.x - p.x, it.z - p.z);
      if (d < it.radius && d < bd && it.label()) { best = it; bd = d; }
    }
    if (best !== this.target) { this.target = best; this.game.hud.setPrompt(best ? best.label() : null); }
    else if (best) this.game.hud.setPrompt(best.label());
  }

  /** 「調べる」入力。対象があれば使用して true */
  interact() {
    if (!this.target) return false;
    this.target.use();
    return true;
  }
}
