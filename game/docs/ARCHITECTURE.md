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

## Phase 4: マップ進行と階層構造 (実装済み)

5 つのエリアを順に進む構造。地形・見た目・環境・敵・宝箱・仕掛けは `data/areas.js` に宣言的に定義し、`AreaManager` が読み込んで構築する。

| # | エリア | 推奨Lv | 特徴 | 仕掛け | 中ボス |
|---|---|---|---|---|---|
| 1 | はじまりの平原 | 1-5 | 草原・湖・森 | 森の鍵で門が開く | ゴブリンキング |
| 2 | 忘れられた廃墟 | 6-10 | 石畳・折れた柱・崩れた壁 | 石の鍵 | 石の守護像 |
| 3 | 水晶の洞窟 | 11-16 | 暗闇+ランタン、発光キノコ/水晶、鍾乳石 | レバー2つで障壁解除 | クリスタルゴーレム (弾幕) |
| 4 | 魔導研究所 | 17-23 | 金属床、魔導ピラー、導光ライン | 障壁ピラー3本を破壊 | アイアンセンチネル |
| 5 | 空中城アルカディア | 24-30 | 大理石、浮遊岩、雲海 | 風の紋章 (最終扉は Phase 5 で解放) | ウィンドロード (4連携) |

| 要素 | 実装 |
|---|---|
| エリア構築 | `world/AreaManager.js`: フェード→旧エリア破棄→地形/水/植生/配置物/敵/環境の再構築→配置→フェードイン。解放/ワープ/死亡復帰もここ |
| 地形の再構築 | `Terrain.configure(area)` + `build()`。平坦ゾーン(セーブ/門/泉/ボスの間)・外周の壁(空中城は崖)・配色・4種の PBR テクスチャ(エリアごとに差し替え、`Assets.ensureTex` で遅延読込) |
| 見た目 | `Props.js`(森) + `PropsBiomes.js`(廃墟/洞窟/研究所/空中城) / `Game.applyEnvironment`: 露出・フォグ・背景・太陽/半球光・ランタンと発光物のポイントライト・雲海 |
| 調べる対象 | `world/WorldObjects.js`: セーブポイント / 回復の泉 / 宝箱(3段階) / 門 / レバー / 障壁。最寄りを `[E]`/「調べる」ボタンで使用。状態は `flags` に保存 |
| セーブポイント | 休息(HP/MP全回復+敵復活+オートセーブ)、ショップ、強化・合成、ワープ。**ショップ/強化合成はここでのみ利用可** |
| ショップ | 到達エリアに応じて品揃えが増える (`SHOP[].minArea`) |
| 敵の拡張 | 24種。複数攻撃パターン (`attacks[]` + `minRange`)、弾幕 (`volley`)、飛行(コウモリ)、静止ターゲット(ピラー)、色替え (`model`/`tint`/`scale`) |
| 中ボス | 画面上部の HP バー、HP50%で怒り (速度/攻撃間隔/攻撃力UP + 衝撃波)、撃破で鍵と装備をドロップ。撃破は永続 |
| バランス | `data/enemies.js` の `atkScale(level)` で後半の攻撃力を補正。雑魚1発 ≒ 最大HPの10〜13%、ボス強攻撃 ≒ 22〜33% |
| 死亡 | 現在エリアのセーブポイントで復活 (エリアは再読込しない) |

セーブ形式 (v2): `player.area` と `flags` (`area / unlocked / boss / chests / gates / levers / barrier / pylons`) を追加。v1 は平原のセーブポイントから再開する。
イベント: `area:changed`, `boss:defeated`, `enemy:enrage`, `pylon:destroyed`, `chest:open`, `gate:open`, `barrier:open`。

素材 (Poly Haven CC0) の追加分は `public/assets/CREDITS.md` を参照。

## Phase 5: ラスボス戦・エンディング・仕上げ (実装済み)

| 要素 | 実装 |
|---|---|
| 最終フロア | `AREAS.throne` 王の間 (柱の回廊・赤い絨毯・火鉢・玉座)。空中城の出口 (風の紋章) から入る |
| ラスボス | `終焉の王 ヴォイド` (`data/enemies.js` の `archon`)。**第1形態**: 近接主体 (薙ぎ払い・突進・叩きつけ)。**第2形態** (HP50%): 変身演出 → 結界で無敵 + 結界ピラー3本を召喚 → 結界中は降り注ぐ魔弾 (`rain`) と全周弾幕 (`volley`)。ピラーを全て壊すと結界が砕けてダウン → 全技 (`phase2.attacks`) を使う。HP20% で怒り |
| 新攻撃 | `rain`: プレイヤー周辺に着弾点を固定して予兆表示 → 同時着弾。`volley` は全周弾にも対応 |
| 演出基盤 | `Game.cutscene` 中はロジックを止めアニメ/粒子/カメラだけ更新。`core/Cinematic.js` (キーフレームカメラ・周回)、`ui/Dialogue.js` (タイプライター会話、タップ/Enter/Space/E で送り) |
| ストーリー | `systems/Story.js` + `data/story.js`: プロローグ → ボス前の会話 → 第2形態への変身 → 撃破後の会話 → 余韻の周回カメラと字幕 → スタッフロール → リザルト (タイム/レベル/撃破数/宝箱/戦闘不能/ランク) |
| クリア後 | `onClear()` でクリア記録を保存。**強くてニューゲーム** (レベル・装備・所持品を引き継ぎ、鍵は没収。敵 HP×(1+0.9n)/攻撃×(1+0.6n)/EXP×(1+0.5n)、レベル上限 +5 (最大45)) と、**隠しダンジョン「深淵の回廊」** (敵が HP×2.1/攻撃×1.55、超ボス「深淵の主」、虚空シリーズの装備) |
| サウンド | `audio/AudioManager.js`: Web Audio による合成 SE (30種) と BGM (エリア別・ボス・最終ボス・エンディング・タイトル)。素材ファイル不要。最初の操作で開始 |
| 設定 | メニュー「設定」: BGM/効果音音量・ミュート・視点感度 (マウス/タッチ)・画質。`localStorage` に保存 (`core/Settings.js`)。「操作説明」タブ |
| タイトル | つづきから / はじめから / 強くてニューゲーム (クリア済みセーブがある時のみ) |
| 演出UI | レターボックス、字幕、スタッフロール (スキップ可)、ボス戦中のカメラ引き |

セーブ: `flags` に `cleared / clears / bestTime / ng / stats{kills,deaths,chests}` を追加 (v2 のまま互換)。
イベント: `boss:phase2`, `boss:shieldBroken`, `enemy:summon`, `enemy:blocked`, `enemy:impact`, `game:cleared`。

## 既知の制約
- キャラクター・敵は手続き生成のモデル (リグ付き glTF への差し替えは `entities/*` のモデル構築部分のみ)。
- 木は自作のローポリ (写真測量の木は Web 向けに重すぎるため不採用)。
- BGM/SE はコードによる合成音のため、音色は簡素。
- 難易度は計算とシミュレーションでの確認。長時間プレイでの調整余地あり (`data/enemies.js`)。
