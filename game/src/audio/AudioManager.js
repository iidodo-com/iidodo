import { SETTINGS } from '../core/Settings.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * BGM 定義: 8 分音符グリッドの生成音楽。
 *   prog: 小節ごとの [ルートからの半音, 'maj'|'min']   arp: 1 小節 8 ステップ分のコード音インデックス (-1 は休符)
 */
const BGM = {
  title:  { bpm: 72, root: 57, prog: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']], arp: [0, 2, 1, 2, 0, 2, 1, -1], pad: 'sawtooth', lp: 900, echo: 0.25, vol: 1 },
  plains: { bpm: 84, root: 60, prog: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']], arp: [0, 1, 2, 1, 0, 2, 1, 2], pad: 'triangle', lp: 1400, echo: 0.2, vol: 1 },
  ruins: { bpm: 64, root: 57, prog: [[0, 'min'], [8, 'maj'], [3, 'maj'], [10, 'maj']], arp: [0, -1, 2, -1, 1, -1, 2, 1], pad: 'sawtooth', lp: 700, echo: 0.3, vol: 0.9 },
  cave: { bpm: 54, root: 52, prog: [[0, 'min'], [0, 'min'], [-2, 'maj'], [-4, 'maj']], arp: [2, -1, -1, 1, -1, 0, -1, -1], pad: 'sine', lp: 500, echo: 0.45, vol: 1.1 },
  lab: { bpm: 104, root: 55, prog: [[0, 'min'], [0, 'min'], [-2, 'maj'], [-5, 'maj']], arp: [0, 2, 0, 1, 0, 2, 1, 2], pad: 'square', lp: 1100, echo: 0.12, perc: 'soft', vol: 0.85 },
  sky: { bpm: 92, root: 62, prog: [[0, 'maj'], [2, 'maj'], [7, 'maj'], [9, 'min']], arp: [0, 1, 2, 1, 2, 1, 0, 1], pad: 'triangle', lp: 2000, echo: 0.35, arpOct: 12, vol: 1 },
  throne: { bpm: 70, root: 50, prog: [[0, 'min'], [-2, 'maj'], [-4, 'maj'], [-5, 'maj']], arp: [0, -1, 1, -1, 2, -1, 1, -1], pad: 'sawtooth', lp: 800, echo: 0.3, vol: 1 },
  abyss: { bpm: 58, root: 47, prog: [[0, 'min'], [1, 'maj'], [0, 'min'], [-1, 'maj']], arp: [2, -1, 1, -1, 0, 1, -1, -1], pad: 'sawtooth', lp: 500, echo: 0.4, vol: 1 },
  boss: { bpm: 132, root: 55, prog: [[0, 'min'], [0, 'min'], [-2, 'maj'], [-4, 'maj']], arp: [0, 2, 1, 2, 0, 2, 1, 2], pad: 'sawtooth', lp: 1600, echo: 0.1, perc: 'hard', bass8: true, vol: 0.9 },
  boss_final: { bpm: 144, root: 50, prog: [[0, 'min'], [-4, 'maj'], [-2, 'maj'], [-5, 'maj']], arp: [0, 1, 2, 1, 2, 1, 2, 1], pad: 'sawtooth', lp: 2200, echo: 0.15, perc: 'hard', bass8: true, arpOct: 12, vol: 0.95 },
  ending: { bpm: 68, root: 60, prog: [[0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'maj']], arp: [0, 1, 2, 1, 2, 1, 0, 2], pad: 'triangle', lp: 1800, echo: 0.4, arpOct: 12, vol: 1 },
};

/**
 * Web Audio による効果音とBGM。素材ファイルなしで動く (すべて合成)。
 * ブラウザの自動再生制限のため、最初のユーザー操作で init() を呼ぶ。
 */
export class AudioManager {
  constructor() {
    this.ctx = null; this.current = null; this.track = null;
    this.step = 0; this.nextTime = 0; this.timer = null;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.bgmGain = ctx.createGain(); this.sfxGain = ctx.createGain();
    this.bgmGain.connect(this.master); this.sfxGain.connect(this.master);
    this.master.connect(comp); comp.connect(ctx.destination);
    // BGM 用エコー
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.38; this.delay.connect(fb); fb.connect(this.delay);
    this.echoSend = ctx.createGain(); this.echoSend.gain.value = 0.25;
    this.echoSend.connect(this.delay); this.delay.connect(this.bgmGain);
    // ノイズバッファ
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    this.applySettings();
    ctx.resume?.();
  }

  applySettings() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bgmGain.gain.setTargetAtTime(SETTINGS.mute ? 0 : SETTINGS.bgm * 0.5, t, 0.05);
    this.sfxGain.gain.setTargetAtTime(SETTINGS.mute ? 0 : SETTINGS.sfx, t, 0.05);
  }

  // ------------------------------------------------------------ primitives
  _tone(freq, dur, { type = 'sine', vol = 0.3, to = null, delay = 0, attack = 0.005, dest = null, lp = 0 } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(g); g.connect(dest || this.sfxGain);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _noise(dur, { vol = 0.3, type = 'bandpass', f0 = 1000, f1 = null, q = 1, delay = 0, dest = null } = {}) {
    const ctx = this.ctx; if (!ctx) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
    s.start(t); s.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ SFX
  sfx(name, v = 1) {
    if (!this.ctx || SETTINGS.mute) return;
    const T = (f, d, o) => this._tone(f, d, o), N = (d, o) => this._noise(d, o);
    switch (name) {
      case 'swing': N(0.13, { vol: 0.22, f0: 700 + Math.random() * 200, f1: 2600, q: 0.8 }); break;
      case 'hit': N(0.09, { vol: 0.4, type: 'lowpass', f0: 1800, f1: 300 }); T(150, 0.14, { to: 55, vol: 0.5, type: 'triangle' }); break;
      case 'crit': N(0.12, { vol: 0.5, type: 'lowpass', f0: 3000, f1: 400 }); T(180, 0.2, { to: 50, vol: 0.6, type: 'triangle' }); T(1200, 0.18, { to: 1800, vol: 0.2, type: 'square' }); T(1800, 0.25, { vol: 0.15, delay: 0.05 }); break;
      case 'hurt': T(240, 0.3, { to: 80, type: 'sawtooth', vol: 0.35, lp: 1200 }); N(0.2, { vol: 0.3, type: 'lowpass', f0: 1200, f1: 200 }); break;
      case 'jump': N(0.12, { vol: 0.1, type: 'highpass', f0: 600, f1: 2500 }); break;
      case 'land': N(0.16, { vol: 0.14, type: 'lowpass', f0: 900, f1: 200 }); break;
      case 'dodge': N(0.2, { vol: 0.16, type: 'highpass', f0: 1200, f1: 4000 }); break;
      case 'pickup': T(880, 0.09, { type: 'triangle', vol: 0.2 }); T(1320, 0.14, { type: 'triangle', vol: 0.2, delay: 0.07 }); break;
      case 'coin': T(1760, 0.07, { type: 'square', vol: 0.07 }); T(2349, 0.12, { type: 'square', vol: 0.07, delay: 0.05 }); break;
      case 'levelup': [523, 659, 784, 1047, 1319].forEach((f, i) => { T(f, 0.5, { type: 'triangle', vol: 0.25, delay: i * 0.1 }); T(f * 2, 0.4, { vol: 0.08, delay: i * 0.1 }); }); break;
      case 'chest': [660, 880, 1320, 1760].forEach((f, i) => T(f, 0.5, { vol: 0.2, delay: i * 0.07, type: 'triangle' })); N(0.5, { vol: 0.08, type: 'highpass', f0: 5000, f1: 9000 }); break;
      case 'potion': T(420, 0.35, { to: 900, vol: 0.2, type: 'sine' }); T(640, 0.35, { to: 1300, vol: 0.12, delay: 0.05 }); break;
      case 'whirl': N(0.45, { vol: 0.35, f0: 500, f1: 3000, q: 0.6 }); T(220, 0.4, { to: 600, type: 'sawtooth', vol: 0.12, lp: 1500 }); break;
      case 'bolt': T(1400, 0.3, { to: 300, vol: 0.25, type: 'sawtooth', lp: 2500 }); N(0.3, { vol: 0.2, type: 'highpass', f0: 3000, f1: 800 }); break;
      case 'cry': [196, 247, 294].forEach((f, i) => T(f, 0.9, { type: 'sawtooth', vol: 0.12, lp: 1200, delay: i * 0.04, attack: 0.1 })); T(98, 0.9, { to: 196, vol: 0.3, type: 'triangle' }); break;
      case 'slam': T(70, 0.6, { to: 28, vol: 0.8, type: 'sine' }); N(0.5, { vol: 0.5, type: 'lowpass', f0: 900, f1: 100 }); break;
      case 'roar': T(90, 1.0, { to: 45, vol: 0.5, type: 'sawtooth', lp: 600 }); T(130, 1.0, { to: 60, vol: 0.3, type: 'sawtooth', lp: 500, delay: 0.05 }); N(0.9, { vol: 0.25, type: 'lowpass', f0: 800, f1: 150 }); break;
      case 'ebolt': T(760, 0.2, { to: 280, vol: 0.18, type: 'sawtooth', lp: 2000 }); break;
      case 'impact': T(120, 0.3, { to: 40, vol: 0.4 }); N(0.25, { vol: 0.3, type: 'lowpass', f0: 1500, f1: 200 }); break;
      case 'edead': N(0.4, { vol: 0.3, type: 'lowpass', f0: 2000, f1: 150 }); T(260, 0.4, { to: 60, vol: 0.3, type: 'triangle' }); break;
      case 'gate': T(90, 0.8, { to: 320, vol: 0.4, type: 'sawtooth', lp: 900 }); [523, 784].forEach((f, i) => T(f, 0.6, { vol: 0.15, delay: 0.3 + i * 0.12 })); break;
      case 'save': [392, 494, 587].forEach((f, i) => T(f, 0.9, { vol: 0.15, delay: i * 0.08, attack: 0.02 })); break;
      case 'spring': [523, 659, 784, 988].forEach((f, i) => T(f, 0.7, { vol: 0.14, delay: i * 0.07, type: 'triangle' })); break;
      case 'ui': T(700, 0.05, { type: 'square', vol: 0.06 }); break;
      case 'summon': T(110, 0.6, { to: 440, vol: 0.3, type: 'sawtooth', lp: 1000 }); break;
      case 'victory': [392, 494, 587, 784].forEach((f, i) => T(f, 0.8, { vol: 0.2, delay: i * 0.14, type: 'triangle' })); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ BGM
  bgm(name) {
    if (!this.ctx || name === this.current) return;
    const def = BGM[name]; if (!def) return;
    this.current = name; this.track = def;
    this.step = 0; this.nextTime = this.ctx.currentTime + 0.2;
    // 前の曲のノードは各ステップで個別に自然終了するので、ゲインを一瞬下げて切り替える
    const t = this.ctx.currentTime;
    this.bgmGain.gain.cancelScheduledValues(t);
    this.bgmGain.gain.setValueAtTime(this.bgmGain.gain.value * 0.2, t);
    this.bgmGain.gain.linearRampToValueAtTime(SETTINGS.mute ? 0 : SETTINGS.bgm * 0.5 * (def.vol || 1), t + 1.2);
    this.echoSend.gain.setTargetAtTime(def.echo, t, 0.1);
    if (!this.timer) this.timer = setInterval(() => this._schedule(), 30);
  }

  _schedule() {
    const ctx = this.ctx, d = this.track; if (!ctx || !d) return;
    const eighth = 60 / d.bpm / 2;
    while (this.nextTime < ctx.currentTime + 0.25) {
      this._bgmStep(d, this.step, this.nextTime, eighth);
      this.nextTime += eighth; this.step++;
    }
  }

  _bgmStep(d, step, t, eighth) {
    const ctx = this.ctx, inBar = step % 8, bar = Math.floor(step / 8) % d.prog.length;
    const [off, qual] = d.prog[bar];
    const root = d.root + off, third = qual === 'min' ? 3 : 4;
    const tones = [root, root + third, root + 7];
    const barDur = eighth * 8;
    const voice = (freq, dur, type, vol, attack, lp, dest) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.setTargetAtTime(0.0001, t + dur * 0.7, dur * 0.15);
      let n = o; if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; }
      n.connect(g); g.connect(dest || this.bgmGain); o.start(t); o.stop(t + dur + 0.2);
    };
    // パッド: 小節頭で和音 (2 本ずつわずかにデチューン)
    if (inBar === 0) for (const m of tones) for (const dt of [-6, 6]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
      o.type = d.pad; o.frequency.value = mtof(m) * Math.pow(2, dt / 1200); o.detune.value = dt;
      f.type = 'lowpass'; f.frequency.value = d.lp;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.045, t + barDur * 0.25); g.gain.setTargetAtTime(0.0001, t + barDur * 0.85, barDur * 0.08);
      o.connect(f); f.connect(g); g.connect(this.bgmGain); o.start(t); o.stop(t + barDur + 0.6);
    }
    // ベース
    if (d.bass8) voice(mtof(root - 12), eighth * 0.9, 'sawtooth', 0.13, 0.005, 400);
    else if (inBar === 0 || inBar === 4) voice(mtof(root - 12), eighth * 3.6, 'triangle', 0.22, 0.02, 600);
    // アルペジオ
    const idx = d.arp[inBar];
    if (idx >= 0) {
      const m = tones[idx % 3] + 12 + (idx >= 3 ? 12 : 0) + (d.arpOct || 0);
      voice(mtof(m), eighth * 1.6, d.pad === 'square' ? 'square' : 'triangle', 0.1, 0.004, 3000, null);
      voice(mtof(m), eighth * 1.6, 'sine', 0.05, 0.004, 0, this.echoSend);
    }
    // パーカッション
    if (d.perc) {
      const hard = d.perc === 'hard';
      if (inBar % 4 === 0) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); g.gain.setValueAtTime(hard ? 0.5 : 0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o.connect(g); g.connect(this.bgmGain); o.start(t); o.stop(t + 0.2); }
      if (hard && inBar % 4 === 2) this._noise(0.12, { vol: 0.2, f0: 1800, type: 'bandpass', dest: this.bgmGain, delay: t - ctx.currentTime });
      if (inBar % 2 === 1) this._noise(0.04, { vol: hard ? 0.1 : 0.05, type: 'highpass', f0: 7000, dest: this.bgmGain, delay: t - ctx.currentTime });
    }
  }

  stopBgm() { this.current = null; this.track = null; }

  // ------------------------------------------------------------ ゲームへの接続
  bind(game) {
    const on = (e, fn) => game.bus.on(e, fn);
    on('player:swing', ({ combo }) => this.sfx('swing'));
    on('enemy:hit', ({ crit }) => this.sfx(crit ? 'crit' : 'hit'));
    on('player:hurt', () => this.sfx('hurt'));
    on('player:dodge', () => this.sfx('dodge'));
    on('player:jump', () => this.sfx('jump')); on('player:land', ({ hard }) => this.sfx('land'));
    on('pickup', ({ kind }) => this.sfx(kind === 'gold' ? 'coin' : 'pickup'));
    on('player:levelup', () => this.sfx('levelup'));
    on('chest:open', () => this.sfx('chest'));
    on('gate:open', () => this.sfx('gate')); on('barrier:open', () => this.sfx('gate'));
    on('player:skillCast', ({ def }) => this.sfx(def.id === 'whirl' ? 'whirl' : def.id === 'bolt' ? 'bolt' : 'cry'));
    on('enemy:slam', () => this.sfx('slam')); on('enemy:bolt', () => this.sfx('ebolt')); on('enemy:impact', () => this.sfx('impact'));
    on('enemy:died', ({ enemy }) => { if (!enemy.def.static) this.sfx('edead'); });
    on('enemy:enrage', () => this.sfx('roar')); on('enemy:summon', () => this.sfx('summon'));
    on('player:healed', () => this.sfx('spring'));
    on('boss:defeated', () => this.sfx('victory'));
    document.addEventListener('click', (e) => { if (e.target.closest('.btn2, .mtabs button, #menu-btn')) this.sfx('ui'); });
  }

  /** 毎フレーム: 場面に応じた BGM を選ぶ */
  update(game) {
    if (!this.ctx) return;
    if (game.story?.busy) return;               // 演出中は Story が曲を指定
    const a = game.areas.area; if (!a) return;
    const boss = game.enemies.list.find((e) => e.def.boss && e.alive && e.aggro && e.state !== 'return');
    this.bgm(boss ? (boss.def.final ? 'boss_final' : 'boss') : a.id);
  }
}
