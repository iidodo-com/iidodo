/**
 * 会話ダイアログ (DOM)。タイプライター表示、タップ/クリック/Enter/Space/E で送り。
 * play(lines) は全行を読み終えると resolve する Promise を返す。ゲームの停止は呼び出し側 (Story) が担当。
 */
export class Dialogue {
  constructor() {
    this.el = document.getElementById('dialogue');
    this.nameEl = this.el.querySelector('.dname');
    this.textEl = this.el.querySelector('.dtext');
    this.active = false;
    this._advance = null;
    this.el.addEventListener('pointerdown', (e) => { e.preventDefault(); this._advance?.(); });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (['Enter', 'Space', 'KeyE', 'KeyF', 'ArrowRight'].includes(e.code)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) this._advance?.(); }
    }, true);
  }

  async play(lines) {
    this.active = true; this.el.classList.add('show');
    for (const line of lines) await this._line(line);
    this.el.classList.remove('show'); this.active = false; this._advance = null;
  }

  _line({ who, text }) {
    return new Promise((resolve) => {
      this.nameEl.textContent = who || '';
      this.nameEl.style.display = who ? '' : 'none';
      this.el.classList.toggle('narration', !who);
      this.textEl.textContent = '';
      this.el.classList.remove('done');
      let i = 0, done = false;
      const tick = setInterval(() => {
        i += 1; this.textEl.textContent = text.slice(0, i);
        if (i >= text.length) finish();
      }, 38);
      const finish = () => { clearInterval(tick); done = true; this.textEl.textContent = text; this.el.classList.add('done'); };
      this._advance = () => { if (!done) finish(); else { this._advance = null; resolve(); } };
    });
  }
}
