import { ALLOC, MAX_LEVEL, POINTS_PER_LEVEL, baseStats, expToNext, expMultiplier } from '../data/skills.js';
import { EQUIPMENT, equipStats } from '../data/items.js';

/**
 * 経験値・レベル・ステータス割り振り・最終ステータス計算。
 *   最終値 = レベル基礎 + 割り振り + 装備(強化/宝珠込み)
 * recalc() で player.stats に反映する (HP/MP は上限増加分だけ加算、減少時はクランプ)。
 */
export class Progression {
  constructor(game) {
    this.game = game;
    this.reset();
    game.bus.on('inventory:changed', () => this.recalc());
  }

  reset() {
    this.level = 1; this.exp = 0; this.points = 0;
    this.alloc = { vit: 0, str: 0, def: 0, agi: 0 };
  }

  get expNeed() { return this.level >= MAX_LEVEL ? Infinity : expToNext(this.level); }

  gainExp(n) {
    if (this.level >= MAX_LEVEL || n <= 0) return 0;
    this.exp += n;
    let ups = 0;
    while (this.level < MAX_LEVEL && this.exp >= expToNext(this.level)) {
      this.exp -= expToNext(this.level); this.level++; this.points += POINTS_PER_LEVEL; ups++;
    }
    if (this.level >= MAX_LEVEL) this.exp = 0;
    if (ups) {
      this.recalc(true);
      this.game.bus.emit('player:levelup', { level: this.level, ups });
    }
    return ups;
  }

  expFor(enemyDef) { return Math.max(1, Math.round(enemyDef.exp * expMultiplier(this.level, enemyDef.level))); }

  allocate(key) {
    if (this.points <= 0 || !ALLOC[key]) return false;
    this.points--; this.alloc[key]++; this.recalc(); return true;
  }
  /** 割り振りを全リセット (費用: レベル×20G) */
  respecCost() { return this.level * 20; }
  respec() {
    const inv = this.game.inventory, spent = Object.values(this.alloc).reduce((a, b) => a + b, 0);
    if (!spent || !inv.spendGold(this.respecCost())) return false;
    this.points += spent; this.alloc = { vit: 0, str: 0, def: 0, agi: 0 }; this.recalc(); return true;
  }

  /** 最終ステータスを計算して返す (副作用なし) */
  compute() {
    const b = baseStats(this.level), a = this.alloc;
    const s = { hp: b.hp + a.vit * ALLOC.vit.per, mp: b.mp, atk: b.atk + a.str * ALLOC.str.per, def: b.def + a.def * ALLOC.def.per, crit: b.crit + a.agi * 0.004, spd: a.agi * 0.01 };
    const inv = this.game.inventory;
    for (const slot of ['weapon', 'armor', 'accessory']) {
      const inst = inv.equippedInst(slot);
      if (!inst) continue;
      const e = equipStats(inst);
      s.atk += e.atk; s.def += e.def; s.hp += e.hp; s.mp += e.mp; s.crit += e.crit; s.spd += e.spd;
    }
    return s;
  }

  recalc(fullHeal = false) {
    const st = this.game.player.stats, s = this.compute();
    const oldHp = st.maxHp, oldMp = st.maxMp;
    st.maxHp = Math.round(s.hp); st.maxMp = Math.round(s.mp);
    st.level = this.level; st.atk = s.atk; st.def = s.def; st.crit = Math.min(0.75, s.crit); st.spdBonus = s.spd;
    if (fullHeal) { st.hp = st.maxHp; st.mp = st.maxMp; }
    else {
      st.hp = Math.min(st.maxHp, st.hp + Math.max(0, st.maxHp - oldHp));
      st.mp = Math.min(st.maxMp, st.mp + Math.max(0, st.maxMp - oldMp));
    }
    this.game.bus.emit('stats:changed');
  }

  toJSON() { return { level: this.level, exp: this.exp, points: this.points, alloc: this.alloc }; }
  fromJSON(d) {
    this.reset();
    this.level = Math.min(MAX_LEVEL, Math.max(1, d.level | 0));
    this.exp = Math.max(0, d.exp | 0); this.points = Math.max(0, d.points | 0);
    for (const k of Object.keys(this.alloc)) this.alloc[k] = Math.max(0, d.alloc?.[k] | 0);
    this.recalc(false);
  }
}
