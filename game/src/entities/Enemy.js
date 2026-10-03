import * as THREE from 'three';
import { buildEnemyModel } from './enemyModels.js';

let NEXT_ID = 1;
const rr = (a, b) => a + Math.random() * (b - a);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);
const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * 敵 1 体。ステートマシン:
 *   idle(徘徊) → chase(追尾) → windup(予兆) → attack(発生) → recover(硬直) → chase …
 *   被弾: hurt(怯み) / poise 0 で down(ダウン: 被ダメ増)。HP 0 で dead。
 *   leash 超過・プレイヤー死亡で return(帰還・全回復)
 * 同時攻撃数の制限・当たり判定・ダメージ適用は Combat システム側が担当。
 */
export class Enemy {
  constructor(game, def, home, camp) {
    this.id = NEXT_ID++;
    this.game = game; this.def = def; this.camp = camp;
    this.home = home.clone(); this.pos = home.clone();
    this.facing = Math.random() * Math.PI * 2;
    this.maxHp = this.hp = def.hp;
    this.maxPoise = this.poise = def.poise;
    this.state = 'idle'; this.t = 0; this.cd = rr(0.5, 1.5);
    this.knock = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.flash = 0; this.aggro = false; this.lastHit = -99;
    this.alive = true; this.removed = false;
    this.wanderT = 0; this.wanderTarget = home.clone();
    this.strafe = Math.random() < 0.5 ? -1 : 1;
    this.telegraph = null; this.hitDone = false; this.lungeDir = 0;
    this.phase = Math.random() * 10; this.walk = 0;
    this.radius = def.radius; this.hover = def.hover || 0;
    this.baseScale = def.scale || 1;

    this.model = buildEnemyModel(def.id, game.assets);
    this.root = this.model.root;
    this.model.height *= this.baseScale;
    game.scene.add(this.root);
    this.pos.y = game.terrain.height(this.pos.x, this.pos.z);
    this._sync();
  }

  get isAttacking() { return this.state === 'windup' || this.state === 'attack'; }
  get targetable() { return this.alive; }
  get headPos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.model.height, this.pos.z); }
  get centerPos() { return new THREE.Vector3(this.pos.x, this.pos.y + this.model.height * 0.5, this.pos.z); }

  // ------------------------------------------------------------ damage in
  /** Combat から呼ぶ。{killed, downed} を返す */
  receiveHit({ dmg, knock, poiseDmg = 0 }) {
    if (!this.alive) return { killed: false, downed: false };
    this.hp = Math.max(0, this.hp - dmg);
    this.lastHit = this.game.time; this.flash = 0.12;
    this.aggro = true;
    if (this.state === 'idle') { this.state = 'chase'; this.game.enemies?.alertCamp(this); }
    if (this.hp <= 0) { this._die(); return { killed: true, downed: false }; }

    const armored = this.def.superArmor && (this.isAttacking || this.state === 'recover');
    this.poise -= poiseDmg * (this.def.superArmor ? 0.5 : 1);
    if (this.state !== 'down') this.knock.copy(knock).multiplyScalar(armored ? 0.2 : 1);
    if (this.poise <= 0 && this.state !== 'down') {
      this._clearTelegraph(); this.state = 'down'; this.t = 0; this.poise = 0;
      return { killed: false, downed: true };
    }
    if (!armored && this.state !== 'down') {
      this._clearTelegraph();
      this.state = 'hurt'; this.t = 0;
    }
    return { killed: false, downed: false };
  }

  _die() {
    this.alive = false; this.state = 'dead'; this.t = 0;
    this._clearTelegraph();
    this.game.bus.emit('enemy:died', { enemy: this, pos: this.pos.clone(), def: this.def });
  }
  _clearTelegraph() { this.telegraph?.remove(); this.telegraph = null; }

  dispose() {
    this._clearTelegraph();
    this.game.scene.remove(this.root);
    this.root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
    this.removed = true;
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const g = this.game, p = g.player, d = this.def, a = d.attack;
    this.t += dt; this.cd -= dt; this.flash = Math.max(0, this.flash - dt);
    const dx = p.position.x - this.pos.x, dz = p.position.z - this.pos.z;
    const dist = Math.hypot(dx, dz), toP = Math.atan2(dx, dz);
    const playerAlive = p.state !== 'dead';
    this.knock.multiplyScalar(Math.exp(-7 * dt));

    switch (this.state) {
      case 'idle': this._idle(dt, dist, playerAlive); break;
      case 'chase': this._chase(dt, dist, toP, playerAlive); break;
      case 'return': this._return(dt); break;
      case 'windup': this._windup(dt, toP, dist); break;
      case 'attack': this._attack(dt); break;
      case 'recover':
        this._face(toP, dt, 3);
        if (this.t >= a.recover) { this.state = 'chase'; this.t = 0; }
        break;
      case 'hurt':
        if (this.t >= 0.34) { this.state = 'chase'; this.t = 0; this.cd = Math.max(this.cd, 0.5); }
        break;
      case 'down':
        if (this.t >= 1.9) { this.state = 'chase'; this.t = 0; this.poise = this.maxPoise; this.cd = 0.6; }
        break;
      case 'dead':
        if (this.t >= 0.9) this.dispose();
        break;
    }
    if (!this.removed) { this._integrate(dt); this._animate(dt, dist); }
  }

  _idle(dt, dist, playerAlive) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = rr(2.5, 5);
      const a = Math.random() * Math.PI * 2, r = rr(0, 5);
      this.wanderTarget.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
    }
    const tx = this.wanderTarget.x - this.pos.x, tz = this.wanderTarget.z - this.pos.z;
    if (Math.hypot(tx, tz) > 0.6) this._move(Math.atan2(tx, tz), this.def.speed * 0.4, dt);
    else this._move(0, 0, dt);
    if (playerAlive && dist < this.def.detect) { this.aggro = true; this.state = 'chase'; this.t = 0; this.game.enemies?.alertCamp(this); }
  }

  _chase(dt, dist, toP, playerAlive) {
    const g = this.game, d = this.def, a = d.attack;
    const homeDist = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
    if (!playerAlive || homeDist > 42 || dist > d.detect * 2.6) { this.state = 'return'; this.t = 0; this._move(0, 0, dt); return; }
    this._face(toP, dt, 8);

    if (d.ai === 'ranged') {
      const [k0, k1] = d.keep;
      if (dist < k0) this._move(toP + Math.PI, d.speed, dt);
      else if (dist > k1) this._move(toP, d.speed, dt);
      else this._move(toP + this.strafe * Math.PI / 2, d.speed * 0.5, dt);
      if (this.cd <= 0 && dist < k1 + 3 && g.combat.tryToken(this)) this._startAttack(toP);
      return;
    }
    const want = a.range * 0.8;
    if (dist > want) this._move(toP, d.speed, dt);
    else this._move(0, 0, dt);
    if (this.cd <= 0 && dist <= a.range * 1.05) {
      if (g.combat.tryToken(this)) { this._startAttack(toP); return; }
    }
    // トークンが取れない時は距離を保ちつつ周回して待機
    if (this.cd <= 0 && dist < 7) {
      this._move(toP + this.strafe * Math.PI / 2 + (dist < 3.5 ? Math.PI * 0.35 * -1 : 0), d.speed * 0.55, dt);
    }
  }

  _return(dt) {
    const tx = this.home.x - this.pos.x, tz = this.home.z - this.pos.z;
    this._move(Math.atan2(tx, tz), this.def.speed * 1.3, dt);
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
    this.poise = this.maxPoise;
    if (Math.hypot(tx, tz) < 1.5) { this.state = 'idle'; this.aggro = false; this.hp = this.maxHp; this.wanderT = 0; }
  }

  _startAttack(toP) {
    const a = this.def.attack;
    this.state = 'windup'; this.t = 0; this.hitDone = false;
    this.atkDir = toP;
    const tg = this.game.telegraphs;
    if (a.kind === 'slam') this.telegraph = tg.show({ x: this.pos.x, z: this.pos.z, dir: 0, range: a.radius, arc: Math.PI });
    else this.telegraph = tg.show({ x: this.pos.x, z: this.pos.z, dir: toP, range: a.kind === 'lunge' ? a.range + 1.4 : a.range, arc: a.arc });
  }

  _windup(dt, toP, dist) {
    const a = this.def.attack, p = clamp01(this.t / a.windup);
    // 発生直前まで狙いを追従し、その後は固定 (避けられる猶予)
    if (a.kind !== 'slam' && p < 0.6) { this._face(toP, dt, 10); this.atkDir = this.facing; }
    this._move(0, 0, dt);
    this.telegraph?.setPos(this.pos.x, this.pos.z, a.kind === 'slam' ? 0 : this.atkDir);
    this.telegraph?.setFill(p);
    if (p >= 1) {
      this._clearTelegraph();
      this.state = 'attack'; this.t = 0; this.hitDone = false; this.facing = a.kind === 'slam' ? this.facing : this.atkDir;
      const c = this.game.combat;
      if (a.kind === 'swing') { c.enemySector(this, a.range, a.arc, a); this.hitDone = true; }
      else if (a.kind === 'slam') { c.enemyCircle(this, a.radius, a); this.hitDone = true; this.game.bus.emit('enemy:slam', { enemy: this, pos: this.pos.clone(), radius: a.radius }); }
      else if (a.kind === 'bolt') { c.fireBolt(this, a); this.hitDone = true; }
    }
  }

  _attack(dt) {
    const a = this.def.attack;
    if (a.kind === 'lunge') {
      this._move(this.atkDir, a.lunge, dt, true);
      if (!this.hitDone) {
        const p = this.game.player;
        const d = Math.hypot(p.position.x - this.pos.x, p.position.z - this.pos.z);
        if (d < this.radius + 0.55 + 0.4) { this.hitDone = true; this.game.combat.enemyHitsPlayer(this, a, this.pos); }
      }
    } else this._move(0, 0, dt);
    if (this.t >= a.active) {
      this.state = 'recover'; this.t = 0;
      this.cd = rr(a.cd[0], a.cd[1]);
    }
  }

  // ------------------------------------------------------------ movement
  _face(target, dt, rate) {
    this.facing += angleDiff(this.facing, target) * (1 - Math.exp(-rate * dt));
  }

  /** dir(rad) 方向へ speed で加速移動。speed 0 で減速停止。direct=true は慣性なし */
  _move(dir, speed, dt, direct = false) {
    const tx = Math.sin(dir) * speed, tz = Math.cos(dir) * speed;
    const k = direct ? 1 : 1 - Math.exp(-10 * dt);
    this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
  }

  _integrate(dt) {
    const g = this.game, t = g.terrain;
    const frozen = this.state === 'windup' || this.state === 'down' || this.state === 'dead';
    const vx = (frozen ? 0 : this.vel.x) + this.knock.x, vz = (frozen ? 0 : this.vel.z) + this.knock.z;
    this.pos.x += vx * dt; this.pos.z += vz * dt;
    t.resolveCollisions(this.pos, this.radius);
    t.clampToWorld(this.pos, 4);
    this.pos.y = t.height(this.pos.x, this.pos.z);
    this.walk += Math.hypot(this.vel.x, this.vel.z) * dt;
  }

  // ------------------------------------------------------------ visuals
  _animate(dt, dist) {
    const id = this.def.id, P = this.model.parts, tm = this.game.time + this.phase;
    const a = this.def.attack;
    const windP = this.state === 'windup' ? clamp01(this.t / a.windup) : 0;
    const atkP = this.state === 'attack' ? clamp01(this.t / a.active) : 0;
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.4;
    let scale = 1;
    const r = this.root;

    if (this.state === 'dead') scale = Math.max(0.001, 1 - this.t / 0.9);

    if (id === 'gel') {
      const b = P.body; let sy = 1 + Math.sin(tm * 5) * 0.05, sxz = 1 / Math.sqrt(sy);
      if (this.state === 'windup') { sy = 1 - 0.38 * windP; sxz = 1 + 0.25 * windP; }
      else if (this.state === 'attack') { sy = 0.8; sxz = 1.15; }
      else if (this.state === 'down') { sy = 0.45; sxz = 1.4; }
      else if (this.state === 'hurt') { sy = 0.75; sxz = 1.2; }
      else if (moving) { const h = Math.abs(Math.sin(this.walk * 2.2)); sy = 0.9 + h * 0.25; sxz = 1.1 - h * 0.1; r.position.y = h * 0.25; }
      b.scale.set(sxz, sy, sxz);
    } else if (id === 'goblin' || id === 'brute') {
      const big = id === 'brute';
      const sw = moving ? Math.sin(this.walk * (big ? 1.6 : 3.4)) * (big ? 0.4 : 0.8) : 0;
      P.legs[0].rotation.x = sw; P.legs[1].rotation.x = -sw;
      const R = P.armR, L = P.armL;
      if (this.state === 'windup') { R.rotation.x = -2.7 * windP; if (big) L.rotation.x = -2.7 * windP; }
      else if (this.state === 'attack') { const e = 1 - Math.pow(1 - atkP, 3); R.rotation.x = -2.7 + 3.3 * e; if (big) L.rotation.x = -2.7 + 3.3 * e; }
      else { R.rotation.x += (sw * 0.6 - R.rotation.x) * Math.min(1, dt * 10); L.rotation.x += (-sw * 0.6 - L.rotation.x) * Math.min(1, dt * 10); }
      const baseY = big ? 1.3 : 0.62;
      let tilt = 0, drop = 0;
      if (this.state === 'down') { tilt = -1.1; drop = big ? 0.55 : 0.3; }
      else if (this.state === 'hurt') tilt = -0.35;
      else if (this.state === 'windup') tilt = -0.2 * windP;
      else if (this.state === 'attack') tilt = 0.35;
      P.rig.rotation.x += (tilt - P.rig.rotation.x) * Math.min(1, dt * 14);
      P.rig.position.y = baseY - drop + (moving ? Math.abs(Math.sin(this.walk * (big ? 1.6 : 3.4))) * 0.05 : 0);
    } else if (id === 'wisp') {
      const hv = this.state === 'down' ? 0.1 : this.hover + Math.sin(tm * 2) * 0.15;
      P.rig.position.y += (hv - P.rig.position.y) * Math.min(1, dt * 8);
      P.rig.rotation.x = this.state === 'down' ? -0.9 : Math.sin(tm * 1.3) * 0.05 - (this.state === 'windup' ? 0.15 : 0);
      const s = 1 + windP * 1.4 + Math.sin(tm * 8) * 0.08;
      P.orb.scale.setScalar(s);
      P.orb.position.set(0.5, 0.95 + windP * 0.35, 0.25);
    }

    r.position.set(this.pos.x, this.pos.y + (id === 'gel' && !moving ? 0 : 0), this.pos.z);
    if (id === 'gel' && moving) r.position.y = this.pos.y + Math.abs(Math.sin(this.walk * 2.2)) * 0.25;
    r.rotation.y = this.facing;
    r.scale.setScalar(scale * this.baseScale);
    if (this.state === 'dead') r.position.y -= this.t * 0.4;

    // 被弾フラッシュ
    const f = this.flash / 0.12;
    for (const m of this.model.mats) {
      m.userData.baseEm ??= m.emissive.clone();
      m.userData.baseEI ??= m.emissiveIntensity;
      if (f > 0) { m.emissive.setRGB(1, 0.85, 0.7); m.emissiveIntensity = f * 1.4; }
      else { m.emissive.copy(m.userData.baseEm); m.emissiveIntensity = m.userData.baseEI; }
    }
  }

  _sync() { this.root.position.copy(this.pos); this.root.rotation.y = this.facing; }
}
