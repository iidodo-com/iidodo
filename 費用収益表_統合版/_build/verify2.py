"""統合ブック(build2)を、元の3ファイルとは独立した経路で検証する。
  A. 旧・費用収益表（xlsの計算済み値）とのセル単位の一致（9月締め）
  B. 月例／決算整理の経費区分按分（元の計算済み値との一致）
  C. 差引簿への転記（日付・摘要・金額・状態）を、元データから Python で作った期待値と1行ずつ比較
  D. 費用収益表の月別金額を、元データから独立に再計算した値と比較（9月締め・10月締め）
  E. 数式エラーの有無
使い方: python3 verify2.py <統合ブック.xlsx> <管理簿.xlsx> <貸付予算差引簿.xls> <費用収益表.xls>
"""
import collections
import datetime
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

import openpyxl
import xlrd

warnings.filterwarnings('ignore')
sys.path.insert(0, str(Path(__file__).parent))
import build as B
import build2 as B2
import extract as X


def recalc(path, month=None):
    tmp = Path(tempfile.mkdtemp())
    src = tmp / 'v.xlsx'
    wb = openpyxl.load_workbook(path)
    if month:
        wb[B2.SH_CTL]['C5'] = month
    wb.save(src)
    subprocess.run(['soffice', '--headless', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', str(tmp / 'o'),
                    str(src)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return openpyxl.load_workbook(tmp / 'o' / 'v.xlsx', data_only=True)


def main(final, gyomu, kashi, hiyou):
    res = {}
    new = openpyxl.load_workbook(final, data_only=True)
    old = xlrd.open_workbook(hiyou)
    errs = [(ws.title, c.coordinate, c.value) for ws in new for row in ws.iter_rows() for c in row
            if isinstance(c.value, str) and c.value[:2] in ('#V', '#N', '#R', '#D')]
    res['E.数式エラー'] = len(errs)
    # A
    tot = bad = 0
    for name in (B2.SH_HG, B2.SH_HT, B2.SH_HC, B2.SH_HK):
        s = old.sheet_by_name(name)
        ws = new[name]
        hidden = set()
        for mr in ws.merged_cells.ranges:
            for rr in range(mr.min_row, mr.max_row + 1):
                for cc in range(mr.min_col, mr.max_col + 1):
                    if (rr, cc) != (mr.min_row, mr.min_col):
                        hidden.add((rr, cc))
        for r in range(4, 63):
            for c in range(3, 22):
                if (r, c) in hidden:
                    continue
                ov = s.cell_value(r - 1, c - 1) if r - 1 < s.nrows and c - 1 < s.ncols else ''
                ov = ov if isinstance(ov, float) else 0.0
                nv = ws.cell(r, c).value
                nv = nv if isinstance(nv, (int, float)) else 0.0
                tot += 1
                if abs(ov - nv) > 0.5:
                    bad += 1
                    print('A不一致', name, r, c, ov, nv)
    res['A.旧表とのセル比較（9月締め）'] = f'{tot} セル中 不一致 {bad}'
    # B
    og = openpyxl.load_workbook(gyomu, data_only=True)
    n = bad = 0
    for sh, last in ((B2.SH_G, 788), (B2.SH_KS, 1835)):
        for r in range(5, last + 1):
            a, b = og[sh].cell(r, 6).value, new[sh].cell(r, 6).value
            for c in (8, 9, 10, 11):
                n += 1
                if round(og[sh].cell(r, c).value or 0) != round(new[sh].cell(r, c).value or 0):
                    bad += 1
    res['B.経費区分の按分（月例・決算整理）'] = f'{n} セル中 不一致 {bad}'
    # C 差引簿の転記
    grows, _ = X.load_gyomu(gyomu)
    n = bad = 0
    for sheet, side, kind in ((B2.SH_DT, 'S', '月例'), (B2.SH_DC, 'L', '月例'),
                              (B2.SH_UT, 'S', '決算整理'), (B2.SH_UC, 'L', '決算整理')):
        ws = new[sheet]
        exp = collections.defaultdict(list)
        for r in grows:
            if r['kind'] != kind or r['st'] == '支払なし':
                continue
            key = B2.GY_MAP.get(f"{r['chu']}|{r['sho'] or ''}")
            if not key or key == '対象外':
                continue
            t, h, ke, ta = B2.split(r['amt'], r['kbn'])
            v = t if side == 'S' else h + ke + ta
            if v:
                exp[key].append((r['date'], r['tek'], v, r['st']))
        head = {}
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith('○'):
                    head[c.value] = (c.row, c.column)
        for k, h, br, y in B2.GY_BLOCKS:
            r0, t = head[h]
            for i, (dt, tek, v, st) in enumerate(exp.get(k, []), 1):
                r = r0 + 2 + i
                got = (ws.cell(r, t - 1).value, ws.cell(r, t).value, ws.cell(r, t + 1).value, ws.cell(r, t + 3).value)
                n += 1
                gd = got[0].date() if isinstance(got[0], datetime.datetime) else got[0]
                if not (gd == dt and got[1] == tek and abs((got[2] or 0) - v) < 0.5 and got[3] == st):
                    bad += 1
                    if bad < 6:
                        print('C不一致', sheet, k, i, got, (dt, tek, v, st))
            r = r0 + 2 + len(exp.get(k, [])) + 1
            if ws.cell(r, t + 1).value not in (None, ''):
                bad += 1
                print('C余分な行', sheet, k)
    res['C.差引簿への転記（日付・摘要・金額・状態）'] = f'{n} 行中 不一致 {bad}'
    # D
    k, kn = X.load_kashitsuke(kashi)
    for r in k:
        r['key'] = B.kashi_key(r)
    _, ov = X.load_old_hiyou(hiyou, tempfile.mkdtemp())
    resid = B2.compute_residuals(k, ov[B2.SH_HK])
    kd = collections.defaultdict(float)
    for r in k:
        if r['st'] == '確認済' and r['kind'] == '通常':
            kd[(r['key'], (r['date'].month - 4) % 12 + 1)] += r['amt']
    for i, v in resid.items():
        kd[('厚生年金保険料等', i)] += v
    for label in ('9月', '10月'):
        cut = int(label[:-1]) - 3
        wb = recalc(final, label)
        tot = bad = 0
        for sh, side in ((B2.SH_HT, 'S'), (B2.SH_HC, 'L')):
            ex = collections.defaultdict(float)
            for r in grows:
                if r['st'] != '確認済' or r['kind'] != '月例':
                    continue
                key = B2.GY_MAP.get(f"{r['chu']}|{r['sho'] or ''}")
                if not key or key == '対象外':
                    continue
                t, h, ke, ta = B2.split(r['amt'], r['kbn'])
                ex[(key, (r['date'].month - 4) % 12 + 1)] += t if side == 'S' else h + ke + ta
            ws = wb[sh]
            for row, key in B.GYOMU_ROWS.items():
                if row in (56, 57):
                    continue
                for idx in range(1, cut + 1):
                    tot += 1
                    bad += abs((ws.cell(row, 2 + idx).value or 0) - ex.get((key, idx), 0)) > 0.5
            for idx in range(1, cut + 1):
                tot += 1
                v = (ws.cell(56, 2 + idx).value or 0) + (ws.cell(57, 2 + idx).value or 0)
                bad += abs(v - ex.get(('非常勤職員手当', idx), 0)) > 0.5
        ws = wb[B2.SH_HK]
        for row, key in B.KASHI_ROWS.items():
            for idx in range(1, min(cut, 12) + 1):
                tot += 1
                bad += abs((ws.cell(row, 2 + idx).value or 0) - kd.get((key, idx), 0)) > 0.5
        res[f'D.独立再計算（{label}締め）'] = f'{tot} セル中 不一致 {bad}／検算シートNG {wb[B2.SH_CHK]["C3"].value}件'
    for kk, v in res.items():
        print(f'{kk}: {v}')
    return res


if __name__ == '__main__':
    main(*sys.argv[1:5])
