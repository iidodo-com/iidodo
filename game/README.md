# AETHERIA — 3D Action RPG (Three.js + Vite)

ブラウザで遊べる、スマホ/PC 両対応の 3D アクション RPG。5 エリア + 最終フロア + クリア後の隠しダンジョンまで通して遊べます。

```bash
cd game
npm install
npm run dev      # 開発サーバ (http://localhost:5173)
npm run build    # dist/ に静的ファイルを出力
```
画質は URL で指定できます: `?q=low` / `?q=medium` / `?q=high` (未指定は PC=high, スマホ=medium)。

## 遊び方
| 操作 | PC | スマホ |
|---|---|---|
| 移動 | WASD | 左下スティック |
| 視点 | マウス (クリックで開始 / Esc でメニュー) | 画面ドラッグ |
| 攻撃 (3連) / 回避 | 左クリック / Space | 右下ボタン |
| スキル 1-3 | 数字キー | ボタン |
| 回復薬 / 調べる / メニュー | Q / E / Tab | 薬 / 調べる / ☰ |

物語: 光を失った大地を救うため、空の城アルカディアを目指す。各エリアの中ボスを倒して鍵を手に入れ、門を開いて進む。
クリア後は「強くてニューゲーム」(敵が強化・レベル上限+5) と隠しダンジョン「深淵の回廊」が解放される。

## 構成
`docs/ARCHITECTURE.md` に設計とフェーズ別の実装内容をまとめています。
- `src/core` 基盤 (Game / Input / Assets / PostFx / Cinematic / Settings)
- `src/world` 地形・水・植生・配置物・エリア遷移・インタラクト対象
- `src/entities` プレイヤー・敵 (24 種 + 2 形態ボス)
- `src/systems` 戦闘・育成・所持品・ドロップ・ストーリー
- `src/ui` HUD・メニュー・会話・エンディング
- `src/audio` 合成による効果音/BGM (素材ファイル不要)
- `src/data` エリア・敵・アイテム・スキル・物語のデータ (バランス調整はここ)
- `public/assets` Poly Haven (CC0) の HDRI/テクスチャ/モデル (`CREDITS.md`)
- `tools` 素材の軽量化スクリプト
