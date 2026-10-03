/**
 * セーブ管理 (localStorage)。
 *  - スロット: 'auto' (オートセーブ) + 1..3 (手動)。キーは aetheria.save.<slot>
 *  - バージョン付き JSON。1世代前を .bak に退避し、破損時は自動で .bak から復旧する
 *  - flags: 将来 (宝箱・ボス撃破・解放済みエリア等) 用の汎用フラグ領域
 */
import { AREAS } from '../data/areas.js';
const PREFIX = 'aetheria.save.';
export const SAVE_VERSION = 2;

const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

function parse(raw) {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    return d && typeof d === 'object' && d.version <= SAVE_VERSION && d.player && d.inventory ? d : null;
  } catch { return null; }
}

export class SaveManager {
  constructor(game) { this.game = game; this.lastAuto = 0; }

  snapshot() {
    const g = this.game;
    return {
      version: SAVE_VERSION, savedAt: Date.now(), playtime: Math.floor(g.playtime),
      player: {
        ...g.progression.toJSON(),
        hp: g.player.stats.hp, mp: g.player.stats.mp,
        x: g.player.position.x, z: g.player.position.z, area: g.flags.area || 'plains',
        cooldowns: g.player.skillCd,
      },
      inventory: g.inventory.toJSON(),
      flags: g.flags,
    };
  }

  save(slot = 'auto') {
    const key = PREFIX + slot;
    try {
      const prev = read(key);
      if (prev) localStorage.setItem(key + '.bak', prev);
      localStorage.setItem(key, JSON.stringify(this.snapshot()));
      return true;
    } catch (e) { console.warn('save failed', e); return false; }
  }

  /** 読み込み (破損時は .bak にフォールバック)。無ければ null */
  read(slot = 'auto') {
    return parse(read(PREFIX + slot)) || parse(read(PREFIX + slot + '.bak'));
  }

  /** メニュー表示用の概要 */
  info(slot) {
    const d = this.read(slot);
    return d && { level: d.player.level, gold: d.inventory.gold, playtime: d.playtime || 0, savedAt: d.savedAt };
  }
  latestSlot() {
    let best = null, t = -1;
    for (const s of ['auto', 1, 2, 3]) { const d = this.read(s); if (d && d.savedAt > t) { best = s; t = d.savedAt; } }
    return best;
  }
  hasAny() { return this.latestSlot() !== null; }
  delete(slot) { try { localStorage.removeItem(PREFIX + slot); localStorage.removeItem(PREFIX + slot + '.bak'); } catch { /* noop */ } }

  /** データをゲームへ反映 (エリアの読み込みを伴うので非同期)。成功なら true */
  async load(slot) {
    const d = this.read(slot);
    if (!d) return false;
    const g = this.game;
    g.inventory.fromJSON(d.inventory);
    g.progression.fromJSON(d.player);
    const st = g.player.stats;
    st.hp = Math.max(1, Math.min(st.maxHp, d.player.hp ?? st.maxHp));
    st.mp = Math.min(st.maxMp, d.player.mp ?? st.maxMp);
    g.player.skillCd = Array.isArray(d.player.cooldowns) ? d.player.cooldowns.map((v) => Math.max(0, +v || 0)) : [0, 0, 0];
    g.flags = d.flags && typeof d.flags === 'object' ? d.flags : {};
    g.playtime = d.playtime || 0;
    // v1 (単一エリア時代) のセーブは位置を引き継がず、平原のセーブポイントから再開
    const areaId = d.version >= 2 && AREAS[d.player.area] ? d.player.area : 'plains';
    const pos = d.version >= 2 && Number.isFinite(d.player.x) && Number.isFinite(d.player.z) ? { x: d.player.x, z: d.player.z } : 'savepoint';
    const keepHp = st.hp, keepMp = st.mp;
    await g.areas.load(areaId, { spawn: pos, fade: g.running });
    st.hp = keepHp; st.mp = keepMp;
    g.bus.emit('stats:changed');
    return true;
  }
}
