# 式ライブラリ（expressions）

自治体事務でよく使う Power Automate の式を、**1ファイル1用途** でまとめています。

## 使うときの約束

- 使う関数は Microsoft Learn の Workflow Definition Language 関数リファレンスに載っているものだけです。根拠URLは各ファイルに書いてあります。
  - https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- `utcNow()` は **UTC** を返します。日本時間が必要な箇所は必ず `convertTimeZone(…, 'UTC', 'Tokyo Standard Time')` で変換します。
- フローの先頭に [00_now_jst.md](00_now_jst.md) の `Compose_JST` を置き、以降の式はその出力を使います。
- 式は Compose の入力欄の「式」タブ（fx）に貼り付けます（先頭の `@` は不要）。
- **全ケースを実機で検証済み（2026-10-07、Power Automate 英語表示）** で、期待どおりの結果でした。結果は [VERIFIED_RESULTS.md](VERIFIED_RESULTS.md)、手順は [VERIFY.md](VERIFY.md) にあります。別の環境（画面言語・テナント）では挙動が変わる可能性があるため、初めて使う環境では E00・E01 だけでも確認してください。
- ファイル内の「要確認（サンプルなし）」は、アクションのJSONサンプルがまだなく、画面上の名称や設定項目を断定できないものです。

## 一覧

| ID | 用途 | ファイル | ケース数 |
| --- | --- | --- | --- |
| E00 | 日本時間の現在日時（基準となる Compose_JST） | [00_now_jst.md](00_now_jst.md) | 3 |
| E01 | 日本時間の今日の日付（yyyy/MM/dd） | [01_today_jst.md](01_today_jst.md) | 5 |
| E02 | 和暦表示（令和・平成・昭和） | [02_wareki.md](02_wareki.md) | 6 |
| E03 | 翌営業日（土日除外） | [03_next_business_day.md](03_next_business_day.md) | 7 |
| E04 | 月末日 | [04_end_of_month.md](04_end_of_month.md) | 7 |
| E05 | ファイル名に付ける日時（yyyyMMdd_HHmm） | [05_filename_timestamp.md](05_filename_timestamp.md) | 6 |
| E06 | Excelのシリアル値 → 日付 | [06_excel_serial_to_date.md](06_excel_serial_to_date.md) | 7 |
| E07 | 空欄判定（null・空文字・半角/全角スペースのみ） | [07_is_blank.md](07_is_blank.md) | 9 |
| E08 | 配列の件数 | [08_array_count.md](08_array_count.md) | 7 |
| E09 | メール本文用の改行 | [09_mail_newline.md](09_mail_newline.md) | 6 |
| E10 | 全角スペースを含む前後空白の除去 | [10_trim_zenkaku.md](10_trim_zenkaku.md) | 7 |
| E11 | 年度（4月始まり） | [11_fiscal_year.md](11_fiscal_year.md) | 6 |
| E12 | 日付の差（日数） | [12_days_between.md](12_days_between.md) | 5 |

## ファイルの書式

各ファイルは次の構成です（`tools/make_expression` がこの構成を読み取ります。構成を崩さないでください）。

```text
# 用途のタイトル
- ID / キーワード / 使用関数 / 根拠 / 検証状況
## 用途
## 式（貼り付け用）
## 入力の想定
## 出力例
## よくある誤り
## 検証（Compose）
```
