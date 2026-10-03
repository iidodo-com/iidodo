/**
 * エリア定義 (5 エリア)。座標は各エリア共通の「北へ進む」レイアウト:
 *   入口の門 (z=+88) → セーブポイント (z=+72) → 戦闘エリア → 中ボスの間 (z=-64) → 出口の門 (z=-88)
 * 地形・見た目・環境・敵・宝箱・仕掛けをすべてここで宣言し、AreaManager が読み込んで構築する。
 */

// 共通: 平坦にするゾーン (セーブポイント / 門 / 回復の泉 / ボスの間)
const zones = (spring, extra = []) => [
  { x: 0, z: 72, r: 9 }, { x: 0, z: 88, r: 6 }, { x: spring[0], z: spring[1], r: 6 },
  { x: 0, z: -64, r: 15 }, { x: 0, z: -88, r: 6 }, ...extra,
];

const tex = (main, second, rock, third, tints = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]], scales = [0.3, 0.16, 0.14, 0.2]) => ({ main, second, rock, third, tints, scales });

export const AREAS = {
  // ------------------------------------------------------------------ 1. 平原
  plains: {
    id: 'plains', index: 0, name: 'はじまりの平原', level: [1, 5], size: 220, props: 'forest',
    terrain: { seed: 20251, maxHeight: 9, noiseScale: 0.018, waterLevel: -2.3, wall: 22, rockY: [9, 15], snowY: [17, 23] },
    flat: zones([-34, 8]),
    palette: { grassA: '#58b03c', grassB: '#a2d054', grassC: '#3f8a3c', dirt: '#8a6a42', rock: '#8a8c94', snow: '#f1f5f8', sand: '#dccb94', wet: '#4a5d44' },
    ground: tex('forest', 'dry', 'rock', 'sand', [[0.5, 0.84, 0.44], [1, 1, 1], [1, 1, 1], [1, 1, 1]], [0.3, 0.16, 0.14, 0.2]),
    vegetation: { grass: 1, flowers: 1, undergrowth: 1 },
    water: { shallow: '#5fd0c8', deep: '#0c4f86' },
    env: { exposure: 0.72, fog: { color: 'auto', density: 0.004 }, envIntensity: 0.85, bgIntensity: 1, sun: 3.6, hemi: 1.3 },
    savepoint: { x: 0, z: 72 }, spring: { x: -34, z: 8 },
    entrance: null,
    exit: { x: 0, z: -88, to: 'ruins', key: 'plains_key', lockedMsg: '門は固く閉ざされている。森の鍵が必要だ。' },
    boss: { id: 'goblin_king', x: 0, z: -64 },
    camps: [
      { x: -20, z: 40, types: ['gel', 'gel', 'gel'] },
      { x: 28, z: 24, types: ['gel', 'goblin', 'goblin'] },
      { x: -30, z: -10, types: ['goblin', 'goblin', 'wisp'] },
      { x: 34, z: -26, types: ['goblin', 'wisp', 'wisp', 'gel'] },
      { x: -22, z: -44, types: ['brute', 'goblin'] },
    ],
    chests: [
      { id: 'c1', x: -44, z: 50, tier: 'wood', loot: { gold: [30, 50], items: [{ id: 'potion_s', n: 3 }] } },
      { id: 'c2', x: 46, z: 40, tier: 'wood', loot: { gold: [40, 60], items: [{ id: 'slime_gel', n: 4 }, { id: 'ether', n: 1 }] } },
      { id: 'c3', x: 6, z: 0, tier: 'silver', loot: { gold: [60, 90], items: [{ id: 'steel_sword', n: 1 }] } },
      { id: 'c4', x: 48, z: -40, tier: 'silver', loot: { gold: [80, 120], items: [{ id: 'leather_armor', n: 1 }, { id: 'potion_m', n: 2 }] } },
      { id: 'c5', x: -52, z: -30, tier: 'wood', loot: { gold: [50, 80], items: [{ id: 'goblin_fang', n: 4 }] } },
    ],
  },

  // ------------------------------------------------------------------ 2. 廃墟
  ruins: {
    id: 'ruins', index: 1, name: '忘れられた廃墟', level: [6, 10], size: 220, props: 'ruins',
    terrain: { seed: 7741, maxHeight: 6, noiseScale: 0.022, waterLevel: -3.2, wall: 24, rockY: [8, 13], snowY: [999, 1000] },
    flat: zones([36, 6]),
    palette: { grassA: '#8a9a4a', grassB: '#b3b060', grassC: '#6f7d3c', dirt: '#8c7655', rock: '#8f8b86', snow: '#e0e0e0', sand: '#c9b88a', wet: '#4d5240' },
    ground: tex('dust', 'cobble', 'boulder', 'leafgravel', [[0.95, 0.9, 0.7], [1, 1, 1], [1, 0.95, 0.9], [1, 1, 1]], [0.28, 0.2, 0.12, 0.2]),
    vegetation: { grass: 0.45, flowers: 0.2, undergrowth: 0.4 },
    water: { shallow: '#6a8a7a', deep: '#243f3c' },
    env: { exposure: 0.74, fog: { color: '#a9a398', density: 0.0072 }, envIntensity: 0.6, bgIntensity: 0.85, sun: 2.7, hemi: 1.15, sunColor: '#ffe0b8' },
    savepoint: { x: 0, z: 72 }, spring: { x: 36, z: 6 },
    entrance: { x: 0, z: 88, to: 'plains', toSpawn: 'exit' },
    exit: { x: 0, z: -88, to: 'cave', key: 'ruins_key', lockedMsg: '石の門は閉じている。守護像が持つ鍵が必要だ。' },
    boss: { id: 'stone_warden', x: 0, z: -64 },
    camps: [
      { x: -26, z: 46, types: ['skeleton', 'skeleton', 'skeleton'] },
      { x: 30, z: 30, types: ['skeleton', 'wraith', 'skeleton'] },
      { x: -34, z: 6, types: ['rubble_golem', 'skeleton'] },
      { x: 24, z: -14, types: ['wraith', 'wraith', 'skeleton', 'skeleton'] },
      { x: -28, z: -40, types: ['rubble_golem', 'wraith', 'skeleton'] },
      { x: 38, z: -44, types: ['skeleton', 'skeleton', 'wraith'] },
    ],
    chests: [
      { id: 'c1', x: -46, z: 60, tier: 'wood', loot: { gold: [90, 130], items: [{ id: 'potion_m', n: 2 }] } },
      { id: 'c2', x: 50, z: 52, tier: 'silver', loot: { gold: [100, 150], items: [{ id: 'goblin_dagger', n: 1 }, { id: 'ether', n: 2 }] } },
      { id: 'c3', x: -6, z: 14, tier: 'silver', loot: { gold: [120, 180], items: [{ id: 'power_ring', n: 1 }] } },
      { id: 'c4', x: -56, z: -18, tier: 'silver', loot: { gold: [150, 200], items: [{ id: 'iron_armor', n: 1 }] } },
      { id: 'c5', x: 56, z: -22, tier: 'gold', loot: { gold: [200, 280], items: [{ id: 'ruin_shard', n: 3 }, { id: 'knight_sword', n: 1 }] } },
    ],
  },

  // ------------------------------------------------------------------ 3. 洞窟
  cave: {
    id: 'cave', index: 2, name: '水晶の洞窟', level: [11, 16], size: 220, props: 'cave',
    terrain: { seed: 3319, maxHeight: 7, noiseScale: 0.03, waterLevel: -2.6, wall: 40, rockY: [999, 1000], snowY: [999, 1000] },
    flat: zones([-34, 4], [{ x: 0, z: -40, r: 8 }]),
    palette: { grassA: '#2e3a58', grassB: '#3d4d73', grassC: '#232c46', dirt: '#4a4540', rock: '#555a66', snow: '#9fb4d8', sand: '#3d4254', wet: '#1a2036' },
    ground: tex('dust', 'leafgravel', 'darkrock', 'gravel', [[0.3, 0.42, 0.72], [0.55, 0.65, 0.9], [1.4, 1.6, 2.0], [0.4, 0.5, 0.75]], [0.3, 0.18, 0.16, 0.25]),
    vegetation: { grass: 0, flowers: 0, undergrowth: 0 },
    water: { shallow: '#2b6f9a', deep: '#071a38', reflect: 0.06 },
    env: { exposure: 0.88, fog: { color: '#0b1226', density: 0.015 }, envIntensity: 0.12, bgIntensity: 0, bgColor: '#05080f', sun: 0, hemi: 0.55, hemiSky: '#6a8cff', hemiGround: '#1a2040', lamp: true },
    savepoint: { x: 0, z: 72 }, spring: { x: -34, z: 4 },
    entrance: { x: 0, z: 88, to: 'ruins', toSpawn: 'exit' },
    exit: { x: 0, z: -88, to: 'lab', key: 'cave_key', lockedMsg: '水晶の扉は閉ざされている。ゴーレムの核が鍵になるようだ。' },
    boss: { id: 'crystal_golem', x: 0, z: -64 },
    barrier: { x: 0, z: -40, width: 18, needs: 'levers' },
    levers: [{ id: 'l1', x: -50, z: 20 }, { id: 'l2', x: 52, z: -22 }],
    camps: [
      { x: -24, z: 48, types: ['bat', 'bat', 'cave_slime'] },
      { x: 28, z: 34, types: ['cave_goblin', 'cave_goblin', 'crystal_wisp'] },
      { x: -40, z: 14, types: ['cave_slime', 'cave_slime', 'bat'] },
      { x: 34, z: 0, types: ['cave_goblin', 'crystal_wisp', 'crystal_wisp'] },
      { x: -34, z: -22, types: ['bat', 'bat', 'bat', 'cave_goblin'] },
      { x: 40, z: -30, types: ['cave_goblin', 'cave_slime', 'crystal_wisp'] },
    ],
    chests: [
      { id: 'c1', x: -56, z: 54, tier: 'wood', loot: { gold: [180, 240], items: [{ id: 'potion_l', n: 2 }] } },
      { id: 'c2', x: 54, z: 56, tier: 'silver', loot: { gold: [200, 260], items: [{ id: 'cave_crystal', n: 3 }, { id: 'ether_l', n: 1 }] } },
      { id: 'c3', x: -58, z: 24, tier: 'silver', loot: { gold: [220, 300], items: [{ id: 'mithril_armor', n: 1 }] } },
      { id: 'c4', x: 58, z: -4, tier: 'silver', loot: { gold: [240, 320], items: [{ id: 'gem_str2', n: 1 }] } },
      { id: 'c5', x: -56, z: -34, tier: 'gold', loot: { gold: [320, 420], items: [{ id: 'crystal_blade', n: 1 }] } },
    ],
  },

  // ------------------------------------------------------------------ 4. 魔導研究所
  lab: {
    id: 'lab', index: 3, name: '魔導研究所', level: [17, 23], size: 220, props: 'lab',
    terrain: { seed: 5527, maxHeight: 2.2, noiseScale: 0.025, waterLevel: null, wall: 34, rockY: [999, 1000], snowY: [999, 1000] },
    flat: zones([34, 8], [{ x: 0, z: -40, r: 8 }, { x: -22, z: -50, r: 4 }, { x: 22, z: -50, r: 4 }, { x: 0, z: -30, r: 4 }]),
    palette: { grassA: '#40525a', grassB: '#566a73', grassC: '#33424a', dirt: '#5a5048', rock: '#6a7076', snow: '#cfe8f4', sand: '#60686e', wet: '#2a3238' },
    ground: tex('plate2', 'tiles', 'grid', 'plate', [[0.85, 1.1, 1.5], [0.8, 1.05, 1.35], [0.8, 1.0, 1.3], [0.55, 0.85, 1.3]], [0.2, 0.16, 0.2, 0.22]),
    vegetation: { grass: 0, flowers: 0, undergrowth: 0 },
    water: null,
    env: { exposure: 0.92, fog: { color: '#1d3340', density: 0.0085 }, envIntensity: 0.55, bgIntensity: 0.12, bgColor: '#0c1a22', sun: 2.0, hemi: 1.0, sunColor: '#cfeaff', hemiSky: '#9fd8ff', hemiGround: '#2c4048', spotLights: true },
    savepoint: { x: 0, z: 72 }, spring: { x: 34, z: 8 },
    entrance: { x: 0, z: 88, to: 'cave', toSpawn: 'exit' },
    exit: { x: 0, z: -88, to: 'sky', key: 'lab_key', lockedMsg: '転送ゲートは停止している。センチネルの認証コアが必要だ。' },
    boss: { id: 'iron_sentinel', x: 0, z: -64 },
    barrier: { x: 0, z: -40, width: 18, needs: 'pylons' },
    pylons: [{ id: 'p1', x: -22, z: -50 }, { id: 'p2', x: 22, z: -50 }, { id: 'p3', x: 0, z: -30 }],
    camps: [
      { x: -26, z: 50, types: ['drone', 'drone', 'sentry'] },
      { x: 28, z: 36, types: ['construct', 'sentry', 'drone'] },
      { x: -38, z: 10, types: ['sentry', 'sentry', 'drone', 'drone'] },
      { x: 34, z: -6, types: ['construct', 'construct', 'sentry'] },
      { x: -34, z: -26, types: ['drone', 'drone', 'drone', 'sentry'] },
      { x: 38, z: -26, types: ['construct', 'sentry', 'sentry'] },
    ],
    chests: [
      { id: 'c1', x: -54, z: 60, tier: 'silver', loot: { gold: [320, 420], items: [{ id: 'potion_l', n: 3 }] } },
      { id: 'c2', x: 52, z: 58, tier: 'silver', loot: { gold: [340, 440], items: [{ id: 'lab_circuit', n: 3 }, { id: 'ether_l', n: 2 }] } },
      { id: 'c3', x: -60, z: 6, tier: 'silver', loot: { gold: [360, 460], items: [{ id: 'arc_ring', n: 1 }] } },
      { id: 'c4', x: 60, z: -14, tier: 'gold', loot: { gold: [420, 560], items: [{ id: 'gem_vit2', n: 1 }, { id: 'gem_str2', n: 1 }] } },
      { id: 'c5', x: -58, z: -40, tier: 'gold', loot: { gold: [480, 640], items: [{ id: 'plasma_saber', n: 1 }] } },
    ],
  },

  // ------------------------------------------------------------------ 5. 空中城
  sky: {
    id: 'sky', index: 4, name: '空中城アルカディア', level: [24, 30], size: 220, props: 'sky',
    terrain: { seed: 9013, maxHeight: 4, noiseScale: 0.02, waterLevel: null, wall: -34, rockY: [999, 1000], snowY: [999, 1000], secondBias: 0.14 },
    flat: zones([-34, 8]),
    palette: { grassA: '#7fc46a', grassB: '#b8e07a', grassC: '#58a35a', dirt: '#c9b88a', rock: '#d8d4cc', snow: '#ffffff', sand: '#efe6c8', wet: '#8aa' },
    ground: tex('marble', 'forest', 'sandbrick', 'tiles', [[1.05, 1.03, 1], [0.55, 0.9, 0.5], [1.1, 1.08, 1.05], [1.1, 1.1, 1.05]], [0.18, 0.28, 0.14, 0.18]),
    vegetation: { grass: 0.5, flowers: 0.8, undergrowth: 0.2 },
    water: null,
    env: { exposure: 0.7, fog: { color: 'auto', density: 0.0026 }, envIntensity: 1.0, bgIntensity: 1.15, sun: 3.6, hemi: 1.2, cloudSea: true },
    savepoint: { x: 0, z: 72 }, spring: { x: -34, z: 8 },
    entrance: { x: 0, z: 88, to: 'lab', toSpawn: 'exit' },
    exit: { x: 0, z: -88, to: 'throne', key: 'sky_key', lockedMsg: '王の間へ続く扉。風の紋章に共鳴する、強大な魔力の封印がかかっている……' },
    boss: { id: 'wind_lord', x: 0, z: -64 },
    camps: [
      { x: -26, z: 48, types: ['harpy', 'harpy', 'sky_knight'] },
      { x: 28, z: 32, types: ['seraph', 'sky_knight', 'harpy'] },
      { x: -38, z: 8, types: ['gargoyle', 'seraph'] },
      { x: 34, z: -8, types: ['sky_knight', 'sky_knight', 'seraph'] },
      { x: -32, z: -28, types: ['harpy', 'harpy', 'harpy', 'seraph'] },
      { x: 38, z: -32, types: ['gargoyle', 'sky_knight', 'seraph'] },
    ],
    chests: [
      { id: 'c1', x: -56, z: 58, tier: 'silver', loot: { gold: [520, 680], items: [{ id: 'potion_l', n: 4 }] } },
      { id: 'c2', x: 54, z: 56, tier: 'silver', loot: { gold: [560, 720], items: [{ id: 'sky_feather', n: 3 }, { id: 'ether_l', n: 3 }] } },
      { id: 'c3', x: -60, z: 14, tier: 'gold', loot: { gold: [600, 800], items: [{ id: 'sky_plate', n: 1 }] } },
      { id: 'c4', x: 60, z: -10, tier: 'gold', loot: { gold: [640, 840], items: [{ id: 'gem_vit2', n: 2 }] } },
      { id: 'c5', x: -58, z: -44, tier: 'gold', loot: { gold: [700, 900], items: [{ id: 'wind_blade', n: 1 }, { id: 'zephyr_charm', n: 1 }] } },
    ],
  },
};

AREAS.throne = {
  id: 'throne', index: 5, name: '王の間', level: [28, 32], size: 160, props: 'throne', final: true,
  terrain: { seed: 1337, maxHeight: 1.4, noiseScale: 0.03, waterLevel: null, wall: -34, rockY: [999, 1000], snowY: [999, 1000], secondBias: 0 },
  flat: [{ x: 0, z: 52, r: 8 }, { x: 0, z: 68, r: 6 }, { x: -24, z: 50, r: 5 }, { x: 0, z: -18, r: 32 }],
  palette: { grassA: '#c9c0e0', grassB: '#e0d8f0', grassC: '#a89cc8', dirt: '#9a8ab8', rock: '#c8c0d8', snow: '#fff', sand: '#e8e0f4', wet: '#8a7aa8' },
  ground: tex('tiles', 'marble', 'sandbrick', 'tiles', [[0.95, 0.9, 1.25], [0.7, 0.68, 1.1], [0.8, 0.78, 1.15], [0.85, 0.82, 1.2]], [0.14, 0.16, 0.14, 0.2]),
  vegetation: { grass: 0, flowers: 0, undergrowth: 0 },
  water: null,
  env: { exposure: 0.74, fog: { color: '#4a3566', density: 0.0048 }, envIntensity: 0.7, bgIntensity: 0.6, sun: 2.6, hemi: 1.0, sunColor: '#ffb089', hemiSky: '#a58aff', hemiGround: '#40305a', cloudSea: true, spotLights: true },
  savepoint: { x: 0, z: 52 }, spring: { x: -24, z: 50 },
  entrance: { x: 0, z: 68, to: 'sky', toSpawn: 'exit' },
  exit: null,
  boss: { id: 'archon', x: 0, z: -22, trigger: 30 },
  camps: [],
  chests: [],
};

// 隠しダンジョン (クリア後に解放): 高難易度。敵は全体的に強化され、超ボスが待つ。
AREAS.abyss = {
  id: 'abyss', index: 6, name: '深淵の回廊', level: [32, 40], size: 220, props: 'cave', hidden: true,
  enemyScale: { hp: 2.1, atk: 1.55, exp: 2.6 },
  terrain: { seed: 6661, maxHeight: 7, noiseScale: 0.03, waterLevel: null, wall: 40, rockY: [999, 1000], snowY: [999, 1000] },
  flat: zones([34, 6], [{ x: 0, z: -40, r: 8 }]),
  palette: { grassA: '#3a2458', grassB: '#4d3070', grassC: '#2a1840', dirt: '#3a2f48', rock: '#4c4060', snow: '#b49cff', sand: '#34284a', wet: '#1c1030' },
  ground: tex('dust', 'leafgravel', 'darkrock', 'gravel', [[0.42, 0.28, 0.7], [0.55, 0.4, 0.85], [1.4, 1.1, 2.0], [0.4, 0.3, 0.7]], [0.3, 0.18, 0.16, 0.25]),
  vegetation: { grass: 0, flowers: 0, undergrowth: 0 },
  water: null,
  env: { exposure: 0.9, fog: { color: '#14081f', density: 0.015 }, envIntensity: 0.12, bgIntensity: 0, bgColor: '#07030d', sun: 0, hemi: 0.6, hemiSky: '#b07cff', hemiGround: '#20103a', lamp: true },
  savepoint: { x: 0, z: 72 }, spring: { x: 34, z: 6 },
  entrance: { x: 0, z: 88, to: 'throne', toSpawn: 'savepoint' },
  exit: null,
  boss: { id: 'abyss_lord', x: 0, z: -64 },
  barrier: { x: 0, z: -40, width: 18, needs: 'levers' },
  levers: [{ id: 'l1', x: -52, z: 10 }, { id: 'l2', x: 54, z: -20 }],
  camps: [
    { x: -26, z: 48, types: ['sky_knight', 'seraph', 'harpy'] },
    { x: 28, z: 32, types: ['gargoyle', 'sentry', 'sentry'] },
    { x: -38, z: 8, types: ['construct', 'construct', 'seraph'] },
    { x: 34, z: -6, types: ['harpy', 'harpy', 'sky_knight', 'seraph'] },
    { x: -34, z: -26, types: ['gargoyle', 'gargoyle', 'sky_knight'] },
    { x: 40, z: -28, types: ['seraph', 'seraph', 'construct'] },
  ],
  chests: [
    { id: 'c1', x: -56, z: 58, tier: 'gold', loot: { gold: [1200, 1600], items: [{ id: 'potion_l', n: 5 }, { id: 'sky_feather', n: 4 }] } },
    { id: 'c2', x: 56, z: 54, tier: 'gold', loot: { gold: [1300, 1700], items: [{ id: 'lab_circuit', n: 4 }, { id: 'cave_crystal', n: 4 }] } },
    { id: 'c3', x: -60, z: 16, tier: 'gold', loot: { gold: [1500, 1900], items: [{ id: 'gem_str2', n: 2 }, { id: 'gem_vit2', n: 2 }] } },
    { id: 'c4', x: 60, z: -8, tier: 'gold', loot: { gold: [1700, 2100], items: [{ id: 'void_charm', n: 1 }] } },
    { id: 'c5', x: -58, z: -40, tier: 'gold', loot: { gold: [2000, 2600], items: [{ id: 'void_plate', n: 1 }] } },
  ],
};

export const AREA_ORDER = ['plains', 'ruins', 'cave', 'lab', 'sky', 'throne', 'abyss'];
