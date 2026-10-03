import * as THREE from 'three';
import { CONFIG, getQuality } from './Config.js';
import { EventBus } from './EventBus.js';
import { Input } from './Input.js';
import { Terrain } from '../world/Terrain.js';
import { createEnvironment } from '../world/Environment.js';
import { createWater } from '../world/Water.js';
import { Vegetation } from '../world/Vegetation.js';
import { TIME } from '../world/Wind.js';
import { PostFx } from './PostFx.js';
import { Effects } from '../fx/Effects.js';
import { Ambient } from '../fx/Ambient.js';
import { Telegraph } from '../fx/Telegraph.js';
import { EnemySystem } from '../systems/EnemySystem.js';
import { Combat } from '../systems/Combat.js';
import { WorldLabels } from '../ui/WorldLabels.js';
import { Inventory } from '../systems/Inventory.js';
import { Progression } from '../systems/Progression.js';
import { Drops } from '../systems/Drops.js';
import { SaveManager } from '../save/SaveManager.js';
import { Menu } from '../ui/Menu.js';
import { SKILLS } from '../data/skills.js';
import { CONSUMABLES } from '../data/items.js';
import { PX } from '../fx/Particles.js';
import { Player } from '../entities/Player.js';
import { FollowCamera } from '../camera/FollowCamera.js';
import { VirtualPad } from '../ui/VirtualPad.js';
import { Hud } from '../ui/Hud.js';

/**
 * ゲーム全体のオーケストレーター。
 * 各システム(world / player / camera / ui)を生成し、メインループで update 順を管理する。
 * Phase 2 以降は systems 配列 (Enemies, Combat, ...) を足していく。
 */
export class Game {
  constructor(canvas, assets = null) {
    this.assets = assets;
    this.canvas = canvas;
    this.bus = new EventBus();
    this.clock = new THREE.Clock();
    this.running = false;
    this.systems = []; // { update(dt, game) }

    this._initRenderer();
    this.input = new Input(canvas);
    this.hud = new Hud();
    if (this.input.isTouch) this.pad = new VirtualPad(this.input);

    this.env = createEnvironment(this.scene, this.renderer, assets);
    this.sunDir = this.env.sunDir;
    this.terrain = new Terrain(this.scene, assets, this.quality);
    this._initLights();
    this.terrain.build();
    this.water = createWater(this.scene, this.terrain, this.sunDir, this.env);
    this.vegetation = new Vegetation(this.scene, this.terrain, this.quality);
    this.ambient = new Ambient(this.scene, this.quality.name === 'low' ? 60 : 140);

    this.player = new Player(this.scene, this.terrain, this.bus);
    this.cam = new FollowCamera(this.camera, this.terrain);
    this.cam.snapTo(this.player.position);
    this.time = 0;
    this.hitStopT = 0;
    this.effects = new Effects(this);
    this.telegraphs = new Telegraph(this.scene, this.terrain);
    this.enemies = new EnemySystem(this);
    this.combat = new Combat(this);
    this.labels = new WorldLabels(this);

    // Phase 3: 育成・所持品・セーブ
    this.paused = false; this.playtime = 0; this.flags = {};
    this.inventory = new Inventory(this.bus);
    this.progression = new Progression(this);
    this.inventory.newGame();
    this.progression.recalc(true);
    this.drops = new Drops(this);
    this.saves = new SaveManager(this);
    this.menu = new Menu(this);
    this._autoT = 0; this._lastSave = -99; this._potionCd = 0;
    this.post = this.quality.post ? new PostFx(this.renderer, this.scene, this.camera, this.quality) : null;

    this._bindEvents();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 200));
    document.addEventListener('visibilitychange', () => { this.clock.getDelta(); });
    this._resize();
  }

  _initRenderer() {
    const isTouch = matchMedia('(pointer: coarse)').matches;
    const q = this.quality = getQuality();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: !q.post && !isTouch, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.dpr));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 600);
    this.shadowSize = q.shadow;
  }

  _initLights() {
    this.scene.add(new THREE.HemisphereLight('#bcd8ff', '#8a9a5a', this.env.hdri ? 1.3 : 2.5));
    const sun = new THREE.DirectionalLight('#fff0d2', this.env.hdri ? 3.6 : 4.2);
    sun.position.copy(this.sunDir).multiplyScalar(90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05; sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    // 影側を青く持ち上げる補助光
    const fill = new THREE.DirectionalLight('#8fb0ff', 0.7);
    fill.position.copy(this.sunDir).multiplyScalar(-60);
    this.scene.add(fill);
    this.sun = sun;
    this.sunOffset = sun.position.clone();
  }

  _bindEvents() {
    this.bus.on('player:interact', () => this.hud.toast('調べるものがない'));
    this.bus.on('toast', (m) => this.hud.toast(m, 1400));
    this.bus.on('pickup', ({ text, color }) => this.hud.pickup(text, color));
    this.bus.on('player:levelup', ({ level }) => { this.hud.levelUp(level, 2); this.autosave('levelup'); });
    this.bus.on('player:potion', () => this.usePotion());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autosave('hide'); });
    window.addEventListener('pagehide', () => this.autosave('hide'));
    this.bus.on('player:hurt', ({ heavy }) => { this.hud.hitFlash(); this.cam.shake(heavy ? 0.5 : 0.28); this.hitStop(heavy ? 0.09 : 0.05); });
    this.bus.on('player:dead', () => {
      this.hud.showDeath(true);
      setTimeout(() => this._respawn(), 3200);
    });
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    // 縦持ちでは画角を広げて横方向の視界を確保
    this.camera.fov = w / h < 1 ? CONFIG.camera.fov + 14 : CONFIG.camera.fov;
    this.camera.updateProjectionMatrix();
    PX.value = (h * this.renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  /** ヒットストップ: 一瞬だけ時間を遅くして打撃の重さを出す */
  hitStop(sec) { this.hitStopT = Math.max(this.hitStopT, sec); }

  /** オートセーブ。reason が 'hide'/'levelup' 以外は 3 秒以内の連続保存を抑制 */
  autosave(reason = '') {
    if (!this.running || this.player.state === 'dead') return;
    if (reason !== 'hide' && reason !== 'levelup' && this.time - this._lastSave < 3) return;
    if (this.saves.save('auto')) {
      this._lastSave = this.time;
      if (reason === 'timer') this.hud.pickup('💾 オートセーブ', '#9fb4d8');
    }
  }

  /** 消耗品を使う。使えなければ false */
  useConsumable(id) {
    const c = CONSUMABLES[id], st = this.player.stats;
    if (!c || this.inventory.count(id) < 1 || this.player.state === 'dead') return false;
    if (c.heal && st.hp >= st.maxHp) return false;
    if (c.mp && st.mp >= st.maxMp) return false;
    this.inventory.remove(id, 1);
    const pos = this.player.position;
    if (c.heal) {
      const h = Math.min(c.heal, st.maxHp - st.hp); st.hp += h;
      this.labels.floatText({ x: pos.x, y: pos.y + 2, z: pos.z }, `+${Math.round(h)}`, 'heal');
    }
    if (c.mp) {
      const m = Math.min(c.mp, st.maxMp - st.mp); st.mp += m;
      this.labels.floatText({ x: pos.x, y: pos.y + 2, z: pos.z }, `MP +${Math.round(m)}`, 'mp');
    }
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * 6.28;
      this.effects.sparks.emit({ pos: { x: pos.x + Math.cos(a) * 0.5, y: pos.y + 0.2, z: pos.z + Math.sin(a) * 0.5 }, vel: { x: 0, y: 2 + Math.random() * 2, z: 0 }, life: 0.8, size: 0.12, sizeEnd: 0, color: c.heal ? [0.8, 3.2, 1.2] : [0.8, 1.6, 3.6] });
    }
    return true;
  }

  /** クイック使用 (Q / 薬ボタン): ポーション → ハイポーションの順 */
  usePotion() {
    if (this._potionCd > this.time) return;
    const id = ['potion_s', 'potion_m'].find((i) => this.inventory.count(i) > 0);
    if (!id) { this.hud.toast('回復薬がない', 1200); return; }
    if (this.player.stats.hp >= this.player.stats.maxHp) { this.hud.toast('HPは満タン', 1000); return; }
    if (this.useConsumable(id)) this._potionCd = this.time + 0.6;
  }

  _respawn() {
    this.autosave('hide');
    this.player.respawn(0, 0);
    this.cam.snapTo(this.player.position);
    this.enemies.resetAggro();
    this.hud.showDeath(false);
    this.autosave('hide');
  }

  addSystem(sys) { this.systems.push(sys); }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.update(dt);
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  /** ロジック更新 (描画なし)。自動テストからは固定 dt で直接呼べる。 */
  update(dt) {
    this.input.update();
    if (this.input.wasPressed('menu')) this.menu.toggle();
    if (this.paused) return;
    this.playtime += dt;
    this._autoT += dt;
    if (this._autoT >= 45) { this._autoT = 0; this.autosave('timer'); }
    if (this.hitStopT > 0) { this.hitStopT -= dt; dt *= 0.08; }
    TIME.value += dt;
    this.time += dt;

    this.player.update(dt, this.input, this.cam);
    this.enemies.update(dt, this);
    this.combat.update(dt);
    this.drops.update(dt);
    for (const s of this.systems) s.update(dt, this);
    this.effects.update(dt);
    this.vegetation.update(this.player.position);
    this.ambient.update(this.player.position);

    const look = this.input.consumeLook();
    this.cam.update(dt, this.player.position, look);
    this.env.update(this.camera.position);

    // 影カメラをプレイヤーに追従
    const p = this.player.position;
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).add(this.sunOffset);

    this.labels.update(dt);
    this.hud.setStats(this.player.stats);
    this.hud.setProgress(this.progression, this.inventory, this.inventory.count('potion_s') + this.inventory.count('potion_m'));
    this.hud.setSkills(this.player, this.progression.level, SKILLS);
    this.hud.tick(dt, `x:${p.x.toFixed(0)} z:${p.z.toFixed(0)} ${this.player.state}`);
  }
}
