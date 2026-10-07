# 日本時間の今日の日付（yyyy/MM/dd）

- ID: E01
- キーワード: 今日, 本日, 日付, 年月日, yyyy/MM/dd, 日本時間, 現在日, 当日, 日付表示
- 使用関数: convertTimeZone, utcNow, formatDateTime
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- タイムゾーン名の根拠: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-time-zones（このページ自体は未確認。`Tokyo Standard Time` は E00 のケースで動作確認する）
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **実機検証済み**（2026-10-07 Power Automate 英語表示・既定環境。全ケースが期待どおり。詳細は VERIFIED_RESULTS.md）

## 用途

日本時間の「今日の日付」を `2026/10/07` の形式で取り出します。メール本文・ファイルの項目・SharePoint の文字列列などに入れる用途です。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式（貼り付け用・yyyy/MM/dd）

```text
convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')
```

### 派生式（ハイフン区切り yyyy-MM-dd）

```text
convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyy-MM-dd')
```

### 派生式（2026年10月7日 のように月日のゼロを付けない）

```text
convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyy年M月d日')
```

### Compose_JST を使う場合（00_now_jst.md 参照）

```text
formatDateTime(outputs('Compose_JST'), 'yyyy/MM/dd')
```

## 入力の想定

入力なし。実行した瞬間の日時を使います。

## 出力例

日本時間 2026年10月7日 00:30 に実行した場合：

| 式 | 出力 |
| --- | --- |
| yyyy/MM/dd | `2026/10/07` |
| yyyy-MM-dd | `2026-10-07` |
| yyyy年M月d日 | `2026年10月7日` |

## よくある誤り

- `formatDateTime(utcNow(), 'yyyy/MM/dd')` と書く。UTC の日付になり、日本時間 0:00〜8:59 は **前日** が出ます（ケース E01_4 で再現）。
- 書式を `yyyy/mm/dd` と小文字の `mm` にする。`mm` は「分」、`MM` が「月」です（例：2026/30/07 のようになる）。
- 書式の文字列が **1文字だけ** の場合（例：`'d'` や `'M'`）は標準書式として解釈される（`'d'` は短い日付、`'M'` は月日）。1文字の書式を使いたいときは `'%d'` と書く。`yyyy年M月d日` のように2文字以上なら問題ない。
- Compose の出力は実行履歴で `"2026/10/07"` のように引用符付きで表示されるが、値は引用符を含まない。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E01_1 日本時間 23:59:59（同じ日）

- 期待出力: `2026/10/06`

```text
convertTimeZone('2026-10-06T14:59:59Z', 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')
```

### E01_2 日本時間 0:00:00（日付が変わる境目）

- 期待出力: `2026/10/07`

```text
convertTimeZone('2026-10-06T15:00:00Z', 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')
```

### E01_3 年またぎ（日本時間 2027/01/01）

- 期待出力: `2027/01/01`

```text
convertTimeZone('2026-12-31T15:00:00Z', 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')
```

### E01_5 派生式 yyyy年M月d日

- 期待出力: `2026年10月7日`

```text
convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyy年M月d日')
```

### E01_4 【誤りの再現】変換せずに formatDateTime（日本時間では 10/07 なのに…）

- 期待出力: `2026/10/06`
- 備考: 誤った式の結果。日本時間とずれることの確認用

```text
formatDateTime('2026-10-06T15:30:00Z', 'yyyy/MM/dd')
```
