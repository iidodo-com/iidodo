# 予測型 投資アプリ (yosoku)

過去の検証(バックテスト)ではなく、**これから先の値動きを確率分布で予測**するアプリ。
Yahoo Finance から実データを外部通信で取得します(依存ゼロ、Node.js のみ)。

    Windows: start.bat をダブルクリック(要 Node.js LTS)
    その他: cd yosoku && node server.js   # http://localhost:8787

index.html を直接開いても動きません(ブラウザのCORS制限のため、server.js が中継します)。

- 銘柄: `7203.T`(東証) / `AAPL` / `^N225` / `BTC-USD` / `USDJPY=X` など
- 予測: EWMAボラ+ブートストラップ・モンテカルロ(3000本)、対数線形トレンド外挿、SMA/RSIによる総合シグナル
- ブラウザ直接だとCORSで通信できないため、`server.js` が取得を中継します(127.0.0.1のみ待受)
- 統計的な見通しであり、将来を保証しません。投資は自己責任で。
