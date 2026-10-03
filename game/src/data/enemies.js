// 敵データ。バランス調整はここだけ触ればよい。
// attack.kind: 'lunge' (突進) | 'swing' (扇形近接) | 'slam' (範囲叩きつけ) | 'bolt' (遠距離弾)
// 角度は rad (半角)。時間は秒。
export const ENEMIES = {
  gel: {
    id: 'gel', name: 'ジェリー', level: 1,
    hp: 34, atk: 8, def: 1, speed: 3.4, radius: 0.7, detect: 11, poise: 18, exp: 8, gold: 4,
    ai: 'melee',
    attack: { kind: 'lunge', range: 2.6, arc: 0.6, windup: 0.75, active: 0.28, recover: 0.9, cd: [1.2, 2.2], mul: 1.0, lunge: 6, knock: 5 },
  },
  goblin: {
    id: 'goblin', name: 'ゴブリン', level: 2,
    scale: 1.3, hp: 56, atk: 12, def: 3, speed: 4.0, radius: 0.5, detect: 13, poise: 26, exp: 14, gold: 8,
    ai: 'melee',
    attack: { kind: 'swing', range: 2.4, arc: 0.95, windup: 0.62, active: 0.2, recover: 0.8, cd: [1.4, 2.6], mul: 1.0, knock: 5 },
  },
  wisp: {
    id: 'wisp', name: 'ウィスプ', level: 3,
    scale: 1.25, hp: 32, atk: 13, def: 0, speed: 3.0, radius: 0.5, detect: 17, poise: 14, exp: 16, gold: 10, hover: 1.4,
    ai: 'ranged', keep: [7, 11],
    attack: { kind: 'bolt', range: 15, arc: 0.07, windup: 0.95, active: 0.1, recover: 1.0, cd: [2.4, 3.6], mul: 1.0, speed: 13, knock: 3 },
  },
  brute: {
    id: 'brute', name: 'ストーンブルート', level: 5,
    hp: 200, atk: 24, def: 9, speed: 2.5, radius: 1.15, detect: 15, poise: 70, exp: 70, gold: 60, superArmor: true,
    ai: 'melee',
    attack: { kind: 'slam', range: 4.0, radius: 3.9, arc: Math.PI, windup: 1.2, active: 0.2, recover: 1.5, cd: [2.2, 3.4], mul: 1.4, knock: 9 },
  },
};

// 拠点 (キャンプ) 配置。dist = 初期位置からの距離、types = 出現する敵。
export const CAMPS = [
  { dist: 30, types: ['gel', 'gel', 'gel'] },
  { dist: 46, types: ['gel', 'goblin', 'goblin'] },
  { dist: 62, types: ['goblin', 'goblin', 'wisp'] },
  { dist: 78, types: ['goblin', 'wisp', 'wisp', 'gel'] },
  { dist: 92, types: ['brute', 'goblin', 'goblin'] },
];

// プレイヤー攻撃の判定 (コンボ段ごと)。range は敵の半径を除いた射程。
export const PLAYER_ATTACKS = [
  { range: 2.7, arc: 1.15, mul: 1.0, knock: 3.5, poise: 10, shake: 0.12 },
  { range: 2.7, arc: 1.15, mul: 1.1, knock: 3.5, poise: 11, shake: 0.14 },
  { range: 3.4, arc: 1.6,  mul: 1.7, knock: 8,   poise: 24, shake: 0.3 },
];
