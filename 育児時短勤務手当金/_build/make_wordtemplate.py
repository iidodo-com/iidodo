# -*- coding: utf-8 -*-
"""既存の不支給決定通知書(docx)の1枚目から、差し込み用テンプレート(トークン入り)を作る。
python make_wordtemplate.py 既存通知書.docx 出力.docx"""
import sys, copy, docx
from docx.oxml.ns import qn

src, dst = sys.argv[1], sys.argv[2]
d = docx.Document(src)
body = d.element.body
kids = list(body.iterchildren())
sect = kids[-1] if kids[-1].tag.endswith('sectPr') else None
first = kids[:28]            # 0..27 = 1件目（28は改ページ段落）
for k in kids[28:]:
    if k is not sect:
        body.remove(k)


def set_text(p, text, bold_run=False):
    runs = [r for r in p.iter(qn('w:r'))]
    keep = None
    for r in runs:
        if r.find(qn('w:rPr')) is not None and r.find(qn('w:rPr')).find(qn('w:rFonts')) is not None:
            keep = r
            break
    keep = keep if keep is not None else (runs[0] if runs else None)
    if keep is None:
        return
    for r in runs:
        if r is not keep:
            r.getparent().remove(r)
    for t in list(keep):
        if t.tag != qn('w:rPr'):
            keep.remove(t)
    t = copy.copy(keep.makeelement(qn('w:t'), {}))
    t.text = text
    t.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    keep.append(t)


P = {i: kids[i] for i in range(28)}
set_text(P[0], '{通知日}')
set_text(P[1], '{所属}')
set_text(P[3], '{氏名}　様')
set_text(P[4], '（{職員番号}）')
set_text(P[11], '{受理日}に広島市職員共済組合にて受理いたしました育児時短勤務手当金請求書について、地方公務員等共済組合法第七十条の五に基づき、次のとおり決定しましたので通知します。')
sp = '　'
set_text(P[16], '{明細項目1}' + sp * 6 + '{明細金額1}')
set_text(P[17], '{明細項目2}' + sp * 18 + '{明細金額2}')
# 3行目：17行目を複製して空行(18)に置き換える
p3 = copy.deepcopy(P[17])
body.replace(P[18], p3) if False else None
P[18].addprevious(p3)
body.remove(P[18])
set_text(p3, '{明細項目3}' + sp * 8 + '{明細金額3}')
# 表
tbl = P[13]
cells = [tc for tc in tbl.iter(qn('w:tc'))]
ps = [p for p in cells[1].iter(qn('w:p'))]
set_text(ps[0], '不支給（対象月：{対象月}）')
set_text(ps[1], '{理由}')
set_text(ps[2], '{詳細注記}')
d.save(dst)
print('saved', dst)
