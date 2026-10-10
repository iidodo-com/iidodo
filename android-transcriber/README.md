# 議事録ボイス（android-transcriber）

会議・打合せの録音を、**Android 端末の中だけで**日本語文字起こしするアプリです。議事録の下書き用途を想定しています。

- 音声・文字起こしは端末の外へ出ません。**`INTERNET` 権限を宣言していない**ため、アプリは通信できません（APK を `aapt2 dump permissions` で確認済み）。クラウドバックアップ・端末間転送の対象外です。
- 文字起こし: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) ＋ SenseVoice（日本語対応）、発話区間検出に Silero VAD。
- 話者分離（任意）: sherpa-onnx の pyannote segmentation 3.0 ＋ 話者埋め込み＋クラスタリング。
- 想定端末: Android 12 以上 / arm64。開発時の想定機種は AQUOS sense9（Android 16）。

> **状態**: クラウド環境でビルド・単体テスト・lint・PC 上での実モデル動作確認までを行いました。**実機（スマホ）での動作は未検証**です。詳細は「検証結果」「未検証」を参照してください。

## 機能

| 機能 | 状態 |
|---|---|
| 音声/動画ファイルの取り込み（mp3, m4a, wav, mp4 等） | 実装済み（復号は端末のコーデック依存。実機未検証） |
| マイク録音（一時停止・再開、レベルメーター、画面オフでも継続） | 実装済み（実機未検証） |
| 前処理: 16kHz モノラル化、音量正規化、長時間音声の処理 | 実装済み（変換は線形補間、正規化は RMS 目標＋ピーク上限） |
| VAD による無音除去（無音区間を認識に回さず、幻覚を抑制） | 実装済み |
| 長い発話の重なり付きチャンク分割と重複除去 | 実装済み（単体テストあり） |
| 話者分離（話者数の指定／自動推定） | 実装済み（PC 上で動作確認、スマホは未検証） |
| タイムスタンプ付き出力（セグメント／単語切替） | 実装済み（単語はトークン単位） |
| 用語辞書（CSV/JSON）: 出力後の置換 | 実装済み |
| 用語辞書: initial_prompt への反映 | **SenseVoice は非対応のため未反映**（置換のみ）。コア側は対応済み |
| 編集画面: 音声同期、タップでジャンプ、話者名一括置換、本文修正、修正履歴 | 実装済み（実機未検証） |
| 出力: txt / md / srt / vtt / docx（日時・出席者・発言者別） | 実装済み（単体テストあり） |
| 進捗表示・キャンセル・途中再開 | 実装済み（再開は単体テストあり） |
| 履歴保存（SQLite/Room）と、音声・文字起こしの一括完全削除 | 実装済み |
| 要約、フォルダ監視バッチ | **未実装**（任意機能） |
| 精度評価（CER） | `scripts/cer.py`、`scripts/e2e_sherpa.py --ref` |

## 構成

```
android-transcriber/
├─ core/   純 Kotlin(JVM)。前処理、辞書、話者割当、出力、パイプライン、CER（単体テストあり）
├─ app/    Android アプリ（Compose UI, Room, 録音, 復号, sherpa-onnx アダプタ, サービス）
├─ scripts/ 取得・配置・検証スクリプト
└─ samples/glossary.csv  サンプル用語辞書
```

処理の流れ: `復号(16kHz mono) → 音量解析 → VAD → (話者分離) → 発話区間ごとに認識 → 辞書置換 → Room に逐次保存`。
各区間の完了を Room に原子的に保存するため、中断・失敗後は続きから再開します。

## セットアップ

### 1. ビルド環境
- JDK 17 以上、Android SDK（`platforms;android-35`, `build-tools;35.0.0`）。`ANDROID_HOME` を設定。
- 依存は `build.gradle.kts` でバージョン固定。

### 2. sherpa-onnx の取得（リポジトリには含めません）
```bash
cd android-transcriber
./scripts/fetch_sherpa.sh                 # Kotlin API を app/src/main/java/com/k2fsa/ へ（v1.13.8。raw.githubusercontent.com から取得）
./scripts/fetch_sherpa_libs.sh 1.13.8     # arm64 の .so を app/src/main/jniLibs/ へ（GitHub Releases から取得）
```
- 2 つ目は `github.com` に接続できる環境で実行してください。`v1.13.8` のアセット（`sherpa-onnx-v1.13.8-android.tar.bz2`）の取得と、JNI 関数 31 個が `.so` に存在することは確認済みです。
- Kotlin API と `.so` は**同じバージョン**にしてください。`v1.13.8` の Kotlin API でアプリがコンパイルできることは確認済みです。

### 3. ビルドとインストール
```bash
export ANDROID_HOME=/path/to/android-sdk
./gradlew :core:test :app:testDebugUnitTest      # テスト
./gradlew :app:assembleDebug                      # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
PC に Android 環境がない場合は、GitHub Actions の `android-transcriber` ワークフロー（手動実行）で APK を作れます（**未検証**）。

### 4. モデルの配置
**配布 APK にはモデルを同梱しています**（`./scripts/fetch_models.sh app/src/main/assets/models` を実行してからビルドすると同梱され、初回起動時に端末内へ展開されます。APK は約 360MB）。同梱せずに adb で送る場合は以下です。
```bash
./scripts/fetch_models.sh ./models            # 約 280MB（話者分離を使わないなら --no-diarization）
./scripts/push_models.sh ./models             # adb で端末のアプリ専用領域へ送る（USB デバッグ要。アプリを一度起動してから）
```
端末側の配置先: `/sdcard/Android/data/com.iidodo.transcriber/files/models/`（アプリの「設定」に表示されます）

```
models/
  silero_vad.onnx
  sense-voice/model.int8.onnx, tokens.txt
  diarization/segmentation.onnx, embedding.onnx      # 話者分離を使う場合のみ
```
`adb push` でこの場所に書き込めない端末では、別の方法でコピーしてください（Android 11 以降は通常のファイルアプリから `Android/data` を開けません）。

#### モデルの取得元・ライセンス・トークン
| 用途 | 取得元 | 認証 |
|---|---|---|
| 認識 | `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17`（Hugging Face） | 不要（この環境から取得できたことを確認） |
| VAD | `deepghs/silero-vad-onnx`（MIT と表記） | 不要 |
| 話者分離（区間検出） | `csukuangfj/sherpa-onnx-pyannote-segmentation-3-0`（pyannote segmentation 3.0 の ONNX 変換） | 不要 |
| 話者分離（埋め込み） | `csukuangfj/speaker-embedding-models`（3D-Speaker CAM++ zh/en） | 不要 |

- 上記は**ゲート同意・トークンなしで取得できました**。ただし各モデルのライセンス条件は取得元ページで必ず確認してください（私はライセンス本文を確認していません）。
- 本家の pyannote.audio のパイプライン（`pyannote/speaker-diarization-community-1` 等）は Hugging Face での利用条件への同意とアクセストークンが必要ですが、このアプリは使いません。
- 埋め込みモデルは中国語・英語向けです。日本語会議での話者分離精度は**未検証**です。

## 使い方
1. ホームで「録音」または「ファイル取込」。会議名・出席者・話者分離の有無を入力して開始。
2. 処理中は通知に進捗が出ます（「中止」可。中断しても途中から再開できます）。
3. 完了したら開いて、音声を再生しながら確認・修正。時刻をタップでその位置から再生、本文タップで修正、話者名の一括変更はメニューから。
4. メニュー「書き出し」で txt / md / srt / vtt / docx を保存。

### 用語辞書
設定画面で CSV を編集（または CSV/JSON を取り込み）。`samples/glossary.csv` が見本です。
```csv
canonical,variants,use_prompt
広島市,ひろしま市|広島氏,true
```
`variants`（`|` 区切り）に一致した語を `canonical` へ置換します。長い語が優先され、置換結果は再置換されません。
編集済みの行は辞書の再適用の対象外です。

### データの削除
- ホームの各ジョブの「削除」: 音声・作業ファイル・文字起こし・履歴を削除。
- 設定の「すべて削除」: 全ジョブ分に加えキャッシュも削除し、DB を `VACUUM` します。ファイルは 0 で上書きしてから削除しますが、フラッシュストレージでは物理的な完全消去までは保証できません。

## 品質・テスト
- 単体テスト: `core` 46 件、`app` 4 件（前処理、辞書置換、出力フォーマット、話者割当、CER、パイプラインの中断再開、リサンプラ）。推論はインターフェース越しにモックしています。
- `./gradlew :app:lintDebug`（Android lint）は **エラー 0 件**。警告は、依存ライブラリの新版通知、ChromeOS 向け ABI（x86_64）未対応、取得した sherpa-onnx 側ソースのコメント種別のみです。
- ktlint/detekt は導入していません（Kotlin のフォーマッタ未設定）。
- ログに本文・ファイルパスは出力しません。失敗理由にも例外クラス名のみを保存します。

## 検証結果（実測）
実行環境: クラウドの Linux コンテナ（Intel Xeon 2.1GHz 4 vCPU, RAM 15GB, GPU なし）。**あなたのスマホの値ではありません。**
`scripts/e2e_sherpa.py`（アプリと同じ VAD→SenseVoice(int8)、`threads=4`）、sherpa-onnx(Python) 1.13.8:

| 入力 | 音声長 | 結果 |
|---|---|---|
| 日本語 1 文（sherpa-onnx の SenseVoice 配布物付属 `ja.wav`） | 7.2 秒 | 合計 2.56 秒（うちモデル読込 2.18 秒、認識 0.24 秒）。認識結果は文として自然だが一部誤りあり（例:「持っていきない」）。正解テキストが手元になく **CER は未算出** |
| 複数話者（中国語）サンプルで話者分離 ON | 56.9 秒 | 合計 7.62 秒（話者分離 3.75 秒）。話者 ID 3 種を検出。正解との照合はしていないため**分離精度は未検証** |

上記は 1 回ずつの測定で、1 時間の会議音声での時間・メモリは**測っていません**。

## 未検証（正直に）
- スマホ実機での動作全般（復号・録音・サービス継続・UI・発熱・メモリ）。AQUOS sense9 での 1 時間音声の処理時間。
- GitHub Actions ワークフロー。
- 日本語会議音声での認識精度（CER）と話者分離精度。
- Android 16 のバックグラウンド制限下で、画面オフ・省電力設定時に処理が止まらないか。
- 話者分離の `processWithCallback` のコールバック戻り値の意味（中断に使えるか）。現状は常に 0 を返し、キャンセルは前後で確認。

## 既知の制限
- 1 時間音声の話者分離は音声全体（約 230MB の float 配列）をメモリに載せます。RAM が少ない端末では失敗する可能性があります（`largeHeap` 指定済み）。
- SenseVoice は初期プロンプト／ホットワードに非対応。固有名詞は辞書置換で補正する運用になります。
- 単語単位の出力はトークン単位（日本語は概ね 1 文字単位）で、逆正規化（数字表記など）後の本文とは一致しません。そのため辞書置換・手修正済みのセグメントはセグメント単位に戻して出力します。
- 認識中のキャンセルは、実行中の 1 区間（最大約 25 秒）が終わってから効きます。
- mp3 / m4a 等の対応は端末のコーデックに依存します。
- docx は自前の最小実装で、Word での表示確認は未実施（XML の整合性のみテスト済み）。
- 話者分離は録音全体で 1 回実行するため、発言区間の途中で話者が変わっても VAD 区間を話者境界で分割する精度は分離結果に依存します。

## 次に改善すべき点
1. 実機でのベンチマーク（処理時間・RAM・発熱）と、モデル選定（Whisper 系との比較、日本語特化モデル）。
2. 日本語会議向けの評価セットで CER を測定し、辞書・VAD パラメータを調整。
3. 話者分離のメモリ使用量削減（窓分割＋話者の再結合）。
4. 用語辞書のホットワード対応（対応モデルへの切替）、要約（端末内 LLM）、フォルダ監視バッチ。
5. ktlint/detekt、Compose UI テスト、Room の計装テストの追加。
