// 全体で共有する調整値。バランス調整はここと data/ に集約する。
export const CONFIG = {
  world: {
    size: 240,          // 地形の一辺 (m)
    segments: 160,      // 地形の分割数
    maxHeight: 9,
    spawnClearRadius: 14, // スポーン地点付近を平坦にする半径
    seed: 20251,
    waterLevel: -2.3,
  },
  player: {
    walkSpeed: 6.5,
    accel: 40,
    turnSpeed: 14,        // rad/s 相当 (補間係数)
    gravity: 28,
    height: 1.8,
    radius: 0.45,
    dodgeDuration: 0.42,
    dodgeSpeed: 15,
    dodgeInvuln: 0.32,    // 無敵時間 (s)
    dodgeCooldown: 0.25,
    // 3連コンボ: 各段の持続時間 / 前進距離 / 次段入力受付ウィンドウ開始
    combo: [
      { dur: 0.36, lunge: 1.6, hitAt: 0.45, swing: 'right' },
      { dur: 0.36, lunge: 1.6, hitAt: 0.45, swing: 'left' },
      { dur: 0.55, lunge: 2.6, hitAt: 0.5,  swing: 'overhead' },
    ],
    jumpVel: 10.5,        // 1段目ジャンプ初速 (約2m)
    airJumpVel: 9.0,      // 空中ジャンプ
    airJumps: 1,
    coyote: 0.1,          // 崖を離れてもジャンプできる猶予
    jumpBuffer: 0.14,
    glideFall: 2.4,       // 滑空中の最大落下速度
    glideSpeed: 1.15,
    sprintMul: 1.42,      // 走り続けると自動でダッシュ
    sprintAfter: 0.7,
    slamSpeed: 24,
    comboLink: 0.45,      // 攻撃終了後、この時間内に押すと次段へ
  },
  camera: {
    distance: 7.5,
    minDistance: 3,
    height: 1.6,          // 注視点オフセット
    pitchMin: -0.35,
    pitchMax: 1.1,
    mouseSens: 0.0022,
    touchSens: 0.0050,
    followLerp: 10,
    fov: 60,
  },
  render: {
    maxPixelRatio: 2,
    shadowMapSize: 2048,
    shadowMapSizeMobile: 1024,
  },
};

// 画質プリセット。URL に ?q=low|medium|high を付けると強制指定できる。
const QUALITY = {
  low:    { name: 'low',    post: false, msaa: 0, bloom: 0,    grass: 160, grassDist: 42, shadow: 1024, dpr: 1,    flowers: 500, detail: 0.25, ao: false },
  medium: { name: 'medium', post: true,  msaa: 2, bloom: 0.45, grass: 380, grassDist: 58, shadow: 1024, dpr: 1.5,  flowers: 1000, detail: 0.55, ao: false },
  high:   { name: 'high',   post: true,  msaa: 4, bloom: 0.55, grass: 800, grassDist: 85, shadow: 2048, dpr: 2,    flowers: 1800, detail: 1, ao: true },
};
export function getQuality() {
  const q = new URLSearchParams(location.search).get('q');
  const touch = matchMedia('(pointer: coarse)').matches;
  return QUALITY[q] || (touch ? QUALITY.medium : QUALITY.high);
}
