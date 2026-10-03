// アイテム / 装備 / 宝珠 / レシピ / ドロップ / ショップの定義。バランス調整はここ。

export const RARITY = { common: '#c9d1d9', uncommon: '#6fdc8c', rare: '#5ab0ff', epic: '#c27bff' };

/** 消耗品 */
export const CONSUMABLES = {
  potion_s: { name: 'ポーション', desc: 'HPを50回復する。', heal: 50, price: 30, icon: '🧪' },
  potion_m: { name: 'ハイポーション', desc: 'HPを140回復する。', heal: 140, price: 110, icon: '⚗️' },
  potion_l: { name: 'エリクサー', desc: 'HPを380回復する。', heal: 380, price: 300, icon: '🍷' },
  ether: { name: 'エーテル', desc: 'MPを40回復する。', mp: 40, price: 60, icon: '💧' },
  ether_l: { name: 'ハイエーテル', desc: 'MPを110回復する。', mp: 110, price: 170, icon: '🔷' },
};

/** 素材 */
export const MATERIALS = {
  slime_gel: { name: 'ジェリーの粘液', desc: 'ぷるぷるした粘液。宝珠や防具の強化に使う。', icon: '🟢' },
  goblin_fang: { name: 'ゴブリンの牙', desc: '鋭い牙。武器の強化に使う。', icon: '🦷' },
  wisp_dust: { name: '霊光の粉', desc: '淡く光る粉。魔力の宝珠に使う。', icon: '✨' },
  stone_core: { name: '石の核', desc: '硬い核。高段階の強化に必須。', icon: '🪨' },
  ruin_shard: { name: '遺跡の欠片', desc: '古い遺跡の欠片。上位の宝珠の合成に使う。', icon: '🧩' },
  cave_crystal: { name: '洞窟水晶', desc: '青く光る水晶。+6以上の強化に必要。', icon: '💎' },
  lab_circuit: { name: '魔導回路', desc: '研究所の回路基板。+9以上の強化や上位宝珠に使う。', icon: '🔌' },
  sky_feather: { name: '天空の羽', desc: '風をまとう羽。上位宝珠の合成に使う。', icon: '🪶' },
};

/** 貴重品 (売買不可) */
export const KEY_ITEMS = {
  ancient_map: { name: 'いにしえの地図', desc: '大陸の古地図。各地のエリアが記されている。', icon: '🗺️' },
  plains_key: { name: '森の鍵', desc: 'ゴブリンキングが持っていた鍵。平原の門を開ける。', icon: '🗝️' },
  ruins_key: { name: '石の鍵', desc: '守護像の胸から出てきた鍵。廃墟の門を開ける。', icon: '🗝️' },
  cave_key: { name: '水晶の核', desc: 'クリスタルゴーレムの核。洞窟の扉を開ける。', icon: '🔮' },
  lab_key: { name: '認証コア', desc: 'センチネルの認証コア。転送ゲートを起動する。', icon: '💠' },
  royal_crest: { name: '王の証', desc: 'ヴォイドが持っていた王の証。世界に光が戻った証。', icon: '👑' },
  sky_key: { name: '風の紋章', desc: 'ウィンドロードの紋章。王の間の封印と共鳴する。', icon: '🏵️' },
};

/** 宝珠 (装備のスロットに装着) */
export const GEMS = {
  gem_str: { name: '力の宝珠', desc: '攻撃力 +4', stats: { atk: 4 }, icon: '🔴', color: '#ff6b6b' },
  gem_vit: { name: '命の宝珠', desc: '最大HP +25', stats: { hp: 25 }, icon: '🟠', color: '#ffa94d' },
  gem_def: { name: '守りの宝珠', desc: '防御力 +3', stats: { def: 3 }, icon: '🔵', color: '#5ab0ff' },
  gem_crit: { name: '閃きの宝珠', desc: 'クリティカル率 +2%', stats: { crit: 0.02 }, icon: '🟡', color: '#ffd23a' },
  gem_mind: { name: '魔の宝珠', desc: '最大MP +12', stats: { mp: 12 }, icon: '🟣', color: '#c27bff' },
  gem_agi: { name: '風の宝珠', desc: '移動速度 +3%', stats: { spd: 0.03 }, icon: '🟢', color: '#6fdc8c' },
  gem_str2: { name: '大力の宝珠', desc: '攻撃力 +10', stats: { atk: 10 }, icon: '❤️', color: '#ff3b3b' },
  gem_vit2: { name: '大命の宝珠', desc: '最大HP +70', stats: { hp: 70 }, icon: '🧡', color: '#ff8a2a' },
};

/** 合成レシピ: 素材 → 宝珠 */
export const RECIPES = [
  { id: 'gem_str', mats: { goblin_fang: 4 }, gold: 80 },
  { id: 'gem_vit', mats: { slime_gel: 5 }, gold: 40 },
  { id: 'gem_def', mats: { stone_core: 3 }, gold: 120 },
  { id: 'gem_crit', mats: { wisp_dust: 5 }, gold: 80 },
  { id: 'gem_mind', mats: { wisp_dust: 3, slime_gel: 2 }, gold: 60 },
  { id: 'gem_agi', mats: { slime_gel: 4, wisp_dust: 2 }, gold: 60 },
  { id: 'gem_str2', mats: { ruin_shard: 3, lab_circuit: 1 }, gold: 400 },
  { id: 'gem_vit2', mats: { sky_feather: 3, cave_crystal: 2 }, gold: 500 },
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

  crystal_blade: { name: '水晶の刃', slot: 'weapon', rarity: 'rare', stats: { atk: 38, crit: 0.06 }, sockets: 3, price: 3200, desc: '洞窟の水晶から削り出した刃。' },
  plasma_saber: { name: 'プラズマセイバー', slot: 'weapon', rarity: 'epic', stats: { atk: 56, crit: 0.08 }, sockets: 3, price: 6500, desc: '研究所が生んだ光の剣。' },
  wind_blade: { name: '風切りの剣', slot: 'weapon', rarity: 'epic', stats: { atk: 78, crit: 0.1, spd: 0.05 }, sockets: 4, price: 12000, desc: '空の城に伝わる風の剣。' },
  mithril_armor: { name: 'ミスリルの鎧', slot: 'armor', rarity: 'rare', stats: { def: 24, hp: 100 }, sockets: 3, price: 3000, desc: '軽くて硬い銀の鎧。' },
  sky_plate: { name: '天空の鎧', slot: 'armor', rarity: 'epic', stats: { def: 48, hp: 220 }, sockets: 3, price: 11000, desc: '空の騎士が纏った白銀の鎧。' },
  arc_ring: { name: '魔導の指輪', slot: 'accessory', rarity: 'rare', stats: { atk: 12, mp: 30 }, sockets: 1, price: 2400, desc: '魔力が脈打つ指輪。' },
  zephyr_charm: { name: '天風の護符', slot: 'accessory', rarity: 'epic', stats: { spd: 0.14, crit: 0.06 }, sockets: 1, price: 6000, desc: '風と共に走る者の護符。' },
  void_blade: { name: '虚空の剣', slot: 'weapon', rarity: 'epic', stats: { atk: 118, crit: 0.14, spd: 0.04 }, sockets: 4, price: 30000, desc: '深淵の主から得た、闇を裂く剣。' },
  void_plate: { name: '虚空の鎧', slot: 'armor', rarity: 'epic', stats: { def: 74, hp: 360 }, sockets: 4, price: 28000, desc: '深淵の闇を織り込んだ鎧。' },
  void_charm: { name: '虚空の護符', slot: 'accessory', rarity: 'epic', stats: { spd: 0.2, crit: 0.12, atk: 20 }, sockets: 2, price: 22000, desc: '触れる者の限界を引き出す護符。' },
  power_ring: { name: '力の指輪', slot: 'accessory', rarity: 'uncommon', stats: { atk: 4 }, sockets: 1, price: 350, desc: '力が湧いてくる指輪。' },
  guard_ring: { name: '守りの指輪', slot: 'accessory', rarity: 'uncommon', stats: { def: 3, hp: 15 }, sockets: 1, price: 350, desc: '身を守る加護の指輪。' },
  wind_charm: { name: '疾風のお守り', slot: 'accessory', rarity: 'rare', stats: { spd: 0.08 }, sockets: 1, price: 500, desc: '足が軽くなるお守り。' },
};
export const SLOT_NAME = { weapon: '武器', armor: '防具', accessory: '装飾' };

/** ショップの品揃え */
/** ショップ: minArea = そのエリア (index) に到達済みなら販売 */
export const SHOP = [
  { id: 'potion_s', minArea: 0 }, { id: 'potion_m', minArea: 0 }, { id: 'ether', minArea: 0 },
  { id: 'steel_sword', minArea: 0 }, { id: 'leather_armor', minArea: 0 }, { id: 'power_ring', minArea: 0 }, { id: 'guard_ring', minArea: 0 }, { id: 'wind_charm', minArea: 1 },
  { id: 'potion_l', minArea: 2 }, { id: 'ether_l', minArea: 2 }, { id: 'knight_sword', minArea: 1 }, { id: 'iron_armor', minArea: 1 },
  { id: 'mithril_armor', minArea: 3 }, { id: 'crystal_blade', minArea: 3 }, { id: 'arc_ring', minArea: 3 },
];
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
  // 段階が上がるほど上位エリアの素材が必要になる
  if (plus >= 9) mats.lab_circuit = 1 + (plus - 9);
  else if (plus >= 6) mats.cave_crystal = 1 + Math.floor((plus - 6) / 2);
  else if (plus >= 3) mats[m.rare] = 1 + Math.floor((plus - 3) / 2);
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
const D = (gold, items) => ({ gold, items });
export const DROPS = {
  archon: D([5000, 6000], [{ id: 'royal_crest', chance: 1, n: [1, 1] }, { id: 'potion_l', chance: 1, n: [5, 6] }, { id: 'sky_feather', chance: 1, n: [5, 6] }]),
  abyss_lord: D([6000, 7000], [{ id: 'void_blade', chance: 1, n: [1, 1] }, { id: 'void_plate', chance: 0.7, n: [1, 1] }, { id: 'void_charm', chance: 0.5, n: [1, 1] }, { id: 'lab_circuit', chance: 1, n: [5, 6] }]),
  goblin_king: D([200, 260], [{ id: 'plains_key', chance: 1, n: [1, 1] }, { id: 'goblin_dagger', chance: 0.5, n: [1, 1] }, { id: 'potion_m', chance: 1, n: [2, 3] }, { id: 'stone_core', chance: 1, n: [2, 3] }]),
  skeleton: D([20, 34], [{ id: 'ruin_shard', chance: 0.35, n: [1, 1] }, { id: 'goblin_fang', chance: 0.4, n: [1, 2] }, { id: 'potion_m', chance: 0.1, n: [1, 1] }]),
  wraith: D([24, 40], [{ id: 'wisp_dust', chance: 0.6, n: [1, 3] }, { id: 'ether', chance: 0.15, n: [1, 1] }, { id: 'ruin_shard', chance: 0.25, n: [1, 1] }]),
  rubble_golem: D([50, 80], [{ id: 'stone_core', chance: 0.9, n: [1, 2] }, { id: 'ruin_shard', chance: 0.6, n: [1, 2] }, { id: 'potion_m', chance: 0.3, n: [1, 1] }]),
  stone_warden: D([450, 600], [{ id: 'ruins_key', chance: 1, n: [1, 1] }, { id: 'knight_sword', chance: 0.6, n: [1, 1] }, { id: 'ruin_shard', chance: 1, n: [3, 4] }, { id: 'potion_l', chance: 1, n: [1, 2] }]),
  bat: D([40, 60], [{ id: 'slime_gel', chance: 0.4, n: [1, 2] }, { id: 'cave_crystal', chance: 0.12, n: [1, 1] }]),
  cave_slime: D([50, 70], [{ id: 'slime_gel', chance: 0.7, n: [2, 3] }, { id: 'cave_crystal', chance: 0.25, n: [1, 1] }]),
  cave_goblin: D([60, 90], [{ id: 'goblin_fang', chance: 0.6, n: [2, 3] }, { id: 'cave_crystal', chance: 0.3, n: [1, 1] }, { id: 'potion_l', chance: 0.06, n: [1, 1] }]),
  crystal_wisp: D([60, 90], [{ id: 'wisp_dust', chance: 0.6, n: [2, 3] }, { id: 'cave_crystal', chance: 0.35, n: [1, 2] }, { id: 'ether_l', chance: 0.1, n: [1, 1] }]),
  crystal_golem: D([900, 1200], [{ id: 'cave_key', chance: 1, n: [1, 1] }, { id: 'cave_crystal', chance: 1, n: [4, 5] }, { id: 'crystal_blade', chance: 0.5, n: [1, 1] }, { id: 'potion_l', chance: 1, n: [2, 3] }]),
  drone: D([90, 130], [{ id: 'lab_circuit', chance: 0.3, n: [1, 1] }, { id: 'stone_core', chance: 0.3, n: [1, 1] }]),
  sentry: D([100, 140], [{ id: 'lab_circuit', chance: 0.4, n: [1, 1] }, { id: 'ether_l', chance: 0.12, n: [1, 1] }]),
  construct: D([140, 200], [{ id: 'lab_circuit', chance: 0.6, n: [1, 2] }, { id: 'stone_core', chance: 0.5, n: [1, 2] }, { id: 'potion_l', chance: 0.12, n: [1, 1] }]),
  pylon: D([0, 0], []),
  iron_sentinel: D([1500, 1900], [{ id: 'lab_key', chance: 1, n: [1, 1] }, { id: 'lab_circuit', chance: 1, n: [4, 5] }, { id: 'plasma_saber', chance: 0.5, n: [1, 1] }, { id: 'potion_l', chance: 1, n: [3, 4] }]),
  harpy: D([140, 190], [{ id: 'sky_feather', chance: 0.45, n: [1, 2] }, { id: 'potion_l', chance: 0.08, n: [1, 1] }]),
  sky_knight: D([180, 240], [{ id: 'sky_feather', chance: 0.5, n: [1, 2] }, { id: 'lab_circuit', chance: 0.25, n: [1, 1] }, { id: 'ether_l', chance: 0.15, n: [1, 1] }]),
  seraph: D([180, 240], [{ id: 'sky_feather', chance: 0.55, n: [1, 3] }, { id: 'ether_l', chance: 0.2, n: [1, 1] }]),
  gargoyle: D([220, 300], [{ id: 'stone_core', chance: 0.8, n: [2, 3] }, { id: 'sky_feather', chance: 0.4, n: [1, 1] }, { id: 'potion_l', chance: 0.2, n: [1, 1] }]),
  wind_lord: D([2600, 3200], [{ id: 'sky_key', chance: 1, n: [1, 1] }, { id: 'sky_feather', chance: 1, n: [4, 6] }, { id: 'wind_blade', chance: 0.5, n: [1, 1] }, { id: 'potion_l', chance: 1, n: [4, 5] }]),
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
