import { CONFIG } from '../core/Config.js';

/**
 * 画面演出 (ゲームフィール): ブレット/スローモーション、放射ブラー+色収差パルス、フラッシュ、集中線、FOV キック。
 * PostFx の Grade パス (uniforms) と Game.update から使う。ポスト処理が無い低画質でもスロー/FOV は動く。
 */
export class Juice {
  constructor(game) {
    this.game = game;
    this.pulse = 0; this.flash = 0; this.flashCol = [1, 1, 1]; this.lines = 0; this.slowTint = 0; this.fov = 0; this.fovT = 0;
    this.slow = { t: 0, dur: 1, scale: 1 };
    this.ws = 1;
  }

  /** 世界(敵・弾・粒子)の時間倍率 */
  get worldScale() { return this.ws; }
  /** プレイヤー自身は敵ほど遅くならない (スロー中に有利に動ける) */
  get playerScale() { return this.ws < 1 ? Math.min(1, this.ws * 2.4 + 0.05) : 1; }

  slowMo(dur, scale = 0.25) {
    if (this.slow.t > 0 && this.slow.scale < scale && this.slow.t > dur) return;
    this.slow = { t: dur, dur, scale };
  }

  hit(heavy = false, crit = false) {
    this.pulse = Math.max(this.pulse, heavy ? 0.85 : crit ? 0.55 : 0.28);
    this.fovT = Math.max(this.fovT, heavy ? 4.5 : crit ? 3 : 1.4);
    if (crit || heavy) { this.flash = Math.max(this.flash, heavy ? 0.22 : 0.1); this.flashCol = [1, 0.95, 0.8]; }
  }

  justDodge() {
    this.slowMo(1.15, 0.2);
    this.pulse = 1; this.fovT = Math.max(this.fovT, 6);
    this.flash = 0.45; this.flashCol = [0.5, 0.9, 1.4]; this.lines = 1;
  }

  burst(color = [1, 0.9, 0.7], flash = 0.5, pulse = 1) { this.flash = flash; this.flashCol = color; this.pulse = Math.max(this.pulse, pulse); }

  /** 実時間 dt で呼ぶ */
  update(dt, uniforms) {
    const s = this.slow;
    if (s.t > 0) {
      s.t -= dt;
      const k = Math.max(0, s.t) / s.dur;
      // 入りは急、後半でなめらかに通常速度へ
      this.ws = s.t <= 0 ? 1 : k > 0.35 ? s.scale : s.scale + (1 - s.scale) * Math.pow(1 - k / 0.35, 2);
    } else this.ws = 1;
    const target = this.ws < 0.9 ? 1 : 0;
    this.slowTint += (target - this.slowTint) * Math.min(1, dt * 8);
    const dec = (v, r) => v * Math.exp(-r * dt);
    this.pulse = dec(this.pulse, 7); this.flash = dec(this.flash, 9); this.lines = dec(this.lines, 3.2);
    this.fovT = dec(this.fovT, 8); this.fov += (this.fovT - this.fov) * Math.min(1, dt * 20);
    const p = this.game.player;
    const sprintLines = p.sprinting && p.state === 'free' ? 0.28 : 0;
    if (uniforms) {
      uniforms.uPulse.value = this.pulse;
      uniforms.uFlash.value = this.flash; uniforms.uFlashCol.value.set(...this.flashCol);
      uniforms.uLines.value = Math.max(this.lines, sprintLines);
      uniforms.uSlow.value = this.slowTint;
      uniforms.uTime.value += dt;
    }
    const cam = this.game.camera, base = CONFIG.camera.fov + (innerWidth / innerHeight < 1 ? 14 : 0);
    const f = base + this.fov + (p.sprinting && p.state === 'free' ? 2.5 : 0) + (p.gliding ? 3 : 0);
    if (Math.abs(cam.fov - f) > 0.02) { cam.fov = f; cam.updateProjectionMatrix(); }
  }

  reset() { this.slow.t = 0; this.ws = 1; this.pulse = this.flash = this.lines = this.fov = this.fovT = 0; }
}
