"""業務経理区分別執行管理簿(元の様式のまま) ＋ 貸付予算差引簿 ＋ 費用収益表 を1ブックに統合する。

  月例 / 決算整理 に入力 → 予算差引簿（短）（長）・同「未払」へ費目ごとに自動転記
  → 差引簿集計（月別合計）→ 費用収益表へ自動転記
  貸付予算差引簿（元の様式）→ 貸付差引簿集計 → 費用収益表（貸付）

使い方:
  python3 build2.py <管理簿.xlsx> <貸付予算差引簿.xls> <費用収益表.xls> <出力.xlsx>
"""
import datetime
import json
import math
import re
import sys
import tempfile
from copy import copy
from pathlib import Path

import openpyxl
from openpyxl.formatting.formatting import ConditionalFormattingList
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

sys.path.insert(0, str(Path(__file__).parent))
import build as B
import extract as X
from build import (YELLOW, PENDING, NUM, NUM0, MONTHS, STATUS, NAVY, GREY, GREY_L, RED_T, GREEN_T, BLUE_IN,
                   font, fill, put, title_band, header_row, B_ALL, B_ROW, RIGHT, CENTER, THIN, MED)

# 元の様式のシート名（そのまま使う）
SH_G, SH_KS = '月例', '決算整理'
SH_DT, SH_DC = '予算差引簿（短）', '予算差引簿（長）'
SH_UT, SH_UC = '予算差引簿（短）未払', '予算差引簿（長）未払'
SH_HG, SH_HT, SH_HC, SH_HK = 'R7業務（長+短）', 'R7業務 (短)', 'R7業務（長）', 'R8貸付'
SH_K1 = '旅費・事務費（消耗品・図書・通信・会議・雑費）R８'
SH_K2 = '旅費・事務費以外R８'
SH_ST, SH_SC, SH_SK = '差引簿集計（短）', '差引簿集計（長）', '貸付差引簿集計'
SH_MST, SH_CTL, SH_CHK, SH_OLD, SH_HELP = '科目表', '月次締め', '検算', '旧表照合', '使い方'
HOLD = {SH_HG: SH_HG, SH_HT: SH_HT, SH_HC: SH_HC, SH_HK: SH_HK}

G_FIRST, G_LAST = 5, 788       # 月例
K_FIRST, K_LAST = 5, 1835      # 決算整理
# 月例・決算整理に足す作業列
C_ST, C_KEY, C_LONG, C_SKEY, C_LKEY, C_IDX = 'P', 'Q', 'R', 'S', 'T', 'U'

# ---- 業務の費目（差引簿のブロック）----
# key, 見出し, 費用収益表の行（予算現額）, 費用収益表に計上するか
GY_BLOCKS = [
    ('事務用消耗品費', '○事務費  事務用消耗品費', 12, True), ('図書印刷費', '○事務費  図書印刷費', 13, True),
    ('通信運搬費', '○事務費  通信運搬費', 15, True), ('送金料', '○事務費  送金料', 14, True),
    ('事務費・雑費', '○事務費  雑費', 17, True), ('会議費', '○事務費  会議費', 16, True),
    ('旅費', '○旅費', 11, True), ('委託費', '○委託費', 20, True), ('賃借料', '○賃借料', 23, True),
    ('厚生費', '○厚生費', 10, True), ('普及費', '○普及費', 24, True), ('光熱水料', '○光熱水料', 21, True),
    ('修繕費', '○修繕費', 22, True), ('役員報酬', '○役員報酬', 4, True), ('連合会分担金', '○連合会分担金', 34, True),
    ('非常勤職員手当', '○職員給与  非常勤職員手当', 7, True), ('賃金', '○賃金', 19, True),
    ('諸謝金', '○諸謝金', 25, True),
    ('互助会費', '○負担金  互助会費', 27, True), ('会議出席負担金等', '○負担金  会議出席負担金等', None, True),
    ('協会けんぽ保険料等', '○負担金  協会けんぽ保険料等', None, True), ('共済負担金等', '○負担金  共済負担金等', None, True),
    ('厚年負担金等', '○負担金  厚年負担金等', None, True), ('労災・雇用保険料', '○負担金  労災・雇用保険料', None, True),
    ('県社保協会費', '○負担金  県社保協会費', 32, True), ('事務費負担金払込金', '○事務費負担金払込金', 35, True),
    ('雑費', '○雑費', 36, True), ('減価償却費', '○減価償却費', 37, True),
    ('器具及び備品', '○器具及び備品', None, False), ('前期損益修正損', '○前期損益修正損', None, False),
    ('立替金', '○立替金', None, False),
]
GY_KEYS = [b[0] for b in GY_BLOCKS]


def gyomu_mapping():
    m = B.gyomu_mapping()
    for chu in ('器具及び備品', '前期損益修正損', '立替金'):
        m[f'{chu}|'] = chu
        m[f'{chu}|{chu}'] = chu
    return m


GY_MAP = gyomu_mapping()

# 費用収益表の行 → 差引簿集計のキー（業務）
HY_ROWS = {k: r for k, h, r, y in GY_BLOCKS if r}
HY_ROW_FOR_KEY = {k: r for k, r in HY_ROWS.items()}
BONUS = '非常勤職員手当（うち賞与）'


def style_of(ws, addr):
    return copy(ws[addr]._style)


# ----------------------------------------------------------------------------
# 他ブックからシートをコピー（書式つき）
# ----------------------------------------------------------------------------
def copy_sheet(src, wb, title):
    dst = wb.create_sheet(title)
    for row in src.iter_rows():
        for c in row:
            if c.value is None and not c.has_style:
                continue
            d = dst.cell(c.row, c.column, c.value)
            if c.has_style:
                d.font = copy(c.font)
                d.fill = copy(c.fill)
                d.border = copy(c.border)
                d.alignment = copy(c.alignment)
                d.number_format = c.number_format
    for k, v in src.column_dimensions.items():
        dst.column_dimensions[k].width = v.width
        dst.column_dimensions[k].hidden = v.hidden
    for k, v in src.row_dimensions.items():
        if v.height:
            dst.row_dimensions[k].height = v.height
    for mr in src.merged_cells.ranges:
        dst.merge_cells(str(mr))
    dst.sheet_view.zoomScale = src.sheet_view.zoomScale
    dst.sheet_view.showGridLines = src.sheet_view.showGridLines
    dst.freeze_panes = src.freeze_panes
    return dst


def black(cell):
    f = cell.font
    cell.font = Font(name=f.name, sz=f.sz, b=f.b, i=f.i, u=f.u, color='FF000000')


# ----------------------------------------------------------------------------
# 月例・決算整理：作業列・状態・黄色
# ----------------------------------------------------------------------------
def prep_input_sheet(ws, rows, first, last, kind):
    """rows: 台帳行（src の行番号で対応づけ）"""
    ws.conditional_formatting = ConditionalFormattingList()
    ws.data_validations.dataValidation = [d for d in ws.data_validations.dataValidation
                                           if not (d.formula1 and '#REF!' in str(d.formula1))]
    st_by_row = {int(r['src'].split('!')[1]): r['st'] for r in rows}
    heads = {C_ST: '状態', C_KEY: '費目\n(自動)', C_LONG: '長期額\n(自動)', C_SKEY: '短期\n通番キー', C_LKEY: '長期\n通番キー',
             C_IDX: '計上列\n(自動)'}
    hdr_style = style_of(ws, 'H4')
    for col, t in heads.items():
        c = ws[f'{col}4']
        c.value = t
        c._style = copy(hdr_style)
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    for col, w in {C_ST: 10, C_KEY: 18, C_LONG: 11, C_SKEY: 20, C_LKEY: 20, C_IDX: 8}.items():
        ws.column_dimensions[col].width = w
    ws[f'{C_ST}3'] = '←支払担当者が「未確認」、経理担当者が伝票確認後に「確認済」'
    ws[f'{C_ST}3'].font = font(9, color=GREY)
    base = ws[f'F{first}']
    for r in range(first, last + 1):
        for c in range(1, 13):
            cell = ws.cell(r, c)
            if c == 13:
                continue
            black(cell)
            cell.fill = PatternFill(fill_type=None)
        ws[f'{C_ST}{r}'].value = st_by_row.get(r)
        ws[f'{C_KEY}{r}'] = (f'=IF($F{r}="","",IFERROR(VLOOKUP($C{r}&"|"&$D{r},{SH_MST}!$A$5:$B$200,2,FALSE),"※未登録"))')
        ws[f'{C_LONG}{r}'] = f'=IF($F{r}="","",$I{r}+$J{r}+$K{r})'
        ws[f'{C_SKEY}{r}'] = (f'=IF(OR($F{r}="",${C_ST}{r}="支払なし",$H{r}=0,${C_KEY}{r}=""),"",${C_KEY}{r}&"|S|"&'
                              f'(COUNTIF({C_SKEY}$4:{C_SKEY}{r - 1},${C_KEY}{r}&"|S|*")+1))')
        ws[f'{C_LKEY}{r}'] = (f'=IF(OR($F{r}="",${C_ST}{r}="支払なし",${C_LONG}{r}=0,${C_KEY}{r}=""),"",${C_KEY}{r}&"|L|"&'
                              f'(COUNTIF({C_LKEY}$4:{C_LKEY}{r - 1},${C_KEY}{r}&"|L|*")+1))')
        ws[f'{C_IDX}{r}'] = (f'=IF(OR($F{r}="",$A{r}=""),"",MOD(MONTH($A{r})-4,12)+1)' if kind == 'g' else
                             f'=IF($F{r}="","",13)')
        for col in (C_KEY, C_LONG, C_SKEY, C_LKEY, C_IDX):
            c = ws[f'{col}{r}']
            c.font = font(9, color='595959')
            c.fill = fill(GREY_L)
        for col in ('A', 'B', 'C', 'D', 'E', 'F', 'G', C_ST):
            if kind == 'g' and col == 'B':
                continue
            ws[f'{col}{r}'].fill = fill(YELLOW)
        if kind == 'g':
            ws[f'M{r}'] = f'=IF(F{r}="",0,MONTH(A{r}))'      # 月（旧：手入力・1行ずれの誤りがあった）
        ws[f'A{r}'].number_format = 'yyyy/m/d' if ws[f'A{r}'].number_format == 'General' else ws[f'A{r}'].number_format
    rng = f'A{first}:L{last}'
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'${C_ST}{first}="昨年実績"'],
                                                   font=Font(color=RED_T)))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'${C_ST}{first}="確認済"'],
                                                   font=Font(color='1F4E79', bold=True)))
    ws.conditional_formatting.add(rng, FormulaRule(formula=[f'${C_ST}{first}="支払なし"'],
                                                   font=Font(color='A6A6A6', strike=True)))
    dv = DataValidation(type='list', formula1=f'={SH_MST}!$I$5:$I$8', allow_blank=True)
    ws.add_data_validation(dv)
    dv.add(f'{C_ST}{first}:{C_ST}{last}')
    ws.conditional_formatting.add(
        f'{C_KEY}{first}:{C_KEY}{last}', FormulaRule(formula=[f'${C_KEY}{first}="※未登録"'],
                                                      font=Font(color='FFFFFF', bold=True),
                                                      fill=PatternFill('solid', bgColor=RED_T, fgColor=RED_T)))
    ws.auto_filter.ref = f'A4:{C_IDX}{last}'


# ----------------------------------------------------------------------------
# 予算差引簿（短・長・未払）を費目ごとに自動転記する形で作り直す
# ----------------------------------------------------------------------------
def count_by_key(rows, side):
    cnt = {}
    for r in rows:
        if r['st'] == '支払なし':
            continue
        key = GY_MAP.get(f"{r['chu']}|{r['sho'] or ''}")
        if not key or key == '対象外':
            continue
        t, h, ke, ta = split(r['amt'], r['kbn'])
        v = t if side == 'S' else h + ke + ta
        if v:
            cnt[key] = cnt.get(key, 0) + 1
    return cnt


def split(a, k):
    def xr(v):
        return math.floor(abs(v) + 0.5) * (1 if v >= 0 else -1)
    if k == 1:
        i, j, kk = xr(a * 10 / 23), xr(a / 23), xr(a / 23)
        return a - i - j - kk, i, j, kk
    if k == 2:
        return a, 0, 0, 0
    if k == 3:
        j = kk = xr(a / 12)
        return 0, a - j - kk, j, kk
    if k == 4:
        return 0, a, 0, 0
    if k == 5:
        i = xr(a * 10 / 11)
        return 0, i, a - i, 0
    if k == 6:
        return 0, 0, 0, a
    if k == 7:
        i = xr(a * 10 / 11)
        return 0, i, 0, a - i
    return 0, 0, a, 0


def rebuild_sasihiki(ws, side, src_sheet, src_first, src_last, budget_sheet, counts, unpaid=False):
    """ws を空にして、費目ごとのブロック（日付・摘要・支出・残額・状態）を作る。
    戻り値: {key: dict(first,last,cols,...)}"""
    tm = dict(head=style_of(ws, 'B3' if side == 'S' else 'B1'), side=style_of(ws, 'D3' if side == 'S' else 'D1'),
              lab=style_of(ws, 'C4' if side == 'S' else 'C2'), date=style_of(ws, 'A6' if side == 'S' else 'A4'),
              tek=style_of(ws, 'B6' if side == 'S' else 'B4'), amt=style_of(ws, 'C6' if side == 'S' else 'C4'),
              bal=style_of(ws, 'D6' if side == 'S' else 'D4'))
    # 日付・摘要の行スタイルが無い長期シートでは短期のものを借りる
    for mr in list(ws.merged_cells.ranges):
        ws.unmerge_cells(str(mr))
    ws.conditional_formatting = ConditionalFormattingList()
    ws.data_validations.dataValidation = []
    ws.delete_rows(1, ws.max_row + 5)
    ws.print_area = None
    sidelabel = '業務（短）' if side == 'S' else '業務（長）'
    if unpaid:
        sidelabel += '未払'
    caps = {}
    for k, h, br, y in GY_BLOCKS:
        c = counts.get(k, 0)
        caps[k] = max(12, int(math.ceil(c * 1.3)) + 8)
    order = sorted(GY_KEYS, key=lambda k: -caps[k])
    pos = {}
    r0 = 3
    for bi in range(0, len(order), 4):
        band = order[bi:bi + 4]
        height = max(caps[k] for k in band) + 4
        for j, k in enumerate(band):
            pos[k] = dict(row=r0, col=1 + 5 * j, cap=caps[k])
        r0 += height + 2
    for col in range(1, 21):
        ws.column_dimensions[L(col)].width = {0: 9, 1: 36, 2: 11, 3: 12, 4: 9}[(col - 1) % 5]
    out = {}
    for k, h, br, y in GY_BLOCKS:
        p = pos[k]
        b, c0, cap = p['row'], p['col'], p['cap']
        d, t, a, bal, st = (c0 + i for i in range(5))
        D, T, A, BAL, ST = (L(x) for x in (d, t, a, bal, st))
        ws.cell(b, t, h)._style = copy(tm['head'])
        ws.cell(b, bal, sidelabel)._style = copy(tm['side'])
        for i, lab in enumerate(['支出日', '摘要', '支出' if (br and not unpaid) else '支出', '残額' if (br and not unpaid) else '累計', '状態']):
            c = ws.cell(b + 1, d + i, lab)
            c._style = copy(tm['lab'])
            c.alignment = Alignment(horizontal='center')
        start = b + 2
        ws.cell(start, t, '予算現額' if (br and not unpaid) else '（予算なし）')._style = copy(tm['tek'])
        sc = ws.cell(start, bal)
        sc._style = copy(tm['bal'])
        if br and not unpaid:
            sc.value = f"='{budget_sheet}'!$S${br}"
        else:
            sc.value = 0
        ws.cell(start, d)._style = copy(tm['date'])
        ws.cell(start, a)._style = copy(tm['amt'])
        keycol = C_SKEY if side == 'S' else C_LKEY
        amtcol = 'H' if side == 'S' else C_LONG
        tag = 'S' if side == 'S' else 'L'
        sr = lambda c: f"{src_sheet}!${c}${src_first}:${c}${src_last}"
        warn = ws.cell(b, st, f'=IF(COUNTIF({sr(keycol)},"{k}|{tag}|*")>{cap},"行不足","")')
        warn.font = font(9, True, RED_T)
        for i in range(1, cap + 1):
            r = start + i
            m = f'MATCH("{k}|{tag}|{i}",{sr(keycol)},0)'
            pick = lambda col: f'=IFERROR(INDEX({sr(col)},{m}),"")'
            ws.cell(r, d, pick('A'))._style = copy(tm['date'])
            ws.cell(r, t, pick('E'))._style = copy(tm['tek'])
            ws.cell(r, a, pick(amtcol))._style = copy(tm['amt'])
            prev = f'{BAL}{r - 1}'
            if br and not unpaid:
                bf = f'=IF({A}{r}="","",{prev}-{A}{r})'
            else:
                bf = f'=IF({A}{r}="","",{prev}+{A}{r})'
            ws.cell(r, bal, bf)._style = copy(tm['bal'])
            sc2 = ws.cell(r, st, pick(C_ST))
            sc2.font = font(9, color='595959')
            sc2.alignment = Alignment(horizontal='center')
            ws.cell(r, d).number_format = 'm/d'
        first, last = start + 1, start + cap
        for rr in range(start, last + 1):
            for cc in (d, t, a, bal):
                black(ws.cell(rr, cc))
        rng = f'{D}{first}:{ST}{last}'
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f'${ST}{first}="昨年実績"'], font=Font(color=RED_T)))
        ws.conditional_formatting.add(f'{A}{first}:{A}{last}', FormulaRule(
            formula=[f'${ST}{first}="確認済"'], fill=PatternFill('solid', bgColor='DDEBF7', fgColor='DDEBF7')))
        ws.conditional_formatting.add(f'{A}{first}:{A}{last}', FormulaRule(
            formula=[f'${ST}{first}="未確認"'], fill=PatternFill('solid', bgColor=PENDING, fgColor=PENDING)))
        out[k] = dict(sheet=ws.title, first=first, last=last, d=D, t=T, a=A, bal=BAL, st=ST, cap=cap)
    ws.sheet_view.zoomScale = 70
    ws.freeze_panes = None
    return out


# ----------------------------------------------------------------------------
# 科目表
# ----------------------------------------------------------------------------
def build_master2(wb):
    ws = wb.create_sheet(SH_MST)
    ws.sheet_view.showGridLines = False
    title_band(ws, '科目表　（月例・決算整理の中項目／小項目を、差引簿の費目に振り分けるルール）', 12,
               sub='ふだんは触りません。新しい組み合わせを使うときだけ、左の表に1行追加してください（A列＝中項目|小項目、B列＝費目）。')
    ws.cell(4, 1, '中項目|小項目'); ws.cell(4, 2, '差引簿の費目')
    header_row(ws, 4, 1, 2)
    for i, (k, v) in enumerate(GY_MAP.items()):
        put(ws, (5 + i, 1), k, f=font(10, color=BLUE_IN), fl=YELLOW, bd=B_ROW)
        put(ws, (5 + i, 2), v, f=font(10, color=BLUE_IN), fl=YELLOW, bd=B_ROW)
    for r in range(5 + len(GY_MAP), 81):
        for c in (1, 2):
            ws.cell(r, c).fill = fill(YELLOW)
    ws.cell(4, 4, '状態'); ws.cell(4, 5, '意味')
    header_row(ws, 4, 4, 5)
    ws.cell(4, 9, '状態一覧'); header_row(ws, 4, 9, 9)
    meaning = ['昨年実績のまま（赤字）。今年の支払が確定するまで残す', '今年の支払として入力済み・伝票は未確認（黒字）',
               '支払伝票を確認済み（旧：青塗り）。締め月までの分が費用収益表に入る', '今年度は支払なし。差引簿・集計から除外']
    for i, v in enumerate(STATUS):
        put(ws, (5 + i, 4), v, bd=B_ROW)
        put(ws, (5 + i, 5), meaning[i], f=font(9), bd=B_ROW)
        put(ws, (5 + i, 9), v, bd=B_ROW)
    ws.cell(4, 14, '締め月一覧'); header_row(ws, 4, 14, 14)
    for i, v in enumerate(['なし'] + MONTHS):
        put(ws, (5 + i, 14), v, bd=B_ROW)
    for col, w in {'A': 30, 'B': 22, 'C': 3, 'D': 11, 'E': 56, 'F': 3, 'G': 3, 'H': 3, 'I': 11, 'N': 13}.items():
        ws.column_dimensions[col].width = w
    ws.sheet_properties.tabColor = '7F7F7F'
    return ws


# ----------------------------------------------------------------------------
# 差引簿集計（費目別・月別）
# ----------------------------------------------------------------------------
def month_range(i):
    m = (i + 2) % 12 + 1
    y = '年度+2018' if m >= 4 else '年度+2019'
    m2 = m + 1
    y2 = y
    if m2 == 13:
        m2, y2 = 1, '年度+2019'
    return f'DATE({y},{m},1)', f'DATE({y2},{m2},1)'


def build_agg(wb, title, sheetname, blocks, unpaid_blocks, hiyou_sheet, side_label):
    ws = wb.create_sheet(sheetname)
    ws.sheet_view.showGridLines = False
    title_band(ws, f'{title}　差引簿の費目ごとの月別合計（確認済のみ）→ 費用収益表へ　／　4月（未払）は「未払」差引簿の確認済', 20)
    ws['A3'] = '費目'
    for i in range(1, 14):
        ws.cell(2, 2 + i, i).font = font(8, color='A6A6A6')
        ws.cell(2, 2 + i).alignment = Alignment(horizontal='center')
        ws.cell(3, 2 + i, MONTHS[i - 1])
    for j, h in enumerate(['確認済計', '予算現額', '残額', '費用収益表', '行不足'], 16):
        ws.cell(3, j, h)
    header_row(ws, 3, 1, 20)
    ws.column_dimensions['A'].width = 26
    ws.column_dimensions['B'].width = 3
    for c in range(3, 16):
        ws.column_dimensions[L(c)].width = 12
    for c in range(16, 21):
        ws.column_dimensions[L(c)].width = 13
    rows = {}
    r = 4
    for k, h, br, y in GY_BLOCKS:
        rows[k] = r
        put(ws, (r, 1), k, bd=B_ROW)
        b = blocks[k]
        rg = lambda c, bb=b: f"'{bb['sheet']}'!${bb[c]}${bb['first']}:${bb[c]}${bb['last']}"
        for i in range(1, 13):
            s, e = month_range(i)
            put(ws, (r, 2 + i), f'=SUMIFS({rg("a")},{rg("st")},"確認済",{rg("d")},">="&{s},{rg("d")},"<"&{e})',
                nf=NUM, al=RIGHT, bd=B_ROW)
        u = unpaid_blocks[k]
        ur = lambda c, bb=u: f"'{bb['sheet']}'!${bb[c]}${bb['first']}:${bb[c]}${bb['last']}"
        put(ws, (r, 15), f'=SUMIFS({ur("a")},{ur("st")},"確認済")', nf=NUM, al=RIGHT, bd=B_ROW)
        put(ws, (r, 16), f'=SUM(C{r}:O{r})', nf=NUM, al=RIGHT, bd=B_ROW, f=font(bold=True))
        put(ws, (r, 17), f"='{hiyou_sheet}'!$S${br}" if br else None, nf=NUM, al=RIGHT, bd=B_ROW)
        put(ws, (r, 18), f'=IF(Q{r}="","",Q{r}-P{r})' if br else None, nf=NUM, al=RIGHT, bd=B_ROW)
        put(ws, (r, 19), 'Y' if y else 'N', al=Alignment(horizontal='center'), bd=B_ROW)
        put(ws, (r, 20), (f"=IF(OR('{b['sheet']}'!{b['st']}{b['first'] - 3}<>\"\","
                          f"'{u['sheet']}'!{u['st']}{u['first'] - 3}<>\"\"),\"行不足\",\"\")"),
            f=font(9, True, RED_T), bd=B_ROW)
        r += 1
        if k == '非常勤職員手当':
            rows[BONUS] = r
            put(ws, (r, 1), BONUS, f=font(9, color=GREY), bd=B_ROW)
            for i in range(1, 13):
                s, e = month_range(i)
                put(ws, (r, 2 + i), (f'=SUMIFS({rg("a")},{rg("st")},"確認済",{rg("d")},">="&{s},{rg("d")},"<"&{e},'
                                     f'{rg("t")},"*賞与*")'), nf=NUM, al=RIGHT, bd=B_ROW, f=font(9, color=GREY))
            put(ws, (r, 15), f'=SUMIFS({ur("a")},{ur("st")},"確認済",{ur("t")},"*賞与*")', nf=NUM, al=RIGHT, bd=B_ROW,
                f=font(9, color=GREY))
            put(ws, (r, 16), f'=SUM(C{r}:O{r})', nf=NUM, al=RIGHT, bd=B_ROW, f=font(9, color=GREY))
            put(ws, (r, 19), '内訳', al=Alignment(horizontal='center'), bd=B_ROW, f=font(9, color=GREY))
            r += 1
    last = r - 1
    put(ws, (r, 1), '費用収益表に入る合計', f=font(bold=True), fl=GREY_L, bd=B_ALL)
    for c in range(3, 17):
        cl = L(c)
        put(ws, (r, c), f'=SUMIF($S$4:$S${last},"Y",{cl}4:{cl}{last})', f=font(bold=True), fl=GREY_L, nf=NUM,
            al=RIGHT, bd=B_ALL)
    rows['__total__'] = r
    ws.freeze_panes = 'C4'
    ws.sheet_properties.tabColor = '2E75B6'
    return ws, rows


def kashi_block_ranges(blocks_meta):
    """費用収益表(貸付)の行 → 貸付差引簿のブロック"""
    m = {}
    for b in blocks_meta:
        key = (b['sheet'], b['c0'], b['label'])
        m[key] = b
    return m


KASHI_SRC = {   # 貸付キー -> (sheet idx, c0, label, 摘要の追加条件)
    '厚生費': (1, 0, '厚生費', None), '旅費': (0, 5, '旅費', None), '事務用消耗品費': (0, 0, '事務用消耗品費', None),
    '図書印刷費': (0, 5, '図書印刷費', None), '通信運搬費': (0, 5, '通信運搬費', None), '会議費': (0, 0, '会議費', None),
    '事務費・雑費': (0, 0, '雑費', None), '委託費': (1, 0, '委託費', None), '修繕費': (1, 0, '修繕費', None),
    '賃借料': (1, 0, '賃借料', None), '普及費': (1, 5, '普及費', None),
    '厚生年金保険料等': (1, 5, '負担金(共済費等以外）', '<>*労働保険*'),
    '労災・雇用等保険料': (1, 5, '負担金(共済費等以外）', '*労働保険*'),
    '連合会払込金': (1, 5, '連合会払込金', None), '雑費': (1, 5, '雑費', None),
}
K_SHEET = {0: SH_K1, 1: SH_K2}


def build_agg_kashi(wb, blocks_meta, residual):
    ws = wb.create_sheet(SH_SK)
    ws.sheet_view.showGridLines = False
    title_band(ws, '貸付差引簿集計　貸付予算差引簿の費目ごとの月別合計（確認済のみ）→ 費用収益表（貸付）へ　／　4月（未払）は翌年度4月の日付', 16)
    ws['A3'] = '費目'
    for i in range(1, 14):
        ws.cell(2, 2 + i, i).font = font(8, color='A6A6A6')
        ws.cell(2, 2 + i).alignment = Alignment(horizontal='center')
        ws.cell(3, 2 + i, MONTHS[i - 1])
    ws.cell(3, 16, '確認済計')
    header_row(ws, 3, 1, 16)
    ws.column_dimensions['A'].width = 40
    ws.column_dimensions['B'].width = 3
    for c in range(3, 17):
        ws.column_dimensions[L(c)].width = 12
    bm = kashi_block_ranges(blocks_meta)
    rows = {}
    r = 4
    for key in B.KASHI_KEYS:
        rows[key] = r
        put(ws, (r, 1), key, bd=B_ROW)
        src = KASHI_SRC.get(key)
        if src:
            si, c0, label, extra = src
            b = bm[(si, c0, label)]
            sh = K_SHEET[si]
            dcol, tcol, acol, scol = L(c0 + 1), L(c0 + 2), L(c0 + 3), L(c0 + 5)
            rg = lambda c: f"'{sh}'!${c}${b['first']}:${c}${b['last']}"
            ex = f',{rg(tcol)},"{extra}"' if extra else ''
            for i in range(1, 13):
                s, e = month_range(i)
                put(ws, (r, 2 + i), f'=SUMIFS({rg(acol)},{rg(scol)},"確認済",{rg(dcol)},">="&{s},{rg(dcol)},"<"&{e}{ex})',
                    nf=NUM, al=RIGHT, bd=B_ROW)
            put(ws, (r, 15), f'=SUMIFS({rg(acol)},{rg(scol)},"確認済",{rg(dcol)},">="&DATE(年度+2019,4,1){ex})',
                nf=NUM, al=RIGHT, bd=B_ROW)
        else:
            for i in range(1, 14):
                put(ws, (r, 2 + i), 0, nf=NUM, al=RIGHT, bd=B_ROW)
        put(ws, (r, 16), f'=SUM(C{r}:O{r})', nf=NUM, al=RIGHT, bd=B_ROW, f=font(bold=True))
        r += 1
    # 手入力行（旧・費用収益表で給与システム等から手入力されていた分）
    rows['厚生年金保険料等（手入力）'] = r
    put(ws, (r, 1), '厚生年金保険料等（給与システム等からの手入力）', bd=B_ROW)
    for i in range(1, 14):
        v = residual.get(i, 0)
        put(ws, (r, 2 + i), v if v else None, nf=NUM, al=RIGHT, bd=B_ROW, fl=YELLOW, f=font(color=BLUE_IN))
    put(ws, (r, 16), f'=SUM(C{r}:O{r})', nf=NUM, al=RIGHT, bd=B_ROW, f=font(bold=True))
    r += 1
    rows['__total__'] = r
    put(ws, (r, 1), '合計', f=font(bold=True), fl=GREY_L, bd=B_ALL)
    for c in range(3, 17):
        cl = L(c)
        put(ws, (r, c), f'=SUM({cl}4:{cl}{r - 1})', f=font(bold=True), fl=GREY_L, nf=NUM, al=RIGHT, bd=B_ALL)
    ws.freeze_panes = 'C4'
    ws.sheet_properties.tabColor = '2E75B6'
    return ws, rows


# ----------------------------------------------------------------------------
# 費用収益表を差引簿集計につなぐ
# ----------------------------------------------------------------------------
def link_hiyou(ws, kind, rows_map, agg_sheet, agg_rows, old_vals):
    """台帳連動の行を数式に。未締め月は旧表の値（前年実績・見込）を右側に退避して表示"""
    for r, key in rows_map.items():
        for col in range(3, 16):
            old = old_vals.get((r, col))
            rc = ws.cell(r, col + B.REF_OFF)
            rc.value = old if isinstance(old, float) else None
            rc.number_format = NUM
            rc.font = font(color=GREEN_T)
            cl = L(col)
            ref = f'{L(col + B.REF_OFF)}{r}'
            idx = f'{cl}$2'
            q = f"'{agg_sheet}'!"
            if kind == 'gyomu' and r == B.GYOMU_KAT_ROW:
                f = f"={'IF'}({idx}<=締月,{q}{cl}{agg_rows[key]}-{q}{cl}{agg_rows[BONUS]},{ref})"
            elif kind == 'gyomu' and r == B.GYOMU_BONUS_ROW:
                f = f"=IF({idx}<=締月,{q}{cl}{agg_rows[BONUS]},{ref})"
            elif kind == 'kashi' and key == '厚生年金保険料等':
                f = f"=IF({idx}<=締月,{q}{cl}{agg_rows[key]}+{q}{cl}{agg_rows['厚生年金保険料等（手入力）']},{ref})"
            else:
                f = f"=IF({idx}<=締月,{q}{cl}{agg_rows[key]},{ref})"
            c = ws.cell(r, col)
            c.value = f
            black(c)


def ref_block(ws, hr, last):
    for i in range(1, 14):
        put(ws, (hr, 26 + i), MONTHS[i - 1], f=font(9, True, 'FFFFFF'), fl='548235', al=CENTER)
    put(ws, (hr - 1, 27), '▼ 参考値（旧表の値：未締め月に表示される前年実績・見込）', f=font(9, True, GREEN_T))
    ws.column_dimensions.group('AA', 'AM', hidden=True, outline_level=1)
    for c in range(27, 40):
        ws.column_dimensions[L(c)].width = 11
    ws.conditional_formatting.add(f'C4:N{last}', FormulaRule(
        formula=['AND(ISNUMBER(C4),C$2<>"",C$2>締月)'], font=Font(color=GREEN_T)))
    ws.conditional_formatting.add(f'O4:O{last}', FormulaRule(
        formula=['AND(ISNUMBER(O4),締月<13)'], font=Font(color=RED_T)))


# ----------------------------------------------------------------------------
# 貸付予算差引簿（元の様式）に状態列を足す
# ----------------------------------------------------------------------------
def prep_kashi_sheet(ws, sheet_idx, blocks_meta, krows):
    for row in ws.iter_rows():                      # 他ブックへの参照 [1]R8貸付 → このブックの R8貸付
        for c in row:
            if isinstance(c.value, str) and c.value.startswith('=') and '[' in c.value:
                c.value = re.sub(r'\[\d+\](R8貸付|R7貸付)!', "'R8貸付'!", c.value)
                assert '[' not in c.value, c.value
    st_rows = {}
    for r in krows:
        if r['sheet'] == sheet_idx:
            st_rows[(r['c0'], r['rowno'])] = r
    ws.conditional_formatting = ConditionalFormattingList()
    for b in blocks_meta:
        if b['sheet'] != sheet_idx:
            continue
        c0 = b['c0']
        d, t, a, bal, st = (c0 + i for i in range(1, 6))
        lab = ws.cell(b['header'] + 1, st, '状態')
        lab.font = copy(ws.cell(b['header'] + 1, a).font)
        lab.alignment = Alignment(horizontal='center')
        ws.column_dimensions[L(st)].width = 8
        for r in range(b['first'] + 1, b['last'] + 1):
            row = st_rows.get((c0, r))
            for c in (d, t, a, bal):
                cell = ws.cell(r, c)
                if cell.fill and cell.fill.fill_type and cell.fill.fgColor.rgb not in ('FFFFFF00', '00FFFF00'):
                    cell.fill = PatternFill(fill_type=None)
                black(cell)
            sc = ws.cell(r, st)
            sc.value = row['st'] if row else None
            sc.font = font(9, color='595959')
            sc.alignment = Alignment(horizontal='center')
            for c in (d, t, a, st):
                cell = ws.cell(r, c)
                if not (cell.fill.fill_type and cell.fill.fgColor.rgb in ('FFFFFF00', '00FFFF00')):
                    cell.fill = fill(YELLOW)
            if row and row['date'] and ws.cell(r, d).value is not None and isinstance(ws.cell(r, d).value, (datetime.datetime, datetime.date)):
                ws.cell(r, d).value = datetime.datetime.combine(row['date'], datetime.time())
        first = b['first'] + 1
        S = L(st)
        rng = f'{L(d)}{first}:{L(bal)}{b["last"]}'
        ws.conditional_formatting.add(rng, FormulaRule(formula=[f'${S}{first}="昨年実績"'], font=Font(color=RED_T)))
        ws.conditional_formatting.add(f'{L(a)}{first}:{L(a)}{b["last"]}', FormulaRule(
            formula=[f'${S}{first}="確認済"'], fill=PatternFill('solid', bgColor='DDEBF7', fgColor='DDEBF7')))
        dv = DataValidation(type='list', formula1=f'={SH_MST}!$I$5:$I$8', allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f'{S}{first}:{S}{b["last"]}')


def compute_residuals(krows, old_vals):
    """貸付予算差引簿から再現できない旧表の手入力値（給与システム等）を {idx: 金額} で返す"""
    got = {}
    for r in krows:
        if r['st'] == '確認済' and r['kind'] == '通常' and r['date']:
            idx = (r['date'].month - 4) % 12 + 1
            got[(r['key'], idx)] = got.get((r['key'], idx), 0) + r['amt']
    res = {}
    for row, key in B.KASHI_ROWS.items():
        for col in range(3, 3 + X.BASE_MONTH - 3):
            old = old_vals.get((row, col))
            old = old if isinstance(old, float) else 0.0
            diff = old - got.get((key, col - 2), 0)
            if abs(diff) > 0.5:
                assert key == '厚生年金保険料等', (key, col, diff)
                res[col - 2] = diff
    return res


# ----------------------------------------------------------------------------
# 月次締め / 検算 / 使い方
# ----------------------------------------------------------------------------
TOTAL_ROWS = {SH_HT: (38, 46), SH_HC: (38, 46), SH_HK: (31, 36)}
K_BLOCKS = sorted({v[:3] for v in KASHI_SRC.values()})


def kashi_terms(blocks_meta, fn):
    """貸付差引簿の全ブロックについて fn(sheet名, 日付列, 摘要列, 金額列, 状態列, first, last) を足し合わせる式"""
    bm = kashi_block_ranges(blocks_meta)
    out = []
    for si, c0, label in K_BLOCKS:
        b = bm[(si, c0, label)]
        out.append(fn(f"'{K_SHEET[si]}'", L(c0 + 1), L(c0 + 2), L(c0 + 3), L(c0 + 5), b['first'] + 1, b['last']))
    return '+'.join(out)


def build_control2(wb, blocks_meta):
    ws = wb.create_sheet(SH_CTL)
    ws.sheet_view.showGridLines = False
    title_band(ws, '月次締め　操作盤と出納計算表との照合', 10,
               sub='月次〆のときは「今回締める月」を選ぶだけです。費用収益表がその月まで自動で確定表示になります（転記は不要）。'
                   '黄色のセルに仮締めした出納計算表の月合計を入力し、差額が 0 になればOKです。')
    for col, w in {'A': 2, 'B': 30, 'C': 17, 'D': 17, 'E': 15, 'F': 17, 'G': 17, 'H': 15, 'I': 24, 'J': 3}.items():
        ws.column_dimensions[col].width = w
    put(ws, 'B4', '年度（令和）', f=font(10, True))
    put(ws, 'C4', f"='{SH_HG}'!E1", f=font(12, True), al=Alignment(horizontal='center'), bd=B_ALL, nf='0')
    put(ws, 'D4', '← 費用収益表（長+短）の年度から', f=font(9, color=GREY))
    put(ws, 'B5', '今回締める月', f=font(11, True, NAVY))
    put(ws, 'C5', '9月', f=font(13, True, BLUE_IN), fl=YELLOW, al=Alignment(horizontal='center'), bd=B_ALL)
    ws.merge_cells('D5:I5')
    put(ws, 'D5', '← ここを変えると、その月まで費用収益表に確定計上されます（9月締め済みなら「9月」）', f=font(9, color=GREY))
    put(ws, 'B6', '月番号（自動）', f=font(9, color=GREY))
    put(ws, 'C6', f'=MATCH($C$5,{SH_MST}!$N$5:$N$18,0)-1', f=font(9, color=GREY), al=Alignment(horizontal='center'), nf='0')
    put(ws, 'B7', '対象月の開始日／翌月初（自動）', f=font(9, color=GREY))
    put(ws, 'C7', '=IF(締月=0,0,IF(締月=13,DATE(年度+2019,4,1),DATE(年度+2018+IF(締月>9,1,0),MOD(締月+2,12)+1,1)))',
        f=font(9, color=GREY), nf='yyyy/m/d', al=Alignment(horizontal='center'))
    put(ws, 'D7', '=EDATE(C7,1)', f=font(9, color=GREY), nf='yyyy/m/d', al=Alignment(horizontal='center'))
    dv = DataValidation(type='list', formula1=f'={SH_MST}!$N$5:$N$18', allow_blank=False, showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add('C5')
    put(ws, 'F4', '自動検算', f=font(10, True), al=Alignment(horizontal='right'))
    ws.merge_cells('G4:I4')
    put(ws, 'G4', f'=IF({SH_CHK}!$F$3=0,"すべてOK","NG "&{SH_CHK}!$F$3&"件（検算シート参照）")',
        f=font(11, True, 'FFFFFF'), fl='548235', al=Alignment(horizontal='center'))
    ws.conditional_formatting.add('G4:I4', FormulaRule(formula=[f'{SH_CHK}!$F$3>0'], fill=PatternFill(
        'solid', bgColor=RED_T, fgColor=RED_T)))
    wb.defined_names['年度'] = DefinedName('年度', attr_text=f"'{SH_CTL}'!$C$4")
    wb.defined_names['締月'] = DefinedName('締月', attr_text=f"'{SH_CTL}'!$C$6")
    wb.defined_names['月初'] = DefinedName('月初', attr_text=f"'{SH_CTL}'!$C$7")
    wb.defined_names['翌月初'] = DefinedName('翌月初', attr_text=f"'{SH_CTL}'!$D$7")

    put(ws, 'B9', '① 締める前のチェック（今回締める月の分）', f=font(11, True, NAVY))
    for c in range(2, 10):
        ws.cell(9, c).border = Border(bottom=MED)
    for i, h in enumerate(['項目', '業務', '貸付', '対応'], 2):
        ws.cell(10, i, h)
    header_row(ws, 10, 2, 5)
    ws.merge_cells('E10:I10')

    def g(fn):
        return (f"IF(締月=0,0,{fn(SH_G, G_FIRST, G_LAST)}+{fn(SH_KS, K_FIRST, K_LAST)})")

    def cnt(st):
        return g(lambda sh, a, b: f'COUNTIFS({sh}!${C_IDX}${a}:${C_IDX}${b},締月,{sh}!${C_ST}${a}:${C_ST}${b},"{st}")')

    def kcnt(st):
        return 'IF(締月=0,0,' + kashi_terms(blocks_meta, lambda sh, d, t, a, s, f1, l1: (
            f'COUNTIFS({sh}!${s}${f1}:${s}${l1},"{st}",{sh}!${d}${f1}:${d}${l1},">="&月初,{sh}!${d}${f1}:${d}${l1},"<"&翌月初)')) + ')'
    ng_g = (f'COUNTIF({SH_G}!${C_KEY}${G_FIRST}:${C_KEY}${G_LAST},"※未登録")+COUNTIF({SH_KS}!${C_KEY}${K_FIRST}:${C_KEY}${K_LAST},"※未登録")'
            f"+COUNTIF('{SH_ST}'!$T$4:$T$80,\"行不足\")+COUNTIF('{SH_SC}'!$T$4:$T$80,\"行不足\")")
    ng_k = kashi_terms(blocks_meta, lambda sh, d, t, a, s, f1, l1: (
        f'COUNTIFS({sh}!${d}${f1}:${d}${l1},">0",{sh}!${s}${f1}:${s}${l1},"")'))
    amt_g = g(lambda sh, a, b: f'SUMIFS({sh}!$F${a}:$F${b},{sh}!${C_IDX}${a}:${C_IDX}${b},締月,{sh}!${C_ST}${a}:${C_ST}${b},"確認済")')
    amt_k = 'IF(締月=0,0,' + kashi_terms(blocks_meta, lambda sh, d, t, a, s, f1, l1: (
        f'SUMIFS({sh}!${a}${f1}:${a}${l1},{sh}!${s}${f1}:${s}${l1},"確認済",{sh}!${d}${f1}:${d}${l1},">="&月初,{sh}!${d}${f1}:${d}${l1},"<"&翌月初)')) + ')'
    items = [
        ('確認済の件数', '=' + cnt('確認済'), '=' + kcnt('確認済'), '差引簿・費用収益表に計上される行数'),
        ('未確認（伝票待ち）の件数', '=' + cnt('未確認'), '=' + kcnt('未確認'), '0 にしてから締めます（伝票を確認して「確認済」へ）'),
        ('昨年実績のまま残っている件数（参考）', '=' + cnt('昨年実績'), '=' + kcnt('昨年実績'), '今年は支払がない行は「支払なし」にすると見やすくなります'),
        ('点検NGの件数', '=' + ng_g, '=' + ng_k, '費目未登録・差引簿の行不足・状態未設定'),
        ('確認済 金額合計', '=' + amt_g, '=' + amt_k, '業務は短期＋長期の合計（月例＋決算整理）'),
    ]
    for k, (lab, fg, fk, memo) in enumerate(items):
        r = 11 + k
        put(ws, (r, 2), lab, bd=B_ROW)
        put(ws, (r, 3), fg, nf=NUM0, al=RIGHT, bd=B_ROW)
        put(ws, (r, 4), fk, nf=NUM0, al=RIGHT, bd=B_ROW)
        ws.merge_cells(start_row=r, start_column=5, end_row=r, end_column=9)
        put(ws, (r, 5), memo, f=font(9, color=GREY), bd=B_ROW)
    put(ws, 'B16', '締め可否', f=font(10, True), fl=GREY_L, bd=B_ALL)
    for col in ('C', 'D'):
        put(ws, f'{col}16', f'=IF(締月=0,"-",IF(AND({col}12=0,{col}14=0),"OK","要対応"))', f=font(10, True), fl=GREY_L,
            al=Alignment(horizontal='center'), bd=B_ALL)
    ws.merge_cells('E16:I16')
    ws.conditional_formatting.add('C16:D16', FormulaRule(formula=['C16="OK"'], font=Font(bold=True, color='548235')))
    ws.conditional_formatting.add('C16:D16', FormulaRule(formula=['C16="要対応"'], font=Font(bold=True, color=RED_T)))

    r0 = 19
    put(ws, (r0, 2), '② 出納計算表との照合（黄色のセルに仮締めした出納計算表の月合計を入力）', f=font(11, True, NAVY))
    for c in range(2, 10):
        ws.cell(r0, c).border = Border(bottom=MED)
    r = r0 + 2
    for lab, sh in (('業務経理（短期）', SH_HT), ('業務経理（長期）', SH_HC), ('貸付経理', SH_HK)):
        put(ws, (r, 2), lab, f=font(10, True, 'FFFFFF'), fl='2E75B6', bd=B_ALL)
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
        for c in range(3, 10):
            ws.cell(r, c).fill = fill('2E75B6')
        r += 1
        for i, h in enumerate(['月', '費用', '', '', '収益', '', '', '判定'], 2):
            ws.cell(r, i, h)
        header_row(ws, r, 2, 9, 18)
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=5)
        ws.merge_cells(start_row=r, start_column=6, end_row=r, end_column=8)
        r += 1
        for i, h in enumerate(['', '費用収益表', '出納計算表', '差額', '費用収益表', '出納計算表', '差額', ''], 2):
            ws.cell(r, i, h)
        header_row(ws, r, 2, 9, 18)
        r += 1
        exp_r, rev_r = TOTAL_ROWS[sh]
        first = r
        for i in range(13):
            col = L(3 + i)
            put(ws, (r, 2), MONTHS[i], bd=B_ROW, al=Alignment(horizontal='center'))
            put(ws, (r, 3), f"='{sh}'!{col}{exp_r}", nf=NUM, al=RIGHT, bd=B_ROW)
            put(ws, (r, 4), None, f=font(10, color=BLUE_IN), fl=YELLOW, nf='#,##0', al=RIGHT, bd=B_ALL)
            put(ws, (r, 5), f'=IF(D{r}="","",C{r}-D{r})', nf=NUM0, al=RIGHT, bd=B_ROW)
            put(ws, (r, 6), f"='{sh}'!{col}{rev_r}", nf=NUM, al=RIGHT, bd=B_ROW)
            put(ws, (r, 7), None, f=font(10, color=BLUE_IN), fl=YELLOW, nf='#,##0', al=RIGHT, bd=B_ALL)
            put(ws, (r, 8), f'=IF(G{r}="","",F{r}-G{r})', nf=NUM0, al=RIGHT, bd=B_ROW)
            put(ws, (r, 9), (f'=IF({i + 1}>締月,"",IF(OR(D{r}="",G{r}=""),"出納計算表 未入力",'
                             f'IF(AND(E{r}=0,H{r}=0),"OK","NG　差額あり")))'),
                al=Alignment(horizontal='center'), f=font(10, True), bd=B_ROW)
            r += 1
        ws.conditional_formatting.add(f'B{first}:I{r - 1}', FormulaRule(
            formula=[f'ROW()-{first}+1>締月'], font=Font(color='A6A6A6')))
        ws.conditional_formatting.add(f'I{first}:I{r - 1}', FormulaRule(
            formula=[f'LEFT(I{first},2)="NG"'], font=Font(bold=True, color='FFFFFF'),
            fill=PatternFill('solid', bgColor=RED_T, fgColor=RED_T)))
        ws.conditional_formatting.add(f'I{first}:I{r - 1}', FormulaRule(
            formula=[f'I{first}="OK"'], font=Font(bold=True, color='548235')))
        ws.conditional_formatting.add(f'I{first}:I{r - 1}', FormulaRule(
            formula=[f'RIGHT(I{first},3)="未入力"'], font=Font(color='BF8F00')))
        put(ws, (r, 2), '締め月までの合計', f=font(10, True), fl=GREY_L, bd=B_ALL)
        for cc in (3, 4, 6, 7):
            cl = L(cc)
            put(ws, (r, cc), f'=SUMPRODUCT((ROW({cl}{first}:{cl}{r - 1})-{first}+1<=締月)*{cl}{first}:{cl}{r - 1})',
                f=font(10, True), fl=GREY_L, nf=NUM, al=RIGHT, bd=B_ALL)
        put(ws, (r, 5), f'=C{r}-D{r}', f=font(10, True), fl=GREY_L, nf=NUM0, al=RIGHT, bd=B_ALL)
        put(ws, (r, 8), f'=F{r}-G{r}', f=font(10, True), fl=GREY_L, nf=NUM0, al=RIGHT, bd=B_ALL)
        put(ws, (r, 9), None, fl=GREY_L, bd=B_ALL)
        r += 2
    ws.freeze_panes = 'A9'
    ws.sheet_properties.tabColor = 'C00000'
    return ws


def build_checks2(wb, blocks_meta, agg_t, agg_c, agg_k, old_cell):
    ws = wb.create_sheet(SH_CHK)
    ws.sheet_view.showGridLines = False
    title_band(ws, '検算　（数字が食い違っていないかを自動で確かめます）', 7,
               sub='「結果」が全部 OK なら、月例／決算整理 → 差引簿 → 集計 → 費用収益表 の数字は一致しています。NG があれば、その行の説明を見て直してください。')
    for col, w in {'A': 2, 'B': 62, 'C': 17, 'D': 17, 'E': 14, 'F': 9, 'G': 60}.items():
        ws.column_dimensions[col].width = w
    put(ws, 'B3', 'NG の件数', f=font(10, True), al=Alignment(horizontal='right'))
    for i, h in enumerate(['確認項目', '期待値（元側）', '実際（転記先）', '差', '結果', '見方'], 2):
        ws.cell(5, i, h)
    header_row(ws, 5, 2, 7)

    def hy(sh, col):
        return f"'{sh}'!${col}$4:${col}$62"

    def agg_sum(agg_sheet, rows):
        last = rows['__total__'] - 1
        return (f"SUMPRODUCT((('{agg_sheet}'!$S$4:$S${last}=\"Y\")+('{agg_sheet}'!$S$4:$S${last}=\"N\"))*"
                f"'{agg_sheet}'!$C$4:$O${last}*('{agg_sheet}'!$C$2:$O$2<=締月))")

    def agg_y(agg_sheet, rows):
        t = rows['__total__']
        return f"SUMPRODUCT(('{agg_sheet}'!$C$2:$O$2<=締月)*'{agg_sheet}'!$C${t}:$O${t})"

    def led(side_col):
        return '+'.join(
            f'SUMIFS({sh}!${side_col}${a}:${side_col}${b},{sh}!${C_ST}${a}:${C_ST}${b},"確認済",{sh}!${C_IDX}${a}:${C_IDX}${b},"<="&締月,{sh}!${C_KEY}${a}:${C_KEY}${b},"<>対象外")'
            for sh, a, b in ((SH_G, G_FIRST, G_LAST), (SH_KS, K_FIRST, K_LAST)))

    def unconf(sh, a, b):
        return f'COUNTIFS({sh}!${C_IDX}${a}:${C_IDX}${b},"<="&締月,{sh}!${C_ST}${a}:${C_ST}${b},"未確認")'

    kledger = kashi_terms(blocks_meta, lambda sh, d, t, a, s, f1, l1: (
        f'SUMIFS({sh}!${a}${f1}:${a}${l1},{sh}!${s}${f1}:${s}${l1},"確認済",{sh}!${d}${f1}:${d}${l1},">="&DATE(年度+2018,4,1),'
        f'{sh}!${d}${f1}:${d}${l1},"<"&IF(締月=13,DATE(年度+2019,5,1),IF(締月=0,DATE(年度+2018,4,1),翌月初)))'))
    kt = agg_k['__total__']
    km = agg_k['厚生年金保険料等（手入力）']
    kunconf = kashi_terms(blocks_meta, lambda sh, d, t, a, s, f1, l1: (
        f'COUNTIFS({sh}!${s}${f1}:${s}${l1},"未確認",{sh}!${d}${f1}:${d}${l1},"<"&IF(締月=0,0,IF(締月=13,DATE(年度+2019,5,1),翌月初)))'))
    rows = [
        ('業務：合計表 ＝ 短期表 ＋ 長期表（費用・全月）',
         f"=SUM('{SH_HT}'!C38:O38)+SUM('{SH_HC}'!C38:O38)", f"=SUM('{SH_HG}'!C38:O38)", ''),
        ('業務：合計表 ＝ 短期表 ＋ 長期表（収益・全月）',
         f"=SUM('{SH_HT}'!C46:O46)+SUM('{SH_HC}'!C46:O46)", f"=SUM('{SH_HG}'!C47:O47)",
         '合計表の収益合計は47行目（繰入が2行あるため）'),
        ('月例・決算整理（確認済・短期）＝ 予算差引簿（短）の月別集計（締め月まで）', '=' + led('H'), '=' + agg_sum(SH_ST, agg_t),
         '月例に入力した確認済の金額が、差引簿へ漏れなく転記されているか'),
        ('月例・決算整理（確認済・長期）＝ 予算差引簿（長）の月別集計（締め月まで）', '=' + led(C_LONG), '=' + agg_sum(SH_SC, agg_c), ''),
        ('業務（短期）：差引簿集計 ＝ 費用収益表への計上額（締め月まで）', '=' + agg_y(SH_ST, agg_t),
         f"=SUMPRODUCT({hy(SH_HT, 'X')},{hy(SH_HT, 'V')})", '差引簿の月別合計が費用収益表に入っているか'),
        ('業務（長期）：差引簿集計 ＝ 費用収益表への計上額（締め月まで）', '=' + agg_y(SH_SC, agg_c),
         f"=SUMPRODUCT({hy(SH_HC, 'X')},{hy(SH_HC, 'V')})", ''),
        ('貸付：貸付予算差引簿の確認済 ＝ 貸付差引簿集計（手入力行を除く）', '=' + kledger,
         f"=SUMPRODUCT(('{SH_SK}'!$C$2:$O$2<=締月)*('{SH_SK}'!$C${kt}:$O${kt}-'{SH_SK}'!$C${km}:$O${km}))",
         '日付の年が違う行（例：2025年）は集計に入らず、ここでNGになります'),
        ('貸付：貸付差引簿集計 ＝ 費用収益表への計上額（締め月まで）',
         f"=SUMPRODUCT(('{SH_SK}'!$C$2:$O$2<=締月)*'{SH_SK}'!$C${kt}:$O${kt})",
         f"=SUMPRODUCT({hy(SH_HK, 'X')},{hy(SH_HK, 'V')})", ''),
        ('点検に指摘のある件数（費目未登録・差引簿の行不足）', '=0',
         f'=COUNTIF({SH_G}!${C_KEY}${G_FIRST}:${C_KEY}${G_LAST},"※未登録")+COUNTIF({SH_KS}!${C_KEY}${K_FIRST}:${C_KEY}${K_LAST},"※未登録")'
         f"+COUNTIF('{SH_ST}'!$T$4:$T$80,\"行不足\")+COUNTIF('{SH_SC}'!$T$4:$T$80,\"行不足\")",
         '月例の費目(Q列)に「※未登録」／差引簿の行数が足りない費目がないか'),
        ('業務：締め月までに「未確認」が残っていない', '=0', f'={unconf(SH_G, G_FIRST, G_LAST)}+{unconf(SH_KS, K_FIRST, K_LAST)}',
         '伝票を確認して「確認済」にしてから締める'),
        ('貸付：締め月までに「未確認」が残っていない', '=0', f'={kunconf}', ''),
        ('旧・費用収益表との一致（旧表で確定計上済みの月＝9月締めの状態）', '=0', f'={old_cell}',
         '「今回締める月」が9月のときだけ比較します（他の月は対象外として0扱い）'),
    ]
    for i, (lab, exp, act, memo) in enumerate(rows):
        r = 6 + i
        put(ws, (r, 2), lab, bd=B_ROW, al=Alignment(wrap_text=True, vertical='center'))
        put(ws, (r, 3), exp, nf=NUM0, al=RIGHT, bd=B_ROW)
        put(ws, (r, 4), act, nf=NUM0, al=RIGHT, bd=B_ROW)
        put(ws, (r, 5), f'=D{r}-C{r}', nf=NUM0, al=RIGHT, bd=B_ROW)
        put(ws, (r, 6), f'=IF(ABS(E{r})<0.5,"OK","NG")', f=font(10, True), al=Alignment(horizontal='center'), bd=B_ROW)
        put(ws, (r, 7), memo, f=font(9, color=GREY), bd=B_ROW, al=Alignment(wrap_text=True, vertical='center'))
        ws.row_dimensions[r].height = 28
    last = 6 + len(rows) - 1
    put(ws, 'C3', f'=COUNTIF(F6:F{last},"NG")', f=font(11, True), nf='0', al=Alignment(horizontal='center'))
    ws['F3'].value = '=C3'
    ws['F3'].font = font(8, color='FFFFFF')
    ws.conditional_formatting.add(f'F6:F{last}', FormulaRule(formula=['F6="NG"'], font=Font(bold=True, color='FFFFFF'),
                                                             fill=PatternFill('solid', bgColor=RED_T, fgColor=RED_T)))
    ws.conditional_formatting.add(f'F6:F{last}', FormulaRule(formula=['F6="OK"'], font=Font(bold=True, color='548235')))
    ws.sheet_properties.tabColor = '548235'
    return ws


def build_help2(wb):
    ws = wb.create_sheet(SH_HELP)
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 2
    ws.column_dimensions['B'].width = 26
    ws.column_dimensions['C'].width = 74
    ws.column_dimensions['D'].width = 50
    title_band(ws, '令和8年度　業務経理区分別執行管理簿（統合版）　使い方', 4,
               sub='元の「業務経理区分別執行管理簿」「貸付予算差引簿」「費用収益表」を1つにまとめました。シートの様式は元のままで、転記を自動にしています。')
    r = 4

    def section(text):
        nonlocal r
        put(ws, (r, 2), text, f=font(11, True, 'FFFFFF'), fl=NAVY)
        ws.cell(r, 3).fill = fill(NAVY)
        ws.cell(r, 4).fill = fill(NAVY)
        r += 1

    def row(a, b, c=None):
        nonlocal r
        put(ws, (r, 2), a, f=font(10, True), bd=B_ROW, al=Alignment(vertical='top', wrap_text=True))
        put(ws, (r, 3), b, bd=B_ROW, al=Alignment(vertical='top', wrap_text=True))
        put(ws, (r, 4), c, f=font(9, color=GREY), bd=B_ROW, al=Alignment(vertical='top', wrap_text=True))
        n = max(len(b or '') / 38, len(c or '') / 30, 1)
        ws.row_dimensions[r].height = max(18, 14.5 * (int(n) + 1))
        r += 1

    section('転記の流れ（すべて自動）')
    row('① 入力', '業務：「月例」に支払を入力（決算整理＝未払金は「決算整理」シート）。貸付：「貸付予算差引簿」の各費目に入力。', '入力するのは黄色のセルだけ')
    row('② 差引簿へ', '「予算差引簿（短）」「予算差引簿（長）」へ、費目ごとに日付・摘要・金額が自動で転記されます。決算整理の分は「…未払」シートへ。', '人件費（非常勤職員手当・賃金）など全ての費目')
    row('③ 月別合計', '「差引簿集計（短）（長）」「貸付差引簿集計」で、費目ごとの月別合計が自動で出ます。', '確認済の分だけを集計')
    row('④ 費用収益表へ', '費用収益表の各費目・各月へ自動で入ります。「月次締め」の「今回締める月」までが確定表示、それ以降は前年実績・見込（緑字）。', '手で転記する必要はありません')
    r += 1
    section('毎月の作業')
    row('支払担当者', '昨年実績の行を今年の支払に直し（日付・摘要・金額）、状態を「昨年実績」→「未確認」へ。', '旧：赤字を黒字にして金額を修正')
    row('経理担当者', '支払伝票が回ってきたら状態を「未確認」→「確認済」へ（プルダウン）。', '旧：金額を青く塗りつぶし')
    row('経理〆', '「月次締め」で今回締める月を選び、仮締め出納計算表の月合計を黄色セルに入力。差額0で OK。「検算」シートが全部 OK ならこのブックの数字は一致しています。', '')
    r += 1
    section('色のルール')
    row('黄色のセル', '手入力するセル。それ以外は数式なので触りません。マクロ版（.xlsm）ではEnterで次の黄色セルへ移動します。')
    row('赤字', '状態＝昨年実績（今年の支払が確定するまで残す行）。')
    row('青字（月例）／水色の背景（差引簿の支出）', '状態＝確認済。')
    row('オレンジの背景（差引簿の支出）', '状態＝未確認。')
    row('取り消し線（月例）', '状態＝支払なし（今年度は支払がない行。差引簿・集計から除外）。')
    r += 1
    section('追加した列・シート（元の様式への追加）')
    row('月例・決算整理 P〜U列', 'P＝状態（入力）。Q〜U＝自動計算の作業列（費目・長期額・差引簿への通番・計上列）。消さないでください。')
    row('予算差引簿の「状態」列', '各ブロックの右端。月例の状態が自動で表示されます。')
    row('貸付予算差引簿の「状態」列', '各ブロックの右端（入力）。')
    row('差引簿のブロックの大きさ', '行数は余裕を持たせてあります。足りなくなると見出しの右に赤字で「行不足」と出ます。')
    ws.sheet_properties.tabColor = '1F3864'
    return ws


# ----------------------------------------------------------------------------
# 組み立て
# ----------------------------------------------------------------------------
def main(gyomu_xlsx, kashi_xls, hiyou_xls, out):
    work = Path(tempfile.mkdtemp())
    grows, gnotes = X.load_gyomu(gyomu_xlsx)
    krows, knotes = X.load_kashitsuke(kashi_xls)
    for r in krows:
        r['key'] = B.kashi_key(r)
    blocks_meta = knotes['blocks']
    conv_h, oldvals = X.load_old_hiyou(hiyou_xls, work)
    conv_k = X.convert_xls_to_xlsx(kashi_xls, work)
    residual = compute_residuals(krows, oldvals[SH_HK])

    wb = openpyxl.load_workbook(gyomu_xlsx)
    wb._external_links = []
    for n in list(wb.defined_names.keys()):
        if '#REF!' in str(wb.defined_names[n].attr_text) or '[' in str(wb.defined_names[n].attr_text):
            del wb.defined_names[n]
    build_master2(wb)

    g_rows = [r for r in grows if r['kind'] == '月例']
    k_rows = [r for r in grows if r['kind'] == '決算整理']
    prep_input_sheet(wb[SH_G], g_rows, G_FIRST, G_LAST, 'g')
    prep_input_sheet(wb[SH_KS], k_rows, K_FIRST, K_LAST, 'k')

    dt, dc = wb[SH_DT], wb[SH_DC]
    ut = wb.copy_worksheet(dt)
    ut.title = SH_UT
    uc = wb.copy_worksheet(dc)
    uc.title = SH_UC
    bl_t = rebuild_sasihiki(dt, 'S', SH_G, G_FIRST, G_LAST, SH_HT, count_by_key(g_rows, 'S'))
    bl_c = rebuild_sasihiki(dc, 'L', SH_G, G_FIRST, G_LAST, SH_HC, count_by_key(g_rows, 'L'))
    bl_ut = rebuild_sasihiki(ut, 'S', SH_KS, K_FIRST, K_LAST, SH_HT, count_by_key(k_rows, 'S'), unpaid=True)
    bl_uc = rebuild_sasihiki(uc, 'L', SH_KS, K_FIRST, K_LAST, SH_HC, count_by_key(k_rows, 'L'), unpaid=True)
    _, agg_t = build_agg(wb, '差引簿集計（短期）', SH_ST, bl_t, bl_ut, SH_HT, '短')
    _, agg_c = build_agg(wb, '差引簿集計（長期）', SH_SC, bl_c, bl_uc, SH_HC, '長')

    src_k = openpyxl.load_workbook(conv_k)
    k1 = copy_sheet(src_k.worksheets[0], wb, SH_K1)
    k2 = copy_sheet(src_k.worksheets[1], wb, SH_K2)
    prep_kashi_sheet(k1, 0, blocks_meta, krows)
    prep_kashi_sheet(k2, 1, blocks_meta, krows)
    _, agg_k = build_agg_kashi(wb, blocks_meta, residual)

    src_h = openpyxl.load_workbook(conv_h)
    hiyou = {}
    plan = [(SH_HG, 'gyomu', {}, None, None), (SH_HT, 'gyomu', B.GYOMU_ROWS, SH_ST, agg_t),
            (SH_HC, 'gyomu', B.GYOMU_ROWS, SH_SC, agg_c), (SH_HK, 'kashi', B.KASHI_ROWS, SH_SK, agg_k)]
    for name, kind, rows_map, agg_sheet, agg_rows in plan:
        ws = copy_sheet(src_h[name], wb, name)
        if rows_map:
            link_hiyou(ws, kind, rows_map, agg_sheet, agg_rows, oldvals[name])
        exp_last = 31 if kind == 'kashi' else 38
        B.hiyou_columns_extra(ws, {'exp': 3}, kind, list(rows_map), exp_last)
        ref_block(ws, 3, ws.max_row)
        hiyou[name] = (ws, None, kind)
    B.mark_hiyou_inputs(hiyou)

    build_control2(wb, blocks_meta)
    _, old_cell = B.build_old_compare(wb, oldvals, {n: n for n in (SH_HG, SH_HT, SH_HC, SH_HK)})
    build_checks2(wb, blocks_meta, agg_t, agg_c, agg_k, old_cell)
    build_help2(wb)

    order = [SH_HELP, SH_CTL, SH_G, SH_KS, SH_DT, SH_DC, SH_UT, SH_UC, SH_ST, SH_SC, SH_K1, SH_K2, SH_SK,
             SH_HG, SH_HT, SH_HC, SH_HK, '給付区分別執行額（月別）', '給付区分別執行額（年度分）', 'リスト', '端数処理',
             SH_MST, SH_CHK, SH_OLD, 'Sheet1', 'Sheet2']
    wb._sheets = [wb[n] for n in order]
    wb.active = 1
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = (ws.title == SH_CTL)
    tab = {SH_G: '2E75B6', SH_KS: '2E75B6', SH_DT: '548235', SH_DC: '548235', SH_UT: '7F7F7F', SH_UC: '7F7F7F',
           SH_ST: '548235', SH_SC: '548235', SH_K1: '2E75B6', SH_K2: '2E75B6', SH_SK: '548235'}
    for n, c in tab.items():
        wb[n].sheet_properties.tabColor = c
    for n in (SH_HG, SH_HT, SH_HC, SH_HK):
        wb[n].sheet_properties.tabColor = '1F3864'
    for n in (SH_DT, SH_DC, SH_UT, SH_UC):
        B.page(wb[n], False, None, paper=8)
    for n in (SH_ST, SH_SC, SH_SK, SH_CTL, SH_CHK, SH_HELP):
        B.page(wb[n], True)
    wb.calculation.fullCalcOnLoad = True
    wb.properties.creator = ''
    wb.properties.lastModifiedBy = ''
    wb.save(out)
    meta = dict(n_gyomu=len(grows), n_kashi=len(krows), residual=residual,
                blocks_t={k: v['cap'] for k, v in bl_t.items()}, blocks_c={k: v['cap'] for k, v in bl_c.items()},
                notes=dict(g={k: len(v) for k, v in gnotes.items()}))
    Path(str(out) + '.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    return meta


if __name__ == '__main__':
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(1)
    m = main(*sys.argv[1:5])
    print(json.dumps({k: m[k] for k in ('n_gyomu', 'n_kashi', 'residual')}, ensure_ascii=False))
