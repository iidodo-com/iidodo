import * as THREE from 'three';
import { PROLOGUE, BOSS_INTRO, PHASE2, SHIELD_BROKEN, DEFEAT, CAPTIONS } from '../data/story.js';
import { showCredits, showResult } from '../ui/Ending.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * ストーリー進行: プロローグ / ラスボス前の会話 / 第2形態への変身 / 撃破後のエンディング。
 * 演出中は game.cutscene が立ち、ゲームロジックは停止 (演出用の更新のみ) する。HUD は非表示。
 */
export class Story {
  constructor(game) {
    this.game = game;
    this.busy = false;
    this.introduced = false;
    this.pendingPrologue = false;
    game.bus.on('area:changed', () => { this.introduced = false; });
    game.bus.on('boss:phase2', ({ enemy }) => this.phase2(enemy));
    game.bus.on('boss:shieldBroken', ({ enemy }) => this.shieldBroken(enemy));
    game.bus.on('boss:defeated', ({ enemy }) => { if (enemy.def.final) this.ending(enemy); });
    game.bus.on('enemy:died', ({ enemy }) => { if (!enemy.def.static) { const s = (game.flags.stats ||= {}); s.kills = (s.kills || 0) + 1; } });
    game.bus.on('player:dead', () => { const s = (game.flags.stats ||= {}); s.deaths = (s.deaths || 0) + 1; });
    game.bus.on('chest:open', () => { const s = (game.flags.stats ||= {}); s.chests = (s.chests || 0) + 1; });
  }

  /** 毎フレーム (通常プレイ時): プロローグとボス前イベントのトリガ判定 */
  update() {
    const g = this.game;
    if (this.busy || g.cutscene || g.paused || !g.running) return;
    if (this.pendingPrologue) { this.pendingPrologue = false; this.prologue(); return; }
    const a = g.areas.area;
    if (a?.final && !this.introduced) {
      const boss = g.enemies.list.find((e) => e.def.final && e.alive);
      if (boss && Math.hypot(g.player.position.x - boss.pos.x, g.player.position.z - boss.pos.z) < (a.boss.trigger || 30)) this.bossIntro(boss);
    }
  }

  /** 演出ブロック: ゲームを停止して fn を実行 */
  async run(fn) {
    const g = this.game;
    this.busy = true; g.cutscene = { update() {} };
    document.body.classList.add('cutscene');
    g.input.pressed.clear(); g.input.down.clear();
    try { await fn(); }
    finally { document.body.classList.remove('cutscene'); g.cine.release(); g.cutscene = null; this.busy = false; g.clock.getDelta(); }
  }

  async prologue() {
    await this.run(async () => {
      const g = this.game, p = g.player.position;
      g.cine.run([{ pos: V(p.x + 5, p.y + 3, p.z - 9), look: V(p.x, p.y + 1.6, p.z + 6), t: 0.01 }, { pos: V(p.x - 3, p.y + 2.6, p.z - 6), look: V(p.x, p.y + 1.4, p.z), t: 14 }]);
      await g.dialogue.play(PROLOGUE);
    });
  }

  async bossIntro(boss) {
    this.introduced = true;
    await this.run(async () => {
      const g = this.game, b = boss.pos;
      g.audio?.bgm('boss_final');
      await g.cine.run([{ pos: V(b.x + 7, b.y + 4.5, b.z + 15), look: V(b.x, b.y + 3, b.z), t: 2.6 }]);
      await g.dialogue.play(BOSS_INTRO);
      boss.aggro = true; boss.state = 'chase';
    });
  }

  async phase2(boss) {
    await this.run(async () => {
      const g = this.game, b = boss.pos;
      g.audio?.sfx('roar');
      boss._applyPhaseVisuals();
      g.cam.shake(0.8);
      g.bus.emit('enemy:slam', { enemy: boss, pos: b.clone(), radius: 9 });
      await g.cine.run(g.cine.orbitKeys(V(b.x, b.y, b.z), { r: 14, h: 4, a0: 0.2, a1: 1.5, dur: 3.2, lookY: 3.2 }));
      await g.dialogue.play(PHASE2);
      boss.beginShieldPhase();
      await g.cine.run([{ pos: V(g.player.position.x, g.player.position.y + 5, g.player.position.z + 12), look: V(b.x, b.y + 2, b.z), t: 1.4 }]);
    });
  }

  async shieldBroken(boss) {
    this.game.hud.toast('結界が砕けた！ 今がチャンスだ！', 2600);
    this.game.audio?.sfx('slam');
    this.game.bus.emit('enemy:slam', { enemy: boss, pos: boss.pos.clone(), radius: 7 });
  }

  /** ラスボス撃破 → 会話 → 余韻の演出 → スタッフロール → リザルト → 選択 */
  async ending(boss) {
    const g = this.game;
    await this.run(async () => {
      g.audio?.bgm('ending');
      const b = boss.pos.clone();
      g.hud.toast('', 1);
      const p1 = g.cine.run([{ pos: V(b.x + 9, b.y + 4, b.z + 14), look: V(b.x, b.y + 3, b.z), t: 1.8 }]);
      await sleep(1100);
      await g.hud.fade(true, 'white');
      await p1;
      g.effects.reset?.();
      await g.hud.fade(false);
      await g.dialogue.play(DEFEAT);

      // 余韻: 主人公の周りをゆっくり周回 → 引きの空撮 (字幕つき)
      const p = g.player.position;
      g.player.respawnAt(p.x, p.z, Math.PI);
      const orbit = g.cine.run(g.cine.orbitKeys(V(p.x, p.y, p.z), { r: 7, h: 2.4, a0: 0.4, a1: 2.6, dur: 8, lookY: 1.5 }));
      for (const [text, ms] of CAPTIONS.slice(0, 2)) await this.caption(text, ms);
      await orbit;
      const wide = g.cine.run([
        { pos: V(p.x, p.y + 6, p.z + 14), look: V(p.x, p.y + 4, p.z - 20), t: 2.5 },
        { pos: V(p.x, p.y + 38, p.z + 70), look: V(p.x, p.y + 6, p.z - 40), t: 10 },
      ]);
      for (const [text, ms] of CAPTIONS.slice(2)) await this.caption(text, ms);
      await wide;
      await g.hud.fade(true);

      // クリア処理 (保存) → スタッフロール → リザルト
      g.onClear();
      document.body.classList.add('plain');                 // レターボックスを外す
      await showCredits();
      const choice = await showResult(g);
      document.getElementById('result').classList.remove('show');
      document.body.classList.remove('plain');
      if (choice === 'ngplus') await g.startNewGamePlus();
      else { g.areas.respawnAtSavepoint(); g.cam.snapTo(g.player.position); g.audio?.bgm(g.areas.current); }
      await sleep(200);
      await g.hud.fade(false);
    });
  }

  async caption(text, ms) {
    const el = document.getElementById('caption');
    el.textContent = text; el.classList.add('show');
    await sleep(ms);
    el.classList.remove('show'); await sleep(700);
  }
}
