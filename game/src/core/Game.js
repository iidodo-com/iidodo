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
    this.effects = new Effects(this);
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
    this.bus.on('player:skill', ({ slot }) => this.hud.toast(`スキル${slot}: Phase 3 で実装予定`));
    this.bus.on('player:interact', () => this.hud.toast('調べるものがない'));
    this.bus.on('player:dodge', () => {});
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
    TIME.value += dt;

    this.player.update(dt, this.input, this.cam);
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

    this.hud.setStats(this.player.stats);
    this.hud.tick(dt, `x:${p.x.toFixed(0)} z:${p.z.toFixed(0)} ${this.player.state}`);
  }
}
