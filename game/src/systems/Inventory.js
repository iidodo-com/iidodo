import { CONSUMABLES, EQUIPMENT, GEMS, RECIPES, MAX_PLUS, enhanceCost, SELL_RATE, itemInfo } from '../data/items.js';

/**
 * 所持品。スタック可能なアイテム (消耗品/素材/宝珠/貴重品) は ID→個数、
 * 装備は強化値と宝珠を持つインスタンス ({uid, base, plus, gems[]}) として管理する。
 * 変更は 'inventory:changed' で通知 (UI・オートセーブが購読)。
 */
export class Inventory {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }

  reset() {
    this.gold = 0;
    this.items = {};
    this.equipment = [];
    this.equipped = { weapon: null, armor: null, accessory: null };
    this.nextUid = 1;
  }

  newGame() {
    this.reset();
    this.gold = 50;
    this.add('potion_s', 3);
    this.add('ancient_map', 1);
    const w = this.addEquip('iron_sword'), a = this.addEquip('travel_cloth');
    this.equipped.weapon = w.uid; this.equipped.armor = a.uid;
    this._changed();
  }

  _changed() { this.bus.emit('inventory:changed'); }

  count(id) { return this.items[id] || 0; }
  add(id, n = 1) { this.items[id] = this.count(id) + n; this._changed(); }
  remove(id, n = 1) {
    if (this.count(id) < n) return false;
    this.items[id] -= n; if (this.items[id] <= 0) delete this.items[id];
    this._changed(); return true;
  }
  addGold(n) { this.gold += n; this._changed(); }
  spendGold(n) { if (this.gold < n) return false; this.gold -= n; this._changed(); return true; }

  addEquip(base) {
    const inst = { uid: this.nextUid++, base, plus: 0, gems: new Array(EQUIPMENT[base].sockets).fill(null) };
    this.equipment.push(inst); this._changed();
    return inst;
  }
  getEquip(uid) { return this.equipment.find((e) => e.uid === uid) || null; }
  equippedInst(slot) { return this.getEquip(this.equipped[slot]); }
  isEquipped(uid) { return Object.values(this.equipped).includes(uid); }

  equip(uid) {
    const inst = this.getEquip(uid); if (!inst) return false;
    this.equipped[EQUIPMENT[inst.base].slot] = uid; this._changed(); return true;
  }
  unequip(slot) { this.equipped[slot] = null; this._changed(); }

  /** 装備を売る (装備中は不可) */
  sellEquip(uid) {
    const inst = this.getEquip(uid);
    if (!inst || this.isEquipped(uid)) return false;
    const v = this.sellValue(inst);
    this.equipment = this.equipment.filter((e) => e.uid !== uid);
    for (const g of inst.gems) if (g) this.items[g] = this.count(g) + 1;
    this.gold += v; this._changed(); return v;
  }
  sellValue(inst) { return Math.round(EQUIPMENT[inst.base].price * SELL_RATE * (1 + inst.plus * 0.35)); }

  // ---- 強化 ----
  canEnhance(inst) {
    if (inst.plus >= MAX_PLUS) return { ok: false, reason: '最大まで強化済み' };
    const c = enhanceCost(EQUIPMENT[inst.base], inst.plus);
    if (this.gold < c.gold) return { ok: false, cost: c, reason: 'ゴールドが足りない' };
    for (const [m, n] of Object.entries(c.mats)) if (this.count(m) < n) return { ok: false, cost: c, reason: '素材が足りない' };
    return { ok: true, cost: c };
  }
  enhance(uid) {
    const inst = this.getEquip(uid); if (!inst) return false;
    const r = this.canEnhance(inst); if (!r.ok) return false;
    this.gold -= r.cost.gold;
    for (const [m, n] of Object.entries(r.cost.mats)) { this.items[m] -= n; if (this.items[m] <= 0) delete this.items[m]; }
    inst.plus++; this._changed(); return true;
  }

  // ---- 宝珠合成 / 装着 ----
  canCraft(recipe) {
    if (this.gold < recipe.gold) return false;
    return Object.entries(recipe.mats).every(([m, n]) => this.count(m) >= n);
  }
  craft(id) {
    const r = RECIPES.find((x) => x.id === id);
    if (!r || !this.canCraft(r)) return false;
    this.gold -= r.gold;
    for (const [m, n] of Object.entries(r.mats)) { this.items[m] -= n; if (this.items[m] <= 0) delete this.items[m]; }
    this.items[id] = this.count(id) + 1; this._changed(); return true;
  }
  socketGem(uid, gemId) {
    const inst = this.getEquip(uid);
    if (!inst || !GEMS[gemId] || this.count(gemId) < 1) return false;
    const i = inst.gems.indexOf(null); if (i < 0) return false;
    inst.gems[i] = gemId; this.items[gemId]--; if (this.items[gemId] <= 0) delete this.items[gemId];
    this._changed(); return true;
  }
  /** 宝珠を外す (手数料 50G、宝珠は返却) */
  removeGem(uid, idx) {
    const inst = this.getEquip(uid);
    if (!inst || !inst.gems[idx] || this.gold < 50) return false;
    this.gold -= 50; this.items[inst.gems[idx]] = this.count(inst.gems[idx]) + 1; inst.gems[idx] = null;
    this._changed(); return true;
  }

  // ---- ショップ ----
  buyPrice(id) { return itemInfo(id).price; }
  buy(id) {
    const info = itemInfo(id), price = info.price;
    if (!price || this.gold < price) return false;
    this.gold -= price;
    if (info.kind === 'equipment') this.addEquip(id); else this.add(id, 1);
    this._changed(); return true;
  }
  sellItem(id, n = 1) {
    const info = itemInfo(id);
    if (info.kind === 'key' || this.count(id) < n) return false;
    const unit = info.price ? Math.round(info.price * SELL_RATE) : info.kind === 'material' ? 6 : 20;
    this.remove(id, n); this.gold += unit * n; this._changed(); return unit * n;
  }

  // ---- 永続化 ----
  toJSON() { return { gold: this.gold, items: this.items, equipment: this.equipment, equipped: this.equipped, nextUid: this.nextUid }; }
  fromJSON(d) {
    this.reset();
    this.gold = d.gold | 0;
    for (const [k, v] of Object.entries(d.items || {})) if (itemInfo(k).kind !== 'unknown' && v > 0) this.items[k] = v | 0;
    this.equipment = (d.equipment || []).filter((e) => EQUIPMENT[e.base]).map((e) => ({
      uid: e.uid, base: e.base, plus: Math.min(MAX_PLUS, e.plus | 0),
      gems: Array.from({ length: EQUIPMENT[e.base].sockets }, (_, i) => (GEMS[e.gems?.[i]] ? e.gems[i] : null)),
    }));
    for (const s of Object.keys(this.equipped)) this.equipped[s] = this.getEquip(d.equipped?.[s])?.uid ?? null;
    this.nextUid = Math.max(d.nextUid | 0, ...this.equipment.map((e) => e.uid + 1), 1);
    this._changed();
  }
}
