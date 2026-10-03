import * as THREE from 'three';
import { ENEMIES } from '../data/enemies.js';
import { Enemy } from '../entities/Enemy.js';
import { rng } from '../core/Noise.js';

const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** 敵の配置(キャンプ)・更新・リスポーン・敵同士の押し合い */
export class EnemySystem {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.slots = [];
    this.area = null;
    this.rand = rng(303);
    game.bus.on('enemy:died', ({ enemy }) => this._onDied(enemy));
  }

  _validGround(x, z) {
    const t = this.game.terrain;
    const y = t.height(x, z);
    const lim = t.half - 12;
    return y > t.waterLevel + 0.9 && y < 12 && t.slopeAt(x, z, y) < 0.09 && Math.abs(x) < lim && Math.abs(z) < lim;
  }

  /** エリアを切り替える: 既存の敵を破棄し、キャンプ・中ボス・ピラーを配置し直す */
  setupArea(area) {
    this.clear();
    this.area = area;
    this.rand = rng(area.terrain.seed + 303);
    const flags = this.game.flags;
    area.camps.forEach((camp, ci) => {
      camp.types.forEach((type, i) => {
        let x = camp.x, z = camp.z;
        for (let tries = 0; tries < 40; tries++) {
          const a = (i / camp.types.length) * Math.PI * 2 + this.rand(), r = 2.2 + this.rand() * 3 + tries * 0.15;
          x = camp.x + Math.cos(a) * r; z = camp.z + Math.sin(a) * r;
          if (this._validGround(x, z)) break;
        }
        this._addSlot({ kind: 'camp', camp: ci, type, home: new THREE.Vector3(x, 0, z) });
      });
    });
    if (area.boss && !flags.boss?.[area.id]) this._addSlot({ kind: 'boss', camp: 100, type: area.boss.id, home: new THREE.Vector3(area.boss.x, 0, area.boss.z) });
    (area.pylons || []).forEach((p) => {
      if (!flags.pylons?.[`${area.id}:${p.id}`]) this._addSlot({ kind: 'pylon', camp: 200 + this.slots.length, type: 'pylon', pid: p.id, home: new THREE.Vector3(p.x, 0, p.z) });
    });
  }

  _addSlot(slot) {
    slot.enemy = null; slot.timer = 0; slot.dead = false;
    this.slots.push(slot);
    this._spawn(slot);
  }

  _spawn(slot) {
    const e = new Enemy(this.game, ENEMIES[slot.type], slot.home, slot.camp);
    e.slot = slot; slot.enemy = e; this.list.push(e);
  }

  clear() {
    for (const e of this.list) { if (!e.removed) e.dispose(); }
    this.list = []; this.slots = [];
  }

  _onDied(enemy) {
    const s = enemy.slot, flags = this.game.flags;
    if (!s || !this.area) return;
    if (s.kind === 'boss') { s.dead = true; (flags.boss ||= {})[this.area.id] = true; this.game.bus.emit('boss:defeated', { area: this.area.id, enemy }); }
    if (s.kind === 'pylon') {
      s.dead = true; (flags.pylons ||= {})[`${this.area.id}:${s.pid}`] = true;
      const all = this.area.pylons.every((p) => flags.pylons[`${this.area.id}:${p.id}`]);
      this.game.bus.emit('pylon:destroyed', { all });
    }
  }

  /** 休息: 倒された敵も含めて (撃破済みボス/ピラー以外) 全員を初期配置に戻す */
  respawnAll() {
    for (const e of this.list) if (!e.removed) e.dispose();
    this.list = [];
    for (const s of this.slots) { s.enemy = null; s.timer = 0; if (!s.dead) this._spawn(s); }
  }

  /** 1 体が気付いたら同じキャンプの仲間も戦闘状態に */
  alertCamp(enemy) {
    for (const e of this.list) {
      if (e !== enemy && e.camp === enemy.camp && e.alive && !e.def.static && e.state === 'idle') { e.state = 'chase'; e.aggro = true; e.t = 0; }
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
      if (s.enemy || s.dead || s.kind !== 'camp') continue;
      if (Math.hypot(s.home.x - pp.x, s.home.z - pp.z) > 45) s.timer -= dt;
      if (s.timer <= 0) this._spawn(s);
    }
  }

  /** プレイヤー死亡時など: 全員を戦闘解除して帰還させる */
  resetAggro() {
    for (const e of this.list) if (e.alive && !e.def.static && e.state !== 'idle') { e._clearTelegraph(); e.state = 'return'; e.t = 0; }
  }
}
