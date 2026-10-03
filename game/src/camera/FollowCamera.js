import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';

/**
 * 三人称オービットカメラ。
 *  - yaw/pitch は Input の look 入力で回転 (PCマウス / スマホスワイプ共通)
 *  - 注視点はプレイヤーを指数平滑で追従
 *  - 地形に潜らないよう、注視点→カメラ間をサンプリングして距離を詰める
 *  - shake(): 被弾やスキル演出用のカメラシェイク (Phase 2 以降で使用)
 */
export class FollowCamera {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.yaw = 0;
    this.pitch = 0.35;
    this.distance = CONFIG.camera.distance;
    this.distScale = 1; this.distScaleTarget = 1;      // 大型ボス戦でカメラを引く
    this.focus = new THREE.Vector3();
    this.curDist = this.distance;
    this.shakeAmp = 0;
    this.cine = null;           // 演出用フック (Cinematic が設定)
    this._tmp = new THREE.Vector3();
  }

  snapTo(target) {
    this.focus.copy(target).y += CONFIG.camera.height;
  }

  shake(amp = 0.2) { this.shakeAmp = Math.max(this.shakeAmp, amp); }

  update(dt, target, look) {
    if (this.cine) { this.cine(dt); return; }
    const c = CONFIG.camera;
    this.distScale += (this.distScaleTarget - this.distScale) * (1 - Math.exp(-2 * dt));
    const baseDist = this.distance * this.distScale;
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, c.pitchMin, c.pitchMax);

    // 注視点を平滑追従
    const k = 1 - Math.exp(-c.followLerp * dt);
    this._tmp.set(target.x, target.y + c.height, target.z);
    this.focus.lerp(this._tmp, k);

    // カメラ方向
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = sp, dz = Math.cos(this.yaw) * cp;

    // 地形・距離の衝突回避: 注視点から外側へサンプルして最大安全距離を求める
    let safe = baseDist;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * baseDist;
      const x = this.focus.x + dx * d, y = this.focus.y + dy * d, z = this.focus.z + dz * d;
      if (y < this.terrain.getHeightAt(x, z) + 0.6 || this._insideProp(x, y, z)) { safe = Math.max(c.minDistance, d - 0.5); break; }
    }
    // 近づく時は素早く、離れる時はゆっくり
    const rate = safe < this.curDist ? 30 : 4;
    this.curDist += (safe - this.curDist) * (1 - Math.exp(-rate * dt));

    this.camera.position.set(
      this.focus.x + dx * this.curDist,
      this.focus.y + dy * this.curDist,
      this.focus.z + dz * this.curDist,
    );
    const floor = this.terrain.getHeightAt(this.camera.position.x, this.camera.position.z) + 0.5;
    if (this.camera.position.y < floor) this.camera.position.y = floor;

    if (this.shakeAmp > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp;
      this.shakeAmp *= Math.exp(-12 * dt);
    }
    this.camera.lookAt(this.focus);
  }

  /** 木・岩のコライダー内 (幹/岩の高さ以下) にカメラが入るか */
  _insideProp(x, y, z) {
    const base = this.terrain.getHeightAt(x, z);
    if (y - base > 3.2) return false;
    for (const c of this.terrain.colliders) {
      const dx = x - c.x, dz = z - c.z, r = c.r + 0.35;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /** 移動入力の基準となる、水平方向の前/右ベクトル */
  getBasis(out = { fx: 0, fz: 0, rx: 0, rz: 0 }) {
    out.fx = -Math.sin(this.yaw); out.fz = -Math.cos(this.yaw);
    out.rx = Math.cos(this.yaw); out.rz = -Math.sin(this.yaw);
    return out;
  }
}
