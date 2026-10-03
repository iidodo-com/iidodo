import { Game } from './core/Game.js';

const canvas = document.getElementById('game');
const startEl = document.getElementById('start');
const game = new Game(canvas);
window.__game = game; // デバッグ/自動テスト用

async function begin() {
  startEl.classList.add('hidden');
  if (game.input.isTouch) {
    // スマホ: フルスクリーン + 横向き固定 (対応ブラウザのみ。失敗しても続行)
    try { await document.documentElement.requestFullscreen?.(); } catch { /* noop */ }
    try { await screen.orientation?.lock?.('landscape'); } catch { /* noop */ }
  } else {
    game.input.requestPointerLock();
  }
  game.start();
}
document.getElementById('start-btn').addEventListener('click', begin);

// Esc でポインタロックが外れたらポーズ表示 (PC)
document.addEventListener('pointerlockchange', () => {
  if (game.input.isTouch || !game.running) return;
  if (!game.input.pointerLocked) game.hud.toast('クリックで視点操作を再開', 2500);
});
