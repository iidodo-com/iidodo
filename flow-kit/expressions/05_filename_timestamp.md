# ファイル名に付ける日時（yyyyMMdd_HHmm）

- ID: E05
- キーワード: ファイル名, 日時, タイムスタンプ, yyyyMMdd_HHmm, 保存名, 作成日時, 名前に日付, 連番, ファイル名に日付
- 使用関数: convertTimeZone, utcNow, concat
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- タイムゾーン名の根拠: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-time-zones（このページ自体は未確認。`Tokyo Standard Time` は E00 のケースで動作確認する）
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **未検証**（Compose での検証待ち。結果は VERIFY.md に記入）

## 用途

OneDrive・SharePoint に保存するファイル名に付ける日本時間の日時（例：`20261007_0930`）を作ります。ファイル名に使えない `/` `:` を含まない形式です。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式（貼り付け用・分まで）

```text
convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm')
```

### 派生式（秒まで。同じ分に複数回実行されても重複しにくい）

```text
convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmmss')
```

### ファイル名にする例

```text
concat('申請一覧_', convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm'), '.xlsx')
```

## 入力の想定

入力なし（実行時の日時）。

## 出力例

日本時間 2026年10月7日 09:30 に実行した場合：

| 式 | 出力 |
| --- | --- |
| yyyyMMdd_HHmm | `20261007_0930` |
| yyyyMMdd_HHmmss | `20261007_093012` |
| ファイル名の例 | `申請一覧_20261007_0930.xlsx` |

## よくある誤り

- `HH` を小文字の `hh` にする（`hh` は 12 時間表記。14時が `02` になり、午前と午後が区別できない。ケース E05_5）。
- `MM`（月）を `mm`（分）にする（`yyyymmdd` は「年・分・日」になる。ケース E05_6）。
- `yyyy/MM/dd HH:mm` のように `/` や `:` を使う（ファイル名に使えない文字。SharePoint・OneDrive では保存エラーになる）。
- `utcNow('yyyyMMdd_HHmm')` と書く（UTC になり、日本時間より9時間遅れた名前になる）。
- 同じ分に複数回実行される可能性があるのに分までしか付けない（同名ファイルの上書き・エラーの恐れ。秒まで付ける）。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E05_1 日付をまたぐ（日本時間 10/07 0:30）

- 期待出力: `20261007_0030`

```text
convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm')
```

### E05_2 日本時間 23:05（3/31）

- 期待出力: `20260331_2305`

```text
convertTimeZone('2026-03-31T14:05:09Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm')
```

### E05_3 秒まで

- 期待出力: `20260331_230509`

```text
convertTimeZone('2026-03-31T14:05:09Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmmss')
```

### E05_4 ファイル名の例（concat）

- 期待出力: `申請一覧_20261007_0030.xlsx`

```text
concat('申請一覧_', convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm'), '.xlsx')
```

### E05_5 【誤りの再現】hh（12時間表記）

- 期待出力: `20261006_0230`
- 備考: 日本時間14:30が 02:30 になることの確認

```text
convertTimeZone('2026-10-06T05:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_hhmm')
```

### E05_6 【誤りの再現】mm（分）を月に使う

- 期待出力: `20263006`
- 備考: 月の位置に分（30）が入ることの確認

```text
convertTimeZone('2026-10-06T05:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyymmdd')
```
