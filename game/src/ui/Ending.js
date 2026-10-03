import { CREDITS } from '../data/story.js';

const fmtTime = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

/** スタッフロール (縦スクロール)。完了またはスキップで resolve */
export function showCredits() {
  const el = document.getElementById('credits'), scroll = el.querySelector('.scroll');
  scroll.innerHTML = CREDITS.map(([t, k]) => (k === 'gap' ? '<div class="gap"></div>' : `<div class="${k}">${t}</div>`)).join('');
  el.classList.add('show');
  return new Promise((resolve) => {
    const total = Math.max(40, CREDITS.length * 2.4);
    scroll.style.animation = 'none'; void scroll.offsetWidth;
    scroll.style.animation = `creditroll ${total}s linear forwards`;
    let done = false;
    const end = () => { if (done) return; done = true; el.classList.remove('show'); window.removeEventListener('keydown', onKey); resolve(); };
    const onKey = (e) => { if (e.code === 'Escape') end(); };
    window.addEventListener('keydown', onKey);
    scroll.addEventListener('animationend', end, { once: true });
    const skip = el.querySelector('.skip');
    skip.onclick = end;
    skip.classList.remove('show'); setTimeout(() => skip.classList.add('show'), 3500);
  });
}

/** リザルト画面。選択結果 'continue' | 'ngplus' を返す */
export function showResult(game) {
  const el = document.getElementById('result'), f = game.flags, st = f.stats || {};
  const hours = game.playtime / 3600, deaths = st.deaths || 0;
  const rank = deaths <= 2 && hours <= 8 ? 'S' : deaths <= 6 || hours <= 12 ? 'A' : 'B';
  const ng = f.ng || 0;
  el.innerHTML = `<div class="rbox">
    <h2>THE END</h2><div class="rsub">${ng ? `周回 ${ng + 1} 回目 ` : ''}クリアおめでとう！</div>
    <div class="rgrid">
      <div><span>クリアタイム</span><b>${fmtTime(game.playtime)}</b></div>
      <div><span>到達レベル</span><b>Lv ${game.progression.level}</b></div>
      <div><span>撃破数</span><b>${st.kills || 0}</b></div>
      <div><span>宝箱</span><b>${st.chests || 0}</b></div>
      <div><span>戦闘不能</span><b>${deaths} 回</b></div>
      <div><span>ランク</span><b class="rank">${rank}</b></div>
    </div>
    <div class="rnote">クリアデータを保存しました。<br>「深淵の回廊」(高難易度の隠しダンジョン) がセーブポイントのワープに追加されました。</div>
    <div class="rbtns"><button class="btn2" data-c="continue">つづける (王の間のセーブポイントから)</button><button class="btn2 warn" data-c="ngplus">強くてニューゲーム</button></div>
  </div>`;
  el.classList.add('show');
  return new Promise((resolve) => {
    el.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) { el.classList.remove('show'); el.onclick = null; resolve(b.dataset.c); } };
  });
}
