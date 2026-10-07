# 日本時間の現在日時（基準となる Compose_JST）

- ID: E00
- キーワード: 現在, 現在日時, 今, いま, 日本時間, JST, 基準, タイムゾーン, 時刻, 日時, utcNow, UTC
- 使用関数: utcNow, convertTimeZone, formatDateTime
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- タイムゾーン名の根拠: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-time-zones（このページ自体は未確認。`Tokyo Standard Time` は E00 のケースで動作確認する）
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **未検証**（Compose での検証待ち。結果は VERIFY.md に記入）

## 用途

utcNow() は **UTC（協定世界時）** を返します。日本時間（JST = UTC+9）が必要なときは、必ず `convertTimeZone` で `'Tokyo Standard Time'` に変換します。
このファイルの式を **フローの先頭に置く「作成（Compose）」アクションの名前を `Compose_JST` として貼り付け**、以降の式（翌営業日・月末日・和暦・年度など）は `outputs('Compose_JST')` を参照する運用を推奨します。
理由：式の中で `utcNow()` を何度も呼ぶと、0時をまたぐ瞬間に呼び出しごとの日付がずれることがあるため、現在時刻は一度だけ取得します。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式（Compose_JST に貼る）

```text
convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time')
```

## 入力の想定

入力なし（実行時の現在時刻を使う）。

## 出力例

実行時刻が日本時間 2026年10月7日 00:30 のとき：

```text
2026-10-07T00:30:12.3456789
```

- 末尾に `Z` や `+09:00` は付かない想定です（リファレンスに「結果にタイムゾーンのオフセットが含まれない場合がある」と記載）。→ ケース E00_1 で確認します。

## よくある誤り

- `utcNow()` をそのまま日付表示・比較に使う（日本時間と最大9時間ずれる。特に日本時間 0:00〜8:59 は前日の日付になる）。
- タイムゾーン名を `JST` や `Asia/Tokyo` と書く。指定できるのは Windows のタイムゾーン名で、日本は `Tokyo Standard Time`（リファレンスは Microsoft Windows Default Time Zones の名前を使うと記載）。
- `Compose_JST` の結果（すでに日本時間）を、もう一度 `convertTimeZone(…, 'UTC', 'Tokyo Standard Time')` に通す（二重に +9 時間される）。
- 式の途中で `utcNow()` を複数回呼ぶ（0時をまたぐと日付が食い違う）。
- 変換結果にはオフセットが付かないため、末尾が `Z` 付きの値（SharePoint や Outlook が返す UTC 値）と直接比較しない。比較するときは両方を同じ基準（日本時間）に揃える。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E00_1 【観察】固定のUTC時刻を日本時間へ変換（時刻部分の確認）

- 期待出力: `2026-10-07T00:30:00.0000000`
- 備考: 末尾に Z／オフセットが付くかどうかを確認

```text
convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time')
```

### E00_2 変換結果を日付時刻の書式にする

- 期待出力: `2026/10/07 00:30`

```text
formatDateTime(convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time'), 'yyyy/MM/dd HH:mm')
```

### E00_3 【観察】本番式の実行確認（現在時刻）

- 期待出力: `実行した時刻の日本時間（目視で、手元の時計と一致すること）`
- 備考: 期待値は固定できないため目視確認

```text
convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time')
```
