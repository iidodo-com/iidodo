import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { PLAYER_ATTACKS } from '../data/enemies.js';
import { SKILLS } from '../data/skills.js';
import { calcDamage } from './DamageCalc.js';

const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * 扇形判定: origin から dir(rad) 方向へ range・半角 arc の扇に、半径 radius の円が触れているか。
 * 大きい敵ほど角度の許容が広がる (atan(radius/dist))。
 */
export function sectorHit(ox, oz, dir, range, arc, tx, tz, radius) {
  const dx = tx - ox, dz = tz - oz, dist = Math.hypot(dx, dz);
  if (dist - radius > range) return false;
  if (dist < radius + 0.05) return true;
  const allow = arc + Math.atan(radius / dist);
  return Math.abs(angleDiff(dir, Math.atan2(dx, dz))) <= allow;
}

/**
 * 戦闘システム: プレイヤー攻撃の命中判定 / 敵攻撃の命中判定 / 飛び道具 / 攻撃権(同時攻撃数の制限)。
 * ダメージ計算は DamageCalc、被弾リアクションは各エンティティが担当する。
 */
export class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.pBolts = [];          // プレイヤーの貫通弾 (魔導閃)
    this.boltGeo = new THREE.SphereGeometry(0.22, 12, 10);
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#6fe6ff').multiplyScalar(4) });
    this.geo = new THREE.SphereGeometry(0.24, 12, 10);
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c27bff').multiplyScalar(3.5) });
    game.bus.on('player:swing', (e) => this.onPlayerSwing(e));
    game.bus.on('player:skillCast', (e) => this.onSkill(e));
    game.player.nearest = (pos, r) => { let b = null, bd = r; for (const e of game.enemies.list) { if (!e.alive || e.def.static) continue; const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) - e.radius; if (d < bd) { bd = d; b = e; } } return b; };
    game.player.assist = (pos, facing, maxD = 4.8, arc = 1.9) => game.enemies.nearestFront(pos, facing, maxD, arc);
  }

  /** 同時に攻撃動作に入れる数を制限 (近接2・遠距離2)。取れなければ待機行動になる。 */
  tryToken(enemy) {
    const kind = enemy.def.ai === 'ranged' ? 'ranged' : 'melee';
    let n = 0;
    for (const e of this.game.enemies.list) if (e !== enemy && e.alive && e.isAttacking && (e.def.ai === 'ranged' ? 'ranged' : 'melee') === kind) n++;
    return n < 2;
  }

  /** バフ込みの攻撃力 */
  playerAtk() {
    const p = this.game.player;
    return p.stats.atk * (p.buffs.cry > 0 ? 1 + SKILLS[1].atk : 1);
  }

  /** プレイヤー → 敵 1 体へのダメージ適用 (通常攻撃/スキル共通)。結果を返す */
  hitEnemy(e, { mul, knockDir, knock, poise }) {
    const g = this.game, st = g.player.stats;
    const execute = e.state === 'down';
    const { dmg, crit } = calcDamage({
      atk: this.playerAtk(), def: e.def.def, mul: mul * g.style.mult, critRate: st.crit, critMul: st.critMul,
      bonus: execute ? 1.8 : 1,
    });
    if (execute) { g.bus.emit('enemy:execute', { enemy: e, pos: e.centerPos }); }
    const kv = knockDir.clone().setY(0).normalize().multiplyScalar(knock);
    const res = e.receiveHit({ dmg, knock: kv, poiseDmg: poise * (crit ? 1.3 : 1) });
    if (res.blocked) { this.game.bus.emit('enemy:blocked', { enemy: e, pos: e.centerPos }); return res; }
    this.game.bus.emit('enemy:hit', { enemy: e, dmg, crit, pos: e.centerPos, downed: res.downed, killed: res.killed });
    return res;
  }

  // ---------------------------------------------------------- skills
  onSkill({ def, pos, dir }) {
    const g = this.game;
    if (def.kind === 'aoe') {
      let hits = 0;
      for (const e of g.enemies.list) {
        if (!e.alive) continue;
        if (Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) > def.radius + e.radius) continue;
        this.hitEnemy(e, { mul: def.mul, knockDir: new THREE.Vector3(e.pos.x - pos.x, 0, e.pos.z - pos.z), knock: def.knock, poise: def.poise });
        hits++;
      }
      g.cam.shake(0.3);
      if (hits) g.hitStop(0.07);
    } else if (def.kind === 'projectile') {
      const mesh = new THREE.Mesh(this.boltGeo, this.boltMat);
      mesh.scale.set(1, 1, 2.6);
      mesh.position.set(pos.x + dir.x * 0.9, pos.y + 1.1, pos.z + dir.z * 0.9);
      mesh.rotation.y = Math.atan2(dir.x, dir.z);
      g.scene.add(mesh);
      this.pBolts.push({ mesh, def, dir: dir.clone(), life: def.range / def.speed, hit: new Set() });
      g.cam.shake(0.12);
    }
  }

  updatePlayerBolts(dt) {
    const g = this.game, t = g.terrain;
    for (let i = this.pBolts.length - 1; i >= 0; i--) {
      const b = this.pBolts[i], m = b.mesh;
      m.position.addScaledVector(b.dir, b.def.speed * dt);
      b.life -= dt;
      g.effects.sparks.emit({
        pos: m.position, vel: { x: (Math.random() - 0.5) * 1.2, y: (Math.random() - 0.5) * 1.2, z: (Math.random() - 0.5) * 1.2 },
        life: 0.35, size: 0.2, sizeEnd: 0, color: [0.8, 2.6, 4],
      });
      for (const e of g.enemies.list) {
        if (!e.alive || b.hit.has(e)) continue;
        if (Math.hypot(e.pos.x - m.position.x, e.pos.z - m.position.z) < e.radius + b.def.width * 0.5 && Math.abs(e.pos.y + 1 - m.position.y) < 2.2) {
          b.hit.add(e);
          this.hitEnemy(e, { mul: b.def.mul, knockDir: b.dir, knock: b.def.knock, poise: b.def.poise });
          g.hitStop(0.05);
        }
      }
      let dead = b.life <= 0 || m.position.y < t.height(m.position.x, m.position.z) + 0.1;
      if (!dead) for (const c of t.colliders) {
        const dx = m.position.x - c.x, dz = m.position.z - c.z;
        if (dx * dx + dz * dz < (c.r + 0.15) ** 2 && m.position.y - t.height(c.x, c.z) < 3) { dead = true; break; }
      }
      if (dead) { g.scene.remove(m); this.pBolts.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------- player → enemy
  onPlayerSwing({ combo, pos, dir }) {
    const g = this.game, cfg = PLAYER_ATTACKS[Math.min(combo, PLAYER_ATTACKS.length - 1)];
    const facing = Math.atan2(dir.x, dir.z);
    let hits = 0, downed = false;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      if (!sectorHit(pos.x, pos.z, facing, cfg.range, cfg.arc, e.pos.x, e.pos.z, e.radius)) continue;
      const res = this.hitEnemy(e, { mul: cfg.mul, knockDir: new THREE.Vector3(e.pos.x - pos.x, 0, e.pos.z - pos.z), knock: cfg.knock, poise: cfg.poise });
      hits++; downed ||= res.downed;
    }
    if (hits) {
      g.hitStop(0.045 + (combo >= 2 ? 0.05 : 0) + (combo >= 5 ? 0.06 : 0) + (downed ? 0.04 : 0));
      g.cam.shake(cfg.shake);
    }
  }

  // ---------------------------------------------------------- enemy → player
  enemySector(enemy, range, arc, atk) {
    const p = this.game.player;
    if (sectorHit(enemy.pos.x, enemy.pos.z, enemy.facing, range, arc, p.position.x, p.position.z, CONFIG.player.radius))
      this.enemyHitsPlayer(enemy, atk, enemy.pos);
  }
  enemyCircle(enemy, radius, atk) {
    const p = this.game.player;
    if (p.airborne) return; // 衝撃波はジャンプで回避
    if (Math.hypot(p.position.x - enemy.pos.x, p.position.z - enemy.pos.z) <= radius + CONFIG.player.radius)
      this.enemyHitsPlayer(enemy, atk, enemy.pos);
  }

  enemyHitsPlayer(enemy, atk, fromPos) {
    const p = this.game.player;
    if (p.state === 'dead') return false;
    if (!p.canBeHit()) {
      this.game.bus.emit('player:dodged', { enemy });
      if (p.state === 'dodge' && p.justCd <= 0) {
        p.justCd = 1.2; p.counterT = CONFIG.player.counterWindow; p.stats.mp = Math.min(p.stats.maxMp, p.stats.mp + 10);
        this.game.bus.emit('player:justDodge', { enemy, pos: p.position.clone() });
      }
      return false;
    }
    const { dmg } = calcDamage({ atk: enemy.def.atk * (enemy.atkMul || 1), def: p.stats.def, mul: atk.mul, variance: 0.1 });
    p.takeDamage(dmg, fromPos, { knock: atk.knock, heavy: atk.mul >= 1.3 });
    return true;
  }

  // ---------------------------------------------------------- projectiles
  _spawnBolt(enemy, atk, dir) {
    const g = this.game;
    const from = new THREE.Vector3(enemy.pos.x + dir.x * 0.6, enemy.pos.y + 1.0 + (enemy.def.hover || 0) * 0.5, enemy.pos.z + dir.z * 0.6);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.copy(from); g.scene.add(mesh);
    this.projectiles.push({ mesh, vel: dir.clone().multiplyScalar(atk.speed), life: 3.2, enemy, atk });
    return from;
  }

  _aimDir(enemy, yaw = 0) {
    const p = this.game.player;
    const from = new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1.0 + (enemy.def.hover || 0) * 0.5, enemy.pos.z);
    const to = new THREE.Vector3(p.position.x, p.position.y + 1.0, p.position.z);
    const d = to.sub(from).normalize();
    if (yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); const x = d.x * c - d.z * s, z = d.x * s + d.z * c; d.x = x; d.z = z; }
    return d;
  }

  fireBolt(enemy, atk) {
    const from = this._spawnBolt(enemy, atk, this._aimDir(enemy));
    this.game.bus.emit('enemy:bolt', { pos: from });
  }

  /** 扇状に複数の弾を撃つ (中ボスの弾幕) */
  fireVolley(enemy, atk) {
    let from;
    for (let i = 0; i < atk.count; i++) from = this._spawnBolt(enemy, atk, this._aimDir(enemy, (i - (atk.count - 1) / 2) * atk.spread));
    this.game.bus.emit('enemy:bolt', { pos: from });
  }

  /** 降り注ぐ魔弾: 予告した各地点で同時に着弾 (円形判定) */
  fireRain(enemy, atk) {
    const g = this.game, p = g.player;
    let hit = false;
    for (const pt of enemy.rainPts || []) {
      if (!hit && !p.airborne && Math.hypot(p.position.x - pt.x, p.position.z - pt.z) <= atk.radius + 0.45) { hit = this.enemyHitsPlayer(enemy, atk, { x: pt.x, y: 0, z: pt.z }); }
      g.bus.emit('enemy:impact', { x: pt.x, z: pt.z, radius: atk.radius });
    }
    g.cam.shake(0.3);
  }

  clear() {
    for (const b of this.projectiles) this.game.scene.remove(b.mesh);
    for (const b of this.pBolts) this.game.scene.remove(b.mesh);
    this.projectiles = []; this.pBolts = [];
  }

  update(dt) {
    this.updatePlayerBolts(dt);
    const g = this.game, p = g.player, terrain = g.terrain;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const b = this.projectiles[i], m = b.mesh;
      m.position.addScaledVector(b.vel, dt);
      b.life -= dt;
      g.effects.sparks.emit({
        pos: m.position, vel: { x: (Math.random() - 0.5) * 0.6, y: (Math.random() - 0.5) * 0.6, z: (Math.random() - 0.5) * 0.6 },
        life: 0.3, size: 0.2, sizeEnd: 0, color: [2.2, 0.9, 3.2],
      });
      let dead = b.life <= 0 || m.position.y < terrain.height(m.position.x, m.position.z) + 0.1;
      if (!dead) for (const c of terrain.colliders) {
        const dx = m.position.x - c.x, dz = m.position.z - c.z;
        if (dx * dx + dz * dz < (c.r + 0.2) ** 2 && m.position.y - terrain.height(c.x, c.z) < 3) { dead = true; break; }
      }
      if (!dead && p.state !== 'dead') {
        const dx = m.position.x - p.position.x, dz = m.position.z - p.position.z, dy = m.position.y - (p.position.y + 1);
        if (dx * dx + dz * dz < 0.7 * 0.7 && Math.abs(dy) < 1.1 && p.canBeHit()) {
          this.enemyHitsPlayer(b.enemy, b.atk, m.position); dead = true;
        }
      }
      if (dead) {
        for (let k = 0; k < 8; k++) g.effects.sparks.emit({
          pos: m.position, vel: { x: (Math.random() - 0.5) * 4, y: Math.random() * 3, z: (Math.random() - 0.5) * 4 },
          life: 0.35, size: 0.14, sizeEnd: 0, color: [2.2, 0.9, 3.2], gravity: 6,
        });
        g.scene.remove(m); this.projectiles.splice(i, 1);
      }
    }
  }
}
