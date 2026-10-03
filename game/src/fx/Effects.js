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
    this._v = new THREE.Vector3();
    game.bus.on('player:dodge', ({ pos }) => this.burstDust(pos, 14, 0.9));
    game.bus.on('player:swing', ({ combo, pos, dir }) => this.slashSparks(pos, dir, combo));
  }

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

  update(dt) {
    const pl = this.game.player;
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
    this.trail.update(pl.swordPivot, rec);
    this.dust.update(dt);
    this.sparks.update(dt);
  }
}
