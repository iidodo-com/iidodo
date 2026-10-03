import { SKILLS } from '../data/skills.js';

export const RANKS = ['D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
const TH = [0, 40, 100, 190, 300, 450, 650];
const NAMES = ['', 'Cool', 'Bold', 'Awesome', 'Savage', 'Sensational', 'Stylish!!'];

/**
 * スタイルランク: 攻撃を当て続け・技を使い分け・ジャスト回避/カウンター/ブレイクを決めるほど上がり、
 * ダメージ倍率が最大 +36% (SSS)。被弾で半減、放置で減衰。上手い人ほど火力が出る設計。
 */
export class Style {
  constructor(game) {
    this.game = game;
    this.pts = 0; this.rank = -1; this.hits = 0; this.hitT = 0; this.recent = []; this.fresh = true; this.total = 0;
    this.el = document.getElementById('style');
    this.elRank = this.el.querySelector('.sr'); this.elBar = this.el.querySelector('.sb i'); this.elHits = this.el.querySelector('.sh'); this.elName = this.el.querySelector('.sn');
    const on = (e, f) => game.bus.on(e, f);
    on('player:swing', ({ combo }) => this._tag(`a${combo}`));
    on('player:skillCast', ({ def }) => this._tag(`s${def.id}`));
    on('enemy:hit', ({ crit, downed, killed, dmg }) => {
      this.hits++; this.hitT = 3.6; this.total += dmg;
      let p = 9 + (crit ? 5 : 0) + (killed ? 14 : 0) + (downed ? 18 : 0);
      if (this.game.player.airborne) p += 6;
      this.add(p * (this.fresh ? 1.5 : 0.65));
    });
    on('player:justDodge', () => this.add(70));
    on('enemy:execute', () => this.add(45));
    on('player:hurt', () => { this.pts *= 0.5; this.hits = 0; this._sync(); });
    on('player:dead', () => this.reset());
    on('area:changed', () => this.reset());
  }

  get mult() { return 1 + Math.max(0, this.rank) * 0.06; }

  _tag(t) {
    this.fresh = !this.recent.includes(t);
    this.recent.push(t); if (this.recent.length > 3) this.recent.shift();
  }

  add(p) { this.pts = Math.min(780, this.pts + p); this._sync(); }

  reset() { this.pts = 0; this.rank = -1; this.hits = 0; this.recent = []; this.total = 0; this._sync(); }

  update(dt) {
    if (this.pts <= 0) return;
    this.hitT -= dt;
    if (this.hitT <= 0) { this.hits = 0; this.total = 0; }
    this.pts = Math.max(0, this.pts - dt * (4 + Math.max(0, this.rank) * 4.5) * (this.hitT > 0 ? 0.35 : 1));
    this._sync();
  }

  _sync() {
    let r = -1; for (let i = 0; i < TH.length; i++) if (this.pts >= TH[i] + (i ? 0 : 8)) r = i;
    const up = r > this.rank && r >= 0;
    const prev = this.rank; this.rank = r;
    const show = r >= 0;
    this.el.classList.toggle('show', show);
    if (!show) return;
    const lo = TH[r], hi = TH[r + 1] ?? lo + 100;
    this.elBar.style.width = `${Math.min(100, ((this.pts - lo) / (hi - lo)) * 100)}%`;
    this.elHits.textContent = this.hits > 1 ? `${this.hits} HITS` : '';
    if (r !== prev) {
      this.elRank.textContent = RANKS[r]; this.elName.textContent = NAMES[r];
      this.el.dataset.rank = RANKS[r];
      this.elRank.classList.remove('pop'); void this.elRank.offsetWidth; this.elRank.classList.add('pop');
      if (up) this.game.bus.emit('style:rank', { rank: RANKS[r], idx: r });
    }
  }
}
