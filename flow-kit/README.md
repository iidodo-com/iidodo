# クラウドフロー作成支援キット（flow-kit）

Power Automate のクラウドフローを **画面上で人が作る** ときに使う、手順書・式・点検用のツール群です。
JSON を丸ごと生成してインポートする方式は採りません。

> **この README は途中版です。** 工程1（式ライブラリ）まで完成しており、工程2〜5（build_guide / explain_flow / check_flow、README 仕上げ）は、アクションのJSONサンプルがそろってから作成します。

## 作業の進み具合

| 工程 | 内容 | 状態 |
| --- | --- | --- |
| 事前 | サンプル収集チェックリスト（[docs/sample_checklist.md](docs/sample_checklist.md)） | 完成 |
| 1 | 式ライブラリ（[expressions/](expressions/)）と `tools/make_expression.ps1` | **完成・実機検証済み**（2026-10-07、全81ケース期待どおり。[expressions/VERIFIED_RESULTS.md](expressions/VERIFIED_RESULTS.md)） |
| 構造メモ | `docs/structure_notes.md`（サンプルを読んでアクション構造の規則をまとめる） | サンプル待ち（承認が必要） |
| 2 | `tools/build_guide`（構築手順書の出力） | サンプル待ち |
| 3 | `tools/explain_flow`（引継ぎ仕様書の出力） | サンプル待ち |
| 4 | `tools/check_flow`（静的チェック） | サンプル待ち |
| 5 | README 仕上げ | 工程4のあと |

## フォルダー構成

```text
flow-kit/
  README.md
  docs/                  サンプル収集チェックリスト、（今後）構造メモ・業務手順書の書式
  expressions/           式ライブラリ（1ファイル1用途）と検証手順（VERIFY.md）
  samples/               ★ここにアクションのJSONサンプルを置く（利用者が準備）
  tools/                 PowerShell ツール（Windows PowerShell 5.1 で動作）
  tests/                 テストの入力・期待出力と、テスト実行スクリプト
  output/                ツールの出力先（任意）
```

## 守るルール

- アクション名・パラメータ名は `samples/` にある書き方だけを根拠にします。サンプルにないものは推測で書かず「**要確認（サンプルなし）**」と明記します。
- 式は Workflow Definition Language の関数だけを使います（[Microsoft Learn の関数リファレンス](https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference)に載っているもの）。
- `utcNow()` は UTC を返します。日本時間が必要な箇所は必ず `convertTimeZone(…, 'UTC', 'Tokyo Standard Time')` で変換します。

## 式ライブラリの使い方（工程1）

- 一覧と使い方：[expressions/README.md](expressions/README.md)
- 各式の **Compose（作成）での検証手順・結果記入表**：[expressions/VERIFY.md](expressions/VERIFY.md)
- **全ケースを実機で検証済み**（2026-10-07、Power Automate 英語表示・既定環境）。結果は [expressions/VERIFIED_RESULTS.md](expressions/VERIFIED_RESULTS.md)。別の環境（画面言語やテナント）で使うときは、E00・E01 だけでも先に確認してください。
- 画面での検証は、**一括版マニュアル** [docs/manual_expression_check_bulk.html](docs/manual_expression_check_bulk.html)（箱3個＋集計＋隔離1個で全81ケース）が手早いです。ケースごとに確認する詳細版は [docs/manual_expression_check.html](docs/manual_expression_check.html) です。

### `make_expression`（要件から式を探して出力）

日本語の要件から、ライブラリ内の該当する式と「用途／入力の想定／出力例／よくある誤り／Compose での検証方法」を出力します。**ライブラリにない式は作りません**（該当がなければ終了コード 2 とメッセージを返します）。

```powershell
# 実行例（キットのフォルダーで）
powershell -NoProfile -File .\tools\make_expression.ps1 -Requirement "翌営業日を求めたい（土日は除く）"

# 一覧
powershell -NoProfile -File .\tools\make_expression.ps1 -List

# ID を指定し、式の <値> を置き換えて、ファイルにも保存
powershell -NoProfile -File .\tools\make_expression.ps1 -Id E07 -Param @{ '値' = "triggerBody()?['comment']" } -OutFile .\output\expr_E07.md
```

### テストの実行

```powershell
powershell -NoProfile -File .\tests\run_tests.ps1
```

`ps51`（PowerShell 5.1 で使えない書き方・BOM・`ConvertTo-Json -Depth` などの静的チェック）と、`make_expression` の入力→期待出力の比較を行います。

## PowerShell について

- 実行環境は **Windows PowerShell 5.1**（庁内 PC の標準）を前提にしています。PowerShell 7 は不要です。
- `.ps1` は **BOM 付き UTF-8** で保存しています（5.1 で日本語が文字化けしないため）。編集して保存し直すときは「UTF-8（BOM 付き）」を選んでください。
- 外部ライブラリの追加インストールも、インターネット接続も不要です。

### 実行ポリシーで止まったとき

次のようなエラーが出る場合は、実行ポリシー（スクリプトを実行してよいかの設定）で止まっています。

```text
このシステムではスクリプトの実行が無効になっているため、ファイル …\make_expression.ps1 を読み込むことができません。
```

1. **現在の設定を確認する**

   ```powershell
   Get-ExecutionPolicy -List
   ```

   `MachinePolicy` や `UserPolicy` に値（`Restricted` など）が出ている場合は、組織のポリシー（グループポリシー）で決められています。**次の方法では回避できません**。情報システム担当に相談してください。

2. **ダウンロードした zip から展開した場合は、ブロックを解除する**

   zip ファイルを右クリック →「プロパティ」→「セキュリティ: ブロックの解除」にチェックして展開し直します。または、展開したフォルダーで次を実行します。

   ```powershell
   Get-ChildItem -Recurse .\ | Unblock-File
   ```

3. **実行のたびに、そのときだけ実行ポリシーを無視して実行する（Bypass）**

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\make_expression.ps1 -Requirement "月末日を求めたい"
   ```

   - `-ExecutionPolicy Bypass` の効果は **その1回の起動だけ** で、PC の設定は変わりません。
   - **注意:** これは「実行ポリシーの確認を飛ばす」指定です。**安全確認をしたことにはなりません。** 実行するスクリプトの中身（このキットのツールは外部に通信せず、書き込むのは `-OutFile` で指定した場所と `output/` だけです）を自分で確認できるものにだけ使ってください。
   - 庁内の情報セキュリティ規程で禁止・制限されていないか、事前に確認してください。
   - `Set-ExecutionPolicy` で PC の設定を恒久的に緩める方法は、推奨しません。

## サンプル追加が必要なアクション一覧

**現在、`samples/actions/` に5つのサンプルJSONがあります**（スコープ＋失敗時の実行条件／Outlook メール送信、Excel 一覧取得のページネーションなし・あり、Apply to each のコンカレンシーなし・あり）。**それ以外は未提供です。** 下の一覧が、構築手順書・引継ぎ仕様書・静的チェックを作るために必要なサンプルです。取り出し方・ファイル名・伏字のルールは [docs/sample_checklist.md](docs/sample_checklist.md) にあります。
初めての方向けに、手順・伏字ツール・ファイル名メーカー・`connectors.txt` メーカーをまとめた HTML マニュアルが [docs/manual_sample_extraction.html](docs/manual_sample_extraction.html) にあります。
サンプルが届いたら、この一覧の状態を更新します。サンプルにない書き方は、各成果物に「要確認（サンプルなし）」と書きます。

| 状態 | 優先 | 種類 | 必要なサンプル（バリエーション） |
| --- | --- | --- | --- |
| 未提供 | ◎ | トリガー | 手動／定期的に実行（日本時間のタイムゾーン設定あり）／Forms 新しい応答／SharePoint 項目の作成／Outlook 新着メール |
| 未提供 | ◎ | トリガー | **トリガー条件を設定したトリガー**（check_flow の「トリガー条件なし」判定の根拠） |
| 一部提供済み（スコープのサンプル内。単独・動的な宛先は未） | ◎ | Outlook | メールを送信する（HTML 本文／動的な宛先） |
| 未提供 | ◎ | Teams | チャネル／チャットへのメッセージ投稿 |
| 未提供 | ◎ | SharePoint | 項目の取得（フィルタークエリ、上位の件数・ページネーション設定あり／なし）／項目の作成・更新 |
| 未提供 | ◎ | OneDrive for Business | ファイルの作成／ファイル コンテンツの取得 |
| 一部提供済み（一覧表示：ページネーションあり／なし） | ◎ | Excel Online (Business) | **表内に存在する行を一覧表示**（ページネーション設定あり／なし、日付/時刻の形式の指定あり）／表に行を追加・行の更新 |
| 未提供 | ◎ | 承認 | 承認の作成と待機（または作成／待機を分けた構成） |
| 未提供 | ◎ | Forms | 応答の詳細を取得する |
| **提供済み**（Apply to each のサンプル内） | ◎ | 作成（Compose） | 式を入れたもの |
| 未提供 | ◎ | 変数 | 初期化／設定／インクリメント／文字列・配列に追加 |
| **提供済み**（コンカレンシーなし／あり） | ◎ | Apply to each | コンカレンシー制御なし／あり（check_flow の並列実行判定の根拠） |
| 未提供 | ◎ | 条件・スイッチ | AND/OR を使う条件 |
| **提供済み**（実行条件 Try 失敗時・メール送信を含む） | ◎ | スコープ | スコープ＋**実行条件の構成（失敗時）で動く通知アクション**（エラー処理の根拠） |
| 未提供 | ○ | 繰り返し・データ操作 | Do until／配列のフィルター処理／選択／JSON の解析／終了 |
| 未提供 | ◎ | フロー全体 | 実際のフロー1本の全体定義（`definition.json` 等。explain_flow の入力形式の根拠） |
| 未提供 | ◎ | 補足資料 | `connectors.txt`（使えるコネクタと Standard／Premium の区分）、`_manifest.csv`（英語・日本語の表示名） |

### 式ライブラリの中で「要確認（サンプルなし）」としている項目

式の検証とは別に、画面の名称・設定項目がサンプルで裏付けられていないため断定していないものです。

- 手動トリガー・「作成（Compose）」・「式」タブなど、画面上の名称（[expressions/VERIFY.md](expressions/VERIFY.md)）
- Excel の日付が **シリアル値で返るかどうかを決める設定** の名称と既定値（06_excel_serial_to_date.md）
- 取得アクションの **ページネーション・上限件数の設定** の項目名（08_array_count.md）
- 取得アクションの出力から配列を取り出す書き方（`body(…)?['value']` など）（08_array_count.md）
- メール送信・Teams 投稿の **本文が HTML として扱われる設定** の項目名（09_mail_newline.md）
- 祝日を除外する翌営業日の **アクション構成**（03_next_business_day.md）
- SharePoint の日付列が UTC で届くときの扱い（12_days_between.md）
