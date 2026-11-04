import zipfile,re,sys
from lxml import etree
from xml.sax.saxutils import escape
BASE,ORIG,OUT=sys.argv[1:4]
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
SHEET='別紙(復命用)'; NROW=150; D0=9; D1=D0+NROW-1; R78=D1+3
# ---------- 原本(別添)の読み込み ----------
oz=zipfile.ZipFile(ORIG)
osx=etree.fromstring(oz.read('xl/worksheets/sheet1.xml'))
oss=etree.fromstring(oz.read('xl/sharedStrings.xml'))
sst=[]
for si in oss.findall('m:si',NS):
    sst.append(''.join(t.text or '' for t in si.iter('{%s}t'%NS['m']) if t.getparent().tag!='{%s}rPh'%NS['m']))
ost=oz.read('xl/styles.xml').decode('utf-8')
def blocks(tag,child,s):
    b=re.search(r'<%s[^>]*>(.*?)</%s>'%(tag,tag),s,re.S).group(1)
    return re.findall(r'<%s(?:\s[^>]*)?(?:/>|>.*?</%s>)'%(child,child),b,re.S)
o_fonts=blocks('fonts','font',ost); o_borders=blocks('borders','border',ost)
o_xfs=re.findall(r'<xf (?:[^>]*?)(?:/>|>.*?</xf>)',re.search(r'<cellXfs[^>]*>(.*?)</cellXfs>',ost,re.S).group(1),re.S)
# ---------- 出力先(ブック)の読み込み ----------
bz=zipfile.ZipFile(BASE); names=bz.namelist(); data={n:bz.read(n) for n in names}
st=data['xl/styles.xml'].decode('utf-8')
def count(tag): return int(re.search(r'<%s count="(\d+)"'%tag,st).group(1))
def append(tag,xml,n):
    global st
    c=count(tag); st=st.replace('<%s count="%d"'%(tag,c),'<%s count="%d"'%(tag,c+n),1); st=st.replace('</%s>'%tag,xml+'</%s>'%tag,1); return c
fmap={};bmap={};xmap={}
def font_id(i):
    raw=o_fonts[i]
    if raw not in fmap: fmap[raw]=append('fonts',raw,1)
    return fmap[raw]
def border_id(i,none=False):
    if none: return 0
    raw=o_borders[i]
    if raw not in bmap: bmap[raw]=append('borders',raw,1)
    return bmap[raw]
def xf(i,noborder=False):
    key=(i,noborder)
    if key in xmap: return xmap[key]
    x=o_xfs[i]; a=dict(re.findall(r'(\w+)="([^"]*)"',x.split('>')[0]))
    al=re.search(r'<alignment[^>]*/>',x)
    new='<xf numFmtId="0" fontId="%d" fillId="0" borderId="%d" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">%s</xf>'%(
        font_id(int(a['fontId'])),border_id(int(a['borderId']),noborder),al.group(0) if al else '')
    xmap[key]=append('cellXfs',new,1); return xmap[key]
# ---------- セル出力ヘルパ ----------
def col(n):
    s=''
    while n: n,r=divmod(n-1,26); s=chr(65+r)+s
    return s
def cidx(ref):
    n=0
    for ch in re.match(r'[A-Z]+',ref).group(0): n=n*26+ord(ch)-64
    return n
def c_text(ref,s,t): return '<c r="%s" s="%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'%(ref,s,escape(t))
def c_form(ref,s,f): return '<c r="%s" s="%d"><f>%s</f></c>'%(ref,s,escape(f))
def c_blank(ref,s): return '<c r="%s" s="%d"/>'%(ref,s)
def copy_row(el,newr,rowshift_map=None):
    a=el.attrib; attrs=' r="%d"'%newr
    if 's' in a: attrs+=' s="%d" customFormat="1"'%xf(int(a['s']))
    if 'ht' in a: attrs+=' ht="%s" customHeight="1"'%a['ht']
    cells=[]
    for c in el.findall('m:c',NS):
        ref=re.match(r'[A-Z]+',c.get('r')).group(0)+str(newr); s=xf(int(c.get('s','0')))
        v=c.find('m:v',NS); f=c.find('m:f',NS)
        if c.get('t')=='s' and v is not None: cells.append(c_text(ref,s,sst[int(v.text)]))
        elif f is not None: cells.append(c_form(ref,s,'='+(f.text or '')))
        elif v is not None: cells.append('<c r="%s" s="%d"><v>%s</v></c>'%(ref,s,v.text))
        else: cells.append(c_blank(ref,s))
    return '<row%s>%s</row>'%(attrs,''.join(cells))
orows={int(r.get('r')):r for r in osx.find('m:sheetData',NS).findall('m:row',NS)}
out=[]
# 1〜8行: 原本そのまま(2行目のタイトルだけ式にする)
for r in range(1,9):
    if r in orows: out.append(copy_row(orows[r],r))
title="=IF('復命用一覧'!$C$3=\"\",\"○○局及び関連区役所等\",'復命用一覧'!$C$3)&\"の監査結果\""
out[1]=re.sub(r'<c r="A2" s="(\d+)" t="inlineStr">.*?</c>',lambda m:c_form('A2',int(m.group(1)),title),out[1],count=1,flags=re.S)
# ---------- データ行(スロット) ----------
S=dict(A=xf(67,True),B=xf(68,True),C=xf(1,True),D=xf(6,True),J=xf(2,True),K=xf(14,True),N=xf(72,True),
       O=xf(69),P=xf(70),S=xf(71),T=xf(70))
IN=lambda c:'入力!$%s$2:$%s$2001'%(c,c)
for r in range(D0,D1+1):
    X='$X%d'%r; ix=lambda c:'INDEX(%s,%s)'%(IN(c),X)
    cells=[]
    cells.append(c_form('X%d'%r,S['A'],'=IFERROR(MATCH(%d,$Y$2:$Y$2001,0),"")'%(r-D0+1)))
    cells.insert(0,c_form('A%d'%r,S['A'],'=IF(%s="","",ROW()-%d)'%(X,D0-1)))
    if r==D0: cells.insert(1,c_form('B%d'%r,S['B'],'=IF(%s="","",%s)'%(X,ix('D'))))
    else: cells.insert(1,c_form('B%d'%r,S['B'],'=IF(%s="","",IF(%s=INDEX(%s,$X%d),"",%s))'%(X,ix('D'),IN('D'),r-1,ix('D'))))
    cells.insert(2,c_form('C%d'%r,S['C'],'=IF(%s="","",%s)'%(X,ix('K'))))
    # 区分(D〜H)と、末尾の合計行
    for k,c in enumerate(range(4,9)):
        L=col(c); body='IF(%s=%s$8,1,"")'%(ix('J'),L)
        tot='IF(ROW()-%d=COUNT($A$%d:$A$%d)+1,SUM(%s$%d:%s%d),"")'%(D0-1,D0,D1,L,D0,L,r-1) if r>D0 else '""'
        cells.append(c_form('%s%d'%(L,r),S['D'],'=IF(%s="",%s,%s)'%(X,tot,body)))
    tot='IF(ROW()-%d=COUNT($A$%d:$A$%d)+1,SUM(I$%d:I%d),"")'%(D0-1,D0,D1,D0,r-1) if r>D0 else '""'
    cells.append(c_form('I%d'%r,S['D'],'=IF(%s="",%s,SUM(D%d:H%d))'%(X,tot,r,r)))
    cells.append(c_form('J%d'%r,S['J'],'=IF(%s="","",%s&"")'%(X,ix('P'))))
    cells.append(c_blank('K%d'%r,S['K']))
    cells.append(c_form('L%d'%r,S['J'],'=IF(%s="","",%s&IF(%s<>"",CHAR(10)&%s,""))'%(X,ix('M'),ix('N'),ix('N'))))
    cells.append(c_blank('M%d'%r,S['J']))
    cells.append(c_form('N%d'%r,S['N'],'=IF(%s="","",%s&"")'%(X,ix('O'))))
    cells.append(c_blank('O%d'%r,S['O']))
    cells.append(c_form('P%d'%r,S['P'],'=IF(%s="","",IFERROR(VALUE(ASC(LEFT(%s,1))),""))'%(X,ix('G'))))
    cells.append(c_form('Q%d'%r,S['P'],'=IF(%s="","",IFERROR(VALUE(MID(%s,2,FIND(")",%s)-2)),""))'%(X,ix('H'),ix('H'))))
    cells.append(c_form('R%d'%r,S['P'],'=IF(%s="","",IFERROR(UNICODE(LEFT(%s,1))-9311,""))'%(X,ix('I'))))
    cells.append(c_form('S%d'%r,S['S'],'=IF(%s="","",%s&"")'%(X,ix('J'))))
    cells.append(c_form('T%d'%r,S['T'],'=IF(%s="","",%s&"")'%(X,ix('F'))))
    cells.sort(key=lambda s:cidx(re.search(r'r="([A-Z]+)',s).group(1)))
    out.append('<row r="%d" ht="55" customHeight="1">%s</row>'%(r,''.join(cells)))
# 並べ替え用の順位(入力シートと同じ行番号, Y列)
rank_rows={}
for r in range(2,2002):
    f='=IF(入力!U%d=1,COUNTIFS(%s,1,%s,"<"&入力!D%d)+COUNTIFS(入力!$U$2:U%d,1,入力!$D$2:D%d,入力!D%d),"")'%(r,IN('U'),IN('D'),r,r,r,r)
    rank_rows[r]=c_form('Y%d'%r,S['A'],f)
# ---------- 下部(今回指摘する項目 / 今回意見とする項目): 原本の78〜84行をそのまま ----------
shift=R78-78
for r in range(78,85):
    if r in orows: out.append(copy_row(orows[r],r+shift))
# Y列の順位セルを、行ごとに追記
def inject(rowxml,r):
    return rowxml.replace('</row>',rank_rows[r]+'</row>') if r in rank_rows else rowxml
for i,rx in enumerate(out):
    r=int(re.search(r'<row r="(\d+)"',rx).group(1))
    if r<=2001 and r in rank_rows: out[i]=inject(rx,r); rank_rows.pop(r)
for r,cx in sorted(rank_rows.items()):
    out.append('<row r="%d">%s</row>'%(r,cx))
out.sort(key=lambda rx:int(re.search(r'<row r="(\d+)"',rx).group(1)))
# ---------- 列幅・結合・条件付き書式 ----------
cs=lambda i:xf(i)
cols=('<cols><col min="1" max="1" width="3.375" style="%d" customWidth="1"/><col min="2" max="2" width="17.25" style="%d" customWidth="1"/>'
 '<col min="3" max="3" width="30.25" style="%d" customWidth="1"/><col min="4" max="9" width="4.625" style="%d" customWidth="1"/>'
 '<col min="10" max="10" width="19.25" style="%d" customWidth="1"/><col min="11" max="11" width="15" style="%d" customWidth="1"/>'
 '<col min="12" max="12" width="75.125" style="%d" customWidth="1"/><col min="13" max="13" width="49.25" style="%d" customWidth="1"/>'
 '<col min="14" max="14" width="68.375" style="%d" customWidth="1"/><col min="15" max="20" width="9" style="%d" customWidth="1"/>'
 '<col min="21" max="23" width="9" style="%d"/><col min="24" max="25" width="9" style="%d" hidden="1" customWidth="1"/><col min="26" max="16384" width="9" style="%d"/></cols>')%(
 cs(78),cs(78),cs(22),cs(22),cs(78),cs(22),cs(22),cs(78),cs(78),cs(78),cs(78),cs(78),cs(78))
merges=['A2:J2','B5:J5','B7:B8','C7:C8','D7:I7','J7:J8','K7:N7','R2:V3','C%d:I%d'%(79+shift,79+shift),'C%d:I%d'%(80+shift,80+shift),'C%d:I%d'%(83+shift,83+shift),'C%d:I%d'%(84+shift,84+shift)]
def dxf(sides):
    return '<dxf><border>%s</border></dxf>'%''.join('<%s style="thin"><color auto="1"/></%s>'%(s,s) for s in sides)
d0=append('dxfs',dxf(['left','right','top','bottom'])+dxf(['left','right','top'])+dxf(['left','right'])+dxf(['left','right','bottom']),4)
dALL,dTOP,dMID,dBOT=d0,d0+1,d0+2,d0+3
# ※dxf順: 0=ALL(4辺) 1=上+左右 2=左右 3=下+左右
nxt='OR($X%d="",$B%d<>"")'%(D0+1,D0+1)
cf=('<conditionalFormatting sqref="B%d:B%d">'
 '<cfRule type="expression" dxfId="%d" priority="1" stopIfTrue="1"><formula>AND($X%d&lt;&gt;"",$B%d&lt;&gt;"",%s)</formula></cfRule>'
 '<cfRule type="expression" dxfId="%d" priority="2" stopIfTrue="1"><formula>AND($X%d&lt;&gt;"",$B%d&lt;&gt;"")</formula></cfRule>'
 '<cfRule type="expression" dxfId="%d" priority="3" stopIfTrue="1"><formula>AND($X%d&lt;&gt;"",%s)</formula></cfRule>'
 '<cfRule type="expression" dxfId="%d" priority="4" stopIfTrue="1"><formula>$X%d&lt;&gt;""</formula></cfRule></conditionalFormatting>'
 '<conditionalFormatting sqref="C%d:N%d"><cfRule type="expression" dxfId="%d" priority="5"><formula>$X%d&lt;&gt;""</formula></cfRule></conditionalFormatting>')%(
 D0,D1,dALL,D0,D0,escape(nxt),dTOP,D0,D0,dBOT,D0,escape(nxt),dMID,D0,D0,D1,dALL,D0)
sheet=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
 '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView view="pageBreakPreview" zoomScaleNormal="90" zoomScaleSheetLayoutView="100" workbookViewId="0"><selection activeCell="A9" sqref="A9"/></sheetView></sheetViews>'
 '<sheetFormatPr defaultColWidth="9" defaultRowHeight="13.5"/>%s<sheetData>%s</sheetData><mergeCells count="%d">%s</mergeCells>%s'
 '<pageMargins left="0.51181102362204722" right="0.51181102362204722" top="0.55118110236220474" bottom="0.55118110236220474" header="0.31496062992125984" footer="0.31496062992125984"/>'
 '<pageSetup paperSize="8" scale="85" fitToHeight="0" orientation="landscape"/></worksheet>')%(cols,''.join(out),len(merges),''.join('<mergeCell ref="%s"/>'%m for m in merges),cf)
data['xl/styles.xml']=st.encode('utf-8')
data['xl/worksheets/sheet12.xml']=sheet.encode('utf-8')
# ---------- workbook 登録 ----------
wb=data['xl/workbook.xml'].decode('utf-8'); n=wb.count('<sheet ')
assert 'sheetId="12"' not in wb
wb=wb.replace('</sheets>','<sheet name="%s" sheetId="12" r:id="rId17"/></sheets>'%SHEET,1)
q="'%s'"%SHEET
dn='<definedName name="_xlnm.Print_Area" localSheetId="%d">%s!$A$1:$M$%d</definedName><definedName name="_xlnm.Print_Titles" localSheetId="%d">%s!$7:$8</definedName>'%(n,q,84+shift,n,q)
wb=wb.replace('</definedNames>',dn+'</definedNames>',1)
wb=wb.replace('<calcPr calcId="191029"/>','<calcPr calcId="191029" fullCalcOnLoad="1"/>',1)
data['xl/workbook.xml']=wb.encode('utf-8')
rl=data['xl/_rels/workbook.xml.rels'].decode('utf-8')
data['xl/_rels/workbook.xml.rels']=rl.replace('</Relationships>','<Relationship Id="rId17" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet12.xml"/></Relationships>').encode('utf-8')
ct=data['[Content_Types].xml'].decode('utf-8')
data['[Content_Types].xml']=ct.replace('<Override PartName="/xl/theme/theme1.xml"','<Override PartName="/xl/worksheets/sheet12.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/theme/theme1.xml"',1).encode('utf-8')
with zipfile.ZipFile(OUT,'w',zipfile.ZIP_DEFLATED) as o:
    for nm in names: o.writestr(bz.getinfo(nm),data[nm],compress_type=zipfile.ZIP_DEFLATED)
    o.writestr('xl/worksheets/sheet12.xml',data['xl/worksheets/sheet12.xml'])
print('ok slots',D0,D1,'sections from',R78,'last row',84+shift)
