# メール本文用の改行

- ID: E09
- キーワード: 改行, メール本文, 本文, 改行コード, br, HTML, 行, 複数行, 箇条書き, 改行を入れる
- 使用関数: concat, replace, join, decodeUriComponent, createArray
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **実機検証済み**（2026-10-07 Power Automate 英語表示・既定環境。全ケースが期待どおり。詳細は VERIFIED_RESULTS.md）

## 用途

メール本文などに改行を入れます。式の文字列の中では、改行を `decodeUriComponent('%0A')`（改行コード LF を表す文字列）で書きます。**HTML 形式のメール本文では、改行コードだけでは画面上で改行されず `<br>` が必要**です。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式A：文字列の途中に改行（LF）を入れる

```text
concat('1行目', decodeUriComponent('%0A'), '2行目')
```

### 式B：HTML本文用。複数行テキストの改行を <br> に置換（LF のみ）

```text
replace(<複数行テキスト>, decodeUriComponent('%0A'), '<br>')
```

### 式C：HTML本文用。CRLF／LF のどちらでも <br> に置換

```text
replace(replace(<複数行テキスト>, decodeUriComponent('%0D%0A'), '<br>'), decodeUriComponent('%0A'), '<br>')
```

### 式D：配列の各要素を1行ずつ並べる（HTML本文用）

```text
join(<配列>, '<br>')
```

## 入力の想定

`<複数行テキスト>` に、Forms の複数行回答・SharePoint の複数行テキスト・Excel の改行入りセルなどを入れます。
- Outlook の「Send an email (V2)」の本文は、**HTML として保存されます**（サンプルでは `emailMessage/Body` が `<p class="editor-paragraph">…</p>`。`samples/actions/control__scope__run_after_failed.json`）。そのため、改行は `<br>` にします。Teams の投稿の本文は **要確認（サンプルなし）**。
- SharePoint の「リッチテキスト」列は、すでに HTML（`<div>` 等）の形で届くため、`<br>` への置換は不要です。

## 出力例

式C に `A⏎B⏎C`（Windows 形式の改行）を渡した場合：

```text
A<br>B<br>C
```

## よくある誤り

- 式の中に `'\n'` と書く。**改行にならず「\n」という文字が出力されます**（2026-10-07 実機で確認。ケース E09_6：文字数 A\nB が 4）。`decodeUriComponent('%0A')` を使う。
- HTML 形式の本文に改行コードだけを入れる（HTML では改行コードは無視され、1行につながって表示される）。
- CRLF（`%0D%0A`）のデータに対して LF だけを置換する（CR が残り、表示が崩れることがある）。CRLF を先に置換する（式C）。
- リッチテキスト列に式Bを適用する（すでに HTML のため不要）。
- 本文の「プレーンテキスト」と「HTML」を切り替えずに `<br>` を入れる（`<br>` という文字がそのままメールに出る）。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E09_1 文字列の途中に改行を入れる（出力が2行で表示される）

- 期待出力: `1行目⏎2行目（2行で表示）`
- 備考: 実行履歴で2行になっていることを目視確認

```text
concat('1行目', decodeUriComponent('%0A'), '2行目')
```

### E09_2 上の改行が1文字であること（文字数で確認）

- 期待出力: `3`

```text
length(concat('A', decodeUriComponent('%0A'), 'B'))
```

### E09_3 HTMLメール用：改行を <br> に置換

- 期待出力: `1行目<br>2行目`

```text
replace(concat('1行目', decodeUriComponent('%0A'), '2行目'), decodeUriComponent('%0A'), '<br>')
```

### E09_4 CRLF（Windows形式の改行）も LF も <br> にする

- 期待出力: `A<br>B<br>C`

```text
replace(replace(concat('A', decodeUriComponent('%0D%0A'), 'B', decodeUriComponent('%0A'), 'C'), decodeUriComponent('%0D%0A'), '<br>'), decodeUriComponent('%0A'), '<br>')
```

### E09_5 配列を <br> で連結（箇条書きを本文にする）

- 期待出力: `A<br>B<br>C`

```text
join(createArray('A','B','C'), '<br>')
```

### E09_6 【観察】\n と書いた場合（改行になるか）

- 期待出力: 4（実機確認済み：\n は改行にならず、文字として残る）
- 備考: 予想値。結果を知らせてください

```text
length(concat('A','\n','B'))
```
