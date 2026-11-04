import zipfile,re,shutil,sys
from xml.sax.saxutils import escape
SRC=sys.argv[1]; OUT=sys.argv[2]
SHEET='別紙(復命用)'; NROW=300; D0=9; D1=D0+NROW-1
z=zipfile.ZipFile(SRC); names=z.namelist()
data={n:z.read(n) for n in names}
# ---- styles ----
st=data['xl/styles.xml'].decode('utf-8')
def bump(tag,add_xml,n_add):
    global st
    m=re.search(r'<%s count="(\d+)"'%tag,st); c=int(m.group(1))
    st=st.replace(m.group(0),'<%s count="%d"'%(tag,c+n_add),1)
    st=st.replace('</%s>'%tag,add_xml+'</%s>'%tag,1)
    return c
FNT='<family val="1"/><charset val="128"/>'
f0=bump('fonts','<font><sz val="10"/><name val="ＭＳ 明朝"/>%s</font><font><b/><sz val="14"/><name val="ＭＳ 明朝"/>%s</font><font><sz val="11"/><name val="ＭＳ 明朝"/>%s</font>'%(FNT,FNT,FNT),3)
b0=bump('borders','<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>',1)
def xf(font,border,al): return '<xf numFmtId="0" fontId="%d" fillId="0" borderId="%d" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment %s/></xf>'%(font,border,al)
xs=[xf(f0+1,0,'horizontal="left" vertical="center"'),            # title
    xf(f0,0,'horizontal="left" vertical="center"'),               # text
    xf(f0,b0,'horizontal="center" vertical="center" wrapText="1"'),# header
    xf(f0,0,'horizontal="left" vertical="center" wrapText="1"'),  # data left
    xf(f0,0,'horizontal="center" vertical="center" wrapText="1"'),# data center
    xf(f0,0,'horizontal="left" vertical="top" wrapText="1"'),     # note
    xf(f0+2,0,'horizontal="left" vertical="center"'),             # section
    xf(f0,0,'horizontal="center" vertical="center"')]             # 別紙
x0=bump('cellXfs',''.join(xs),len(xs))
S_TITLE,S_TXT,S_HDR,S_L,S_C,S_NOTE,S_SEC,S_BESSHI=[x0+i for i in range(8)]
d0=bump('dxfs','<dxf><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom></border></dxf>',1)
data['xl/styles.xml']=st.encode('utf-8')
# ---- sheet xml ----
def col(n):
    s=''
    while n: n,r=divmod(n-1,26); s=chr(65+r)+s
    return s
rows={}
def put(r,c,kind,val,s):
    rows.setdefault(r,{})[c]=(kind,val,s)
def T(r,c,t,s): put(r,c,'t',t,s)
def F(r,c,f,s): put(r,c,'f',f,s)
def E(r,c,s): put(r,c,'e','',s)
T(1,10,'別 紙',S_BESSHI)
F(2,1,"=IF('復命用一覧'!$C$3=\"\",\"全局課\",'復命用一覧'!$C$3)&\"の監査結果(令和\"&'復命用一覧'!$C$2&\"年度)\"",S_TITLE)
T(3,1,'１　検出された項目',S_SEC)
T(4,2,' いずれの項目についても是正等されている。その中で、次のような場合には備考欄に説明を記載した。',S_TXT)
T(5,2,' ①　是正に際し金銭の動きがあった場合\n ②　当該案件について是正はできないが同種の事務が今後も想定される場合\n　　 (「以後、適切に処理するよう指導した。」と記載。)\n ③　是正内容や指導内容について説明を要する場合',S_NOTE)
T(7,2,'課　名　等',S_HDR); E(8,2,S_HDR)
T(7,3,'項　　　　　　目',S_HDR); E(8,3,S_HDR)
T(7,4,'問　題　点　(件数）',S_HDR)
for c in range(5,10): E(7,c,S_HDR)
for c,t in zip(range(4,10),['押印関係','記載関係','計算誤り','書類漏れ','その他','計']): T(8,c,t,S_HDR)
T(7,10,'備　考',S_HDR); E(8,10,S_HDR)
T(7,11,'詳　　　　　　　　細',S_HDR); E(7,12,S_HDR); E(7,13,S_HDR)
T(8,11,'該当区分\n(リスク),①,③',S_HDR); T(8,12,'項目の内容',S_HDR); T(8,13,'対応状況',S_HDR)
IN=lambda c:'入力!$%s$2:$%s$2001'%(c,c)
for r in range(D0,D1+1):
    P='$P%d'%r
    F(r,16,'=IFERROR(MATCH(%d,$Q$2:$Q$2001,0),"")'%(r-D0+1),S_C)
    F(r,1,'=IF(%s="","",ROW()-%d)'%(P,D0-1),S_C)
    if r==D0: F(r,2,'=IF(%s="","",INDEX(%s,%s))'%(P,IN('D'),P),S_L)
    else: F(r,2,'=IF(%s="","",IF(INDEX(%s,%s)=INDEX(%s,$P%d),"",INDEX(%s,%s)))'%(P,IN('D'),P,IN('D'),r-1,IN('D'),P),S_L)
    F(r,3,'=IF(%s="","",INDEX(%s,%s))'%(P,IN('K'),P),S_L)
    for c in range(4,9):
        F(r,c,'=IF(%s="","",IF(INDEX(%s,%s)=%s$8,1,""))'%(P,IN('J'),P,col(c)),S_C)
    F(r,9,'=IF(%s="","",SUM(D%d:H%d))'%(P,r,r),S_C)
    F(r,10,'=IF(%s="","",INDEX(%s,%s)&"")'%(P,IN('P'),P),S_L)
    E(r,11,S_L)
    F(r,12,'=IF(%s="","",INDEX(%s,%s)&IF(INDEX(%s,%s)<>"",CHAR(10)&INDEX(%s,%s),""))'%(P,IN('M'),P,IN('N'),P,IN('N'),P),S_L)
    F(r,13,'=IF(%s="","",INDEX(%s,%s)&"")'%(P,IN('O'),P),S_L)
for r in range(2,2002):
    F(r,17,'=IF(入力!U%d=1,COUNTIFS(%s,1,%s,"<"&入力!D%d)+COUNTIFS(入力!$U$2:U%d,1,入力!$D$2:D%d,入力!D%d),"")'%(r,IN('U'),IN('D'),r,r,r,r),S_C)
def cell(r,c,k,v,s):
    ref='%s%d'%(col(c),r)
    if k=='t': return '<c r="%s" s="%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'%(ref,s,escape(v))
    if k=='f': return '<c r="%s" s="%d"><f>%s</f></c>'%(ref,s,escape(v[1:]))
    return '<c r="%s" s="%d"/>'%(ref,s)
H={1:14.25,2:24.75,3:21,4:16.5,5:57,7:24,8:30}
sd=[]
for r in sorted(rows):
    ht=H.get(r,45 if D0<=r<=D1 else None)
    a=' ht="%s" customHeight="1"'%ht if ht else ''
    sd.append('<row r="%d"%s>%s</row>'%(r,a,''.join(cell(r,c,*rows[r][c]) for c in sorted(rows[r]))))
W={1:4,2:24,3:36,4:5.6,5:5.6,6:5.6,7:5.6,8:5.6,9:5.6,10:26,11:14,12:75,13:42}
cols=''.join('<col min="%d" max="%d" width="%s" customWidth="1"/>'%(c,c,w) for c,w in W.items())+'<col min="14" max="15" width="9" customWidth="1"/><col min="16" max="17" width="9" hidden="1" customWidth="1"/>'
merge=['A2:J2','B5:J5','B7:B8','C7:C8','D7:I7','J7:J8','K7:M7']
sheet=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
 '<sheetPr><pageSetUpPr fitToPage="0"/></sheetPr><sheetViews><sheetView zoomScale="85" zoomScaleNormal="85" workbookViewId="0"><pane ySplit="8" topLeftCell="A9" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A9" sqref="A9"/></sheetView></sheetViews>'
 '<sheetFormatPr defaultRowHeight="13.5"/><cols>%s</cols><sheetData>%s</sheetData>'
 '<mergeCells count="%d">%s</mergeCells>'
 '<conditionalFormatting sqref="A%d:M%d"><cfRule type="expression" dxfId="%d" priority="1"><formula>$P%d&lt;&gt;""</formula></cfRule></conditionalFormatting>'
 '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup paperSize="8" scale="85" orientation="landscape"/></worksheet>')%(cols,''.join(sd),len(merge),''.join('<mergeCell ref="%s"/>'%m for m in merge),D0,D1,d0,D0)
data['xl/worksheets/sheet12.xml']=sheet.encode('utf-8')
# ---- workbook / rels / content types ----
wb=data['xl/workbook.xml'].decode('utf-8')
assert 'sheetId="12"' not in wb and 'rId17' not in data['xl/_rels/workbook.xml.rels'].decode()
n_sheets=wb.count('<sheet ')
wb=wb.replace('</sheets>','<sheet name="%s" sheetId="12" r:id="rId17"/></sheets>'%SHEET,1)
q="'%s'"%SHEET
dn=('<definedName name="_xlnm.Print_Area" localSheetId="%d">OFFSET(%s!$A$1,0,0,%d+MAX(1,COUNT(%s!$A$%d:$A$%d)),13)</definedName>'
    '<definedName name="_xlnm.Print_Titles" localSheetId="%d">%s!$7:$8</definedName>')%(n_sheets,q,D0-1,q,D0,D1,n_sheets,q)
wb=wb.replace('</definedNames>',dn+'</definedNames>',1)
wb=wb.replace('<calcPr calcId="191029"/>','<calcPr calcId="191029" fullCalcOnLoad="1"/>',1)
data['xl/workbook.xml']=wb.encode('utf-8')
rl=data['xl/_rels/workbook.xml.rels'].decode('utf-8')
rl=rl.replace('</Relationships>','<Relationship Id="rId17" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet12.xml"/></Relationships>')
data['xl/_rels/workbook.xml.rels']=rl.encode('utf-8')
ct=data['[Content_Types].xml'].decode('utf-8')
ct=ct.replace('<Override PartName="/xl/theme/theme1.xml"','<Override PartName="/xl/worksheets/sheet12.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/theme/theme1.xml"',1)
data['[Content_Types].xml']=ct.encode('utf-8')
with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED) as o:
    for n in names: o.writestr(z.getinfo(n),data[n],compress_type=zipfile.ZIP_DEFLATED)
    o.writestr('xl/worksheets/sheet12.xml',data['xl/worksheets/sheet12.xml'])
print('ok',len(names)+1)
