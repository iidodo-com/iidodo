import * as THREE from 'three';

/**
 * ワールド座標に追従する DOM ラベル: 敵の HP バー / ダメージ数字。
 * 3D→2D 投影は毎フレーム 1 回。要素はプールして再利用する。
 */
export class WorldLabels {
  constructor(game) {
    this.game = game;
    this.layer = document.getElementById('world-labels');
    this.bars = new Map();      // enemy.id → {el, fill, poise, name}
    this.nums = [];             // 浮かぶダメージ数字 {el, pos, t, life}
    this.numPool = [];
    this._v = new THREE.Vector3();
    this.bossEl = document.getElementById('boss-bar');
    this.bossName = this.bossEl.querySelector('.bn'); this.bossFill = this.bossEl.querySelector('.bf');
    game.bus.on('enemy:hit', ({ enemy, dmg, crit, pos, downed }) => {
      this.floatText(pos, String(dmg), crit ? 'crit' : 'hit');
      if (downed) this.floatText(enemy.headPos, 'DOWN!', 'down');
    });
    game.bus.on('enemy:blocked', ({ pos }) => this.floatText(pos, 'BLOCK', 'down'));
    game.bus.on('exp:gain', ({ exp, pos }) => this.floatText(new THREE.Vector3(pos.x, pos.y + 2.4, pos.z), `EXP +${exp}`, 'exp'));
    game.bus.on('player:hurt', ({ dmg, pos }) => this.floatText(new THREE.Vector3(pos.x, pos.y + 1.9, pos.z), String(dmg), 'hurt'));
  }

  floatText(pos, text, cls = 'hit') {
    const el = this.numPool.pop() || document.createElement('div');
    el.className = `dmg ${cls}`; el.textContent = text;
    this.layer.appendChild(el);
    this.nums.push({ el, pos: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.5, pos.y, pos.z), t: 0, life: cls === 'down' ? 1.1 : 0.9 });
  }

  _project(pos) {
    const c = this.game.camera, v = this._v.copy(pos).project(c);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  update(dt) {
    const g = this.game, pp = g.player.position, now = g.time;

    // 中ボスのHPバー (画面上部)
    const boss = g.enemies.list.find((e) => e.def.boss && e.alive && e.aggro && e.state !== 'return');
    this.bossEl.classList.toggle('show', !!boss);
    if (boss) {
      this.bossName.textContent = boss.def.name;
      this.bossFill.style.width = `${(boss.hp / boss.maxHp) * 100}%`;
      this.bossEl.classList.toggle('enraged', boss.enraged);
    }

    for (const e of g.enemies.list) {
      const dist = Math.hypot(e.pos.x - pp.x, e.pos.z - pp.z);
      const show = e.alive && !e.def.boss && dist < 32 && (e.aggro || now - e.lastHit < 4) && e.root.visible;
      let b = this.bars.get(e.id);
      if (!show) { if (b) b.el.style.display = 'none'; if (!e.alive || e.removed) { b?.el.remove(); this.bars.delete(e.id); } continue; }
      if (!b) {
        const el = document.createElement('div'); el.className = 'ebar';
        el.innerHTML = '<div class="ename"></div><div class="track"><div class="fill"></div></div><div class="ptrack"><div class="pfill"></div></div>';
        this.layer.appendChild(el);
        b = { el, fill: el.querySelector('.fill'), poise: el.querySelector('.pfill'), name: el.querySelector('.ename') };
        b.name.textContent = `Lv${e.def.level} ${e.def.name}`;
        this.bars.set(e.id, b);
      }
      const s = this._project(e.headPos);
      if (!s) { b.el.style.display = 'none'; continue; }
      b.el.style.display = '';
      b.el.style.transform = `translate(${s.x}px, ${s.y - 6}px) translate(-50%, -100%)`;
      b.fill.style.width = `${(e.hp / e.maxHp) * 100}%`;
      b.poise.style.width = `${(e.poise / e.maxPoise) * 100}%`;
      b.el.classList.toggle('down', e.state === 'down');
      b.el.classList.toggle('boss', e.def.id === 'brute');
    }
    for (const [id, b] of this.bars) if (!g.enemies.list.some((e) => e.id === id)) { b.el.remove(); this.bars.delete(id); }

    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.t += dt;
      if (n.t >= n.life) { n.el.remove(); this.numPool.push(n.el); this.nums.splice(i, 1); continue; }
      const k = n.t / n.life;
      const s = this._project(n.pos);
      if (!s) { n.el.style.display = 'none'; continue; }
      n.el.style.display = '';
      n.el.style.opacity = String(1 - k * k);
      n.el.style.transform = `translate(${s.x}px, ${s.y - 40 * k - 10}px) translate(-50%, -50%) scale(${1 + (1 - k) * 0.25})`;
    }
  }
}
