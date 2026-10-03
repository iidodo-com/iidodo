import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { SKILLS } from '../data/skills.js';

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
    this.stats = { hp: 100, maxHp: 100, mp: 50, maxMp: 50, atk: 18, def: 5, crit: 0.08, critMul: 1.6 };
    this.skillCd = [0, 0, 0];   // スキルのクールダウン残り (秒)
    this.buffs = { cry: 0 };    // バフ残り時間
    this.skillBuf = null;       // {slot, t} 先行入力
    this.castDef = null;
    this.assist = null;         // (pos, facing) => 最寄りの敵 (Combat が設定)
    this.hurtTimer = 0;
    this.flashT = 0;
    this.sinceHit = 99;         // 最後に被弾してからの秒数 (自然回復用)

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
  get moveMul() { return 1 + (this.stats.spdBonus || 0) + (this.buffs.cry > 0 ? SKILLS[1].spd : 0); }
  get isBusy() { return this.state !== 'free'; }

  teleport(x, z) {
    this.position.set(x, this.terrain.getHeightAt(x, z), z);
    this.vy = 0;
    this._syncModel();
  }

  _buildModel() {
    const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });
    const skin = M('#f3cba8', { roughness: 0.55 }), cloth = M('#2f63b8'), clothDk = M('#1f3f7c', { side: THREE.DoubleSide });
    const pants = M('#2b3042'), leather = M('#6e4829', { roughness: 0.8 });
    const metal = M('#dfe6f0', { metalness: 0.85, roughness: 0.28 }), gold = M('#e6b53f', { metalness: 1, roughness: 0.32 });
    const hair = M('#6a3f22', { roughness: 0.5 }), red = M('#c52f3b', { roughness: 0.8, side: THREE.DoubleSide });
    const eye = M('#14213d', { roughness: 0.15 });
    const outlineMat = new THREE.MeshBasicMaterial({ color: '#0e1424', side: THREE.BackSide });

    const add = (parent, geo, mat, x = 0, y = 0, z = 0, o = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      if (o.s) m.scale.set(...o.s);
      if (o.r) m.rotation.set(...o.r);
      m.castShadow = true;
      if (o.out) m.add(new THREE.Mesh(geo, outlineMat)).scale.setScalar(1 + o.out);
      parent.add(m);
      return m;
    };

    this.root = new THREE.Group();
    this.rig = new THREE.Group();            // 腰の高さ。回避ロールの回転中心
    this.rig.position.y = 0.9;
    this.root.add(this.rig);
    const rig = this.rig;

    // 胴体・鎧・ベルト・スカート・マフラー
    add(rig, new THREE.CapsuleGeometry(0.25, 0.3, 6, 16), cloth, 0, 0.17, 0, { s: [1, 1, 0.8], out: 0.045 });
    add(rig, new THREE.SphereGeometry(0.27, 18, 12), metal, 0, 0.3, 0.035, { s: [1.02, 0.52, 0.8] });
    add(rig, new THREE.CylinderGeometry(0.27, 0.275, 0.09, 18), leather, 0, -0.1, 0, { s: [1, 1, 0.82] });
    add(rig, new THREE.BoxGeometry(0.1, 0.08, 0.04), gold, 0, -0.1, 0.235);
    add(rig, new THREE.CylinderGeometry(0.26, 0.4, 0.4, 20, 1, true), clothDk, 0, -0.31, 0, { s: [1, 1, 0.85] });
    add(rig, new THREE.TorusGeometry(0.2, 0.065, 10, 20), red, 0, 0.5, 0, { r: [Math.PI / 2, 0, 0] });

    // 頭: 顔・目・髪・前髪・ポニーテール
    const head = new THREE.Group(); head.position.y = 0.76; rig.add(head);
    add(head, new THREE.SphereGeometry(0.23, 22, 16), skin, 0, 0, 0, { s: [1, 1.05, 1], out: 0.05 });
    for (const sx of [-1, 1]) {
      add(head, new THREE.SphereGeometry(0.036, 10, 8), eye, sx * 0.085, 0.0, 0.205, { s: [1, 1.5, 0.55] });
      add(head, new THREE.SphereGeometry(0.012, 6, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' }), sx * 0.075, 0.025, 0.222);
    }
    add(head, new THREE.SphereGeometry(0.262, 22, 14, 0, Math.PI * 2, 0, 1.95), hair, 0, 0.03, -0.03, { out: 0.045 });
    for (let i = -2; i <= 2; i++) {
      add(head, new THREE.ConeGeometry(0.07, 0.2, 6), hair, i * 0.075, 0.15 - Math.abs(i) * 0.02, 0.2, { r: [Math.PI - 0.35, 0, i * 0.18] });
    }
    add(head, new THREE.CapsuleGeometry(0.055, 0.26, 4, 10), hair, 0, -0.1, -0.27, { r: [0.55, 0, 0] });
    add(head, new THREE.SphereGeometry(0.05, 8, 8), red, 0, 0.1, -0.26);

    // 脚 (腰を支点に振る)
    const leg = (sx) => {
      const g = new THREE.Group(); g.position.set(sx * 0.14, -0.3, 0);
      add(g, new THREE.CapsuleGeometry(0.1, 0.3, 4, 10), pants, 0, -0.2, 0, { out: 0.05 });
      add(g, new THREE.CylinderGeometry(0.115, 0.135, 0.24, 12), leather, 0, -0.47, 0, { out: 0.05 });
      add(g, new THREE.BoxGeometry(0.2, 0.1, 0.32), leather, 0, -0.57, 0.06);
      rig.add(g); return g;
    };
    this.legL = leg(-1); this.legR = leg(1);

    // 左腕
    this.armL = new THREE.Group(); this.armL.position.set(-0.37, 0.4, 0); rig.add(this.armL);
    add(this.armL, new THREE.CapsuleGeometry(0.075, 0.28, 4, 10), cloth, 0, -0.2, 0, { out: 0.05 });
    add(this.armL, new THREE.SphereGeometry(0.09, 10, 8), leather, 0, -0.42, 0);
    add(this.armL, new THREE.SphereGeometry(0.15, 14, 10), metal, -0.03, 0.05, 0, { s: [1, 0.7, 1] });

    // 右腕 + 剣 (swordPivot を回して振る。+Z が前)
    const sp = this.swordPivot = new THREE.Group();
    sp.position.set(0.37, 0.4, 0); sp.rotation.order = 'YXZ'; rig.add(sp);
    add(sp, new THREE.CapsuleGeometry(0.075, 0.26, 4, 10), cloth, 0, 0, 0.17, { r: [Math.PI / 2, 0, 0], out: 0.05 });
    add(sp, new THREE.SphereGeometry(0.15, 14, 10), metal, 0.03, 0.05, 0, { s: [1, 0.7, 1] });
    add(sp, new THREE.SphereGeometry(0.09, 10, 8), leather, 0, 0, 0.36);
    add(sp, new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8), leather, 0, 0, 0.38, { r: [Math.PI / 2, 0, 0] });
    add(sp, new THREE.BoxGeometry(0.32, 0.05, 0.06), gold, 0, 0, 0.54);
    add(sp, new THREE.SphereGeometry(0.045, 8, 8), gold, 0, 0, 0.26);
    const shape = new THREE.Shape();
    shape.moveTo(-0.045, 0); shape.lineTo(0.045, 0); shape.lineTo(0.045, 1.0); shape.lineTo(0, 1.2); shape.lineTo(-0.045, 1.0); shape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
    bladeGeo.rotateX(Math.PI / 2); bladeGeo.translate(0, 0.01, 0.56);
    add(sp, bladeGeo, (() => { const m = M('#e8f0fa', { metalness: 0.9, roughness: 0.18, emissive: '#3aa9ff', emissiveIntensity: 0.6 }); m.userData.glow = true; return m; })());
    const core = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fe7ff').multiplyScalar(2.6) });
    add(sp, new THREE.BoxGeometry(0.014, 0.03, 0.85), core, 0, 0, 1.08);

    // マント (なびく)
    this.capePivot = new THREE.Group(); this.capePivot.position.set(0, 0.46, -0.2); rig.add(this.capePivot);
    const capeGeo = new THREE.PlaneGeometry(0.66, 1.0, 3, 6); capeGeo.translate(0, -0.5, 0);
    this.cape = add(this.capePivot, capeGeo, red, 0, 0, 0);
    this.capeBase = capeGeo.attributes.position.array.slice();

    this.root.traverse((o) => { if (o.isMesh && o.material !== outlineMat) o.castShadow = true; });
  }

  _restSword() {
    this.swordPivot.rotation.set(0.9, -0.15, 0);
  }

  // ---------------------------------------------------------------- update
  update(dt, input, cam) {
    const cfg = CONFIG.player;
    cam.getBasis(this._basis);
    const b = this._basis;
    this.sinceHit += dt;
    if (this.state === 'dead') input.move.x = input.move.y = 0;

    // 入力 (カメラ基準の移動ベクトル)
    const mx = input.move.x, my = input.move.y;
    const wishX = b.fx * my + b.rx * mx;
    const wishZ = b.fz * my + b.rz * mx;
    const wishLen = Math.hypot(wishX, wishZ);

    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.attackBuffered = Math.max(0, this.attackBuffered - dt);
    if (input.wasPressed('attack')) this.attackBuffered = 0.35;

    // スキル: クールダウン/バフの経過と入力
    for (let i = 0; i < 3; i++) this.skillCd[i] = Math.max(0, this.skillCd[i] - dt);
    this.buffs.cry = Math.max(0, this.buffs.cry - dt);
    if (this.skillBuf) { this.skillBuf.t -= dt; if (this.skillBuf.t <= 0) this.skillBuf = null; }
    for (let i = 1; i <= 3; i++) if (input.wasPressed(`skill${i}`)) this._requestSkill(i);
    if (input.wasPressed('potion')) this.bus.emit('player:potion');
    if (input.wasPressed('interact')) this.bus.emit('player:interact', { pos: this.position });

    switch (this.state) {
      case 'free': this._updateFree(dt, wishX, wishZ, wishLen, input); break;
      case 'attack': this._updateAttack(dt, wishX, wishZ, wishLen, input); break;
      case 'dodge': this._updateDodge(dt); break;
      case 'hurt': this._updateHurt(dt); break;
      case 'cast': this._updateCast(dt); break;
      case 'dead': this.velocity.multiplyScalar(Math.exp(-8 * dt)); this.stateTime += dt; break;
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
    // 戦闘から離れたらゆっくり HP 回復
    if (this.state !== 'dead' && this.sinceHit > 6) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.01 * dt);
  }

  _tryStartAction(input, wishX, wishZ, wishLen) {
    if (this.skillBuf) {
      const slot = this.skillBuf.slot; this.skillBuf = null;
      if (this._canCast(slot, false)) { this._startCast(slot, wishX, wishZ, wishLen); return true; }
    }
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
    const ws = cfg.walkSpeed * this.moveMul;
    const tx = wishLen > 0.01 ? (wishX / Math.max(wishLen, 1)) * ws * Math.min(wishLen, 1) : 0;
    const tz = wishLen > 0.01 ? (wishZ / Math.max(wishLen, 1)) * ws * Math.min(wishLen, 1) : 0;
    // 水中は歩行が遅くなる
    const wade = this.terrain.waterDepthAt(this.position.x, this.position.z) > 0.35 ? 0.62 : 1;
    const a = 1 - Math.exp(-cfg.accel * 0.35 * dt);
    this.velocity.x += (tx * wade - this.velocity.x) * a;
    this.velocity.z += (tz * wade - this.velocity.z) * a;
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
    // 近くの敵がいれば自動で向き直る (攻撃アシスト)
    const t = this.assist?.(this.position, this.facing);
    if (t) this.facing = Math.atan2(t.pos.x - this.position.x, t.pos.z - this.position.z);
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

  // --- skills ---
  /** 発動可否。notify=true なら理由をトーストで知らせる */
  _canCast(slot, notify = true) {
    const def = SKILLS[slot - 1], st = this.stats;
    const say = (m) => { if (notify) this.bus.emit('toast', m); };
    if (!def) return false;
    if ((st.level || 1) < def.unlock) { say(`${def.name}は Lv${def.unlock} で解放`); return false; }
    if (this.skillCd[slot - 1] > 0) { say(`${def.name}: クールダウン中`); return false; }
    if (st.mp < def.mp) { say('MPが足りない'); return false; }
    return true;
  }

  _requestSkill(slot) {
    if (this.state === 'dead') return;
    if (!this._canCast(slot)) return;
    if (this.state === 'free') this._startCast(slot, 0, 0, 0);
    else this.skillBuf = { slot, t: 0.3 };       // 動作中なら先行入力として保持
  }

  _startCast(slot, wishX, wishZ, wishLen) {
    const def = SKILLS[slot - 1];
    this.stats.mp -= def.mp; this.skillCd[slot - 1] = def.cd;
    this.castDef = def; this.state = 'cast'; this.stateTime = 0; this.castFired = false;
    this.comboLinkTimer = 0; this.comboIndex = 0; this.comboHasPrev = false;
    if (def.kind === 'projectile') {
      const t = this.assist?.(this.position, this.facing, 9, 1.5);
      if (t) this.facing = Math.atan2(t.pos.x - this.position.x, t.pos.z - this.position.z);
      else if (wishLen > 0.2) this.facing = Math.atan2(wishX, wishZ);
    }
    this.velocity.set(0, 0, 0);
  }

  _updateCast(dt) {
    const def = this.castDef;
    this.stateTime += dt;
    this.velocity.multiplyScalar(Math.exp(-10 * dt));
    if (!this.castFired && this.stateTime >= def.hitAt) {
      this.castFired = true;
      if (def.kind === 'buff') this.buffs.cry = def.dur;
      this.bus.emit('player:skillCast', {
        def, pos: this.position.clone(),
        dir: new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)),
      });
    }
    if (this.stateTime >= def.cast) { this.state = 'free'; this.castDef = null; }
  }

  // --- damage ---
  /** 被ダメージ。無敵中/死亡中は無効 (false)。from は攻撃元のワールド座標。 */
  takeDamage(amount, from, { knock = 4, heavy = false } = {}) {
    if (this.state === 'dead' || this.isInvulnerable) return false;
    const s = this.stats;
    s.hp = Math.max(0, s.hp - amount);
    this.sinceHit = 0; this.flashT = 0.18;
    this.invulnTimer = 0.45;          // 被弾後の短い無敵 (連続ヒット防止)
    const kx = this.position.x - from.x, kz = this.position.z - from.z, kl = Math.hypot(kx, kz) || 1;
    this.velocity.set((kx / kl) * knock, 0, (kz / kl) * knock);
    this.bus.emit('player:hurt', { dmg: amount, heavy, pos: this.position.clone() });
    if (s.hp <= 0) {
      this.state = 'dead'; this.stateTime = 0;
      this.bus.emit('player:dead', { pos: this.position.clone() });
      return true;
    }
    this.state = 'hurt'; this.stateTime = 0; this.hurtDur = heavy ? 0.55 : 0.32; this.castDef = null;
    this.comboIndex = 0; this.comboHasPrev = false; this.comboLinkTimer = 0; this.attackBuffered = 0;
    return true;
  }

  _updateHurt(dt) {
    this.stateTime += dt;
    this.velocity.multiplyScalar(Math.exp(-7 * dt));
    if (this.stateTime >= this.hurtDur) { this.state = 'free'; this.velocity.multiplyScalar(0.3); }
  }

  respawn(x, z) {
    const s = this.stats;
    s.hp = s.maxHp; s.mp = s.maxMp;
    this.state = 'free'; this.stateTime = 0; this.invulnTimer = 2; this.sinceHit = 99;
    this.velocity.set(0, 0, 0); this.rig.rotation.x = 0;
    this.teleport(x, z);
  }

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

    // 被弾のけぞり / 倒れ
    if (this.state === 'hurt') this.rig.rotation.x = -0.45 * Math.sin(Math.min(1, this.stateTime / this.hurtDur) * Math.PI);
    else if (this.state === 'dead') {
      this.rig.rotation.x = -Math.PI / 2 * ease(clamp01(this.stateTime / 0.6));
      this.rig.position.y = 0.9 - 0.62 * ease(clamp01(this.stateTime / 0.6));
    }

    // 回避ロール
    if (this.state === 'dodge') {
      const p = clamp01(this.stateTime / cfg.dodgeDuration);
      this.rig.rotation.x = p * Math.PI * 2;
      this.rig.position.y = 0.9 - Math.sin(p * Math.PI) * 0.25;
      this.legL.rotation.x = this.legR.rotation.x = 1.2;
      this._restSword();
    } else if (this.state !== 'hurt' && this.state !== 'dead' && this.state !== 'cast') {
      this.rig.rotation.x = 0;
    }

    // スキル詠唱モーション
    this.rig.rotation.y = 0;
    if (this.state === 'cast' && this.castDef) {
      const d = this.castDef, p = clamp01(this.stateTime / d.cast), r = this.swordPivot.rotation;
      if (d.id === 'whirl') { this.rig.rotation.y = Math.PI * 2 * ease(p); r.set(0.05, -1.1, 0); this.armL.rotation.x = -1.2; }
      else if (d.id === 'cry') { r.set(-2.5 * ease(Math.min(1, p * 2)), 0, 0); this.armL.rotation.x = -2.8 * ease(Math.min(1, p * 2)); this.rig.position.y = 0.9 + 0.06 * Math.sin(p * Math.PI); }
      else { r.set(p < 0.5 ? -0.3 : -0.05, 0, 0); this.rig.rotation.x = p > 0.5 ? 0.18 : -0.1; }
    }

    // 剣
    if (this.state === 'cast') { /* 上で設定済み */ }
    else if (this.state === 'attack') this._animateSwing();
    else if (this.state !== 'dodge' && this.state !== 'dead' && this.state !== 'cast') {
      const target = { x: 0.9, y: -0.15 };
      this.swordPivot.rotation.x += (target.x - this.swordPivot.rotation.x) * Math.min(1, dt * 12);
      this.swordPivot.rotation.y += (target.y - this.swordPivot.rotation.y) * Math.min(1, dt * 12);
      this.swordPivot.rotation.z = 0;
    }
    this._animateCape(dt, speed);
    this._flash(dt);
    this._syncModel();
  }

  _flash(dt) {
    if (!this._flashMats) {
      this._flashMats = [];
      this.root.traverse((o) => { if (o.isMesh && o.material.emissive && !o.material.userData.glow) this._flashMats.push(o.material); });
    }
    this.flashT = Math.max(0, this.flashT - dt);
    const f = this.flashT / 0.18;
    for (const m of this._flashMats) {
      m.userData.baseEm ??= m.emissive.clone(); m.userData.baseEI ??= m.emissiveIntensity;
      if (f > 0) { m.emissive.setRGB(1, 0.15, 0.08); m.emissiveIntensity = f * 1.6; }
      else { m.emissive.copy(m.userData.baseEm); m.emissiveIntensity = m.userData.baseEI; }
    }
  }

  _animateCape(dt, speed) {
    const t = performance.now() * 0.001, k = Math.min(speed / CONFIG.player.walkSpeed, 2);
    this.capePivot.rotation.x = 0.08 + k * 0.38 + (this.state === 'dodge' ? 0.5 : 0);
    const pos = this.cape.geometry.attributes.position, base = this.capeBase;
    for (let i = 0; i < pos.count; i++) {
      const row = Math.round(-base[i * 3 + 1] / (1 / 6)); // 0(肩)..6(裾)
      const w = row / 6;
      pos.setZ(i, base[i * 3 + 2] - w * w * (0.05 + k * 0.1) + Math.sin(t * 7 + row * 0.9 + base[i * 3] * 4) * 0.035 * w * (0.4 + k));
    }
    pos.needsUpdate = true;
    this.cape.geometry.computeVertexNormals();
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
