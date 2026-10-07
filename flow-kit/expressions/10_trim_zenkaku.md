# 全角スペースを含む前後空白の除去

- ID: E10
- キーワード: トリム, trim, 空白, 前後, 全角スペース, スペース除去, 余白, 空白除去, 前後の空白, 氏名, 全角空白
- 使用関数: trim, replace, string, decodeUriComponent
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **未検証**（Compose での検証待ち。結果は VERIFY.md に記入）

## 用途

Excel・Forms・メール本文から取り込んだ文字列の **前後の空白（半角・全角・ノーブレークスペース）** を取り除きます。氏名や課コードの突合（一致判定）の前処理に使います。
リファレンスの `trim` は「前後の空白を削除」としか書かれておらず、全角スペースを除去できるかの記載がありません。そのため、**先に全角スペースを半角スペースへ置換してから `trim` する**方法を標準とします（結果はケース E10_2 で確認）。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式A（貼り付け用）：両端を除去。途中の全角スペースは半角スペース1つに統一される

```text
trim(replace(replace(string(<値>),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' '))
```

### 式B：途中のスペースも含め、すべてのスペースを除去（氏名の突合用）

```text
replace(replace(replace(string(<値>),decodeUriComponent('%E3%80%80'),''),decodeUriComponent('%C2%A0'),''),' ','')
```

## 入力の想定

`<値>` に文字列の動的なコンテンツを入れます。値なし（null）は空文字として扱われます（`string(null)` は `""`。リファレンスに記載）。
全角スペースは `decodeUriComponent('%E3%80%80')`、ノーブレークスペースは `decodeUriComponent('%C2%A0')` で表しています。式に直接スペース文字を書くと見分けがつかず、貼り付け時に消えることがあるためです。

## 出力例

| 入力（`□` は全角スペース） | 式A | 式B |
| --- | --- | --- |
| `□山田□太郎□` | `山田 太郎` | `山田太郎` |
| `  Abc  `（半角） | `Abc` | `Abc` |

## よくある誤り

- 標準の `trim(<値>)` だけで全角スペースも消えると思い込む（記載がない。ケース E10_2 で確認）。
- 式の中に全角スペースを直接書いて置換する（貼り付けや保存で半角に変わる・消えることがある）。`decodeUriComponent('%E3%80%80')` を使う。
- 氏名の突合で、途中の空白の有無（`山田 太郎` と `山田太郎`）がそろっていない（式B で空白をすべて除去してから比較する）。
- Excel からのコピーで混入する ノーブレークスペース（U+00A0）を忘れる（見た目は半角スペースだが `trim` では除去されない場合がある）。
- 途中の全角スペースだけを残して両端だけ除去したい場合は、1つの式では実現できない（繰り返し処理が必要になる。必要になった時点で相談）。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E10_1 【前提確認】検証用の入力（全角スペース＋山田＋全角＋太郎＋全角＋半角）の文字数

- 期待出力: `8`

```text
length(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' '))
```

### E10_2 【観察】標準の trim だけで両端の全角スペースが消えるか（文字数で確認）

- 期待出力: （5：全角・半角とも両端除去 / 7：半角だけ除去 / 8：何も除去されない。結果を知らせてください）
- 備考: 最重要の観察ケース。結果に応じて式の根拠を確定する

```text
length(trim(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' ')))
```

### E10_3 式A（両端の全角・半角スペースを除去。途中の全角は半角に統一）

- 期待出力: `山田 太郎`
- 備考: 途中の空白は半角スペース1つになる

```text
trim(replace(replace(string(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' ')),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' '))
```

### E10_4 式A の結果の文字数

- 期待出力: `5`

```text
length(trim(replace(replace(string(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' ')),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### E10_5 式B（途中も含めてスペースをすべて除去）

- 期待出力: `山田太郎`

```text
replace(replace(replace(string(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' ')),decodeUriComponent('%E3%80%80'),''),decodeUriComponent('%C2%A0'),''),' ','')
```

### E10_6 式A：ノーブレークスペースの除去

- 期待出力: `ABC`

```text
trim(replace(replace(string(concat(decodeUriComponent('%C2%A0'),'ABC',decodeUriComponent('%C2%A0'))),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' '))
```

### E10_7 式A：値なし（null）

- 期待出力: （空文字）

```text
trim(replace(replace(string(null),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' '))
```
