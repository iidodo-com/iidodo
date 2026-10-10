# かんたん割り勘（Android）

合計金額・人数・切り上げ単位（1/10/100/500円）から一人あたりの金額を計算し、
幹事の余りも表示、LINE等へ共有できるアプリです。

## ビルド
Android Studio で `android/` フォルダを開き、そのまま Run してください。
CLI の場合（Android SDK と `local.properties` の `sdk.dir` が必要）:

    gradle :app:testDebugUnitTest :app:assembleDebug

APK は `app/build/outputs/apk/debug/` に出力されます。

## 買い物リスト
トップ画面の「買い物リスト」から開きます。品名を追加、タップでチェック、
長押しで削除、「チェック済みを削除」で一括削除。端末内に自動保存されます。

## スマホに入れる
`dist/kantan-warikan.apk` をスマホでダウンロードして開くとインストールできます
（「提供元不明のアプリ」の許可が必要です。デバッグ署名のAPKです）。
