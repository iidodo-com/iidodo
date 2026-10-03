// アクティブスキル。slot はキー 1-3 / 画面ボタンに対応。
export const SKILLS = [
  {
    id: 'whirl', slot: 1, name: '旋風斬', unlock: 3, mp: 12, cd: 5, cast: 0.55, hitAt: 0.3,
    kind: 'aoe', mul: 1.7, radius: 3.8, knock: 8, poise: 30,
    desc: '周囲の敵を回転斬りで薙ぎ払う範囲攻撃。',
  },
  {
    id: 'cry', slot: 2, name: '闘気解放', unlock: 6, mp: 18, cd: 22, cast: 0.5, hitAt: 0.2,
    kind: 'buff', atk: 0.35, spd: 0.2, dur: 12,
    desc: '12秒間、攻撃力+35%・移動速度+20%。',
  },
  {
    id: 'bolt', slot: 3, name: '魔導閃', unlock: 9, mp: 16, cd: 6, cast: 0.5, hitAt: 0.28,
    kind: 'projectile', mul: 2.4, range: 17, speed: 30, width: 0.9, knock: 4, poise: 22,
    desc: '直線上の敵を貫く遠距離魔法。',
  },
];

// ---- 成長 ----
export const MAX_LEVEL = 30;
export const POINTS_PER_LEVEL = 2;
/** Lv → 次のレベルまでに必要な経験値 */
export const expToNext = (lv) => Math.round(18 * Math.pow(lv, 1.55) + 10 * lv);
/** レベルによる基礎ステータス (自動上昇分) */
export function baseStats(lv) {
  return { hp: 100 + 14 * (lv - 1), mp: 50 + 4 * (lv - 1), atk: 12 + 2.4 * (lv - 1), def: 3 + 1.3 * (lv - 1), crit: 0.05, spd: 0 };
}
/** 割り振りポイント1あたりの上昇量 */
export const ALLOC = {
  vit: { name: '体力', desc: '最大HP +10', stat: 'hp', per: 10 },
  str: { name: '腕力', desc: '攻撃力 +1.6', stat: 'atk', per: 1.6 },
  def: { name: '耐久', desc: '防御力 +1.1', stat: 'def', per: 1.1 },
  agi: { name: '敏捷', desc: '移動速度 +1% / 会心 +0.4%', stat: 'agi', per: 1 },
};
/** 格下の敵からは経験値が減る */
export function expMultiplier(playerLv, enemyLv) {
  const diff = playerLv - enemyLv;
  if (diff <= 3) return 1;
  return Math.max(0.1, 1 - (diff - 3) * 0.2);
}
