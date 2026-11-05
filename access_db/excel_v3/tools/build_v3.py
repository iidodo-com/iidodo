import csv,glob,os,json,datetime,re,warnings
from copy import copy
from collections import OrderedDict
import openpyxl
from openpyxl import Workbook
from openpyxl.styles import Font,PatternFill,Alignment,Border,Side
from openpyxl.styles.differential import DifferentialStyle
from openpyxl.formatting.rule import Rule,FormulaRule
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.worksheet.table import Table,TableStyleInfo
from openpyxl.worksheet.properties import PageSetupProperties
from openpyxl.utils import get_column_letter as L
warnings.simplefilter('ignore')
ROOT='/home/user/iidodo/access_db'
OUT=os.environ.get('OUTFILE',ROOT+'/検出事項データベース_v3.xlsx')
PROB=ROOT+'/m_problem.tsv'
SHOZOKU_CSV=glob.glob('/root/.claude/uploads/*/a79e4da0*.csv')[0]
ORIG=glob.glob('/root/.claude/uploads/*/2a4800bf*.xlsx')[0]
FORMCODE=os.environ.get('FORMCODE')
TESTROWS=os.environ.get('TESTROWS')
N=2000; GROUPS=8; NROW=150; D0=9; D1=D0+NROW-1; R78=D1+3
FONT='Meiryo UI'
hdr_fill=PatternFill('solid',fgColor='1F4E78'); hdr_font=Font(name=FONT,bold=True,color='FFFFFF')
inp_fill=PatternFill('solid',fgColor='FFF2CC'); thin=Side(style='thin',color='BFBFBF'); box=Border(left=thin,right=thin,top=thin,bottom=thin)
base=Font(name=FONT,size=10)
# ---------- マスタ読み込み ----------
M=[dict(i1=r[1],i2=r[2],i3=r[3],cat=r[4],prob=r[5],desc=r[6] if len(r)>6 else '') for r in [r for r in csv.reader(open(PROB,encoding='utf-8'),delimiter='\t')][1:]]
def build_shozoku():
    rows=[(r[0],r[1],r[2]) for r in list(csv.reader(open(SHOZOKU_CSV,encoding='cp932',newline='')))[1:] if r and r[0]]
    rows.sort(key=lambda r:r[0])
    BK={'1':'広島市（市長部局）','2':'消防局（部局）','3':'水道局（部局）','5':'市議会（部局）','6':'広島市教育委員会（部局）','7':'行政委員会（部局）'}
    def kind(c,n): return '局' if c[3:]=='0000000' else ('部' if (n.endswith('部') or c[5:]=='00000') else '課')
    kyokus=OrderedDict()
    for c,k,n in rows: kyokus.setdefault(k,[]).append((c,n,kind(c,n)))
    out=[]
    for k,lst in kyokus.items():
        bk=BK.get(lst[0][0][0],'部局'+lst[0][0][0])
        bu={c[:5]:n for c,n,kd in lst if kd=='部'}   # prefix5 -> 部名
        pseudo={}; entries=[]
        for c,n,kd in lst:
            if kd=='局': continue
            if kd=='部':
                entries.append((c,bu[c[:5]],None))      # 部そのもの(課を持たない場合の保険)
            else:
                p=c[:5]
                if p in bu: b=bu[p]
                else:
                    if p not in pseudo: pseudo[p]=k+('（部）' if not pseudo else '（部%s）'%str(len(pseudo)+1).translate(str.maketrans('0123456789','０１２３４５６７８９')))
                    b=pseudo[p]
                entries.append((c,b,n))
        have={b for c,b,n in entries if n}
        res=[]
        for c,b,n in entries:
            if n: res.append((c,b,n))
            elif b not in have: res.append((c,b,b))       # 課を持たない部は、部名を課として選べるようにする
        if not res:                                       # 局のみ(会計室など)
            res=[(lst[0][0],k+'（部）',k)]
        for c,b,n in res: out.append((bk,k,b,n,c))
    return out
SHZ=build_shozoku()
wb=Workbook()
names=['使い方','検討経緯','入力','復命用一覧','別紙(復命用)','問題点入力表','区分別集計','M_問題点','M_所属','M_設定','リスト','フォームコード']
ws_use=wb.active; ws_use.title=names[0]
S={n:wb.create_sheet(n) for n in names[1:]}
ws_k=S['検討経緯']; ws_in=S['入力']; ws_rep=S['復命用一覧']; ws_bs=S['別紙(復命用)']; ws_cr=S['問題点入力表']; ws_sm=S['区分別集計']
ws_m=S['M_問題点']; ws_s=S['M_所属']; ws_set=S['M_設定']; ws_l=S['リスト']; ws_fc=S['フォームコード']
def head(ws,r,c,text,w=None):
    x=ws.cell(r,c,text); x.fill=hdr_fill; x.font=hdr_font; x.border=box
    x.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
    if w: ws.column_dimensions[L(c)].width=w
# ---------- M_設定 ----------
for c,t in ((1,'グループ(列見出し)'),(3,'対応状況'),(5,'備考区分'),(7,'全庁周知'),(9,'区分')): head(ws_set,1,c,t,28)
groups=['高谷G','松本G','川口G','山口G','竹下G','谷本G']
for i in range(GROUPS): ws_set.cell(2+i,1,groups[i] if i<len(groups) else None)
status=['実査当日是正済み(回答不要)','後日是正済み','是正後の報告を求めた','以後適切に処理するよう指導した','その他']
for i in range(10): ws_set.cell(2+i,3,status[i] if i<len(status) else None)
for i,v in enumerate(['①是正に際し金銭の動きがあった','②是正はできないが同種の事務が今後も想定される','③その他特記事項']): ws_set.cell(2+i,5,v)
for i,v in enumerate(['要','不要']): ws_set.cell(2+i,7,v)
for i,v in enumerate(['押印関係','記載関係','計算誤り','書類漏れ','その他']): ws_set.cell(2+i,9,v)
ws_set['A14']='※グループ名・対応状況は年度ごとに書き換えてください(空欄の行は使われません)。'; ws_set['A14'].font=Font(name=FONT,size=9,color='C00000')
ws_set.column_dimensions['E'].width=46
# ---------- M_問題点 ----------
for j,(t,w) in enumerate([('項目1',24),('項目2',30),('項目3',34),('区分',12),('問題点',50),('内容説明',40),('キー',10)],1): head(ws_m,1,j,t,w)
for i,m in enumerate(M,2):
    for j,v in enumerate([m['i1'],m['i2'],m['i3'] or None,m['cat'],m['prob'],m['desc'] or None],1): ws_m.cell(i,j,v)
    ws_m.cell(i,7,f'=A{i}&"|"&B{i}&"|"&C{i}&"|"&D{i}&"|"&E{i}')
ws_m.freeze_panes='A2'; ws_m.auto_filter.ref=f'A1:G{len(M)+1}'; ws_m.column_dimensions['G'].hidden=True
NM=len(M)+1
# ---------- M_所属 ----------
for j,(t,w) in enumerate([('部局',26),('局',24),('部',30),('課',34),('組織CD',14)],1): head(ws_s,1,j,t,w)
for i,r in enumerate(SHZ,2):
    for j,v in enumerate(r,1): ws_s.cell(i,j,v)
ws_s.freeze_panes='A2'; ws_s.auto_filter.ref=f'A1:E{len(SHZ)+1}'
ws_s['G1']='※所属一覧(組織CD付きCSV)から作成。部は、組織CDから推定したもの(部を持たない課は「〇〇局（部）」としています)。'; ws_s['G1'].font=Font(name=FONT,size=9,color='7F7F7F')
# ---------- リスト(連動ドロップダウン用) ----------
def gb(keyf,valf,src):
    d=OrderedDict()
    for m in src:
        v=valf(m)
        if v=='': continue
        d.setdefault(keyf(m),OrderedDict())[v]=1
    return [(k,v) for k,vs in d.items() for v in vs]
l1=list(OrderedDict((m['i1'],1) for m in M))
l2=gb(lambda m:m['i1'],lambda m:m['i2'],M); l3=gb(lambda m:m['i1']+'|'+m['i2'],lambda m:m['i3'],M)
l4=gb(lambda m:m['i1']+'|'+m['i2']+'|'+m['i3'],lambda m:m['cat'],M); l5=gb(lambda m:m['i1']+'|'+m['i2']+'|'+m['i3']+'|'+m['cat'],lambda m:m['prob'],M)
Z=[dict(a=r[0],b=r[1],c=r[2],d=r[3]) for r in SHZ]
s1=list(OrderedDict((z['a'],1) for z in Z)); s2=gb(lambda z:z['a'],lambda z:z['b'],Z); s3=gb(lambda z:z['a']+'|'+z['b'],lambda z:z['c'],Z); s4=gb(lambda z:z['a']+'|'+z['b']+'|'+z['c'],lambda z:z['d'],Z)
ws_l['A1']='項目1'; ws_l['O1']='部局'
for i,v in enumerate(l1,2): ws_l.cell(i,1,v)
for i,v in enumerate(s1,2): ws_l.cell(i,15,v)
for c0,lst,name in ((3,l2,'項目2'),(6,l3,'項目3'),(9,l4,'区分'),(12,l5,'問題点'),(17,s2,'局'),(20,s3,'部'),(23,s4,'課')):
    ws_l.cell(1,c0,'キー'); ws_l.cell(1,c0+1,name)
    for i,(k,v) in enumerate(lst,2): ws_l.cell(i,c0,k); ws_l.cell(i,c0+1,v)
ws_l.sheet_state='hidden'
# ---------- 入力 ----------
COL=dict(no='A',year='B',date='C',bk='D',ky='E',bu='F',ka='G',grp='H',tanto='I',k1='J',k2='K',k3='L',cat='M',prob='N',cnt='O',naiyo='P',shosai='Q',status='R',biko='S',konkyo='T',kw='U',shuchi='V',dept='W',key='X',hit='Y',order='Z',agg='AA')
cols=[('No.',6),('監査年度\n(令和)',9),('実地監査\n年月日',12),('部局',18),('局',16),('部',20),('課',22),('グループ',10),('担当者',10),('項目1',22),('項目(2)',26),('項目(3)',26),('区分',11),('問題点',40),('件数\n(自動)',6),
      ('内容(要約)',40),('詳細(事例・誤/正・金額等)',50),('対応状況',26),('備考区分',22),('根拠規定',24),('キーワード\n(;区切り)',20),('全庁周知',9),('局課(自動)',8),('キー(自動)',8),('抽出(自動)',8),('出力順(自動)',8),('集計キー(自動)',8)]
for j,(t,w) in enumerate(cols,1): head(ws_in,1,j,t,w)
ws_in.row_dimensions[1].height=32
last=N+1
REP="'復命用一覧'!"
for r in range(2,last+1):
    ws_in.cell(r,1,f'=IF(COUNTA(B{r}:N{r})=0,"",ROW()-1)')
    ws_in.cell(r,15,f'=IF(N{r}="","",1)')
    ws_in.cell(r,23,f'=IF(G{r}="","",E{r}&G{r})')
    ws_in.cell(r,24,f'=IF(N{r}="","",J{r}&"|"&K{r}&"|"&L{r}&"|"&M{r}&"|"&N{r})')
    ws_in.cell(r,25,f'=IF(AND(B{r}<>"",B{r}={REP}$C$2,OR({REP}$L$3="",ISNUMBER(SEARCH({REP}$L$3,W{r}))),OR({REP}$L$4="",ISNUMBER(SEARCH({REP}$L$4,W{r}))),OR({REP}$L$5="",ISNUMBER(SEARCH({REP}$L$5,W{r})))),1,0)')
    ws_in.cell(r,26,f'=IF(Y{r}=1,SUM($Y$2:Y{r}),"")')
    ws_in.cell(r,27,f'=IF(N{r}="","",IF(問題点入力表!$U$2,J{r},"")&"|"&IF(問題点入力表!$U$3,K{r},"")&"|"&IF(問題点入力表!$U$4,L{r},"")&"|"&IF(問題点入力表!$U$5,M{r},"")&"|"&IF(問題点入力表!$U$6,N{r},""))')
    ws_in.cell(r,3).number_format='yyyy/mm/dd'
    for c in (16,17): ws_in.cell(r,c).alignment=Alignment(wrap_text=True,vertical='top')
for c in range(23,28): ws_in.column_dimensions[L(c)].hidden=True
def dv_list(f,col,msg=None):
    dv=DataValidation(type='list',formula1=f,allow_blank=True); dv.errorStyle='warning'; dv.showErrorMessage=True
    dv.errorTitle='リストにない値'; dv.error=msg or 'リストにない値です。このまま入力しますか？'; dv.add(f'{col}2:{col}{last}'); ws_in.add_data_validation(dv)
dv_list(f"リスト!$O$2:$O${len(s1)+1}",'D')
dv_list('OFFSET(リスト!$R$1,MATCH($D2,リスト!$Q:$Q,0)-1,0,COUNTIF(リスト!$Q:$Q,$D2),1)','E')
dv_list('OFFSET(リスト!$U$1,MATCH($D2&"|"&$E2,リスト!$T:$T,0)-1,0,COUNTIF(リスト!$T:$T,$D2&"|"&$E2),1)','F')
dv_list('OFFSET(リスト!$X$1,MATCH($D2&"|"&$E2&"|"&$F2,リスト!$W:$W,0)-1,0,COUNTIF(リスト!$W:$W,$D2&"|"&$E2&"|"&$F2),1)','G')
dv_list(f"リスト!$A$2:$A${len(l1)+1}",'J')
dv_list('OFFSET(リスト!$D$1,MATCH($J2,リスト!$C:$C,0)-1,0,COUNTIF(リスト!$C:$C,$J2),1)','K')
dv_list('OFFSET(リスト!$G$1,MATCH($J2&"|"&$K2,リスト!$F:$F,0)-1,0,COUNTIF(リスト!$F:$F,$J2&"|"&$K2),1)','L')
dv_list('OFFSET(リスト!$J$1,MATCH($J2&"|"&$K2&"|"&$L2,リスト!$I:$I,0)-1,0,COUNTIF(リスト!$I:$I,$J2&"|"&$K2&"|"&$L2),1)','M')
dv_list('OFFSET(リスト!$M$1,MATCH($J2&"|"&$K2&"|"&$L2&"|"&$M2,リスト!$L:$L,0)-1,0,COUNTIF(リスト!$L:$L,$J2&"|"&$K2&"|"&$L2&"|"&$M2),1)','N')
dv_list('M_設定!$A$2:$A$9','H'); dv_list('M_設定!$C$2:$C$11','R'); dv_list('M_設定!$E$2:$E$4','S'); dv_list('M_設定!$G$2:$G$3','V')
dv=DataValidation(type='whole',operator='greaterThanOrEqual',formula1='1',allow_blank=True); dv.add(f'B2:B{last}'); ws_in.add_data_validation(dv)
dv=DataValidation(type='date',operator='greaterThan',formula1='36526',allow_blank=True); dv.add(f'C2:C{last}'); ws_in.add_data_validation(dv)
tab=Table(displayName='T_検出事項',ref=f'A1:{L(len(cols))}{last}'); tab.tableStyleInfo=TableStyleInfo(name='TableStyleLight9',showRowStripes=True); ws_in.add_table(tab)
ws_in.conditional_formatting.add(f'P2:P{last}',FormulaRule(formula=['AND(LEFT($N2,5)="（その他）",$P2="")'],fill=PatternFill('solid',bgColor='F8CBAD',fgColor='F8CBAD')))
ws_in.freeze_panes='B2'
# テストデータ
if TESTROWS:
    T=json.load(open(TESTROWS,encoding='utf-8'))
    for k,t in enumerate(T,2):
        vals={2:t['年度'],3:datetime.date.fromisoformat(t['日付']),4:t['bk'],5:t['ky'],6:t['bu'],7:t['ka'],8:t['グループ'],9:t['担当'],10:t['i1'],11:t['i2'],12:t['i3'] or None,13:t['cat'],14:t['prob'],16:t['内容'],17:t['詳細'],18:t['状況'],19:t['備考'] or None,20:t['根拠'] or None,21:t['kw'],22:t['周知']}
        for c,x in vals.items(): ws_in.cell(k,c,x)
# ---------- 復命用一覧 ----------
ws_rep['A1']='復命用 検出事項一覧'; ws_rep['A1'].font=Font(name=FONT,bold=True,size=14)
ws_rep['B2']='監査年度(令和)'; ws_rep['C2']=8; ws_rep['B3']='対象局課名(空欄=全て)'
for a in ('C2','C3'): ws_rep[a].fill=inp_fill; ws_rep[a].border=box
ws_rep['E2']='→「入力」シートの該当データを自動で並べます。そのままコピーして復命書に貼り付けできます。'; ws_rep['E2'].font=Font(name=FONT,size=9,color='7F7F7F')
ws_rep['E3']='→ 空欄=全て／スペース区切りで複数語(すべてを含む局課)／「東区役所」は「東区」として検索'; ws_rep['E3'].font=Font(name=FONT,size=9,color='7F7F7F')
rc=[('No.',6),('課名等',26),('項目',46),('問題点(件数)',46),('備考',22),('詳細',60),('対応状況',26),('問題点区分',12),('担当',10)]
for j,(t,w) in enumerate(rc,1): head(ws_rep,5,j,t,w)
ws_rep['K2']='正規化'; ws_rep['L2']='=TRIM(SUBSTITUTE(SUBSTITUTE($C$3,"　"," "),"区役所","区"))'
ws_rep['K3']='語1'; ws_rep['L3']='=IFERROR(LEFT(L2,FIND(" ",L2)-1),L2)'; ws_rep['M3']='=IFERROR(TRIM(MID(L2,FIND(" ",L2)+1,200)),"")'
ws_rep['K4']='語2'; ws_rep['L4']='=IFERROR(LEFT(M3,FIND(" ",M3)-1),M3)'; ws_rep['M4']='=IFERROR(TRIM(MID(M3,FIND(" ",M3)+1,200)),"")'
ws_rep['K5']='語3'; ws_rep['L5']='=M4'
for c in 'KLM': ws_rep.column_dimensions[c].hidden=True
RR=500
for r in range(6,6+RR):
    ws_rep.cell(r,1,f'=IF(ROW()-5<=MAX(入力!$Z$2:$Z${last}),ROW()-5,"")')
    def ix(c): return f'=IF($A{r}="","",INDEX(入力!${c}$2:${c}${last},MATCH($A{r},入力!$Z$2:$Z${last},0))&"")'
    ws_rep.cell(r,2,ix('W'))
    ws_rep.cell(r,3,f'=IF($A{r}="","",INDEX(入力!$K$2:$K${last},MATCH($A{r},入力!$Z$2:$Z${last},0))&" "&INDEX(入力!$L$2:$L${last},MATCH($A{r},入力!$Z$2:$Z${last},0)))')
    ws_rep.cell(r,4,f'=IF($A{r}="","",INDEX(入力!$N$2:$N${last},MATCH($A{r},入力!$Z$2:$Z${last},0))&"("&INDEX(入力!$O$2:$O${last},MATCH($A{r},入力!$Z$2:$Z${last},0))&"件)")')
    ws_rep.cell(r,5,ix('S')); ws_rep.cell(r,6,ix('Q')); ws_rep.cell(r,7,ix('R')); ws_rep.cell(r,8,ix('M')); ws_rep.cell(r,9,ix('I'))
    for c in range(1,10): ws_rep.cell(r,c).alignment=Alignment(wrap_text=True,vertical='top'); ws_rep.cell(r,c).font=base
ws_rep.freeze_panes='A6'
# ---------- 問題点入力表(4行目の〇で集計項目を切り替え) ----------
ws_cr['A1']='問題点入力表(自動集計)'; ws_cr['A1'].font=Font(name=FONT,bold=True,size=14)
ws_cr['A2']='監査年度(令和)'; ws_cr['B2']=8; ws_cr['A3']='対象局課名(空欄=全て)'
for a in ('B2','B3'): ws_cr[a].fill=inp_fill; ws_cr[a].border=box
ws_cr['P2']='正規化'; ws_cr['Q2']='=TRIM(SUBSTITUTE(SUBSTITUTE($B$3,"　"," "),"区役所","区"))'
ws_cr['P3']='語1'; ws_cr['Q3']='=IFERROR(LEFT(Q2,FIND(" ",Q2)-1),Q2)'; ws_cr['R3']='=IFERROR(TRIM(MID(Q2,FIND(" ",Q2)+1,200)),"")'
ws_cr['P4']='語2'; ws_cr['Q4']='=IFERROR(LEFT(R3,FIND(" ",R3)-1),R3)'; ws_cr['R4']='=IFERROR(TRIM(MID(R3,FIND(" ",R3)+1,200)),"")'
ws_cr['P5']='語3'; ws_cr['Q5']='=R4'
for i,(c) in enumerate('ABCDE',2):
    ws_cr[f'U{i}']=f'=OR(COUNTA($A$4:$E$4)=0,${c}$4<>"")'
crit='入力!$W$2:$W$%d,"*"&$Q$3&"*",入力!$W$2:$W$%d,"*"&$Q$4&"*",入力!$W$2:$W$%d,"*"&$Q$5&"*"'%(last,last,last)
ws_cr['D2']='入力件数計'; ws_cr['E2']=f'=SUMIFS(入力!$O$2:$O${last},入力!$B$2:$B${last},$B$2,{crit})'
ws_cr['D3']='本表の合計'; ws_cr['F2']='差(※マスタ外の問題点を自由入力した分)'
ws_cr['F3']='←「合計」列を絞り込み(0を除外)すると、検出のあった項目だけ表示されます。'
ws_cr['A4']=None
for c in 'ABCDE':
    x=ws_cr[f'{c}4']; x.fill=inp_fill; x.border=box; x.alignment=Alignment(horizontal='center'); x.font=Font(name=FONT,bold=True,color='C00000')
ws_cr['F4']='← 集計したい項目の4行目に「〇」を付ける(複数可)。すべて空欄=すべての項目で細かく集計。'; ws_cr['F4'].font=Font(name=FONT,size=9,color='C00000',bold=True)
for a in ('D2','D3','F2','F3'): ws_cr[a].font=Font(name=FONT,size=9)
for j,t in enumerate(['項目1','項目(2)','項目(3)','区分','問題点','合計'],1): head(ws_cr,5,j,t,[20,28,30,10,48,7][j-1])
GC0=7
for g in range(GROUPS):
    c=GC0+g; head(ws_cr,5,c,None,9); ws_cr.cell(5,c).value=f'=IF(M_設定!$A${2+g}="","",M_設定!$A${2+g})'
head(ws_cr,5,16,'位置',6); head(ws_cr,5,19,'順位',6); head(ws_cr,5,20,'集計キー',6)
e0=6; e1=5+NM-1     # 表示スロット(マスタ件数分)
for i in range(NM-1):
    r=6+i; mr=2+i
    ws_cr.cell(r,20,f'=IF($U$2,M_問題点!A{mr}&"","")&"|"&IF($U$3,M_問題点!B{mr}&"","")&"|"&IF($U$4,M_問題点!C{mr}&"","")&"|"&IF($U$5,M_問題点!D{mr}&"","")&"|"&IF($U$6,M_問題点!E{mr}&"","")')
    ws_cr.cell(r,19,f'=IF(COUNTIF($T$6:T{r},T{r})=1,MAX($S$5:S{r-1})+1,"")' if r>6 else f'=IF(COUNTIF($T$6:T{r},T{r})=1,1,"")')
    ws_cr.cell(r,16,f'=IFERROR(MATCH({r-5},$S$6:$S${e1},0),"")')
    for k,c in enumerate('ABCDE'):
        ws_cr.cell(r,1+k,f'=IF($P{r}="","",IF($U${2+k},INDEX(M_問題点!${"ABCDE"[k]}$2:${"ABCDE"[k]}${NM},$P{r})&"",""))')
    ws_cr.cell(r,6,f'=IF($P{r}="","",SUM(G{r}:N{r}))')
    for g in range(GROUPS):
        c=GC0+g; cl=L(c)
        ws_cr.cell(r,c,f'=IF({cl}$5="","",IF($P{r}="","",SUMIFS(入力!$O$2:$O${last},入力!$AA$2:$AA${last},INDEX($T$6:$T${e1},$P{r}),入力!$B$2:$B${last},$B$2,入力!$H$2:$H${last},{cl}$5,{crit})))')
ws_cr['E3']=f'=SUM(F6:F{e1})'
for c in (15,16,17,18,19,20,21): ws_cr.column_dimensions[L(c)].hidden=True
ws_cr.freeze_panes='F6'; ws_cr.auto_filter.ref=f'A5:N{e1}'
ws_cr.conditional_formatting.add(f'F6:N{e1}',FormulaRule(formula=['AND(ISNUMBER(F6),F6>0)'],fill=PatternFill('solid',bgColor='FFE699',fgColor='FFE699')))
# ---------- 区分別集計 ----------
ws_sm['A1']='区分別・グループ別 件数(自動集計)'; ws_sm['A1'].font=Font(name=FONT,bold=True,size=14)
ws_sm['A2']='監査年度(令和)'; ws_sm['B2']=8; ws_sm['B2'].fill=inp_fill; ws_sm['B2'].border=box
head(ws_sm,4,1,'区分',14)
for g in range(GROUPS): head(ws_sm,4,2+g,None,10); ws_sm.cell(4,2+g).value=f'=IF(M_設定!$A${2+g}="","",M_設定!$A${2+g})'
head(ws_sm,4,2+GROUPS,'計',8)
for i in range(5):
    r=5+i; ws_sm.cell(r,1,f'=M_設定!$I${2+i}')
    for g in range(GROUPS):
        cl=L(2+g); ws_sm.cell(r,2+g,f'=IF({cl}$4="","",SUMIFS(入力!$O$2:$O${last},入力!$M$2:$M${last},$A{r},入力!$B$2:$B${last},$B$2,入力!$H$2:$H${last},{cl}$4))')
    ws_sm.cell(r,2+GROUPS,f'=SUM(B{r}:{L(1+GROUPS)}{r})')
ws_sm.cell(10,1,'合計').font=Font(name=FONT,bold=True)
for g in range(GROUPS+1): cl=L(2+g); ws_sm.cell(10,2+g,f'=SUM({cl}5:{cl}9)').font=Font(name=FONT,bold=True)
# ---------- 別紙(復命用): 原本の書式をコピー ----------
src=openpyxl.load_workbook(ORIG).worksheets[0]
def cp(d,s):
    d.font=copy(s.font); d.border=copy(s.border); d.fill=copy(s.fill); d.alignment=copy(s.alignment); d.number_format=s.number_format; d.protection=copy(s.protection)
def copy_row(sr,dr):
    for c in range(1,24):
        s=src.cell(sr,c); d=ws_bs.cell(dr,c)
        cp(d,s)
        if s.value is not None and not (isinstance(s.value,str) and s.value.startswith('=')): d.value=s.value
    h=src.row_dimensions[sr].height
    if h: ws_bs.row_dimensions[dr].height=h
for r in range(1,9): copy_row(r,r)
ws_bs['A2']="=IF('復命用一覧'!$C$3=\"\",\"○○局及び関連区役所等\",'復命用一覧'!$C$3)&\"の監査結果\""
for k,w in {'A':3.375,'B':17.25,'C':30.25,'J':19.25,'K':15,'L':75.125,'M':49.25,'N':68.375}.items(): ws_bs.column_dimensions[k].width=w
for c in 'DEFGHI': ws_bs.column_dimensions[c].width=4.625
for c in 'OPQRST': ws_bs.column_dimensions[c].width=9
def nob(c): 
    x=copy(c.border); return Border()
IN2=lambda c:'入力!$%s$2:$%s$%d'%(c,c,last)
for r in range(D0,D1+1):
    X='$X%d'%r; ix=lambda c:'INDEX(%s,%s)'%(IN2(c),X)
    ws_bs.row_dimensions[r].height=55
    styles={1:(src.cell(9,1),False),2:(src.cell(9,2),True),3:(src.cell(9,3),True),10:(src.cell(9,10),True),11:(src.cell(9,11),True),12:(src.cell(9,12),True),13:(src.cell(9,13),True),14:(src.cell(10,14),True)}
    for c in range(4,10): styles[c]=(src.cell(9,5),True)
    for c in range(15,21): styles[c]=(src.cell(9,c),False)
    for c,(sc,nb) in styles.items():
        d=ws_bs.cell(r,c); cp(d,sc)
        if nb: d.border=Border()
    ws_bs.cell(r,24,f'=IFERROR(MATCH({r-D0+1},$Y$2:$Y$2001,0),"")')
    ws_bs.cell(r,1,f'=IF({X}="","",ROW()-{D0-1})')
    if r==D0: ws_bs.cell(r,2,f'=IF({X}="","",{ix("G")})')
    else: ws_bs.cell(r,2,f'=IF({X}="","",IF({ix("W")}=INDEX({IN2("W")},$X{r-1}),"",{ix("G")}))')
    ws_bs.cell(r,3,f'=IF({X}="","",{ix("N")})')
    for c in range(4,9):
        L_=L(c); tot=f'IF(ROW()-{D0-1}=COUNT($A${D0}:$A${D1})+1,SUM({L_}${D0}:{L_}{r-1}),"")' if r>D0 else '""'
        ws_bs.cell(r,c,f'=IF({X}="",{tot},IF({ix("M")}={L_}$8,1,""))')
    tot=f'IF(ROW()-{D0-1}=COUNT($A${D0}:$A${D1})+1,SUM(I${D0}:I{r-1}),"")' if r>D0 else '""'
    ws_bs.cell(r,9,f'=IF({X}="",{tot},SUM(D{r}:H{r}))')
    ws_bs.cell(r,10,f'=IF({X}="","",{ix("S")}&"")')
    ws_bs.cell(r,12,f'=IF({X}="","",{ix("P")}&IF({ix("Q")}<>"",CHAR(10)&{ix("Q")},""))')
    ws_bs.cell(r,14,f'=IF({X}="","",{ix("R")}&"")')
    ws_bs.cell(r,16,f'=IF({X}="","",IFERROR(VALUE(ASC(LEFT({ix("J")},1))),""))')
    ws_bs.cell(r,17,f'=IF({X}="","",IFERROR(VALUE(MID({ix("K")},2,FIND(")",{ix("K")})-2)),""))')
    ws_bs.cell(r,18,f'=IF({X}="","",IFERROR(UNICODE(LEFT({ix("L")},1))-9311,""))')
    ws_bs.cell(r,19,f'=IF({X}="","",{ix("M")}&"")')
    ws_bs.cell(r,20,f'=IF({X}="","",{ix("I")}&"")')
for r in range(2,2002):
    ws_bs.cell(r,25,f'=IF(入力!Y{r}=1,COUNTIFS({IN2("Y")},1,{IN2("W")},"<"&入力!W{r})+COUNTIFS(入力!$Y$2:Y{r},1,入力!$W$2:W{r},入力!W{r}),"")')
for r in range(78,85): copy_row(r,r+(R78-78))
for m in ['A2:J2','B5:J5','B7:B8','C7:C8','D7:I7','J7:J8','K7:N7','R2:V3']: ws_bs.merge_cells(m)
for r in (79,80,83,84): ws_bs.merge_cells(f'C{r+R78-78}:I{r+R78-78}')
for c in ('X','Y'): ws_bs.column_dimensions[c].hidden=True
# 罫線の条件付き書式(データのある行だけ罫線を引く)
def bd(*sides):
    t=Side(style='thin'); return Border(**{s:t for s in sides})
def cf(rng,formula,border,pri,stop=False):
    r=Rule(type='expression',dxf=DifferentialStyle(border=border),formula=[formula],stopIfTrue=stop); ws_bs.conditional_formatting.add(rng,r)
nxt=f'OR($X{D0+1}="",$B{D0+1}<>"")'
cf(f'B{D0}:B{D1}',f'AND($X{D0}<>"",$B{D0}<>"",{nxt})',bd('left','right','top','bottom'),1,True)
cf(f'B{D0}:B{D1}',f'AND($X{D0}<>"",$B{D0}<>"")',bd('left','right','top'),2,True)
cf(f'B{D0}:B{D1}',f'AND($X{D0}<>"",{nxt})',bd('left','right','bottom'),3,True)
cf(f'B{D0}:B{D1}',f'$X{D0}<>""',bd('left','right'),4,True)
cf(f'C{D0}:N{D1}',f'$X{D0}<>""',bd('left','right','top','bottom'),5)
ws_bs.sheet_properties.pageSetUpPr=PageSetupProperties(fitToPage=True)
ws_bs.page_setup.orientation='landscape'; ws_bs.page_setup.paperSize=8; ws_bs.page_setup.scale=85; ws_bs.page_setup.fitToHeight=0; ws_bs.page_setup.fitToWidth=1
ws_bs.print_title_rows='7:8'; ws_bs.print_area=f'A1:M{R78+6}'
ws_bs.page_margins.left=ws_bs.page_margins.right=0.5118; ws_bs.page_margins.top=ws_bs.page_margins.bottom=0.5512
ws_bs.sheet_view.zoomScaleNormal=90
# ---------- 検討経緯 / 使い方 / フォームコード ----------
ws_k.column_dimensions['A'].width=16; ws_k.column_dimensions['B'].width=110
ws_k['A1']='検討経緯(やり取りの記録)'; ws_k['A1'].font=Font(name=FONT,bold=True,size=14)
log=[('提案','検出事項を「1問題点＝1件」で入力し、分類は問題点入力表の項目からプルダウンで選ぶ形にします。'),
('回答','良いと思います。なお、検出事項の分類についてはあまり項目数を増やしたくないと考えており、頻出のものだけを定型化し、それ以外は「その他」として、内容を別途記載する運用にしたいと考えています。'),
('方針の変更','Access での管理は取りやめ、Excel(Teams等で共有)で管理する。'),
('追加要望','①入力フォームに行番号(No.)を入力すると、その行を読み込んで修正できるようにする。\n②問題点入力表の4行目に「〇」を付けた項目で集計できるようにする。\n③所属を、所属一覧のように 部局→局→部→課 の順に選べるようにする(所属マスタは組織CD付きCSVから作成)。'),
('本ブックでの反映','①②③を実装。分類は「（その他）内容欄に記載」を設け、未記入だと内容欄が赤く表示される。件数は自動で1(1問題点＝1件)。')]
head(ws_k,3,1,'区分',16); head(ws_k,3,2,'内容',110)
for i,(a,b) in enumerate(log,4):
    ws_k.cell(i,1,a).font=Font(name=FONT,bold=True,size=10); c=ws_k.cell(i,2,b); c.font=base
    ws_k.cell(i,1).alignment=Alignment(vertical='top'); c.alignment=Alignment(wrap_text=True,vertical='top'); ws_k.cell(i,1).border=box; c.border=box
txt=['検出事項データベース(Excel版 v3)','','■ 目的','実地監査報告書の検出事項を「入力」シートに1件1行で蓄積し、復命用の一覧・別紙・問題点入力表を自動で作ります。','',
'■ 入力のしかた','・入力フォーム(KensyutsuMacros.bas の OpenInputForm)から入力するのがおすすめです。「入力」シートへ直接入力しても構いません。',
'・所属は 部局→局→部→課 の順、分類は 項目1→(2)→(3)→区分→問題点 の順に、ドロップダウンから選びます。',
'・「1問題点＝1件」で入力します。当てはまらないものは「（その他）内容欄に記載」を選び、内容欄に具体的に書きます(未記入だと赤くなります)。','',
'■ 修正のしかた','・入力フォームの「No.」に、入力シートA列の番号を入れて「読込」すると、その行を修正できます(「修正を保存」で上書き、「削除」でその行を空にします)。','',
'■ 集計','・問題点入力表: 年度を入れると、問題点×グループの件数を集計します。4行目の「〇」で、集計する項目を切り替えます(例: 項目(2)に〇 → 項目(2)ごとの件数)。すべて空欄なら、すべての項目で細かく集計します。',
'・対象局課名は、空欄=全て、文字を入れると部分一致(スペース区切りで複数語、「東区役所」は「東区」)で絞り込みます。','・別紙(復命用): 復命用一覧の年度・局課名で絞り込んだ内容を、原本の様式で出力します。マクロ FitBesshiRows で行の高さを整えます。','',
'■ 設置(マクロ)','1. このファイルを .xlsm で保存 → 2. KensyutsuMacros.bas をインポート → 3. InstallForm を1回実行(「VBAプロジェクト オブジェクト モデルへのアクセスを信頼する」を有効に) → 4. OpenInputForm で入力画面を開く。','',
'■ 注意','・テストデータが入っている場合は、「(テスト)」「テストデータ」の行を本番前に削除してください。','・受託者名・金額等を含む場合は、アクセス権を最小限にしてください。']
ws_use.column_dimensions['A'].width=130
for i,t in enumerate(txt,1):
    c=ws_use.cell(i,1,t); c.font=Font(name=FONT,size=14 if i==1 else 10,bold=t.startswith('■') or i==1); c.alignment=Alignment(wrap_text=True)
if FORMCODE:
    for i,l in enumerate(open(FORMCODE,encoding='utf-8').read().split('\n'),1):
        l=l.rstrip('\r')
        if l: ws_fc.cell(i,1).value=l; ws_fc.cell(i,1).data_type='s'
ws_fc.sheet_state='hidden'
for ws in wb.worksheets: ws.sheet_view.zoomScale=90
wb.active=2
wb.save(OUT); print('saved',OUT,len(SHZ),'所属行')
