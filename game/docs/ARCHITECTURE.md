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
│  ├─ world/                  Terrain / Props / Vegetation / Water / Sky / Wind
│  ├─ fx/                     Particles / SwordTrail / Effects / Ambient
│  ├─ entities/Player.js      ダミーモデル + 行動ステートマシン
│  ├─ camera/FollowCamera.js  三人称オービット (地形回避/シェイク付き)
│  └─ ui/{VirtualPad,Hud}.js  タッチUI / HUD
└─ docs/ARCHITECTURE.md
```

## グラフィックス構成

| 要素 | 実装 |
|---|---|
| 外部アセット | Poly Haven (CC0): HDRI / PBR 地面テクスチャ / 樹皮 / 写真測量の岩・シダ・草塊 (`public/assets`, `core/Assets.js`, 出典は `public/assets/CREDITS.md`)。読込失敗時は手続き生成へ自動フォールバック |
| 空・照明 | HDRI を背景 + IBL に使用し、最も明るい点から太陽方向、地平線の平均色からフォグ色を自動算出 (`world/Environment.js`) |
| 接地影 | 高画質のみ GTAO (`core/PostFx.js`) |
| レンダリング | HDR(HalfFloat) + MSAA → UnrealBloom (発光物のみ) → カラーグレード → ACES トーンマッピング (`core/PostFx.js`) |
| 空・雲 | 大気散乱 Sky + fbm 雲レイヤー + 指数フォグ (`world/Sky.js`) |
| 地形 | 頂点カラー + 3スケールのディテールテクスチャ (PBR)、砂浜/苔/雪の自動配色 (`world/Terrain.js`) |
| 草・花 | 20mチャンクの InstancedMesh、風で揺れる頂点シェーダ、遠距離ディザ消去 (`world/Vegetation.js`, `Wind.js`) |
| 木・岩・結晶 | ローポリ松/広葉樹/桜/紅葉、苔岩、発光結晶 (`world/Props.js`) |
| 水 | 水深属性つき水面: フレネル反射・太陽反射・岸辺の泡 (`world/Water.js`) |
| キャラ | 丸みのあるパーツ + アウトライン + 光る剣 + なびくマント (`entities/Player.js`) |
| エフェクト | 剣の軌跡リボン / 土煙 / 火花 / 漂う光の粒 (`fx/*`) |

画質は `?q=low|medium|high` で強制指定 (未指定はPC=high / スマホ=medium)。`core/Config.js` の `QUALITY` で調整。

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


## Phase 2: バトルと敵AI (実装済み)

| 要素 | 実装 |
|---|---|
| データ | `data/enemies.js` (敵4種 / キャンプ配置 / プレイヤー攻撃判定)。バランスはここだけで調整 |
| ダメージ | `systems/DamageCalc.js` 純関数: `atk × 倍率 × 40/(40+def) × 乱数±10% × (クリ 1.6)`、ダウン中の敵は ×1.35 |
| 敵AI | `entities/Enemy.js`: idle → chase → windup(予兆) → attack → recover / hurt / down / dead / return(帰還・全回復) |
| 攻撃種 | lunge(突進) / swing(扇形) / slam(範囲・スーパーアーマー) / bolt(遠距離弾・回避可) |
| 予兆 | `fx/Telegraph.js`: 赤い扇形/円が内側から満ちて、満ちた瞬間に判定。狙いは発生の少し前に固定 |
| 当たり判定 | `systems/Combat.js` の `sectorHit` (扇形 + 敵半径補正)。プレイヤーは `player:swing` で判定、弾は球判定 |
| 攻撃権 | 近接2体・遠距離2体までしか同時に攻撃動作へ入れない (残りは周回して待機) |
| 怯み/ダウン | 被弾で hurt、poise が 0 でダウン(約1.9秒)。ブルートは攻撃中スーパーアーマー |
| 配置 | `systems/EnemySystem.js`: 5キャンプ16体、仲間への警戒共有、リーシュ、離れるとリスポーン(50秒) |
| UI | `ui/WorldLabels.js`: 敵HP/ポイズバー、ダメージ数字(クリ/ダウン/被弾)。被弾フラッシュ、死亡画面 |
| 演出 | ヒットストップ、カメラシェイク、火花、土煙、範囲攻撃の衝撃波 |
| プレイヤー | `takeDamage` (回避無敵・被弾後の短い無敵)、のけぞり、死亡→復活、攻撃アシスト(近い敵へ自動で向く) |

イベント: `enemy:hit {enemy,dmg,crit,pos,downed,killed}`, `enemy:died {enemy,pos,def}` (Phase 3 で EXP/ドロップに接続), `enemy:slam`, `enemy:bolt`, `player:hurt`, `player:dead`, `player:dodged`。

## Phase 3: 育成・アイテム・セーブ (実装済み)

| 要素 | 実装 |
|---|---|
| データ | `data/items.js` (消耗品/素材/宝珠/装備/レシピ/ドロップ/ショップ)、`data/skills.js` (スキル・成長曲線・割り振り) |
| 経験値/レベル | `systems/Progression.js`: Lv上限30、自動上昇 + 2pt/Lv の割り振り (体力/腕力/耐久/敏捷)。格下の敵は経験値減。再配分は Lv×20G |
| 最終ステータス | レベル基礎 + 割り振り + 装備(強化 +12%/段・宝珠込み)。`recalc()` で `player.stats` へ反映 |
| スキル | 旋風斬(Lv3 全方位) / 闘気解放(Lv6 攻撃+35%・移速+20%) / 魔導閃(Lv9 貫通遠距離)。MP・クールダウン・先行入力・詠唱モーション・軌跡/VFX |
| 所持品 | `systems/Inventory.js`: スタック品 + 装備インスタンス (強化値/宝珠スロット)。売買・強化 (最大+10)・素材から宝珠を合成して装着・取り外し(50G) |
| ドロップ | `systems/Drops.js`: 撃破で EXP/ゴールド/素材/装備。光る玉が落ち、近づくと吸い寄せ自動取得。取得ログ表示 |
| セーブ | `save/SaveManager.js`: localStorage、オート + 手動3スロット、バージョン付き、1世代前を `.bak` に退避し破損時は自動復旧、未来バージョンは拒否。`flags` は Phase 4 以降の拡張用 |
| オートセーブ | 約45秒ごと / レベルアップ / 装備入手 / メニューを閉じた時 / タブを離れた時 / 復活時 |
| メニュー | `ui/Menu.js`: ステータス・装備・アイテム・ショップ・強化合成・スキル・セーブ。開くとポーズ (PC: Tab/I/Esc、スマホ: ☰) |
| 開始画面 | 「はじめから」「つづきから」(最新のセーブを選択) |

操作: Q = 回復薬クイック使用 (ポーション→ハイポーション)。スキルは数字キー 1-3 / 画面ボタン。
イベント: `exp:gain`, `player:levelup`, `player:skillCast`, `inventory:changed`, `stats:changed`, `pickup`, `toast`。

セーブ形式 (v1): `{version, savedAt, playtime, player:{level,exp,points,alloc,hp,mp,x,z,cooldowns}, inventory:{gold,items,equipment,equipped,nextUid}, flags}`
