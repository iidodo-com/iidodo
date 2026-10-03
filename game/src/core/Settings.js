/** ユーザー設定 (localStorage に保存)。音量・視点感度など。 */
const KEY = 'aetheria.settings';
const DEFAULTS = { bgm: 0.5, sfx: 0.7, mute: false, sens: 1, touchSens: 1 };

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export const SETTINGS = load();
export function saveSettings() { try { localStorage.setItem(KEY, JSON.stringify(SETTINGS)); } catch { /* noop */ } }
