# flow-kit の作業ルール

このフォルダーは「Power Automate クラウドフロー作成支援キット」です。作業を始める前に **`docs/HANDOFF.md`**（引き継ぎ資料）を読んでください。

- 利用者は地方自治体の事務職員（素人）。説明・コメント・ドキュメントは**日本語**、**素人向けに丁寧に**。
- アクション名・パラメータ名は `samples/` のサンプルJSONだけを根拠にする。ないものは推測せず「**要確認（サンプルなし）**」と明記し、README の一覧に追記する。画面の名前は、実際に見えたものだけを［画面で確認済み］とし、他は［想定］。
- 式は Workflow Definition Language の公式関数のみ。`utcNow()` は UTC なので、日本時間は必ず `convertTimeZone(…, 'UTC', 'Tokyo Standard Time')` で変換する。
- PowerShell は **Windows PowerShell 5.1 で動く書き方のみ**（`??`・`&&`・三項演算子・`-Parallel` などは使わない）。`.ps1` は BOM 付き UTF-8、入出力は `-Encoding` を明示、`ConvertTo-Json` は `-Depth` を明示。
- 工程は1つ終わるごとに概要を報告し、承認を得てから次へ進む。各ツールに `tests/` の入力と期待出力を用意し、`tests/run_tests.ps1` の結果を報告する。
- 利用者が貼るデータの**伏字を必ず自分で確認**してから保存する。実データ（ファイルID・フォルダー名・個人名・メールアドレス）をリポジトリに入れない。
- リポジトリ直下の `samples/`・`tools/`・`docs/` は別プロジェクト。変更しない。成果物は `flow-kit/` の下だけ。
- `docs/manual_*.html` は生成後に手で図を足してあるため、HTML 自体が正。式ライブラリ（`expressions/*.md`）は `dev/build_expr.py` で生成する。
