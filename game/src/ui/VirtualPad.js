import { CONFIG } from '../core/Config.js';

/**
 * スマホ用タッチUI。
 *  - 左下: 浮動式バーチャルスティック (#stick-zone 内のタッチ位置が中心になる)
 *  - 右下: アクションボタン群 (data-action 属性 → Input.press)
 *  - それ以外の画面領域: スワイプで視点操作
 * Pointer Events + pointerId でマルチタッチを個別に追跡する。
 */
export class VirtualPad {
  constructor(input) {
    this.input = input;
    this.root = document.getElementById('touch-ui');
    this.zone = document.getElementById('stick-zone');
    this.base = document.getElementById('stick-base');
    this.knob = document.getElementById('stick-knob');
    this.radius = 56;
    this.stickId = null;
    this.lookId = null;
    this.lookLast = { x: 0, y: 0 };
    this.origin = { x: 0, y: 0 };
    this.btnPointers = new Map(); // pointerId -> action

    this.root.hidden = false;
    document.body.classList.add('touch');
    this._bindStick();
    this._bindButtons();
    this._bindLook();
  }

  _bindStick() {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      z.setPointerCapture(e.pointerId);
      const r = z.getBoundingClientRect();
      // ゾーン内にクランプして浮動スティックの原点にする
      this.origin.x = Math.min(Math.max(e.clientX, r.left + this.radius), r.right - this.radius);
      this.origin.y = Math.min(Math.max(e.clientY, r.top + this.radius), r.bottom - this.radius);
      this.base.style.left = `${this.origin.x - r.left}px`;
      this.base.style.top = `${this.origin.y - r.top}px`;
      this.base.style.bottom = 'auto';
      this.base.classList.add('active');
      this._updateStick(e);
      e.preventDefault();
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this._updateStick(e);
    });
    const end = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.setStick(0, 0);
      this.base.classList.remove('active');
      this.base.style.left = this.base.style.top = this.base.style.bottom = '';
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  _updateStick(e) {
    let dx = e.clientX - this.origin.x;
    let dy = e.clientY - this.origin.y;
    const len = Math.hypot(dx, dy);
    if (len > this.radius) { dx = (dx / len) * this.radius; dy = (dy / len) * this.radius; }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // 小さなデッドゾーンを設けて再スケール
    let nx = dx / this.radius, ny = -dy / this.radius;
    const m = Math.hypot(nx, ny);
    const dead = 0.12;
    if (m < dead) { nx = 0; ny = 0; }
    else { const s = (m - dead) / (1 - dead) / m; nx *= s; ny *= s; }
    this.input.setStick(nx, ny);
  }

  _bindButtons() {
    document.querySelectorAll('#buttons .btn').forEach((btn) => {
      const action = btn.dataset.action;
      btn.addEventListener('pointerdown', (e) => {
        btn.setPointerCapture(e.pointerId);
        this.btnPointers.set(e.pointerId, action);
        btn.classList.add('down');
        this.input.press(action);
        e.preventDefault();
      });
      const end = (e) => {
        if (!this.btnPointers.has(e.pointerId)) return;
        this.btnPointers.delete(e.pointerId);
        btn.classList.remove('down');
        this.input.release(action);
      };
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
    });
  }

  // スティック・ボタン以外の領域(=canvas)のドラッグで視点回転
  _bindLook() {
    const c = this.input.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.lookId !== null) return;
      this.lookId = e.pointerId;
      c.setPointerCapture(e.pointerId);
      this.lookLast.x = e.clientX; this.lookLast.y = e.clientY;
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.input.addLook(e.clientX - this.lookLast.x, e.clientY - this.lookLast.y, CONFIG.camera.touchSens);
      this.lookLast.x = e.clientX; this.lookLast.y = e.clientY;
    });
    const end = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }
}
