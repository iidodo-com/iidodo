import * as THREE from 'three';
import { AREAS, AREA_ORDER } from '../data/areas.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/**
 * エリア遷移・読み込み。
 *   フェードアウト → 旧エリア破棄 → 地形/水/植生/配置物/敵/環境を構築 → プレイヤー配置 → フェードイン
 * 解放済みエリア・撃破済みボス・開封済み宝箱などは game.flags に保存される。
 */
export class AreaManager {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.loading = false;
    game.bus.on('boss:defeated', ({ area }) => !AREAS[area].final && game.hud.toast(`${AREAS[area].boss.id === 'wind_lord' ? '空の王を倒した！' : '守護者を倒した！ 鍵を手に入れよう'}`, 3000));
    game.bus.on('enemy:enrage', ({ enemy }) => game.hud.toast(`${enemy.def.name} が怒り狂った！`, 2200));
    game.bus.on('pylon:destroyed', ({ all }) => {
      game.hud.toast(all ? '障壁ピラーを全て破壊した！ 遠くで障壁が消えていく……' : '障壁ピラーを破壊した', 2400);
      if (all) game.world.openBarrier();
    });
  }

  get area() { return this.current ? AREAS[this.current] : null; }

  /** 解放済み (到達済み) のエリア ID 一覧 */
  unlocked() { return AREA_ORDER.filter((id) => this.game.flags.unlocked?.[id]); }
  highestIndex() { return Math.max(0, ...this.unlocked().map((id) => AREAS[id].index)); }

  /**
   * spawn: 'savepoint' | 'entrance' (入口の門の手前) | 'exit' (出口の門の手前) | {x,z}
   */
  async load(id, { spawn = 'savepoint', fade = true } = {}) {
    const g = this.game, area = AREAS[id];
    if (!area || this.loading) return false;
    this.loading = true; g.paused = true;
    try {
      if (fade) await g.hud.fade(true);
      await nextFrame();
      await g.assets?.ensureTex?.(Object.values(area.ground).filter((v) => typeof v === 'string'));

      // --- 旧エリアの破棄
      g.enemies.clear(); g.drops.clear(); g.combat.clear(); g.world.clear(); g.effects.reset?.();

      // --- 構築 (敵の補正などが「新しいエリア」を参照できるよう、先に current を切り替える)
      this.current = id;
      g.terrain.configure(area);
      const props = g.terrain.build();
      g.water.rebuild(area);
      g.vegetation.rebuild(area);
      g.applyEnvironment(area, props);
      g.world.build(area);
      g.enemies.setupArea(area);

      // --- プレイヤー配置
      const sp = this._spawnPoint(area, spawn);
      g.player.respawnAt(sp.x, sp.z, sp.facing);
      g.cam.yaw = sp.facing + Math.PI; g.cam.snapTo(g.player.position);

      // --- 状態
      const f = g.flags;
      this.current = id; f.area = id;
      (f.unlocked ||= {})[id] = true;
      g.hud.setArea(`${area.name}　推奨Lv ${area.level[0]}-${area.level[1]}`);
      g.bus.emit('area:changed', { area });
      await nextFrame();
      g.paused = g.menu?.opened ? true : false;
      if (fade) { await g.hud.fade(false); g.hud.banner(area.name, `推奨レベル ${area.level[0]} 〜 ${area.level[1]}`); }
      g.clock.getDelta();
      g.autosave('area');
      return true;
    } finally {
      this.loading = false;
      if (!g.menu?.opened) g.paused = false;
    }
  }

  _spawnPoint(area, spawn) {
    if (spawn && typeof spawn === 'object') return { x: spawn.x, z: spawn.z, facing: Math.PI };
    if (spawn === 'entrance' && area.entrance) return { x: area.entrance.x, z: area.entrance.z - 8, facing: Math.PI };
    if (spawn === 'exit' && area.exit) return { x: area.exit.x, z: area.exit.z + 8, facing: 0 };
    // セーブポイントを正面に見る位置 (カメラは北側 = 戦闘エリア側)
    return { x: area.savepoint.x, z: area.savepoint.z - 7, facing: 0 };
  }

  /** 死亡時の復帰: 現在エリアのセーブポイントへ (エリア再読み込みなし) */
  respawnAtSavepoint() {
    const g = this.game, a = this.area; if (!a) return;
    const sp = this._spawnPoint(a, 'savepoint');
    g.player.respawnAt(sp.x, sp.z, sp.facing);
    g.cam.yaw = sp.facing + Math.PI; g.cam.snapTo(g.player.position);
  }
}
