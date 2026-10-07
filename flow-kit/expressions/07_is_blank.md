# 空欄判定（null・空文字・半角/全角スペースのみ）

- ID: E07
- キーワード: 空欄, 空, 空白, ブランク, 未入力, null, 空判定, 入力なし, empty, 空欄判定, 空かどうか
- 使用関数: empty, trim, replace, string, decodeUriComponent
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **未検証**（Compose での検証待ち。結果は VERIFY.md に記入）

## 用途

Excel のセル・SharePoint の列・Forms の回答が「空欄」かどうかを `true/false` で返します。
**値なし（null）／空文字／半角スペースのみ／全角スペースのみ／ノーブレークスペースのみ** をすべて空欄とみなします。条件アクションの比較値や `if` の条件に使います。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式（貼り付け用）

```text
empty(trim(replace(replace(string(<値>),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### 簡易版（null と空文字だけを空欄とする場合）

```text
empty(string(<値>))
```

## 入力の想定

`<値>` に判定したい値（動的なコンテンツ。`triggerBody()?['項目名']` のような式でもよい）を入れます。
- `string(null)` は空文字 `""` を返します（リファレンスに記載）。そのため値なし（null）も空欄として判定されます。
- 全角スペースは `decodeUriComponent('%E3%80%80')`（= `%E3%80%80` を元の文字に戻す関数）で表しています。式に全角スペースを直接書くと見分けにくく、貼り付け時に失われやすいためです。ノーブレークスペース（U+00A0）は `decodeUriComponent('%C2%A0')` です。

## 出力例

| 値 | 出力 |
| --- | --- |
| （値なし） | `true` |
| `""` | `true` |
| `" "`（半角） | `true` |
| `"　"`（全角） | `true` |
| `"abc"` | `false` |
| `0` | `false` |

## よくある誤り

- `empty(<値>)` だけで判定する（スペースだけの値は空欄にならない。ケース E07_8）。
- `equals(<値>, '')` で判定する（null と空文字を区別する場合があり、値なしが空欄にならない恐れ。ケース E07_9 で確認）。
- `trim` だけで全角スペースが消えると思い込む（リファレンスの `trim` には「空白」としか書かれておらず、全角スペースが除去されるかは記載がない。10_trim_zenkaku.md のケースで確認）。この式は先に全角スペースを半角に置換している。
- 数値の `0` を空欄と判定してしまう設計にする（この式では 0 は空欄ではない）。
- Excel の「空に見えるセル」に数式で `""` が入っている場合も空文字として届く。値の有無ではなく空文字かどうかで判定すること。
- 複数選択や配列の列に使う（配列には `empty(<配列>)` を使う）。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E07_1 空文字

- 期待出力: `true`

```text
empty(trim(replace(replace(string(''),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### E07_2 半角スペースのみ

- 期待出力: `true`

```text
empty(trim(replace(replace(string(' '),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### E07_3 全角スペースのみ

- 期待出力: `true`

```text
empty(trim(replace(replace(string(decodeUriComponent('%E3%80%80')),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### E07_4 通常の文字

- 期待出力: `false`

```text
empty(trim(replace(replace(string('abc'),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### E07_5 文字の 0（空欄ではない）

- 期待出力: `false`

```text
empty(trim(replace(replace(string('0'),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### E07_6 null（値なし）

- 期待出力: `true`

```text
empty(trim(replace(replace(string(null),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### E07_7 数値の 0（空欄ではない）

- 期待出力: `false`

```text
empty(trim(replace(replace(string(0),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

### E07_8 【誤りの再現】empty だけだと半角スペースのみでも空欄にならない

- 期待出力: `false`
- 備考: 空白だけの値が「空欄」と判定されないことの確認

```text
empty(' ')
```

### E07_9 【観察】equals(null, '') の結果

- 期待出力: （予想：false。結果を知らせてください）
- 備考: null と空文字を区別するかの観察用

```text
equals(null, '')
```
