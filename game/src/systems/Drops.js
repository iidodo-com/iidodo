import * as THREE from 'three';
import { DROPS, itemInfo, GEMS } from '../data/items.js';

const rr = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));

/**
 * 撃破時の経験値・ゴールド・ドロップ品。ドロップは光る玉として地面に落ち、
 * 近づくと吸い寄せられて自動取得される。取得ログは 'pickup' イベントで HUD へ。
 */
export class Drops {
  constructor(game) {
    this.game = game;
    this.orbs = [];
    this.geo = new THREE.OctahedronGeometry(0.2, 0);
    this.mats = {};
    game.bus.on('enemy:died', ({ enemy, pos, def }) => this.onKill(enemy, pos, def));
  }

  _mat(color) {
    return this.mats[color] ||= new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.6) });
  }

  onKill(enemy, pos, def) {
    const g = this.game;
    const exp = g.progression.expFor(def);
    g.progression.gainExp(exp);
    g.bus.emit('exp:gain', { exp, pos });
    const table = DROPS[def.id]; if (!table) return;
    const gold = ri(table.gold[0], table.gold[1]);
    this.spawn(pos, { gold }, '#ffd23a');
    for (const d of table.items) {
      if (Math.random() > d.chance) continue;
      const n = ri(d.n[0], d.n[1]);
      const info = itemInfo(d.id);
      const color = info.kind === 'equipment' ? '#c27bff' : info.kind === 'consumable' ? '#ff8fa3' : '#6fe6ff';
      this.spawn(pos, { id: d.id, n }, color);
    }
  }

  /** 宝箱などの固定ロート: loot = {gold:[min,max], items:[{id,n}]} */
  spawnLoot(pos, loot, color = '#ffd23a') {
    if (loot.gold) this.spawn(pos, { gold: ri(loot.gold[0], loot.gold[1]) }, '#ffd23a');
    for (const it of loot.items || []) {
      const info = itemInfo(it.id);
      const col = info.kind === 'equipment' ? '#c27bff' : info.kind === 'consumable' ? '#ff8fa3' : info.kind === 'gem' ? (GEMS[it.id]?.color || '#fff') : '#6fe6ff';
      if (info.kind === 'equipment') for (let i = 0; i < it.n; i++) this.spawn(pos, { id: it.id, n: 1 }, col);
      else this.spawn(pos, { id: it.id, n: it.n }, col);
    }
  }

  clear() {
    for (const o of this.orbs) this.game.scene.remove(o.mesh);
    this.orbs = [];
  }

  spawn(pos, payload, color) {
    const mesh = new THREE.Mesh(this.geo, this._mat(color));
    mesh.position.set(pos.x, pos.y + 0.8, pos.z);
    this.game.scene.add(mesh);
    const a = Math.random() * Math.PI * 2, s = rr(1.5, 3.2);
    this.orbs.push({ mesh, payload, color, vel: new THREE.Vector3(Math.cos(a) * s, rr(3, 5.5), Math.sin(a) * s), t: 0, life: 90 });
  }

  update(dt) {
    const g = this.game, pp = g.player.position, t = g.terrain;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i], m = o.mesh;
      o.t += dt; o.life -= dt;
      const ground = t.height(m.position.x, m.position.z) + 0.45;
      const dx = pp.x - m.position.x, dz = pp.z - m.position.z, dy = pp.y + 0.9 - m.position.y;
      const d = Math.hypot(dx, dz, dy);
      if (o.t > 0.6 && d < 3.2 && g.player.state !== 'dead') {
        // 吸い寄せ
        const k = Math.min(1, 14 * dt) * (1 + (3.2 - d));
        m.position.x += dx * k * 0.35; m.position.y += dy * k * 0.35; m.position.z += dz * k * 0.35;
        if (d < 0.9) { this._collect(o); this._remove(i); continue; }
      } else {
        o.vel.y -= 16 * dt;
        m.position.addScaledVector(o.vel, dt);
        if (m.position.y < ground) { m.position.y = ground; o.vel.set(0, 0, 0); }
        else if (o.vel.lengthSq() === 0) m.position.y = ground;
        if (o.vel.lengthSq() === 0) m.position.y = ground + Math.sin(o.t * 3) * 0.08 + 0.08;
      }
      m.rotation.y += dt * 3; m.rotation.x = Math.sin(o.t * 2) * 0.3;
      if (o.vel.lengthSq() === 0 && Math.random() < dt * 3) {
        g.effects.sparks.emit({ pos: m.position, vel: { x: 0, y: 0.8, z: 0 }, life: 0.5, size: 0.08, sizeEnd: 0, color: [2, 1.8, 1] });
      }
      if (o.life <= 0) this._remove(i);
    }
  }

  _collect(o) {
    const g = this.game, inv = g.inventory, p = o.payload;
    if (p.gold) { inv.addGold(p.gold); g.bus.emit('pickup', { text: `${p.gold} G`, kind: 'gold' }); }
    else {
      const info = itemInfo(p.id);
      if (info.kind === 'equipment') { inv.addEquip(p.id); g.bus.emit('pickup', { text: `${info.name} を手に入れた！`, kind: 'equip', color: '#c27bff' }); g.autosave?.('equip'); }
      else { inv.add(p.id, p.n); g.bus.emit('pickup', { text: `${info.name} ×${p.n}`, kind: 'item' }); }
    }
  }

  _remove(i) {
    const o = this.orbs[i];
    this.game.scene.remove(o.mesh);
    this.orbs.splice(i, 1);
  }
}
