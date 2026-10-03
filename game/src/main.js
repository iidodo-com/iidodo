import { Game } from './core/Game.js';
import { loadAssets } from './core/Assets.js';

const canvas = document.getElementById('game');
const startEl = document.getElementById('start');
const btn = document.getElementById('start-btn');

async function boot() {
  btn.disabled = true;
  btn.textContent = 'LOADING 0%';
  const assets = await loadAssets((r) => { btn.textContent = `LOADING ${Math.round(r * 100)}%`; });
  const game = new Game(canvas, assets);
  window.__game = game; // デバッグ/自動テスト用
  btn.disabled = false;
  btn.textContent = 'TAP / CLICK TO START';

  btn.addEventListener('click', async () => {
    startEl.classList.add('hidden');
    if (game.input.isTouch) {
      // スマホ: フルスクリーン + 横向き固定 (対応ブラウザのみ。失敗しても続行)
      try { await document.documentElement.requestFullscreen?.(); } catch { /* noop */ }
      try { await screen.orientation?.lock?.('landscape'); } catch { /* noop */ }
    } else {
      game.input.requestPointerLock();
    }
    game.start();
  });

  // Esc でポインタロックが外れたら案内を表示 (PC)
  document.addEventListener('pointerlockchange', () => {
    if (game.input.isTouch || !game.running) return;
    if (!game.input.pointerLocked) game.hud.toast('クリックで視点操作を再開', 2500);
  });
}
boot();
