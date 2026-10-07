# 和暦表示（令和・平成・昭和）

- ID: E02
- キーワード: 和暦, 令和, 平成, 昭和, 元号, 年号, 西暦, 和暦変換, 元年
- 使用関数: formatDateTime, int, if, equals, greaterOrEquals, concat, string, sub
- 根拠: https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference
- 書式の根拠: https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings
- タイムゾーン名の根拠: https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-time-zones（このページ自体は未確認。`Tokyo Standard Time` は E00 のケースで動作確認する）
- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。
- 検証状況: **実機検証済み**（2026-10-07 Power Automate 英語表示・既定環境。全ケースが期待どおり。詳細は VERIFIED_RESULTS.md）

## 用途

日本時間の日時（`Compose_JST`）を「令和8年10月7日」の形式にします。令和元年（2019/5/1）〜昭和元年（1926/12/25）に対応し、元年は「元」と表示します。
**和暦を直接出力する書式（ロケール指定）には頼りません。** `formatDateTime` のロケールで和暦が出せるかはリファレンスに記載がなく、環境で結果が変わる恐れがあるため、元号の境目の日付を `if` で判定して西暦から換算しています。

## 式（貼り付け用）

Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。

### 式（貼り付け用・1行）

```text
if(greaterOrEquals(int(formatDateTime(outputs('Compose_JST'),'yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime(outputs('Compose_JST'),'yyyy')),2019),'元',string(sub(int(formatDateTime(outputs('Compose_JST'),'yyyy')),2018))),'年',formatDateTime(outputs('Compose_JST'),'M月d日')),if(greaterOrEquals(int(formatDateTime(outputs('Compose_JST'),'yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1989),'元',string(sub(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1988))),'年',formatDateTime(outputs('Compose_JST'),'M月d日')),if(greaterOrEquals(int(formatDateTime(outputs('Compose_JST'),'yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1926),'元',string(sub(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1925))),'年',formatDateTime(outputs('Compose_JST'),'M月d日')),'昭和より前は未対応')))
```

### 読みやすい版（参考。内容は同じ）

```text
if(greaterOrEquals(int(formatDateTime(outputs('Compose_JST'),'yyyyMMdd')),20190501),
  concat('令和',
    if(equals(int(formatDateTime(outputs('Compose_JST'),'yyyy')),2019),'元',string(sub(int(formatDateTime(outputs('Compose_JST'),'yyyy')),2018))),
    '年',formatDateTime(outputs('Compose_JST'),'M月d日')),
  if(greaterOrEquals(int(formatDateTime(outputs('Compose_JST'),'yyyyMMdd')),19890108),
    concat('平成',
      if(equals(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1989),'元',string(sub(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1988))),
      '年',formatDateTime(outputs('Compose_JST'),'M月d日')),
    if(greaterOrEquals(int(formatDateTime(outputs('Compose_JST'),'yyyyMMdd')),19261225),
      concat('昭和',
        if(equals(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1926),'元',string(sub(int(formatDateTime(outputs('Compose_JST'),'yyyy')),1925))),
        '年',formatDateTime(outputs('Compose_JST'),'M月d日')),
      '昭和より前は未対応')))
```

## 入力の想定

`outputs('Compose_JST')`（日本時間の日時文字列。00_now_jst.md を先頭に置く）。別の日付を和暦にしたいときは、`outputs('Compose_JST')` の部分をその日付を表す式に置き換えます。**その日付が UTC（末尾が Z）の場合は、先に `convertTimeZone` で日本時間にしてください。**

## 出力例

| 日付 | 出力 |
| --- | --- |
| 2026-10-07 | `令和8年10月7日` |
| 2019-05-01 | `令和元年5月1日` |
| 2019-04-30 | `平成31年4月30日` |
| 1989-01-08 | `平成元年1月8日` |
| 1989-01-07 | `昭和64年1月7日` |

## よくある誤り

- 西暦から 2018 を引くだけにする（平成・昭和や、令和元年の「元」表示に対応できない）。
- 元号の切り替わりを「年」だけで判定する（2019年は4月まで平成、5月から令和）。この式は `yyyyMMdd` の数値で判定しています。
- `formatDateTime(…, 'ggyy年', 'ja-JP')` のような書式に頼る（和暦が出る保証がリファレンスにない。出ても環境差の恐れ）。
- `formatDateTime(…, 'M月d日')` の `月`・`日` は書式文字ではないのでそのまま出力される。書式の文字列が1文字だけだと標準書式になるため、`'M'` のような1文字書式は使わない。
- 昭和より前の日付は対応していません（「昭和より前は未対応」と出力）。

## 検証（Compose）

手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。

- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**
- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。

### E02_1 令和の通常の日付（2026-10-07）

- 期待出力: `令和8年10月7日`

```text
if(greaterOrEquals(int(formatDateTime('2026-10-07T09:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('2026-10-07T09:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('2026-10-07T09:00:00','yyyy')),2018))),'年',formatDateTime('2026-10-07T09:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('2026-10-07T09:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('2026-10-07T09:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('2026-10-07T09:00:00','yyyy')),1988))),'年',formatDateTime('2026-10-07T09:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('2026-10-07T09:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('2026-10-07T09:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('2026-10-07T09:00:00','yyyy')),1925))),'年',formatDateTime('2026-10-07T09:00:00','M月d日')),'昭和より前は未対応')))
```

### E02_2 令和元年の初日（2019-05-01）

- 期待出力: `令和元年5月1日`

```text
if(greaterOrEquals(int(formatDateTime('2019-05-01T00:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('2019-05-01T00:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('2019-05-01T00:00:00','yyyy')),2018))),'年',formatDateTime('2019-05-01T00:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('2019-05-01T00:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('2019-05-01T00:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('2019-05-01T00:00:00','yyyy')),1988))),'年',formatDateTime('2019-05-01T00:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('2019-05-01T00:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('2019-05-01T00:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('2019-05-01T00:00:00','yyyy')),1925))),'年',formatDateTime('2019-05-01T00:00:00','M月d日')),'昭和より前は未対応')))
```

### E02_3 平成最終日（2019-04-30）

- 期待出力: `平成31年4月30日`

```text
if(greaterOrEquals(int(formatDateTime('2019-04-30T23:59:59','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('2019-04-30T23:59:59','yyyy')),2019),'元',string(sub(int(formatDateTime('2019-04-30T23:59:59','yyyy')),2018))),'年',formatDateTime('2019-04-30T23:59:59','M月d日')),if(greaterOrEquals(int(formatDateTime('2019-04-30T23:59:59','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('2019-04-30T23:59:59','yyyy')),1989),'元',string(sub(int(formatDateTime('2019-04-30T23:59:59','yyyy')),1988))),'年',formatDateTime('2019-04-30T23:59:59','M月d日')),if(greaterOrEquals(int(formatDateTime('2019-04-30T23:59:59','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('2019-04-30T23:59:59','yyyy')),1926),'元',string(sub(int(formatDateTime('2019-04-30T23:59:59','yyyy')),1925))),'年',formatDateTime('2019-04-30T23:59:59','M月d日')),'昭和より前は未対応')))
```

### E02_4 平成元年の初日（1989-01-08）

- 期待出力: `平成元年1月8日`

```text
if(greaterOrEquals(int(formatDateTime('1989-01-08T00:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('1989-01-08T00:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('1989-01-08T00:00:00','yyyy')),2018))),'年',formatDateTime('1989-01-08T00:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1989-01-08T00:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('1989-01-08T00:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('1989-01-08T00:00:00','yyyy')),1988))),'年',formatDateTime('1989-01-08T00:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1989-01-08T00:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('1989-01-08T00:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('1989-01-08T00:00:00','yyyy')),1925))),'年',formatDateTime('1989-01-08T00:00:00','M月d日')),'昭和より前は未対応')))
```

### E02_5 昭和64年（1989-01-07）

- 期待出力: `昭和64年1月7日`

```text
if(greaterOrEquals(int(formatDateTime('1989-01-07T12:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('1989-01-07T12:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('1989-01-07T12:00:00','yyyy')),2018))),'年',formatDateTime('1989-01-07T12:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1989-01-07T12:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('1989-01-07T12:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('1989-01-07T12:00:00','yyyy')),1988))),'年',formatDateTime('1989-01-07T12:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1989-01-07T12:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('1989-01-07T12:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('1989-01-07T12:00:00','yyyy')),1925))),'年',formatDateTime('1989-01-07T12:00:00','M月d日')),'昭和より前は未対応')))
```

### E02_6 昭和より前（未対応の確認）（1926-12-24）

- 期待出力: `昭和より前は未対応`

```text
if(greaterOrEquals(int(formatDateTime('1926-12-24T12:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('1926-12-24T12:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('1926-12-24T12:00:00','yyyy')),2018))),'年',formatDateTime('1926-12-24T12:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1926-12-24T12:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('1926-12-24T12:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('1926-12-24T12:00:00','yyyy')),1988))),'年',formatDateTime('1926-12-24T12:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1926-12-24T12:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('1926-12-24T12:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('1926-12-24T12:00:00','yyyy')),1925))),'年',formatDateTime('1926-12-24T12:00:00','M月d日')),'昭和より前は未対応')))
```
