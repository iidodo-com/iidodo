# 量子のひみつ

さわって遊びながら量子コンピュータの仕組み（重ね合わせ・干渉・もつれ・グローバー探索）を学ぶ、スマホ向けアプリ（PWA）。

- 外部ライブラリなし。オフラインでも動作（Service Worker）
- `sim.js` : 教材用の小さな量子シミュレータ（H / X / Z / CNOT）
- Android: HTTPSで公開したURLをChromeで開き、「ホーム画面に追加（インストール）」でアプリとして使えます
- ローカル確認: `cd quantum && python3 -m http.server 8000` → http://localhost:8000
