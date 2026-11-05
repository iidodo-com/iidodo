import random,json,datetime,os
random.seed(20261105)
src=open('build_v5.py',encoding='utf-8').read()
ns={}
head=src.split("wb=Workbook()")[0]
exec(head,ns)
SHZ=ns['SHZ']; M=ns['M']; TARGETS=ns['TARGETS']
units=[z for z in SHZ if not z[3].startswith('（') ]
hon=[z for z in units if not z[1].endswith('区役所')]; ku_=[z for z in units if z[1].endswith('区役所')]
sel=random.sample(hon,24)+random.sample(ku_,4)
random.shuffle(sel)
cnt=[max(1,round(random.gauss(3.6,1.6))) for _ in sel]
while sum(cnt)!=100:
    i=random.randrange(len(cnt))
    if sum(cnt)>100 and cnt[i]>1: cnt[i]-=1
    elif sum(cnt)<100: cnt[i]+=1
EXC=['事業ごみ','乗船券','入札保証金','金銭登録機','プリペイド','販売用物品','建設','施設の修繕','民有地']
pool=[m for m in M if not any(x in m['i3']+m['i2'] for x in EXC)]
byk={}
for m in pool: byk.setdefault('１２３４５６'.index(m['i1'][0])+1,[]).append(m)
W1={1:3,2:2,3:1.2,4:2,5:1,6:.1}; CW={'記載関係':3,'押印関係':2,'書類漏れ':3,'その他':.45,'計算誤り':1.2}
STAT=['実査当日是正済み(回答不要)','後日是正済み','是正後の報告を求めた','以後適切に処理するよう指導した','その他']; SW=[40,20,15,20,5]
BK=['①是正に際し金銭の動きがあった','②是正はできないが同種の事務が今後も想定される','③その他特記事項']
GR=['高谷G','松本G','川口G','山口G','竹下G','谷本G']
KU_T=['道路交通局','下水道局','環境局','健康福祉局','都市整備局','市民局','経済観光局']
def wd(d):
    while d.weekday()>=5: d+=datetime.timedelta(1)
    return d
rows=[]
for i,(z,n) in enumerate(zip(sel,cnt)):
    g=GR[i%6]; d0=wd(datetime.date(2026,6,1)+datetime.timedelta(random.randrange(0,150))); days=[d0]
    while len(days)<4: days.append(wd(days[-1]+datetime.timedelta(1)))
    ku=z[1].endswith('区役所')
    for _ in range(n):
        tg=random.choice(KU_T) if ku else z[1]          # 区役所等は令達元の局(関連する局)を選ぶ
        c=random.choices(list(W1),list(W1.values()))[0]
        L=byk[c]; m=random.choices(L,[CW.get(x['cat'],1)*(0.35 if x['prob'].startswith('（その他）') else 1) for x in L])[0]
        other=m['prob'].startswith('（その他）')
        naiyo=f'【テストデータ】{z[3]}の事務で、'+('定型の項目に当てはまらない不備が認められた。' if other else f'{m["prob"]}が認められた。')
        det=f'【テストデータ・架空】令和7年{random.randint(4,12)}月{random.randint(1,28)}日起案分(1件)。'; bk=''
        if m['cat']=='計算誤り':
            a=random.randint(2,60)*1000+random.randint(0,9)*10; det+=f'【誤】{a:,}円【正】{a-random.choice([2,10,20,50]):,}円'; bk=BK[0]
        st=random.choices(STAT,SW)[0]
        if not bk and st.startswith('以後') and random.random()<.35: bk=BK[1]
        rows.append(dict(年度=8,日付=random.choice(days).isoformat(),tg=tg,ky=z[1],bu=z[2],ka=z[3],グループ=g,担当=f'テスト担当{"ABCDEF"[GR.index(g)]}',
            i1=m['i1'],i2=m['i2'],i3=m['i3'],cat=m['cat'],prob=m['prob'],内容=naiyo,詳細=det,状況=st,備考=bk,根拠='',kw='テスト',周知='要' if random.random()<.05 else '不要'))
rows.sort(key=lambda r:(r['日付'],r['ky'],r['ka']))
json.dump(rows,open('testrows_v5.json','w',encoding='utf-8'),ensure_ascii=False)
from collections import Counter
print(len(rows),len({r['ka'] for r in rows}),Counter(r['tg'] for r in rows).most_common(6))
print([ (r['tg'],r['ky'],r['bu'],r['ka']) for r in rows if r['ky'].endswith('区役所')][:3])
