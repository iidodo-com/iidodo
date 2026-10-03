import * as THREE from 'three';
import { AREAS, AREA_ORDER } from '../data/areas.js';
import { ENEMIES } from '../data/enemies.js';
import { itemInfo } from '../data/items.js';

const CELL = 10;               // 探索済み判定のセル (m)
const REVEAL = 26;             // プレイヤー周囲の探索半径 (m)
const IMG = 256;               // 地形画像の解像度
const MINI_SPAN = 90;          // ミニマップが映す範囲 (m, 直径)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const col = (hex) => new THREE.Color(hex);

/**
 * 行き先ナビゲーション。
 *  - 現在の目的 (テキスト + 目標座標) を状況から算出して HUD に表示、画面上にマーカー / 光の柱を出す
 *  - ミニマップ (プレイヤー視点で回転) と全体マップ (メニュー「マップ」/ M キー) を描画
 *  - 歩いた場所を記録する霧 (flags.explored) と、宝箱・ボス・門・セーブポイント等のマーカー
 * ゲームの状態は読むだけで、書き込むのは探索済みフラグのみ。
 */
export class Navigation {
  constructor(game) {
    this.game = game;
    this.objEl = document.getElementById('objective');
    this.markerEl = document.getElementById('nav-marker');
    this.mini = document.getElementById('minimap');
    this.mctx = this.mini.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.mini.width = this.mini.height = Math.round(132 * this.dpr);
    this.mini.addEventListener('click', () => game.menu.open('map'));

    this.areaId = null; this.img = null; this.grid = null; this.n = 0;
    this.obj = null; this._t = 0; this._saveT = 0; this._dirty = false;

    // 目標地点の光の柱 (フォグの影響を受けない)
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 1.4, 60, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd66a').multiplyScalar(1.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    this.beam.visible = false; this.beam.renderOrder = 5;
    game.scene.add(this.beam);

    game.bus.on('area:changed', ({ area }) => this.onArea(area));
    for (const e of ['chest:open', 'gate:open', 'barrier:open', 'boss:defeated', 'inventory:changed', 'lever:pulled']) game.bus.on(e, () => { this._t = 99; });
  }

  // ------------------------------------------------------------ area setup
  onArea(area) {
    const g = this.game;
    this.areaId = area.id;
    this.n = Math.ceil(area.size / CELL);
    const saved = (g.flags.explored ||= {})[area.id];
    this.grid = new Uint8Array(this.n * this.n);
    if (typeof saved === 'string') for (let i = 0; i < Math.min(saved.length, this.grid.length); i++) this.grid[i] = saved.charCodeAt(i) === 49 ? 1 : 0;
    this._renderTerrain(area);
    this._reveal(true);
    this._t = 99;
  }

  _renderTerrain(area) {
    const t = this.game.terrain, half = area.size / 2, tc = area.terrain, pal = area.palette;
    const cv = document.createElement('canvas'); cv.width = cv.height = IMG;
    const cx = cv.getContext('2d'), im = cx.createImageData(IMG, IMG);
    const low = col(pal.grassA), mid = col(pal.grassB), rock = col(pal.rock), sand = col(pal.sand), snow = col(pal.snow);
    const shallow = col(area.water?.shallow || '#3a6a9a'), deep = col(area.water?.deep || '#10284a');
    const wl = t.waterLevel, tmp = new THREE.Color(), step = area.size / IMG;
    for (let j = 0; j < IMG; j++) {
      for (let i = 0; i < IMG; i++) {
        const x = -half + (i + 0.5) * step, z = -half + (j + 0.5) * step;
        const h = t.height(x, z);
        const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
        const d = 2;
        const shade = clamp(0.88 + ((t.height(x - d, z) - t.height(x + d, z)) + (t.height(x, z - d) - t.height(x, z + d))) * 0.09, 0.55, 1.25);
        if (h < wl) tmp.copy(shallow).lerp(deep, clamp((wl - h) / 3, 0, 1));
        else if (edge > 0.88) tmp.copy(rock).multiplyScalar(0.45);
        else {
          const k = clamp(h / Math.max(1, tc.maxHeight), -0.5, 1);
          tmp.copy(low).lerp(mid, clamp(k + 0.3, 0, 1));
          if (h < wl + 0.6) tmp.lerp(sand, 0.7);
          if (h > tc.rockY[0]) tmp.lerp(rock, clamp((h - tc.rockY[0]) / 3, 0, 1));
          if (h > tc.snowY[0]) tmp.lerp(snow, clamp((h - tc.snowY[0]) / 3, 0, 1));
          tmp.multiplyScalar(shade);
        }
        const o = (j * IMG + i) * 4;
        im.data[o] = clamp(tmp.r, 0, 1) * 255; im.data[o + 1] = clamp(tmp.g, 0, 1) * 255; im.data[o + 2] = clamp(tmp.b, 0, 1) * 255; im.data[o + 3] = 255;
      }
    }
    cx.putImageData(im, 0, 0);
    this.img = cv;
  }

  // ------------------------------------------------------------ fog of war
  _cell(x, z, area = AREAS[this.areaId]) {
    const half = area.size / 2;
    const i = Math.floor((x + half) / CELL), j = Math.floor((z + half) / CELL);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }
  explored(x, z) { const c = this._cell(x, z); return c >= 0 && this.grid[c] === 1; }

  _reveal(force) {
    const area = AREAS[this.areaId]; if (!area || !this.grid) return;
    const p = this.game.player.position, half = area.size / 2, r = REVEAL;
    const i0 = Math.floor((p.x - r + half) / CELL), i1 = Math.floor((p.x + r + half) / CELL);
    const j0 = Math.floor((p.z - r + half) / CELL), j1 = Math.floor((p.z + r + half) / CELL);
    for (let j = Math.max(0, j0); j <= Math.min(this.n - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) {
        const cx = -half + (i + 0.5) * CELL, cz = -half + (j + 0.5) * CELL;
        if (Math.hypot(cx - p.x, cz - p.z) <= r && !this.grid[j * this.n + i]) { this.grid[j * this.n + i] = 1; this._dirty = true; }
      }
    }
    if (this._dirty && (force || this._saveT <= 0)) {
      let s = ''; for (let i = 0; i < this.grid.length; i++) s += this.grid[i] ? '1' : '0';
      this.game.flags.explored[area.id] = s; this._dirty = false; this._saveT = 2;
    }
  }

  // ------------------------------------------------------------ objectives
  /** 現在の目的。{ text, sub, x, z, kind } / 目標なしは null */
  objective() {
    const g = this.game, area = g.areas.area; if (!area) return null;
    const f = g.flags, boss = area.boss, bossName = boss ? ENEMIES[boss.id]?.name : '';
    const bossDone = !!f.boss?.[area.id];
    const chests = (area.chests || []).filter((c) => !f.chests?.[`${area.id}:${c.id}`]).length;
    const sub = chests ? `未開封の宝箱 ${chests}` : '宝箱は全て開封済み';
    const next = area.exit?.to ? AREAS[area.exit.to] : null;
    if (area.final) return boss && !bossDone ? { text: `最奥の ${bossName} を討て`, sub: '', x: boss.x, z: boss.z, kind: 'boss' } : null;
    if (!bossDone) {
      if (area.levers?.length && !f.barrier?.[area.id]) {
        const left = area.levers.filter((l) => !f.levers?.[`${area.id}:${l.id}`]);
        if (left.length) {
          const p = g.player.position;
          left.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
          return { text: `レバーを倒して道を開こう (${area.levers.length - left.length}/${area.levers.length})`, sub, x: left[0].x, z: left[0].z, kind: 'lever' };
        }
      }
      if (boss) return { text: `${bossName} を倒そう`, sub, x: boss.x, z: boss.z, kind: 'boss' };
    }
    if (area.exit) {
      const open = !!f.gates?.[area.id];
      if (!open && area.exit.key && g.inventory.count(area.exit.key) <= 0) return { text: `${itemInfo(area.exit.key).name} を手に入れよう`, sub: '守護者が落とした鍵を拾おう', x: boss?.x ?? area.exit.x, z: boss?.z ?? area.exit.z, kind: 'key' };
      return { text: open ? `${next ? next.name : '次'} へ進もう` : `門を開けて ${next ? next.name : '次のエリア'} へ`, sub, x: area.exit.x, z: area.exit.z, kind: 'gate' };
    }
    return null;
  }

  /** マップ上のマーカー一覧。fogged=true は探索済みでないと見えないもの */
  markers() {
    const g = this.game, area = g.areas.area, f = g.flags, out = [];
    if (!area) return out;
    out.push({ k: 'save', x: area.savepoint.x, z: area.savepoint.z, label: 'セーブ' });
    out.push({ k: 'spring', x: area.spring.x, z: area.spring.z, label: '回復の泉', fog: true });
    for (const c of area.chests || []) out.push({ k: 'chest', x: c.x, z: c.z, done: !!f.chests?.[`${area.id}:${c.id}`], fog: true, label: '宝箱' });
    for (const l of area.levers || []) out.push({ k: 'lever', x: l.x, z: l.z, done: !!f.levers?.[`${area.id}:${l.id}`], label: 'レバー' });
    if (area.entrance) out.push({ k: 'gate', x: area.entrance.x, z: area.entrance.z, label: `← ${AREAS[area.entrance.to].name}` });
    if (area.exit) out.push({ k: 'gate', x: area.exit.x, z: area.exit.z, locked: !f.gates?.[area.id], label: area.exit.to ? `${AREAS[area.exit.to].name} →` : '王の間' });
    if (area.barrier) out.push({ k: 'barrier', x: area.barrier.x, z: area.barrier.z, w: area.barrier.width, done: !!f.barrier?.[area.id], label: '障壁' });
    if (area.boss && !f.boss?.[area.id]) out.push({ k: 'boss', x: area.boss.x, z: area.boss.z, label: ENEMIES[area.boss.id]?.name || 'ボス' });
    return out;
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    if (!this.areaId || g.areas.loading) return;
    this._t += dt; this._saveT -= dt;
    this._reveal(false);
    if (this._t >= 0.4) {
      this._t = 0;
      this.obj = this.objective();
      this._updatePanel();
    }
    this._updateMarker();
    this._drawMini();
  }

  _updatePanel() {
    const o = this.obj, el = this.objEl;
    if (!o) { el.classList.remove('show'); this.beam.visible = false; return; }
    const p = this.game.player.position, d = Math.round(Math.hypot(o.x - p.x, o.z - p.z));
    el.innerHTML = `<span class="ob-ico">◆</span> ${o.text}<span class="ob-dist">${d} m</span>${o.sub ? `<div class="ob-sub">${o.sub}</div>` : ''}`;
    el.classList.add('show');
    this.beam.position.set(o.x, this.game.terrain.height(o.x, o.z) + 28, o.z);
    this.beam.visible = d > 14;
  }

  _updateMarker() {
    const o = this.obj, el = this.markerEl, g = this.game;
    if (!o || g.cutscene || g.menu.opened) { el.style.display = 'none'; return; }
    const p = g.player.position, d = Math.hypot(o.x - p.x, o.z - p.z);
    if (d < 9) { el.style.display = 'none'; return; }
    const W = innerWidth, H = innerHeight;
    const v = new THREE.Vector3(o.x, g.terrain.height(o.x, o.z) + 6, o.z).project(g.camera);
    let sx = v.x, sy = v.y;
    const behind = v.z > 1;
    if (behind) { sx = -sx; sy = -sy; }
    let px = (sx * 0.5 + 0.5) * W, py = (-sy * 0.5 + 0.5) * H;
    const mx = 44, myT = 96, myB = 120;
    const off = behind || px < mx || px > W - mx || py < myT || py > H - myB;
    let ang = 0;
    if (off) {
      const dx = px - W / 2, dy = py - H / 2; ang = Math.atan2(dy, dx);
      const k = Math.min((W / 2 - mx) / Math.max(Math.abs(dx), 1e-3), (H / 2 - myB) / Math.max(Math.abs(dy), 1e-3));
      px = W / 2 + dx * Math.min(k, 1e3); py = H / 2 + dy * Math.min(k, 1e3);
      px = clamp(px, mx, W - mx); py = clamp(py, myT, H - myB);
    }
    el.style.display = 'block';
    el.style.transform = `translate(${px}px, ${py}px)`;
    el.classList.toggle('off', off);
    el.firstElementChild.style.transform = off ? `rotate(${ang}rad)` : 'rotate(90deg)';
    el.lastElementChild.textContent = `${Math.round(d)}m`;
  }

  // ------------------------------------------------------------ minimap
  _drawMini() {
    const g = this.game, c = this.mctx, S = this.mini.width, area = AREAS[this.areaId]; if (!area || !this.img) return;
    const p = g.player.position, b = { fx: 0, fz: 0 }; g.cam.getBasis(b);
    const th = -Math.PI / 2 - Math.atan2(b.fz, b.fx);
    const scale = S / MINI_SPAN;                       // px / m
    const half = area.size / 2, c0 = Math.cos(th), s0 = Math.sin(th);
    const toS = (x, z) => { const dx = (x - p.x) * scale, dz = (z - p.z) * scale; return [S / 2 + dx * c0 - dz * s0, S / 2 + dx * s0 + dz * c0]; };
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#0a0f1a'; c.fillRect(0, 0, S, S);
    c.save();
    c.translate(S / 2, S / 2); c.rotate(th); c.scale(scale, scale); c.translate(-p.x, -p.z);
    c.imageSmoothingEnabled = true;
    c.drawImage(this.img, -half, -half, area.size, area.size);
    c.restore();
    for (const m of this.markers()) {
      if (m.fog && !this.explored(m.x, m.z)) continue;
      const [x, y] = toS(m.x, m.z);
      if (Math.hypot(x - S / 2, y - S / 2) > S / 2 - 6) continue;
      this._icon(c, m, x, y, this.dpr * 0.9);
    }
    for (const e of g.enemies.list) {
      if (!e.alive || e.def.static) continue;
      const [x, y] = toS(e.pos.x, e.pos.z);
      if (Math.hypot(x - S / 2, y - S / 2) > S / 2 - 4) continue;
      c.fillStyle = e.def.boss ? '#ff3b3b' : '#ff8a5a'; c.beginPath(); c.arc(x, y, (e.def.boss ? 4 : 2.2) * this.dpr * 0.8, 0, 7); c.fill();
    }
    if (this.obj) this._objMark(c, ...this._edgeClamp(toS(this.obj.x, this.obj.z), S), this.dpr);
    // プレイヤー (カメラ基準の向き)
    const f = g.player.facing, fx = Math.sin(f), fz = Math.cos(f);
    const ax = fx * c0 - fz * s0, ay = fx * s0 + fz * c0, a = Math.atan2(ay, ax);
    this._arrow(c, S / 2, S / 2, a, 6 * this.dpr, '#ffffff');
    // 北の方角
    const nx = 0 * c0 - -1 * s0, ny = 0 * s0 + -1 * c0;
    c.fillStyle = '#fff'; c.font = `bold ${10 * this.dpr}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', S / 2 + nx * (S / 2 - 9 * this.dpr), S / 2 + ny * (S / 2 - 9 * this.dpr));
  }

  _edgeClamp([x, y], S) {
    const dx = x - S / 2, dy = y - S / 2, r = Math.hypot(dx, dy), R = S / 2 - 10 * this.dpr;
    return r > R ? [S / 2 + dx / r * R, S / 2 + dy / r * R] : [x, y];
  }

  _arrow(c, x, y, a, r, color) {
    c.save(); c.translate(x, y); c.rotate(a);
    c.fillStyle = color; c.strokeStyle = '#102040'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(r, 0); c.lineTo(-r * 0.7, r * 0.65); c.lineTo(-r * 0.3, 0); c.lineTo(-r * 0.7, -r * 0.65); c.closePath(); c.fill(); c.stroke();
    c.restore();
  }

  _objMark(c, x, y, k) {
    const t = performance.now() / 1000, r = (6 + Math.sin(t * 4) * 1.2) * k;
    c.save(); c.translate(x, y);
    c.strokeStyle = '#ffd66a'; c.lineWidth = 2 * k; c.beginPath(); c.arc(0, 0, r, 0, 7); c.stroke();
    c.fillStyle = '#ffd66a'; c.beginPath(); c.moveTo(0, -r * 0.6); c.lineTo(r * 0.5, 0); c.lineTo(0, r * 0.6); c.lineTo(-r * 0.5, 0); c.closePath(); c.fill();
    c.restore();
  }

  _icon(c, m, x, y, k) {
    c.save(); c.translate(x, y); c.lineWidth = 1.5 * k; c.strokeStyle = '#0b1226';
    const r = 5 * k;
    switch (m.k) {
      case 'save': c.fillStyle = '#6af0ff'; c.beginPath(); c.moveTo(0, -r * 1.2); c.lineTo(r, 0); c.lineTo(0, r * 1.2); c.lineTo(-r, 0); c.closePath(); c.fill(); c.stroke(); break;
      case 'spring': c.fillStyle = '#6af0c0'; c.fillRect(-r * 0.3, -r, r * 0.6, r * 2); c.fillRect(-r, -r * 0.3, r * 2, r * 0.6); break;
      case 'chest': c.fillStyle = m.done ? '#6b6f7a' : '#ffcf3a'; c.fillRect(-r * 0.9, -r * 0.7, r * 1.8, r * 1.4); c.strokeRect(-r * 0.9, -r * 0.7, r * 1.8, r * 1.4); break;
      case 'lever': c.fillStyle = m.done ? '#6b6f7a' : '#ff9a3a'; c.beginPath(); c.arc(0, 0, r * 0.9, 0, 7); c.fill(); c.stroke(); break;
      case 'gate': c.fillStyle = m.locked ? '#b06aff' : '#8fb0ff'; c.beginPath(); c.moveTo(0, -r * 1.2); c.lineTo(r * 1.1, r); c.lineTo(-r * 1.1, r); c.closePath(); c.fill(); c.stroke(); break;
      case 'barrier': c.strokeStyle = m.done ? '#6b6f7a' : '#c07aff'; c.lineWidth = 3 * k; c.beginPath(); c.moveTo(-r * 1.5, 0); c.lineTo(r * 1.5, 0); c.stroke(); break;
      case 'boss': c.fillStyle = '#ff3b3b'; c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.55 : r * 1.4; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill(); c.stroke(); break;
      default: break;
    }
    c.restore();
  }

  // ------------------------------------------------------------ full map (menu)
  /** メニュー用: canvas に北上げの全体マップを描く */
  drawFull(cv) {
    const g = this.game, area = AREAS[this.areaId]; if (!area || !this.img || !cv) return;
    const S = cv.width, c = cv.getContext('2d'), k = S / area.size, half = area.size / 2;
    const toS = (x, z) => [(x + half) * k, (z + half) * k];
    c.clearRect(0, 0, S, S);
    c.imageSmoothingEnabled = true; c.drawImage(this.img, 0, 0, S, S);
    // 霧: 未探索セルを暗く
    c.fillStyle = 'rgba(6,10,20,.82)';
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) if (!this.grid[j * this.n + i]) c.fillRect(i * CELL * k - 0.5, j * CELL * k - 0.5, CELL * k + 1, CELL * k + 1);
    // 目標への破線
    const p = g.player.position;
    if (this.obj) {
      c.setLineDash([6, 6]); c.strokeStyle = 'rgba(255,214,106,.85)'; c.lineWidth = 2; c.beginPath();
      c.moveTo(...toS(p.x, p.z)); c.lineTo(...toS(this.obj.x, this.obj.z)); c.stroke(); c.setLineDash([]);
    }
    c.font = 'bold 12px sans-serif'; c.textBaseline = 'middle';
    const label = (t, x, y) => { c.textAlign = x > S * 0.72 ? 'right' : 'left'; const dx = x > S * 0.72 ? -12 : 12; c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.8)'; c.strokeText(t, x + dx, y); c.fillStyle = '#fff'; c.fillText(t, x + dx, y); };
    for (const m of this.markers()) {
      if (m.fog && !this.explored(m.x, m.z)) continue;
      const [x, y] = toS(m.x, m.z);
      if (m.k === 'barrier') {
        c.strokeStyle = m.done ? '#6b6f7a' : '#c07aff'; c.lineWidth = 4; c.beginPath(); c.moveTo(...toS(m.x - m.w / 2, m.z)); c.lineTo(...toS(m.x + m.w / 2, m.z)); c.stroke();
      } else this._icon(c, m, x, y, 1.5);
      if (m.k !== 'chest' && m.k !== 'barrier') label(m.label + (m.locked ? ' 🔒' : ''), x, y);
    }
    if (this.obj) this._objMark(c, ...toS(this.obj.x, this.obj.z), 1.5);
    this._arrow(c, ...toS(p.x, p.z), Math.atan2(Math.cos(g.player.facing), Math.sin(g.player.facing)) , 9, '#ffffff');
    c.fillStyle = '#fff'; c.font = 'bold 14px sans-serif'; c.textAlign = 'center'; c.fillText('N ↑', S / 2, 12);
  }

  /** メニュー「マップ」タブの HTML (canvas は render 後に drawFull で描く) */
  mapHtml() {
    const g = this.game, f = g.flags, cur = g.areas.current, o = this.obj || this.objective();
    const route = AREA_ORDER.filter((id) => !AREAS[id].hidden || f.unlocked?.[id]).map((id, i, arr) => {
      const a = AREAS[id], ok = !!f.unlocked?.[id], done = !!f.boss?.[id], here = cur === id;
      const st = here ? '現在地' : done ? '攻略済み' : ok ? '到達済み' : '未到達';
      return `<div class="rnode ${here ? 'here' : ''} ${ok ? '' : 'lock'} ${done ? 'done' : ''}"><b>${ok ? a.name : '？？？'}</b><span>${ok ? `推奨 Lv ${a.level[0]}-${a.level[1]}` : '—'}</span><em>${st}</em></div>${i < arr.length - 1 ? '<div class="rarrow">▶</div>' : ''}`;
    }).join('');
    const legend = '<span class="lg"><i style="background:#6af0ff"></i>セーブ</span><span class="lg"><i style="background:#6af0c0"></i>回復の泉</span><span class="lg"><i style="background:#ffcf3a"></i>宝箱</span><span class="lg"><i style="background:#ff9a3a"></i>レバー</span><span class="lg"><i style="background:#8fb0ff"></i>門</span><span class="lg"><i style="background:#ff3b3b"></i>ボス</span><span class="lg"><i style="background:#ffd66a"></i>目的地</span>';
    return `<div class="mapwrap">
      <div class="mapcol"><canvas id="fullmap" width="640" height="640"></canvas><div class="legend">${legend}</div><div class="sub">歩いた場所が明るくなる。宝箱は近づくと表示される。</div></div>
      <div class="mapside">
        <div class="card"><h4>現在の目的</h4>${o ? `<div class="objbig">◆ ${o.text}</div><div class="sub">${o.sub || ''}</div>` : '<div class="sub">目的はありません。自由に探索しよう。</div>'}</div>
        <div class="card" style="margin-top:10px"><h4>冒険のルート</h4><div class="route">${route}</div></div>
      </div></div>`;
  }
}
