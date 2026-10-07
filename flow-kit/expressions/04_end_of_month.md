# 月末日

- ID: E04
- キーワード: 月末, 月末日, 末日, 月の最終日, 最終日, 月末締め, 末日付
- 使用関数: startOfMonth, addToTime, addDays, dayOfMonth
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- タイムゾーン名の根拠: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-time-zones（このページ自体は未確認。`Tokyo Standard Time` は E00 のケースで動作確認する）
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **実機検証済み**（2026-10-07 Power Automate 英語表示・既定環境。全ケースが期待どおり。詳細は VERIFIED_RESULTS.md）

## 用途

指定した日時が属する月の月末日を求めます。「月の初日を出す → 1か月進める → 1日戻す」で、月ごとの日数やうるう年を自動で処理します。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式（貼り付け用・yyyy/MM/dd）

```text
addDays(addToTime(startOfMonth(outputs('Compose_JST')),1,'Month'),-1,'yyyy/MM/dd')
```

### 派生式（日だけ・数値）

```text
dayOfMonth(addDays(addToTime(startOfMonth(outputs('Compose_JST')),1,'Month'),-1))
```

## 入力の想定

`outputs('Compose_JST')`（日本時間の日時）。他の日付の月末を求めるときは、その日付（日本時間）に置き換える。

## 出力例

| 基準日 | 出力 |
| --- | --- |
| 2026-01-15 | `2026/01/31` |
| 2026-02-10 | `2026/02/28` |
| 2028-02-10 | `2028/02/29` |

## よくある誤り

- 月末を固定の 30 や 31 にしてしまう（2月・小の月で誤る）。
- 基準日に1か月足してから1日引く（1/31 + 1か月 = 2/28 となり、月末が2/27になる。ケース E04_7）。必ず `startOfMonth` で月初に直してから1か月進める。
- `startOfMonth` の結果は 0時0分の日時文字列。そのまま「日付」として表示したいときは `addDays` の書式引数か `formatDateTime` で整形する。
- UTC のまま使う（日本時間の月末日の 0:00〜8:59 に実行すると UTC では前日のため、月末の判定がずれる）。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E04_1 31日の月の最終日（2026-01-31）

- 期待出力: `2026/01/31`

```text
addDays(addToTime(startOfMonth('2026-01-31T10:00:00'),1,'Month'),-1,'yyyy/MM/dd')
```

### E04_2 2月（平年）（2026-02-10）

- 期待出力: `2026/02/28`

```text
addDays(addToTime(startOfMonth('2026-02-10T10:00:00'),1,'Month'),-1,'yyyy/MM/dd')
```

### E04_3 2月（うるう年）（2028-02-10）

- 期待出力: `2028/02/29`

```text
addDays(addToTime(startOfMonth('2028-02-10T10:00:00'),1,'Month'),-1,'yyyy/MM/dd')
```

### E04_4 30日の月（2026-04-30）

- 期待出力: `2026/04/30`

```text
addDays(addToTime(startOfMonth('2026-04-30T23:30:00'),1,'Month'),-1,'yyyy/MM/dd')
```

### E04_5 年末の月（2026-12-05）

- 期待出力: `2026/12/31`

```text
addDays(addToTime(startOfMonth('2026-12-05T10:00:00'),1,'Month'),-1,'yyyy/MM/dd')
```

### E04_6 日だけ取り出す（うるう年の2月）

- 期待出力: `29`

```text
dayOfMonth(addDays(addToTime(startOfMonth('2028-02-10T10:00:00'),1,'Month'),-1))
```

### E04_7 【誤りの再現】月初に直さず addToTime で1か月足してから1日引く

- 期待出力: `2026/02/27`
- 備考: 予想値。1/31+1か月が 2/28 になり、-1日で 2/27 になるか確認

```text
addDays(addToTime('2026-01-31T10:00:00',1,'Month'),-1,'yyyy/MM/dd')
```
