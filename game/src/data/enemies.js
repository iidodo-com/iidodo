// 敵データ。バランス調整はここだけ触ればよい。
// attack.kind: 'lunge' (突進) | 'swing' (扇形近接) | 'slam' (範囲叩きつけ) | 'bolt' (遠距離弾)
// 角度は rad (半角)。時間は秒。
const _ENEMIES = {
  gel: {
    id: 'gel', name: 'ジェリー', level: 1,
    hp: 34, atk: 8, def: 1, speed: 3.4, radius: 0.7, detect: 11, poise: 18, exp: 12, gold: 4,
    ai: 'melee',
    attack: { kind: 'lunge', range: 2.6, arc: 0.6, windup: 0.75, active: 0.28, recover: 0.9, cd: [1.2, 2.2], mul: 1.0, lunge: 6, knock: 5 },
  },
  goblin: {
    id: 'goblin', name: 'ゴブリン', level: 2,
    scale: 1.3, hp: 56, atk: 12, def: 3, speed: 4.0, radius: 0.5, detect: 13, poise: 26, exp: 22, gold: 8,
    ai: 'melee',
    attack: { kind: 'swing', range: 2.4, arc: 0.95, windup: 0.62, active: 0.2, recover: 0.8, cd: [1.4, 2.6], mul: 1.0, knock: 5 },
  },
  wisp: {
    id: 'wisp', name: 'ウィスプ', level: 3,
    scale: 1.25, hp: 32, atk: 13, def: 0, speed: 3.0, radius: 0.5, detect: 17, poise: 14, exp: 26, gold: 10, hover: 1.4,
    ai: 'ranged', keep: [7, 11],
    attack: { kind: 'bolt', range: 15, arc: 0.07, windup: 0.95, active: 0.1, recover: 1.0, cd: [2.4, 3.6], mul: 1.0, speed: 13, knock: 3 },
  },
  brute: {
    id: 'brute', name: 'ストーンブルート', level: 5,
    hp: 200, atk: 24, def: 9, speed: 2.5, radius: 1.15, detect: 15, poise: 70, exp: 140, gold: 60, superArmor: true,
    ai: 'melee',
    attack: { kind: 'slam', range: 4.0, radius: 3.9, arc: Math.PI, windup: 1.2, active: 0.2, recover: 1.5, cd: [2.2, 3.4], mul: 1.4, knock: 9 },
  },
};

// プレイヤー攻撃の判定 (コンボ段ごと)。range は敵の半径を除いた射程。
export const PLAYER_ATTACKS = [
  { range: 2.7, arc: 1.15, mul: 1.0, knock: 3.5, poise: 10, shake: 0.12 },
  { range: 2.7, arc: 1.15, mul: 1.1, knock: 3.5, poise: 11, shake: 0.14 },
  { range: 3.4, arc: 1.6,  mul: 1.7, knock: 8,   poise: 24, shake: 0.3 },
  { range: 4.2, arc: Math.PI, mul: 2.0, knock: 9, poise: 30, shake: 0.4 }, // 空中叩きつけ
  { range: 4.6, arc: 0.7, mul: 1.9, knock: 10, poise: 26, shake: 0.35 },   // 突進斬り (ダッシュ/回避から)
  { range: 4.5, arc: Math.PI, mul: 3.4, knock: 12, poise: 70, shake: 0.55 }, // カウンター (ジャスト回避後)
];

const A = (kind, o) => ({ kind, ...o });
const more = {
  // ------------------------------------------------------------ 平原: 中ボス
  goblin_king: {
    id: 'goblin_king', model: 'goblin', name: 'ゴブリンキング', level: 5, boss: true, tint: '#6aa84a', scale: 2.4,
    hp: 560, atk: 26, def: 8, speed: 3.6, radius: 1.2, detect: 18, poise: 160, exp: 320, gold: 220, superArmor: true,
    ai: 'melee', enrage: { at: 0.5, speed: 1.3, cd: 0.65, atk: 1.2 },
    attacks: [
      A('swing', { range: 3.2, arc: 1.0, windup: 0.7, active: 0.2, recover: 0.8, cd: [1.2, 2], mul: 1.0, knock: 7 }),
      A('slam', { range: 4.2, radius: 4.4, arc: Math.PI, windup: 1.1, active: 0.2, recover: 1.3, cd: [2, 3], mul: 1.3, knock: 10, minRange: 0 }),
    ],
  },
  // ------------------------------------------------------------ 廃墟
  skeleton: {
    id: 'skeleton', model: 'goblin', name: 'スケルトン', level: 7, tint: '#e8e2cf', scale: 1.35,
    hp: 150, atk: 26, def: 8, speed: 4.2, radius: 0.55, detect: 14, poise: 45, exp: 46, gold: 20,
    ai: 'melee', attacks: [A('swing', { range: 2.6, arc: 0.95, windup: 0.6, active: 0.2, recover: 0.75, cd: [1.2, 2.2], mul: 1.0, knock: 6 })],
  },
  wraith: {
    id: 'wraith', model: 'wisp', name: 'レイス', level: 8, tint: '#7a6aa8', scale: 1.3, hover: 1.5,
    hp: 110, atk: 32, def: 4, speed: 3.3, radius: 0.55, detect: 18, poise: 28, exp: 52, gold: 24,
    ai: 'ranged', keep: [7, 12], attacks: [A('bolt', { range: 16, arc: 0.07, windup: 0.85, active: 0.1, recover: 0.9, cd: [2, 3.2], mul: 1.0, speed: 15, knock: 3 })],
  },
  rubble_golem: {
    id: 'rubble_golem', model: 'brute', name: 'ガレキゴーレム', level: 9, tint: '#c9b79a', scale: 0.8,
    hp: 340, atk: 40, def: 16, speed: 2.7, radius: 0.95, detect: 14, poise: 90, exp: 95, gold: 50, superArmor: true,
    ai: 'melee', attacks: [A('slam', { range: 3.6, radius: 3.4, arc: Math.PI, windup: 1.0, active: 0.2, recover: 1.3, cd: [2, 3], mul: 1.3, knock: 8 })],
  },
  stone_warden: {
    id: 'stone_warden', model: 'brute', name: '石の守護像', level: 10, boss: true, tint: '#d8c8a8', scale: 1.5,
    hp: 1500, atk: 46, def: 18, speed: 2.8, radius: 1.7, detect: 20, poise: 400, exp: 700, gold: 450, superArmor: true,
    ai: 'melee', enrage: { at: 0.5, speed: 1.35, cd: 0.6, atk: 1.25 },
    attacks: [
      A('slam', { range: 5, radius: 5, arc: Math.PI, windup: 1.2, active: 0.2, recover: 1.4, cd: [2, 3], mul: 1.3, knock: 10 }),
      A('swing', { range: 4.6, arc: Math.PI, windup: 0.95, active: 0.2, recover: 1.0, cd: [1.8, 2.8], mul: 1.1, knock: 9 }),
    ],
  },
  // ------------------------------------------------------------ 洞窟
  bat: {
    id: 'bat', model: 'bat', name: 'ケイブバット', level: 12, hover: 2.2, tint: '#7a8cff',
    hp: 120, atk: 40, def: 6, speed: 6.5, radius: 0.5, detect: 16, poise: 24, exp: 80, gold: 40,
    ai: 'melee', attacks: [A('lunge', { range: 3.2, arc: 0.6, windup: 0.55, active: 0.3, recover: 0.8, cd: [1.0, 1.8], mul: 1.0, lunge: 11, knock: 5 })],
  },
  cave_slime: {
    id: 'cave_slime', model: 'gel', name: 'ブルースライム', level: 12, tint: '#5aa0ff', scale: 1.25,
    hp: 300, atk: 42, def: 14, speed: 3.5, radius: 0.9, detect: 12, poise: 60, exp: 100, gold: 50,
    ai: 'melee', attacks: [A('lunge', { range: 3.0, arc: 0.6, windup: 0.75, active: 0.28, recover: 0.9, cd: [1.2, 2.2], mul: 1.0, lunge: 7, knock: 6 })],
  },
  cave_goblin: {
    id: 'cave_goblin', model: 'goblin', name: 'ケイブゴブリン', level: 13, tint: '#6a88b8', scale: 1.45,
    hp: 330, atk: 52, def: 22, speed: 4.2, radius: 0.6, detect: 14, poise: 70, exp: 120, gold: 60,
    ai: 'melee', attacks: [A('swing', { range: 2.8, arc: 0.95, windup: 0.6, active: 0.2, recover: 0.8, cd: [1.2, 2.2], mul: 1.0, knock: 6 })],
  },
  crystal_wisp: {
    id: 'crystal_wisp', model: 'wisp', name: 'クリスタルウィスプ', level: 14, tint: '#5ad8ff', scale: 1.35, hover: 1.6,
    hp: 170, atk: 58, def: 8, speed: 3.4, radius: 0.55, detect: 18, poise: 36, exp: 130, gold: 60,
    ai: 'ranged', keep: [7, 12], attacks: [A('volley', { range: 17, arc: 0.3, windup: 0.9, active: 0.1, recover: 1.0, cd: [2.4, 3.4], mul: 0.7, speed: 15, knock: 3, count: 3, spread: 0.28 })],
  },
  crystal_golem: {
    id: 'crystal_golem', model: 'brute', name: 'クリスタルゴーレム', level: 16, boss: true, tint: '#7ad8ff', scale: 1.5,
    hp: 3200, atk: 66, def: 34, speed: 2.8, radius: 1.7, detect: 22, poise: 600, exp: 1500, gold: 900, superArmor: true,
    ai: 'melee', enrage: { at: 0.5, speed: 1.3, cd: 0.6, atk: 1.25 },
    attacks: [
      A('slam', { range: 5, radius: 5.2, arc: Math.PI, windup: 1.2, active: 0.2, recover: 1.4, cd: [2, 3], mul: 1.3, knock: 10 }),
      A('volley', { range: 20, arc: 0.5, windup: 1.0, active: 0.1, recover: 1.1, cd: [2.2, 3.2], mul: 0.8, speed: 16, knock: 4, count: 5, spread: 0.3, minRange: 6 }),
    ],
  },
  // ------------------------------------------------------------ 研究所
  drone: {
    id: 'drone', model: 'bat', name: 'ガードドローン', level: 18, hover: 2.0, tint: '#9fb4c0', scale: 1.1, metal: true,
    hp: 300, atk: 70, def: 24, speed: 7, radius: 0.55, detect: 17, poise: 45, exp: 190, gold: 100,
    ai: 'melee', attacks: [A('lunge', { range: 3.4, arc: 0.6, windup: 0.5, active: 0.3, recover: 0.75, cd: [0.9, 1.6], mul: 1.0, lunge: 12, knock: 6 })],
  },
  sentry: {
    id: 'sentry', model: 'sentry', name: 'セントリー', level: 20, hover: 2.0,
    hp: 340, atk: 82, def: 20, speed: 3.2, radius: 0.6, detect: 20, poise: 60, exp: 220, gold: 120,
    ai: 'ranged', keep: [8, 14], attacks: [A('bolt', { range: 20, arc: 0.06, windup: 0.7, active: 0.1, recover: 0.8, cd: [1.6, 2.6], mul: 1.0, speed: 20, knock: 4 })],
  },
  construct: {
    id: 'construct', model: 'goblin', name: 'コンストラクト', level: 21, tint: '#8aa0b0', scale: 1.7, metal: true,
    hp: 700, atk: 88, def: 50, speed: 3.6, radius: 0.85, detect: 15, poise: 140, exp: 300, gold: 160, superArmor: true,
    ai: 'melee', attacks: [A('swing', { range: 3.2, arc: 1.1, windup: 0.75, active: 0.2, recover: 0.9, cd: [1.4, 2.4], mul: 1.1, knock: 8 }), A('slam', { range: 4.0, radius: 3.6, arc: Math.PI, windup: 1.0, active: 0.2, recover: 1.2, cd: [2.5, 3.5], mul: 1.3, knock: 9 })],
  },
  pylon: {
    id: 'pylon', model: 'pylon', name: '障壁ピラー', level: 22, static: true, noAggro: true,
    hp: 700, atk: 0, def: 0, speed: 0, radius: 0.9, detect: 0, poise: 9999, exp: 150, gold: 0,
    ai: 'static', attacks: [A('bolt', { range: 1, arc: 0, windup: 1, active: 0.1, recover: 1, cd: [9, 9], mul: 0, speed: 1, knock: 0 })],
  },
  iron_sentinel: {
    id: 'iron_sentinel', model: 'brute', name: 'アイアンセンチネル', level: 23, boss: true, tint: '#9fb4c8', scale: 1.55, metal: true,
    hp: 5200, atk: 100, def: 55, speed: 3.0, radius: 1.75, detect: 24, poise: 800, exp: 2600, gold: 1700, superArmor: true,
    ai: 'melee', enrage: { at: 0.5, speed: 1.3, cd: 0.6, atk: 1.25 },
    attacks: [
      A('slam', { range: 5, radius: 5.4, arc: Math.PI, windup: 1.1, active: 0.2, recover: 1.3, cd: [2, 3], mul: 1.3, knock: 11 }),
      A('volley', { range: 22, arc: 0.6, windup: 0.9, active: 0.1, recover: 1.0, cd: [2, 3], mul: 0.8, speed: 20, knock: 4, count: 5, spread: 0.32, minRange: 6 }),
      A('swing', { range: 4.8, arc: Math.PI, windup: 0.9, active: 0.2, recover: 1.0, cd: [2, 3], mul: 1.1, knock: 9 }),
    ],
  },
  // ------------------------------------------------------------ 最終ボス / 隠しボス
  archon: {
    id: 'archon', model: 'archon', name: '終焉の王 ヴォイド', level: 32, boss: true, final: true, scale: 2.8,
    hp: 9800, atk: 150, def: 90, speed: 4.4, radius: 1.9, detect: 0, leash: 90, poise: 1500, exp: 8000, gold: 5000, superArmor: true,
    ai: 'melee', enrage: { at: 0.2, speed: 1.25, cd: 0.65, atk: 1.2 },
    // 第1形態: 近接主体
    attacks: [
      A('swing', { range: 4.8, arc: 1.2, windup: 0.6, active: 0.2, recover: 0.8, cd: [1.0, 1.8], mul: 1.1, knock: 10 }),
      A('lunge', { range: 9, arc: 0.5, windup: 0.75, active: 0.4, recover: 1.0, cd: [2, 3], mul: 1.3, lunge: 17, knock: 12, minRange: 4 }),
      A('slam', { range: 5.8, radius: 6, arc: Math.PI, windup: 1.0, active: 0.2, recover: 1.2, cd: [2.2, 3.2], mul: 1.4, knock: 12 }),
    ],
    // 第2形態 (HP50%): 結界ピラーを壊すまで無敵。弾幕と降り注ぐ魔弾。結界破壊後は全技を使う
    phase2: {
      at: 0.5, pylons: 3, hover: 1.2,
      shieldAttacks: [
        A('rain', { range: 40, radius: 3.1, count: 7, spread: 11, windup: 1.5, active: 0.2, recover: 1.2, cd: [1.6, 2.4], mul: 1.1, knock: 8 }),
        A('volley', { range: 40, arc: 3.2, windup: 1.1, active: 0.1, recover: 1.1, cd: [2.2, 3.2], mul: 0.65, speed: 15, knock: 4, count: 14, spread: 0.45 }),
      ],
      attacks: [
        A('rain', { range: 40, radius: 3.1, count: 8, spread: 11, windup: 1.3, active: 0.2, recover: 1.0, cd: [1.6, 2.4], mul: 1.1, knock: 8 }),
        A('volley', { range: 40, arc: 3.2, windup: 1.0, active: 0.1, recover: 1.0, cd: [2, 3], mul: 0.7, speed: 17, knock: 4, count: 16, spread: 0.4 }),
        A('slam', { range: 6.5, radius: 6.8, arc: Math.PI, windup: 0.95, active: 0.2, recover: 1.1, cd: [2, 3], mul: 1.4, knock: 13 }),
        A('swing', { range: 5.4, arc: Math.PI, windup: 0.8, active: 0.2, recover: 0.9, cd: [1.4, 2.2], mul: 1.2, knock: 11 }),
        A('lunge', { range: 10, arc: 0.5, windup: 0.7, active: 0.4, recover: 0.9, cd: [2, 3], mul: 1.3, lunge: 18, knock: 12, minRange: 5 }),
      ],
    },
  },
  abyss_lord: {
    id: 'abyss_lord', model: 'brute', name: '深淵の主', level: 36, boss: true, tint: '#8a4ae0', scale: 2.0, metal: true,
    hp: 8200, atk: 170, def: 105, speed: 3.6, radius: 2.2, detect: 26, poise: 2400, exp: 12000, gold: 6500, superArmor: true,
    ai: 'melee', enrage: { at: 0.45, speed: 1.35, cd: 0.55, atk: 1.3 },
    attacks: [
      A('slam', { range: 6, radius: 6.4, arc: Math.PI, windup: 1.0, active: 0.2, recover: 1.2, cd: [1.8, 2.8], mul: 1.4, knock: 13 }),
      A('swing', { range: 5.6, arc: Math.PI, windup: 0.85, active: 0.2, recover: 0.95, cd: [1.6, 2.6], mul: 1.2, knock: 11 }),
      A('rain', { range: 36, radius: 3.0, count: 6, spread: 10, windup: 1.3, active: 0.2, recover: 1.1, cd: [2, 3], mul: 1.1, knock: 8, minRange: 5 }),
      A('volley', { range: 30, arc: 3.2, windup: 1.0, active: 0.1, recover: 1.0, cd: [2.2, 3.2], mul: 0.7, speed: 17, knock: 4, count: 12, spread: 0.52, minRange: 7 }),
    ],
  },
  // ------------------------------------------------------------ 空中城
  harpy: {
    id: 'harpy', model: 'bat', name: 'ハーピー', level: 25, hover: 2.6, tint: '#f4f0ff', scale: 1.5,
    hp: 480, atk: 100, def: 36, speed: 7.2, radius: 0.65, detect: 18, poise: 60, exp: 320, gold: 160,
    ai: 'melee', attacks: [A('lunge', { range: 3.6, arc: 0.6, windup: 0.5, active: 0.3, recover: 0.75, cd: [0.9, 1.6], mul: 1.0, lunge: 13, knock: 6 })],
  },
  sky_knight: {
    id: 'sky_knight', model: 'goblin', name: 'スカイナイト', level: 27, tint: '#e8eef8', scale: 1.9, metal: true,
    hp: 1100, atk: 118, def: 70, speed: 3.9, radius: 0.9, detect: 16, poise: 200, exp: 500, gold: 220, superArmor: true,
    ai: 'melee', attacks: [A('swing', { range: 3.4, arc: 1.15, windup: 0.7, active: 0.2, recover: 0.85, cd: [1.3, 2.2], mul: 1.1, knock: 8 }), A('lunge', { range: 6, arc: 0.5, windup: 0.8, active: 0.35, recover: 1.0, cd: [2.5, 3.5], mul: 1.2, lunge: 14, knock: 8, minRange: 3.5 })],
  },
  seraph: {
    id: 'seraph', model: 'wisp', name: 'セラフ', level: 27, tint: '#ffe9a0', scale: 1.5, hover: 2.4,
    hp: 560, atk: 128, def: 30, speed: 3.6, radius: 0.6, detect: 20, poise: 80, exp: 520, gold: 230,
    ai: 'ranged', keep: [8, 14], attacks: [A('volley', { range: 21, arc: 0.35, windup: 0.85, active: 0.1, recover: 0.9, cd: [2, 3], mul: 0.75, speed: 19, knock: 4, count: 3, spread: 0.3 })],
  },
  gargoyle: {
    id: 'gargoyle', model: 'brute', name: 'ガーゴイル', level: 28, tint: '#c9ccd4', scale: 1.1,
    hp: 1500, atk: 125, def: 80, speed: 3.0, radius: 1.2, detect: 16, poise: 260, exp: 700, gold: 280, superArmor: true,
    ai: 'melee', attacks: [A('slam', { range: 4.2, radius: 4.0, arc: Math.PI, windup: 1.0, active: 0.2, recover: 1.2, cd: [2, 3], mul: 1.3, knock: 10 })],
  },
  wind_lord: {
    id: 'wind_lord', model: 'goblin', name: 'ウィンドロード', level: 30, boss: true, tint: '#dfe8ff', scale: 2.6, metal: true,
    hp: 8600, atk: 140, def: 85, speed: 4.2, radius: 1.35, detect: 24, poise: 1000, exp: 3500, gold: 2800, superArmor: true,
    ai: 'melee', enrage: { at: 0.5, speed: 1.3, cd: 0.6, atk: 1.25 },
    attacks: [
      A('swing', { range: 4.4, arc: 1.2, windup: 0.6, active: 0.2, recover: 0.8, cd: [1.0, 1.8], mul: 1.1, knock: 9 }),
      A('lunge', { range: 8, arc: 0.5, windup: 0.75, active: 0.4, recover: 1.0, cd: [2, 3], mul: 1.3, lunge: 16, knock: 10, minRange: 4 }),
      A('volley', { range: 22, arc: 0.7, windup: 0.9, active: 0.1, recover: 1.0, cd: [2.2, 3.2], mul: 0.8, speed: 21, knock: 4, count: 7, spread: 0.3, minRange: 7 }),
      A('slam', { range: 5.5, radius: 5.6, arc: Math.PI, windup: 1.1, active: 0.2, recover: 1.3, cd: [2.5, 3.5], mul: 1.4, knock: 12 }),
    ],
  },
};

// 後半エリアほど被ダメージが「最大HPの何割か」を保つよう、レベル帯ごとに攻撃力を補正する (ボスはさらに強化)。
// 想定装備のプレイヤーに対し、雑魚 1 発 ≒ 最大HPの 10〜13%、ボス 1 発 ≒ 18〜30% になる。
const atkScale = (lv) => (lv <= 5 ? 1 : lv <= 10 ? 1.5 : lv <= 16 ? 1.75 : lv <= 23 ? 2.0 : 2.3);

// 正規化: すべての敵が attacks 配列 / model / scale を持つ形にそろえる
export const ENEMIES = {};
for (const [id, d] of Object.entries({ ..._ENEMIES, ...more })) {
  const atk = Math.round(d.atk * atkScale(d.level) * (d.boss && d.level > 5 ? 1.25 : 1));
  ENEMIES[id] = { model: d.model || id, scale: 1, ...d, atk, attacks: d.attacks || [d.attack] };
  ENEMIES[id].attack = ENEMIES[id].attacks[0];
}
