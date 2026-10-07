# 配列の件数

- ID: E08
- キーワード: 件数, 配列, 数, 何件, 行数, 個数, length, カウント, 件, 0件
- 使用関数: length, coalesce, json, equals
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **未検証**（Compose での検証待ち。結果は VERIFY.md に記入）

## 用途

「行を取得」「配列のフィルター処理」「選択」などの結果（配列）が **何件か** を数えます。0件のときだけ処理を分ける条件にも使います。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式（貼り付け用）

```text
length(<配列>)
```

### 値なし（null）でも 0 件として扱う安全版

```text
length(coalesce(<配列>, json('[]')))
```

### 0件かどうかの判定

```text
equals(length(<配列>), 0)
```

## 入力の想定

`<配列>` に、配列を返す動的なコンテンツ（例：取得アクションの `value`）を入れます。
- 取得アクションの出力から配列を取り出す書き方（例：`body('アクション名')?['value']`）は **要確認（サンプルなし）** です。動的なコンテンツから「value」を選んで挿入し、式タブに表示された内容をそのまま使ってください。
- **件数は取得アクション側のページネーション・上限件数の設定に左右されます**（既定の上限で打ち切られていると、実際より少ない件数になる）。設定項目名は **要確認（サンプルなし）**。

## 出力例

| 配列 | 出力 |
| --- | --- |
| `[1,2,3]` | `3` |
| `[]` | `0` |

## よくある誤り

- 取得アクションが上限件数で打ち切られているのに、件数を「全件」と思い込む（ページネーション未設定。check_flow で検出する対象）。
- `length(null)` のように値なしを渡す（エラーになる恐れ。安全版の `coalesce` を使う）。
- 配列ではなくオブジェクトや、配列を含む本文全体（`body(...)`）に `length` をかける（配列部分だけを渡す）。
- 文字列の `length` はバイト数ではなく文字数。全角も半角も1文字として数える。
- `Apply to each` の中で件数を数えようとして、ループ対象の配列ではなく現在の1件を渡す。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E08_1 配列の件数

- 期待出力: `3`

```text
length(json('[1,2,3]'))
```

### E08_2 createArray で作った配列の件数

- 期待出力: `4`

```text
length(createArray('a','b','c','d'))
```

### E08_3 空の配列

- 期待出力: `0`

```text
length(json('[]'))
```

### E08_4 値なし（null）でも安全に 0 にする

- 期待出力: `0`

```text
length(coalesce(null, json('[]')))
```

### E08_5 文字列の length は文字数（日本語も1文字=1）

- 期待出力: `3`

```text
length('あいう')
```

### E08_6 件数が0かどうかの判定

- 期待出力: `true`

```text
equals(length(json('[]')), 0)
```

### E08_7 【誤りの再現】null を length に直接渡す（実機で確認済み）

- 期待出力: エラー：The template language function 'length' expects its parameter to be an array or a string. The provided value is of type 'Null'.
- 備考: 2026-10-07 実機で確認済み（InvalidTemplate）。値なしの可能性があるときは coalesce で空配列にしてから length を使う

```text
length(null)
```
