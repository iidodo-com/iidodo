import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';

const ease = (t) => 1 - (1 - t) * (1 - t);
const clamp01 = (t) => Math.min(Math.max(t, 0), 1);

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * プレイヤー: ダミー直方体モデル + 行動ステートマシン (move / attack(3連) / dodge)。
 * 当たり判定そのものは Phase 2 で実装するが、必要な情報は既に公開している:
 *   - events: 'player:swing' {combo, pos, dir}  … 攻撃判定が発生した瞬間
 *   - isInvulnerable                            … 回避の無敵時間中 true
 *   - skill / interact は 'player:skill' / 'player:interact' イベントで通知
 */
export class Player {
  constructor(scene, terrain, bus) {
    this.terrain = terrain;
    this.bus = bus;
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.facing = 0;            // 向き (rad)。前方向ベクトル = (sin f, cos f)
    this.vy = 0;
    this.grounded = true;

    // 暫定ステータス (Phase 3 でデータ駆動の Stats / レベルシステムに置換)
    this.stats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50 };

    // 行動ステート
    this.state = 'free';        // 'free' | 'attack' | 'dodge'
    this.stateTime = 0;
    this.comboIndex = 0;        // 現在/直前の攻撃段 (0..2)
    this.comboLinkTimer = 0;    // 次段入力の受付残り時間
    this.comboHasPrev = false;
    this.attackBuffered = 0;    // 先行入力の残り時間
    this.swingFired = false;
    this.dodgeDir = new THREE.Vector3();
    this.dodgeCd = 0;
    this.invulnTimer = 0;
    this.walkPhase = 0;
    this._basis = { fx: 0, fz: 0, rx: 0, rz: 0 };

    this._buildModel();
    scene.add(this.root);
    this.teleport(0, 0);
  }

  get isInvulnerable() { return this.invulnTimer > 0; }
  get isBusy() { return this.state !== 'free'; }

  teleport(x, z) {
    this.position.set(x, this.terrain.getHeightAt(x, z), z);
    this.vy = 0;
    this._syncModel();
  }

  _buildModel() {
    this.root = new THREE.Group();
    // rig: 回避ロールで回転させる中心(腰の高さ)
    this.rig = new THREE.Group();
    this.rig.position.y = 0.9;
    this.root.add(this.rig);

    const skin = '#e8c39e', cloth = '#2c5aa0', dark = '#23262e', metal = '#cfd6e0';
    const body = box(0.7, 0.8, 0.4, cloth, 0, 0.1, 0);
    const head = box(0.42, 0.42, 0.42, skin, 0, 0.72, 0);
    const visor = box(0.34, 0.12, 0.05, dark, 0, 0.74, 0.22);
    const hair = box(0.46, 0.14, 0.46, '#4a2f1a', 0, 0.97, -0.01);
    this.legL = new THREE.Group(); this.legR = new THREE.Group();
    this.legL.position.set(-0.17, -0.3, 0); this.legR.position.set(0.17, -0.3, 0);
    this.legL.add(box(0.26, 0.6, 0.28, dark, 0, -0.3, 0));
    this.legR.add(box(0.26, 0.6, 0.28, dark, 0, -0.3, 0));
    this.armL = new THREE.Group(); this.armL.position.set(-0.48, 0.38, 0);
    this.armL.add(box(0.2, 0.62, 0.22, cloth, 0, -0.28, 0));

    // 右腕 + 剣 (swing 用の pivot)
    this.swordPivot = new THREE.Group();
    this.swordPivot.position.set(0.48, 0.38, 0);
    this.swordPivot.rotation.order = 'YXZ';
    this.swordPivot.add(box(0.2, 0.2, 0.22, cloth, 0, 0, 0.0));
    const blade = box(0.09, 0.05, 1.25, metal, 0, 0, 0.85);
    const guard = box(0.32, 0.07, 0.07, '#b08a2e', 0, 0, 0.28);
    const grip = box(0.07, 0.07, 0.28, '#5b3f26', 0, 0, 0.1);
    this.swordPivot.add(blade, guard, grip);

    this.rig.add(body, head, visor, hair, this.legL, this.legR, this.armL, this.swordPivot);
    this._restSword();
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  _restSword() {
    this.swordPivot.rotation.set(0.9, -0.15, 0);
  }

  // ---------------------------------------------------------------- update
  update(dt, input, cam) {
    const cfg = CONFIG.player;
    cam.getBasis(this._basis);
    const b = this._basis;

    // 入力 (カメラ基準の移動ベクトル)
    const mx = input.move.x, my = input.move.y;
    const wishX = b.fx * my + b.rx * mx;
    const wishZ = b.fz * my + b.rz * mx;
    const wishLen = Math.hypot(wishX, wishZ);

    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.attackBuffered = Math.max(0, this.attackBuffered - dt);
    if (input.wasPressed('attack')) this.attackBuffered = 0.35;

    // スキル / 調べる (発動条件は Phase 2-3 で実装。ここでは通知のみ)
    for (let i = 1; i <= 3; i++) if (input.wasPressed(`skill${i}`)) this.bus.emit('player:skill', { slot: i });
    if (input.wasPressed('interact')) this.bus.emit('player:interact', { pos: this.position });

    switch (this.state) {
      case 'free': this._updateFree(dt, wishX, wishZ, wishLen, input); break;
      case 'attack': this._updateAttack(dt, wishX, wishZ, wishLen, input); break;
      case 'dodge': this._updateDodge(dt); break;
    }

    // コンボ受付ウィンドウの減衰 (free 状態のみ)
    if (this.state === 'free' && this.comboLinkTimer > 0) {
      this.comboLinkTimer -= dt;
      if (this.comboLinkTimer <= 0) this.comboIndex = 0;
    }

    this._integrate(dt);
    this._animate(dt);

    // MP 自然回復
    const s = this.stats;
    s.mp = Math.min(s.maxMp, s.mp + 2 * dt);
  }

  _tryStartAction(input, wishX, wishZ, wishLen) {
    if (input.wasPressed('dodge') && this.dodgeCd <= 0) {
      this._startDodge(wishX, wishZ, wishLen);
      return true;
    }
    if (this.attackBuffered > 0) {
      this.attackBuffered = 0;
      this._startAttack(wishX, wishZ, wishLen);
      return true;
    }
    return false;
  }

  _updateFree(dt, wishX, wishZ, wishLen, input) {
    if (this._tryStartAction(input, wishX, wishZ, wishLen)) return;
    const cfg = CONFIG.player;
    const tx = wishLen > 0.01 ? (wishX / Math.max(wishLen, 1)) * cfg.walkSpeed * Math.min(wishLen, 1) : 0;
    const tz = wishLen > 0.01 ? (wishZ / Math.max(wishLen, 1)) * cfg.walkSpeed * Math.min(wishLen, 1) : 0;
    const a = 1 - Math.exp(-cfg.accel * 0.35 * dt);
    this.velocity.x += (tx - this.velocity.x) * a;
    this.velocity.z += (tz - this.velocity.z) * a;
    if (wishLen > 0.1) this._turnToward(Math.atan2(wishX, wishZ), dt);
  }

  _turnToward(target, dt) {
    let d = target - this.facing;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.facing += d * (1 - Math.exp(-CONFIG.player.turnSpeed * dt));
  }

  // --- attack (3-hit combo) ---
  _startAttack(wishX, wishZ, wishLen) {
    const combo = CONFIG.player.combo;
    if (this.comboLinkTimer > 0 && this.comboIndex < combo.length - 1 && this.comboHasPrev) {
      this.comboIndex++;
    } else {
      this.comboIndex = 0;
    }
    this.comboHasPrev = true;
    this.state = 'attack'; this.stateTime = 0; this.swingFired = false;
    this.comboLinkTimer = 0;
    // 入力方向があればそちらへ即座に向く (敵ロックオン等は Phase 2 で追加)
    if (wishLen > 0.2) this.facing = Math.atan2(wishX, wishZ);
  }

  _updateAttack(dt, wishX, wishZ, wishLen, input) {
    const cfg = CONFIG.player.combo[this.comboIndex];
    this.stateTime += dt;
    const p = this.stateTime / cfg.dur;

    // 踏み込み: 前半だけ前進
    const lungeSpeed = p < 0.55 ? cfg.lunge / (cfg.dur * 0.55) : 0;
    this.velocity.x = Math.sin(this.facing) * lungeSpeed;
    this.velocity.z = Math.cos(this.facing) * lungeSpeed;

    if (!this.swingFired && p >= cfg.hitAt) {
      this.swingFired = true;
      this.bus.emit('player:swing', {
        combo: this.comboIndex,
        pos: this.position.clone(),
        dir: new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)),
      });
    }

    // 回避キャンセル (振り始めた後ならいつでも)
    if (input.wasPressed('dodge') && this.dodgeCd <= 0 && p > 0.3) {
      this._startDodge(wishX, wishZ, wishLen);
      return;
    }
    // 先行入力で次段へ (後半 40% 以降)
    if (this.attackBuffered > 0 && p >= 0.6 && this.comboIndex < CONFIG.player.combo.length - 1) {
      this.attackBuffered = 0;
      this.comboLinkTimer = 1; // 即連携
      this._startAttack(wishX, wishZ, wishLen);
      return;
    }
    if (p >= 1) {
      this.state = 'free';
      this.velocity.set(0, 0, 0);
      // 3段目を振り切ったらコンボ終了、それ以外は受付猶予
      if (this.comboIndex >= CONFIG.player.combo.length - 1) { this.comboIndex = 0; this.comboHasPrev = false; this.comboLinkTimer = 0; }
      else this.comboLinkTimer = CONFIG.player.comboLink;
    }
  }

  // --- dodge roll ---
  _startDodge(wishX, wishZ, wishLen) {
    const cfg = CONFIG.player;
    if (wishLen > 0.1) this.dodgeDir.set(wishX / wishLen, 0, wishZ / wishLen);
    else this.dodgeDir.set(Math.sin(this.facing), 0, Math.cos(this.facing));
    this.facing = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    this.state = 'dodge'; this.stateTime = 0;
    this.invulnTimer = cfg.dodgeInvuln;
    this.comboLinkTimer = 0; this.comboIndex = 0; this.comboHasPrev = false;
    this.bus.emit('player:dodge', { pos: this.position.clone() });
  }

  _updateDodge(dt) {
    const cfg = CONFIG.player;
    this.stateTime += dt;
    const p = clamp01(this.stateTime / cfg.dodgeDuration);
    const sp = cfg.dodgeSpeed * (1 - 0.6 * p);
    this.velocity.set(this.dodgeDir.x * sp, 0, this.dodgeDir.z * sp);
    if (p >= 1) {
      this.state = 'free';
      this.dodgeCd = cfg.dodgeCooldown;
      this.velocity.multiplyScalar(0.3);
    }
  }

  /** 外部 (敵の攻撃) から呼ぶ。無敵中は無効。実ダメージ計算は Phase 2。 */
  canBeHit() { return !this.isInvulnerable; }

  // --- physics ---
  _integrate(dt) {
    const cfg = CONFIG.player;
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.terrain.resolveCollisions(this.position, cfg.radius);
    this.terrain.clampToWorld(this.position);

    const ground = this.terrain.getHeightAt(this.position.x, this.position.z);
    if (this.position.y > ground + 0.02) {
      this.vy -= cfg.gravity * dt;
      this.position.y += this.vy * dt;
      if (this.position.y <= ground) { this.position.y = ground; this.vy = 0; }
      this.grounded = this.position.y <= ground + 0.02;
    } else {
      // 登り坂は即座に追従 (スナップ)
      this.position.y = ground; this.vy = 0; this.grounded = true;
    }
  }

  // --- visuals ---
  _animate(dt) {
    const cfg = CONFIG.player;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);

    // 歩行サイクル
    if (this.state === 'free' && speed > 0.5) {
      this.walkPhase += dt * (6 + speed * 0.9);
      const sw = Math.sin(this.walkPhase) * Math.min(speed / cfg.walkSpeed, 1) * 0.9;
      this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
      this.armL.rotation.x = -sw * 0.8;
      this.rig.position.y = 0.9 + Math.abs(Math.cos(this.walkPhase)) * 0.05;
    } else if (this.state !== 'dodge') {
      this.legL.rotation.x *= 0.8; this.legR.rotation.x *= 0.8; this.armL.rotation.x *= 0.8;
      this.rig.position.y = 0.9;
    }

    // 回避ロール
    if (this.state === 'dodge') {
      const p = clamp01(this.stateTime / cfg.dodgeDuration);
      this.rig.rotation.x = p * Math.PI * 2;
      this.rig.position.y = 0.9 - Math.sin(p * Math.PI) * 0.25;
      this.legL.rotation.x = this.legR.rotation.x = 1.2;
      this._restSword();
    } else {
      this.rig.rotation.x = 0;
    }

    // 剣
    if (this.state === 'attack') this._animateSwing();
    else if (this.state !== 'dodge') {
      const target = { x: 0.9, y: -0.15 };
      this.swordPivot.rotation.x += (target.x - this.swordPivot.rotation.x) * Math.min(1, dt * 12);
      this.swordPivot.rotation.y += (target.y - this.swordPivot.rotation.y) * Math.min(1, dt * 12);
      this.swordPivot.rotation.z = 0;
    }
    this._syncModel();
  }

  _animateSwing() {
    const cfg = CONFIG.player.combo[this.comboIndex];
    const p = clamp01(this.stateTime / cfg.dur);
    const wind = 0.25, strike = 0.55;
    const r = this.swordPivot.rotation;
    // 0..wind: 振りかぶり / wind..strike: 打ち込み / strike..1: 戻し
    const w = ease(clamp01(p / wind));
    const s = ease(clamp01((p - wind) / (strike - wind)));
    const back = clamp01((p - strike) / (1 - strike));
    if (cfg.swing === 'overhead') {
      let x = 0.9 + (-2.4 - 0.9) * w;               // 振り上げ
      x = x + (0.5 - -2.4) * s * (p >= wind ? 1 : 0);  // 叩きつけ
      r.set(x - back * 0.0, 0, 0);
    } else {
      const sign = cfg.swing === 'right' ? 1 : -1;
      const startY = sign * 1.5, endY = -sign * 1.4;
      let y = -0.15 + (startY + 0.15) * w;
      if (p >= wind) y = startY + (endY - startY) * s;
      r.set(0.1, y, 0);
    }
  }

  _syncModel() {
    this.root.position.copy(this.position);
    this.root.rotation.y = this.facing;
  }
}
