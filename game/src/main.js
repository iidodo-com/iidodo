import { Game } from './core/Game.js';
import { loadAssets } from './core/Assets.js';

const canvas = document.getElementById('game');
const startEl = document.getElementById('start');
const btn = document.getElementById('start-btn');
const cont = document.getElementById('continue-btn');

async function boot() {
  btn.disabled = cont.disabled = true;
  btn.textContent = 'LOADING 0%';
  const assets = await loadAssets((r) => { btn.textContent = `LOADING ${Math.round(r * 100)}%`; });
  const game = new Game(canvas, assets);
  window.__game = game; // デバッグ/自動テスト用
  btn.disabled = cont.disabled = false;
  btn.textContent = 'はじめから';
  cont.hidden = !game.saves.hasAny();

  const begin = async () => {
    startEl.classList.add('hidden');
    if (game.input.isTouch) {
      // スマホ: フルスクリーン + 横向き固定 (対応ブラウザのみ。失敗しても続行)
      try { await document.documentElement.requestFullscreen?.(); } catch { /* noop */ }
      try { await screen.orientation?.lock?.('landscape'); } catch { /* noop */ }
    } else {
      game.input.requestPointerLock();
    }
    game.start();
  };

  btn.addEventListener('click', () => {
    if (game.saves.hasAny() && !confirm('新しく始めると、次のオートセーブで現在のオートセーブが上書きされます。よろしいですか？')) return;
    begin();
  });
  cont.addEventListener('click', () => {
    const slot = game.saves.latestSlot();
    if (slot === null || !game.saves.load(slot)) { game.hud.toast('セーブデータを読み込めなかった'); return; }
    begin();
  });

  // Esc でポインタロックが外れたらポーズメニューを開く (PC)
  document.addEventListener('pointerlockchange', () => {
    if (game.input.isTouch || !game.running) return;
    if (!game.input.pointerLocked && !game.menu.opened && game.player.state !== 'dead') game.menu.open();
  });
}
boot();
