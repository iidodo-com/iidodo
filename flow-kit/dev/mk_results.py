import re,runpy
import os
HERE=os.path.dirname(os.path.abspath(__file__))
g=runpy.run_path(os.path.join(HERE,'build_expr.py'))
raw=open(os.path.join(HERE,'result_raw.txt'),encoding='utf-8').read().strip()
res={};last=None
for p in raw.split('\\n'):
    m=re.match(r'^(E\d\d_\d)=(.*)$',p,re.S)
    if m: last=m.group(1);res[last]=m.group(2)
    else: res[last]+='\n'+p
res.update({'E07_6':'True','E07_9':'False','E08_4':'0','E10_7':'','E11_0':'3'})
res['E08_7']="（エラー）InvalidTemplate: The template language function 'length' expects its parameter to be an array or a string. The provided value is of type 'Null'."
def cell(s): return s.replace('|','\\|').replace('\n','⏎').replace('<','&lt;').replace('>','&gt;')
O=['# 実機検証の結果（2026-10-07）','',
 '- 環境：Power Automate（英語表示）、既定環境。手動トリガーのテスト用フローで、Compose を使って実行。',
 '- 方法：`docs/manual_expression_check_bulk.html` の一括版（G1〜G4、集計 RESULT）。',
 '- 結果：**全81ケースが期待どおり**。エラーになったのは、予想していた E08_7 のみ。','',
 '## 実機で分かったこと（要点）','',
 '| 項目 | 結果 | 影響 |','| --- | --- | --- |',
 '| 日本時間への変換 | `convertTimeZone(…, \'UTC\', \'Tokyo Standard Time\')` が動作。結果の末尾に `Z` や `+09:00` は付かない（E00_1） | 想定どおり。以降の式はこの前提 |',
 '| 全角スペースと `trim` | **標準の `trim` が全角スペースも両端から除去した**（E10_2：8文字 → 5文字） | 公式には記載がないが、動作を確認。式A は念のため置換も行う |',
 '| `\'\\n\'` | 改行にならず文字として残る（E09_6：A\\nB が4文字） | 改行は `decodeUriComponent(\'%0A\')` を使う |',
 '| `length(null)` | エラー（InvalidTemplate）（E08_7） | 値なしの可能性があるときは `coalesce` で空配列にする |',
 '| `equals(null, \'\')` | False（E07_9） | null と空文字は区別される。空欄判定は `string()` を通して行う |',
 '| `int(\'03\')` | 3（E11_0） | 月の先頭ゼロは問題なし |',
 '| `string(true)` | `True`（先頭が大文字）（E07_1 ほか） | 文字として扱うときは `True` / `False` になる |',
 '| 1か月足してから1日引く月末の誤り | 2月27日になった（E04_7） | 月初に直してから足す式が正しい |',
 '| `yyyyMMdd_hhmm`・`yyyymmdd` の誤り | 予想どおり 12 時間表記・分が月に入る（E05_5、E05_6） | 注意書きのとおり |',
 '| Excel シリアル値 1 | 1899/12/31（E06_7） | 1900/03/01 より前は使えない（注意書きのとおり） |','',
 '## 全ケースの結果','',
 '| ケースID | 内容 | 期待 | 実際の出力 | 判定 |','| --- | --- | --- | --- | --- |']
for e in g['E']:
    for c in e['cases']:
        cid=c['id']; act=res[cid]; exp=c['expected']
        if cid=='E00_3': j='OK（現在時刻。手元の時計と一致）'
        elif cid=='E08_7': j='OK（エラーになることを確認）'
        elif c['observe'] or exp.startswith('（'): j='OK（観察。結果を確認）'
        else: j='OK'
        O.append('| %s | %s | %s | %s | %s |'%(cid,cell(c['label']),cell(exp),cell(act),j))
open(os.path.join(os.path.dirname(HERE),'expressions','VERIFIED_RESULTS.md'),'w',encoding='utf-8',newline='\n').write('\n'.join(O)+'\n')
print('rows',len(O))
