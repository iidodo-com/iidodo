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
OUT=os.environ.get('OUTFILE',ROOT+'/検出事項データベース_v5.xlsx')
PROB=ROOT+'/m_problem.tsv'
SHZ_XLSX=glob.glob('/root/.claude/uploads/*/*2026.xlsx')[0]
ORIG=glob.glob('/root/.claude/uploads/*/2a4800bf*.xlsx')[0]
FORMCODE=os.environ.get('FORMCODE'); TESTROWS=os.environ.get('TESTROWS')
N=2000; GROUPS=8; NROW=150; D0=9; D1=D0+NROW-1; R78=D1+3
FONT='Meiryo UI'
hdr_fill=PatternFill('solid',fgColor='1F4E78'); hdr_font=Font(name=FONT,bold=True,color='FFFFFF')
auto_fill=PatternFill('solid',fgColor='7F7F7F')
inp_fill=PatternFill('solid',fgColor='FFF2CC'); thin=Side(style='thin',color='BFBFBF'); box=Border(left=thin,right=thin,top=thin,bottom=thin)
base=Font(name=FONT,size=10)
# ---------- マスタ ----------
M=[dict(i1=r[1],i2=r[2],i3=r[3],cat=r[4],prob=r[5],desc=r[6] if len(r)>6 else '') for r in [r for r in csv.reader(open(PROB,encoding='utf-8'),delimiter='\t')][1:]]
_ws=openpyxl.load_workbook(SHZ_XLSX,data_only=True).active
SHZ=[]    # (部局, 局, 部, 課, 課CD)  ※ 局=E列, 部=G列, 課=I列(正式名称)
for r in _ws.iter_rows(min_row=3):
    v=[c.value for c in r][:9]
    if v[8]: SHZ.append((v[2],v[4],v[6],v[8],v[7]))
TARGETS=list(OrderedDict((z[1],1) for z in SHZ if not z[1].endswith('区役所')))   # 対象局(令達元)の候補
wb=Workbook()
names=['使い方','検討経緯','入力','復命用一覧','別紙(復命用)','問題点入力表','区分別集計','M_問題点','M_所属','M_設定','リスト','フォームコード']
ws_use=wb.active; ws_use.title=names[0]
S={n:wb.create_sheet(n) for n in names[1:]}
ws_k=S['検討経緯']; ws_in=S['入力']; ws_rep=S['復命用一覧']; ws_bs=S['別紙(復命用)']; ws_cr=S['問題点入力表']; ws_sm=S['区分別集計']
ws_m=S['M_問題点']; ws_s=S['M_所属']; ws_set=S['M_設定']; ws_l=S['リスト']; ws_fc=S['フォームコード']
def head(ws,r,c,text,w=None,fill=None):
    x=ws.cell(r,c,text); x.fill=fill or hdr_fill; x.font=hdr_font; x.border=box
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
# ---------- M_所属(正式名称。局=E列/部=G列/課=I列) ----------
for j,(t,w) in enumerate([('局',24),('部',30),('課',34),('課CD',14),('部局(参考)',24)],1): head(ws_s,1,j,t,w)
for i,z in enumerate(SHZ,2):
    for j,v in enumerate([z[1],z[2],z[3],z[4],z[0]],1): ws_s.cell(i,j,v)
ws_s.freeze_panes='A2'; ws_s.auto_filter.ref=f'A1:E{len(SHZ)+1}'
ws_s['G1']='※所属マスタ(2026)の局名称(E列)・部名称(G列)・課名称(I列)を使用。'; ws_s['G1'].font=Font(name=FONT,size=9,color='7F7F7F')
# ---------- リスト(連動ドロップダウン用) ----------
def gb(keyf,valf,src):
    d=OrderedDict()
    for m in src:
        v=valf(m)
        if v=='' or v is None: continue
        d.setdefault(keyf(m),OrderedDict())[v]=1
    return [(k,v) for k,vs in d.items() for v in vs]
l1=list(OrderedDict((m['i1'],1) for m in M))
l2=gb(lambda m:m['i1'],lambda m:m['i2'],M); l3=gb(lambda m:m['i1']+'|'+m['i2'],lambda m:m['i3'],M)
l4=gb(lambda m:m['i1']+'|'+m['i2']+'|'+m['i3'],lambda m:m['cat'],M); l5=gb(lambda m:m['i1']+'|'+m['i2']+'|'+m['i3']+'|'+m['cat'],lambda m:m['prob'],M)
Z=[dict(k=z[1],b=z[2],c=z[3]) for z in SHZ]
s1=list(OrderedDict((z['k'],1) for z in Z)); s2=gb(lambda z:z['k'],lambda z:z['b'],Z); s3=gb(lambda z:z['k']+'|'+z['b'],lambda z:z['c'],Z)
ws_l['A1']='項目1'; ws_l['O1']='局'; ws_l['W1']='対象局'
for i,v in enumerate(l1,2): ws_l.cell(i,1,v)
for i,v in enumerate(s1,2): ws_l.cell(i,15,v)
for i,v in enumerate(TARGETS,2): ws_l.cell(i,23,v)
for c0,lst,name in ((3,l2,'項目2'),(6,l3,'項目3'),(9,l4,'区分'),(12,l5,'問題点'),(17,s2,'部'),(20,s3,'課')):
    ws_l.cell(1,c0,'キー'); ws_l.cell(1,c0+1,name)
    for i,(k,v) in enumerate(lst,2): ws_l.cell(i,c0,k); ws_l.cell(i,c0+1,v)
ws_l.sheet_state='hidden'
# ---------- 入力 ----------
# A No / B 年度 / C 日付 / D 対象局 / E 局 / F 部 / G 課 / H 所属名(自動) / I グループ / J 担当者 / K〜O 分類 / P 件数(自動)
# Q 内容 / R 詳細 / S 対応状況 / T 備考区分 / U 根拠規定 / V キーワード / W 全庁周知 / X〜AB 自動
cols=[('No.',6),('監査年度\n(令和)',9),('実地監査\n年月日',12),('対象局',16),('局',16),('部',22),('課',22),('所属名\n(自動)',26),('グループ',10),('担当者',10),
      ('項目1',22),('項目(2)',26),('項目(3)',26),('区分',11),('問題点',40),('件数\n(自動)',6),
      ('内容(要約)',40),('詳細(事例・誤/正・金額等)',50),('対応状況',26),('備考区分',22),('根拠規定',24),('キーワード\n(;区切り)',20),('全庁周知',9),
      ('キー(自動)',8),('抽出(自動)',8),('出力順(自動)',8),('集計キー(自動)',8),('日付キー(自動)',8)]
for j,(t,w) in enumerate(cols,1): head(ws_in,1,j,t,w,auto_fill if '(自動)' in t else None)
ws_in.row_dimensions[1].height=32
last=N+1
REP="'復命用一覧'!"
for r in range(2,last+1):
    ws_in.cell(r,1,f'=IF(COUNTA(B{r}:G{r},I{r}:O{r})=0,"",ROW()-1)')
    ws_in.cell(r,8,f'=IF(G{r}="","",IF(RIGHT(E{r},3)="区役所",LEFT(E{r},LEN(E{r})-2),E{r})&IF(ISNUMBER(SEARCH("（部",F{r})),"",IF(F{r}=G{r},"",F{r}))&G{r})')
    ws_in.cell(r,16,f'=IF(O{r}="","",1)')
    ws_in.cell(r,24,f'=IF(O{r}="","",K{r}&"|"&L{r}&"|"&M{r}&"|"&N{r}&"|"&O{r})')
    ws_in.cell(r,25,f'=IF(AND(COUNTA(B{r}:G{r},I{r}:O{r})>0,OR({REP}$C$2="",B{r}={REP}$C$2),OR({REP}$C$3="",D{r}={REP}$C$3),AB{r}>={REP}$AH$2,AB{r}<={REP}$AH$3,OR({REP}$AF$3="",ISNUMBER(SEARCH({REP}$AF$3,H{r}))),OR({REP}$AF$4="",ISNUMBER(SEARCH({REP}$AF$4,H{r}))),OR({REP}$AF$5="",ISNUMBER(SEARCH({REP}$AF$5,H{r})))),1,0)')
    ws_in.cell(r,26,f'=IF(Y{r}=1,SUM($Y$2:Y{r}),"")')
    ws_in.cell(r,27,f'=IF(O{r}="","",IF(問題点入力表!$AE$2,K{r},"")&"|"&IF(問題点入力表!$AE$3,L{r},"")&"|"&IF(問題点入力表!$AE$4,M{r},"")&"|"&IF(問題点入力表!$AE$5,N{r},"")&"|"&IF(問題点入力表!$AE$6,O{r},""))')
    ws_in.cell(r,28,f'=IF(C{r}="",0,C{r})')
    ws_in.cell(r,3).number_format='yyyy/mm/dd'
    ws_in.cell(r,8).font=Font(name=FONT,size=10,color='595959')
    for c in (17,18): ws_in.cell(r,c).alignment=Alignment(wrap_text=True,vertical='top')
for c in range(24,29): ws_in.column_dimensions[L(c)].hidden=True
def dv_list(f,col,msg=None):
    dv=DataValidation(type='list',formula1=f,allow_blank=True); dv.errorStyle='warning'; dv.showErrorMessage=True
    dv.errorTitle='リストにない値'; dv.error=msg or 'リストにない値です。このまま入力しますか？'; dv.add(f'{col}2:{col}{last}'); ws_in.add_data_validation(dv)
dv_list(f"リスト!$W$2:$W${len(TARGETS)+1}",'D')
dv_list(f"リスト!$O$2:$O${len(s1)+1}",'E')
dv_list('OFFSET(リスト!$R$1,MATCH($E2,リスト!$Q:$Q,0)-1,0,COUNTIF(リスト!$Q:$Q,$E2),1)','F')
dv_list('OFFSET(リスト!$U$1,MATCH($E2&"|"&$F2,リスト!$T:$T,0)-1,0,COUNTIF(リスト!$T:$T,$E2&"|"&$F2),1)','G')
dv_list(f"リスト!$A$2:$A${len(l1)+1}",'K')
dv_list('OFFSET(リスト!$D$1,MATCH($K2,リスト!$C:$C,0)-1,0,COUNTIF(リスト!$C:$C,$K2),1)','L')
dv_list('OFFSET(リスト!$G$1,MATCH($K2&"|"&$L2,リスト!$F:$F,0)-1,0,COUNTIF(リスト!$F:$F,$K2&"|"&$L2),1)','M')
dv_list('OFFSET(リスト!$J$1,MATCH($K2&"|"&$L2&"|"&$M2,リスト!$I:$I,0)-1,0,COUNTIF(リスト!$I:$I,$K2&"|"&$L2&"|"&$M2),1)','N')
dv_list('OFFSET(リスト!$M$1,MATCH($K2&"|"&$L2&"|"&$M2&"|"&$N2,リスト!$L:$L,0)-1,0,COUNTIF(リスト!$L:$L,$K2&"|"&$L2&"|"&$M2&"|"&$N2),1)','O')
dv_list('M_設定!$A$2:$A$9','I'); dv_list('M_設定!$C$2:$C$11','S'); dv_list('M_設定!$E$2:$E$4','T'); dv_list('M_設定!$G$2:$G$3','W')
dv=DataValidation(type='whole',operator='greaterThanOrEqual',formula1='1',allow_blank=True); dv.add(f'B2:B{last}'); ws_in.add_data_validation(dv)
dv=DataValidation(type='date',operator='greaterThan',formula1='36526',allow_blank=True); dv.add(f'C2:C{last}'); ws_in.add_data_validation(dv)
tab=Table(displayName='T_検出事項',ref=f'A1:{L(len(cols))}{last}'); tab.tableStyleInfo=TableStyleInfo(name='TableStyleLight9',showRowStripes=True); ws_in.add_table(tab)
ws_in.conditional_formatting.add(f'Q2:Q{last}',FormulaRule(formula=['AND(LEFT($O2,5)="（その他）",$Q2="")'],fill=PatternFill('solid',bgColor='F8CBAD',fgColor='F8CBAD')))
ws_in.freeze_panes='B2'
if TESTROWS:
    T=json.load(open(TESTROWS,encoding='utf-8'))
    for k,t in enumerate(T,2):
        vals={2:t['年度'],3:datetime.date.fromisoformat(t['日付']),4:t['tg'],5:t['ky'],6:t['bu'],7:t['ka'],9:t['グループ'],10:t['担当'],11:t['i1'],12:t['i2'],13:t['i3'] or None,14:t['cat'],15:t['prob'],17:t['内容'],18:t['詳細'],19:t['状況'],20:t['備考'] or None,21:t['根拠'] or None,22:t['kw'],23:t['周知']}
        for c,x in vals.items(): ws_in.cell(k,c,x)
# ---------- 集計シート共通(上部の条件欄を同じ並びにそろえる) ----------
LAB=Font(name=FONT,size=10,bold=True,color='1F4E78'); NOTE=Font(name=FONT,size=9,color='7F7F7F'); TTL=Font(name=FONT,bold=True,size=14)
def lab(ws,addr,t): ws[addr]=t; ws[addr].font=LAB
def note(ws,addr,t): ws[addr]=t; ws[addr].font=NOTE
def inp(ws,addr,fmt=None):
    c=ws[addr]; c.fill=inp_fill; c.border=box; c.font=Font(name=FONT,size=10)
    if fmt: c.number_format=fmt
def tgt_dv(ws,addr):
    d=DataValidation(type='list',formula1=f"リスト!$W$2:$W${len(TARGETS)+1}",allow_blank=True); d.add(addr); ws.add_data_validation(d)
def helper(ws,dept,fr,to):
    # 計算用セル(見えない列 AA:AM にまとめる): 所属名の語・期間の上下限
    ws['AF2']=f'=TRIM(SUBSTITUTE(SUBSTITUTE({dept},"　"," "),"区役所","区"))'
    ws['AF3']='=IFERROR(LEFT(AF2,FIND(" ",AF2)-1),AF2)'; ws['AG3']='=IFERROR(TRIM(MID(AF2,FIND(" ",AF2)+1,200)),"")'
    ws['AF4']='=IFERROR(LEFT(AG3,FIND(" ",AG3)-1),AG3)'; ws['AG4']='=IFERROR(TRIM(MID(AG3,FIND(" ",AG3)+1,200)),"")'
    ws['AF5']='=AG4'
    ws['AH2']=f'=IFERROR(IF({fr}="",0,DATE(YEAR({fr}),MONTH({fr}),1)),0)'; ws['AH3']=f'=IFERROR(IF({to}="",99999,EOMONTH({to},0)),99999)'
    ws.column_dimensions.group('AA','AM',hidden=True)
def flt_str(yr,tg):
    return ('入力!$B$2:$B$%d,">="&IF(%s="",0,%s),入力!$B$2:$B$%d,"<="&IF(%s="",9999,%s),'
            '入力!$AB$2:$AB$%d,">="&$AH$2,入力!$AB$2:$AB$%d,"<="&$AH$3,'
            '入力!$D$2:$D$%d,IF(%s="","<>●",%s),'
            '入力!$H$2:$H$%d,"*"&$AF$3&"*",入力!$H$2:$H$%d,"*"&$AF$4&"*",入力!$H$2:$H$%d,"*"&$AF$5&"*"')%(last,yr,yr,last,yr,yr,last,last,last,tg,tg,last,last,last)
PER_FROM='"FROM "yyyy/mm'; PER_TO='"TO   "yyyy/mm'
# ---------- 復命用一覧 ----------
ws_rep['A1']='復命用 検出事項一覧'; ws_rep['A1'].font=TTL
lab(ws_rep,'B2','監査年度(令和)'); ws_rep['C2']=8; inp(ws_rep,'C2'); note(ws_rep,'E2','空欄=全て')
lab(ws_rep,'B3','対象局'); inp(ws_rep,'C3'); tgt_dv(ws_rep,'C3'); note(ws_rep,'E3','令達元の局を選択(区役所等も、関連する局を選ぶ)。空欄=全て')
lab(ws_rep,'B4','所属名'); inp(ws_rep,'C4'); note(ws_rep,'E4','スペース区切りで複数語(「東区役所」は「東区」として検索)。空欄=全て')
lab(ws_rep,'B5','実地監査の期間(年月)'); inp(ws_rep,'C5',PER_FROM); inp(ws_rep,'D5',PER_TO); note(ws_rep,'E5','2026/6 の形式。空欄=制限なし')
rc=[('No.',6),('所属名',26),('項目',46),('問題点(件数)',46),('備考',22),('詳細',60),('対応状況',26),('問題点区分',12),('担当',10)]
HR=7
for j,(t,w) in enumerate(rc,1): head(ws_rep,HR,j,t,w)
helper(ws_rep,'$C$4','$C$5','$D$5')
RR=500; R0=HR+1
for r in range(R0,R0+RR):
    ws_rep.cell(r,1,f'=IF(ROW()-{HR}<=MAX(入力!$Z$2:$Z${last}),ROW()-{HR},"")')
    def ix(c): return f'=IF($A{r}="","",INDEX(入力!${c}$2:${c}${last},MATCH($A{r},入力!$Z$2:$Z${last},0))&"")'
    ws_rep.cell(r,2,ix('H'))
    ws_rep.cell(r,3,f'=IF($A{r}="","",INDEX(入力!$L$2:$L${last},MATCH($A{r},入力!$Z$2:$Z${last},0))&" "&INDEX(入力!$M$2:$M${last},MATCH($A{r},入力!$Z$2:$Z${last},0)))')
    ws_rep.cell(r,4,f'=IF($A{r}="","",INDEX(入力!$O$2:$O${last},MATCH($A{r},入力!$Z$2:$Z${last},0))&"("&INDEX(入力!$P$2:$P${last},MATCH($A{r},入力!$Z$2:$Z${last},0))&"件)")')
    ws_rep.cell(r,5,ix('T')); ws_rep.cell(r,6,ix('R')); ws_rep.cell(r,7,ix('S')); ws_rep.cell(r,8,ix('N')); ws_rep.cell(r,9,ix('J'))
    for c in range(1,10): ws_rep.cell(r,c).alignment=Alignment(wrap_text=True,vertical='top'); ws_rep.cell(r,c).font=base
ws_rep.freeze_panes=f'A{R0}'
# ---------- 問題点入力表(6行目の〇で集計する階層を切り替え) ----------
ws_cr['A1']='問題点入力表(自動集計)'; ws_cr['A1'].font=TTL
lab(ws_cr,'A2','監査年度(令和)'); ws_cr['B2']=8; inp(ws_cr,'B2'); note(ws_cr,'C2','空欄=全て')
lab(ws_cr,'A3','対象局'); inp(ws_cr,'B3'); tgt_dv(ws_cr,'B3'); note(ws_cr,'C3','令達元の局を選択(区役所等も、関連する局を選ぶ)。空欄=全て')
lab(ws_cr,'A4','所属名'); inp(ws_cr,'B4'); note(ws_cr,'C4','スペース区切りで複数語(「東区役所」は「東区」として検索)。空欄=全て')
lab(ws_cr,'A5','実地監査の期間(年月)'); inp(ws_cr,'B5',PER_FROM); inp(ws_cr,'C5',PER_TO); note(ws_cr,'D5','2026/6 の形式。空欄=制限なし')
for c in 'ABCDE':
    x=ws_cr[f'{c}6']; x.fill=inp_fill; x.border=box; x.alignment=Alignment(horizontal='center'); x.font=Font(name=FONT,bold=True,color='C00000')
note(ws_cr,'F6','← 集計する項目の真上に「〇」(複数なら一番右の列まで、左の列も含めた階層で集計)。すべて空欄=すべての項目で細かく集計')
ws_cr['F6'].font=Font(name=FONT,size=9,bold=True,color='C00000')
lab(ws_cr,'G2','入力件数計'); lab(ws_cr,'G3','本表の合計'); lab(ws_cr,'G4','差')
note(ws_cr,'J4','←マスタ外の問題点を自由入力した分')
helper(ws_cr,'$B$4','$B$5','$C$5')
for i,c in enumerate('ABCDE',2):   # 〇を付けた列(複数なら一番右の列)まで、左の列も含めて集計する
    ws_cr[f'AE{i}']=f'=OR(COUNTA($A$6:$E$6)=0,COUNTA(${c}$6:$E$6)>0)'
flt=flt_str('$B$2','$B$3')
ws_cr['I2']=f'=SUMIFS(入力!$P$2:$P${last},{flt})'
ws_cr['I4']='=I2-I3'
for a in ('I2','I3','I4'): ws_cr[a].font=Font(name=FONT,size=10,bold=True); ws_cr[a].number_format='#,##0'
HR2=7
for j,t in enumerate(['項目1','項目(2)','項目(3)','区分','問題点','合計'],1): head(ws_cr,HR2,j,t,[20,28,30,10,48,7][j-1])
GC0=7
for g in range(GROUPS):
    c=GC0+g; head(ws_cr,HR2,c,None,9); ws_cr.cell(HR2,c).value=f'=IF(M_設定!$A${2+g}="","",M_設定!$A${2+g})'
e1=HR2+NM-1; F0=HR2+1
for i in range(NM-1):
    r=F0+i; mr=2+i
    ws_cr.cell(r,29,f'=IF($AE$2,M_問題点!A{mr}&"","")&"|"&IF($AE$3,M_問題点!B{mr}&"","")&"|"&IF($AE$4,M_問題点!C{mr}&"","")&"|"&IF($AE$5,M_問題点!D{mr}&"","")&"|"&IF($AE$6,M_問題点!E{mr}&"","")')
    ws_cr.cell(r,28,f'=IF(COUNTIF($AC${F0}:AC{r},AC{r})=1,MAX($AB${HR2}:AB{r-1})+1,"")' if r>F0 else f'=IF(COUNTIF($AC${F0}:AC{r},AC{r})=1,1,"")')
    ws_cr.cell(r,27,f'=IFERROR(MATCH({i+1},$AB${F0}:$AB${e1},0),"")')
    for k in range(5):
        ws_cr.cell(r,1+k,f'=IF($AA{r}="","",IF($AE${2+k},INDEX(M_問題点!${"ABCDE"[k]}$2:${"ABCDE"[k]}${NM},$AA{r})&"",""))')
    ws_cr.cell(r,6,f'=IF($AA{r}="","",SUM(G{r}:N{r}))')
    for g in range(GROUPS):
        c=GC0+g; cl=L(c)
        ws_cr.cell(r,c,f'=IF({cl}${HR2}="","",IF($AA{r}="","",SUMIFS(入力!$P$2:$P${last},入力!$AA$2:$AA${last},INDEX($AC${F0}:$AC${e1},$AA{r}),入力!$I$2:$I${last},{cl}${HR2},{flt})))')
ws_cr['I3']=f'=SUM(F{F0}:F{e1})'
ws_cr.freeze_panes=f'F{F0}'; ws_cr.auto_filter.ref=f'A{HR2}:N{e1}'
ws_cr.conditional_formatting.add(f'F{F0}:N{e1}',FormulaRule(formula=[f'AND(ISNUMBER(F{F0}),F{F0}>0)'],fill=PatternFill('solid',bgColor='FFE699',fgColor='FFE699')))
# ---------- 区分別集計 ----------
ws_sm['A1']='区分別・グループ別 件数(自動集計)'; ws_sm['A1'].font=TTL
lab(ws_sm,'A2','監査年度(令和)'); ws_sm['B2']=8; inp(ws_sm,'B2'); note(ws_sm,'C2','空欄=全て')
lab(ws_sm,'A3','対象局'); inp(ws_sm,'B3'); tgt_dv(ws_sm,'B3'); note(ws_sm,'C3','令達元の局を選択(区役所等も、関連する局を選ぶ)。空欄=全て')
lab(ws_sm,'A4','所属名'); inp(ws_sm,'B4'); note(ws_sm,'C4','スペース区切りで複数語(「東区役所」は「東区」として検索)。空欄=全て')
lab(ws_sm,'A5','実地監査の期間(年月)'); inp(ws_sm,'B5',PER_FROM); inp(ws_sm,'C5',PER_TO); note(ws_sm,'D5','2026/6 の形式。空欄=制限なし')
helper(ws_sm,'$B$4','$B$5','$C$5')
ws_sm.column_dimensions['A'].width=24; ws_sm.column_dimensions['B'].width=16; ws_sm.column_dimensions['C'].width=16
head(ws_sm,7,1,'区分',24)
for g in range(GROUPS): head(ws_sm,7,2+g,None,16 if g<2 else 12); ws_sm.cell(7,2+g).value=f'=IF(M_設定!$A${2+g}="","",M_設定!$A${2+g})'
head(ws_sm,7,2+GROUPS,'計',10)
flt2=flt_str('$B$2','$B$3')
for i in range(5):
    r=8+i; ws_sm.cell(r,1,f'=M_設定!$I${2+i}')
    for g in range(GROUPS):
        cl=L(2+g); ws_sm.cell(r,2+g,f'=IF({cl}$7="","",SUMIFS(入力!$P$2:$P${last},入力!$N$2:$N${last},$A{r},入力!$I$2:$I${last},{cl}$7,{flt2}))')
    ws_sm.cell(r,2+GROUPS,f'=SUM(B{r}:{L(1+GROUPS)}{r})')
ws_sm.cell(13,1,'合計').font=Font(name=FONT,bold=True)
for g in range(GROUPS+1): cl=L(2+g); ws_sm.cell(13,2+g,f'=SUM({cl}8:{cl}12)').font=Font(name=FONT,bold=True)
# ---------- 別紙(復命用): 原本の書式をコピー ----------
src=openpyxl.load_workbook(ORIG).worksheets[0]
def cp(d,s):
    d.font=copy(s.font); d.border=copy(s.border); d.fill=copy(s.fill); d.alignment=copy(s.alignment); d.number_format=s.number_format; d.protection=copy(s.protection)
def copy_row(sr,dr):
    for c in range(1,24):
        s=src.cell(sr,c); d=ws_bs.cell(dr,c); cp(d,s)
        if s.value is not None and not (isinstance(s.value,str) and s.value.startswith('=')): d.value=s.value
    h=src.row_dimensions[sr].height
    if h: ws_bs.row_dimensions[dr].height=h
for r in range(1,9): copy_row(r,r)
ws_bs['A2']="=IF('復命用一覧'!$C$3=\"\",\"○○局\",'復命用一覧'!$C$3)&\"及び関連区役所等の監査結果\""
for k,w in {'A':3.375,'B':17.25,'C':30.25,'J':19.25,'K':15,'L':75.125,'M':49.25,'N':68.375}.items(): ws_bs.column_dimensions[k].width=w
for c in 'DEFGHI': ws_bs.column_dimensions[c].width=4.625
for c in 'OPQRST': ws_bs.column_dimensions[c].width=9
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
    else: ws_bs.cell(r,2,f'=IF({X}="","",IF({ix("H")}=INDEX({IN2("H")},$X{r-1}),"",{ix("G")}))')
    ws_bs.cell(r,3,f'=IF({X}="","",{ix("O")})')
    for c in range(4,9):
        L_=L(c); tot=f'IF(ROW()-{D0-1}=COUNT($A${D0}:$A${D1})+1,SUM({L_}${D0}:{L_}{r-1}),"")' if r>D0 else '""'
        ws_bs.cell(r,c,f'=IF({X}="",{tot},IF({ix("N")}={L_}$8,1,""))')
    tot=f'IF(ROW()-{D0-1}=COUNT($A${D0}:$A${D1})+1,SUM(I${D0}:I{r-1}),"")' if r>D0 else '""'
    ws_bs.cell(r,9,f'=IF({X}="",{tot},SUM(D{r}:H{r}))')
    ws_bs.cell(r,10,f'=IF({X}="","",{ix("T")}&"")')
    ws_bs.cell(r,12,f'=IF({X}="","",{ix("Q")}&IF({ix("R")}<>"",CHAR(10)&{ix("R")},""))')
    ws_bs.cell(r,14,f'=IF({X}="","",{ix("S")}&"")')
    ws_bs.cell(r,16,f'=IF({X}="","",IFERROR(VALUE(ASC(LEFT({ix("K")},1))),""))')
    ws_bs.cell(r,17,f'=IF({X}="","",IFERROR(VALUE(MID({ix("L")},2,FIND(")",{ix("L")})-2)),""))')
    ws_bs.cell(r,18,f'=IF({X}="","",IFERROR(UNICODE(LEFT({ix("M")},1))-9311,""))')
    ws_bs.cell(r,19,f'=IF({X}="","",{ix("N")}&"")')
    ws_bs.cell(r,20,f'=IF({X}="","",{ix("J")}&"")')
for r in range(2,2002):
    ws_bs.cell(r,25,f'=IF(入力!Y{r}=1,COUNTIFS({IN2("Y")},1,{IN2("H")},"<"&入力!H{r})+COUNTIFS(入力!$Y$2:Y{r},1,入力!$H$2:H{r},入力!H{r}),"")')
for r in range(78,85): copy_row(r,r+(R78-78))
for m in ['A2:J2','B5:J5','B7:B8','C7:C8','D7:I7','J7:J8','K7:N7','R2:V3']: ws_bs.merge_cells(m)
for r in (79,80,83,84): ws_bs.merge_cells(f'C{r+R78-78}:I{r+R78-78}')
for c in ('X','Y'): ws_bs.column_dimensions[c].hidden=True
def bd(*sides):
    t=Side(style='thin'); return Border(**{s:t for s in sides})
def cf(rng,formula,border,stop=False):
    ws_bs.conditional_formatting.add(rng,Rule(type='expression',dxf=DifferentialStyle(border=border),formula=[formula],stopIfTrue=stop))
nxt=f'OR($X{D0+1}="",$B{D0+1}<>"")'
cf(f'B{D0}:B{D1}',f'AND($X{D0}<>"",$B{D0}<>"",{nxt})',bd('left','right','top','bottom'),True)
cf(f'B{D0}:B{D1}',f'AND($X{D0}<>"",$B{D0}<>"")',bd('left','right','top'),True)
cf(f'B{D0}:B{D1}',f'AND($X{D0}<>"",{nxt})',bd('left','right','bottom'),True)
cf(f'B{D0}:B{D1}',f'$X{D0}<>""',bd('left','right'),True)
cf(f'C{D0}:N{D1}',f'$X{D0}<>""',bd('left','right','top','bottom'))
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
('追加要望(1)','①入力フォームに行番号(No.)を入力すると、その行を読み込んで修正できるようにする。\n②問題点入力表の4行目に「〇」を付けた項目で集計できるようにする。\n③所属を、所属一覧のように選べるようにする。'),
('追加要望(2)','集計を年月で行えるように、FROM～TO(実地監査年月日の年月)の期間指定を追加する。'),
('追加要望(3)','正式名称を入力したいので、所属マスタ(2026)の局名称(E列)・部名称(G列)・課名称(I列)を使って、局→部→課の順に選べるようにする。\n基本情報の「対象局課名」を「所属名」に変え、別に「対象局」をドロップダウンで選べるようにする(区役所等の令達先は「○○局に関連する事務」を対象に監査するため、令達元の局ごとに整理できるようにしたい)。\n例(本庁) 対象局:企画総務局 所属名:企画総務局総務課 / 例(区役所等) 対象局:企画総務局 所属名:中区市民部区政調整課'),
('本ブックでの反映','「対象局」(令達元の局。区役所を除く局名の一覧から選択)と、局→部→課の連動選択(所属名は自動作成)を追加。集計・別紙・復命用一覧は、対象局で絞り込める(別紙の見出しは「対象局及び関連区役所等の監査結果」)。\n分類は「（その他）内容欄に記載」を設け、未記入だと内容欄が赤く表示される。件数は自動で1(1問題点＝1件)。\n※部局(広島市(市長部局)など)の選択は、E・G・I列の指定に合わせて外している。必要なら追加できる。')]
head(ws_k,3,1,'区分',16); head(ws_k,3,2,'内容',110)
for i,(a,b) in enumerate(log,4):
    ws_k.cell(i,1,a).font=Font(name=FONT,bold=True,size=10); c=ws_k.cell(i,2,b); c.font=base
    ws_k.cell(i,1).alignment=Alignment(vertical='top'); c.alignment=Alignment(wrap_text=True,vertical='top'); ws_k.cell(i,1).border=box; c.border=box
txt=['検出事項データベース(Excel版 v5)','','■ 目的','実地監査報告書の検出事項を「入力」シートに1件1行で蓄積し、復命用の一覧・別紙・問題点入力表を自動で作ります。','',
'■ 入力のしかた','・入力フォーム(KensyutsuMacros.bas の InstallForm → OpenInputForm)から入力するのがおすすめです。「入力」シートへ直接入力しても構いません。',
'・基本情報: 対象局(令達元の局)を選びます。区役所等の場合も、「どの局に関連する監査か」を選びます。',
'・所属は 局→部→課 の順に選びます(正式名称。所属名は自動で作られます)。分類は 項目1→(2)→(3)→区分→問題点 の順です。',
'・「1問題点＝1件」で入力します。当てはまらないものは「（その他）内容欄に記載」を選び、内容欄に具体的に書きます(未記入だと赤くなります)。','',
'■ 修正のしかた','・入力フォームの「No.」に、入力シートA列の番号を入れて「読込」すると、その行を修正できます(「修正を保存」で上書き、「削除」でその行を空にします)。','',
'■ 集計','・問題点入力表: 見出しの真上(6行目)の「〇」で、集計する項目を切り替えます(例: 項目(2)に〇 → 項目1・項目(2)ごとの件数。複数なら一番右の列まで、左の列も含めて集計)。すべて空欄なら、すべての項目で細かく集計します。',
'・絞り込み: 年度・対象局・所属名(部分一致。スペース区切りで複数語、「東区役所」は「東区」)・実地監査の年月(FROM～TO)。どれも空欄=制限なし。',
'・別紙(復命用): 復命用一覧の絞り込みを、原本の様式で出力します。見出しは「(対象局)及び関連区役所等の監査結果」。マクロ FitBesshiRows で行の高さを整えます。','',
'■ 設置(マクロ)','1. このファイルを .xlsm で保存 → 2. KensyutsuMacros.bas をインポート → 3. InstallForm を1回実行 → 4. OpenInputForm で入力画面を開く。','',
'■ 注意','・テストデータが入っている場合は、「テストデータ」の行を本番前に削除してください。','・受託者名・金額等を含む場合は、アクセス権を最小限にしてください。']
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
wb.save(OUT); print('saved',OUT,len(SHZ),'所属行',len(TARGETS),'対象局')
