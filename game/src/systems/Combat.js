import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { PLAYER_ATTACKS } from '../data/enemies.js';
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
    this.geo = new THREE.SphereGeometry(0.24, 12, 10);
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#c27bff').multiplyScalar(3.5) });
    game.bus.on('player:swing', (e) => this.onPlayerSwing(e));
    game.player.assist = (pos, facing) => game.enemies.nearestFront(pos, facing, 4.8, 1.25);
  }

  /** 同時に攻撃動作に入れる数を制限 (近接2・遠距離2)。取れなければ待機行動になる。 */
  tryToken(enemy) {
    const kind = enemy.def.ai === 'ranged' ? 'ranged' : 'melee';
    let n = 0;
    for (const e of this.game.enemies.list) if (e !== enemy && e.alive && e.isAttacking && (e.def.ai === 'ranged' ? 'ranged' : 'melee') === kind) n++;
    return n < 2;
  }

  // ---------------------------------------------------------- player → enemy
  onPlayerSwing({ combo, pos, dir }) {
    const g = this.game, cfg = PLAYER_ATTACKS[Math.min(combo, PLAYER_ATTACKS.length - 1)];
    const st = g.player.stats, facing = Math.atan2(dir.x, dir.z);
    let hits = 0, downed = false;
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      if (!sectorHit(pos.x, pos.z, facing, cfg.range, cfg.arc, e.pos.x, e.pos.z, e.radius)) continue;
      const { dmg, crit } = calcDamage({
        atk: st.atk, def: e.def.def, mul: cfg.mul, critRate: st.crit, critMul: st.critMul,
        bonus: e.state === 'down' ? 1.35 : 1,
      });
      const kv = new THREE.Vector3(e.pos.x - pos.x, 0, e.pos.z - pos.z).normalize().multiplyScalar(cfg.knock);
      const res = e.receiveHit({ dmg, knock: kv, poiseDmg: cfg.poise * (crit ? 1.3 : 1) });
      g.bus.emit('enemy:hit', { enemy: e, dmg, crit, pos: e.centerPos, downed: res.downed, killed: res.killed });
      hits++; downed ||= res.downed;
    }
    if (hits) {
      g.hitStop(0.045 + (combo >= 2 ? 0.05 : 0) + (downed ? 0.04 : 0));
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
    if (Math.hypot(p.position.x - enemy.pos.x, p.position.z - enemy.pos.z) <= radius + CONFIG.player.radius)
      this.enemyHitsPlayer(enemy, atk, enemy.pos);
  }

  enemyHitsPlayer(enemy, atk, fromPos) {
    const p = this.game.player;
    if (p.state === 'dead') return false;
    if (!p.canBeHit()) { this.game.bus.emit('player:dodged', { enemy }); return false; }
    const { dmg } = calcDamage({ atk: enemy.def.atk, def: p.stats.def, mul: atk.mul, variance: 0.1 });
    p.takeDamage(dmg, fromPos, { knock: atk.knock, heavy: atk.mul >= 1.3 });
    return true;
  }

  // ---------------------------------------------------------- projectiles
  fireBolt(enemy, atk) {
    const g = this.game, p = g.player;
    const from = new THREE.Vector3(enemy.pos.x + Math.sin(enemy.facing) * 0.6, enemy.pos.y + 1.0, enemy.pos.z + Math.cos(enemy.facing) * 0.6);
    const to = new THREE.Vector3(p.position.x, p.position.y + 1.0, p.position.z);
    const vel = to.sub(from).normalize().multiplyScalar(atk.speed);
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.copy(from); g.scene.add(mesh);
    this.projectiles.push({ mesh, vel, life: 3.2, enemy, atk });
    g.bus.emit('enemy:bolt', { pos: from });
  }

  update(dt) {
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
