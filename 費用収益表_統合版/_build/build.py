"""R8 費用収益表 統合版ブックを作る。

使い方:
  python3 build.py <管理簿.xlsx> <貸付予算差引簿.xls> <費用収益表.xls> <出力.xlsx>

旧: 管理簿(月例) / 予算差引簿 → (人が転記) → 費用収益表
新: 入力シート(台帳) → (SUMIFS で自動計上) → 費用収益表 → 出納計算表と自動照合
"""
import datetime
import json
import re
import sys
import tempfile
from pathlib import Path

import openpyxl
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.properties import PageSetupProperties
from openpyxl.worksheet.datavalidation import DataValidation

sys.path.insert(0, str(Path(__file__).parent))
import extract as X

# ----------------------------------------------------------------------------
# 定数
# ----------------------------------------------------------------------------
FN = 'Meiryo UI'
NAVY, NAVY_L = '1F3864', 'D9E1F2'
GREY, GREY_L = '7F7F7F', 'F2F2F2'
RED_T, GREEN_T = 'C00000', '548235'
BLUE_IN = '0000FF'
CONFIRM_FILL = 'DDEBF7'       # 確認済（旧: 青塗り）
YELLOW = 'FFFF99'          # 手入力セル（VBAのINPUT_COLORと同じ）
PENDING = 'FCE4D6'         # 状態＝未確認
NUM = '#,##0;[Red]-#,##0;"-"'
NUM0 = '#,##0;[Red]-#,##0;0'

OLD_NAMES = {
    'R7業務（長+短）': '費用収益表_業務合計',
    'R7業務 (短)': '費用収益表_業務短期',
    'R7業務（長）': '費用収益表_業務長期',
    'R8貸付': '費用収益表_貸付',
}
SH_GOUKEI, SH_TAN, SH_CHO, SH_KASHI = (OLD_NAMES[k] for k in
                                       ('R7業務（長+短）', 'R7業務 (短)', 'R7業務（長）', 'R8貸付'))
SH_IN_G, SH_IN_K, SH_MST, SH_CTL, SH_CHK, SH_OLD, SH_HELP, SH_RPT = (
    '入力_業務', '入力_貸付', '科目表', '月次締め', '検算', '旧表照合', '使い方', '給付区分別')

G_FIRST, G_LAST = 5, 1604      # 入力_業務 の行範囲
K_FIRST, K_LAST = 5, 404       # 入力_貸付 の行範囲
MONTHS = ['4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月', '4月(未払)']
STATUS = ['昨年実績', '未確認', '確認済', '支払なし']
REF_OFF = 24                   # 参考値ブロックは 元の列 + 24 (C→AA ... O→AM)

# 業務: 費用収益表の行 -> 台帳の「費用収益表科目」
GYOMU_ROWS = {
    4: '役員報酬', 10: '厚生費', 11: '旅費',
    12: '事務用消耗品費', 13: '図書印刷費', 14: '送金料', 15: '通信運搬費', 16: '会議費', 17: '事務費・雑費',
    20: '委託費', 21: '光熱水料', 22: '修繕費', 23: '賃借料', 24: '普及費', 25: '諸謝金',
    26: '会議出席負担金等', 27: '互助会費', 28: '協会けんぽ保険料等', 29: '共済負担金等', 30: '厚年負担金等',
    31: '労災・雇用保険料', 32: '県社保協会費',
    34: '連合会分担金', 35: '事務費負担金払込金', 36: '雑費', 37: '減価償却費',
    56: '非常勤職員手当', 57: '非常勤職員手当', 59: '賃金',
}
GYOMU_BONUS_ROW, GYOMU_KAT_ROW = 57, 56           # 増額報酬 / 嘱託報酬
# 貸付
KASHI_ROWS = {
    7: '厚生費', 8: '旅費', 9: '事務用消耗品費', 10: '図書印刷費', 11: '通信運搬費', 12: '会議費', 13: '事務費・雑費',
    16: '委託費', 17: '修繕費', 18: '賃借料', 19: '普及費', 20: '食糧費',
    24: '厚生年金保険料等', 25: '労災・雇用等保険料', 26: 'その他負担金', 29: '連合会払込金', 30: '雑費',
}

# 業務 (中項目|小項目) -> 費用収益表科目
def gyomu_mapping():
    m = {}
    def add(chu, shos, target):
        for s in shos:
            m[f'{chu}|{s}'] = target
    add('役員報酬', [''], '役員報酬')
    add('職員給与', ['', '非常勤職員手当'], '非常勤職員手当')
    add('厚生費', ['', '健康診断費'], '厚生費')
    add('旅費', [''], '旅費')
    for s, t in (('事務用消耗品費', '事務用消耗品費'), ('図書印刷費', '図書印刷費'), ('送金料', '送金料'),
                 ('通信運搬費', '通信運搬費'), ('会議費', '会議費'), ('雑費', '事務費・雑費'), ('', '事務費・雑費')):
        m[f'事務費|{s}'] = t
    add('賃金', [''], '賃金')
    add('委託費', [''], '委託費')
    add('光熱水料', ['', 'ガス料', '水道料', '電気料'], '光熱水料')
    add('修繕費', [''], '修繕費')
    add('賃借料', [''], '賃借料')
    add('普及費', [''], '普及費')
    add('諸謝金', [''], '諸謝金')
    for s, t in (('互助会費', '互助会費'), ('会議出席負担金等', '会議出席負担金等'),
                 ('協会けんぽ保険料等', '協会けんぽ保険料等'), ('厚年負担金等', '厚年負担金等'),
                 ('労災・雇用保険料', '労災・雇用保険料'), ('負担金', '共済負担金等'), ('', '県社保協会費')):
        m[f'負担金|{s}'] = t
    add('連合会分担金', ['', '市町村連合会分担金'], '連合会分担金')
    add('事務費負担金払込金', [''], '事務費負担金払込金')
    add('雑費', [''], '雑費')
    add('減価償却費', [''], '減価償却費')
    for chu in ('器具及び備品', '前期損益修正損', '立替金', '仮払消費税', '調査研究費', '交際費', '選挙費',
                '前払費用', '特別修繕引当金繰入', '支払利息', '雑損', '前期損益修正損'):
        m[f'{chu}|'] = '対象外'
    return m


GYOMU_MAP = gyomu_mapping()
GYOMU_TARGETS = sorted(set(GYOMU_MAP.values()) - {'対象外'}, key=lambda t: list(GYOMU_MAP.values()).index(t))
KASHI_KEYS = [KASHI_ROWS[r] for r in sorted(KASHI_ROWS)]

CHU_LIST = ['役員報酬', '職員給与', '厚生費', '旅費', '事務費', '賃金', '委託費', '光熱水料', '修繕費', '賃借料',
            '調査研究費', '普及費', '諸謝金', '器具及び備品', '負担金', '仮払消費税', '交際費', '選挙費',
            '事務費負担金払込金', '雑費', '減価償却費', '連合会分担金', '支払利息', '立替金', '前払費用', '前期損益修正損']
SHO_LIST = ['非常勤職員手当', '送金料', '通信運搬費', 'ガス料', '退職給与金', '健康診断費', '事務用消耗品費',
            '図書印刷費', '会議費', '雑費', '電気料', '協会けんぽ保険料等', '厚年負担金等', '労災・雇用保険料',
            '会議出席負担金等', '市町村連合会分担金', '互助会費', '水道料', '負担金']


def kashi_key(row):
    b = row['block']
    if b == '雑費':
        return '事務費・雑費' if row['sheet'] == 0 else '雑費'
    if b.startswith('負担金'):
        return '労災・雇用等保険料' if '労働保険' in row['tek'] else '厚生年金保険料等'
    return b


# ----------------------------------------------------------------------------
# スタイル部品
# ----------------------------------------------------------------------------
def font(size=10, bold=False, color='000000', italic=False):
    return Font(name=FN, size=size, bold=bold, color=color, italic=italic)


def fill(c):
    return PatternFill('solid', fgColor=c)


THIN = Side(style='thin', color='BFBFBF')
HAIR = Side(style='hair', color='BFBFBF')
MED = Side(style='thin', color=NAVY)
B_ALL = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
B_ROW = Border(bottom=HAIR)
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)
LEFT = Alignment(horizontal='left', vertical='center', wrap_text=False)
RIGHT = Alignment(horizontal='right', vertical='center')


def put(ws, ref, value=None, f=None, fl=None, al=None, nf=None, bd=None):
    c = ws[ref] if isinstance(ref, str) else ws.cell(*ref)
    if value is not None:
        c.value = value
    c.font = f or font()
    if fl:
        c.fill = fill(fl)
    if al:
        c.alignment = al
    if nf:
        c.number_format = nf
    if bd:
        c.border = bd
    return c


def title_band(ws, text, last_col, row=1, sub=None):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=last_col)
    put(ws, (row, 1), text, f=font(14, True, 'FFFFFF'), fl=NAVY, al=Alignment(vertical='center', indent=1))
    for c in range(2, last_col + 1):
        ws.cell(row, c).fill = fill(NAVY)
    ws.row_dimensions[row].height = 26
    if sub:
        ws.merge_cells(start_row=row + 1, start_column=1, end_row=row + 1, end_column=last_col)
        put(ws, (row + 1, 1), sub, f=font(9, color=GREY), al=Alignment(vertical='center', indent=1, wrap_text=True))
        ws.row_dimensions[row + 1].height = 30


def header_row(ws, row, c1, c2, h=22):
    for c in range(c1, c2 + 1):
        cell = ws.cell(row, c)
        cell.font = font(10, True, 'FFFFFF')
        cell.fill = fill(NAVY)
        cell.alignment = CENTER
        cell.border = B_ALL
    ws.row_dimensions[row].height = h



def page(ws, landscape=True, title_rows=None, paper=9):
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.orientation = 'landscape' if landscape else 'portrait'
    ws.page_setup.paperSize = paper
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_options.horizontalCentered = True
    ws.page_margins.left = ws.page_margins.right = 0.4
    ws.page_margins.top = ws.page_margins.bottom = 0.5
    if title_rows:
        ws.print_title_rows = title_rows

# ----------------------------------------------------------------------------
# 費用収益表シートの整形・数式化
# ----------------------------------------------------------------------------
def row_role(ws, r):
    a, b = ws.cell(r, 1).value, ws.cell(r, 2).value
    a = a if isinstance(a, str) else ''
    b = b if isinstance(b, str) else ''
    if r == 1:
        return 'title'
    if a in ('費用', '収益'):
        return 'section'
    if a in ('支払月', '区　　　分') or b.startswith('参考'):
        return 'header'
    lab = (b or a).strip()
    if lab.endswith('計') or a.startswith('合') or '収益－費用' in a:
        return 'total'
    return 'data'


def prepare_hiyou_sheet(ws, name, kind):
    """kind: 'gyomu' | 'kashi'"""
    # 旧タイトル欄・凡例をクリア
    for mr in list(ws.merged_cells.ranges):
        if str(mr) == 'E1:F1':
            ws.unmerge_cells(str(mr))
    for ref in ('E1', 'G1', 'O1', 'P1', 'O2', 'F1'):
        ws[ref].value = None
    # 見出し行の位置
    hdr = {}
    for r in range(1, ws.max_row + 1):
        a = ws.cell(r, 1).value
        b = ws.cell(r, 2).value
        if a == '支払月':
            hdr['exp'] = r
        elif isinstance(a, str) and a.startswith('区') and a.replace('　', '') == '区分':
            hdr['rev'] = r
        elif isinstance(b, str) and b.startswith('参考'):
            hdr['ref'] = r
        elif a == '収益':
            hdr['revsec'] = r
    return hdr


def style_hiyou(ws, name, hdr, kind):
    last_row = ws.max_row
    ws.sheet_view.showGridLines = False
    ws.sheet_view.zoomScale = 90
    widths = {'A': 14, 'B': 20}
    for c in range(3, 16):
        widths[L(c)] = 12.5
    for c in range(16, 21):
        widths[L(c)] = 13.5
    widths['U'] = 12
    widths['V'] = 13.5
    widths['W'] = 13.5
    for k, v in widths.items():
        ws.column_dimensions[k].width = v
    for r in range(1, last_row + 1):
        role = row_role(ws, r)
        for c in range(1, 24):
            cell = ws.cell(r, c)
            v = cell.value
            if role == 'title':
                continue
            cell.font = font()
            cell.border = Border()
            cell.fill = PatternFill(fill_type=None)
            if c >= 3 and (isinstance(v, (int, float)) or (isinstance(v, str) and v.startswith('='))):
                cell.number_format = NUM
                cell.alignment = RIGHT
            if role == 'section':
                cell.font = font(11, True, NAVY)
                cell.border = Border(bottom=MED)
            elif role == 'header' and c <= 20:
                cell.font = font(10, True, 'FFFFFF')
                cell.fill = fill(NAVY)
                cell.alignment = CENTER
                cell.border = B_ALL
            elif role == 'total' and c <= 20:
                cell.font = font(10, True)
                cell.fill = fill(GREY_L)
                cell.border = Border(top=THIN, bottom=THIN)
            elif role == 'data' and c <= 20 and (ws.cell(r, 1).value or ws.cell(r, 2).value or v is not None):
                cell.border = B_ROW
        if role == 'header':
            ws.row_dimensions[r].height = 22
    # 行ラベルは左寄せ
    for r in range(2, last_row + 1):
        for c in (1, 2):
            if ws.cell(r, c).value is not None and row_role(ws, r) not in ('header',):
                ws.cell(r, c).alignment = Alignment(horizontal='left', vertical='center')
    ws.freeze_panes = 'C4'
    for part in (ws.oddHeader, ws.oddFooter, ws.evenHeader, ws.evenFooter, ws.firstHeader, ws.firstFooter):
        part.left.text = part.center.text = part.right.text = None


def hiyou_columns_extra(ws, hdr, kind, ledger_rows, exp_last):
    """補助列: 2行目の月番号 / 締め月累計 / 予算残額 / マーカー / 参考値ブロック見出し"""
    # 月番号（作業行）
    put(ws, 'A2', '費用', f=font(11, True, NAVY), al=Alignment(horizontal='left'))
    for i in range(1, 14):
        put(ws, (2, 2 + i), i, f=font(8, color='A6A6A6'), al=Alignment(horizontal='center'), nf='0')
        ws.cell(2, 2 + i).border = Border(bottom=MED)
    # 見出し
    hr = hdr['exp']
    put(ws, (hr, 22), '締め月まで\n累計', f=font(10, True, 'FFFFFF'), fl=NAVY, al=CENTER, bd=B_ALL)
    put(ws, (hr, 23), '予算残額\n（現在）', f=font(10, True, 'FFFFFF'), fl=NAVY, al=CENTER, bd=B_ALL)
    smerged = set()
    for mr in ws.merged_cells.ranges:
        if mr.min_col <= 19 <= mr.max_col:
            for rr in range(mr.min_row, mr.max_row + 1):
                smerged.add(rr)
    for r in range(hr + 1, ws.max_row + 1):
        role = row_role(ws, r)
        if role not in ('data', 'total'):
            continue
        if not (ws.cell(r, 1).value or ws.cell(r, 2).value):
            continue
        c = put(ws, (r, 22), f'=SUMIF($C$2:$N$2,"<="&締月,C{r}:N{r})', f=font(bold=(role == 'total')), nf=NUM,
                al=RIGHT)
        if role == 'total':
            c.fill = fill(GREY_L)
        sv = ws.cell(r, 19).value
        if sv is not None and r not in smerged and r <= exp_last:
            w = put(ws, (r, 23), f'=S{r}-V{r}', f=font(bold=(role == 'total')), nf=NUM, al=RIGHT)
            if role == 'total':
                w.fill = fill(GREY_L)
    # 台帳連動行のマーカー（検算用・非表示）
    put(ws, (hr, 24), '台帳連動', f=font(8, color=GREY))
    for r in ledger_rows:
        put(ws, (r, 24), 1, f=font(8, color=GREY), nf='0')
    ws.column_dimensions['X'].hidden = True


def make_ledger_formula(sheet_kind, key, r, col, idx_cell, side_col=None, extra=None):
    """費用収益表の1セル(台帳連動)の数式"""
    ref = f'{L(col + REF_OFF)}{r}'
    if sheet_kind == 'gyomu':
        rng = lambda c: f"{SH_IN_G}!${c}${G_FIRST}:${c}${G_LAST}"
        crit = f'{rng("O")},"{key}",{rng("P")},{idx_cell},{rng("I")},"確認済"'
        s = f'SUMIFS({rng(side_col)},{crit}' + (f',{rng("F")},"{extra}"' if extra else '') + ')'
    else:
        rng = lambda c: f"{SH_IN_K}!${c}${K_FIRST}:${c}${K_LAST}"
        crit = f'{rng("D")},"{key}",{rng("H")},{idx_cell},{rng("G")},"確認済"'
        s = f'SUMIFS({rng("F")},{crit})'
    return s, ref


def apply_ledger_formulas(ws, kind, rows_map, side_col, old_vals):
    """台帳連動セルを数式化し、旧表の値を参考値ブロックへ退避する"""
    for r, key in rows_map.items():
        for col in range(3, 16):
            old = old_vals.get((r, col))
            ov = old if isinstance(old, float) else None
            ref_cell = ws.cell(r, col + REF_OFF)
            ref_cell.value = ov
            ref_cell.number_format = NUM
            ref_cell.font = font(color=GREEN_T)
            idx = f'{L(col)}$2'
            if kind == 'gyomu' and r == GYOMU_KAT_ROW:
                s, ref = make_ledger_formula(kind, key, r, col, idx, side_col)
                bonus = f'{L(col)}{GYOMU_BONUS_ROW}'
                formula = f'=IF({idx}<=締月,{s}-{bonus},{ref})'
            elif kind == 'gyomu' and r == GYOMU_BONUS_ROW:
                s, ref = make_ledger_formula(kind, key, r, col, idx, side_col, extra='*賞与*')
                formula = f'=IF({idx}<=締月,{s},{ref})'
            else:
                s, ref = make_ledger_formula(kind, key, r, col, idx, side_col)
                formula = f'=IF({idx}<=締月,{s},{ref})'
            c = ws.cell(r, col)
            c.value = formula
            c.number_format = NUM
            c.alignment = RIGHT


def finish_hiyou(ws, hdr, kind, data_cols=(3, 15)):
    """条件付き書式: 未締め月=緑字 / 見込(4月未払)=濃赤 / 参考値ブロックの見出し"""
    hr = hdr['exp']
    # 参考値ブロック
    hr_ref = hr
    put(ws, (hr_ref - 1 if hr_ref > 1 else hr_ref, 27), '▼ 参考値（旧表の値：未締め月に表示される前年実績・見込）',
        f=font(9, True, GREEN_T))
    for i in range(1, 14):
        put(ws, (hr_ref, 26 + i), ws.cell(hr_ref, 2 + i).value if False else MONTHS[i - 1],
            f=font(9, True, 'FFFFFF'), fl='548235', al=CENTER)
    ws.column_dimensions.group('AA', 'AM', hidden=True, outline_level=1)
    for c in range(27, 40):
        ws.column_dimensions[L(c)].width = 11
    last = ws.max_row
    green = Font(name=FN, size=10, color=GREEN_T)
    red = Font(name=FN, size=10, color=RED_T)
    rng = f'C4:N{last}'
    ws.conditional_formatting.add(
        rng, FormulaRule(formula=['AND(ISNUMBER(C4),C$2<>"",C$2>締月)'], font=green))
    ws.conditional_formatting.add(
        f'O4:O{last}', FormulaRule(formula=['AND(ISNUMBER(O4),締月<13)'], font=red))
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.paperSize = 8       # A3
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_area = f'A1:W{last}'
    ws.print_title_rows = '1:3'


# ----------------------------------------------------------------------------
# 台帳シート
# ----------------------------------------------------------------------------
def status_cf(ws, rng, first_row, status_col, max_col):
    c = status_col
    red = FormulaRule(formula=[f'${c}{first_row}="昨年実績"'], font=Font(name=FN, size=10, color=RED_T))
    ok = FormulaRule(formula=[f'${c}{first_row}="確認済"'], fill=PatternFill('solid', bgColor=CONFIRM_FILL,
                                                                           fgColor=CONFIRM_FILL))
    pend = FormulaRule(formula=[f'${c}{first_row}="未確認"'], fill=PatternFill('solid', bgColor=PENDING,
                                                                            fgColor=PENDING))
    none = FormulaRule(formula=[f'${c}{first_row}="支払なし"'],
                       font=Font(name=FN, size=10, color='A6A6A6', strike=True))
    for rule in (none, red):
        ws.conditional_formatting.add(rng, rule)
    for rule in (ok, pend):                      # 塗りは No 列だけ（B列以降は手入力の黄色を保つ）
        ws.conditional_formatting.add(f'A{first_row}:A{rng.split(":")[1][1:]}', rule)


def build_ledger_gyomu(wb, rows):
    ws = wb.create_sheet(SH_IN_G)
    ws.sheet_view.showGridLines = False
    title_band(ws, '入力_業務　業務経理 台帳（旧：管理簿「月例」「決算整理」を一本化）', 18,
               sub='支払担当者：昨年実績の行を今年の支払に直し、状態を「未確認」へ。　経理担当者：支払伝票を確認したら状態を「確認済」へ（旧：金額を青塗り）。'
                   '　色は状態から自動で付きます（赤字＝昨年実績／黄＝未確認／青＝確認済）。　灰色の列は数式なので消さないでください。')
    heads = ['No', '種別', '支払日', '中項目', '小項目', '摘要', '金額', '経費区分', '状態',
             '短期', '厚年', '経過的', '退職等', '長期計', '費用収益表の行', '計上列', '点検', '元データ']
    hr = 4
    for i, h in enumerate(heads, 1):
        ws.cell(hr, i, h)
    header_row(ws, hr, 1, 18, 24)
    widths = [6, 9, 11, 14, 17, 50, 12, 8, 10, 11, 11, 10, 10, 11, 17, 7, 24, 12]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[L(i)].width = w
    ws.row_dimensions[3].height = 6
    for i in range(G_FIRST, G_LAST + 1):
        r = i
        k = i - G_FIRST
        row = rows[k] if k < len(rows) else None
        if row:
            vals = [k + 1, row['kind'], row['date'], row['chu'], row['sho'], row['tek'], row['amt'],
                    row['kbn'], row['st']]
            for c, v in enumerate(vals, 1):
                if v is not None:
                    ws.cell(r, c, v)
            ws.cell(r, 18, row['src'])
        G = f'$G{r}'
        H = f'$H{r}'
        ws.cell(r, 10, f'=IF({G}="","",IF({H}=1,{G}-ROUND({G}*10/23,0)-2*ROUND({G}/23,0),IF({H}=2,{G},0)))')
        ws.cell(r, 11, f'=IF({G}="","",IF({H}=1,ROUND({G}*10/23,0),IF({H}=3,{G}-2*ROUND({G}/12,0),'
                       f'IF({H}=4,{G},IF(OR({H}=5,{H}=7),ROUND({G}*10/11,0),0)))))')
        ws.cell(r, 12, f'=IF({G}="","",IF({H}=1,ROUND({G}/23,0),IF({H}=3,ROUND({G}/12,0),'
                       f'IF({H}=5,{G}-ROUND({G}*10/11,0),IF({H}=8,{G},0)))))')
        ws.cell(r, 13, f'=IF({G}="","",IF({H}=1,ROUND({G}/23,0),IF({H}=3,ROUND({G}/12,0),'
                       f'IF({H}=6,{G},IF({H}=7,{G}-ROUND({G}*10/11,0),0)))))')
        ws.cell(r, 14, f'=IF({G}="","",K{r}+L{r}+M{r})')
        ws.cell(r, 15, f'=IF({G}="","",IFERROR(VLOOKUP($D{r}&"|"&$E{r},{SH_MST}!$A$5:$B$200,2,FALSE),"※未登録"))')
        ws.cell(r, 16, f'=IF(OR({G}="",$C{r}=""),"",IF($B{r}="決算整理",13,MOD(MONTH($C{r})-4,12)+1))')
        fy_s = f'DATE(年度+2018,4,1)'
        fy_e = f'DATE(年度+2019,3,31)'
        ws.cell(r, 17, (
            f'=IF({G}="","",TRIM('
            f'IF(J{r}+K{r}+L{r}+M{r}<>{G},"按分不一致 ","")'
            f'&IF(O{r}="※未登録","科目未登録 ","")'
            f'&IF(OR({H}="",ISERROR(MATCH({H},{{1,2,3,4,5,6,7,8}},0))),"経費区分? ","")'
            f'&IF($I{r}="","状態未設定 ","")'
            f'&IF(AND(OR($I{r}="確認済",$I{r}="未確認"),$B{r}="月例",OR($C{r}="",$C{r}<{fy_s},$C{r}>{fy_e})),"年度外の日付 ","")'
            f'&IF(AND(OR($I{r}="確認済",$I{r}="未確認"),O{r}="対象外"),"対象外の科目 ","")))'))
        for c in range(1, 19):
            cell = ws.cell(r, c)
            cell.font = font(10, color=BLUE_IN) if c in (2, 3, 4, 5, 6, 7, 8, 9) else font(10, color='404040')
            cell.border = B_ROW
            if 2 <= c <= 9:
                cell.fill = fill(YELLOW)
            if c in (10, 11, 12, 13, 14):
                cell.fill = fill(GREY_L)
                cell.number_format = NUM
            if c == 7:
                cell.number_format = '#,##0;[Red]-#,##0'
            if c == 3:
                cell.number_format = 'yyyy/mm/dd'
                cell.alignment = Alignment(horizontal='center')
            if c in (1, 2, 8, 9, 16):
                cell.alignment = Alignment(horizontal='center')
            if c == 15:
                cell.fill = fill(GREY_L)
            if c in (15, 16, 17):
                cell.font = font(10, color='404040')
    ws.freeze_panes = 'G5'
    ws.auto_filter.ref = f'A{hr}:R{G_LAST}'
    status_cf(ws, f'A{G_FIRST}:I{G_LAST}', G_FIRST, 'I', 9)
    ws.conditional_formatting.add(
        f'Q{G_FIRST}:Q{G_LAST}', FormulaRule(formula=[f'LEN($Q{G_FIRST})>0'],
                                              font=Font(name=FN, size=10, bold=True, color='FFFFFF'),
                                              fill=PatternFill('solid', bgColor=RED_T, fgColor=RED_T)))
    # 入力規則
    def dv(lst, rng, strict=True):
        d = DataValidation(type='list', formula1=lst, allow_blank=True, showErrorMessage=strict)
        d.error = 'リストから選んでください'
        ws.add_data_validation(d)
        d.add(rng)
    dv('"月例,決算整理"', f'B{G_FIRST}:B{G_LAST}')
    dv(f'={SH_MST}!$F$5:$F$40', f'D{G_FIRST}:D{G_LAST}')
    dv(f'={SH_MST}!$G$5:$G$40', f'E{G_FIRST}:E{G_LAST}')
    dv('"1,2,3,4,5,6,7,8"', f'H{G_FIRST}:H{G_LAST}')
    dv(f'={SH_MST}!$I$5:$I$8', f'I{G_FIRST}:I{G_LAST}')
    ddate = DataValidation(type='date', operator='greaterThan', formula1='36526', allow_blank=True,
                           showErrorMessage=True)
    ddate.error = '日付（例 2026/10/21）で入力してください'
    ws.add_data_validation(ddate)
    ddate.add(f'C{G_FIRST}:C{G_LAST}')
    ws.sheet_properties.tabColor = '2E75B6'
    return ws


def build_ledger_kashi(wb, rows):
    ws = wb.create_sheet(SH_IN_K)
    ws.sheet_view.showGridLines = False
    title_band(ws, '入力_貸付　貸付経理 台帳（旧：貸付予算差引簿を一本化）', 11,
               sub='科目ごとに並べてあります（予算差引簿と同じ見方で「見込残額」が見られます）。新しい支払は最終行の下に追記してください。'
                   '　状態の使い方は「入力_業務」と同じです。　種別「決算整理」＝3月分を4月に支払うもの（旧：黄色）。')
    heads = ['No', '種別', '支払日', '科目', '摘要', '金額', '状態', '計上列', '見込残額', '点検', '元データ']
    hr = 4
    for i, h in enumerate(heads, 1):
        ws.cell(hr, i, h)
    header_row(ws, hr, 1, 11, 24)
    widths = [6, 9, 11, 20, 50, 12, 10, 7, 13, 22, 12]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[L(i)].width = w
    ws.row_dimensions[3].height = 6
    for i in range(K_FIRST, K_LAST + 1):
        r = i
        k = i - K_FIRST
        row = rows[k] if k < len(rows) else None
        if row:
            vals = [k + 1, row['kind'], row['date'], row['key'], row['tek'], row['amt'], row['st']]
            for c, v in enumerate(vals, 1):
                if v is not None:
                    ws.cell(r, c, v)
            ws.cell(r, 11, row['src'])
        F = f'$F{r}'
        ws.cell(r, 8, f'=IF(OR({F}="",$C{r}=""),"",IF($B{r}="決算整理",13,MOD(MONTH($C{r})-4,12)+1))')
        ws.cell(r, 9, f'=IF(OR({F}="",$D{r}=""),"",IFERROR(INDEX({SH_KASHI}!$S$1:$S$60,VLOOKUP($D{r},'
                      f'{SH_MST}!$K$5:$L$40,2,FALSE))-SUMIFS($F${K_FIRST}:$F{r},$D${K_FIRST}:$D{r},$D{r}),"?"))')
        fy_s, fy_e = 'DATE(年度+2018,4,1)', 'DATE(年度+2019,3,31)'
        ws.cell(r, 10, (
            f'=IF({F}="","",TRIM('
            f'IF(ISERROR(MATCH($D{r},{SH_MST}!$K$5:$K$40,0)),"科目未登録 ","")'
            f'&IF($G{r}="","状態未設定 ","")'
            f'&IF(AND(OR($G{r}="確認済",$G{r}="未確認"),$B{r}="通常",OR($C{r}="",$C{r}<{fy_s},$C{r}>{fy_e})),"年度外の日付 ","")))'))
        for c in range(1, 12):
            cell = ws.cell(r, c)
            cell.font = font(10, color=BLUE_IN) if c in (2, 3, 4, 5, 6, 7) else font(10, color='404040')
            cell.border = B_ROW
            if 2 <= c <= 7:
                cell.fill = fill(YELLOW)
            if c == 3:
                cell.number_format = 'yyyy/mm/dd'
                cell.alignment = Alignment(horizontal='center')
            if c in (6,):
                cell.number_format = '#,##0;[Red]-#,##0'
            if c == 9:
                cell.number_format = NUM
                cell.fill = fill(GREY_L)
            if c in (1, 2, 7, 8):
                cell.alignment = Alignment(horizontal='center')
            if c in (8, 10):
                cell.font = font(10, color='404040')
    ws.freeze_panes = 'F5'
    ws.auto_filter.ref = f'A{hr}:K{K_LAST}'
    status_cf(ws, f'A{K_FIRST}:G{K_LAST}', K_FIRST, 'G', 7)
    ws.conditional_formatting.add(
        f'J{K_FIRST}:J{K_LAST}', FormulaRule(formula=[f'LEN($J{K_FIRST})>0'],
                                              font=Font(name=FN, size=10, bold=True, color='FFFFFF'),
                                              fill=PatternFill('solid', bgColor=RED_T, fgColor=RED_T)))
    def dv(lst, rng):
        d = DataValidation(type='list', formula1=lst, allow_blank=True, showErrorMessage=True)
        d.error = 'リストから選んでください'
        ws.add_data_validation(d)
        d.add(rng)
    dv('"通常,決算整理"', f'B{K_FIRST}:B{K_LAST}')
    dv(f'={SH_MST}!$K$5:$K$40', f'D{K_FIRST}:D{K_LAST}')
    dv(f'={SH_MST}!$I$5:$I$8', f'G{K_FIRST}:G{K_LAST}')
    ws.sheet_properties.tabColor = '2E75B6'
    return ws


# ----------------------------------------------------------------------------
# 科目表
# ----------------------------------------------------------------------------
def build_master(wb):
    ws = wb.create_sheet(SH_MST)
    ws.sheet_view.showGridLines = False
    title_band(ws, '科目表　（入力シートのプルダウンと、費用収益表への振り分けルール）', 12,
               sub='ふだんは触りません。新しい科目の組み合わせを使うときだけ、左の表に1行追加してください（A列＝中項目|小項目、B列＝費用収益表の行）。')
    ws.cell(4, 1, '中項目|小項目'); ws.cell(4, 2, '費用収益表の行')
    header_row(ws, 4, 1, 2)
    r = 5
    for k, v in GYOMU_MAP.items():
        put(ws, (r, 1), k, f=font(10, color=BLUE_IN), bd=B_ROW)
        put(ws, (r, 2), v, f=font(10, color=BLUE_IN), bd=B_ROW)
        r += 1
    # 中項目 / 小項目 リスト
    ws.cell(4, 6, '中項目一覧'); ws.cell(4, 7, '小項目一覧')
    header_row(ws, 4, 6, 7)
    for i, v in enumerate(CHU_LIST):
        put(ws, (5 + i, 6), v, bd=B_ROW)
    for i, v in enumerate(SHO_LIST):
        put(ws, (5 + i, 7), v, bd=B_ROW)
    # 状態
    ws.cell(4, 9, '状態一覧'); ws.cell(4, 10, '意味')
    header_row(ws, 4, 9, 10)
    meaning = ['昨年実績のまま（赤字）。今年の支払が確定するまで残す', '今年の支払として入力済み・伝票は未確認（黒字）',
               '支払伝票を確認済み（青塗り）。締め月までの分が費用収益表に計上される',
               '今年度は支払なし。集計から除外（行は残す）']
    for i, v in enumerate(STATUS):
        put(ws, (5 + i, 9), v, bd=B_ROW)
        put(ws, (5 + i, 10), meaning[i], f=font(9), bd=B_ROW)
    # 貸付 科目 -> 費用収益表_貸付 の行
    ws.cell(4, 11, '貸付 科目'); ws.cell(4, 12, '費用収益表の行番号')
    header_row(ws, 4, 11, 12)
    for i, (rr, key) in enumerate(sorted(KASHI_ROWS.items())):
        put(ws, (5 + i, 11), key, f=font(10, color=BLUE_IN), bd=B_ROW)
        put(ws, (5 + i, 12), rr, f=font(10, color=BLUE_IN), bd=B_ROW, al=Alignment(horizontal='center'))
    # 締め月リスト
    ws.cell(4, 14, '締め月一覧')
    header_row(ws, 4, 14, 14)
    for i, v in enumerate(['なし'] + MONTHS):
        put(ws, (5 + i, 14), v, bd=B_ROW)
    # 経費区分
    ws.cell(4, 16, '経費区分'); ws.cell(4, 17, '按分方法（旧：端数処理シート）')
    header_row(ws, 4, 16, 17)
    kbn = [('1', '共通：短期11：厚年10：経過的1：退職等1で按分。端数は短期で調整'),
           ('2', '短期のみ'),
           ('3', '長期共通：厚年10：経過的1：退職等1で按分。端数は厚年で調整'),
           ('4', '厚年のみ'),
           ('5', '厚年＋経過的：10：1で按分。端数は経過的で調整'),
           ('6', '退職等のみ'),
           ('7', '厚年＋退職等：10：1で按分。端数は退職等で調整'),
           ('8', '経過的のみ')]
    for i, (a, b) in enumerate(kbn):
        put(ws, (5 + i, 16), int(a), bd=B_ROW, al=Alignment(horizontal='center'))
        put(ws, (5 + i, 17), b, f=font(9), bd=B_ROW)
    for col, w in {'A': 30, 'B': 22, 'C': 3, 'D': 3, 'E': 3, 'F': 20, 'G': 20, 'H': 3, 'I': 11, 'J': 52, 'K': 22,
                   'L': 16, 'M': 3, 'N': 13, 'O': 3, 'P': 9, 'Q': 60}.items():
        ws.column_dimensions[col].width = w
    ws.sheet_properties.tabColor = '7F7F7F'
    return ws


# ----------------------------------------------------------------------------
# 月次締め（操作盤＋出納計算表との照合）
# ----------------------------------------------------------------------------
HIYOU_TOTAL_ROWS = {   # シート -> (費用合計行, 収益合計行)
    SH_TAN: (38, 46), SH_CHO: (38, 46), SH_KASHI: (31, 36),
}


def build_control(wb):
    ws = wb.create_sheet(SH_CTL)
    ws.sheet_view.showGridLines = False
    title_band(ws, '月次締め　操作盤と出納計算表との照合', 10,
               sub='月次〆のときは「今回締める月」を選ぶだけです。費用収益表がその月まで自動で確定表示になります（転記は不要）。'
                   '黄色のセルに仮締めした出納計算表の月合計を入力し、差額が 0 になればOKです。')
    for col, w in {'A': 2, 'B': 30, 'C': 17, 'D': 17, 'E': 15, 'F': 17, 'G': 17, 'H': 15, 'I': 24, 'J': 3}.items():
        ws.column_dimensions[col].width = w
    put(ws, 'B4', '年度（令和）', f=font(10, True))
    put(ws, 'C4', 8, f=font(12, True, BLUE_IN), fl=YELLOW, al=Alignment(horizontal='center'), bd=B_ALL, nf='0')
    put(ws, 'B5', '今回締める月', f=font(11, True, NAVY))
    put(ws, 'C5', '9月', f=font(13, True, BLUE_IN), fl=YELLOW, al=Alignment(horizontal='center'), bd=B_ALL)
    ws.merge_cells('D5:I5')
    put(ws, 'D5', '← ここを変えると、その月まで費用収益表に確定計上されます（9月締め済みなら「9月」）', f=font(9, color=GREY))
    put(ws, 'B6', '月番号（自動）', f=font(9, color=GREY))
    put(ws, 'C6', f'=MATCH($C$5,{SH_MST}!$N$5:$N$18,0)-1', f=font(9, color=GREY), al=Alignment(horizontal='center'),
        nf='0')
    dv = DataValidation(type='list', formula1=f'={SH_MST}!$N$5:$N$18', allow_blank=False, showErrorMessage=True)
    ws.add_data_validation(dv)
    dv.add('C5')
    put(ws, 'F4', '自動検算', f=font(10, True), al=Alignment(horizontal='right'))
    ws.merge_cells('G4:I4')
    put(ws, 'G4', f'=IF({SH_CHK}!$F$3=0,"すべてOK","NG "&{SH_CHK}!$F$3&"件（検算シート参照）")',
        f=font(11, True, 'FFFFFF'), fl='548235', al=Alignment(horizontal='center'))
    ws.conditional_formatting.add('G4:I4', FormulaRule(formula=[f'{SH_CHK}!$F$3>0'], fill=PatternFill(
        'solid', bgColor=RED_T, fgColor=RED_T)))

    # ① 締める前のチェック
    put(ws, 'B8', '① 締める前のチェック（今回締める月の分）', f=font(11, True, NAVY))
    for c in range(2, 10):
        ws.cell(8, c).border = Border(bottom=MED)
    for i, h in enumerate(['項目', '業務', '貸付', '対応'], 2):
        ws.cell(9, i, h)
    header_row(ws, 9, 2, 5)
    ws.merge_cells('E9:I9')
    gP, gI, gQ, gG = (f"{SH_IN_G}!${c}${G_FIRST}:${c}${G_LAST}" for c in 'PIQG')
    kH, kG, kJ, kF = (f"{SH_IN_K}!${c}${K_FIRST}:${c}${K_LAST}" for c in 'HGJF')
    items = [
        ('確認済（青塗り相当）の件数', f'=IF(締月=0,0,COUNTIFS({gP},締月,{gI},"確認済"))',
         f'=IF(締月=0,0,COUNTIFS({kH},締月,{kG},"確認済"))', '費用収益表に計上される行数です'),
        ('未確認（伝票待ち）の件数', f'=IF(締月=0,0,COUNTIFS({gP},締月,{gI},"未確認"))',
         f'=IF(締月=0,0,COUNTIFS({kH},締月,{kG},"未確認"))', '0 にしてから締めます（伝票を確認して「確認済」へ）'),
        ('昨年実績のまま残っている件数（参考）', f'=IF(締月=0,0,COUNTIFS({gP},締月,{gI},"昨年実績"))',
         f'=IF(締月=0,0,COUNTIFS({kH},締月,{kG},"昨年実績"))', '今年は支払がない行は「支払なし」にすると見やすくなります'),
        ('点検NGの件数（台帳全体）', f'=COUNTIF({gQ},"?*")', f'=COUNTIF({kJ},"?*")', '入力シートの「点検」列に内容が出ます'),
        ('確認済 金額合計', f'=IF(締月=0,0,SUMIFS({gG},{gP},締月,{gI},"確認済"))',
         f'=IF(締月=0,0,SUMIFS({kF},{kH},締月,{kG},"確認済"))', '旧：転記する金額の合計。業務は短期＋長期の合計'),
    ]
    for k, (lab, fg, fk, memo) in enumerate(items):
        r = 10 + k
        put(ws, (r, 2), lab, bd=B_ROW)
        put(ws, (r, 3), fg, nf=NUM0, al=RIGHT, bd=B_ROW)
        put(ws, (r, 4), fk, nf=NUM0, al=RIGHT, bd=B_ROW)
        ws.merge_cells(start_row=r, start_column=5, end_row=r, end_column=9)
        put(ws, (r, 5), memo, f=font(9, color=GREY), bd=B_ROW)
    put(ws, 'B15', '締め可否', f=font(10, True), fl=GREY_L, bd=B_ALL)
    for col in ('C', 'D'):
        unconf = f'{col}11'
        ng = f'{col}13'
        put(ws, f'{col}15', f'=IF(締月=0,"-",IF(AND({unconf}=0,{ng}=0),"OK","要対応"))', f=font(10, True), fl=GREY_L,
            al=Alignment(horizontal='center'), bd=B_ALL)
    ws.merge_cells('E15:I15')
    put(ws, 'E15', None, fl=GREY_L)
    ws.conditional_formatting.add('C15:D15', FormulaRule(formula=['C15="OK"'], font=Font(name=FN, bold=True,
                                                                                         color='548235')))
    ws.conditional_formatting.add('C15:D15', FormulaRule(formula=['C15="要対応"'], font=Font(name=FN, bold=True,
                                                                                           color=RED_T)))

    # ② 出納計算表との照合
    r0 = 18
    put(ws, (r0, 2), '② 出納計算表との照合（黄色のセルに仮締めした出納計算表の月合計を入力）', f=font(11, True, NAVY))
    for c in range(2, 10):
        ws.cell(r0, c).border = Border(bottom=MED)
    blocks = [('業務経理（短期）', SH_TAN), ('業務経理（長期）', SH_CHO), ('貸付経理', SH_KASHI)]
    r = r0 + 2
    block_pos = {}
    for lab, sh in blocks:
        block_pos[sh] = r
        put(ws, (r, 2), lab, f=font(10, True, 'FFFFFF'), fl='2E75B6', bd=B_ALL)
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=9)
        for c in range(3, 10):
            ws.cell(r, c).fill = fill('2E75B6')
        r += 1
        hdr1 = ['月', '費用', '', '', '収益', '', '', '判定']
        for i, h in enumerate(hdr1, 2):
            ws.cell(r, i, h)
        header_row(ws, r, 2, 9, 18)
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=5)
        ws.merge_cells(start_row=r, start_column=6, end_row=r, end_column=8)
        r += 1
        hdr2 = ['', '費用収益表', '出納計算表', '差額', '費用収益表', '出納計算表', '差額', '']
        for i, h in enumerate(hdr2, 2):
            ws.cell(r, i, h)
        header_row(ws, r, 2, 9, 18)
        for c in (2, 9):
            ws.cell(r, c).fill = fill(NAVY)
        r += 1
        exp_r, rev_r = HIYOU_TOTAL_ROWS[sh]
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
            formula=[f'ROW()-{first}+1>締月'], font=Font(name=FN, color='A6A6A6')))
        ws.conditional_formatting.add(f'I{first}:I{r - 1}', FormulaRule(
            formula=[f'LEFT(I{first},2)="NG"'], font=Font(name=FN, bold=True, color='FFFFFF'),
            fill=PatternFill('solid', bgColor=RED_T, fgColor=RED_T)))
        ws.conditional_formatting.add(f'I{first}:I{r - 1}', FormulaRule(
            formula=[f'I{first}="OK"'], font=Font(name=FN, bold=True, color='548235')))
        ws.conditional_formatting.add(f'I{first}:I{r - 1}', FormulaRule(
            formula=[f'RIGHT(I{first},3)="未入力"'], font=Font(name=FN, color='BF8F00')))
        # 合計（年度累計：締め月まで）
        put(ws, (r, 2), '締め月までの合計', f=font(10, True), fl=GREY_L, bd=B_ALL)
        put(ws, (r, 3), f'=SUMPRODUCT((ROW(C{first}:C{r - 1})-{first}+1<=締月)*C{first}:C{r - 1})',
            f=font(10, True), fl=GREY_L, nf=NUM, al=RIGHT, bd=B_ALL)
        put(ws, (r, 4), f'=SUMPRODUCT((ROW(D{first}:D{r - 1})-{first}+1<=締月)*D{first}:D{r - 1})',
            f=font(10, True), fl=GREY_L, nf=NUM, al=RIGHT, bd=B_ALL)
        put(ws, (r, 5), f'=C{r}-D{r}', f=font(10, True), fl=GREY_L, nf=NUM0, al=RIGHT, bd=B_ALL)
        put(ws, (r, 6), f'=SUMPRODUCT((ROW(F{first}:F{r - 1})-{first}+1<=締月)*F{first}:F{r - 1})',
            f=font(10, True), fl=GREY_L, nf=NUM, al=RIGHT, bd=B_ALL)
        put(ws, (r, 7), f'=SUMPRODUCT((ROW(G{first}:G{r - 1})-{first}+1<=締月)*G{first}:G{r - 1})',
            f=font(10, True), fl=GREY_L, nf=NUM, al=RIGHT, bd=B_ALL)
        put(ws, (r, 8), f'=F{r}-G{r}', f=font(10, True), fl=GREY_L, nf=NUM0, al=RIGHT, bd=B_ALL)
        put(ws, (r, 9), None, fl=GREY_L, bd=B_ALL)
        r += 2
    ws.freeze_panes = 'A8'
    ws.sheet_properties.tabColor = 'C00000'
    ws.page_setup.orientation = 'portrait'
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    return ws, block_pos


# ----------------------------------------------------------------------------
# 検算 / 旧表照合 / 給付区分別 / 使い方
# ----------------------------------------------------------------------------
BASE_IDX = X.BASE_MONTH - 3      # 旧表が確定計上していた最終月の月番号（9月=6）


def build_checks(wb, old_total_cell):
    ws = wb.create_sheet(SH_CHK)
    ws.sheet_view.showGridLines = False
    title_band(ws, '検算　（数字が食い違っていないかを自動で確かめます）', 7,
               sub='「結果」が全部 OK ならこのブックの数字は台帳・費用収益表・旧表と一致しています。NG があれば、その行の説明を見て入力シートを直してください。')
    for col, w in {'A': 2, 'B': 62, 'C': 17, 'D': 17, 'E': 14, 'F': 9, 'G': 60}.items():
        ws.column_dimensions[col].width = w
    put(ws, 'B3', 'NG の件数', f=font(10, True), al=Alignment(horizontal='right'))
    for i, h in enumerate(['確認項目', '期待値（台帳側）', '実際（費用収益表側）', '差', '結果', '見方'], 2):
        ws.cell(5, i, h)
    header_row(ws, 5, 2, 7)
    gO, gP, gI, gJ, gN, gQ = (f"{SH_IN_G}!${c}${G_FIRST}:${c}${G_LAST}" for c in 'OPIJNQ')
    kH, kG, kF, kJ = (f"{SH_IN_K}!${c}${K_FIRST}:${c}${K_LAST}" for c in 'HGFJ')

    def hy(sh, col):
        return f"'{sh}'!${col}$4:${col}$62"
    rows = [
        ('業務：合計表 ＝ 短期表 ＋ 長期表（費用・全月）',
         f"=SUM('{SH_TAN}'!C38:O38)+SUM('{SH_CHO}'!C38:O38)", f"=SUM('{SH_GOUKEI}'!C38:O38)",
         '短期と長期を足した値が合計表と一致するか'),
        ('業務：合計表 ＝ 短期表 ＋ 長期表（収益・全月）',
         f"=SUM('{SH_TAN}'!C46:O46)+SUM('{SH_CHO}'!C46:O46)", f"=SUM('{SH_GOUKEI}'!C47:O47)",
         '合計表の収益合計は47行目（繰入が2行あるため）'),
        ('業務（短期）：台帳の確認済 ＝ 費用収益表への計上額（締め月まで）',
         f'=SUMIFS({gJ},{gI},"確認済",{gP},"<="&締月,{gO},"<>対象外")',
         f"=SUMPRODUCT({hy(SH_TAN, 'X')},{hy(SH_TAN, 'V')})",
         '台帳に入力した確認済の金額が、漏れなく・二重にならず費用収益表へ入っているか'),
        ('業務（長期）：台帳の確認済 ＝ 費用収益表への計上額（締め月まで）',
         f'=SUMIFS({gN},{gI},"確認済",{gP},"<="&締月,{gO},"<>対象外")',
         f"=SUMPRODUCT({hy(SH_CHO, 'X')},{hy(SH_CHO, 'V')})", ''),
        ('貸付：台帳の確認済 ＝ 費用収益表への計上額（締め月まで）',
         f'=SUMIFS({kF},{kG},"確認済",{kH},"<="&締月)',
         f"=SUMPRODUCT({hy(SH_KASHI, 'X')},{hy(SH_KASHI, 'V')})", ''),
        ('入力_業務：点検に指摘のある行数（按分不一致・科目未登録・年度外の日付ほか）',
         '=0', f'=COUNTIF({gQ},"?*")', '「入力_業務」の点検列を見て直す'),
        ('入力_貸付：点検に指摘のある行数',
         '=0', f'=COUNTIF({kJ},"?*")', '「入力_貸付」の点検列を見て直す'),
        ('業務：締め月までに「未確認」が残っていない',
         '=0', f'=COUNTIFS({gP},"<="&締月,{gI},"未確認")', '伝票を確認して「確認済」にしてから締める'),
        ('貸付：締め月までに「未確認」が残っていない',
         '=0', f'=COUNTIFS({kH},"<="&締月,{kG},"未確認")', ''),
        ('旧・費用収益表との一致（旧表で確定計上済みの月＝9月締めの状態）',
         '=0', f'={old_total_cell}', '「今回締める月」が9月のときだけ比較します（他の月は対象外として0扱い）'),
    ]
    for i, (lab, exp, act, memo) in enumerate(rows):
        r = 6 + i
        put(ws, (r, 2), lab, bd=B_ROW, al=Alignment(wrap_text=True, vertical='center'))
        put(ws, (r, 3), exp, nf=NUM0, al=RIGHT, bd=B_ROW)
        put(ws, (r, 4), act, nf=NUM0, al=RIGHT, bd=B_ROW)
        put(ws, (r, 5), f'=D{r}-C{r}', nf=NUM0, al=RIGHT, bd=B_ROW)
        put(ws, (r, 6), f'=IF(ABS(E{r})<0.5,"OK","NG")', f=font(10, True), al=Alignment(horizontal='center'),
            bd=B_ROW)
        put(ws, (r, 7), memo, f=font(9, color=GREY), bd=B_ROW, al=Alignment(wrap_text=True, vertical='center'))
        ws.row_dimensions[r].height = 28
    last = 6 + len(rows) - 1
    put(ws, 'C3', f'=COUNTIF(F6:F{last},"NG")', f=font(11, True), nf='0', al=Alignment(horizontal='center'))
    ws['F3'].value = '=C3'
    ws['F3'].font = font(8, color='FFFFFF')
    ws.conditional_formatting.add(f'F6:F{last}', FormulaRule(formula=['F6="NG"'], font=Font(
        name=FN, bold=True, color='FFFFFF'), fill=PatternFill('solid', bgColor=RED_T, fgColor=RED_T)))
    ws.conditional_formatting.add(f'F6:F{last}', FormulaRule(formula=['F6="OK"'], font=Font(
        name=FN, bold=True, color='548235')))
    ws.sheet_properties.tabColor = '548235'
    return ws


def build_old_compare(wb, old_values, name_map):
    ws = wb.create_sheet(SH_OLD)
    ws.sheet_view.showGridLines = False
    title_band(ws, '旧表照合　（旧・費用収益表の数値と、このブックの費用収益表を1セルずつ突き合わせ）', 8,
               sub='旧表（9月締め時点の数値）を値で貼ってあり、差を1セルずつ計算します。「今回締める月」が9月のときに不一致が 0 であれば、旧表と完全に一致しています。')
    for col, w in {'A': 26, 'B': 14, 'C': 14, 'D': 14}.items():
        ws.column_dimensions[col].width = w
    header_row(ws, 4, 1, 4)
    for i, h in enumerate(['費用収益表', '比較したセル数', '不一致セル数', '最大の差'], 1):
        ws.cell(4, i, h)
    blocks = []
    r0 = 12
    for i, (old, new) in enumerate(name_map.items()):
        blocks.append((old, new, r0 + i * 70))
    for i, (old, new, b0) in enumerate(blocks):
        vals = old_values[old]
        hidden = set()
        for mr in wb[new].merged_cells.ranges:
            for rr in range(mr.min_row, mr.max_row + 1):
                for cc in range(mr.min_col, mr.max_col + 1):
                    if (rr, cc) != (mr.min_row, mr.min_col):
                        hidden.add((rr, cc))
        # 見出し
        put(ws, (b0 - 1, 1), f'【{new}】 旧表の値（A:W）／ 差（Z:AV）', f=font(10, True, NAVY))
        for (r, c), v in vals.items():
            if isinstance(v, float) and 4 <= r <= 62 and 3 <= c <= 21 and (r, c) not in hidden:
                put(ws, (b0 + r, c), v, nf='#,##0;-#,##0', f=font(9, color=GREY))
        for r in range(4, 63):
            for c in range(3, 22):
                put(ws, (b0 + r, c + 23),
                    f"=N('{new}'!{L(c)}{r})-N({L(c)}{b0 + r})", nf='#,##0;-#,##0;;', f=font(9))
        rng = f'{L(26)}{b0 + 4}:{L(44)}{b0 + 62}'
        put(ws, (5 + i, 1), new, bd=B_ROW)
        put(ws, (5 + i, 2), f'=COUNT({rng})', nf='#,##0', bd=B_ROW)
        put(ws, (5 + i, 3), f'=SUMPRODUCT(--(ABS({rng})>0.5))', nf='#,##0', bd=B_ROW)
        put(ws, (5 + i, 4), f'=MAX(MAX({rng}),-MIN({rng}))', nf='#,##0', bd=B_ROW)
    put(ws, (9, 1), '合計（検算シートへ）', f=font(10, True), fl=GREY_L, bd=B_ALL)
    put(ws, (9, 2), '=SUM(B5:B8)', f=font(10, True), fl=GREY_L, nf='#,##0', bd=B_ALL)
    put(ws, (9, 3), '=IF(締月=%d,SUM(C5:C8),0)' % BASE_IDX, f=font(10, True), fl=GREY_L, nf='#,##0', bd=B_ALL)
    put(ws, (9, 4), '=MAX(D5:D8)', f=font(10, True), fl=GREY_L, nf='#,##0', bd=B_ALL)
    ws.sheet_properties.tabColor = '7F7F7F'
    return ws, f"{SH_OLD}!$C$9"


RPT_ITEMS = ['役員報酬', '職員給与', '厚生費', '旅費', '事務費', '賃金', '委託費', '光熱水料', '修繕費', '賃借料',
             '調査研究費', '普及費', '諸謝金', '負担金', '仮払消費税', '交際費', '選挙費', '事務費負担金払込金',
             '雑費', '減価償却費', '連合会分担金', '支払利息', '雑損', '特別修繕引当金繰入']


def build_report(wb):
    """旧：管理簿「給付区分別執行額（月別／年度分）」。確認済のみ集計。"""
    ws = wb.create_sheet(SH_RPT)
    ws.sheet_view.showGridLines = False
    title_band(ws, '給付区分別執行額　業務経理（旧：「給付区分別執行額（月別）」「同（年度分）」）', 14,
               sub='台帳の「確認済」だけを集計します。左：選んだ月の分　右：締め月までの年度累計（単位：円）。')
    for col, w in {'A': 2, 'B': 22, 'C': 13, 'D': 13, 'E': 13, 'F': 13, 'G': 13, 'H': 3, 'I': 22, 'J': 13,
                   'K': 13, 'L': 13, 'M': 13, 'N': 13}.items():
        ws.column_dimensions[col].width = w
    put(ws, 'B4', '集計する月', f=font(10, True))
    put(ws, 'C4', '9月', f=font(11, True, BLUE_IN), fl=YELLOW, al=Alignment(horizontal='center'), bd=B_ALL)
    dv = DataValidation(type='list', formula1=f'={SH_MST}!$N$6:$N$17', allow_blank=False)
    ws.add_data_validation(dv)
    dv.add('C4')
    put(ws, 'D4', f'=MATCH(C4,{SH_MST}!$N$6:$N$17,0)', f=font(8, color=GREY), nf='0')
    put(ws, 'I4', '年度累計（締め月まで）', f=font(10, True))
    gD, gG, gI, gP, gJ, gK, gL, gM = (f"{SH_IN_G}!${c}${G_FIRST}:${c}${G_LAST}" for c in 'DGIPJKLM')
    for base, mode in ((2, 'm'), (9, 'y')):
        for i, h in enumerate(['科　目', '執行額', '短期', '厚年', '経過的', '退職等'], base):
            ws.cell(6, i, h)
        header_row(ws, 6, base, base + 5)
        for k, item in enumerate(RPT_ITEMS):
            r = 7 + k
            put(ws, (r, base), item, bd=B_ROW)
            crit_p = f'{gP},$D$4' if mode == 'm' else f'{gP},"<="&締月'
            for j, col in enumerate((gG, gJ, gK, gL, gM)):
                put(ws, (r, base + 1 + j),
                    f'=SUMIFS({col},{gD},${L(base)}{r},{gI},"確認済",{crit_p})', nf=NUM, al=RIGHT, bd=B_ROW)
        tr = 7 + len(RPT_ITEMS)
        put(ws, (tr, base), '合　計', f=font(10, True), fl=GREY_L, bd=B_ALL)
        for j in range(5):
            cl = L(base + 1 + j)
            put(ws, (tr, base + 1 + j), f'=SUM({cl}7:{cl}{tr - 1})', f=font(10, True), fl=GREY_L, nf=NUM,
                al=RIGHT, bd=B_ALL)
        put(ws, (tr + 1, base), '検算（執行額＝4区分の合計）', f=font(9, color=GREY))
        put(ws, (tr + 1, base + 1), f'=IF({L(base + 1)}{tr}=SUM({L(base + 2)}{tr}:{L(base + 5)}{tr}),"OK","NG")',
            f=font(9, True, GREEN_T), al=Alignment(horizontal='center'))
    ws.freeze_panes = 'A7'
    ws.sheet_properties.tabColor = '2E75B6'
    return ws


def build_help(wb, notes_text):
    ws = wb.create_sheet(SH_HELP)
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 2
    ws.column_dimensions['B'].width = 26
    ws.column_dimensions['C'].width = 70
    ws.column_dimensions['D'].width = 58
    title_band(ws, '令和8年度　費用収益表 統合ブック　使い方', 4,
               sub='旧：管理簿・予算差引簿・費用収益表の3ファイルを、「入力は台帳1か所だけ」「費用収益表は自動計上」「照合も自動」に作り替えたブックです。')
    r = 4

    def section(text):
        nonlocal r
        put(ws, (r, 2), text, f=font(11, True, 'FFFFFF'), fl=NAVY)
        ws.cell(r, 3).fill = fill(NAVY)
        ws.cell(r, 4).fill = fill(NAVY)
        r += 1

    def row(a, b, c=None, h=None):
        nonlocal r
        put(ws, (r, 2), a, f=font(10, True), bd=B_ROW, al=Alignment(vertical='top', wrap_text=True))
        put(ws, (r, 3), b, bd=B_ROW, al=Alignment(vertical='top', wrap_text=True))
        put(ws, (r, 4), c, f=font(9, color=GREY), bd=B_ROW, al=Alignment(vertical='top', wrap_text=True))
        n = max(len(b or '') / 34, len(c or '') / 29, 1)
        ws.row_dimensions[r].height = h or max(18, 14.5 * (int(n) + 1))
        r += 1

    section('毎月の流れ（旧→新）')
    ws.cell(r, 2, '担当'); ws.cell(r, 3, '新しいやり方'); ws.cell(r, 4, '旧')
    header_row(ws, r, 2, 4, 18)
    r += 1
    row('① 支払担当者', '入力シートで、昨年実績の行を今年の支払に直します（日付・金額）。状態を「昨年実績」→「未確認」へ。',
        '赤字を黒字にして金額を修正')
    row('② 経理担当者', '支払伝票が回ってきたら、その行の状態を「未確認」→「確認済」へ（プルダウン）。',
        '金額を青で塗りつぶして確認')
    row('③ 経理〆', '「月次締め」シートで「今回締める月」を選ぶ。費用収益表はその月まで自動で確定計上されます。',
        '黒字＋色塗りを費用収益表へ手で転記')
    row('④ 照合', '「月次締め」の黄色いセルに仮締め出納計算表の月合計を入力。差額が 0 で「OK」になればOK。',
        '費用収益表と出納計算表を目で照合')
    row('⑤ 月次更新', 'OK を確認して基幹システムで月次更新処理。「検算」シートが全部 OK ならこのブックの数字は一致しています。',
        '同じ')
    r += 1
    section('色のルール')
    row('赤字', '状態＝昨年実績。今年の支払が確定するまで残しておく行（集計には入りません）。')
    row('オレンジ（No列）', '状態＝未確認。今年の支払として入力済みだが、伝票確認前。')
    row('青（No列）', '状態＝確認済。締め月までの分が費用収益表に計上されます。')
    row('取り消し線（灰色）', '状態＝支払なし。今年度は支払がない行（集計から除外。行は残せます）。')
    row('費用収益表の緑字', '締め月より後の月＝前年実績・見込（旧表の値）。締め月までは黒字の確定値になります。')
    row('黄色のセル', '手入力するセル（台帳の入力列・費用収益表の金額/予算/収益・照合欄など）。それ以外は数式なので触りません。マクロ版（.xlsm）ではEnterで次の黄色セルへ移動します。')
    r += 1
    section('シート一覧')
    row('月次締め', '操作盤。今回締める月の選択／締める前のチェック／出納計算表との照合。')
    row('入力_業務 / 入力_貸付', '台帳（旧：管理簿・予算差引簿）。支払はここだけに入力。行を足すときは最終行の下へ（業務1,600行・貸付400行まで）。')
    row('費用収益表（4枚）', '業務合計・短期・長期・貸付。旧表と同じ配置。台帳連動の行は自動計算、収益・給与・予算などは手入力。')
    row('給付区分別', '旧：給付区分別執行額（月別／年度分）。確認済のみ集計。')
    row('科目表', 'プルダウンの元と、台帳の科目を費用収益表のどの行に入れるかのルール。')
    row('検算 / 旧表照合', '自動検算。旧表照合は、旧・費用収益表（9月締め時点）と1セルずつ突き合わせた結果。')
    r += 1
    section('注意')
    row('数式の列は消さない', '灰色の列（短期・厚年…・費用収益表の行・計上列・点検など）は数式です。台帳に行を足すときは最終行の下の空き行に入力するだけでOK（数式は1,600行／400行分あらかじめ入っています）。')
    row('経費区分', '1〜8の按分ルールは旧「端数処理」と同じです（科目表の右側に一覧）。')
    row('来年度の更新', '①ブックを複製 ②月次締めの年度を変更 ③台帳の状態をすべて「昨年実績」に（フィルタ→コピー貼り付け）④費用収益表の予算・参考値を更新。')
    ws.sheet_properties.tabColor = '1F3864'
    return ws



def migrate_residuals(krows, old_vals):
    """台帳(貸付)から再現できない旧表の黒字セル（給与システム等から手入力されていた値）を、
    台帳の1行として移行する。移行後は台帳だけで旧表の数値を再現できる。"""
    got = {}
    for r in krows:
        if r['st'] == '確認済' and r['kind'] == '通常' and r['date']:
            idx = (r['date'].month - 4) % 12 + 1
            got[(r['key'], idx)] = got.get((r['key'], idx), 0) + r['amt']
    added = []
    for row, key in KASHI_ROWS.items():
        for col in range(3, 3 + X.BASE_MONTH - 3):          # 4月〜基準月
            old = old_vals.get((row, col))
            old = old if isinstance(old, float) else 0.0
            diff = old - got.get((key, col - 2), 0)
            if abs(diff) > 0.5:
                m = (col - 3 + 3) % 12 + 1                   # 暦月
                year = 2026 if m >= 4 else 2027
                last = (datetime.date(year + (m == 12), m % 12 + 1, 1) - datetime.timedelta(days=1))
                added.append(dict(src=f'費用収益表_貸付!{L(col)}{row}', sheet=9, rowno=col, block=key,
                                  date=last, tek=f'{key}（旧表の手入力値を移行：{m}月計上分）', amt=diff,
                                  st='確認済', kind='通常', key=key))
    krows.extend(added)
    return added



def mark_hiyou_inputs(hiyou):
    """費用収益表: 数式でない入力セル（金額・予算・収益など）を黄色にする"""
    for name, (ws, hdr, kind) in hiyou.items():
        hidden = set()
        for mr in ws.merged_cells.ranges:
            for rr in range(mr.min_row, mr.max_row + 1):
                for cc in range(mr.min_col, mr.max_col + 1):
                    if (rr, cc) != (mr.min_row, mr.min_col):
                        hidden.add((rr, cc))
        for r in range(4, ws.max_row + 1):
            if row_role(ws, r) != 'data' or not (ws.cell(r, 1).value or ws.cell(r, 2).value
                                                   or any(ws.cell(r, c).value is not None for c in range(3, 21))):
                continue
            for c in range(3, 21):
                cell = ws.cell(r, c)
                v = cell.value
                if (r, c) in hidden or (isinstance(v, str) and (v.startswith('=') or len(v.strip()) > 1)):
                    continue
                cell.fill = fill(YELLOW)


def mark_master_inputs(ws):
    for r in range(5, 81):
        for c in (1, 2):
            ws.cell(r, c).fill = fill(YELLOW)
    for r in range(5, 41):
        for c in (6, 7, 11, 12):
            ws.cell(r, c).fill = fill(YELLOW)


# ----------------------------------------------------------------------------
# 組み立て
# ----------------------------------------------------------------------------
def rename_refs(ws):
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith('='):
                v = c.value
                for old, new in OLD_NAMES.items():
                    v = v.replace(f"'{old}'!", f"'{new}'!")
                c.value = v


def main(gyomu_xlsx, kashi_xls, hiyou_xls, out):
    work = Path(tempfile.mkdtemp())
    grows, gnotes = X.load_gyomu(gyomu_xlsx)
    krows, knotes = X.load_kashitsuke(kashi_xls)
    for r in krows:
        r['key'] = kashi_key(r)
    order = {k: i for i, k in enumerate(KASHI_KEYS)}
    conv, oldvals = X.load_old_hiyou(hiyou_xls, work)
    migrated = migrate_residuals(krows, oldvals['R8貸付'])
    krows.sort(key=lambda r: (order[r['key']], r['sheet'], r['rowno']))
    wb = openpyxl.load_workbook(conv)
    for old, new in OLD_NAMES.items():
        wb[old].title = new
    for ws in wb.worksheets:
        rename_refs(ws)
    # 名前定義
    wb.defined_names['年度'] = DefinedName('年度', attr_text=f"'{SH_CTL}'!$C$4")
    wb.defined_names['締月'] = DefinedName('締月', attr_text=f"'{SH_CTL}'!$C$6")

    inv = {new: oldvals[old] for old, new in OLD_NAMES.items()}
    hiyou = {}
    for old, new in OLD_NAMES.items():
        ws = wb[new]
        kind = 'kashi' if new == SH_KASHI else 'gyomu'
        hdr = prepare_hiyou_sheet(ws, new, kind)
        rows_map = {}
        if new == SH_TAN:
            rows_map, side = GYOMU_ROWS, 'J'
        elif new == SH_CHO:
            rows_map, side = GYOMU_ROWS, 'N'
        elif new == SH_KASHI:
            rows_map, side = KASHI_ROWS, None
        if rows_map:
            apply_ledger_formulas(ws, kind, rows_map, side, oldvals[old])
        exp_last = 31 if new == SH_KASHI else 38
        style_hiyou(ws, new, hdr, kind)
        hiyou_columns_extra(ws, hdr, kind, list(rows_map), exp_last)
        finish_hiyou(ws, hdr, kind)
        hiyou[new] = (ws, hdr, kind)
        # 手入力（定数）セルは青字
        for row in ws.iter_rows(min_row=4, max_row=ws.max_row, min_col=3, max_col=19):
            for c in row:
                if isinstance(c.value, (int, float)) and not isinstance(c.value, bool):
                    c.font = font(10, color=BLUE_IN, bold=(row_role(ws, c.row) == 'total'))
        # タイトル
        ws.merge_cells('A1:O1')
        ws.merge_cells('P1:W1')
        label = {SH_GOUKEI: '業務経理（長期・短期給付事務合計分）', SH_TAN: '業務経理（短期給付事務分）',
                 SH_CHO: '業務経理（長期給付事務分）', SH_KASHI: '貸付経理'}[new]
        put(ws, 'A1', f'="令和"&年度&"年度　{label}　費用収益表"', f=font(14, True, 'FFFFFF'), fl=NAVY,
            al=Alignment(vertical='center', indent=1))
        put(ws, 'P1', '緑字＝未締め月（前年実績・見込）／黒字＝締め済み／黄色＝手入力セル', f=font(8, color='FFFFFF'),
            fl=NAVY, al=Alignment(horizontal='right', vertical='center', wrap_text=True))
        for c in range(1, 24):
            ws.cell(1, c).fill = fill(NAVY)
        ws.row_dimensions[1].height = 26
        ws.sheet_properties.tabColor = '1F3864'

    mark_hiyou_inputs(hiyou)
    ctl, block_pos = build_control(wb)
    g = build_ledger_gyomu(wb, grows)
    k_ws = build_ledger_kashi(wb, krows)
    rpt = build_report(wb)
    mst = build_master(wb)
    old_ws, old_cell = build_old_compare(wb, oldvals, OLD_NAMES)
    chk = build_checks(wb, old_cell)
    hlp = build_help(wb, None)

    order = [SH_HELP, SH_CTL, SH_IN_G, SH_IN_K, SH_GOUKEI, SH_TAN, SH_CHO, SH_KASHI, SH_RPT, SH_MST, SH_CHK, SH_OLD]
    wb._sheets = [wb[n] for n in order]
    mark_master_inputs(mst)
    page(g, True, '4:4'); page(k_ws, True, '4:4'); page(hlp, False); page(ctl, False)
    page(rpt, True); page(mst, True); page(chk, True)
    if '_xlfn_SINGLE' in wb.defined_names:
        del wb.defined_names['_xlfn_SINGLE']
    wb.active = 1
    for ws in wb.worksheets:
        ws.sheet_view.tabSelected = (ws.title == SH_CTL)
    wb.calculation.fullCalcOnLoad = True
    wb.properties.creator = ''
    wb.properties.lastModifiedBy = ''
    wb.properties.title = '令和8年度 費用収益表 統合ブック'
    wb.save(out)

    meta = dict(n_gyomu=len(grows), n_kashi=len(krows),
                gyomu_notes={k: [[str(x) for x in t] for t in v] for k, v in gnotes.items()},
                kashi_notes={k: [[str(x) for x in t] for t in v] for k, v in knotes.items()})
    Path(str(out) + '.meta.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding='utf-8')
    return meta


if __name__ == '__main__':
    if len(sys.argv) != 5:
        print(__doc__)
        sys.exit(1)
    m = main(*sys.argv[1:5])
    print(json.dumps({k: v for k, v in m.items() if k.startswith('n_')}))
