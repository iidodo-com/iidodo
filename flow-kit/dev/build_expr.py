# -*- coding: utf-8 -*-
# 式ライブラリ（expressions/*.md）と VERIFY.md を生成する。期待値は Python で別計算している（実機の結果ではない）。
# 使い方: python3 dev/build_expr.py   （標準ライブラリのみ。式の追加・修正は、まずこのファイルを直してから再生成する）
import os, re
from datetime import date, datetime, timedelta

import os as _os
ROOT = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))   # flow-kit/
OUT = _os.path.join(ROOT, 'expressions')
REF = 'https://learn.microsoft.com/en-us/azure/logic-apps/workflow-definition-language-functions-reference'
REF_FMT = 'https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-date-and-time-format-strings'
REF_TZ = 'https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/default-time-zones'
T_PROD = "outputs('Compose_JST')"
U3000 = "decodeUriComponent('%E3%80%80')"
NBSP = "decodeUriComponent('%C2%A0')"
LF = "decodeUriComponent('%0A')"
CRLF = "decodeUriComponent('%0D%0A')"


def one_line(s):
    return ''.join(l.strip() for l in s.strip().splitlines())


def jst(utc_str):
    d = datetime.strptime(utc_str.rstrip('Z'), '%Y-%m-%dT%H:%M:%S') + timedelta(hours=9)
    return d


def lit(ts):
    return "'" + ts + "'"


def wareki_tpl():
    return """
if(greaterOrEquals(int(formatDateTime({T},'yyyyMMdd')),20190501),
  concat('令和',
    if(equals(int(formatDateTime({T},'yyyy')),2019),'元',string(sub(int(formatDateTime({T},'yyyy')),2018))),
    '年',formatDateTime({T},'M月d日')),
  if(greaterOrEquals(int(formatDateTime({T},'yyyyMMdd')),19890108),
    concat('平成',
      if(equals(int(formatDateTime({T},'yyyy')),1989),'元',string(sub(int(formatDateTime({T},'yyyy')),1988))),
      '年',formatDateTime({T},'M月d日')),
    if(greaterOrEquals(int(formatDateTime({T},'yyyyMMdd')),19261225),
      concat('昭和',
        if(equals(int(formatDateTime({T},'yyyy')),1926),'元',string(sub(int(formatDateTime({T},'yyyy')),1925))),
        '年',formatDateTime({T},'M月d日')),
      '昭和より前は未対応')))
"""


def wareki_py(d):
    n = d.year * 10000 + d.month * 100 + d.day
    md = '%d月%d日' % (d.month, d.day)
    def era(name, base, first):
        y = '元' if d.year == first else str(d.year - base)
        return name + y + '年' + md
    if n >= 20190501: return era('令和', 2018, 2019)
    if n >= 19890108: return era('平成', 1988, 1989)
    if n >= 19261225: return era('昭和', 1925, 1926)
    return '昭和より前は未対応'


def nbd_tpl():
    return "addDays({T},if(equals(dayOfWeek({T}),5),3,if(equals(dayOfWeek({T}),6),2,1)),'yyyy/MM/dd')"


def nbd_py(d):
    w = (d.weekday() + 1) % 7  # 日曜=0
    k = 3 if w == 5 else 2 if w == 6 else 1
    return (d + timedelta(days=k)).strftime('%Y/%m/%d')


def eom_tpl():
    return "addDays(addToTime(startOfMonth({T}),1,'Month'),-1,'yyyy/MM/dd')"


def eom_py(d):
    nm = (d.replace(day=1) + timedelta(days=32)).replace(day=1)
    return (nm - timedelta(days=1))


def fy_tpl():
    return "if(greaterOrEquals(int(formatDateTime({T},'MM')),4),int(formatDateTime({T},'yyyy')),sub(int(formatDateTime({T},'yyyy')),1))"


def fy_py(d):
    return d.year if d.month >= 4 else d.year - 1


def days_tpl():
    return "div(sub(ticks(startOfDay({B})),ticks(startOfDay({A}))),864000000000)"


def case(cid, label, expr, expected, observe=False, note=''):
    return dict(id=cid, label=label, expr=expr, expected=expected, observe=observe, note=note)


E = []

# ---------- E00 ----------
E.append(dict(
    file='00_now_jst.md', id='E00', title='日本時間の現在日時（基準となる Compose_JST）',
    kw='現在, 現在日時, 今, いま, 日本時間, JST, 基準, タイムゾーン, 時刻, 日時, utcNow, UTC',
    funcs='utcNow, convertTimeZone, formatDateTime',
    purpose='''utcNow() は **UTC（協定世界時）** を返します。日本時間（JST = UTC+9）が必要なときは、必ず `convertTimeZone` で `'Tokyo Standard Time'` に変換します。
このファイルの式を **フローの先頭に置く「作成（Compose）」アクションの名前を `Compose_JST` として貼り付け**、以降の式（翌営業日・月末日・和暦・年度など）は `outputs('Compose_JST')` を参照する運用を推奨します。
理由：式の中で `utcNow()` を何度も呼ぶと、0時をまたぐ瞬間に呼び出しごとの日付がずれることがあるため、現在時刻は一度だけ取得します。''',
    expr_blocks=[('式（Compose_JST に貼る）', "convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time')")],
    inputs='入力なし（実行時の現在時刻を使う）。',
    outputs_ex='''実行時刻が日本時間 2026年10月7日 00:30 のとき：

```text
2026-10-07T00:30:12.3456789
```

- 末尾に `Z` や `+09:00` は **付きません**（2026-10-07 実機で確認。ケース E00_1 の出力は `2026-10-07T00:30:00.0000000`）。リファレンスにも「結果にタイムゾーンのオフセットが含まれない場合がある」と記載されています。''',
    mistakes=[
        '`utcNow()` をそのまま日付表示・比較に使う（日本時間と最大9時間ずれる。特に日本時間 0:00〜8:59 は前日の日付になる）。',
        'タイムゾーン名を `JST` や `Asia/Tokyo` と書く。指定できるのは Windows のタイムゾーン名で、日本は `Tokyo Standard Time`（リファレンスは Microsoft Windows Default Time Zones の名前を使うと記載）。',
        '`Compose_JST` の結果（すでに日本時間）を、もう一度 `convertTimeZone(…, \'UTC\', \'Tokyo Standard Time\')` に通す（二重に +9 時間される）。',
        '式の途中で `utcNow()` を複数回呼ぶ（0時をまたぐと日付が食い違う）。',
        '変換結果にはオフセットが付かないため、末尾が `Z` 付きの値（SharePoint や Outlook が返す UTC 値）と直接比較しない。比較するときは両方を同じ基準（日本時間）に揃える。',
    ],
    cases=[
        case('E00_1', '固定のUTC時刻を日本時間へ変換（時刻部分の確認）', "convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time')", '2026-10-07T00:30:00.0000000', True, '末尾に Z／オフセットが付くかどうかを確認'),
        case('E00_2', '変換結果を日付時刻の書式にする', "formatDateTime(convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time'), 'yyyy/MM/dd HH:mm')", '2026/10/07 00:30'),
        case('E00_3', '本番式の実行確認（現在時刻）', "convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time')", '実行した時刻の日本時間（目視で、手元の時計と一致すること）', True, '期待値は固定できないため目視確認'),
    ],
))

# ---------- E01 ----------
def c01(cid, u, label, obs=False):
    d = jst(u)
    return case(cid, label, "convertTimeZone('%s', 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')" % u, d.strftime('%Y/%m/%d'), obs)

E.append(dict(
    file='01_today_jst.md', id='E01', title='日本時間の今日の日付（yyyy/MM/dd）',
    kw='今日, 本日, 日付, 年月日, yyyy/MM/dd, 日本時間, 現在日, 当日, 日付表示',
    funcs='convertTimeZone, utcNow, formatDateTime',
    purpose='日本時間の「今日の日付」を `2026/10/07` の形式で取り出します。メール本文・ファイルの項目・SharePoint の文字列列などに入れる用途です。',
    expr_blocks=[
        ('式（貼り付け用・yyyy/MM/dd）', "convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyy/MM/dd')"),
        ('派生式（ハイフン区切り yyyy-MM-dd）', "convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyy-MM-dd')"),
        ('派生式（2026年10月7日 のように月日のゼロを付けない）', "convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyy年M月d日')"),
        ('Compose_JST を使う場合（00_now_jst.md 参照）', "formatDateTime(outputs('Compose_JST'), 'yyyy/MM/dd')"),
    ],
    inputs='入力なし。実行した瞬間の日時を使います。',
    outputs_ex='''日本時間 2026年10月7日 00:30 に実行した場合：

| 式 | 出力 |
| --- | --- |
| yyyy/MM/dd | `2026/10/07` |
| yyyy-MM-dd | `2026-10-07` |
| yyyy年M月d日 | `2026年10月7日` |''',
    mistakes=[
        '`formatDateTime(utcNow(), \'yyyy/MM/dd\')` と書く。UTC の日付になり、日本時間 0:00〜8:59 は **前日** が出ます（ケース E01_4 で再現）。',
        '書式を `yyyy/mm/dd` と小文字の `mm` にする。`mm` は「分」、`MM` が「月」です（例：2026/30/07 のようになる）。',
        "書式の文字列が **1文字だけ** の場合（例：`'d'` や `'M'`）は標準書式として解釈される（`'d'` は短い日付、`'M'` は月日）。1文字の書式を使いたいときは `'%d'` と書く。`yyyy年M月d日` のように2文字以上なら問題ない。",
        'Compose の出力は実行履歴で `"2026/10/07"` のように引用符付きで表示されるが、値は引用符を含まない。',
    ],
    cases=[
        c01('E01_1', '2026-10-06T14:59:59Z', '日本時間 23:59:59（同じ日）'),
        c01('E01_2', '2026-10-06T15:00:00Z', '日本時間 0:00:00（日付が変わる境目）'),
        c01('E01_3', '2026-12-31T15:00:00Z', '年またぎ（日本時間 2027/01/01）'),
        case('E01_5', '派生式 yyyy年M月d日', "convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyy年M月d日')", '2026年10月7日'),
        case('E01_4', '【誤りの再現】変換せずに formatDateTime（日本時間では 10/07 なのに…）', "formatDateTime('2026-10-06T15:30:00Z', 'yyyy/MM/dd')", '2026/10/06', True, '誤った式の結果。日本時間とずれることの確認用'),
    ],
))

# ---------- E02 ----------
wk = [('E02_1', '2026-10-07T09:00:00', '令和の通常の日付'),
      ('E02_2', '2019-05-01T00:00:00', '令和元年の初日'),
      ('E02_3', '2019-04-30T23:59:59', '平成最終日'),
      ('E02_4', '1989-01-08T00:00:00', '平成元年の初日'),
      ('E02_5', '1989-01-07T12:00:00', '昭和64年'),
      ('E02_6', '1926-12-24T12:00:00', '昭和より前（未対応の確認）')]
cs = []
for cid, ts, lb in wk:
    d = datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S')
    cs.append(case(cid, lb + '（' + ts[:10] + '）', one_line(wareki_tpl()).replace('{T}', lit(ts)), wareki_py(d)))
E.append(dict(
    file='02_wareki.md', id='E02', title='和暦表示（令和・平成・昭和）',
    kw='和暦, 令和, 平成, 昭和, 元号, 年号, 西暦, 和暦変換, 元年, 和暦で, 和暦表示, 和暦に',
    funcs='formatDateTime, int, if, equals, greaterOrEquals, concat, string, sub',
    purpose='''日本時間の日時（`Compose_JST`）を「令和8年10月7日」の形式にします。令和元年（2019/5/1）〜昭和元年（1926/12/25）に対応し、元年は「元」と表示します。
**和暦を直接出力する書式（ロケール指定）には頼りません。** `formatDateTime` のロケールで和暦が出せるかはリファレンスに記載がなく、環境で結果が変わる恐れがあるため、元号の境目の日付を `if` で判定して西暦から換算しています。''',
    expr_blocks=[
        ('式（貼り付け用・1行）', one_line(wareki_tpl()).replace('{T}', T_PROD)),
        ('読みやすい版（参考。内容は同じ）', wareki_tpl().strip().replace('{T}', T_PROD)),
    ],
    inputs="`outputs('Compose_JST')`（日本時間の日時文字列。00_now_jst.md を先頭に置く）。別の日付を和暦にしたいときは、`outputs('Compose_JST')` の部分をその日付を表す式に置き換えます。**その日付が UTC（末尾が Z）の場合は、先に `convertTimeZone` で日本時間にしてください。**",
    outputs_ex='''| 日付 | 出力 |
| --- | --- |
| 2026-10-07 | `令和8年10月7日` |
| 2019-05-01 | `令和元年5月1日` |
| 2019-04-30 | `平成31年4月30日` |
| 1989-01-08 | `平成元年1月8日` |
| 1989-01-07 | `昭和64年1月7日` |''',
    mistakes=[
        '西暦から 2018 を引くだけにする（平成・昭和や、令和元年の「元」表示に対応できない）。',
        '元号の切り替わりを「年」だけで判定する（2019年は4月まで平成、5月から令和）。この式は `yyyyMMdd` の数値で判定しています。',
        '`formatDateTime(…, \'ggyy年\', \'ja-JP\')` のような書式に頼る（和暦が出る保証がリファレンスにない。出ても環境差の恐れ）。',
        "`formatDateTime(…, 'M月d日')` の `月`・`日` は書式文字ではないのでそのまま出力される。書式の文字列が1文字だけだと標準書式になるため、`'M'` のような1文字書式は使わない。",
        '昭和より前の日付は対応していません（「昭和より前は未対応」と出力）。',
    ],
    cases=cs,
))

# ---------- E03 ----------
nb = [('E03_1', '2026-10-07T10:00:00', '水曜 → 木曜'),
      ('E03_2', '2026-10-09T10:00:00', '金曜 → 翌週月曜'),
      ('E03_3', '2026-10-10T10:00:00', '土曜 → 翌週月曜'),
      ('E03_4', '2026-10-11T10:00:00', '日曜 → 翌日の月曜'),
      ('E03_5', '2026-07-31T10:00:00', '月またぎ（金曜 → 8/3 月曜）'),
      ('E03_6', '2026-12-31T10:00:00', '年またぎ。1/1 は祝日だが除外されない（仕様の確認）')]
cs = [case('E03_0', '【前提確認】日曜の dayOfWeek は 0', "dayOfWeek('2026-10-11T10:00:00')", '0', True, '日曜=0, 月曜=1, …, 土曜=6 の前提確認')]
for cid, ts, lb in nb:
    d = datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S')
    cs.append(case(cid, lb + '（' + ts[:10] + '）', nbd_tpl().replace('{T}', lit(ts)), nbd_py(d), cid == 'E03_6'))
E.append(dict(
    file='03_next_business_day.md', id='E03', title='翌営業日（土日除外）',
    kw='翌営業日, 営業日, 土日, 土日除外, 平日, 次の平日, 翌平日, 期限, 締切',
    funcs='addDays, dayOfWeek, if, equals',
    purpose='''日本時間の今日を基準に、土曜・日曜を飛ばした翌営業日を `2026/10/09` の形式で求めます。
**祝日・年末年始・自治体の休日は除外しません。** 祝日まで除外するには祝日の一覧（SharePoint リスト等）との照合が必要で、その構成は「サンプルなし」のため後工程で扱います（要確認（サンプルなし））。''',
    expr_blocks=[('式（貼り付け用）', nbd_tpl().replace('{T}', T_PROD))],
    inputs="`outputs('Compose_JST')`（日本時間の日時。00_now_jst.md）。",
    outputs_ex='''| 基準日 | 曜日 | 出力 |
| --- | --- | --- |
| 2026-10-07 | 水 | `2026/10/08` |
| 2026-10-09 | 金 | `2026/10/12` |
| 2026-10-10 | 土 | `2026/10/12` |
| 2026-10-11 | 日 | `2026/10/12` |''',
    mistakes=[
        '`dayOfWeek` は **日曜が 0**、月曜が 1、土曜が 6（月曜が 0 だと誤解しやすい）。',
        'UTC のまま `dayOfWeek` を判定する（日本時間 0:00〜8:59 は曜日が1日ずれる）。',
        '金曜に +1 日だけして土曜になる（金曜は +3、土曜は +2）。',
        '祝日が除外されると思い込む（この式は土日のみ）。',
    ],
    cases=cs,
))

# ---------- E04 ----------
em = [('E04_1', '2026-01-31T10:00:00', '31日の月の最終日'),
      ('E04_2', '2026-02-10T10:00:00', '2月（平年）'),
      ('E04_3', '2028-02-10T10:00:00', '2月（うるう年）'),
      ('E04_4', '2026-04-30T23:30:00', '30日の月'),
      ('E04_5', '2026-12-05T10:00:00', '年末の月')]
cs = []
for cid, ts, lb in em:
    d = datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S')
    cs.append(case(cid, lb + '（' + ts[:10] + '）', eom_tpl().replace('{T}', lit(ts)), eom_py(d).strftime('%Y/%m/%d')))
cs.append(case('E04_6', '日だけ取り出す（うるう年の2月）', "dayOfMonth(addDays(addToTime(startOfMonth('2028-02-10T10:00:00'),1,'Month'),-1))", '29'))
cs.append(case('E04_7', '【誤りの再現】月初に直さず addToTime で1か月足してから1日引く', "addDays(addToTime('2026-01-31T10:00:00',1,'Month'),-1,'yyyy/MM/dd')", '2026/02/27', True, '予想値。1/31+1か月が 2/28 になり、-1日で 2/27 になるか確認'))
E.append(dict(
    file='04_end_of_month.md', id='E04', title='月末日',
    kw='月末, 月末日, 末日, 月の最終日, 最終日, 月末締め, 末日付',
    funcs='startOfMonth, addToTime, addDays, dayOfMonth',
    purpose='指定した日時が属する月の月末日を求めます。「月の初日を出す → 1か月進める → 1日戻す」で、月ごとの日数やうるう年を自動で処理します。',
    expr_blocks=[
        ('式（貼り付け用・yyyy/MM/dd）', eom_tpl().replace('{T}', T_PROD)),
        ('派生式（日だけ・数値）', "dayOfMonth(addDays(addToTime(startOfMonth(%s),1,'Month'),-1))" % T_PROD),
    ],
    inputs="`outputs('Compose_JST')`（日本時間の日時）。他の日付の月末を求めるときは、その日付（日本時間）に置き換える。",
    outputs_ex='''| 基準日 | 出力 |
| --- | --- |
| 2026-01-15 | `2026/01/31` |
| 2026-02-10 | `2026/02/28` |
| 2028-02-10 | `2028/02/29` |''',
    mistakes=[
        '月末を固定の 30 や 31 にしてしまう（2月・小の月で誤る）。',
        '基準日に1か月足してから1日引く（1/31 + 1か月 = 2/28 となり、月末が2/27になる。ケース E04_7）。必ず `startOfMonth` で月初に直してから1か月進める。',
        '`startOfMonth` の結果は 0時0分の日時文字列。そのまま「日付」として表示したいときは `addDays` の書式引数か `formatDateTime` で整形する。',
        'UTC のまま使う（日本時間の月末日の 0:00〜8:59 に実行すると UTC では前日のため、月末の判定がずれる）。',
    ],
    cases=cs,
))

# ---------- E05 ----------
def c05(cid, u, fmt, label, obs=False, note=''):
    d = jst(u)
    pyfmt = {'yyyyMMdd_HHmm': '%Y%m%d_%H%M', 'yyyyMMdd_HHmmss': '%Y%m%d_%H%M%S'}[fmt]
    return case(cid, label, "convertTimeZone('%s', 'UTC', 'Tokyo Standard Time', '%s')" % (u, fmt), d.strftime(pyfmt), obs, note)

E.append(dict(
    file='05_filename_timestamp.md', id='E05', title='ファイル名に付ける日時（yyyyMMdd_HHmm）',
    kw='ファイル名, 日時, タイムスタンプ, yyyyMMdd_HHmm, 保存名, 作成日時, 名前に日付, 連番, ファイル名に日付',
    funcs='convertTimeZone, utcNow, concat',
    purpose='OneDrive・SharePoint に保存するファイル名に付ける日本時間の日時（例：`20261007_0930`）を作ります。ファイル名に使えない `/` `:` を含まない形式です。',
    expr_blocks=[
        ('式（貼り付け用・分まで）', "convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm')"),
        ('派生式（秒まで。同じ分に複数回実行されても重複しにくい）', "convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmmss')"),
        ('ファイル名にする例', "concat('申請一覧_', convertTimeZone(utcNow(), 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm'), '.xlsx')"),
    ],
    inputs='入力なし（実行時の日時）。',
    outputs_ex='''日本時間 2026年10月7日 09:30 に実行した場合：

| 式 | 出力 |
| --- | --- |
| yyyyMMdd_HHmm | `20261007_0930` |
| yyyyMMdd_HHmmss | `20261007_093012` |
| ファイル名の例 | `申請一覧_20261007_0930.xlsx` |''',
    mistakes=[
        '`HH` を小文字の `hh` にする（`hh` は 12 時間表記。14時が `02` になり、午前と午後が区別できない。ケース E05_5）。',
        '`MM`（月）を `mm`（分）にする（`yyyymmdd` は「年・分・日」になる。ケース E05_6）。',
        '`yyyy/MM/dd HH:mm` のように `/` や `:` を使う（ファイル名に使えない文字。SharePoint・OneDrive では保存エラーになる）。',
        '`utcNow(\'yyyyMMdd_HHmm\')` と書く（UTC になり、日本時間より9時間遅れた名前になる）。',
        '同じ分に複数回実行される可能性があるのに分までしか付けない（同名ファイルの上書き・エラーの恐れ。秒まで付ける）。',
    ],
    cases=[
        c05('E05_1', '2026-10-06T15:30:00Z', 'yyyyMMdd_HHmm', '日付をまたぐ（日本時間 10/07 0:30）'),
        c05('E05_2', '2026-03-31T14:05:09Z', 'yyyyMMdd_HHmm', '日本時間 23:05（3/31）'),
        c05('E05_3', '2026-03-31T14:05:09Z', 'yyyyMMdd_HHmmss', '秒まで'),
        case('E05_4', 'ファイル名の例（concat）', "concat('申請一覧_', convertTimeZone('2026-10-06T15:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_HHmm'), '.xlsx')", '申請一覧_20261007_0030.xlsx'),
        case('E05_5', '【誤りの再現】hh（12時間表記）', "convertTimeZone('2026-10-06T05:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyyMMdd_hhmm')", '20261006_0230', True, '日本時間14:30が 02:30 になることの確認'),
        case('E05_6', '【誤りの再現】mm（分）を月に使う', "convertTimeZone('2026-10-06T05:30:00Z', 'UTC', 'Tokyo Standard Time', 'yyyymmdd')", '20263006', True, '月の位置に分（30）が入ることの確認'),
    ],
))

# ---------- E06 ----------
def xs(n):
    d = date(1899, 12, 30) + timedelta(days=int(float(n)))
    return d.strftime('%Y/%m/%d')

XS_TPL = "addDays('1899-12-30',int(first(split(string({S}),'.'))),'yyyy/MM/dd')"
cs = []
for cid, s, lb, obs in [('E06_1', '45000', '整数のシリアル値', False),
                        ('E06_2', '45000.5', '時刻を含む（小数）シリアル値', False),
                        ('E06_3', "'45000'", '文字列として渡された場合', False),
                        ('E06_4', '46302', '2026/10/07 のシリアル値', False),
                        ('E06_5', '44927', '2023/01/01 のシリアル値', False),
                        ('E06_6', '61', '1900/03/01（この式が正しく使える最小の日付）', False)]:
    cs.append(case(cid, lb, XS_TPL.replace('{S}', s), xs(s.strip("'"))))
cs.append(case('E06_7', '【範囲外の再現】シリアル値 1（Excel では 1900/01/01）', XS_TPL.replace('{S}', '1'), '1899/12/31', True, 'Excel の表示（1900/01/01）と1日ずれることの確認'))
E.append(dict(
    file='06_excel_serial_to_date.md', id='E06', title='Excelのシリアル値 → 日付',
    kw='Excel, シリアル値, シリアル, 日付, エクセル, 数値, 45000, 日付に変換, 表の日付, 日付列',
    funcs='addDays, int, first, split, string',
    purpose='''Excel の日付列を Power Automate で取得すると、日付が `45000` のような **シリアル値（1900年の日付システムで 1899/12/30 からの日数）** で届くことがあります。これを日付文字列にします。
時刻部分（小数）は切り捨てます。日付は日本の日付そのものなので **タイムゾーン変換は不要**（`convertTimeZone` を通さない）です。''',
    expr_blocks=[
        ('式（貼り付け用）', XS_TPL.replace('{S}', '<シリアル値>')),
        ('式の例（動的なコンテンツを入れた形のイメージ）', "addDays('1899-12-30',int(first(split(string(items('Apply_to_each')?['日付列']),'.'))),'yyyy/MM/dd')"),
    ],
    inputs='''`<シリアル値>` に、Excel の日付列の値（動的なコンテンツ）を入れます。数値でも文字列（`'45000'`）でも、小数付き（`45000.5`）でも動くように `string` → `split`（小数点で分割）→ `first` → `int` としています。
- 2つ目の式例の `items('Apply_to_each')?['日付列']` は書き方のイメージです。Apply to each の繰り返し対象は、サンプルでは `@outputs('List_rows_present_in_a_table')?['body/value']` と書かれています（`samples/actions/control__apply_to_each__concurrency_off.json`）。繰り返しの中で1件の列を参照する書き方は、動的なコンテンツから挿入して確認してください（**要確認（サンプルなし）**）。
- Excel のアクション側に「日付/時刻の形式」を指定する設定がある場合、ISO 8601 形式（`2023-03-15T00:00:00Z` など）で返るため、この式は不要です。設定名は画面で **「DateTime Format」（Advanced parameters の中）** と確認済みですが、JSON での項目名は、この設定を使ったサンプルがないため **要確認（サンプルなし）**。''',
    outputs_ex='''| シリアル値 | 出力 |
| --- | --- |
| 45000 | `2023/03/15` |
| 45000.5 | `2023/03/15` |
| 46302 | `2026/10/07` |''',
    mistakes=[
        '基準日を `1900-01-01` にする（Excel は 1900年をうるう年として扱う仕様のため、`1899-12-30` を基準にする）。',
        "小数付きの値を `int('45000.5')` に直接渡す（変換エラーの恐れ）。この式は小数点以前だけを取り出している。",
        '日付に `convertTimeZone` をかけて +9 時間してしまう（日付が1日進む恐れ）。シリアル値は日本の日付そのもの。',
        '1900/03/01 より前の日付（シリアル値 60 以下）には使えない（Excel の 1900年うるう年の扱いにより1日ずれる）。',
        'Mac 版 Excel の 1904年日付システムのブックには使えない（基準日が異なる）。',
        '空欄セルに適用する（エラーになる）。先に空欄判定（07_is_blank.md）で分岐する。',
    ],
    cases=cs,
))

# ---------- E07 ----------
BLK = "empty(trim(replace(replace(string({V}),%s,' '),%s,' ')))" % (U3000, NBSP)
cs = []
for cid, v, lb, exp, obs in [
    ('E07_1', "''", '空文字', 'true', False),
    ('E07_2', "' '", '半角スペースのみ', 'true', False),
    ('E07_3', U3000, '全角スペースのみ', 'true', False),
    ('E07_4', "'abc'", '通常の文字', 'false', False),
    ('E07_5', "'0'", '文字の 0（空欄ではない）', 'false', False),
    ('E07_6', 'null', 'null（値なし）', 'true', False),
    ('E07_7', '0', '数値の 0（空欄ではない）', 'false', False),
]:
    cs.append(case(cid, lb, BLK.replace('{V}', v), exp, obs))
cs.append(case('E07_8', '【誤りの再現】empty だけだと半角スペースのみでも空欄にならない', "empty(' ')", 'false', True, '空白だけの値が「空欄」と判定されないことの確認'))
cs.append(case('E07_9', '【観察】equals(null, \'\') の結果', "equals(null, '')", 'False（実機確認済み：null と空文字は区別される）', True, 'null と空文字を区別するかの観察用'))
E.append(dict(
    file='07_is_blank.md', id='E07', title='空欄判定（null・空文字・半角/全角スペースのみ）',
    kw='空欄, 空, 空白, ブランク, 未入力, null, 空判定, 入力なし, empty, 空欄判定, 空かどうか',
    funcs='empty, trim, replace, string, decodeUriComponent',
    purpose='''Excel のセル・SharePoint の列・Forms の回答が「空欄」かどうかを `true/false` で返します。
**値なし（null）／空文字／半角スペースのみ／全角スペースのみ／ノーブレークスペースのみ** をすべて空欄とみなします。条件アクションの比較値や `if` の条件に使います。''',
    expr_blocks=[
        ('式（貼り付け用）', BLK.replace('{V}', '<値>')),
        ('簡易版（null と空文字だけを空欄とする場合）', 'empty(string(<値>))'),
    ],
    inputs=f'''`<値>` に判定したい値（動的なコンテンツ。`triggerBody()?['項目名']` のような式でもよい）を入れます。
- `string(null)` は空文字 `""` を返します（リファレンスに記載）。そのため値なし（null）も空欄として判定されます。
- 全角スペースは `{U3000}`（= `%E3%80%80` を元の文字に戻す関数）で表しています。式に全角スペースを直接書くと見分けにくく、貼り付け時に失われやすいためです。ノーブレークスペース（U+00A0）は `{NBSP}` です。''',
    outputs_ex='''| 値 | 出力 |
| --- | --- |
| （値なし） | `true` |
| `""` | `true` |
| `" "`（半角） | `true` |
| `"　"`（全角） | `true` |
| `"abc"` | `false` |
| `0` | `false` |''',
    mistakes=[
        '`empty(<値>)` だけで判定する（スペースだけの値は空欄にならない。ケース E07_8）。',
        '`equals(<値>, \'\')` で判定する（null と空文字を区別する場合があり、値なしが空欄にならない。実機で `equals(null, '')` は False：ケース E07_9）。',
        '空白だけの判定で `trim` を使うとき、全角スペースは標準の `trim` でも両端から除去されることを実機で確認した（ケース E10_2）。ただしリファレンスに記載がないため、この式は念のため先に全角・ノーブレークスペースを半角へ置換している。',
        '数値の `0` を空欄と判定してしまう設計にする（この式では 0 は空欄ではない）。',
        'Excel の「空に見えるセル」に数式で `""` が入っている場合も空文字として届く。値の有無ではなく空文字かどうかで判定すること。',
        '複数選択や配列の列に使う（配列には `empty(<配列>)` を使う）。',
    ],
    cases=cs,
))

# ---------- E08 ----------
cs = [
    case('E08_1', '配列の件数', "length(json('[1,2,3]'))", '3'),
    case('E08_2', 'createArray で作った配列の件数', "length(createArray('a','b','c','d'))", '4'),
    case('E08_3', '空の配列', "length(json('[]'))", '0'),
    case('E08_4', '値なし（null）でも安全に 0 にする', "length(coalesce(null, json('[]')))", '0'),
    case('E08_5', '文字列の length は文字数（日本語も1文字=1）', "length('あいう')", '3'),
    case('E08_6', '件数が0かどうかの判定', "equals(length(json('[]')), 0)", 'true'),
    case('E08_7', '【誤りの再現】null を length に直接渡す（実機で確認済み）', 'length(null)', 'エラー：The template language function \'length\' expects its parameter to be an array or a string. The provided value is of type \'Null\'.', True, '2026-10-07 実機で確認済み（InvalidTemplate）。値なしの可能性があるときは coalesce で空配列にしてから length を使う'),
]
E.append(dict(
    file='08_array_count.md', id='E08', title='配列の件数',
    kw='件数, 配列, 数, 何件, 行数, 個数, length, カウント, 件, 0件',
    funcs='length, coalesce, json, equals',
    purpose='「行を取得」「配列のフィルター処理」「選択」などの結果（配列）が **何件か** を数えます。0件のときだけ処理を分ける条件にも使います。',
    expr_blocks=[
        ('式（貼り付け用）', 'length(<配列>)'),
        ('値なし（null）でも 0 件として扱う安全版', "length(coalesce(<配列>, json('[]')))"),
        ('0件かどうかの判定', 'equals(length(<配列>), 0)'),
    ],
    inputs='''`<配列>` に、配列を返す動的なコンテンツ（例：取得アクションの `value`）を入れます。
- 取得アクション（Excel の一覧取得）の出力から配列を取り出す書き方は、サンプルで確認済みです：`outputs('List_rows_present_in_a_table')?['body/value']`（`samples/actions/control__apply_to_each__concurrency_off.json` の `foreach`）。アクション名は自分のフローの名前に合わせてください（空白は `_` に変わります）。
- **件数は取得アクション側のページネーション設定に左右されます。** 画面の Settings の Pagination をオンにすると、JSON に `runtimeConfiguration.paginationPolicy.minimumItemCount`（しきい値）が追加されます（`samples/actions/excel__list_rows_in_table__pagination_on.json`）。この設定がない一覧取得は、既定の上限で打ち切られる恐れがあります（既定の上限の件数は、サンプルにないため **要確認（サンプルなし）**）。''',
    outputs_ex='''| 配列 | 出力 |
| --- | --- |
| `[1,2,3]` | `3` |
| `[]` | `0` |''',
    mistakes=[
        '取得アクションが上限件数で打ち切られているのに、件数を「全件」と思い込む（ページネーション未設定。check_flow で検出する対象）。',
        '`length(null)` のように値なしを渡す（エラーになる恐れ。安全版の `coalesce` を使う）。',
        '配列ではなくオブジェクトや、配列を含む本文全体（`body(...)`）に `length` をかける（配列部分だけを渡す）。',
        '文字列の `length` はバイト数ではなく文字数。全角も半角も1文字として数える。',
        '`Apply to each` の中で件数を数えようとして、ループ対象の配列ではなく現在の1件を渡す。',
    ],
    cases=cs,
))

# ---------- E09 ----------
cs = [
    case('E09_1', '文字列の途中に改行を入れる（出力が2行で表示される）', "concat('1行目', %s, '2行目')" % LF, '1行目⏎2行目（2行で表示）', False, '実行履歴で2行になっていることを目視確認'),
    case('E09_2', '上の改行が1文字であること（文字数で確認）', "length(concat('A', %s, 'B'))" % LF, '3'),
    case('E09_3', 'HTMLメール用：改行を <br> に置換', "replace(concat('1行目', %s, '2行目'), %s, '<br>')" % (LF, LF), '1行目<br>2行目'),
    case('E09_4', 'CRLF（Windows形式の改行）も LF も <br> にする', "replace(replace(concat('A', %s, 'B', %s, 'C'), %s, '<br>'), %s, '<br>')" % (CRLF, LF, CRLF, LF), 'A<br>B<br>C'),
    case('E09_5', '配列を <br> で連結（箇条書きを本文にする）', "join(createArray('A','B','C'), '<br>')", 'A<br>B<br>C'),
    case('E09_6', '【観察】\\n と書いた場合（改行になるか）', "length(concat('A','\\n','B'))", '4（実機確認済み：\\n は改行にならず、文字として残る）', True, '予想値。結果を知らせてください'),
]
E.append(dict(
    file='09_mail_newline.md', id='E09', title='メール本文用の改行',
    kw='改行, メール本文, 本文, 改行コード, br, HTML, 行, 複数行, 箇条書き, 改行を入れる',
    funcs='concat, replace, join, decodeUriComponent, createArray',
    purpose='メール本文などに改行を入れます。式の文字列の中では、改行を `decodeUriComponent(\'%0A\')`（改行コード LF を表す文字列）で書きます。**HTML 形式のメール本文では、改行コードだけでは画面上で改行されず `<br>` が必要**です。',
    expr_blocks=[
        ('式A：文字列の途中に改行（LF）を入れる', "concat('1行目', %s, '2行目')" % LF),
        ('式B：HTML本文用。複数行テキストの改行を <br> に置換（LF のみ）', "replace(<複数行テキスト>, %s, '<br>')" % LF),
        ('式C：HTML本文用。CRLF／LF のどちらでも <br> に置換', "replace(replace(<複数行テキスト>, %s, '<br>'), %s, '<br>')" % (CRLF, LF)),
        ('式D：配列の各要素を1行ずつ並べる（HTML本文用）', "join(<配列>, '<br>')"),
    ],
    inputs='''`<複数行テキスト>` に、Forms の複数行回答・SharePoint の複数行テキスト・Excel の改行入りセルなどを入れます。
- Outlook の「Send an email (V2)」の本文は、**HTML として保存されます**（サンプルでは `emailMessage/Body` が `<p class=\"editor-paragraph\">…</p>`。`samples/actions/control__scope__run_after_failed.json`）。そのため、改行は `<br>` にします。Teams の投稿の本文は **要確認（サンプルなし）**。
- SharePoint の「リッチテキスト」列は、すでに HTML（`<div>` 等）の形で届くため、`<br>` への置換は不要です。''',
    outputs_ex='''式C に `A⏎B⏎C`（Windows 形式の改行）を渡した場合：

```text
A<br>B<br>C
```''',
    mistakes=[
        "式の中に `'\\n'` と書く。**改行にならず「\\n」という文字が出力されます**（2026-10-07 実機で確認。ケース E09_6：文字数 A\\nB が 4）。`decodeUriComponent('%0A')` を使う。",
        'HTML 形式の本文に改行コードだけを入れる（HTML では改行コードは無視され、1行につながって表示される）。',
        'CRLF（`%0D%0A`）のデータに対して LF だけを置換する（CR が残り、表示が崩れることがある）。CRLF を先に置換する（式C）。',
        'リッチテキスト列に式Bを適用する（すでに HTML のため不要）。',
        '本文の「プレーンテキスト」と「HTML」を切り替えずに `<br>` を入れる（`<br>` という文字がそのままメールに出る）。',
    ],
    cases=cs,
))

# ---------- E10 ----------
X = "concat(%s,'山田',%s,'太郎',%s,' ')" % (U3000, U3000, U3000)
TRA = "trim(replace(replace(string({V}),%s,' '),%s,' '))" % (U3000, NBSP)
TRB = "replace(replace(replace(string({V}),%s,''),%s,''),' ','')" % (U3000, NBSP)
cs = [
    case('E10_1', '【前提確認】検証用の入力（全角スペース＋山田＋全角＋太郎＋全角＋半角）の文字数', "length(%s)" % X, '8'),
    case('E10_2', '【観察】標準の trim だけで両端の全角スペースが消えるか（文字数で確認）', "length(trim(%s))" % X, '5（実機確認済み：全角・半角とも両端から除去された。除去前は 8 文字）', True, '最重要の観察ケース。結果に応じて式の根拠を確定する'),
    case('E10_3', '式A（両端の全角・半角スペースを除去。途中の全角は半角に統一）', TRA.replace('{V}', X), '山田 太郎', False, '途中の空白は半角スペース1つになる'),
    case('E10_4', '式A の結果の文字数', "length(%s)" % TRA.replace('{V}', X), '5'),
    case('E10_5', '式B（途中も含めてスペースをすべて除去）', TRB.replace('{V}', X), '山田太郎'),
    case('E10_6', '式A：ノーブレークスペースの除去', TRA.replace('{V}', "concat(%s,'ABC',%s)" % (NBSP, NBSP)), 'ABC'),
    case('E10_7', '式A：値なし（null）', TRA.replace('{V}', 'null'), '（空文字）'),
]
E.append(dict(
    file='10_trim_zenkaku.md', id='E10', title='全角スペースを含む前後空白の除去',
    kw='トリム, trim, 空白, 前後, 全角スペース, スペース除去, 余白, 空白除去, 前後の空白, 氏名, 全角空白',
    funcs='trim, replace, string, decodeUriComponent',
    purpose='''Excel・Forms・メール本文から取り込んだ文字列の **前後の空白（半角・全角・ノーブレークスペース）** を取り除きます。氏名や課コードの突合（一致判定）の前処理に使います。
**実機確認（2026-10-07）：標準の `trim` は、半角スペースだけでなく全角スペースも両端から除去します**（ケース E10_2：除去前8文字 → 除去後5文字）。ただしリファレンスの `trim` は「前後の空白を削除」としか書かれておらず、全角スペースの扱いは公式には保証されていません。そのため、式Aでは念のため **先に全角スペース・ノーブレークスペースを半角スペースへ置換してから `trim`** します（途中の全角スペースが半角に統一される効果もあります）。ノーブレークスペースだけを標準の `trim` が除去するかは未確認です。''',
    expr_blocks=[
        ('式A（貼り付け用）：両端を除去。途中の全角スペースは半角スペース1つに統一される', TRA.replace('{V}', '<値>')),
        ('式B：途中のスペースも含め、すべてのスペースを除去（氏名の突合用）', TRB.replace('{V}', '<値>')),
    ],
    inputs=f'''`<値>` に文字列の動的なコンテンツを入れます。値なし（null）は空文字として扱われます（`string(null)` は `""`。リファレンスに記載）。
全角スペースは `{U3000}`、ノーブレークスペースは `{NBSP}` で表しています。式に直接スペース文字を書くと見分けがつかず、貼り付け時に消えることがあるためです。''',
    outputs_ex='''| 入力（`□` は全角スペース） | 式A | 式B |
| --- | --- | --- |
| `□山田□太郎□` | `山田 太郎` | `山田太郎` |
| `  Abc  `（半角） | `Abc` | `Abc` |''',
    mistakes=[
        '途中の全角スペースは `trim` では除去も統一もされない（`trim` は両端だけ。途中のスペースは式A で半角に統一、式B で除去）。',
        '式の中に全角スペースを直接書いて置換する（貼り付けや保存で半角に変わる・消えることがある）。`decodeUriComponent(\'%E3%80%80\')` を使う。',
        '氏名の突合で、途中の空白の有無（`山田 太郎` と `山田太郎`）がそろっていない（式B で空白をすべて除去してから比較する）。',
        'Excel からのコピーで混入する ノーブレークスペース（U+00A0）を忘れる（見た目は半角スペースだが `trim` では除去されない場合がある）。',
        '途中の全角スペースだけを残して両端だけ除去したい場合は、1つの式では実現できない（繰り返し処理が必要になる。必要になった時点で相談）。',
    ],
    cases=cs,
))

# ---------- E11 ----------
fyc = [('E11_1', '2026-03-31T10:00:00', '3月31日（前年度）'),
       ('E11_2', '2026-04-01T00:00:00', '4月1日（新年度の初日）'),
       ('E11_3', '2026-10-07T10:00:00', '秋'),
       ('E11_4', '2027-01-15T10:00:00', '翌年の1月')]
cs = [case('E11_0', "【前提確認】int('03') が 3 になるか（月の先頭ゼロ）", "int('03')", '3', False, '実機確認済み：int(\'03\') は 3 になる')]
for cid, ts, lb in fyc:
    d = datetime.strptime(ts, '%Y-%m-%dT%H:%M:%S')
    cs.append(case(cid, lb + '（' + ts[:10] + '）', fy_tpl().replace('{T}', lit(ts)), str(fy_py(d))))
cs.append(case('E11_5', '令和◯年度（令和2年度以降）', "concat('令和', string(sub(2026, 2018)), '年度')", '令和8年度'))
E.append(dict(
    file='11_fiscal_year.md', id='E11', title='年度（4月始まり）',
    kw='年度, 会計年度, 令和年度, 年度判定, 4月始まり, 今年度, 当年度, 年度計算',
    funcs='formatDateTime, int, if, greaterOrEquals, sub, concat, string',
    purpose='日本時間の日付から、4月始まりの年度（西暦）を数値で求めます。1〜3月は前年の年度になります。',
    expr_blocks=[
        ('式（貼り付け用・西暦の年度）', fy_tpl().replace('{T}', T_PROD)),
        ('派生式（令和◯年度。令和2年度以降用。<年度> は上の式の結果）', "concat('令和', string(sub(<年度>, 2018)), '年度')"),
    ],
    inputs="`outputs('Compose_JST')`（日本時間の日時）。派生式の `<年度>` には上の式の結果（Compose の出力）を入れます。",
    outputs_ex='''| 基準日 | 出力 |
| --- | --- |
| 2026-03-31 | `2025` |
| 2026-04-01 | `2026` |
| 2027-01-15 | `2026` |
| （派生式）年度 2026 | `令和8年度` |''',
    mistakes=[
        '暦年（1月始まり）をそのまま年度にする（1〜3月が翌年度扱いになる）。',
        'UTC のまま判定する（4月1日の 0:00〜8:59 が前年度になる）。',
        '`int(formatDateTime(…,\'MM\'))` の月が 0 付き（`03`）でも変換できる前提（ケース E11_0 で確認）。',
        '令和元年度（2019年度）に派生式を使う（`令和1年度` と出力され「元年度」にならない）。',
    ],
    cases=cs,
))

# ---------- E12 ----------
dc = [('E12_1', "'2026-10-07T10:00:00'", "'2026-10-31'", '10月末まで'),
      ('E12_2', "'2026-10-07T10:00:00'", "'2026-10-07'", '同じ日'),
      ('E12_3', "'2026-10-07T10:00:00'", "'2026-10-01'", '期限切れ（負の値）'),
      ('E12_4', "'2028-02-28T23:30:00'", "'2028-03-01'", 'うるう年をまたぐ'),
      ('E12_5', "'2026-10-07T23:59:59'", "'2026-10-08T00:00:00'", '時刻は無視して日付だけで数える')]
def days_py(a, b):
    pa = datetime.strptime(a.strip("'")[:10], '%Y-%m-%d'); pb = datetime.strptime(b.strip("'")[:10], '%Y-%m-%d')
    return str((pb - pa).days)
cs = []
for cid, a, b, lb in dc:
    cs.append(case(cid, lb + '（' + a.strip("'")[:10] + ' → ' + b.strip("'")[:10] + '）', days_tpl().replace('{A}', a).replace('{B}', b), days_py(a, b)))
E.append(dict(
    file='12_days_between.md', id='E12', title='日付の差（日数）',
    kw='日数, 日数差, 残り日数, 経過日数, 期限まで, 差, 何日, 期限, 日付の差, 日付差',
    funcs='ticks, startOfDay, sub, div',
    purpose='2つの日付の差を **日数（整数）** で求めます（例：期限まで残り何日か）。時刻は切り捨て、日付だけで数えます。終了日が開始日より前なら負の値になります。',
    expr_blocks=[('式（貼り付け用）', days_tpl().replace('{A}', T_PROD).replace('{B}', '<期限の日付>'))],
    inputs='''開始日は `outputs('Compose_JST')`（日本時間の現在日時）、`<期限の日付>` には期限の日時（動的なコンテンツ）を入れます。
`ticks` は 0001/1/1 からの 100ナノ秒の数（リファレンスに記載）。1日 = 864,000,000,000 ticks です。
**2つの日時は同じ基準（日本時間）の形式にそろえてください。** SharePoint の日付列が UTC（末尾 Z）で届く場合の扱いは **要確認（サンプルなし）**。''',
    outputs_ex='''| 開始 | 期限 | 出力 |
| --- | --- | --- |
| 2026-10-07 | 2026-10-31 | `24` |
| 2026-10-07 | 2026-10-07 | `0` |
| 2026-10-07 | 2026-10-01 | `-6` |''',
    mistakes=[
        '時刻つきのまま引き算する（23:59 と 0:00 で日数が1ずれる）。`startOfDay` で日付に揃える。',
        '片方が UTC（末尾 Z）、もう片方が日本時間のまま比較する。事前に両方を日本時間にそろえる。',
        '`dateDifference` の結果（時間間隔の文字列）を数値として扱う（この式は `ticks` の差を日数に直している）。',
        '`div` の結果が整数同士の割り算のため小数にならない点（日数は切り捨て）を忘れる。',
    ],
    cases=cs,
))


# ============ 出力 ============
def render(e):
    L = []
    L.append('# ' + e['title'])
    L.append('')
    L.append('- ID: ' + e['id'])
    L.append('- キーワード: ' + e['kw'])
    L.append('- 使用関数: ' + e['funcs'])
    L.append('- 根拠: ' + REF)
    L.append('- 書式の根拠: ' + REF_FMT)
    if e['id'] in ('E00', 'E01', 'E02', 'E03', 'E04', 'E05', 'E11', 'E12'):
        L.append('- タイムゾーン名の根拠: ' + REF_TZ + '（このページ自体は未確認。`Tokyo Standard Time` は E00 のケースで動作確認する）')
    L.append('- リファレンス確認: 使用関数の名前・引数は上記ページで確認済み（2026-10-07 時点・英語版）。戻り値の細かい挙動は下記ケースで実機確認する。')
    L.append('- 検証状況: **実機検証済み**（2026-10-07 Power Automate 英語表示・既定環境。全ケースが期待どおり。詳細は VERIFIED_RESULTS.md）')
    L.append('')
    L.append('## 用途')
    L.append('')
    L.append(e['purpose'])
    L.append('')
    L.append('## 式（貼り付け用）')
    L.append('')
    L.append('Compose（作成）の入力欄で **「式」タブ（fx）** を開き、下の式を貼り付けます（先頭の `@` は付けません）。')
    L.append('')
    for t, x in e['expr_blocks']:
        L.append('### ' + t)
        L.append('')
        L.append('```text')
        L.append(x)
        L.append('```')
        L.append('')
    L.append('## 入力の想定')
    L.append('')
    L.append(e['inputs'])
    L.append('')
    L.append('## 出力例')
    L.append('')
    L.append(e['outputs_ex'])
    L.append('')
    L.append('## よくある誤り')
    L.append('')
    for m in e['mistakes']:
        L.append('- ' + m)
    L.append('')
    L.append('## 検証（Compose）')
    L.append('')
    L.append('手順は [VERIFY.md](VERIFY.md) の「検証の手順」を参照してください。各ケースの式は **固定の入力値を式に直接書いてあり、他のアクションに依存しません**。1ケースにつき Compose を1つ作り、名前をケースIDに変更して、手動実行後に出力を確認します。')
    L.append('')
    L.append('- 「観察」と付いたケースは、期待値が予想（または環境依存）のものです。**結果が期待と違っても失敗ではなく、実際の出力を記録して知らせてください。**')
    L.append('- 1つのケースが **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したケースの Compose は削除して再実行し、エラーメッセージの全文を記録してください。')
    L.append('')
    for c in e['cases']:
        tag = '【観察】' if (c['observe'] and not c['label'].startswith('【')) else ''
        L.append('### %s %s%s' % (c['id'], tag, c['label']))
        L.append('')
        L.append('- 期待出力: `%s`' % c['expected'] if not c['expected'].startswith('（') and '予想' not in c['expected'] and '：' not in c['expected'] else '- 期待出力: ' + c['expected'])
        if c['note']:
            L.append('- 備考: ' + c['note'])
        L.append('')
        L.append('```text')
        L.append(c['expr'])
        L.append('```')
        L.append('')
    return '\n'.join(L).rstrip() + '\n'


for e in E:
    with open(os.path.join(OUT, e['file']), 'w', encoding='utf-8', newline='\n') as f:
        f.write(render(e))

# ---- VERIFY.md ----
V = []
V.append('# 式の検証手順と結果記入表')
V.append('')
V.append('このファイルは、`expressions/` の式を **テスト用フローの「作成（Compose）」アクション** で実機確認するための手順書です。')
V.append('結果は下の「結果記入表」に記入して（またはそのまま写真・コピーで）知らせてください。')
V.append('')
V.append('> **注意**: 画面のメニュー名・ボタン名（「作成」「式」タブなど）は環境や画面の更新で変わることがあります。サンプルJSONで裏付けていないため **要確認（サンプルなし）** として扱い、画面に表示される名前に読み替えてください。')
V.append('')
V.append('## 検証の手順')
V.append('')
V.append('1. Power Automate で、**手動でトリガーするクラウドフロー**（インスタント クラウド フロー）を新規作成します。名前は `式の検証` などとします。')
V.append('2. 「新しいステップ」（＋）から **作成（Compose）** アクションを追加します。')
V.append('3. Compose の **入力欄をクリック** し、表示される「動的なコンテンツ／式」の **「式」タブ（fx）** を開きます。')
V.append('4. このファイルのケースの式（または各 md ファイルのケースの式）を **コピーして貼り付け**、「OK」（または「追加」）で確定します。')
V.append('5. Compose の「…」メニュー →「名前の変更」で、名前を **ケースID（例：`E01_1`）** に変更します。※ 名前に使えるのは英数字・アンダースコアが無難です。')
V.append('6. 2〜5 を繰り返し、ケースの数だけ Compose を並べます。**まず 1 ファイル分（例：E01）だけ作って流すのを推奨**します。')
V.append('7. フローを保存し、「テスト」→「手動」→「フローの実行」で実行します。')
V.append('8. 実行履歴で、各 Compose の **出力** を開き、期待出力と比べます。')
V.append('')
V.append('### 結果の見方・注意')
V.append('')
V.append('- 文字列の出力は実行履歴で `"2026/10/07"` のように **引用符付き** で表示されますが、値そのものには引用符は含まれません。')
V.append('- 数値・true/false は引用符なしで表示されます（`3`、`true`）。')
V.append('- 全角スペースは見分けにくいため、E10 のケースは文字数（`length`）でも判定できるようにしてあります。')
V.append('- 1つの Compose が **失敗（赤）** になると、その後ろの Compose は実行されません。失敗したものは **エラーメッセージの全文** を記録し、その Compose を削除して再実行してください。')
V.append('- 「観察」ケースは、期待値が予想です。違っても失敗ではなく、**実際の出力を記録**してください。')
V.append('- E00_3 のように「現在時刻」を使うケースは、期待値を固定できないため目視で確認します。')
V.append('- 式の貼り付け時に「式が正しくありません」と表示された場合は、その旨と、画面に出たメッセージを記録してください。')
V.append('')
V.append('## 結果記入表')
V.append('')
V.append('「判定」には OK／NG／エラー（赤）／観察、「実際の出力」には表示された値を書いてください。')
V.append('')
V.append('| ケースID | 内容 | 期待出力 | 実際の出力 | 判定 |')
V.append('| --- | --- | --- | --- | --- |')
for e in E:
    for c in e['cases']:
        exp = c['expected'].replace('|', '\\|')
        lb = ('【観察】' if (c['observe'] and not c['label'].startswith('【')) else '') + c['label'].replace('|', '\\|')
        V.append('| %s | %s | %s |  |  |' % (c['id'], lb, exp))
V.append('')
V.append('## ケース集（式の一覧）')
V.append('')
V.append('各ファイルのケースと同じ内容です。コピーして Compose に貼り付けてください。')
V.append('')
for e in E:
    V.append('### %s %s（%s）' % (e['id'], e['title'], e['file']))
    V.append('')
    for c in e['cases']:
        V.append('**%s** %s%s  ' % (c['id'], '【観察】' if (c['observe'] and not c['label'].startswith('【')) else '', c['label']))
        V.append('期待: %s' % c['expected'])
        V.append('')
        V.append('```text')
        V.append(c['expr'])
        V.append('```')
        V.append('')
with open(os.path.join(OUT, 'VERIFY.md'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(V).rstrip() + '\n')

# ---- README (index) ----
R = []
R.append('# 式ライブラリ（expressions）')
R.append('')
R.append('自治体事務でよく使う Power Automate の式を、**1ファイル1用途** でまとめています。')
R.append('')
R.append('## 使うときの約束')
R.append('')
R.append('- 使う関数は Microsoft Learn の Workflow Definition Language 関数リファレンスに載っているものだけです。根拠URLは各ファイルに書いてあります。')
R.append('  - ' + REF)
R.append('- `utcNow()` は **UTC** を返します。日本時間が必要な箇所は必ず `convertTimeZone(…, \'UTC\', \'Tokyo Standard Time\')` で変換します。')
R.append('- フローの先頭に [00_now_jst.md](00_now_jst.md) の `Compose_JST` を置き、以降の式はその出力を使います。')
R.append('- 式は Compose の入力欄の「式」タブ（fx）に貼り付けます（先頭の `@` は不要）。')
R.append('- **全ケースを実機で検証済み（2026-10-07、Power Automate 英語表示）** で、期待どおりの結果でした。結果は [VERIFIED_RESULTS.md](VERIFIED_RESULTS.md)、手順は [VERIFY.md](VERIFY.md) にあります。別の環境（画面言語・テナント）では挙動が変わる可能性があるため、初めて使う環境では E00・E01 だけでも確認してください。')
R.append('- ファイル内の「要確認（サンプルなし）」は、アクションのJSONサンプルがまだなく、画面上の名称や設定項目を断定できないものです。')
R.append('')
R.append('## 一覧')
R.append('')
R.append('| ID | 用途 | ファイル | ケース数 |')
R.append('| --- | --- | --- | --- |')
for e in E:
    R.append('| %s | %s | [%s](%s) | %d |' % (e['id'], e['title'], e['file'], e['file'], len(e['cases'])))
R.append('')
R.append('## ファイルの書式')
R.append('')
R.append('各ファイルは次の構成です（`tools/make_expression` がこの構成を読み取ります。構成を崩さないでください）。')
R.append('')
R.append('```text')
R.append('# 用途のタイトル')
R.append('- ID / キーワード / 使用関数 / 根拠 / 検証状況')
R.append('## 用途')
R.append('## 式（貼り付け用）')
R.append('## 入力の想定')
R.append('## 出力例')
R.append('## よくある誤り')
R.append('## 検証（Compose）')
R.append('```')
with open(os.path.join(OUT, 'README.md'), 'w', encoding='utf-8', newline='\n') as f:
    f.write('\n'.join(R).rstrip() + '\n')

print(sum(len(e['cases']) for e in E), 'cases in', len(E), 'files')
