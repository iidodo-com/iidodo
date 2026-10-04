# 株サポ

株取引サポートのスマホ向け PWA。VWAP / 移動平均(5・25・75) / RSI / 出来高 / 信用残高とルールベースの総合判定を表示します。

## データ
- 株価・出来高(日足・5分足): Yahoo Finance chart API
- 信用残高(買残・売残・倍率): Yahoo!ファイナンス銘柄ページ。公表は週1回・最新週のみ。履歴は更新のたびに端末へ蓄積します。

## 使い方
1. **スナップショットを更新**: `node scripts/fetch-data.mjs [コード...]` で `data/latest.json` を更新(Node 18+)。
2. **ライブ更新(スマホ)**: ブラウザは Yahoo へ直接アクセスできない(CORS)ため、中継を1つ置きます。
   ```
   cd worker && npx wrangler deploy
   ```
   表示された `https://kabusapo-proxy.xxx.workers.dev` をアプリの ⚙ に入力。以後 ↻ と60秒ごとの自動更新で最新化され、「＋」からコードだけで銘柄追加もできます。
   公開後は `worker/wrangler.toml` の `ALLOWED_ORIGIN` をアプリのURLに絞ってください。
3. **アーティファクト版を作る**: `node scripts/build-artifact.mjs out.html`(データ埋め込み・外部通信なし)。

## 注意
データは遅延・欠損があり得ます。判定は参考情報で、売買は自己責任です。
