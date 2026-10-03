# AETHERIA — アーキテクチャ設計 (Phase 1)

Vite + Three.js (ES Modules)。`npm install && npm run dev` で起動、`npm run build` で静的ファイルを `dist/` に出力。

## ディレクトリ構成

```
game/
├─ index.html                 DOM (canvas / HUD / タッチUI / スタート画面)
├─ src/
│  ├─ main.js                 エントリ。スタート操作 → Game.start()
│  ├─ styles.css
│  ├─ core/
│  │  ├─ Game.js              オーケストレーター (renderer, loop, update順)
│  │  ├─ Config.js            調整値 (バランスは Config / 今後の data/ に集約)
│  │  ├─ Input.js             PC/スマホ入力の正規化 (move / look / actions)
│  │  ├─ EventBus.js          疎結合イベント (player:swing 等)
│  │  └─ Noise.js             種付きノイズ / 乱数
│  ├─ world/
│  │  ├─ Terrain.js           高さマップ地形 + 木/岩 + コライダー
│  │  └─ Sky.js               空ドーム + フォグ
│  ├─ entities/Player.js      ダミーモデル + 行動ステートマシン
│  ├─ camera/FollowCamera.js  三人称オービット (地形回避/シェイク付き)
│  └─ ui/{VirtualPad,Hud}.js  タッチUI / HUD
└─ docs/ARCHITECTURE.md
```

## 設計方針

- **入力の抽象化**: ゲームロジックは `Input` の `move / consumeLook() / isDown / wasPressed` だけを見る。
  PC(WASD・マウス・Space・1-3・E)とスマホ(浮動スティック・ボタン・スワイプ)は同じ API に正規化される。
- **システム拡張**: `Game.addSystem({update(dt, game)})` で Phase 2 以降の `EnemySystem` / `CombatSystem` / `SaveSystem` 等を追加。
- **イベント駆動**: `player:swing {combo,pos,dir}` (攻撃判定発生), `player:dodge`, `player:skill {slot}`, `player:interact`。
  Phase 2 の当たり判定は `player:swing` を購読して球/扇形判定を行う。
- **無敵フレーム**: `player.isInvulnerable` (回避開始から `dodgeInvuln` 秒)。被ダメ処理は必ず `canBeHit()` を通す。
- **地形クエリ**: `terrain.getHeightAt(x,z)` と `terrain.colliders` / `resolveCollisions()` をプレイヤー・敵・カメラで共有。
- **ロジックと描画の分離**: `Game.update(dt)` は描画なしで呼べる (固定dtの自動テスト用)。`window.__game` を公開。
- **モバイル最適化**: DPR上限・影マップ縮小・AA無効・縦持ち時のFOV拡大・Pointer Events でマルチタッチ。

## Phase 1 の操作

| 操作 | PC | スマホ |
|---|---|---|
| 移動 | WASD / 矢印 | 左下の浮動スティック |
| 視点 | マウス (クリックでポインタロック, Esc解除) | スティック・ボタン以外をドラッグ |
| 攻撃 (3連) | 左クリック | 攻撃ボタン |
| 回避ロール | Space / 右クリック | 回避ボタン |
| スキル1-3 | 数字キー | ボタン 1-3 (Phase 3 で実装) |
| 調べる | E / F | 調べるボタン |

## 以降のフェーズ計画

| Phase | 内容 | 主な追加モジュール |
|---|---|---|
| 2 | 敵AI・当たり判定・ダメージ・HPバー | `entities/Enemy.js`, `systems/Combat.js`, `ai/*` |
| 3 | EXP/レベル、装備強化、インベントリ、セーブ | `data/*.json`, `systems/Stats.js`, `save/SaveManager.js` (localStorage, versioned), `ui/Inventory.js` |
| 4 | 階層/エリア定義、中ボス、宝箱、セーブポイント | `world/AreaLoader.js`, `data/areas.js` |
| 5 | ラスボス2形態、エンディング、バランス | `bosses/*`, `ui/Ending.js` |
