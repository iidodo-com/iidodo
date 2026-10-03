import * as THREE from 'three';
import { CAMPS, ENEMIES } from '../data/enemies.js';
import { Enemy } from '../entities/Enemy.js';
import { rng } from '../core/Noise.js';
import { CONFIG } from '../core/Config.js';

const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** 敵の配置(キャンプ)・更新・リスポーン・敵同士の押し合い */
export class EnemySystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.slots = [];
    this.rand = rng(CONFIG.world.seed + 303);
    this._buildCamps();
    game.bus.on('enemy:died', () => {});
  }

  _validGround(x, z) {
    const t = this.game.terrain;
    const y = t.height(x, z);
    return y > t.waterLevel + 0.9 && y < 9 && t.slopeAt(x, z, y) < 0.07 && Math.hypot(x, z) > 18 && Math.abs(x) < 105 && Math.abs(z) < 105;
  }

  _buildCamps() {
    CAMPS.forEach((camp, ci) => {
      let cx = 0, cz = 0, ok = false;
      const baseAng = (ci / CAMPS.length) * Math.PI * 2 + this.rand() * 0.6;
      for (let tries = 0; tries < 80 && !ok; tries++) {
        const ang = baseAng + (this.rand() - 0.5) * 0.9, d = camp.dist + (this.rand() - 0.5) * 12;
        cx = Math.cos(ang) * d; cz = Math.sin(ang) * d;
        ok = this._validGround(cx, cz);
      }
      if (!ok) return;
      camp.types.forEach((type, i) => {
        let x = cx, z = cz;
        for (let tries = 0; tries < 30; tries++) {
          const a = (i / camp.types.length) * Math.PI * 2 + this.rand(), r = 2.2 + this.rand() * 2.5;
          x = cx + Math.cos(a) * r; z = cz + Math.sin(a) * r;
          if (this._validGround(x, z)) break;
        }
        const slot = { camp: ci, type, home: new THREE.Vector3(x, 0, z), enemy: null, timer: 0 };
        this.slots.push(slot);
        this._spawn(slot);
      });
    });
  }

  _spawn(slot) {
    const e = new Enemy(this.game, ENEMIES[slot.type], slot.home, slot.camp);
    e.slot = slot; slot.enemy = e; this.list.push(e);
  }

  /** 1 体が気付いたら同じキャンプの仲間も戦闘状態に */
  alertCamp(enemy) {
    for (const e of this.list) {
      if (e !== enemy && e.camp === enemy.camp && e.alive && e.state === 'idle') { e.state = 'chase'; e.aggro = true; e.t = 0; }
    }
  }

  /** 攻撃アシスト用: 正面 (半角 arc) の最寄りの敵 */
  nearestFront(pos, facing, maxDist, arc) {
    let best = null, bd = Infinity;
    for (const e of this.list) {
      if (!e.alive) continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z, d = Math.hypot(dx, dz) - e.radius;
      if (d > maxDist || d >= bd) continue;
      if (Math.abs(angleDiff(facing, Math.atan2(dx, dz))) > arc) continue;
      best = e; bd = d;
    }
    return best;
  }

  update(dt, game) {
    const pp = game.player.position;
    for (const e of this.list) {
      const d = Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z);
      e.root.visible = d < 120;
      if (d < 95 || e.state !== 'idle') e.update(dt);
    }
    // 押し合い (近くの敵同士が重ならないように)
    const near = this.list.filter((e) => e.alive && Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z) < 45);
    for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, min = a.radius + b.radius + 0.1;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2), push = (min - d) * 0.5 / d;
        a.pos.x -= dx * push; a.pos.z -= dz * push; b.pos.x += dx * push; b.pos.z += dz * push;
      }
    }
    // 除去 / リスポーン (プレイヤーが拠点から離れている時だけカウント)
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.removed) { this.list.splice(i, 1); if (e.slot) { e.slot.enemy = null; e.slot.timer = 50; } }
    }
    for (const s of this.slots) {
      if (s.enemy) continue;
      if (Math.hypot(s.home.x - pp.x, s.home.z - pp.z) > 45) s.timer -= dt;
      if (s.timer <= 0) this._spawn(s);
    }
  }

  /** プレイヤー死亡時など: 全員を戦闘解除して帰還させる */
  resetAggro() {
    for (const e of this.list) if (e.alive && e.state !== 'idle') { e._clearTelegraph(); e.state = 'return'; e.t = 0; }
  }
}
