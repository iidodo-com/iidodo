import { ALLOC, SKILLS, MAX_LEVEL } from '../data/skills.js';
import { AREAS, AREA_ORDER } from '../data/areas.js';
import { SETTINGS, saveSettings } from '../core/Settings.js';
import {
  CONSUMABLES, MATERIALS, GEMS, KEY_ITEMS, EQUIPMENT, RECIPES, SHOP, SLOT_NAME, RARITY, MAX_PLUS,
  itemInfo, equipStats, enhanceCost,
} from '../data/items.js';

const STAT_LABEL = { atk: '攻撃', def: '防御', hp: 'HP', mp: 'MP', crit: '会心', spd: '移動' };
const fmt = (k, v) => (k === 'crit' || k === 'spd' ? `${Math.round(v * 100)}%` : `${Math.round(v * 10) / 10}`);
const statText = (st) => Object.entries(st).filter(([, v]) => v).map(([k, v]) => `${STAT_LABEL[k]}+${fmt(k, v)}`).join(' ') || '—';
const fmtTime = (s) => `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}`;
const matList = (m, inv) => Object.entries(m).map(([id, n]) => `<span class="${inv.count(id) >= n ? 'ok' : 'need'}">${MATERIALS[id].icon}${MATERIALS[id].name}×${n} (${inv.count(id)})</span>`).join(' ');

const TABS_BASE = [['map', 'マップ'], ['status', 'ステータス'], ['equip', '装備'], ['items', 'アイテム'], ['skills', 'スキル'], ['save', 'セーブ'], ['settings', '設定'], ['help', '操作説明']];
const TABS_SP = [['rest', '休息'], ['shop', 'ショップ'], ['forge', '強化・合成'], ['warp', 'ワープ'], ...TABS_BASE];

/**
 * ポーズメニュー (DOM)。ゲーム状態は触らず、Inventory / Progression / SaveManager の API を呼ぶだけ。
 * 開いている間 game.paused = true。
 */
export class Menu {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('menu');
    this.tab = 'status';
    this.opened = false;
    this.sp = false;      // セーブポイントから開いている間 true (ショップ・強化・ワープが使える)
    this.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) this.act(b.dataset.act, b.dataset);
    });
    document.getElementById('menu-btn').addEventListener('click', () => this.toggle());
    // 設定スライダー: 再描画せずに値だけ更新 (操作中のフォーカスを保つ)
    this.el.addEventListener('input', (e) => {
      const k = e.target.dataset?.setting; if (!k) return;
      SETTINGS[k] = e.target.type === 'checkbox' ? e.target.checked : parseFloat(e.target.value);
      saveSettings(); this.game.audio.applySettings();
      const v = e.target.closest('.slider-row')?.querySelector('.val'); if (v) v.textContent = k === 'sens' || k === 'touchSens' ? `×${SETTINGS[k].toFixed(2)}` : `${Math.round(SETTINGS[k] * 100)}%`;
    });
    this.el.addEventListener('change', (e) => { if (e.target.dataset?.setting === 'sfx') this.game.audio.sfx('hit'); });
    game.bus.on('inventory:changed', () => { if (this.opened) this.render(); });
    game.bus.on('stats:changed', () => { if (this.opened) this.render(); });
  }

  toggle() { this.opened ? this.close() : this.open(); }
  /** セーブポイントを調べた時: 休息・ショップ・強化合成・ワープが使えるメニューを開く */
  openSavepoint() { this.open('rest', true); }

  open(tab, atSavepoint = false) {
    if (this.opened || this.game.cutscene || this.game.player.state === 'dead') return;
    this.sp = atSavepoint;
    this.tab = tab || (TABS_BASE.some(([k]) => k === this.tab) ? this.tab : 'status');
    this.opened = true; this.game.paused = true;
    document.exitPointerLock?.();
    this.el.classList.remove('hidden');
    this.render();
  }
  close() {
    if (!this.opened) return;
    this.opened = false; this.sp = false; this.game.paused = false;
    this.el.classList.add('hidden');
    this.game.clock.getDelta();
    this.game.autosave('menu');
    this.game.input.requestPointerLock();
  }

  // ---------------------------------------------------------------- actions
  act(a, d) {
    const g = this.game, inv = g.inventory, pr = g.progression, say = (m) => g.hud.toast(m, 1600);
    switch (a) {
      case 'close': this.close(); return;
      case 'quality': g.autosave('hide'); location.search = `?q=${d.q}`; return;
      case 'rest': {
        const st = g.player.stats; st.hp = st.maxHp; st.mp = st.maxMp;
        g.enemies.respawnAll();
        g.flags.lastSave = { area: g.areas.current };
        g.saves.save('auto'); g.bus.emit('player:healed');
        say('休息した。HP/MPが全回復し、敵が復活した（オートセーブ済み）');
        break;
      }
      case 'warp': { this.close(); g.areas.load(d.area, { spawn: 'savepoint' }); return; }
      case 'tab': this.tab = d.tab; break;
      case 'alloc': pr.allocate(d.key); break;
      case 'respec': if (!pr.respec()) say('ゴールドが足りない'); break;
      case 'equip': inv.equip(+d.uid); break;
      case 'unequip': inv.unequip(d.slot); break;
      case 'use': if (!g.useConsumable(d.id)) say('今は使えない'); break;
      case 'sell': { const v = inv.sellItem(d.id, 1); if (v) say(`${v}G で売った`); break; }
      case 'sellEquip': { const v = inv.sellEquip(+d.uid); if (v) say(`${v}G で売った`); break; }
      case 'buy': if (inv.buy(d.id)) say(`${itemInfo(d.id).name} を買った`); else say('ゴールドが足りない'); break;
      case 'enhance': if (inv.enhance(+d.uid)) { say('強化に成功！'); g.bus.emit('forge:enhanced'); } else say('強化できない'); break;
      case 'socket': if (inv.socketGem(+d.uid, d.gem)) say('宝珠を装着した'); break;
      case 'unsocket': if (inv.removeGem(+d.uid, +d.idx)) say('宝珠を外した (-50G)'); else say('ゴールドが足りない'); break;
      case 'craft': if (inv.craft(d.id)) say(`${GEMS[d.id].name} を合成した！`); break;
      case 'save': say(g.saves.save(d.slot) ? `スロット${d.slot}にセーブした` : 'セーブに失敗した'); break;
      case 'load':
        this.close();
        g.saves.load(d.slot).then((ok) => g.hud.toast(ok ? 'ロードした' : 'データがない', 1600));
        return;
      case 'del':
        if (this.delArm === d.slot) { g.saves.delete(d.slot); this.delArm = null; } else { this.delArm = d.slot; say('もう一度「削除」を押すと消去します'); }
        break;
    }
    this.render();
  }

  // ---------------------------------------------------------------- render
  render() {
    const g = this.game, inv = g.inventory;
    const TABS = this.sp ? TABS_SP : TABS_BASE;
    if (!TABS.some(([k]) => k === this.tab)) this.tab = 'status';
    const body = { status: () => this.status(), equip: () => this.equip(), items: () => this.items(), shop: () => this.shop(), forge: () => this.forge(), skills: () => this.skills(), save: () => this.save(), rest: () => this.rest(), warp: () => this.warp(), map: () => this.game.nav.mapHtml(), settings: () => this.settings(), help: () => this.help() }[this.tab]();
    const prev = this.el.querySelector('.mbody')?.scrollTop || 0;
    this.el.innerHTML = `
      <div class="panel">
        <div class="mtabs">${TABS.map(([k, n]) => `<button data-act="tab" data-tab="${k}" class="${k === this.tab ? 'on' : ''}">${n}${k === 'status' && g.progression.points ? ' ●' : ''}</button>`).join('')}<span class="spacer"></span><button data-act="close">✕ 閉じる</button></div>
        <div class="mbody">${body}</div>
        <div class="mfoot"><span>Lv ${g.progression.level} ／ プレイ時間 ${fmtTime(g.playtime)}</span><span class="gold">${inv.gold} G</span></div>
      </div>`;
    this.el.querySelector('.mbody').scrollTop = prev;
    if (this.tab === 'map') this.game.nav.drawFull(this.el.querySelector('#fullmap'));
  }

  settings() {
    const row = (label, key, min, max, step, fmt) => `<div class="slider-row"><label>${label}</label><input type="range" min="${min}" max="${max}" step="${step}" value="${SETTINGS[key]}" data-setting="${key}"><span class="val">${fmt(SETTINGS[key])}</span></div>`;
    const pct = (v) => `${Math.round(v * 100)}%`, mul = (v) => `×${v.toFixed(2)}`;
    const cur = this.game.quality.name;
    return `<div class="card"><h4>サウンド</h4>
      ${row('BGM 音量', 'bgm', 0, 1, 0.05, pct)}${row('効果音 音量', 'sfx', 0, 1, 0.05, pct)}
      <div class="slider-row"><label>ミュート</label><input type="checkbox" data-setting="mute" ${SETTINGS.mute ? 'checked' : ''}></div></div>
      <div class="card" style="margin-top:12px"><h4>操作</h4>
      ${row('視点感度 (マウス)', 'sens', 0.4, 2.5, 0.05, mul)}${row('視点感度 (タッチ)', 'touchSens', 0.4, 2.5, 0.05, mul)}</div>
      <div class="card" style="margin-top:12px"><h4>画質 <span class="pill">現在: ${cur}</span></h4>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${['low', 'medium', 'high'].map((q) => `<button class="btn2" data-act="quality" data-q="${q}" ${q === cur ? 'disabled' : ''}>${{ low: '軽量 (low)', medium: '標準 (medium)', high: '高画質 (high)' }[q]}</button>`).join('')}</div>
      <div class="sub" style="margin-top:6px">変更するとオートセーブして再読み込みする (「つづきから」で再開)。動作が重い時は軽量に。</div></div>`;
  }

  help() {
    const rows = (a) => a.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    return `<div class="grid2"><div class="card"><h4>PC</h4><table class="keytable">${rows([['W A S D', '移動'], ['マウス', '視点 (クリックで操作開始 / Esc でメニュー)'], ['左クリック', '攻撃 (3連コンボ)'], ['Space', 'ジャンプ (空中でもう一度=2段ジャンプ / 落下中に長押し=滑空)'], ['空中で左クリック', '叩きつけ攻撃 (範囲ダメージ)'], ['Shift / 右クリック', '回避ロール (無敵)'], ['走り続ける', '自動でダッシュ'], ['M', '全体マップ'], ['1 / 2 / 3', 'スキル'], ['攻撃を紙一重で回避', 'ジャスト回避! スロー発動 → 直後の攻撃は敵へ瞬間移動する超威力カウンター'], ['ダッシュ中/回避直後に攻撃', '突進斬り (長距離・高威力)'], ['ダウン中の敵を攻撃', 'BREAK! 処刑ダメージ'], ['Q', '回復薬をすぐ使う'], ['E', '調べる (宝箱・門・セーブポイント…)'], ['Tab / I', 'メニュー']])}</table></div>
      <div class="card"><h4>スマホ</h4><table class="keytable">${rows([['左下スティック', '移動'], ['画面をドラッグ', '視点'], ['攻撃 / 回避 / ジャンプ', '右下ボタン (空中でもう一度ジャンプ・長押しで滑空・空中で攻撃=叩きつけ)'], ['ミニマップ', 'タップで全体マップ'], ['1 2 3', 'スキル'], ['薬', '回復薬をすぐ使う'], ['調べる', '対象の近くで光る'], ['☰', 'メニュー']])}</table></div></div>
      <div class="card" style="margin-top:12px"><h4>ヒント</h4><div class="sub" style="font-size:13px;opacity:.9;line-height:1.8">
      ・<b>スタイルランク</b>: 当て続ける・技を使い分ける・ジャスト回避/ブレイクを決めるとD→SSSに上昇し、ダメージ最大+36%。被弾で半減、放置で低下。<br>      ・同じ技の連打はポイントが伸びにくい。コンボ・スキル・突進・空中叩きつけを混ぜよう。<br>      ・敵の足元に出る赤い範囲は攻撃の予兆。満ちる前に回避ロールか距離を取ろう。<br>
      ・セーブポイントでは休息・ショップ・強化・宝珠の合成・ワープができる。<br>
      ・各エリアの中ボスを倒すと鍵が手に入り、次のエリアへの門が開く。<br>
      ・洞窟はレバー、研究所はピラー破壊の仕掛けがボスの間を塞いでいる。<br>
      ・クリア後は「強くてニューゲーム」と、隠しダンジョン「深淵の回廊」が遊べる。</div></div>`;
  }

  rest() {
    const g = this.game, a = g.areas.area;
    return `<div class="card"><h4>${a ? a.name : ''} のセーブポイント</h4>
      <div class="sub" style="font-size:13px;opacity:.9;margin:6px 0 12px">休息するとHP・MPが全回復し、倒した敵が（撃破済みのボスを除いて）復活する。同時にオートセーブされる。ここではショップ・装備の強化・宝珠の合成・ワープが使える。</div>
      <button class="btn2" data-act="rest">休息する</button></div>`;
  }

  warp() {
    const g = this.game, ar = g.areas;
    return `<div class="card"><h4>ワープ (解放済みエリアのセーブポイントへ)</h4>${AREA_ORDER.map((id) => {
      const a = AREAS[id], ok = !!g.flags.unlocked?.[id], here = ar.current === id;
      return `<div class="row"><div class="grow"><b>${a.name}</b> <span class="pill">推奨 Lv ${a.level[0]}-${a.level[1]}</span>${here ? '<span class="pill">現在地</span>' : ''}<div class="sub">${ok ? (g.flags.boss?.[id] ? '守護者を撃破済み' : '守護者が待ち構えている') : '未到達'}</div></div>
        <button class="btn2" data-act="warp" data-area="${id}" ${ok && !here ? '' : 'disabled'}>ワープ</button></div>`;
    }).join('')}</div>`;
  }

  status() {
    const g = this.game, pr = g.progression, st = g.player.stats, inv = g.inventory;
    const eq = { atk: 0, def: 0, hp: 0, mp: 0, crit: 0, spd: 0 };
    for (const s of ['weapon', 'armor', 'accessory']) { const i = inv.equippedInst(s); if (i) for (const [k, v] of Object.entries(equipStats(i))) eq[k] += v; }
    const line = (n, v, bonus) => `<div class="stat-line"><span>${n}</span><span><b>${v}</b>${bonus ? `<span class="bonus">装備 +${bonus}</span>` : ''}</span></div>`;
    const need = pr.level >= pr.maxLevel ? 0 : pr.expNeed;
    return `<div class="grid2">
      <div class="card"><h4>キャラクター</h4>
        <div class="stat-line"><span>レベル</span><b>${pr.level}${pr.level >= pr.maxLevel ? ' (MAX)' : ''}${pr.ng ? ` ／ 周回 ${pr.ng + 1}` : ''}</b></div>
        <div class="expbar"><i style="width:${need ? (pr.exp / need) * 100 : 100}%"></i></div>
        <div class="sub" style="font-size:11px;opacity:.7">EXP ${pr.exp} / ${need || '—'}</div>
        <div style="height:8px"></div>
        ${line('HP', `${Math.ceil(st.hp)} / ${st.maxHp}`, Math.round(eq.hp))}
        ${line('MP', `${Math.ceil(st.mp)} / ${st.maxMp}`, Math.round(eq.mp))}
        ${line('攻撃力', Math.round(st.atk), Math.round(eq.atk))}
        ${line('防御力', Math.round(st.def), Math.round(eq.def))}
        ${line('会心率', `${Math.round(st.crit * 100)}%`, eq.crit ? `${Math.round(eq.crit * 100)}%` : '')}
        ${line('移動速度', `+${Math.round((st.spdBonus || 0) * 100)}%`, eq.spd ? `${Math.round(eq.spd * 100)}%` : '')}
      </div>
      <div class="card"><h4>ステータス割り振り <span class="pill">残り ${pr.points} pt</span></h4>
        ${Object.entries(ALLOC).map(([k, a]) => `<div class="row"><div class="grow"><b>${a.name}</b> <span class="pill">${pr.alloc[k]}</span><div class="sub">${a.desc}</div></div><button class="btn2" data-act="alloc" data-key="${k}" ${pr.points ? '' : 'disabled'}>＋</button></div>`).join('')}
        <div style="margin-top:10px"><button class="btn2 warn" data-act="respec" ${Object.values(pr.alloc).some((v) => v) ? '' : 'disabled'}>全リセット (${pr.respecCost()}G)</button></div>
        <div class="sub" style="font-size:11px;opacity:.6;margin-top:6px">レベルアップごとに基礎能力が自動上昇し、2ポイントを割り振れる。</div>
      </div></div>`;
  }

  equipCard(inst, slot) {
    if (!inst) return `<div class="row"><div class="grow sub">— 未装備 —</div></div>`;
    const b = EQUIPMENT[inst.base];
    return `<div class="row"><span class="ic">${itemInfo(inst.base).icon}</span><div class="grow"><b style="color:${RARITY[b.rarity]}">${b.name}${inst.plus ? ` +${inst.plus}` : ''}</b>
      <div class="sub">${statText(equipStats(inst))}</div>
      <div>${inst.gems.map((gm) => `<span class="sock" title="${gm ? GEMS[gm].name : '空き'}" style="${gm ? `background:${GEMS[gm].color}` : ''}"></span>`).join('')}</div></div>
      ${slot ? `<button class="btn2" data-act="unequip" data-slot="${slot}">外す</button>` : ''}</div>`;
  }

  equip() {
    const inv = this.game.inventory;
    return `<div class="grid2">${['weapon', 'armor', 'accessory'].map((slot) => {
      const cur = inv.equippedInst(slot);
      const curSt = cur ? equipStats(cur) : {};
      const list = inv.equipment.filter((e) => EQUIPMENT[e.base].slot === slot && e.uid !== inv.equipped[slot]);
      return `<div class="card"><h4>${SLOT_NAME[slot]}</h4>${this.equipCard(cur, slot)}
        <h3 class="sec">所持品</h3>
        ${list.length ? list.map((e) => {
    const st = equipStats(e), keys = new Set([...Object.keys(st), ...Object.keys(curSt)]);
    const diff = [...keys].map((k) => ({ k, d: (st[k] || 0) - (curSt[k] || 0) })).filter((x) => Math.abs(x.d) > 1e-6)
      .map((x) => `<span class="${x.d > 0 ? 'ok' : 'need'}">${STAT_LABEL[x.k]}${x.d > 0 ? '+' : ''}${fmt(x.k, x.d)}</span>`).join(' ');
    return this.equipCard(e).replace(/<\/div><\/div>$/, '') + `<div class="sub">変化: ${diff || '—'}</div></div><button class="btn2" data-act="equip" data-uid="${e.uid}">装備</button></div>`;
  }).join('') : '<div class="sub">なし</div>'}</div>`;
    }).join('')}</div>`;
  }

  stackRows(group, canUse, canSell) {
    const inv = this.game.inventory;
    const ids = Object.keys(group).filter((id) => inv.count(id) > 0);
    if (!ids.length) return '<div class="sub">なし</div>';
    return ids.map((id) => {
      const i = itemInfo(id);
      return `<div class="row"><span class="ic">${i.icon}</span><div class="grow"><b>${i.name}</b> ×${inv.count(id)}<div class="sub">${i.desc}</div></div>
        ${canUse ? `<button class="btn2" data-act="use" data-id="${id}">使う</button>` : ''}
        ${canSell ? `<button class="btn2" data-act="sell" data-id="${id}">売る</button>` : ''}</div>`;
    }).join('');
  }

  items() {
    return `<div class="grid2">
      <div class="card"><h4>消耗品</h4>${this.stackRows(CONSUMABLES, true, true)}<h3 class="sec">宝珠</h3>${this.stackRows(GEMS, false, true)}</div>
      <div class="card"><h4>素材</h4>${this.stackRows(MATERIALS, false, true)}<h3 class="sec">貴重品</h3>${this.stackRows(KEY_ITEMS, false, false)}</div>
      <div class="card"><h4>装備品の売却</h4>${this.game.inventory.equipment.filter((e) => !this.game.inventory.isEquipped(e.uid)).map((e) => `<div class="row"><span class="ic">${itemInfo(e.base).icon}</span><div class="grow"><b>${EQUIPMENT[e.base].name}${e.plus ? ` +${e.plus}` : ''}</b></div><button class="btn2" data-act="sellEquip" data-uid="${e.uid}">${this.game.inventory.sellValue(e)}G で売る</button></div>`).join('') || '<div class="sub">売れる装備がない</div>'}</div>
    </div>`;
  }

  shop() {
    const inv = this.game.inventory;
    const hi = this.game.areas.highestIndex();
    return `<div class="card"><h4>ショップ <span class="pill">所持 ${inv.gold} G</span></h4>${SHOP.filter((e) => e.minArea <= hi).map(({ id }) => {
      const i = itemInfo(id), owned = i.kind === 'equipment' ? inv.equipment.filter((e) => e.base === id).length : inv.count(id);
      const extra = i.kind === 'equipment' ? statText(i.stats) : i.desc;
      return `<div class="row"><span class="ic">${i.icon}</span><div class="grow"><b style="color:${i.rarity ? RARITY[i.rarity] : '#fff'}">${i.name}</b> <span class="pill">所持 ${owned}</span><div class="sub">${extra}</div></div><button class="btn2" data-act="buy" data-id="${id}" ${inv.gold >= i.price ? '' : 'disabled'}>${i.price} G</button></div>`;
    }).join('')}</div><div class="sub" style="margin-top:8px;opacity:.6">※ 新しいエリアへ進むと品揃えが増える。</div>`;
  }

  forge() {
    const inv = this.game.inventory;
    const enh = inv.equipment.map((e) => {
      const b = EQUIPMENT[e.base], r = inv.canEnhance(e), st = equipStats(e);
      const next = e.plus < MAX_PLUS ? equipStats({ ...e, plus: e.plus + 1 }) : null;
      const gain = next ? Object.keys(next).map((k) => ({ k, d: next[k] - st[k] })).filter((x) => x.d > 1e-6).map((x) => `${STAT_LABEL[x.k]}+${fmt(x.k, x.d)}`).join(' ') : '';
      const sockets = e.gems.map((gm, i) => gm
        ? `<span class="pill" style="border:1px solid ${GEMS[gm].color}">${GEMS[gm].icon}${GEMS[gm].name} <a href="#" data-act="unsocket" data-uid="${e.uid}" data-idx="${i}" style="color:#ff9a9a;text-decoration:none" onclick="return false">✕</a></span>`
        : `<span class="pill">空き</span>`).join('');
      const gemBtns = e.gems.includes(null) ? Object.keys(GEMS).filter((id) => inv.count(id) > 0).map((id) => `<button class="btn2" data-act="socket" data-uid="${e.uid}" data-gem="${id}">${GEMS[id].icon} ${GEMS[id].name}を装着</button>`).join(' ') : '';
      return `<div class="card"><div class="row" style="border:none"><span class="ic">${itemInfo(e.base).icon}</span><div class="grow"><b style="color:${RARITY[b.rarity]}">${b.name} +${e.plus}</b> ${inv.isEquipped(e.uid) ? '<span class="pill">装備中</span>' : ''}<div class="sub">${statText(st)}</div></div></div>
        <div style="margin:4px 0">${sockets}</div>
        ${e.plus < MAX_PLUS ? `<div class="sub">強化 +${e.plus + 1}: ${gain}</div><div class="sub">${r.cost.gold}G ／ ${matList(r.cost.mats, inv)}</div><div style="margin-top:6px"><button class="btn2" data-act="enhance" data-uid="${e.uid}" ${r.ok ? '' : 'disabled'}>強化する</button></div>` : '<div class="sub ok">最大強化</div>'}
        ${gemBtns ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${gemBtns}</div>` : ''}</div>`;
    }).join('');
    const craft = RECIPES.map((r) => `<div class="row"><span class="ic">${GEMS[r.id].icon}</span><div class="grow"><b>${GEMS[r.id].name}</b> <span class="pill">所持 ${inv.count(r.id)}</span><div class="sub">${GEMS[r.id].desc} ／ ${r.gold}G ／ ${matList(r.mats, inv)}</div></div><button class="btn2" data-act="craft" data-id="${r.id}" ${inv.canCraft(r) ? '' : 'disabled'}>合成</button></div>`).join('');
    return `<h3 class="sec">宝珠の合成</h3><div class="card">${craft}</div><h3 class="sec">装備の強化・宝珠の装着 (最大 +${MAX_PLUS})</h3><div class="grid2">${enh}</div>`;
  }

  skills() {
    const lv = this.game.progression.level;
    return `<div class="card">${SKILLS.map((s) => `<div class="row"><span class="pill">${s.slot}</span><div class="grow"><b>${s.name}</b> <span class="pill">MP ${s.mp}</span><span class="pill">CT ${s.cd}s</span><div class="sub">${s.desc}</div></div>${lv >= s.unlock ? '<span class="ok">習得済み</span>' : `<span class="need">Lv ${s.unlock} で解放</span>`}</div>`).join('')}</div>
      <div class="sub" style="margin-top:8px;opacity:.7">PC: 数字キー 1-3 ／ スマホ: 右側のボタン 1-3。通常攻撃は 3 連コンボ、回避中は無敵。</div>`;
  }

  save() {
    const sm = this.game.saves;
    const slots = ['auto', 1, 2, 3].map((s) => {
      const i = sm.info(s);
      return `<div class="row"><div class="grow"><b>${s === 'auto' ? 'オートセーブ' : `スロット ${s}`}</b><div class="sub">${i ? `Lv ${i.level} ／ ${i.gold}G ／ ${fmtTime(i.playtime)} ／ ${new Date(i.savedAt).toLocaleString('ja-JP')}` : '— 空き —'}</div></div>
        ${s === 'auto' ? '' : `<button class="btn2" data-act="save" data-slot="${s}">セーブ</button>`}
        <button class="btn2" data-act="load" data-slot="${s}" ${i ? '' : 'disabled'}>ロード</button>
        ${s === 'auto' ? '' : `<button class="btn2 warn" data-act="del" data-slot="${s}" ${i ? '' : 'disabled'}>${this.delArm === s ? '本当に削除' : '削除'}</button>`}</div>`;
    }).join('');
    return `<div class="card"><h4>セーブ / ロード</h4>${slots}</div><div class="sub" style="margin-top:8px;opacity:.7">オートセーブ: 約45秒ごと・レベルアップ・装備入手・メニューを閉じた時・タブを離れた時。データはこの端末のブラウザ (localStorage) に保存される。</div>`;
  }
}
