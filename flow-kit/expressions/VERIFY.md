# 式の検証手順と結果記入表

このファイルは、`expressions/` の式を **テスト用フローの「作成（Compose）」アクション** で実機確認するための手順書です。
結果は下の「結果記入表」に記入して（またはそのまま写真・コピーで）知らせてください。

> **注意**: 画面のメニュー名・ボタン名（「作成」「式」タブなど）は環境や画面の更新で変わることがあります。サンプルJSONで裏付けていないため **要確認（サンプルなし）** として扱い、画面に表示される名前に読み替えてください。

## 検証の手順

1. Power Automate で、**手動でトリガーするクラウドフロー**（インスタント クラウド フロー）を新規作成します。名前は `式の検証` などとします。
2. 「新しいステップ」（＋）から **作成（Compose）** アクションを追加します。
3. Compose の **入力欄をクリック** し、表示される「動的なコンテンツ／式」の **「式」タブ（fx）** を開きます。
4. このファイルのケースの式（または各 md ファイルのケースの式）を **コピーして貼り付け**、「OK」（または「追加」）で確定します。
5. Compose の「…」メニュー →「名前の変更」で、名前を **ケースID（例：`E01_1`）** に変更します。※ 名前に使えるのは英数字・アンダースコアが無難です。
6. 2〜5 を繰り返し、ケースの数だけ Compose を並べます。**まず 1 ファイル分（例：E01）だけ作って流すのを推奨**します。
7. フローを保存し、「テスト」→「手動」→「フローの実行」で実行します。
8. 実行履歴で、各 Compose の **出力** を開き、期待出力と比べます。

### 結果の見方・注意

- 文字列の出力は実行履歴で `"2026/10/07"` のように **引用符付き** で表示されますが、値そのものには引用符は含まれません。
- 数値・true/false は引用符なしで表示されます（`3`、`true`）。
- 全角スペースは見分けにくいため、E10 のケースは文字数（`length`）でも判定できるようにしてあります。
- 1つの Compose が **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したものは **エラーメッセージの全文** を記録し、その Compose を削除して再実行してください。
- 「観察」ケースは、期待値が予想です。違っても失敗ではなく、**実際の出力を記録**してください。
- E00_3 のように「現在時刻」を使うケースは、期待値を固定できないため目視で確認します。
- 式の貼り付け時に「式が正しくありません」と表示された場合は、その旨と、画面に出たメッセージを記録してください。

## 結果記入表

「判定」には OK／NG／エラー（赤）／観察、「実際の出力」には表示された値を書いてください。

| ケースID | 内容 | 期待出力 | 実際の出力 | 判定 |
| --- | --- | --- | --- | --- |
| E00_1 | 【観察】固定のUTC時刻を日本時間へ変換（時刻部分の確認） | 2026-10-07T00:30:00.0000000 |  |  |
| E00_2 | 変換結果を日付時刻の書式にする | 2026/10/07 00:30 |  |  |
| E00_3 | 【観察】本番式の実行確認（現在時刻） | 実行した時刻の日本時間（目視で、手元の時計と一致すること） |  |  |
| E01_1 | 日本時間 23:59:59（同じ日） | 2026/10/06 |  |  |
| E01_2 | 日本時間 0:00:00（日付が変わる境目） | 2026/10/07 |  |  |
| E01_3 | 年またぎ（日本時間 2027/01/01） | 2027/01/01 |  |  |
| E01_5 | 派生式 yyyy年M月d日 | 2026年10月7日 |  |  |
| E01_4 | 【誤りの再現】変換せずに formatDateTime（日本時間では 10/07 なのに…） | 2026/10/06 |  |  |
| E02_1 | 令和の通常の日付（2026-10-07） | 令和8年10月7日 |  |  |
| E02_2 | 令和元年の初日（2019-05-01） | 令和元年5月1日 |  |  |
| E02_3 | 平成最終日（2019-04-30） | 平成31年4月30日 |  |  |
| E02_4 | 平成元年の初日（1989-01-08） | 平成元年1月8日 |  |  |
| E02_5 | 昭和64年（1989-01-07） | 昭和64年1月7日 |  |  |
| E02_6 | 昭和より前（未対応の確認）（1926-12-24） | 昭和より前は未対応 |  |  |
| E03_0 | 【前提確認】日曜の dayOfWeek は 0 | 0 |  |  |
| E03_1 | 水曜 → 木曜（2026-10-07） | 2026/10/08 |  |  |
| E03_2 | 金曜 → 翌週月曜（2026-10-09） | 2026/10/12 |  |  |
| E03_3 | 土曜 → 翌週月曜（2026-10-10） | 2026/10/12 |  |  |
| E03_4 | 日曜 → 翌日の月曜（2026-10-11） | 2026/10/12 |  |  |
| E03_5 | 月またぎ（金曜 → 8/3 月曜）（2026-07-31） | 2026/08/03 |  |  |
| E03_6 | 【観察】年またぎ。1/1 は祝日だが除外されない（仕様の確認）（2026-12-31） | 2027/01/01 |  |  |
| E04_1 | 31日の月の最終日（2026-01-31） | 2026/01/31 |  |  |
| E04_2 | 2月（平年）（2026-02-10） | 2026/02/28 |  |  |
| E04_3 | 2月（うるう年）（2028-02-10） | 2028/02/29 |  |  |
| E04_4 | 30日の月（2026-04-30） | 2026/04/30 |  |  |
| E04_5 | 年末の月（2026-12-05） | 2026/12/31 |  |  |
| E04_6 | 日だけ取り出す（うるう年の2月） | 29 |  |  |
| E04_7 | 【誤りの再現】月初に直さず addToTime で1か月足してから1日引く | 2026/02/27 |  |  |
| E05_1 | 日付をまたぐ（日本時間 10/07 0:30） | 20261007_0030 |  |  |
| E05_2 | 日本時間 23:05（3/31） | 20260331_2305 |  |  |
| E05_3 | 秒まで | 20260331_230509 |  |  |
| E05_4 | ファイル名の例（concat） | 申請一覧_20261007_0030.xlsx |  |  |
| E05_5 | 【誤りの再現】hh（12時間表記） | 20261006_0230 |  |  |
| E05_6 | 【誤りの再現】mm（分）を月に使う | 20263006 |  |  |
| E06_1 | 整数のシリアル値 | 2023/03/15 |  |  |
| E06_2 | 時刻を含む（小数）シリアル値 | 2023/03/15 |  |  |
| E06_3 | 文字列として渡された場合 | 2023/03/15 |  |  |
| E06_4 | 2026/10/07 のシリアル値 | 2026/10/07 |  |  |
| E06_5 | 2023/01/01 のシリアル値 | 2023/01/01 |  |  |
| E06_6 | 1900/03/01（この式が正しく使える最小の日付） | 1900/03/01 |  |  |
| E06_7 | 【範囲外の再現】シリアル値 1（Excel では 1900/01/01） | 1899/12/31 |  |  |
| E07_1 | 空文字 | true |  |  |
| E07_2 | 半角スペースのみ | true |  |  |
| E07_3 | 全角スペースのみ | true |  |  |
| E07_4 | 通常の文字 | false |  |  |
| E07_5 | 文字の 0（空欄ではない） | false |  |  |
| E07_6 | null（値なし） | true |  |  |
| E07_7 | 数値の 0（空欄ではない） | false |  |  |
| E07_8 | 【誤りの再現】empty だけだと半角スペースのみでも空欄にならない | false |  |  |
| E07_9 | 【観察】equals(null, '') の結果 | False（実機確認済み：null と空文字は区別される） |  |  |
| E08_1 | 配列の件数 | 3 |  |  |
| E08_2 | createArray で作った配列の件数 | 4 |  |  |
| E08_3 | 空の配列 | 0 |  |  |
| E08_4 | 値なし（null）でも安全に 0 にする | 0 |  |  |
| E08_5 | 文字列の length は文字数（日本語も1文字=1） | 3 |  |  |
| E08_6 | 件数が0かどうかの判定 | true |  |  |
| E08_7 | 【誤りの再現】null を length に直接渡す（実機で確認済み） | エラー：The template language function 'length' expects its parameter to be an array or a string. The provided value is of type 'Null'. |  |  |
| E09_1 | 文字列の途中に改行を入れる（出力が2行で表示される） | 1行目⏎2行目（2行で表示） |  |  |
| E09_2 | 上の改行が1文字であること（文字数で確認） | 3 |  |  |
| E09_3 | HTMLメール用：改行を <br> に置換 | 1行目<br>2行目 |  |  |
| E09_4 | CRLF（Windows形式の改行）も LF も <br> にする | A<br>B<br>C |  |  |
| E09_5 | 配列を <br> で連結（箇条書きを本文にする） | A<br>B<br>C |  |  |
| E09_6 | 【観察】\n と書いた場合（改行になるか） | 4（実機確認済み：\n は改行にならず、文字として残る） |  |  |
| E10_1 | 【前提確認】検証用の入力（全角スペース＋山田＋全角＋太郎＋全角＋半角）の文字数 | 8 |  |  |
| E10_2 | 【観察】標準の trim だけで両端の全角スペースが消えるか（文字数で確認） | 5（実機確認済み：全角・半角とも両端から除去された。除去前は 8 文字） |  |  |
| E10_3 | 式A（両端の全角・半角スペースを除去。途中の全角は半角に統一） | 山田 太郎 |  |  |
| E10_4 | 式A の結果の文字数 | 5 |  |  |
| E10_5 | 式B（途中も含めてスペースをすべて除去） | 山田太郎 |  |  |
| E10_6 | 式A：ノーブレークスペースの除去 | ABC |  |  |
| E10_7 | 式A：値なし（null） | （空文字） |  |  |
| E11_0 | 【前提確認】int('03') が 3 になるか（月の先頭ゼロ） | 3 |  |  |
| E11_1 | 3月31日（前年度）（2026-03-31） | 2025 |  |  |
| E11_2 | 4月1日（新年度の初日）（2026-04-01） | 2026 |  |  |
| E11_3 | 秋（2026-10-07） | 2026 |  |  |
| E11_4 | 翌年の1月（2027-01-15） | 2026 |  |  |
| E11_5 | 令和◯年度（令和2年度以降） | 令和8年度 |  |  |
| E12_1 | 10月末まで（2026-10-07 → 2026-10-31） | 24 |  |  |
| E12_2 | 同じ日（2026-10-07 → 2026-10-07） | 0 |  |  |
| E12_3 | 期限切れ（負の値）（2026-10-07 → 2026-10-01） | -6 |  |  |
| E12_4 | うるう年をまたぐ（2028-02-28 → 2028-03-01） | 2 |  |  |
| E12_5 | 時刻は無視して日付だけで数える（2026-10-07 → 2026-10-08） | 1 |  |  |

## ケース集（式の一覧）

各ファイルのケースと同じ内容です。コピーして Compose に貼り付けてください。

### E00 日本時間の現在日時（基準となる Compose_JST）（00_now_jst.md）

**E00_1** 【観察】固定のUTC時刻を日本時間へ変換（時刻部分の確認）  
期待: 2026-10-07T00:30:00.0000000

```text
convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time')
```

**E00_2** 変換結果を日付時刻の書式にする  
期待: 2026/10/07 00:30

```text
formatDateTime(convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time'), 'yyyy/MM/dd HH:mm')
```

**E00_3** 【観察】本番式の実行確認（現在時刻）  
期待: 実行した時刻の日本時間（目視で、手元の時計と一致すること）

```text
convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time')
```

### E01 日本時間の今日の日付（yyyy/MM/dd）（01_today_jst.md）

**E01_1** 日本時間 23:59:59（同じ日）  
期待: 2026/10/06

```text
convertTimeZone('2026-10-06T14:59:59Z', 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')
```

**E01_2** 日本時間 0:00:00（日付が変わる境目）  
期待: 2026/10/07

```text
convertTimeZone('2026-10-06T15:00:00Z', 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')
```

**E01_3** 年またぎ（日本時間 2027/01/01）  
期待: 2027/01/01

```text
convertTimeZone('2026-12-31T15:00:00Z', 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')
```

**E01_5** 派生式 yyyy年M月d日  
期待: 2026年10月7日

```text
convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyy年M月d日')
```

**E01_4** 【誤りの再現】変換せずに formatDateTime（日本時間では 10/07 なのに…）  
期待: 2026/10/06

```text
formatDateTime('2026-10-06T15:30:00Z', 'yyyy/MM/dd')
```

### E02 和暦表示（令和・平成・昭和）（02_wareki.md）

**E02_1** 令和の通常の日付（2026-10-07）  
期待: 令和8年10月7日

```text
if(greaterOrEquals(int(formatDateTime('2026-10-07T09:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('2026-10-07T09:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('2026-10-07T09:00:00','yyyy')),2018))),'年',formatDateTime('2026-10-07T09:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('2026-10-07T09:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('2026-10-07T09:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('2026-10-07T09:00:00','yyyy')),1988))),'年',formatDateTime('2026-10-07T09:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('2026-10-07T09:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('2026-10-07T09:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('2026-10-07T09:00:00','yyyy')),1925))),'年',formatDateTime('2026-10-07T09:00:00','M月d日')),'昭和より前は未対応')))
```

**E02_2** 令和元年の初日（2019-05-01）  
期待: 令和元年5月1日

```text
if(greaterOrEquals(int(formatDateTime('2019-05-01T00:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('2019-05-01T00:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('2019-05-01T00:00:00','yyyy')),2018))),'年',formatDateTime('2019-05-01T00:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('2019-05-01T00:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('2019-05-01T00:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('2019-05-01T00:00:00','yyyy')),1988))),'年',formatDateTime('2019-05-01T00:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('2019-05-01T00:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('2019-05-01T00:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('2019-05-01T00:00:00','yyyy')),1925))),'年',formatDateTime('2019-05-01T00:00:00','M月d日')),'昭和より前は未対応')))
```

**E02_3** 平成最終日（2019-04-30）  
期待: 平成31年4月30日

```text
if(greaterOrEquals(int(formatDateTime('2019-04-30T23:59:59','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('2019-04-30T23:59:59','yyyy')),2019),'元',string(sub(int(formatDateTime('2019-04-30T23:59:59','yyyy')),2018))),'年',formatDateTime('2019-04-30T23:59:59','M月d日')),if(greaterOrEquals(int(formatDateTime('2019-04-30T23:59:59','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('2019-04-30T23:59:59','yyyy')),1989),'元',string(sub(int(formatDateTime('2019-04-30T23:59:59','yyyy')),1988))),'年',formatDateTime('2019-04-30T23:59:59','M月d日')),if(greaterOrEquals(int(formatDateTime('2019-04-30T23:59:59','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('2019-04-30T23:59:59','yyyy')),1926),'元',string(sub(int(formatDateTime('2019-04-30T23:59:59','yyyy')),1925))),'年',formatDateTime('2019-04-30T23:59:59','M月d日')),'昭和より前は未対応')))
```

**E02_4** 平成元年の初日（1989-01-08）  
期待: 平成元年1月8日

```text
if(greaterOrEquals(int(formatDateTime('1989-01-08T00:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('1989-01-08T00:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('1989-01-08T00:00:00','yyyy')),2018))),'年',formatDateTime('1989-01-08T00:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1989-01-08T00:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('1989-01-08T00:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('1989-01-08T00:00:00','yyyy')),1988))),'年',formatDateTime('1989-01-08T00:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1989-01-08T00:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('1989-01-08T00:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('1989-01-08T00:00:00','yyyy')),1925))),'年',formatDateTime('1989-01-08T00:00:00','M月d日')),'昭和より前は未対応')))
```

**E02_5** 昭和64年（1989-01-07）  
期待: 昭和64年1月7日

```text
if(greaterOrEquals(int(formatDateTime('1989-01-07T12:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('1989-01-07T12:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('1989-01-07T12:00:00','yyyy')),2018))),'年',formatDateTime('1989-01-07T12:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1989-01-07T12:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('1989-01-07T12:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('1989-01-07T12:00:00','yyyy')),1988))),'年',formatDateTime('1989-01-07T12:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1989-01-07T12:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('1989-01-07T12:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('1989-01-07T12:00:00','yyyy')),1925))),'年',formatDateTime('1989-01-07T12:00:00','M月d日')),'昭和より前は未対応')))
```

**E02_6** 昭和より前（未対応の確認）（1926-12-24）  
期待: 昭和より前は未対応

```text
if(greaterOrEquals(int(formatDateTime('1926-12-24T12:00:00','yyyyMMdd')),20190501),concat('令和',if(equals(int(formatDateTime('1926-12-24T12:00:00','yyyy')),2019),'元',string(sub(int(formatDateTime('1926-12-24T12:00:00','yyyy')),2018))),'年',formatDateTime('1926-12-24T12:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1926-12-24T12:00:00','yyyyMMdd')),19890108),concat('平成',if(equals(int(formatDateTime('1926-12-24T12:00:00','yyyy')),1989),'元',string(sub(int(formatDateTime('1926-12-24T12:00:00','yyyy')),1988))),'年',formatDateTime('1926-12-24T12:00:00','M月d日')),if(greaterOrEquals(int(formatDateTime('1926-12-24T12:00:00','yyyyMMdd')),19261225),concat('昭和',if(equals(int(formatDateTime('1926-12-24T12:00:00','yyyy')),1926),'元',string(sub(int(formatDateTime('1926-12-24T12:00:00','yyyy')),1925))),'年',formatDateTime('1926-12-24T12:00:00','M月d日')),'昭和より前は未対応')))
```

### E03 翌営業日（土日除外）（03_next_business_day.md）

**E03_0** 【前提確認】日曜の dayOfWeek は 0  
期待: 0

```text
dayOfWeek('2026-10-11T10:00:00')
```

**E03_1** 水曜 → 木曜（2026-10-07）  
期待: 2026/10/08

```text
addDays('2026-10-07T10:00:00',if(equals(dayOfWeek('2026-10-07T10:00:00'),5),3,if(equals(dayOfWeek('2026-10-07T10:00:00'),6),2,1)),'yyyy/MM/dd')
```

**E03_2** 金曜 → 翌週月曜（2026-10-09）  
期待: 2026/10/12

```text
addDays('2026-10-09T10:00:00',if(equals(dayOfWeek('2026-10-09T10:00:00'),5),3,if(equals(dayOfWeek('2026-10-09T10:00:00'),6),2,1)),'yyyy/MM/dd')
```

**E03_3** 土曜 → 翌週月曜（2026-10-10）  
期待: 2026/10/12

```text
addDays('2026-10-10T10:00:00',if(equals(dayOfWeek('2026-10-10T10:00:00'),5),3,if(equals(dayOfWeek('2026-10-10T10:00:00'),6),2,1)),'yyyy/MM/dd')
```

**E03_4** 日曜 → 翌日の月曜（2026-10-11）  
期待: 2026/10/12

```text
addDays('2026-10-11T10:00:00',if(equals(dayOfWeek('2026-10-11T10:00:00'),5),3,if(equals(dayOfWeek('2026-10-11T10:00:00'),6),2,1)),'yyyy/MM/dd')
```

**E03_5** 月またぎ（金曜 → 8/3 月曜）（2026-07-31）  
期待: 2026/08/03

```text
addDays('2026-07-31T10:00:00',if(equals(dayOfWeek('2026-07-31T10:00:00'),5),3,if(equals(dayOfWeek('2026-07-31T10:00:00'),6),2,1)),'yyyy/MM/dd')
```

**E03_6** 【観察】年またぎ。1/1 は祝日だが除外されない（仕様の確認）（2026-12-31）  
期待: 2027/01/01

```text
addDays('2026-12-31T10:00:00',if(equals(dayOfWeek('2026-12-31T10:00:00'),5),3,if(equals(dayOfWeek('2026-12-31T10:00:00'),6),2,1)),'yyyy/MM/dd')
```

### E04 月末日（04_end_of_month.md）

**E04_1** 31日の月の最終日（2026-01-31）  
期待: 2026/01/31

```text
addDays(addToTime(startOfMonth('2026-01-31T10:00:00'),1,'Month'),-1,'yyyy/MM/dd')
```

**E04_2** 2月（平年）（2026-02-10）  
期待: 2026/02/28

```text
addDays(addToTime(startOfMonth('2026-02-10T10:00:00'),1,'Month'),-1,'yyyy/MM/dd')
```

**E04_3** 2月（うるう年）（2028-02-10）  
期待: 2028/02/29

```text
addDays(addToTime(startOfMonth('2028-02-10T10:00:00'),1,'Month'),-1,'yyyy/MM/dd')
```

**E04_4** 30日の月（2026-04-30）  
期待: 2026/04/30

```text
addDays(addToTime(startOfMonth('2026-04-30T23:30:00'),1,'Month'),-1,'yyyy/MM/dd')
```

**E04_5** 年末の月（2026-12-05）  
期待: 2026/12/31

```text
addDays(addToTime(startOfMonth('2026-12-05T10:00:00'),1,'Month'),-1,'yyyy/MM/dd')
```

**E04_6** 日だけ取り出す（うるう年の2月）  
期待: 29

```text
dayOfMonth(addDays(addToTime(startOfMonth('2028-02-10T10:00:00'),1,'Month'),-1))
```

**E04_7** 【誤りの再現】月初に直さず addToTime で1か月足してから1日引く  
期待: 2026/02/27

```text
addDays(addToTime('2026-01-31T10:00:00',1,'Month'),-1,'yyyy/MM/dd')
```

### E05 ファイル名に付ける日時（yyyyMMdd_HHmm）（05_filename_timestamp.md）

**E05_1** 日付をまたぐ（日本時間 10/07 0:30）  
期待: 20261007_0030

```text
convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm')
```

**E05_2** 日本時間 23:05（3/31）  
期待: 20260331_2305

```text
convertTimeZone('2026-03-31T14:05:09Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm')
```

**E05_3** 秒まで  
期待: 20260331_230509

```text
convertTimeZone('2026-03-31T14:05:09Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmmss')
```

**E05_4** ファイル名の例（concat）  
期待: 申請一覧_20261007_0030.xlsx

```text
concat('申請一覧_', convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm'), '.xlsx')
```

**E05_5** 【誤りの再現】hh（12時間表記）  
期待: 20261006_0230

```text
convertTimeZone('2026-10-06T05:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_hhmm')
```

**E05_6** 【誤りの再現】mm（分）を月に使う  
期待: 20263006

```text
convertTimeZone('2026-10-06T05:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyymmdd')
```

### E06 Excelのシリアル値 → 日付（06_excel_serial_to_date.md）

**E06_1** 整数のシリアル値  
期待: 2023/03/15

```text
addDays('1899-12-30',int(first(split(string(45000),'.'))),'yyyy/MM/dd')
```

**E06_2** 時刻を含む（小数）シリアル値  
期待: 2023/03/15

```text
addDays('1899-12-30',int(first(split(string(45000.5),'.'))),'yyyy/MM/dd')
```

**E06_3** 文字列として渡された場合  
期待: 2023/03/15

```text
addDays('1899-12-30',int(first(split(string('45000'),'.'))),'yyyy/MM/dd')
```

**E06_4** 2026/10/07 のシリアル値  
期待: 2026/10/07

```text
addDays('1899-12-30',int(first(split(string(46302),'.'))),'yyyy/MM/dd')
```

**E06_5** 2023/01/01 のシリアル値  
期待: 2023/01/01

```text
addDays('1899-12-30',int(first(split(string(44927),'.'))),'yyyy/MM/dd')
```

**E06_6** 1900/03/01（この式が正しく使える最小の日付）  
期待: 1900/03/01

```text
addDays('1899-12-30',int(first(split(string(61),'.'))),'yyyy/MM/dd')
```

**E06_7** 【範囲外の再現】シリアル値 1（Excel では 1900/01/01）  
期待: 1899/12/31

```text
addDays('1899-12-30',int(first(split(string(1),'.'))),'yyyy/MM/dd')
```

### E07 空欄判定（null・空文字・半角/全角スペースのみ）（07_is_blank.md）

**E07_1** 空文字  
期待: true

```text
empty(trim(replace(replace(string(''),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

**E07_2** 半角スペースのみ  
期待: true

```text
empty(trim(replace(replace(string(' '),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

**E07_3** 全角スペースのみ  
期待: true

```text
empty(trim(replace(replace(string(decodeUriComponent('%E3%80%80')),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

**E07_4** 通常の文字  
期待: false

```text
empty(trim(replace(replace(string('abc'),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

**E07_5** 文字の 0（空欄ではない）  
期待: false

```text
empty(trim(replace(replace(string('0'),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

**E07_6** null（値なし）  
期待: true

```text
empty(trim(replace(replace(string(null),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

**E07_7** 数値の 0（空欄ではない）  
期待: false

```text
empty(trim(replace(replace(string(0),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

**E07_8** 【誤りの再現】empty だけだと半角スペースのみでも空欄にならない  
期待: false

```text
empty(' ')
```

**E07_9** 【観察】equals(null, '') の結果  
期待: False（実機確認済み：null と空文字は区別される）

```text
equals(null, '')
```

### E08 配列の件数（08_array_count.md）

**E08_1** 配列の件数  
期待: 3

```text
length(json('[1,2,3]'))
```

**E08_2** createArray で作った配列の件数  
期待: 4

```text
length(createArray('a','b','c','d'))
```

**E08_3** 空の配列  
期待: 0

```text
length(json('[]'))
```

**E08_4** 値なし（null）でも安全に 0 にする  
期待: 0

```text
length(coalesce(null, json('[]')))
```

**E08_5** 文字列の length は文字数（日本語も1文字=1）  
期待: 3

```text
length('あいう')
```

**E08_6** 件数が0かどうかの判定  
期待: true

```text
equals(length(json('[]')), 0)
```

**E08_7** 【誤りの再現】null を length に直接渡す（実機で確認済み）  
期待: エラー：The template language function 'length' expects its parameter to be an array or a string. The provided value is of type 'Null'.

```text
length(null)
```

### E09 メール本文用の改行（09_mail_newline.md）

**E09_1** 文字列の途中に改行を入れる（出力が2行で表示される）  
期待: 1行目⏎2行目（2行で表示）

```text
concat('1行目', decodeUriComponent('%0A'), '2行目')
```

**E09_2** 上の改行が1文字であること（文字数で確認）  
期待: 3

```text
length(concat('A', decodeUriComponent('%0A'), 'B'))
```

**E09_3** HTMLメール用：改行を <br> に置換  
期待: 1行目<br>2行目

```text
replace(concat('1行目', decodeUriComponent('%0A'), '2行目'), decodeUriComponent('%0A'), '<br>')
```

**E09_4** CRLF（Windows形式の改行）も LF も <br> にする  
期待: A<br>B<br>C

```text
replace(replace(concat('A', decodeUriComponent('%0D%0A'), 'B', decodeUriComponent('%0A'), 'C'), decodeUriComponent('%0D%0A'), '<br>'), decodeUriComponent('%0A'), '<br>')
```

**E09_5** 配列を <br> で連結（箇条書きを本文にする）  
期待: A<br>B<br>C

```text
join(createArray('A','B','C'), '<br>')
```

**E09_6** 【観察】\n と書いた場合（改行になるか）  
期待: 4（実機確認済み：\n は改行にならず、文字として残る）

```text
length(concat('A','\n','B'))
```

### E10 全角スペースを含む前後空白の除去（10_trim_zenkaku.md）

**E10_1** 【前提確認】検証用の入力（全角スペース＋山田＋全角＋太郎＋全角＋半角）の文字数  
期待: 8

```text
length(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' '))
```

**E10_2** 【観察】標準の trim だけで両端の全角スペースが消えるか（文字数で確認）  
期待: 5（実機確認済み：全角・半角とも両端から除去された。除去前は 8 文字）

```text
length(trim(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' ')))
```

**E10_3** 式A（両端の全角・半角スペースを除去。途中の全角は半角に統一）  
期待: 山田 太郎

```text
trim(replace(replace(string(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' ')),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' '))
```

**E10_4** 式A の結果の文字数  
期待: 5

```text
length(trim(replace(replace(string(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' ')),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' ')))
```

**E10_5** 式B（途中も含めてスペースをすべて除去）  
期待: 山田太郎

```text
replace(replace(replace(string(concat(decodeUriComponent('%E3%80%80'),'山田',decodeUriComponent('%E3%80%80'),'太郎',decodeUriComponent('%E3%80%80'),' ')),decodeUriComponent('%E3%80%80'),''),decodeUriComponent('%C2%A0'),''),' ','')
```

**E10_6** 式A：ノーブレークスペースの除去  
期待: ABC

```text
trim(replace(replace(string(concat(decodeUriComponent('%C2%A0'),'ABC',decodeUriComponent('%C2%A0'))),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' '))
```

**E10_7** 式A：値なし（null）  
期待: （空文字）

```text
trim(replace(replace(string(null),decodeUriComponent('%E3%80%80'),' '),decodeUriComponent('%C2%A0'),' '))
```

### E11 年度（4月始まり）（11_fiscal_year.md）

**E11_0** 【前提確認】int('03') が 3 になるか（月の先頭ゼロ）  
期待: 3

```text
int('03')
```

**E11_1** 3月31日（前年度）（2026-03-31）  
期待: 2025

```text
if(greaterOrEquals(int(formatDateTime('2026-03-31T10:00:00','MM')),4),int(formatDateTime('2026-03-31T10:00:00','yyyy')),sub(int(formatDateTime('2026-03-31T10:00:00','yyyy')),1))
```

**E11_2** 4月1日（新年度の初日）（2026-04-01）  
期待: 2026

```text
if(greaterOrEquals(int(formatDateTime('2026-04-01T00:00:00','MM')),4),int(formatDateTime('2026-04-01T00:00:00','yyyy')),sub(int(formatDateTime('2026-04-01T00:00:00','yyyy')),1))
```

**E11_3** 秋（2026-10-07）  
期待: 2026

```text
if(greaterOrEquals(int(formatDateTime('2026-10-07T10:00:00','MM')),4),int(formatDateTime('2026-10-07T10:00:00','yyyy')),sub(int(formatDateTime('2026-10-07T10:00:00','yyyy')),1))
```

**E11_4** 翌年の1月（2027-01-15）  
期待: 2026

```text
if(greaterOrEquals(int(formatDateTime('2027-01-15T10:00:00','MM')),4),int(formatDateTime('2027-01-15T10:00:00','yyyy')),sub(int(formatDateTime('2027-01-15T10:00:00','yyyy')),1))
```

**E11_5** 令和◯年度（令和2年度以降）  
期待: 令和8年度

```text
concat('令和', string(sub(2026, 2018)), '年度')
```

### E12 日付の差（日数）（12_days_between.md）

**E12_1** 10月末まで（2026-10-07 → 2026-10-31）  
期待: 24

```text
div(sub(ticks(startOfDay('2026-10-31')),ticks(startOfDay('2026-10-07T10:00:00'))),864000000000)
```

**E12_2** 同じ日（2026-10-07 → 2026-10-07）  
期待: 0

```text
div(sub(ticks(startOfDay('2026-10-07')),ticks(startOfDay('2026-10-07T10:00:00'))),864000000000)
```

**E12_3** 期限切れ（負の値）（2026-10-07 → 2026-10-01）  
期待: -6

```text
div(sub(ticks(startOfDay('2026-10-01')),ticks(startOfDay('2026-10-07T10:00:00'))),864000000000)
```

**E12_4** うるう年をまたぐ（2028-02-28 → 2028-03-01）  
期待: 2

```text
div(sub(ticks(startOfDay('2028-03-01')),ticks(startOfDay('2028-02-28T23:30:00'))),864000000000)
```

**E12_5** 時刻は無視して日付だけで数える（2026-10-07 → 2026-10-08）  
期待: 1

```text
div(sub(ticks(startOfDay('2026-10-08T00:00:00')),ticks(startOfDay('2026-10-07T23:59:59'))),864000000000)
```
