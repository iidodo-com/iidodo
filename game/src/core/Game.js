import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { EventBus } from './EventBus.js';
import { Input } from './Input.js';
import { Terrain } from '../world/Terrain.js';
import { createSky } from '../world/Sky.js';
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
  constructor(canvas) {
    this.canvas = canvas;
    this.bus = new EventBus();
    this.clock = new THREE.Clock();
    this.running = false;
    this.systems = []; // { update(dt, game) }

    this._initRenderer();
    this.input = new Input(canvas);
    this.hud = new Hud();
    if (this.input.isTouch) this.pad = new VirtualPad(this.input);

    this.terrain = new Terrain(this.scene);
    createSky(this.scene);
    this._initLights();
    this.terrain.build();

    this.player = new Player(this.scene, this.terrain, this.bus);
    this.cam = new FollowCamera(this.camera, this.terrain);
    this.cam.snapTo(this.player.position);

    this._bindEvents();
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 200));
    document.addEventListener('visibilitychange', () => { this.clock.getDelta(); });
    this._resize();
  }

  _initRenderer() {
    const isTouch = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: !isTouch, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.75 : CONFIG.render.maxPixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.1, 500);
    this.shadowSize = isTouch ? CONFIG.render.shadowMapSizeMobile : CONFIG.render.shadowMapSize;
  }

  _initLights() {
    this.scene.add(new THREE.HemisphereLight('#cfe6ff', '#4a5a3a', 1.0));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    sun.position.set(40, 70, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    const sc = sun.shadow.camera;
    sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);
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
    this.camera.aspect = w / h;
    // 縦持ちでは画角を広げて横方向の視界を確保
    this.camera.fov = w / h < 1 ? CONFIG.camera.fov + 14 : CONFIG.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  addSystem(sys) { this.systems.push(sys); }

  start() {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _frame() {
    this.update(Math.min(this.clock.getDelta(), 0.05));
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  /** ロジック更新 (描画なし)。自動テストからは固定 dt で直接呼べる。 */
  update(dt) {
    this.input.update();

    this.player.update(dt, this.input, this.cam);
    for (const s of this.systems) s.update(dt, this);

    const look = this.input.consumeLook();
    this.cam.update(dt, this.player.position, look);

    // 影カメラをプレイヤーに追従
    const p = this.player.position;
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).add(this.sunOffset);

    this.hud.setStats(this.player.stats);
    this.hud.tick(dt, `x:${p.x.toFixed(0)} z:${p.z.toFixed(0)} ${this.player.state}`);
  }
}
