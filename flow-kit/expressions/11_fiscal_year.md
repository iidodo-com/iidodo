# 年度（4月始まり）

- ID: E11
- キーワード: 年度, 会計年度, 令和年度, 年度判定, 4月始まり, 今年度, 当年度, 年度計算
- 使用関数: formatDateTime, int, if, greaterOrEquals, sub, concat, string
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- タイムゾーン名の根拠: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-time-zones（このページ自体は未確認。`Tokyo Standard Time` は E00 のケースで動作確認する）
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **未検証**（Compose での検証待ち。結果は VERIFY.md に記入）

## 用途

日本時間の日付から、4月始まりの年度（西暦）を数値で求めます。1〜3月は前年の年度になります。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式（貼り付け用・西暦の年度）

```text
if(greaterOrEquals(int(formatDateTime(outputs('Compose_JST'),'MM')),4),int(formatDateTime(outputs('Compose_JST'),'yyyy')),sub(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1))
```

### 派生式（令和◯年度。令和2年度以降用。<年度> は上の式の結果）

```text
concat('令和', string(sub(<年度>, 2018)), '年度')
```

## 入力の想定

`outputs('Compose_JST')`（日本時間の日時）。派生式の `<年度>` には上の式の結果（Compose の出力）を入れます。

## 出力例

| 基準日 | 出力 |
| --- | --- |
| 2026-03-31 | `2025` |
| 2026-04-01 | `2026` |
| 2027-01-15 | `2026` |
| （派生式）年度 2026 | `令和8年度` |

## よくある誤り

- 暦年（1月始まり）をそのまま年度にする（1〜3月が翌年度扱いになる）。
- UTC のまま判定する（4月1日の 0:00〜8:59 が前年度になる）。
- `int(formatDateTime(…,'MM'))` の月が 0 付き（`03`）でも変換できる前提（ケース E11_0 で確認）。
- 令和元年度（2019年度）に派生式を使う（`令和1年度` と出力され「元年度」にならない）。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E11_0 【前提確認】int('03') が 3 になるか（月の先頭ゼロ）

- 期待出力: `3`
- 備考: 前提確認。ここで失敗する場合は結果を知らせてください

```text
int('03')
```

### E11_1 3月31日（前年度）（2026-03-31）

- 期待出力: `2025`

```text
if(greaterOrEquals(int(formatDateTime('2026-03-31T10:00:00','MM')),4),int(formatDateTime('2026-03-31T10:00:00','yyyy')),sub(int(formatDateTime('2026-03-31T10:00:00','yyyy')),1))
```

### E11_2 4月1日（新年度の初日）（2026-04-01）

- 期待出力: `2026`

```text
if(greaterOrEquals(int(formatDateTime('2026-04-01T00:00:00','MM')),4),int(formatDateTime('2026-04-01T00:00:00','yyyy')),sub(int(formatDateTime('2026-04-01T00:00:00','yyyy')),1))
```

### E11_3 秋（2026-10-07）

- 期待出力: `2026`

```text
if(greaterOrEquals(int(formatDateTime('2026-10-07T10:00:00','MM')),4),int(formatDateTime('2026-10-07T10:00:00','yyyy')),sub(int(formatDateTime('2026-10-07T10:00:00','yyyy')),1))
```

### E11_4 翌年の1月（2027-01-15）

- 期待出力: `2026`

```text
if(greaterOrEquals(int(formatDateTime('2027-01-15T10:00:00','MM')),4),int(formatDateTime('2027-01-15T10:00:00','yyyy')),sub(int(formatDateTime('2027-01-15T10:00:00','yyyy')),1))
```

### E11_5 令和◯年度（令和2年度以降）

- 期待出力: `令和8年度`

```text
concat('令和', string(sub(2026, 2018)), '年度')
```
