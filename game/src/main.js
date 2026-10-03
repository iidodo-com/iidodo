import { Game } from './core/Game.js';
import { loadAssets } from './core/Assets.js';

const canvas = document.getElementById('game');
const startEl = document.getElementById('start');
const btn = document.getElementById('start-btn');
const cont = document.getElementById('continue-btn');
const ngp = document.getElementById('ngp-btn');

async function boot() {
  const all = [btn, cont, ngp];
  all.forEach((b) => { b.disabled = true; });
  btn.textContent = 'LOADING 0%';
  const assets = await loadAssets((r) => { btn.textContent = `LOADING ${Math.round(r * 100)}%`; });
  const game = new Game(canvas, assets);
  window.__game = game; // デバッグ/自動テスト用
  all.forEach((b) => { b.disabled = false; });
  btn.textContent = 'はじめから';
  const refresh = () => {
    cont.hidden = !game.saves.hasAny();
    const slot = game.saves.latestSlot();
    ngp.hidden = !(slot !== null && game.saves.info(slot)?.cleared);
  };
  refresh();

  // ブラウザの自動再生制限: 最初の操作でオーディオを開始し、タイトル曲を流す
  startEl.addEventListener('pointerdown', () => { game.audio.init(); game.audio.bgm('title'); }, { once: true });
  window.addEventListener('keydown', () => { game.audio.init(); }, { once: true });

  const begin = async (loader) => {
    all.forEach((b) => { b.disabled = true; });
    btn.textContent = '読み込み中…';
    game.audio.init();
    const ok = await loader();
    if (!ok) { all.forEach((b) => { b.disabled = false; }); btn.textContent = 'はじめから'; game.hud.toast('読み込めなかった'); return; }
    startEl.classList.add('hidden');
    if (game.input.isTouch) {
      // スマホ: フルスクリーン + 横向き固定 (対応ブラウザのみ。失敗しても続行)
      try { await document.documentElement.requestFullscreen?.(); } catch { /* noop */ }
      try { await screen.orientation?.lock?.('landscape'); } catch { /* noop */ }
    } else {
      game.input.requestPointerLock();
    }
    game.audio.bgm(game.areas.current);
    game.start();
  };

  btn.addEventListener('click', () => {
    if (game.saves.hasAny() && !confirm('新しく始めると、次のオートセーブで現在のオートセーブが上書きされます。よろしいですか？')) return;
    begin(() => game.newGame().then(() => true));
  });
  cont.addEventListener('click', () => {
    const slot = game.saves.latestSlot();
    if (slot === null) return;
    begin(() => game.saves.load(slot));
  });
  ngp.addEventListener('click', () => {
    const slot = game.saves.latestSlot();
    if (slot === null || !confirm('レベル・装備・所持品を引き継いで最初から始めます (敵が強化されます)。よろしいですか？')) return;
    begin(async () => (await game.saves.load(slot)) && (await game.startNewGamePlus(), true));
  });

  // Esc でポインタロックが外れたらポーズメニューを開く (PC)
  document.addEventListener('pointerlockchange', () => {
    if (game.input.isTouch || !game.running) return;
    if (!game.input.pointerLocked && !game.menu.opened && game.player.state !== 'dead' && !game.cutscene) game.menu.open();
  });
}
boot();
