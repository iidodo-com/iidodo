import * as THREE from 'three';
import { ParticleSystem } from './Particles.js';
import { SwordTrail } from './SwordTrail.js';
import { CONFIG } from '../core/Config.js';

/** 戦闘・移動まわりの視覚効果 (土煙 / 火花 / 剣の軌跡) をイベントで駆動する */
export class Effects {
  constructor(game) {
    this.game = game;
    this.dust = new ParticleSystem(game.scene, { max: 220, additive: false });
    this.sparks = new ParticleSystem(game.scene, { max: 240, additive: true });
    this.trail = new SwordTrail(game.scene);
    this.stepTimer = 0;
    this.waves = [];
    this._waveMat = (c, o = 0.95) => new THREE.MeshBasicMaterial({ color: new THREE.Color(...c), transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this._v = new THREE.Vector3();
    game.bus.on('player:jump', ({ pos, air }) => this.burstDust(pos, air ? 6 : 8, 0.5));
    game.bus.on('player:land', ({ pos, hard }) => { if (hard) { this.burstDust(pos, 16, 1.0); this.shockwave(pos, 3.4); } else this.burstDust(pos, 7, 0.5); });
    game.bus.on('player:dodge', ({ pos }) => this.burstDust(pos, 14, 0.9));
    game.bus.on('player:skillCast', ({ def, pos }) => this.skillFx(def, pos));
    game.bus.on('player:levelup', () => this.levelUpFx());
    game.bus.on('exp:gain', () => {});
    game.bus.on('enemy:hit', ({ pos, crit, killed }) => this.hitSparks(pos, crit, killed));
    game.bus.on('enemy:died', ({ pos }) => { this.burstDust(pos, 18, 1.0); });
    game.bus.on('enemy:enrage', ({ pos, radius }) => { this.shockwave(pos, radius); this.hitSparks({ x: pos.x, y: pos.y + 2, z: pos.z }, true, true); });
    game.bus.on('enemy:impact', ({ x, z, radius }) => this.impact(x, z, radius));
    game.bus.on('enemy:slam', ({ pos, radius }) => this.shockwave(pos, radius));
    game.bus.on('player:hurt', ({ pos }) => this.hurtSparks(pos));
    game.bus.on('player:swing', ({ combo, pos, dir }) => { this.slashSparks(pos, dir, combo); this.slashWave(pos, dir, combo); });
    game.bus.on('player:warp', ({ from, to }) => this.warpFx(from, to));
    game.bus.on('player:rush', ({ pos }) => this.burstDust(pos, 10, 1.1));
    game.bus.on('player:justDodge', ({ pos }) => this.justFx(pos));
    game.bus.on('enemy:execute', ({ pos }) => { this.hitSparks(pos, true, true); this.ring(pos, [4, 2.6, 0.8], 5, 0.5); });
    game.bus.on('style:rank', ({ idx }) => this.rankFx(idx));
  }

  /** エリア切替時に残っている粒子/軌跡を消す */
  reset() { for (const w of this.waves) this.game.scene.remove(w.g); this.waves.length = 0; this.dust.n = 0; this.sparks.n = 0; this.trail.samples.length = 0; this.trail.mesh.visible = false; }

  burstDust(pos, n, spread = 0.6) {
    const t = this.game.terrain;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.6 + Math.random()) * spread;
      this.dust.emit({
        pos: { x: pos.x + Math.cos(a) * 0.3, y: t.height(pos.x, pos.z) + 0.1, z: pos.z + Math.sin(a) * 0.3 },
        vel: { x: Math.cos(a) * s * 2, y: 0.6 + Math.random() * 0.8, z: Math.sin(a) * s * 2 },
        life: 0.5 + Math.random() * 0.4, size: 0.25, sizeEnd: 0.9, color: [0.62, 0.58, 0.48], drag: 3, gravity: -0.2,
      });
    }
  }

  slashSparks(pos, dir, combo) {
    const n = combo === 2 ? 26 : 14;
    for (let i = 0; i < n; i++) {
      const a = (Math.random() - 0.5) * 2.2;
      const dx = dir.x * Math.cos(a) - dir.z * Math.sin(a), dz = dir.x * Math.sin(a) + dir.z * Math.cos(a);
      this.sparks.emit({
        pos: { x: pos.x + dx * 1.5, y: pos.y + 1.0 + (Math.random() - 0.3) * 0.7, z: pos.z + dz * 1.5 },
        vel: { x: dx * (2 + Math.random() * 3), y: Math.random() * 2, z: dz * (2 + Math.random() * 3) },
        life: 0.3 + Math.random() * 0.3, size: 0.09 + Math.random() * 0.06, sizeEnd: 0,
        color: [1.6, 3.4, 4.6], gravity: 4, drag: 2,
      });
    }
  }

  /** 三日月状の斬撃波 (加算合成のリング断片)。combo: 0右 1左 2縦 3叩きつけ(全周) 4突進 5カウンター */
  slashWave(pos, dir, combo) {
    const f = Math.atan2(dir.x, dir.z);
    const g = new THREE.Group();
    g.position.set(pos.x + dir.x * 0.8, pos.y + 1.0, pos.z + dir.z * 0.8); g.rotation.y = f;
    const mk = (r0, r1, a0, a1, c, rot) => { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 28, 1, a0, a1 - a0), this._waveMat(c)); if (rot) rot(m); g.add(m); return m; };
    const cy = [1.4, 3.4, 4.8], gold = [4.5, 3.2, 0.9], white = [3.2, 3.6, 4.2];
    let life = 0.22, grow = 0.5;
    if (combo === 0 || combo === 1) { const s = combo === 0 ? 1 : -1; mk(1.2, 2.5, -Math.PI / 2 - 1.1, -Math.PI / 2 + 1.1, cy, (m) => { m.rotation.x = -Math.PI / 2; m.rotation.z = s * 0.35; m.position.y = 0.1; }); }
    else if (combo === 2) { mk(1.4, 3.1, Math.PI * 0.42, Math.PI * 1.05, white, (m) => { m.rotation.y = Math.PI / 2; m.position.y = 0.2; }); life = 0.28; }
    else if (combo === 3) { g.position.set(pos.x, pos.y + 0.15, pos.z); mk(0.6, 4.6, 0, Math.PI * 2, gold, (m) => { m.rotation.x = -Math.PI / 2; }); life = 0.32; grow = 0.9; }
    else if (combo === 4) { mk(1.6, 3.2, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55, cy, (m) => { m.rotation.x = -Math.PI / 2; m.scale.set(1.3, 2.4, 1); }); mk(1.2, 2.4, Math.PI * 0.45, Math.PI * 0.95, white, (m) => { m.rotation.y = Math.PI / 2; m.position.y = 0.2; }); life = 0.3; }
    else if (combo === 5) { g.position.set(pos.x, pos.y + 1.1, pos.z); for (const t of [0.7, -0.7]) mk(0.8, 4.2, -0.5, 0.5, gold, (m) => { m.rotation.y = f * 0 + Math.PI / 2; m.rotation.x = t; }); mk(0.6, 5.2, 0, Math.PI * 2, [4, 3, 1.2], (m) => { m.rotation.x = -Math.PI / 2; m.position.y = -0.9; }); life = 0.4; grow = 0.8; }
    this.game.scene.add(g);
    this.waves.push({ g, t: 0, life, grow });
  }

  ring(pos, color, r, life = 0.4) {
    const g = new THREE.Group(); g.position.set(pos.x, pos.y ?? 0, pos.z);
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), this._waveMat(color)); m.rotation.x = -Math.PI / 2; g.add(m);
    g.scale.setScalar(0.3); this.game.scene.add(g); this.waves.push({ g, t: 0, life, grow: r, ring: true });
  }

  warpFx(a, b) {
    const n = 26;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      this.sparks.emit({ pos: { x: a.x + (b.x - a.x) * k, y: a.y + 1 + Math.sin(k * 3.14) * 0.3, z: a.z + (b.z - a.z) * k }, vel: { x: (Math.random() - 0.5) * 1.5, y: Math.random() * 1.5, z: (Math.random() - 0.5) * 1.5 }, life: 0.45 + Math.random() * 0.3, size: 0.22, sizeEnd: 0, color: [1.2, 3.2, 4.8], drag: 2 });
    }
    this.burstDust(a, 8, 0.7); this.burstDust(b, 8, 0.9);
    this.ring({ x: a.x, y: this.game.terrain.height(a.x, a.z) + 0.1, z: a.z }, [1.2, 3, 4.5], 3, 0.35);
  }

  justFx(pos) {
    const y = pos.y + 1;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 7;
      this.sparks.emit({ pos: { x: pos.x, y, z: pos.z }, vel: { x: Math.cos(a) * s, y: (Math.random() - 0.3) * 4, z: Math.sin(a) * s }, life: 0.7, size: 0.16, sizeEnd: 0, color: [1.2, 3.4, 5], drag: 2.2 });
    }
    this.ring({ x: pos.x, y: pos.y + 0.1, z: pos.z }, [1.4, 3.6, 5], 7, 0.6);
    this.ring({ x: pos.x, y: pos.y + 0.12, z: pos.z }, [4, 4, 4.4], 4.5, 0.4);
  }

  rankFx(idx) {
    const p = this.game.player.position;
    for (let i = 0; i < 20 + idx * 10; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2;
      this.sparks.emit({ pos: { x: p.x + Math.cos(a) * r, y: p.y + 0.2, z: p.z + Math.sin(a) * r }, vel: { x: 0, y: 3 + Math.random() * 5, z: 0 }, life: 0.9, size: 0.15, sizeEnd: 0, color: idx >= 5 ? [4, 1.2, 3] : [4, 3, 0.9], drag: 1 });
    }
  }

  skillFx(def, pos) {
    const y = pos.y + 0.9;
    if (def.id === 'whirl') {
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2, r = def.radius * 0.9;
        this.sparks.emit({ pos: { x: pos.x + Math.cos(a) * 0.8, y, z: pos.z + Math.sin(a) * 0.8 }, vel: { x: Math.cos(a) * r * 2.6, y: 0.5, z: Math.sin(a) * r * 2.6 }, life: 0.35, size: 0.16, sizeEnd: 0, color: [1.2, 3, 4.5], drag: 4 });
      }
      this.burstDust(pos, 10, 1.2);
    } else if (def.id === 'cry') {
      for (let i = 0; i < 50; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.1;
        this.sparks.emit({ pos: { x: pos.x + Math.cos(a) * r, y: pos.y + 0.1, z: pos.z + Math.sin(a) * r }, vel: { x: 0, y: 3 + Math.random() * 4, z: 0 }, life: 0.7, size: 0.14, sizeEnd: 0, color: [4, 2.6, 0.7], drag: 1 });
      }
      this.game.cam.shake(0.2);
    }
  }

  levelUpFx() {
    const p = this.game.player.position;
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 1.2;
      this.sparks.emit({ pos: { x: p.x + Math.cos(a) * r, y: p.y + 0.1, z: p.z + Math.sin(a) * r }, vel: { x: 0, y: 4 + Math.random() * 6, z: 0 }, life: 1.1 + Math.random() * 0.5, size: 0.17, sizeEnd: 0, color: [4, 3.4, 1.1], drag: 0.8 });
    }
  }

  /** 降り注ぐ魔弾の着弾エフェクト */
  impact(x, z, radius) {
    const t = this.game.terrain, y = t.height(x, z) + 0.2;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius * 0.7;
      this.sparks.emit({ pos: { x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r }, vel: { x: 0, y: 4 + Math.random() * 6, z: 0 }, life: 0.6, size: 0.22, sizeEnd: 0, color: [3.4, 1.2, 3.6], gravity: 6 });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      this.dust.emit({ pos: { x, y, z }, vel: { x: Math.cos(a) * radius * 1.5, y: 1, z: Math.sin(a) * radius * 1.5 }, life: 0.5, size: 0.4, sizeEnd: 1.2, color: [0.5, 0.4, 0.6], drag: 3 });
    }
  }

  hitSparks(pos, crit, big) {
    this.sparks.emit({ pos, vel: { x: 0, y: 0, z: 0 }, life: 0.11, size: crit ? 2.2 : 1.3, sizeEnd: 0, color: crit ? [5, 4, 1.5] : [4, 3.4, 2.4] });
    const n = crit ? 38 : 20;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 2 - 0.4, sp = 3 + Math.random() * (crit ? 7 : 4);
      this.sparks.emit({
        pos, vel: { x: Math.cos(a) * sp, y: e * sp * 0.6 + 1.5, z: Math.sin(a) * sp },
        life: 0.25 + Math.random() * 0.3, size: crit ? 0.16 : 0.1, sizeEnd: 0,
        color: crit ? [4, 3, 0.9] : [3.4, 2.4, 1.2], gravity: 9, drag: 1.5,
      });
    }
  }

  hurtSparks(pos) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.emit({
        pos: { x: pos.x, y: pos.y + 1.1, z: pos.z }, vel: { x: Math.cos(a) * 3, y: 1 + Math.random() * 3, z: Math.sin(a) * 3 },
        life: 0.4, size: 0.12, sizeEnd: 0, color: [3.5, 0.5, 0.35], gravity: 8,
      });
    }
  }

  shockwave(pos, radius) {
    const t = this.game.terrain;
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      this.dust.emit({
        pos: { x: pos.x + Math.cos(a) * radius * 0.35, y: t.height(pos.x, pos.z) + 0.2, z: pos.z + Math.sin(a) * radius * 0.35 },
        vel: { x: Math.cos(a) * radius * 1.9, y: 0.8 + Math.random(), z: Math.sin(a) * radius * 1.9 },
        life: 0.55, size: 0.5, sizeEnd: 1.6, color: [0.66, 0.6, 0.5], drag: 3.5,
      });
    }
    this.game.cam.shake(0.45);
  }

  update(dt) {
    const pl = this.game.player;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]; w.t += dt; const k = w.t / w.life;
      if (k >= 1) { this.game.scene.remove(w.g); w.g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); this.waves.splice(i, 1); continue; }
      const e = 1 - (1 - k) * (1 - k);
      w.g.scale.setScalar(w.ring ? 0.3 + w.grow * e : 0.75 + w.grow * 0.5 * e);
      w.g.traverse((o) => { if (o.isMesh) o.material.opacity = 0.95 * (1 - k) * (1 - k); });
    }
    // 突進/回避/滑空の残像 (光の粒)
    const moving = pl.state === 'dodge' || (pl.state === 'attack' && pl.special === 'rush') || (pl.sprinting && pl.state === 'free');
    if (moving && Math.random() < 0.9) {
      const c = pl.state === 'dodge' ? [0.8, 2.2, 3.6] : pl.state === 'attack' ? [1.4, 3.2, 4.8] : [0.5, 1.2, 1.8];
      this.sparks.emit({ pos: { x: pl.position.x + (Math.random() - 0.5) * 0.5, y: pl.position.y + 0.3 + Math.random() * 1.2, z: pl.position.z + (Math.random() - 0.5) * 0.5 }, vel: { x: 0, y: 0.4, z: 0 }, life: 0.35, size: pl.state === 'free' ? 0.1 : 0.26, sizeEnd: 0, color: c, drag: 3 });
    }
    if (pl.counterT > 0) {
      this.sparks.emit({ pos: { x: pl.position.x + (Math.random() - 0.5) * 0.9, y: pl.position.y + Math.random() * 2, z: pl.position.z + (Math.random() - 0.5) * 0.9 }, vel: { x: 0, y: 1.8, z: 0 }, life: 0.6, size: 0.12, sizeEnd: 0, color: [4, 3, 0.8], drag: 1 });
    }
    // 足音の土煙
    const sp = Math.hypot(pl.velocity.x, pl.velocity.z);
    if (pl.state === 'free' && sp > 3) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) { this.stepTimer = 0.2; this.burstDust(pl.position, 1, 0.25); }
    }
    // 剣の軌跡 (攻撃の振り中のみ記録)
    let rec = false;
    if (pl.state === 'attack') {
      const c = CONFIG.player.combo[pl.comboIndex], p = pl.stateTime / c.dur;
      rec = p > 0.12 && p < 0.8;
    }
    if (pl.state === 'cast' && pl.castDef?.id === 'whirl') rec = pl.stateTime > 0.05;
    this.trail.update(pl.swordPivot, rec);
    if (pl.buffs.cry > 0) {
      this.auraT = (this.auraT || 0) - dt;
      if (this.auraT <= 0) {
        this.auraT = 0.07;
        const a = Math.random() * Math.PI * 2;
        this.sparks.emit({ pos: { x: pl.position.x + Math.cos(a) * 0.5, y: pl.position.y + 0.2, z: pl.position.z + Math.sin(a) * 0.5 }, vel: { x: 0, y: 1.8, z: 0 }, life: 0.6, size: 0.1, sizeEnd: 0, color: [3.6, 2.2, 0.6] });
      }
    }
    this.dust.update(dt);
    this.sparks.update(dt);
  }
}
