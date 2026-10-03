// アイテム / 装備 / 宝珠 / レシピ / ドロップ / ショップの定義。バランス調整はここ。

export const RARITY = { common: '#c9d1d9', uncommon: '#6fdc8c', rare: '#5ab0ff', epic: '#c27bff' };

/** 消耗品 */
export const CONSUMABLES = {
  potion_s: { name: 'ポーション', desc: 'HPを50回復する。', heal: 50, price: 30, icon: '🧪' },
  potion_m: { name: 'ハイポーション', desc: 'HPを140回復する。', heal: 140, price: 110, icon: '⚗️' },
  ether: { name: 'エーテル', desc: 'MPを40回復する。', mp: 40, price: 60, icon: '💧' },
};

/** 素材 */
export const MATERIALS = {
  slime_gel: { name: 'ジェリーの粘液', desc: 'ぷるぷるした粘液。宝珠や防具の強化に使う。', icon: '🟢' },
  goblin_fang: { name: 'ゴブリンの牙', desc: '鋭い牙。武器の強化に使う。', icon: '🦷' },
  wisp_dust: { name: '霊光の粉', desc: '淡く光る粉。魔力の宝珠に使う。', icon: '✨' },
  stone_core: { name: '石の核', desc: '硬い核。高段階の強化に必須。', icon: '🪨' },
};

/** 貴重品 (売買不可) */
export const KEY_ITEMS = {
  ancient_map: { name: 'いにしえの地図', desc: '大陸の古地図。各地のエリアが記されている。', icon: '🗺️' },
};

/** 宝珠 (装備のスロットに装着) */
export const GEMS = {
  gem_str: { name: '力の宝珠', desc: '攻撃力 +4', stats: { atk: 4 }, icon: '🔴', color: '#ff6b6b' },
  gem_vit: { name: '命の宝珠', desc: '最大HP +25', stats: { hp: 25 }, icon: '🟠', color: '#ffa94d' },
  gem_def: { name: '守りの宝珠', desc: '防御力 +3', stats: { def: 3 }, icon: '🔵', color: '#5ab0ff' },
  gem_crit: { name: '閃きの宝珠', desc: 'クリティカル率 +2%', stats: { crit: 0.02 }, icon: '🟡', color: '#ffd23a' },
  gem_mind: { name: '魔の宝珠', desc: '最大MP +12', stats: { mp: 12 }, icon: '🟣', color: '#c27bff' },
  gem_agi: { name: '風の宝珠', desc: '移動速度 +3%', stats: { spd: 0.03 }, icon: '🟢', color: '#6fdc8c' },
};

/** 合成レシピ: 素材 → 宝珠 */
export const RECIPES = [
  { id: 'gem_str', mats: { goblin_fang: 4 }, gold: 80 },
  { id: 'gem_vit', mats: { slime_gel: 5 }, gold: 40 },
  { id: 'gem_def', mats: { stone_core: 3 }, gold: 120 },
  { id: 'gem_crit', mats: { wisp_dust: 5 }, gold: 80 },
  { id: 'gem_mind', mats: { wisp_dust: 3, slime_gel: 2 }, gold: 60 },
  { id: 'gem_agi', mats: { slime_gel: 4, wisp_dust: 2 }, gold: 60 },
];

/**
 * 装備。stats: atk / def / hp / mp / crit(率) / spd(移動速度の割合)。
 * sockets: 宝珠スロット数、price: 売値の基準 (強化費用にも使用)。
 */
export const EQUIPMENT = {
  iron_sword: { name: '鉄の剣', slot: 'weapon', rarity: 'common', stats: { atk: 6 }, sockets: 2, price: 100, desc: '旅人の標準的な剣。' },
  goblin_dagger: { name: 'ゴブリンの牙剣', slot: 'weapon', rarity: 'uncommon', stats: { atk: 10, crit: 0.05 }, sockets: 2, price: 260, desc: 'ゴブリンが使う歪んだ剣。会心が出やすい。' },
  steel_sword: { name: '鋼の剣', slot: 'weapon', rarity: 'uncommon', stats: { atk: 13 }, sockets: 2, price: 420, desc: 'しっかり鍛えられた鋼の剣。' },
  knight_sword: { name: '騎士の大剣', slot: 'weapon', rarity: 'rare', stats: { atk: 23, crit: 0.03 }, sockets: 3, price: 1500, desc: '古い騎士団の剣。重く、鋭い。' },

  travel_cloth: { name: '旅人の服', slot: 'armor', rarity: 'common', stats: { def: 2, hp: 10 }, sockets: 2, price: 60, desc: '動きやすい旅装。' },
  leather_armor: { name: '革の鎧', slot: 'armor', rarity: 'uncommon', stats: { def: 6, hp: 25 }, sockets: 2, price: 300, desc: 'なめした革で作った軽い鎧。' },
  iron_armor: { name: '鉄の鎧', slot: 'armor', rarity: 'rare', stats: { def: 12, hp: 50 }, sockets: 2, price: 1100, desc: '重いが頼れる全身鎧。' },

  power_ring: { name: '力の指輪', slot: 'accessory', rarity: 'uncommon', stats: { atk: 4 }, sockets: 1, price: 350, desc: '力が湧いてくる指輪。' },
  guard_ring: { name: '守りの指輪', slot: 'accessory', rarity: 'uncommon', stats: { def: 3, hp: 15 }, sockets: 1, price: 350, desc: '身を守る加護の指輪。' },
  wind_charm: { name: '疾風のお守り', slot: 'accessory', rarity: 'rare', stats: { spd: 0.08 }, sockets: 1, price: 500, desc: '足が軽くなるお守り。' },
};
export const SLOT_NAME = { weapon: '武器', armor: '防具', accessory: '装飾' };

/** ショップの品揃え */
export const SHOP = ['potion_s', 'potion_m', 'ether', 'steel_sword', 'leather_armor', 'power_ring', 'guard_ring', 'wind_charm'];
export const SELL_RATE = 0.4;

/** 強化: +1 ごとに基礎ステータス +12%。最大 +10。 */
export const MAX_PLUS = 10;
export const PLUS_RATE = 0.12;
const ENH_MATS = {
  weapon: { main: 'goblin_fang', rare: 'stone_core' },
  armor: { main: 'slime_gel', rare: 'stone_core' },
  accessory: { main: 'wisp_dust', rare: 'stone_core' },
};
/** 現在の強化値 plus → +1 にするためのコスト */
export function enhanceCost(base, plus) {
  const m = ENH_MATS[base.slot];
  const mats = {};
  mats[m.main] = 2 + Math.floor(plus * 0.9);
  if (plus >= 3) mats[m.rare] = 1 + Math.floor((plus - 3) / 2);
  return { gold: Math.round(base.price * 0.22 * Math.pow(plus + 1, 1.35)) + 20, mats };
}

/** 装備インスタンスの実効ステータス (強化・宝珠込み) */
export function equipStats(inst) {
  const base = EQUIPMENT[inst.base];
  const out = { atk: 0, def: 0, hp: 0, mp: 0, crit: 0, spd: 0 };
  const mul = 1 + PLUS_RATE * inst.plus;
  for (const [k, v] of Object.entries(base.stats)) out[k] += v * mul;
  for (const g of inst.gems) if (g) for (const [k, v] of Object.entries(GEMS[g].stats)) out[k] += v;
  return out;
}

/** 敵ごとのドロップ。chance は 0-1、n は [最小, 最大] */
export const DROPS = {
  gel: { gold: [3, 7], items: [{ id: 'slime_gel', chance: 0.7, n: [1, 2] }, { id: 'potion_s', chance: 0.08, n: [1, 1] }] },
  goblin: { gold: [8, 15], items: [{ id: 'goblin_fang', chance: 0.55, n: [1, 2] }, { id: 'potion_s', chance: 0.1, n: [1, 1] }, { id: 'goblin_dagger', chance: 0.03, n: [1, 1] }, { id: 'leather_armor', chance: 0.015, n: [1, 1] }] },
  wisp: { gold: [10, 18], items: [{ id: 'wisp_dust', chance: 0.6, n: [1, 2] }, { id: 'ether', chance: 0.12, n: [1, 1] }] },
  brute: { gold: [55, 80], items: [{ id: 'stone_core', chance: 1, n: [1, 2] }, { id: 'potion_m', chance: 0.4, n: [1, 1] }, { id: 'iron_armor', chance: 0.2, n: [1, 1] }, { id: 'knight_sword', chance: 0.12, n: [1, 1] }] },
};

/** 任意の ID から表示用情報を引く */
export function itemInfo(id) {
  return CONSUMABLES[id] && { ...CONSUMABLES[id], kind: 'consumable' }
    || MATERIALS[id] && { ...MATERIALS[id], kind: 'material' }
    || KEY_ITEMS[id] && { ...KEY_ITEMS[id], kind: 'key' }
    || GEMS[id] && { ...GEMS[id], kind: 'gem' }
    || EQUIPMENT[id] && { ...EQUIPMENT[id], kind: 'equipment', icon: { weapon: '🗡️', armor: '🛡️', accessory: '💍' }[EQUIPMENT[id].slot] }
    || { name: id, desc: '', kind: 'unknown', icon: '❔' };
}
