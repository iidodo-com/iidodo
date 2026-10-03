import * as THREE from 'three';
import { CONFIG, getQuality } from './Config.js';
import { EventBus } from './EventBus.js';
import { Input } from './Input.js';
import { Terrain } from '../world/Terrain.js';
import { createEnvironment } from '../world/Environment.js';
import { Water } from '../world/Water.js';
import { AreaManager } from '../world/AreaManager.js';
import { WorldObjects } from '../world/WorldObjects.js';
import { createCloudSea } from '../world/Sky.js';
import { AREAS } from '../data/areas.js';
import { Dialogue } from '../ui/Dialogue.js';
import { AudioManager } from '../audio/AudioManager.js';
import { Cinematic } from './Cinematic.js';
import { Story } from '../systems/Story.js';
import { KEY_ITEMS } from '../data/items.js';
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
    this.terrain.configure(AREAS.plains);          // 実際の構築は AreaManager.load() が行う
    this._initLights();
    this.water = new Water(this.scene, this.terrain, this.sunDir, this.env);
    this.vegetation = new Vegetation(this.scene, this.terrain, this.quality);
    this.cloudSea = createCloudSea(this.scene);
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
    this.world = new WorldObjects(this);
    this.areas = new AreaManager(this);
    this.cutscene = null;
    this.dialogue = new Dialogue();
    this.cine = new Cinematic(this);
    this.story = new Story(this);
    this.audio = new AudioManager(); this.audio.bind(this);
    this.lightSpots = [];
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
    this.hemi = new THREE.HemisphereLight('#bcd8ff', '#8a9a5a', this.env.hdri ? 1.3 : 2.5);
    this.scene.add(this.hemi);
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
    this.sun = sun; this.fill = fill;
    this.sunOffset = sun.position.clone();
    // 洞窟/研究所用: プレイヤーのランタン + 近くの発光物 (水晶/ピラー) のポイントライト
    this.lamp = new THREE.PointLight('#ffe2b0', 0, 24, 1.6); this.lamp.visible = false;
    this.spots = Array.from({ length: 4 }, () => { const l = new THREE.PointLight('#8fd0ff', 0, 20, 1.8); l.visible = false; return l; });
    this.scene.add(this.lamp, ...this.spots);
  }

  /** エリアの env 設定 (露出/フォグ/背景/ライト) を適用する */
  applyEnvironment(area, props) {
    const e = area.env, env = this.env, scene = this.scene;
    this.renderer.toneMappingExposure = e.exposure;
    if (scene.fog) {
      scene.fog.density = e.fog.density;
      if (e.fog.color === 'auto') scene.fog.color.copy(env.horizon).multiplyScalar(0.92); else scene.fog.color.set(e.fog.color);
    }
    scene.environmentIntensity = e.envIntensity;
    if (env.hdri) {
      if (e.bgColor) scene.background = new THREE.Color(e.bgColor);
      else { scene.background = env.texture; scene.backgroundIntensity = e.bgIntensity; }
    }
    const day = e.sun > 0;
    this.sun.intensity = e.sun; this.sun.visible = day; this.sun.castShadow = day;
    this.sun.color.set(e.sunColor || '#fff0d2');
    this.hemi.intensity = e.hemi; this.hemi.color.set(e.hemiSky || '#bcd8ff'); this.hemi.groundColor.set(e.hemiGround || '#8a9a5a');
    this.fill.intensity = day ? 0.7 : 0.15;
    this.lamp.visible = !!e.lamp; this.lamp.intensity = e.lamp ? 11 : 0;
    this.lightSpots = props?.lightSpots || [];
    const useSpots = !!(e.lamp || e.spotLights) && this.lightSpots.length > 0;
    for (const l of this.spots) { l.visible = useSpots; l.intensity = useSpots ? 14 : 0; }
    this.cloudSea.visible = !!e.cloudSea;
    this.skyBelow = !!e.cloudSea;
    this.ambient.points.visible = area.id !== 'cave' || true;
  }

  _updateLights() {
    const p = this.player.position;
    if (this.lamp.visible) this.lamp.position.set(p.x, p.y + 2.6, p.z);
    if (this.spots[0].visible) {
      const sp = this.lightSpots;
      const order = sp.map((s, i) => [Math.hypot(s.x - p.x, s.z - p.z), i]).sort((a, b) => a[0] - b[0]);
      this.spots.forEach((l, k) => {
        const o = order[k];
        if (!o || o[0] > 60) { l.intensity = 0; return; }
        const s = sp[o[1]]; l.position.set(s.x, s.y, s.z); l.color.setHex(s.color); l.intensity = 14;
      });
    }
    if (this.cloudSea.visible) { this.cloudSea.position.x = this.camera.position.x; this.cloudSea.position.z = this.camera.position.z; }
  }

  _bindEvents() {
    this.bus.on('player:interact', () => { if (!this.world.interact()) this.hud.toast('調べるものがない', 900); });
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

  /** 周回 (強くてニューゲーム) による敵の強化倍率 */
  get difficulty() {
    const ng = this.flags.ng || 0;
    return { hp: 1 + 0.9 * ng, atk: 1 + 0.6 * ng, exp: 1 + 0.5 * ng };
  }

  /** ラスボス撃破時: クリア記録を保存し、隠しダンジョンを解放する */
  onClear() {
    const f = this.flags;
    f.cleared = true; f.clears = (f.clears || 0) + 1;
    f.bestTime = Math.min(f.bestTime || Infinity, Math.floor(this.playtime));
    (f.unlocked ||= {}).abyss = true;
    this.bus.emit('game:cleared');
    this.running = true;
    this.saves.save('auto');
  }

  /** 強くてニューゲーム: レベル・装備・所持品を引き継ぎ、鍵を除いて最初から。敵が強化される */
  async startNewGamePlus() {
    const f = this.flags, keep = { ng: (f.ng || 0) + 1, clears: f.clears || 1, bestTime: f.bestTime, cleared: true, unlocked: { abyss: true }, stats: {} };
    for (const id of Object.keys(KEY_ITEMS)) if (id !== 'ancient_map') this.inventory.items[id] && delete this.inventory.items[id];
    this.inventory._changed();
    this.flags = keep; this.playtime = 0; this.player.skillCd = [0, 0, 0];
    this.progression.recalc(true);
    await this.areas.load('plains', { spawn: 'savepoint', fade: false });
    this.hud.toast(`強くてニューゲーム！ 周回 ${keep.ng + 1}: 敵が強化され、レベル上限が ${this.progression.maxLevel} に`, 4000);
    this.saves.save('auto');
  }

  /** はじめから: 所持品・成長・フラグを初期化して平原を読み込む */
  async newGame() {
    this.inventory.newGame(); this.progression.reset(); this.progression.recalc(true);
    this.flags = {}; this.playtime = 0; this.player.skillCd = [0, 0, 0];
    await this.areas.load('plains', { spawn: 'savepoint', fade: false });
    this.story.pendingPrologue = true;
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
    this.player.stats.hp = this.player.stats.maxHp; this.player.stats.mp = this.player.stats.maxMp;
    this.areas.respawnAtSavepoint();
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

  /** 演出中の更新: ゲームロジックは止め、見た目 (アニメ・粒子・カメラ・ライト) だけを進める */
  _cutsceneStep(dt) {
    this.input.consumeLook();
    TIME.value += dt; this.time += dt;
    this.cutscene.update?.(dt);
    this.enemies.animateOnly(dt);
    this.effects.update(dt);
    this.player.idleAnim(dt);
    this.world.update(dt);
    this.cam.update(dt, this.player.position, { x: 0, y: 0 });
    this.env.update(this.camera.position);
    this._updateLights();
    const p = this.player.position;
    this.sun.target.position.copy(p); this.sun.position.copy(p).add(this.sunOffset);
    this.ambient.update(p);
    this.vegetation.update(p);
    this.labels.update(dt);
  }

  /** ロジック更新 (描画なし)。自動テストからは固定 dt で直接呼べる。 */
  update(dt) {
    this.input.update();
    if (this.input.wasPressed('menu') && !this.cutscene) this.menu.toggle();
    if (this.paused) return;
    if (this.cutscene) { this._cutsceneStep(dt); return; }
    this.playtime += dt;
    this._autoT += dt;
    if (this._autoT >= 45) { this._autoT = 0; this.autosave('timer'); }
    if (this.hitStopT > 0) { this.hitStopT -= dt; dt *= 0.08; }
    TIME.value += dt;
    this.time += dt;

    this.story.update(dt);
    this.audio.update(this);
    // 大型ボスと交戦中はカメラを引いて全体を見せる
    const big = this.enemies.list.find((e) => e.def.boss && e.alive && e.aggro && e.state !== 'return' && e.baseScale >= 2);
    this.cam.distScaleTarget = big ? 1.6 : 1;
    this.player.update(dt, this.input, this.cam);
    this.enemies.update(dt, this);
    this.combat.update(dt);
    this.drops.update(dt);
    this.world.update(dt);
    for (const s of this.systems) s.update(dt, this);
    this.effects.update(dt);
    this.vegetation.update(this.player.position);
    this.ambient.update(this.player.position);

    const look = this.input.consumeLook();
    this.cam.update(dt, this.player.position, look);
    this.env.update(this.camera.position);
    this._updateLights();

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
