# 引き継ぎ資料（新しいチャットで続きから始めるために）

最終更新: 2026-10-08　／　対象: `flow-kit/`（Power Automate クラウドフロー作成支援キット）

> 新しいチャットを始めたら、まず **この資料と `flow-kit/CLAUDE.md` を読んでから**、末尾の「5. 次にやること」から再開してください。

---

## 1. プロジェクトの目的と前提

- **何を作っているか**：地方自治体の事務職員が、Power Automate のクラウドフローを**画面で人が作る**ときの支援キット。JSON を丸ごと生成してインポートする方式は採らない。
- **利用者**：事務職員（IT の素人）。Microsoft 365 の既定環境。**Standard コネクタのみ**（Premium は使えない前提）。主に Outlook・Teams・SharePoint・OneDrive for Business・Excel Online (Business)・Forms・承認。
- **実行環境**：庁内の Windows PC の **Windows PowerShell 5.1**（PowerShell 7 は無い前提）。外部ライブラリ・ネットワーク接続は使わない。
- **言語**：説明・コメント・ドキュメントはすべて日本語。
- **Power Automate の画面は英語表示**（利用者の環境）。

## 2. 最重要ルール（当初の指示）

1. アクション名・パラメータ名は、`flow-kit/samples/` にある**サンプルJSONの書き方だけ**を根拠にする。サンプルにないものは推測で書かず「**要確認（サンプルなし）**」と明記し、README の「サンプル追加が必要なアクション一覧」に追記する。
2. 式は Workflow Definition Language の関数のみ（Microsoft Learn の公式リファレンスにあるもの）。
3. `utcNow()` は UTC を返す。日本時間が必要な箇所は必ず `convertTimeZone(…, 'UTC', 'Tokyo Standard Time')` で変換する。
4. 工程は **1つ終わるごとに成果物の概要を報告し、確認（承認）を取ってから**次へ進む。
5. 各ツールに `tests/` のテスト入力と期待出力を用意し、実行結果を報告する。
6. PowerShell は **5.1 で動く書き方に限定**：三項演算子・`??`・`&&`/`||`・`ForEach-Object -Parallel`・`ConvertFrom-Json -AsHashtable` などは使わない。入出力は `-Encoding` を明示、`.ps1` は **BOM 付き UTF-8**、`ConvertTo-Json` は `-Depth` を明示。
7. 既存の `./samples/`・`./tools/`・`./docs/`（リポジトリ直下）は**別プロジェクトのもの。一切変更しない**。成果物はすべて `flow-kit/` の下。

## 3. 利用者（依頼者）との進め方（重要）

- **素人向けに丁寧に**説明する。画面の操作は、**HTML マニュアル（図つき）** を好まれる。手数が多いのを嫌うので、**まとめて処理できる方法**を考える。
- 利用者は**スクリーンショットや Code view の文字を貼って**くれる。**画面の名前は、実際に見えたものだけを［画面で確認済み］とする**（見えていないものは［想定］）。
- 利用者が貼るデータは**伏字が漏れていることがある**（ファイルID・フォルダー名・ドライブIDなど）。**保存前に必ず自分で確認して伏字にする**（過去に2回あった）。リポジトリに実データを入れない。
- 個人を特定する情報（社員番号入りのアカウント名など）は、資料やコードに書かない。
- **成果物は「事務職員が読んで分かるか」で判断する。** JSON の書き方・確認済みの印・内部の名前などの技術情報は、**主な説明に出さず、折りたたみ（「くわしい情報」）に入れる**。主な説明は、「何ができるか」→「完成図」→「用意するもの」→「手順1,2,3…（クリックの順番、入力欄の図、入れる内容の表）」の順に、平易な言葉で書く。『箱』（アクション）のたとえで統一し、用語は最後の「用語の説明」に集める。
- Git：ブランチは `main`。作業ごとにコミット＆push（コミットメッセージ末尾の attribution 行は、その時のシステム指示に従う）。`flow-kit/output/` の生成物は `.gitignore` で除外済み。

## 4. 現在の状態

| 工程 | 内容 | 状態 |
| --- | --- | --- |
| 事前 | サンプル収集チェックリスト・HTMLマニュアル（図つき） | 完成 |
| 1 | 式ライブラリ `expressions/`（13用途・81ケース）、`tools/make_expression.ps1` | **完成・実機検証済み**（全81ケース期待どおり。`expressions/VERIFIED_RESULTS.md`） |
| 構造メモ | `docs/structure_notes.md`（第1版） | **承認済み**（サンプルが増えたら更新） |
| 2 | `tools/build_guide.ps1`、書式 `docs/spec_format.md`、記入例 `docs/spec_example.md` | **作り直し済み**。初版は利用者から「めちゃくちゃ分からない。自治体職員でこれで分かる人はほぼいない」と指摘され、**初心者向け（やさしい版）に全面改訂**（2026-10-08）。再確認待ち |
| 3 | `tools/explain_flow`（引継ぎ仕様書） | **未着手** |
| 4 | `tools/check_flow`（静的チェック） | **未着手** |
| 5 | README 仕上げ | 工程4のあと |

### テスト
- `powershell -NoProfile -File .\tests\run_tests.ps1`（`-Target make_expression|build_guide|ps51`、期待出力の更新は `-UpdateGolden`＝**差分を目視確認してから**）
- 現在 **127件すべて成功**（PowerShell 7.6 で実行）。利用者の Windows PowerShell 5.1 では、build_guide の初版を含む **112件の成功を確認済み**。やさしい版に作り直したあとの 5.1 での実行は、**未確認**。
- `ps51` テストは、7 以降専用の構文・BOM・`-Depth`・`-Encoding` を静的に検査する。

### クラウド環境で PowerShell 7 を入れる方法（新しい環境では再度必要）
github.com は拒否されるが、`packages.microsoft.com` は通る：
`curl -o ms.deb https://packages.microsoft.com/config/ubuntu/24.04/packages-microsoft-prod.deb && dpkg -i ms.deb && apt-get update && apt-get install -y powershell`

### 作業用スクリプト（`flow-kit/dev/`）
- `diagrams.py` と `make_figures_ps1.py`：画面の見取り図（SVG）を作り、`tools/_figures.ps1`（build_guide が読み込む）を生成する（`python3 dev/make_figures_ps1.py`）。
- `build_expr.py`：`expressions/*.md`・`VERIFY.md`・`README.md` を生成（式やケースを直すときは、**まずこのファイルを直して再生成**）。`mk_results.py`：`VERIFIED_RESULTS.md` を生成。
- **HTML マニュアル 3種（`docs/manual_*.html`）は、生成後に手で図などを足してあるため、HTML ファイル自体が正**（生成スクリプトで上書きしない）。

## 5. 次にやること

1. **利用者に、やさしい版の build_guide を見てもらう**（`tools/build_guide.ps1 docs/spec_example.md -Html …` の出力。まだ分かりにくい所はないか、［想定］の操作名が実画面と合うか、5.1 でテスト〔127件〕が通るか）。
   - 利用者が業務手順書（Markdown）を自分で書くのは難しい可能性がある。必要なら、**業務手順書を作る入力フォーム（HTML）**を提案する。
2. **工程3 explain_flow**（`「コードのプレビュー」のJSON、またはエクスポートしたフロー定義 → 引継ぎ仕様書`。処理概要3行以内／トリガー条件／処理手順／使用コネクタと接続先〔伏字オプション〕／変数一覧／エラー処理の有無／想定される失敗箇所）。
   - **入力形式の根拠になる「フロー全体の定義」のサンプルが無い。** 利用者に、画面右上のボタン並び（保存・テスト・コードの表示など）のスクリーンショットを依頼し、全体の定義を取り出せる場所を案内する。取れなければ、箱単位のサンプルで先に作る。
3. **工程4 check_flow**（`アクション名／問題／修正案`）。判定できる／できないは `docs/structure_notes.md` 第7章のとおり。
   - 判定できる（サンプルの根拠あり）：失敗時の処理の有無（`Scope`＋`runAfter` に `Failed`/`TimedOut`）、Excel 一覧取得のページネーション未設定（`GetItems` に `paginationPolicy` が無い）、並列実行の検出（`Foreach` の `concurrency.repetitions` ≥ 2）、式の文字列中の `utcNow()` の検出、固定メール・URL・パスの検出。
   - まだ判定できない（サンプルなし）：トリガー条件の有無、ループ内の変数更新（変数の設定・インクリメントの `type` 名が不明）。
4. **工程5 README 仕上げ**：各ツールの使い方、Compose での式の検証手順、コードのプレビューの取り出し方、「サンプル追加が必要なアクション一覧」、実行ポリシー対処（記載済み）。
5. 並行して**サンプルを増やす**（優先順）：変数の設定／インクリメント、トリガー条件つきトリガー、定期実行（日本時間）、フロー全体、SharePoint／Teams／承認／Forms、`connectors.txt`、日本語表示の名前。サンプルが増えたら `docs/structure_notes.md` と `tools/build_guide.ps1` のカタログ（`$Catalog`）を更新する。

## 6. 実機で確認できた事実（Power Automate・英語表示）

### 画面
- 編集画面の箱をクリックすると、左に **Parameters／Settings／Code view／About**（箱によって Testing も）のタブ。**コードの取り出しは「Code view」タブ**。
- 式の入力：Inputs 欄をクリック → 開く窓の **fx（式）の欄**に貼る。**「Create an expression with Copilot」は別物**（AI用。300文字まで。使わない）。
- Excel の一覧取得の項目名：`Location`・`Document Library`・`File`・`Table`・`Extract Sensitivity Label`・`Sensitivity Label Metadata`。詳細項目：`Filter Query`・`Order By`・`Top Count`・`Skip Count`・`Select Query`・`DateTime Format`。
- Apply to each の入力欄：`Select an output from previous steps`（右端に ⚡ 動的なコンテンツと fx のアイコン）。
- Run after（Settings タブ内）：`Select actions` で前の箱を選び、`Is successful`／`Has timed out`／`Is skipped`／`Has failed` のチェック。行の右端にゴミ箱。**前の箱の行が残っていると、その箱の成功も必要になる**。
- Compose の箱は、名前を変えても **Inputs が空だと保存できない**（赤い「Invalid parameters」）。

### 式（`expressions/VERIFIED_RESULTS.md`）
- `convertTimeZone(...)` の結果の末尾に `Z` や `+09:00` は付かない。
- **標準の `trim` は全角スペースも両端から除去する**（公式には記載なし）。
- `'\n'` は改行にならない（文字として残る）。改行は `decodeUriComponent('%0A')`。
- `length(null)` はエラー。`equals(null, '')` は False。`int('03')` は 3。`string(true)` は `True`。

### サンプルJSONの要点（詳細は `docs/structure_notes.md`）
- 箱の種類：`Request`（手動トリガー）、`InitializeVariable`、`Scope`、`OpenApiConnection`、`Foreach`、`Compose`。
- 並列・ページ分けは `runtimeConfiguration`（`concurrency.repetitions`、`paginationPolicy.minimumItemCount`）。**オフのときはキーごと無い**。
- `runAfter`：`{"前の箱の名前": ["Succeeded"]}`、失敗時は `["TimedOut","Failed"]`。トリガー直後は `{}`、スコープ内の最初の箱はキー無し。
- Excel の一覧取得の `operationId` は `GetItems`、メール送信は `SendEmailV2`（本文は HTML で保存）。

### まだ［想定］のもの（実画面で未確認）
「Rename」メニュー、「Add an action」、「Test→Manually→Run flow→Done」の操作名、Settings 内の `Pagination`／`Concurrency control` の項目名、Initialize variable・メール送信の画面の項目名、**日本語表示の名前はすべて**。

## 7. 主なファイル

```text
flow-kit/
  CLAUDE.md                 作業ルール（短縮版）
  README.md                 ツールの使い方・進捗・サンプル提供状況
  docs/HANDOFF.md           この資料
  docs/structure_notes.md   アクション構造の規則（サンプルの読み取り）
  docs/spec_format.md       業務手順書の書式（build_guide の入力）
  docs/sample_checklist.md  サンプル収集のチェックリスト
  docs/manual_*.html        利用者向け HTML マニュアル（図つき）
  expressions/              式ライブラリ（検証済み）、VERIFY.md、VERIFIED_RESULTS.md
  samples/                  サンプルJSON（actions/・triggers/・flows/）と _manifest.csv
  tools/                    make_expression.ps1、build_guide.ps1、_expr_lib.ps1
  tests/                    run_tests.ps1 と各ツールの入力・期待出力
  dev/                      式ライブラリの生成スクリプト（Python）
```
