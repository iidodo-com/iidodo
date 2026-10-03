import { CONFIG } from './Config.js';

/**
 * 入力の抽象化レイヤー。
 * PC(キーボード+マウス) / スマホ(バーチャルパッド) のどちらも、ここで同じ形式に正規化する。
 *
 *  - move   : {x, y}  (-1..1) ※ y=+1 が「前」
 *  - look   : フレーム内の視点回転量 (rad)。consumeLook() で取り出す
 *  - actions: 'attack' 'dodge' 'interact' 'skill1..3' の押下状態
 *             isDown(name)  … 押している間 true
 *             wasPressed(name) … 押した瞬間 1フレームだけ true (endFrame() でクリア)
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.down = new Set();
    this.pressed = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.pointerLocked = false;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

    this._bindKeyboard();
    this._bindMouse();
  }

  // ---------- public API ----------
  isDown(a) { return this.down.has(a); }
  wasPressed(a) { return this.pressed.has(a); }

  consumeLook() {
    const r = { x: this.lookDX, y: this.lookDY };
    this.lookDX = 0; this.lookDY = 0;
    return r;
  }

  /** 毎フレーム、移動ベクトルを合成する */
  update() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.stick.x;
    y += this.stick.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = x; this.move.y = y;
  }

  endFrame() { this.pressed.clear(); }

  // タッチUI / その他から呼ぶ
  press(action) {
    if (!this.down.has(action)) this.pressed.add(action);
    this.down.add(action);
  }
  release(action) { this.down.delete(action); }
  setStick(x, y) { this.stick.x = x; this.stick.y = y; }
  addLook(dx, dy, sens) { this.lookDX += dx * sens; this.lookDY += dy * sens; }

  requestPointerLock() {
    if (this.isTouch) return;
    this.canvas.requestPointerLock?.();
  }

  // ---------- keyboard ----------
  _bindKeyboard() {
    const map = {
      Space: 'dodge', KeyE: 'interact', KeyF: 'interact',
      Digit1: 'skill1', Digit2: 'skill2', Digit3: 'skill3',
      KeyQ: 'potion', Tab: 'menu', KeyI: 'menu',
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = map[e.code];
      if (a) { this.press(a); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const a = map[e.code];
      if (a) this.release(a);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.down.clear(); });
  }

  // ---------- mouse ----------
  _bindMouse() {
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.addLook(e.movementX, e.movementY, CONFIG.camera.mouseSens);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.isTouchLike(e)) return;
      if (!this.pointerLocked) { this.requestPointerLock(); return; }
      if (e.button === 0) this.press('attack');
      if (e.button === 2) this.press('dodge');
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.release('attack');
      if (e.button === 2) this.release('dodge');
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isTouchLike(e) { return e.sourceCapabilities?.firesTouchEvents === true; }
}
