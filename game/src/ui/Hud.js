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
    this.lv = document.getElementById('lv-badge'); this.gold = document.getElementById('gold-text');
    this.expFill = document.getElementById('exp-fill'); this.buffEl = document.getElementById('buff-text');
    this.logEl = document.getElementById('pickup-log'); this.lvUp = document.getElementById('levelup');
    this.skEls = [1, 2, 3].map((n) => [document.querySelector(`#skillbar .sk[data-slot="${n}"]`), document.querySelector(`.btn.skill[data-action="skill${n}"]`)]);
    this.skEls.forEach(([, t]) => { if (t && !t.querySelector('.cd')) t.appendChild(Object.assign(document.createElement('i'), { className: 'cd' })); });
    this.potBar = document.getElementById('potion-cnt'); this.potTouch = document.getElementById('potion-cnt-t');
    this._skCache = [];
    this.promptEl = document.getElementById('prompt'); this.fadeEl = document.getElementById('fade');
    this.bannerEl = document.getElementById('area-banner');
    this.interactBtn = document.querySelector('.btn.interact');
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

  setProgress(prog, inv, potions) {
    const key = `${prog.level}|${prog.exp}|${inv.gold}|${potions}|${prog.ng}`;
    if (key === this._pk) return; this._pk = key;
    this.lv.textContent = `Lv ${prog.level}${prog.ng ? ` ★${prog.ng}` : ''}`;
    this.gold.textContent = `${inv.gold} G`;
    this.expFill.style.width = prog.level >= prog.maxLevel ? '100%' : `${(prog.exp / prog.expNeed) * 100}%`;
    this.potBar.textContent = potions; this.potTouch.textContent = potions;
  }

  setSkills(player, level, skills) {
    skills.forEach((sk, i) => {
      const cd = player.skillCd[i], locked = level < sk.unlock, nomp = !locked && player.stats.mp < sk.mp;
      const key = `${locked}|${nomp}|${Math.round(cd / sk.cd * 90)}`;
      if (this._skCache[i] === key) return;
      this._skCache[i] = key;
      const frac = cd > 0 ? `${(cd / sk.cd) * 360}deg` : '0deg';
      for (const el of this.skEls[i]) {
        if (!el) continue;
        el.style.setProperty('--cd', frac);
        el.classList.toggle('locked', locked); el.classList.toggle('nomp', nomp);
        const lk = el.querySelector('.lock'); if (lk) lk.textContent = `Lv${sk.unlock}`;
      }
    });
    const b = player.buffs.cry;
    this.buffEl.textContent = b > 0 ? `闘気 ${Math.ceil(b)}s` : '';
  }

  pickup(text, color) {
    const d = document.createElement('div'); d.textContent = text; if (color) d.style.color = color;
    this.logEl.appendChild(d);
    while (this.logEl.children.length > 6) this.logEl.firstChild.remove();
    setTimeout(() => d.remove(), 3300);
  }

  levelUp(level, points) {
    this.lvUp.querySelector('.sub').textContent = `Lv ${level} に上がった！ 割り振りポイント +${points}（メニュー → ステータス）`;
    this.lvUp.classList.remove('show'); void this.lvUp.offsetWidth; this.lvUp.classList.add('show');
  }

  /** 調べられる対象の案内 (画面下)。null で非表示 */
  setPrompt(text) {
    if (text === this._prompt) return; this._prompt = text;
    const touch = document.body.classList.contains('touch');
    this.promptEl.textContent = text ? (touch ? `「調べる」: ${text}` : `[E] ${text}`) : '';
    this.promptEl.classList.toggle('show', !!text);
    this.interactBtn?.classList.toggle('hot', !!text);
  }

  /** 暗転。on=true で暗くなり、完了時に resolve */
  fade(on, color = 'black') {
    return new Promise((res) => {
      this.fadeEl.classList.toggle('white', color === 'white');
      this.fadeEl.classList.toggle('on', on);
      setTimeout(res, on ? 480 : 520);
    });
  }

  banner(title, sub) {
    this.bannerEl.querySelector('.t').textContent = title;
    this.bannerEl.querySelector('.s').textContent = sub;
    this.bannerEl.classList.remove('show'); void this.bannerEl.offsetWidth; this.bannerEl.classList.add('show');
  }

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
