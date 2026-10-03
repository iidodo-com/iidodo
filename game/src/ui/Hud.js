/** HUD。ゲームステートを DOM に反映するだけの薄い層。 */
export class Hud {
  constructor() {
    this.hpFill = document.getElementById('hp-fill');
    this.hpText = document.getElementById('hp-text');
    this.mpFill = document.getElementById('mp-fill');
    this.mpText = document.getElementById('mp-text');
    this.area = document.getElementById('hud-area');
    this.debug = document.getElementById('hud-debug');
    this.toastEl = document.getElementById('toast');
    this.toastTimer = 0;
    this.flashEl = document.getElementById('hit-flash');
    this.deathEl = document.getElementById('death');
    this._frames = 0; this._acc = 0; this.fps = 0;
  }

  setStats({ hp, maxHp, mp, maxMp }) {
    this.hpFill.style.width = `${(hp / maxHp) * 100}%`;
    this.mpFill.style.width = `${(mp / maxMp) * 100}%`;
    this.hpFill.classList.toggle('low', hp / maxHp < 0.3);
    this.hpText.textContent = `${Math.ceil(hp)} / ${maxHp}`;
    this.mpText.textContent = `${Math.ceil(mp)} / ${maxMp}`;
  }

  hitFlash() {
    this.flashEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove('on')));
  }
  showDeath(on) { this.deathEl.classList.toggle('show', on); }

  setArea(name) { this.area.textContent = name; }

  toast(msg, ms = 1800) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  tick(dt, info) {
    this._frames++; this._acc += dt;
    if (this._acc >= 0.5) {
      this.fps = Math.round(this._frames / this._acc);
      this._frames = 0; this._acc = 0;
      this.debug.textContent = `${this.fps} FPS  ${info}`;
    }
  }
}
