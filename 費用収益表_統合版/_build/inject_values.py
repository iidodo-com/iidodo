"""openpyxl で作ったブック（数式のみ・計算結果なし）に、LibreOffice で再計算した結果を
キャッシュ値として書き込む。書式・条件付き書式・入力規則は openpyxl 版のまま保たれ、
プレビュー（計算しないビューア）でも数値が表示される。Excel は開くときに再計算する。

使い方: python3 inject_values.py <数式のみ.xlsx> <出力.xlsx>
"""
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import openpyxl
from lxml import etree

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
M = '{%s}' % NS['m']


def recalc(src, outdir):
    subprocess.run(['soffice', '--headless', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', str(outdir),
                    str(src)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return Path(outdir) / Path(src).name


def main(src, out):
    tmp = Path(tempfile.mkdtemp())
    calc = recalc(src, tmp)
    vals = openpyxl.load_workbook(calc, data_only=True)
    zin = zipfile.ZipFile(src)
    wbx = etree.fromstring(zin.read('xl/workbook.xml'))
    rels = etree.fromstring(zin.read('xl/_rels/workbook.xml.rels'))
    rid2target = {r.get('Id'): r.get('Target') for r in rels}
    sheetfile = {}
    for s in wbx.find('m:sheets', NS):
        rid = s.get('{%s}id' % NS['r'])
        t = rid2target[rid]
        sheetfile['xl/' + t.lstrip('/').replace('xl/', '')] = s.get('name')
    zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
    n_set = 0
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename in sheetfile:
            ws = vals[sheetfile[item.filename]]
            root = etree.fromstring(data)
            for c in root.iter(M + 'c'):
                f = c.find(M + 'f')
                if f is None:
                    continue
                v = ws[c.get('r')].value
                ve = c.find(M + 'v')
                if ve is None:
                    ve = etree.SubElement(c, M + 'v')
                if isinstance(v, bool):
                    c.set('t', 'b')
                    ve.text = '1' if v else '0'
                elif isinstance(v, (int, float)):
                    if 't' in c.attrib:
                        del c.attrib['t']
                    ve.text = repr(float(v)) if isinstance(v, float) and not float(v).is_integer() else str(int(v))
                elif isinstance(v, str) and v.startswith('#') and v.rstrip('!?').lstrip('#').isupper():
                    c.set('t', 'e')
                    ve.text = v
                else:
                    c.set('t', 'str')
                    ve.text = '' if v is None else str(v)
                n_set += 1
            data = etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
        zout.writestr(item, data)
    zout.close()
    return n_set


if __name__ == '__main__':
    print(main(sys.argv[1], sys.argv[2]), 'formula cells cached')
