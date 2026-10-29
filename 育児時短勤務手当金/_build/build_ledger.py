# -*- coding: utf-8 -*-
"""管理台帳を生成する。 python build_ledger.py 出力.xlsx [旧リスト.xlsx]
旧リスト(短時間支給リスト)を渡すと、請求記録・職員マスタへ移行する。"""
import sys
import math
from decimal import Decimal, ROUND_HALF_UP
import datetime as dt
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.chart import BarChart, Reference

dst = sys.argv[1]
legacy = sys.argv[2] if len(sys.argv) > 2 else None
NREC, NMAS, NHOLD = 3000, 400, 200
R0 = 6                       # 先頭データ行
RE = R0 + NREC - 1           # 請求記録の最終行
ME = R0 + NMAS - 1           # 職員マスタの最終行
FN = "Meiryo UI"
HDR = PatternFill("solid", fgColor="1F4E78")
HDR2 = PatternFill("solid", fgColor="7F7F7F")
HDR3 = PatternFill("solid", fgColor="2E7D32")
INP = PatternFill("solid", fgColor="FFF9C4")
CAL = PatternFill("solid", fgColor="F2F2F2")
thin = Side(style="thin", color="BFBFBF")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

wb = openpyxl.Workbook()
guide = wb.active; guide.title = "使い方"
rec = wb.create_sheet("請求記録")
hold = wb.create_sheet("保留一覧")
mon = wb.create_sheet("月次集計")
mat = wb.create_sheet("職員別一覧")
mas = wb.create_sheet("職員マスタ")
jk = wb.create_sheet("人給データ")
cfg = wb.create_sheet("設定")


def head(ws, row, titles, fill=HDR, start=1, h=34):
    for i, t in enumerate(titles, start):
        c = ws.cell(row, i, t)
        c.font = Font(name=FN, size=10, bold=True, color="FFFFFF")
        c.fill = fill
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = BOX
    ws.row_dimensions[row].height = h


def title(ws, t, sub=None):
    ws["A1"] = t
    ws["A1"].font = Font(name=FN, size=15, bold=True)
    if sub:
        ws["A2"] = sub
        ws["A2"].font = Font(name=FN, size=10, color="595959")


# ================= 設定 =================
title(cfg, "設定", "法令・運用の変更があったときはここだけ直します")
items = [("最低限度額（円）", 2411, "計算した決定額がこの額以下なら不支給（旧リストの注記「下限(2,411)以下のため×」から設定。改定時は変更）"),
         ("通常の給付率", 0.1, "報酬が標準報酬月額の90%未満の場合"),
         ("逓減を始める割合", 0.9, "報酬が標準報酬月額のこの割合以上100%未満のとき給付率を逓減"),
         ("保留の注意日数", 30, "保留開始日からこの日数を超えると黄色表示"),
         ("保留の要対応日数", 60, "保留開始日からこの日数を超えると赤表示")]
for i, (a, b, c) in enumerate(items, 3):
    cfg.cell(i, 2, a); cfg.cell(i, 3, b).fill = INP; cfg.cell(i, 4, c)
    cfg.cell(i, 4).font = Font(name=FN, size=9, color="7F7F7F")
cfg["C4"].number_format = cfg["C5"].number_format = "0%"
reasons = ["住居手当の確認", "通勤手当の確認", "育休期間の変更待ち", "標準報酬月額の変更確認", "部分休業の取得状況確認",
           "添付書類の不足", "記載内容の修正待ち", "人給データとの相違確認", "その他"]
cfg["F2"] = "保留理由（追加・変更可／F3:F14）"
for i, t in enumerate(reasons, 3):
    cfg.cell(i, 6, t).fill = INP
for i in range(len(reasons) + 3, 15):
    cfg.cell(i, 6).fill = INP
cfg["J2"] = "不支給理由（通知書用・変更可）"; cfg["K2"] = "通知書に載せる理由文（{最低限度額}は設定の額に置換）"; cfg["L2"] = "明細区分"
nr_rows = [("報酬額が標準報酬月額以上", "対象月の報酬額が、育児時短勤務を開始した月の標準報酬月額以上であり、支給額が生じないため。", 1),
           ("計算額が最低限度額以下", "対象月の報酬額から算出した支給額が、最低限度額（{最低限度額}円）以下であり、支給額が生じないため。", 3),
           ("部分休業の取得実績なし", "請求月において部分休業の取得実績がなく、支給要件を満たしていないため。", 2),
           ("対象月に子が2歳に達している", "対象月において、育児時短勤務に係る子が2歳に達しており、支給対象期間に該当しないため。", 2),
           ("勤務期間外", "対象月が育児時短勤務（部分休業）の期間に該当せず、支給要件を満たしていないため。", 2),
           ("その他（個別に記載）", "", 2)]
for i in range(10):
    r_ = 3 + i
    for cc in ("J", "K", "L"):
        cfg[f"{cc}{r_}"].fill = INP
    if i < len(nr_rows):
        cfg[f"J{r_}"], cfg[f"K{r_}"], cfg[f"L{r_}"] = nr_rows[i]
cfg["J13"] = "明細区分：1＝標準報酬月額と報酬額を載せる／2＝載せない／3＝標準報酬月額・報酬額・算出した支給額を載せる"
cfg["J13"].font = Font(name=FN, size=9, color="7F7F7F")
cfg["J2"].font = cfg["K2"].font = cfg["L2"].font = Font(name=FN, bold=True)
cfg.column_dimensions["I"].width = 2; cfg.column_dimensions["J"].width = 30; cfg.column_dimensions["K"].width = 90; cfg.column_dimensions["L"].width = 10
cfg["H2"] = "支給月・対象月の一覧"
months = []
for k in range(72):
    y, m = 7 + (3 + k) // 12, (3 + k) % 12 + 1
    months.append(f"R{y}.{m}")
    cfg.cell(3 + k, 8, months[-1])
for col, w in {"A": 2, "B": 24, "C": 12, "D": 80, "E": 2, "F": 30, "G": 2, "H": 12}.items():
    cfg.column_dimensions[col].width = w
cfg["B2"].font = Font(name=FN, bold=True)
for c in ("B3", "B4", "B5", "B6", "B7", "F2", "H2"):
    cfg[c].font = Font(name=FN, bold=True)

# ================= 人給データ =================
jh = ["個人ＩＤ", "職員番号", "職員氏名", "カナ氏名", "機構番号", "人事所属コード", "所属名称", "育児短時間勤務種別", "育児短時間勤務種別名称",
      "育児短時間勤務開始日", "育児短時間勤務終了日", "計算区分コード", "計算区分名称", "短時間勤務１週間勤務時間数", "１週間勤務時間数",
      "当初発令開始日", "当初発令終了日", "備考", "職名コード", "職名名称", "育児短時間終了時計算区分コード", "育児短時間終了時計算区分名称",
      "育児短時間申請番号", "関連付育児短時間申請番号", "子の氏名", "子の続柄コード", "子の続柄名称", "子の生年月日"]
head(jk, 1, jh, HDR2)
jk["AD1"] = "← 人給システムの出力を A2 から貼り付けると、職員マスタに自動反映されます（列の並びは従来の人給シートと同じ）"
jk["AD1"].font = Font(name=FN, size=9, color="C00000")
jk.freeze_panes = "A2"

# ================= 職員マスタ =================
title(mas, "職員マスタ", "職員ごとの時短期間・標準報酬月額。人給データを貼ると氏名・所属・子・期間が自動入力されます（直接入力して上書きも可）")
mh = ["職員番号", "氏名", "所属", "子の氏名", "子の生年月日", "子の2歳到達日の前々日", "時短開始日", "時短終了日", "勤務区分", "週勤務時間",
      "育短開始時の標準報酬月額", "職員メモ", "【職員単位の保留】保留理由", "保留開始日", "保留解消日", "保留状況", "保留連番"]
head(mas, 5, mh)
mas["A3"] = "※育短開始時が令和7年4月以前の場合は、令和7年4月時点の標準報酬月額を入力。同じ職員が2回目の時短を始めたときは、行を追加して別の期間を入力します。"
mas["A3"].font = Font(name=FN, size=9, color="C00000")
jmap = {"B": "C", "C": "G", "D": "Y", "E": "AB", "G": "J", "H": "K", "J": "N"}
for r in range(R0, ME + 1):
    for col, jc in jmap.items():
        look = f"LOOKUP(2,1/(人給データ!$B$2:$B$700=$A{r}),人給データ!${jc}$2:${jc}$700)"
        mas[f"{col}{r}"] = f'=IF($A{r}="","",IFERROR(IF({look}=0,"",{look}),""))'
    mas[f"F{r}"] = f'=IF(OR(E{r}="",NOT(ISNUMBER(E{r}))),"",DATE(YEAR(E{r})+2,MONTH(E{r}),DAY(E{r})-2))'
    mas[f"P{r}"] = f'=IF(AND(M{r}<>"",O{r}=""),"保留中","")'
    mas[f"Q{r}"] = f'=IF(P{r}="保留中",COUNTIF(P${R0}:P{r},"保留中"),"")'
    for col in "EFGHNO":
        mas[f"{col}{r}"].number_format = "yyyy/m/d"
    mas[f"K{r}"].number_format = "#,##0"
    for col in "AKLMNOI":
        mas[f"{col}{r}"].fill = INP
    for col in "FPQ":
        mas[f"{col}{r}"].fill = CAL
mas.column_dimensions["Q"].hidden = True
for col, w in zip("ABCDEFGHIJKLMNOP", [11, 14, 26, 14, 12, 12, 12, 12, 12, 9, 14, 34, 22, 12, 12, 9]):
    mas.column_dimensions[col].width = w
mas.freeze_panes = f"B{R0}"
mas.auto_filter.ref = f"A5:P{ME}"
d = DataValidation(type="list", formula1="=設定!$F$3:$F$14", allow_blank=True, showErrorMessage=False); d.add(f"M{R0}:M{ME}"); mas.add_data_validation(d)
d = DataValidation(type="list", formula1='"育児短時間勤務,部分休業"', allow_blank=True); d.add(f"I{R0}:I{ME}"); mas.add_data_validation(d)
mas.conditional_formatting.add(f"A{R0}:P{ME}", FormulaRule(formula=[f'$P{R0}="保留中"'], fill=PatternFill("solid", bgColor="FCE4D6", fgColor="FCE4D6")))

# ================= 請求記録 =================
title(rec, "請求記録（1請求＝1行）",
      "電子申請書の「共済組合提出データ」2行目をB列に値のみ貼り付け、または黄色い列を直接入力。灰色の列は自動計算です。")
cols = ["受付日",
        "職員番号", "対象年(令和)", "対象月", "報酬額", "通勤手当有無", "通勤手当月額", "氏名(申請書)", "組合員記号", "組合員番号", "勤務区分",
        "時短開始日", "時短終了日", "請求期間開始", "請求期間終了", "子の氏名", "子の生年月日", "所属名称", "請求日", "初回請求", "申請書の入力エラー件数", "標準報酬等級(申請書)", "標準報酬月額(申請書)",
        "氏名", "所属", "対象月", "標準報酬月額", "判定", "計算額", "決定額（手修正）", "決定額", "ステータス",
        "保留理由", "保留開始日", "保留解消日", "次回確認予定日", "保留経過日数", "支給月", "チェック（空欄＝問題なし）", "備考",
        "不支給理由（区分）", "理由の個別記載", "通知日（決裁完了日）", "通知書出力日", "適用する不支給理由",
        "保留連番", "マスタ行", "対象月初日", "不支給連番"]
col = {}
keys = ["recv", "no", "y", "m", "rew", "tk", "tkg", "nm0", "sym", "snum", "kind", "s", "e", "ps", "pe", "ch", "chb", "dept0", "req", "first", "errn", "stdg", "stdm",
        "nm", "dept", "key", "std", "jd", "calc", "man", "fin", "st", "hr", "hs", "he", "hn", "hd", "pm", "chk", "memo", "nr", "ntxt", "nd", "ndo", "nar", "hseq", "mrow", "bom", "nseq"]
for k, i in zip(keys, range(1, len(keys) + 1)):
    col[k] = L(i)
assert len(keys) == len(cols)
# ヘッダー（A=受付日 / B:U 貼付 / V.. 自動・管理）
head(rec, 5, cols)
for i in range(1, len(cols) + 1):
    rec.cell(5, i).fill = HDR if i <= 23 else (HDR3 if keys[i - 1] in ("man", "hr", "hs", "he", "hn", "pm", "memo", "nr", "ntxt", "nd") else HDR2)
rec["A4"] = "▼ 申請書の内容（貼付／入力）"; rec["X4"] = "▼ 自動判定と管理（黄色＝入力）"
for c in ("A4", "X4"):
    rec[c].font = Font(name=FN, size=10, bold=True, color="1F4E78")
c = col


def M(letter):
    return f"職員マスタ!${letter}${R0}:${letter}${ME}"


def idx(letter, r):
    return f"INDEX({M(letter)},${c['mrow']}{r})"


for r in range(R0, RE + 1):
    B, Cy, D = f"${c['no']}{r}", f"${c['y']}{r}", f"${c['m']}{r}"
    rec[f"{c['bom']}{r}"] = f'=IF(OR({B}="",{Cy}="",{D}=""),"",DATE({Cy}+2018,{D},1))'
    bom = f"${c['bom']}{r}"
    cond = (f"({M('A')}={B})*((({M('G')}=\"\")+({M('G')}<=EOMONTH({bom},0)))>0)"
            f"*((({M('H')}=\"\")+({M('H')}>={bom}))>0)*(ROW({M('A')})-{R0 - 1})")
    rec[f"{c['mrow']}{r}"] = (f'=IF({bom}="","",IF(SUMPRODUCT(MAX({cond}))>0,SUMPRODUCT(MAX({cond})),IFERROR(MATCH({B},{M("A")},0),"")))')
    mrow = f"${c['mrow']}{r}"
    rec[f"{c['nm']}{r}"] = f'=IF({mrow}="",IF({B}="","",${c["nm0"]}{r}),IF({idx("B", r)}="",${c["nm0"]}{r},{idx("B", r)}))'
    rec[f"{c['dept']}{r}"] = f'=IF({mrow}="",IF({B}="","",${c["dept0"]}{r}),IF({idx("C", r)}="",${c["dept0"]}{r},{idx("C", r)}))'
    rec[f"{c['key']}{r}"] = f'=IF({bom}="","","R"&{Cy}&"."&{D})'
    rec[f"{c['std']}{r}"] = (f'=IF(IF({mrow}="",FALSE,{idx("K", r)}<>""),{idx("K", r)},'
                             f'IF(N(${c["stdm"]}{r})>0,${c["stdm"]}{r},""))')
    E, S = f"${c['rew']}{r}", f"${c['std']}{r}"
    rec[f"{c['jd']}{r}"] = f'=IF(OR({E}="",{S}=""),"",IF({E}>={S},"×",IF({E}>={S}*設定!$C$5,"△","○")))'
    J = f"${c['jd']}{r}"
    rec[f"{c['calc']}{r}"] = (f'=IF({J}="","",IF({J}="×",0,IF({J}="○",ROUNDDOWN({E}*設定!$C$4,0),'
                              f'ROUNDDOWN({E}*ROUND((9*{S}-9*{E})/(10*{E}),4),0))))')
    rec[f"{c['fin']}{r}"] = (f'=IF({B}="","",IF(${c["man"]}{r}<>"",${c["man"]}{r},IF(${c["calc"]}{r}="","",'
                             f'IF(${c["calc"]}{r}<=設定!$C$3,0,${c["calc"]}{r}))))')
    F = f"${c['fin']}{r}"
    rec[f"{c['st']}{r}"] = (f'=IF({B}="","",IF(AND(${c["hr"]}{r}<>"",${c["he"]}{r}="",${c["pm"]}{r}=""),"保留中",'
                            f'IF(${c["pm"]}{r}<>"",IF(N({F})>0,"支給済","不支給"),IF({F}="","要確認",IF({F}=0,"不支給","未処理")))))')
    ST = f"${c['st']}{r}"
    rec[f"{c['hd']}{r}"] = f'=IF(AND({ST}="保留中",${c["hs"]}{r}<>""),TODAY()-${c["hs"]}{r},"")'
    rec[f"{c['hseq']}{r}"] = f'=IF({ST}="保留中",COUNTIF(${c["st"]}${R0}:{ST},"保留中"),"")'
    msg = (f'IF({bom}="","対象年月が未入力／","")'
           f'&IF({B}="","",IF({mrow}="","職員マスタに未登録の職員番号／",'
           f'IF({S}="","標準報酬月額が未登録／","")'
           f'&IF(AND({bom}<>"",OR(AND({idx("G", r)}<>"",{idx("G", r)}>EOMONTH({bom},0)),AND({idx("H", r)}<>"",{idx("H", r)}<{bom}))),"対象月が時短期間外／","")'
           f'&IF(AND({idx("K", r)}<>"",N(${c["stdm"]}{r})>0,{idx("K", r)}<>${c["stdm"]}{r}),"標準報酬月額が申請書と相違（台帳"&TEXT({idx("K", r)},"#,##0")&"円／申請書"&TEXT(${c["stdm"]}{r},"#,##0")&"円）／","")'
           f'&IF(AND({idx("F", r)}<>"",{bom}<>"",{idx("F", r)}<{bom}),"対象月に子が2歳到達済／","")'
           f'&IF(AND(${c["nm0"]}{r}<>"",{idx("B", r)}<>"",SUBSTITUTE(SUBSTITUTE(${c["nm0"]}{r}," ","")," ","")<>SUBSTITUTE(SUBSTITUTE({idx("B", r)}," ","")," ","")),"氏名がマスタと相違／","")'
           f'&IF(AND(${c["chb"]}{r}<>"",{idx("E", r)}<>"",${c["chb"]}{r}<>{idx("E", r)}),"子の生年月日がマスタと相違／","")'
           f'&IF(AND(${c["s"]}{r}<>"",{idx("G", r)}<>"",${c["s"]}{r}<>{idx("G", r)}),"時短開始日がマスタと相違／","")'
           f'&IF(AND(${c["e"]}{r}<>"",{idx("H", r)}<>"",${c["e"]}{r}<>{idx("H", r)}),"時短終了日がマスタと相違／","")))'
           f'&IF(AND({B}<>"",{E}=""),"報酬額が未入力／","")'
           f'&IF(N(${c["errn"]}{r})>0,"申請書に入力エラーが残っています／","")'
           f'&IF(AND({B}<>"",{bom}<>""),IF(COUNTIFS(${c["no"]}${R0}:${c["no"]}${RE},{B},${c["y"]}${R0}:${c["y"]}${RE},{Cy},${c["m"]}${R0}:${c["m"]}${RE},{D})>1,"同じ月の請求が重複しています／",""),"")'
           f'&IF(AND(N({E})>0,{J}<>"",{J}<>"×",{F}=0,${c["man"]}{r}=""),"計算額が下限以下のため不支給／","")')
    rec[f"{c['chk']}{r}"] = f'=IF({B}="","",{msg})'
    for k in ("recv", "no", "y", "m", "rew", "tk", "tkg", "nm0", "sym", "snum", "kind", "s", "e", "ps", "pe", "ch", "chb", "dept0", "req", "first", "errn", "stdg", "stdm",
              "man", "hr", "hs", "he", "hn", "pm", "memo", "nr", "ntxt", "nd"):
        rec[f"{c[k]}{r}"].fill = INP
    rec[f"{c['nar']}{r}"] = (f'=IF({ST}<>"不支給","",IF(${c["nr"]}{r}<>"",${c["nr"]}{r},IF({J}="×",設定!$J$3,'
                             f'IF(AND({J}<>"",N(${c["calc"]}{r})<=設定!$C$3),設定!$J$4,""))))')
    rec[f"{c['nseq']}{r}"] = f'=IF({ST}="不支給",COUNTIF(${c["st"]}${R0}:{ST},"不支給"),"")'
    for k in ("nm", "dept", "key", "std", "jd", "calc", "fin", "st", "hd", "chk", "hseq", "mrow", "bom", "ndo", "nar", "nseq"):
        rec[f"{c[k]}{r}"].fill = CAL
    for k in ("recv", "s", "e", "ps", "pe", "chb", "req", "hs", "he", "hn", "nd", "ndo"):
        rec[f"{c[k]}{r}"].number_format = "yyyy/m/d"
    for k in ("rew", "tkg", "stdm", "std", "calc", "man", "fin"):
        rec[f"{c[k]}{r}"].number_format = "#,##0"
    rec[f"{c['bom']}{r}"].number_format = "yyyy/m/d"
widths = dict(zip(keys, [11, 11, 8, 6, 11, 8, 10, 14, 9, 10, 14, 11, 11, 11, 11, 14, 11, 22, 11, 9, 9, 9, 12,
                         14, 22, 8, 12, 6, 10, 11, 11, 10, 20, 11, 11, 11, 8, 9, 46, 36, 24, 30, 13, 12, 24, 6, 6, 10, 6]))
for k, w in widths.items():
    rec.column_dimensions[c[k]].width = w
for k in ("hseq", "mrow", "bom", "nseq"):
    rec.column_dimensions[c[k]].hidden = True
rec.freeze_panes = f"C{R0}"
d = DataValidation(type="list", formula1="=設定!$J$3:$J$12", allow_blank=True, showErrorMessage=False); d.add(f"{c['nr']}{R0}:{c['nr']}{RE}"); rec.add_data_validation(d)
rec.auto_filter.ref = f"A5:{c['nseq']}{RE}"
d = DataValidation(type="list", formula1="=設定!$F$3:$F$14", allow_blank=True, showErrorMessage=False); d.add(f"{c['hr']}{R0}:{c['hr']}{RE}"); rec.add_data_validation(d)
d = DataValidation(type="list", formula1="=設定!$H$3:$H$74", allow_blank=True, showErrorMessage=True, errorTitle="支給月", error="一覧（例 R8.9）から選んでください。"); d.add(f"{c['pm']}{R0}:{c['pm']}{RE}"); rec.add_data_validation(d)
rng = f"A{R0}:{c['nar']}{RE}"
ST0 = f"${c['st']}{R0}"
rec.conditional_formatting.add(rng, FormulaRule(formula=[f'{ST0}="保留中"'], fill=PatternFill("solid", bgColor="FCE4D6", fgColor="FCE4D6")))
rec.conditional_formatting.add(rng, FormulaRule(formula=[f'{ST0}="要確認"'], fill=PatternFill("solid", bgColor="FFC7CE", fgColor="FFC7CE")))
rec.conditional_formatting.add(f"{c['chk']}{R0}:{c['chk']}{RE}", FormulaRule(formula=[f'LEN(${c["chk"]}{R0})>0'], font=Font(color="C00000", bold=True)))
rec.conditional_formatting.add(f"{c['hd']}{R0}:{c['hd']}{RE}", FormulaRule(formula=[f'AND(ISNUMBER(${c["hd"]}{R0}),${c["hd"]}{R0}>設定!$C$7)'], fill=PatternFill("solid", bgColor="FF9999", fgColor="FF9999")))
rec.conditional_formatting.add(f"{c['hd']}{R0}:{c['hd']}{RE}", FormulaRule(formula=[f'AND(ISNUMBER(${c["hd"]}{R0}),${c["hd"]}{R0}>設定!$C$6)'], fill=PatternFill("solid", bgColor="FFE699", fgColor="FFE699")))
rec.conditional_formatting.add(f"{c['jd']}{R0}:{c['jd']}{RE}", FormulaRule(formula=[f'${c["jd"]}{R0}="×"'], font=Font(color="C00000", bold=True)))

# ================= 保留一覧 =================
title(hold, "保留一覧", "「請求記録」で保留理由を入れて保留解消日・支給月が空の請求と、「職員マスタ」で保留中の職員を自動で一覧にします")
hold["A3"] = "保留中の請求"; hold["C3"] = f'=COUNTIF(請求記録!${c["st"]}${R0}:${c["st"]}${RE},"保留中")'
hold["D3"] = "件　決定見込額"; hold["F3"] = f'=SUMIFS(請求記録!${c["fin"]}${R0}:${c["fin"]}${RE},請求記録!${c["st"]}${R0}:${c["st"]}${RE},"保留中")'
hold["G3"] = "円　注意日数超"; hold["I3"] = f'=COUNTIF(請求記録!${c["hd"]}${R0}:${c["hd"]}${RE},">"&設定!$C$6)'
hold["J3"] = "件　保留中の職員"; hold["L3"] = f'=COUNTIF(職員マスタ!$P${R0}:$P${ME},"保留中")'; hold["M3"] = "人"
for a in ("A3", "C3", "D3", "F3", "G3", "I3", "J3", "L3", "M3"):
    hold[a].font = Font(name=FN, size=11, bold=True)
hold["F3"].number_format = "#,##0"
hh = ["No", "職員番号", "氏名", "所属", "対象月", "報酬額", "決定見込額", "保留理由", "保留開始日", "経過日数", "次回確認予定日", "備考", "行"]
head(hold, 5, hh)
rg = lambda k: f"請求記録!${c[k]}${R0}:${c[k]}${RE}"
src = ["", "no", "nm", "dept", "key", "rew", "fin", "hr", "hs", "hd", "hn", "memo"]
for n in range(NHOLD):
    r = 6 + n
    hold[f"A{r}"] = f'=IF($M{r}="","",{n + 1})'
    hold[f"M{r}"] = f'=IFERROR(MATCH({n + 1},{rg("hseq")},0),"")'
    for j, k in enumerate(src[1:], 2):
        hold.cell(r, j, f'=IF($M{r}="","",IF(INDEX({rg(k)},$M{r})="","",INDEX({rg(k)},$M{r})))')
    for cc in "FG":
        hold[f"{cc}{r}"].number_format = "#,##0"
    for cc in "IK":
        hold[f"{cc}{r}"].number_format = "yyyy/m/d"
hold.conditional_formatting.add(f"J6:J{5 + NHOLD}", FormulaRule(formula=['AND(ISNUMBER($J6),$J6>設定!$C$7)'], fill=PatternFill("solid", bgColor="FF9999", fgColor="FF9999")))
hold.conditional_formatting.add(f"J6:J{5 + NHOLD}", FormulaRule(formula=['AND(ISNUMBER($J6),$J6>設定!$C$6)'], fill=PatternFill("solid", bgColor="FFE699", fgColor="FFE699")))
for cl, w in zip("ABCDEFGHIJKLM", [5, 11, 14, 26, 8, 11, 11, 22, 11, 8, 12, 40, 5]):
    hold.column_dimensions[cl].width = w
hold.column_dimensions["M"].hidden = True
# 職員単位
S0 = 6 + NHOLD + 3
hold[f"A{S0 - 1}"] = "▼ 職員単位の保留（請求前の保留：育休期間の変更待ちなど）"
hold[f"A{S0 - 1}"].font = Font(name=FN, size=11, bold=True, color="C00000")
head(hold, S0, ["No", "職員番号", "氏名", "所属", "標準報酬月額", "保留理由", "保留開始日", "経過日数", "職員メモ", "行"], HDR2)
msrc = {"B": "A", "C": "B", "D": "C", "E": "K", "F": "M", "G": "N", "I": "L"}
for n in range(60):
    r = S0 + 1 + n
    hold[f"J{r}"] = f'=IFERROR(MATCH({n + 1},職員マスタ!$Q${R0}:$Q${ME},0),"")'
    hold[f"A{r}"] = f'=IF($J{r}="","",{n + 1})'
    for cl, ml in msrc.items():
        hold[f"{cl}{r}"] = f'=IF($J{r}="","",IF(INDEX(職員マスタ!${ml}${R0}:${ml}${ME},$J{r})="","",INDEX(職員マスタ!${ml}${R0}:${ml}${ME},$J{r})))'
    hold[f"H{r}"] = f'=IF(OR($J{r}="",$G{r}=""),"",TODAY()-$G{r})'
    hold[f"G{r}"].number_format = "yyyy/m/d"; hold[f"E{r}"].number_format = "#,##0"
hold.freeze_panes = "A6"
# 理由別
hold["O5"] = "保留理由"; hold["P5"] = "請求単位"; hold["Q5"] = "職員単位"
head(hold, 5, ["保留理由", "請求単位", "職員単位"], HDR2, start=15, h=34)
for i in range(12):
    r = 6 + i
    hold[f"O{r}"] = f'=IF(設定!F{3 + i}="","",設定!F{3 + i})'
    hold[f"P{r}"] = f'=IF(O{r}="","",COUNTIFS({rg("hr")},O{r},{rg("st")},"保留中"))'
    hold[f"Q{r}"] = f'=IF(O{r}="","",COUNTIFS(職員マスタ!$M${R0}:$M${ME},O{r},職員マスタ!$P${R0}:$P${ME},"保留中"))'
for cl, w in zip("OPQ", [26, 9, 9]):
    hold.column_dimensions[cl].width = w

# ================= 月次集計 =================
title(mon, "月次集計", "対象月別の請求状況と、支給月別の支給額")
head(mon, 4, ["対象月", "請求件数", "報酬額 合計", "決定額 合計", "支給済", "未処理", "保留中", "不支給", "要確認"])
for i in range(24):
    r = 5 + i
    mon[f"A{r}"] = months[i]
    mon[f"B{r}"] = f'=COUNTIFS({rg("key")},$A{r})'
    mon[f"C{r}"] = f'=SUMIFS({rg("rew")},{rg("key")},$A{r})'
    mon[f"D{r}"] = f'=SUMIFS({rg("fin")},{rg("key")},$A{r})'
    for cl, s in zip("EFGHI", ["支給済", "未処理", "保留中", "不支給", "要確認"]):
        mon[f"{cl}{r}"] = f'=COUNTIFS({rg("key")},$A{r},{rg("st")},"{s}")'
    mon[f"C{r}"].number_format = mon[f"D{r}"].number_format = "#,##0"
mon["A29"] = "合計"
for cl in "BCDEFGHI":
    mon[f"{cl}29"] = f"=SUM({cl}5:{cl}28)"
    mon[f"{cl}29"].font = Font(name=FN, bold=True)
    mon[f"{cl}29"].number_format = "#,##0"
head(mon, 4, ["支給月", "件数", "支給額 合計"], HDR3, start=11)
for i in range(30):
    r = 5 + i
    mon[f"K{r}"] = months[2 + i]
    mon[f"L{r}"] = f'=COUNTIFS({rg("pm")},$K{r},{rg("st")},"支給済")'
    mon[f"M{r}"] = f'=SUMIFS({rg("fin")},{rg("pm")},$K{r},{rg("st")},"支給済")'
    mon[f"M{r}"].number_format = "#,##0"
for cl, w in zip("ABCDEFGHIJKLM", [10, 9, 14, 13, 8, 8, 8, 8, 8, 3, 10, 8, 14]):
    mon.column_dimensions[cl].width = w
ch = BarChart(); ch.type = "col"; ch.title = "支給月別 支給額（円）"; ch.legend = None
ch.add_data(Reference(mon, min_col=13, min_row=4, max_row=24), titles_from_data=True)
ch.set_categories(Reference(mon, min_col=11, min_row=5, max_row=24))
ch.height, ch.width = 8, 18
mon.add_chart(ch, "O4")

# ================= 職員別一覧 =================
title(mat, "職員別 月別一覧", "金額＝決定額、「保留」＝保留中、0＝不支給。従来の「短時間支給リスト」と同じ見方ができます")
head(mat, 5, ["職員番号", "氏名", "所属"] + months[:24] + ["職員単位の保留"])
for i in range(NMAS):
    r = R0 + i
    mat[f"A{r}"] = f'=IF(職員マスタ!A{r}="","",職員マスタ!A{r})'
    mat[f"B{r}"] = f'=IF($A{r}="","",職員マスタ!B{r})'
    mat[f"C{r}"] = f'=IF($A{r}="","",職員マスタ!C{r})'
    mat[f"AB{r}"] = f'=IF(職員マスタ!P{r}="保留中",職員マスタ!M{r},"")'
    for j in range(24):
        cl = L(4 + j)
        mat[f"{cl}{r}"] = (f'=IF($A{r}="","",IF(COUNTIFS({rg("no")},$A{r},{rg("key")},{cl}$5,{rg("st")},"保留中")>0,"保留",'
                           f'IF(COUNTIFS({rg("no")},$A{r},{rg("key")},{cl}$5)=0,"",SUMIFS({rg("fin")},{rg("no")},$A{r},{rg("key")},{cl}$5))))')
        mat[f"{cl}{r}"].number_format = "#,##0"
mat.conditional_formatting.add(f"D{R0}:AA{ME}", FormulaRule(formula=[f'D{R0}="保留"'], fill=PatternFill("solid", bgColor="F8CBAD", fgColor="F8CBAD"), font=Font(bold=True, color="C00000")))
mat.conditional_formatting.add(f"AB{R0}:AB{ME}", FormulaRule(formula=[f'LEN(AB{R0})>0'], fill=PatternFill("solid", bgColor="F8CBAD", fgColor="F8CBAD")))
mat.column_dimensions["A"].width = 11; mat.column_dimensions["B"].width = 14; mat.column_dimensions["C"].width = 26
for j in range(24):
    mat.column_dimensions[L(4 + j)].width = 9
mat.column_dimensions["AB"].width = 22
mat.freeze_panes = f"D{R0}"

# ================= 不支給通知（一覧） =================
nl = wb.create_sheet("不支給通知", 2)
title(nl, "不支給通知の管理", "ステータスが「不支給」の請求を自動で一覧にします。理由の選択・通知日（決裁完了日）の入力は「請求記録」の緑の列で行います。")
nl["A3"] = "不支給の請求"; nl["C3"] = '=COUNTIF($J$7:$J$306,"?*")'
for i_, (lab_, key_) in enumerate((("理由未選択", "理由未選択"), ("通知日未入力", "通知日未入力"), ("出力待ち", "出力待ち"), ("出力済", "出力済"))):
    nl.cell(3, 4 + i_ * 2, lab_)
    nl.cell(3, 5 + i_ * 2, f'=COUNTIF($J$7:$J$306,"{key_}")')
for a_ in ("A3", "C3", "D3", "E3", "F3", "G3", "H3", "I3", "J3", "K3"):
    nl[a_].font = Font(name=FN, size=11, bold=True)
head(nl, 6, ["No", "請求記録の行", "職員番号", "氏名", "所属", "対象月", "不支給の理由", "通知日", "出力日", "状況", "行(補助)"])
for n_ in range(300):
    r_ = 7 + n_
    nl[f"K{r_}"] = f'=IFERROR(MATCH({n_ + 1},{rg("nseq")},0),"")'
    nl[f"A{r_}"] = f'=IF($K{r_}="","",{n_ + 1})'
    nl[f"B{r_}"] = f'=IF($K{r_}="","",$K{r_}+{R0 - 1})'
    for cl_, k_ in (("C", "no"), ("D", "nm"), ("E", "dept"), ("F", "key"), ("G", "nar"), ("H", "nd"), ("I", "ndo")):
        nl[f"{cl_}{r_}"] = f'=IF($K{r_}="","",IF(INDEX({rg(k_)},$K{r_})="","",INDEX({rg(k_)},$K{r_})))'
    nl[f"J{r_}"] = f'=IF($K{r_}="","",IF($G{r_}="","理由未選択",IF($H{r_}="","通知日未入力",IF($I{r_}="","出力待ち","出力済"))))'
    nl[f"H{r_}"].number_format = nl[f"I{r_}"].number_format = "yyyy/m/d"
for cl_, w_ in zip("ABCDEFGHIJK", [5, 10, 11, 14, 28, 8, 30, 11, 11, 13, 6]):
    nl.column_dimensions[cl_].width = w_
nl.column_dimensions["K"].hidden = True
nl.freeze_panes = "A7"
for txt_, colr_ in (("理由未選択", "FFC7CE"), ("通知日未入力", "FFE699"), ("出力待ち", "DDEBF7"), ("出力済", "E2EFDA")):
    nl.conditional_formatting.add("J7:J306", FormulaRule(formula=[f'$J7="{txt_}"'], fill=PatternFill("solid", bgColor=colr_, fgColor=colr_)))

# ================= 不支給通知書（印刷用） =================
nt = wb.create_sheet("不支給通知書", 3)
nt.sheet_view.showGridLines = False
PF = "ＭＳ Ｐゴシック"
for cl_, w_ in zip("ABCDEFGHI", [4, 12, 12, 12, 12, 12, 12, 12, 4]):
    nt.column_dimensions[cl_].width = w_
nt.column_dimensions["K"].width = 22; nt.column_dimensions["L"].width = 28


def g(k_):
    return f'INDEX(請求記録!${c[k_]}$1:${c[k_]}$3005,$L$2)'


def jd_(x_):
    return f'IF({x_}="","令和　　年　　月　　日","令和 "&(YEAR({x_})-2018)&" 年 "&MONTH({x_})&" 月 "&DAY({x_})&" 日")'


nt["K1"] = "▼ 出力する請求記録の行（自動）"; nt["K1"].font = Font(name=FN, size=9, bold=True, color="C00000")
nt["L2"] = None
nt["K2"] = "請求記録の行番号"
helper = [(3, "氏名", f'=IF($L$2="","",IF({g("nm")}="","",{g("nm")}))'),
          (4, "所属", f'=IF($L$2="","",IF({g("dept")}="","",{g("dept")}))'),
          (5, "職員番号", f'=IF($L$2="","",{g("no")})'),
          (6, "受付日", f'=IF($L$2="","",IF({g("recv")}="","",{g("recv")}))'),
          (7, "通知日", f'=IF($L$2="","",IF({g("nd")}="","",{g("nd")}))'),
          (8, "対象年", f'=IF($L$2="","",{g("y")})'),
          (9, "対象月", f'=IF($L$2="","",{g("m")})'),
          (10, "適用する理由区分", f'=IF($L$2="","",IF({g("nar")}="","",{g("nar")}))'),
          (11, "個別記載", f'=IF($L$2="","",IF({g("ntxt")}="","",{g("ntxt")}))'),
          (12, "明細区分", '=IFERROR(INDEX(設定!$L$3:$L$12,MATCH($L$10,設定!$J$3:$J$12,0)),2)'),
          (13, "理由文", '=IF($L$11<>"",$L$11,IFERROR(SUBSTITUTE(INDEX(設定!$K$3:$K$12,MATCH($L$10,設定!$J$3:$J$12,0)),"{最低限度額}",TEXT(設定!$C$3,"#,##0")),""))'),
          (14, "標準報酬月額", f'=IF($L$2="","",IF({g("std")}="","",{g("std")}))'),
          (15, "報酬額", f'=IF($L$2="","",IF({g("rew")}="","",{g("rew")}))'),
          (16, "算出した支給額", f'=IF($L$2="","",IF({g("calc")}="","",{g("calc")}))')]
for r_, lab_, f_ in helper:
    nt[f"K{r_}"] = lab_; nt[f"L{r_}"] = f_
    nt[f"K{r_}"].font = nt[f"L{r_}"].font = Font(name=FN, size=9, color="7F7F7F")
nt["L2"].fill = INP
nt["L6"].number_format = nt["L7"].number_format = "yyyy/m/d"
heights = {1: 10, 2: 22, 3: 10, 4: 20, 5: 8, 6: 22, 7: 18, 8: 14, 9: 14, 10: 20, 11: 14, 12: 24, 13: 14, 14: 22, 15: 22, 16: 12,
           17: 24, 18: 22, 19: 22, 20: 20, 21: 10, 22: 10, 23: 22, 24: 22, 25: 22, 26: 14, 27: 14, 28: 20, 29: 20, 30: 20, 31: 20, 32: 20, 33: 14, 34: 20, 35: 20, 36: 20}
for r_, h_ in heights.items():
    nt.row_dimensions[r_].height = h_


def tx(addr_, v_, size_=11, h_="left", bold_=False, wrap_=False, ul_=False, va_="center"):
    cell_ = nt[addr_]
    cell_.value = v_
    cell_.font = Font(name=PF, size=size_, bold=bold_, underline=("single" if ul_ else None))
    cell_.alignment = Alignment(horizontal=h_, vertical=va_, wrap_text=wrap_)


nt.merge_cells("A2:I2"); tx("A2", "=" + jd_("$L$7"), h_="right")
nt.merge_cells("B4:H4"); tx("B4", '=$L$4', 11)
nt.merge_cells("B6:H6"); tx("B6", '=IF($L$3="","",$L$3&"　様")', 12)
nt.merge_cells("B7:H7"); tx("B7", '=IF($L$5="","","　　（"&$L$5&"）")', 10)
nt.merge_cells("D10:H10"); tx("D10", "広島市職員共済組合理事長", 11, "right")
nt.merge_cells("B12:H12"); tx("B12", "広島市職員共済組合短期給付不支給決定通知書", 14, "center")
nt.merge_cells("B14:H15"); tx("B14", '="　"&' + jd_("$L$6") + '&"に広島市職員共済組合にて受理いたしました育児時短勤務手当金請求書について、地方公務員等共済組合法第七十条の五に基づき、次のとおり決定しましたので通知します。"', 11, wrap_=True, va_="top")
nt.merge_cells("B17:B20"); tx("B17", "審査の結果", 11, "center")
nt.merge_cells("C17:H17"); tx("C17", '=IF($L$2="","","不支給（対象月："&JIS("令和"&$L$8&"年"&$L$9&"月")&"）")', 12, bold_=True)
nt.merge_cells("C18:H19"); tx("C18", '=$L$13', 11, wrap_=True, ul_=True, va_="top")
nt.merge_cells("C20:H20"); tx("C20", '=IF(OR($L$12=1,$L$12=3),"※詳細については下記のとおり","")', 10)
thin_ = Side(style="thin", color="000000")
for r_ in range(17, 21):
    for cc_ in "BCDEFGH":
        cell_ = nt[f"{cc_}{r_}"]
        cell_.border = Border(left=thin_ if cc_ in "BC" else None, right=thin_ if cc_ in "BH" else None,
                              top=thin_ if r_ == 17 else None, bottom=thin_ if r_ == 20 else None)
nt.merge_cells("B23:F23"); tx("B23", '=IF(OR($L$12=1,$L$12=3),"　育児時短勤務を開始した月の標準報酬月額","")', 11)
nt.merge_cells("G23:H23"); tx("G23", '=IF(AND(OR($L$12=1,$L$12=3),$L$14<>""),TEXT($L$14,"#,##0")&" 円","")', 11, "right")
nt.merge_cells("B24:F24"); tx("B24", '=IF(OR($L$12=1,$L$12=3),"　対象月の報酬額","")', 11)
nt.merge_cells("G24:H24"); tx("G24", '=IF(AND(OR($L$12=1,$L$12=3),$L$15<>""),TEXT($L$15,"#,##0")&" 円","")', 11, "right")
nt.merge_cells("B25:F25"); tx("B25", '=IF($L$12=3,"　算出した支給額（最低限度額以下）","")', 11)
nt.merge_cells("G25:H25"); tx("G25", '=IF(AND($L$12=3,$L$16<>""),TEXT($L$16,"#,##0")&" 円","")', 11, "right")
nt.merge_cells("B29:H32"); tx("B29", "　この処分に不服があるときは、この処分があったことを知った日の翌日から起算して３箇月以内に、全国市町村職員共済組合連合会審査会に審査請求をすることができます。また、この処分があったことを知った日から６箇月以内に、広島市職員共済組合を被告として訴訟を提起することもできます。", 10.5, wrap_=True, va_="top")
nt.merge_cells("E35:H35"); tx("E35", "担当：庶務係", 11, "right")
nt.merge_cells("E36:H36"); tx("E36", "電話：082-504-2061", 11, "right")
# Word差し込み用（トークン⇔値）
nt["N1"] = "▼ Word差し込み用（自動）"; nt["N1"].font = Font(name=FN, size=9, bold=True, color="C00000")
nt.column_dimensions["N"].width = 16; nt.column_dimensions["O"].width = 40


def wd_(x_):
    return f'IF({x_}="","令和　　年　　月　　日","令和"&(YEAR({x_})-2018)&"年"&MONTH({x_})&"月"&DAY({x_})&"日")'


det12 = 'OR($L$12=1,$L$12=3)'
tok = [("{通知日}", "=" + wd_("$L$7")), ("{所属}", "=$L$4"), ("{氏名}", "=$L$3"), ("{職員番号}", "=$L$5"), ("{受理日}", "=" + wd_("$L$6")),
       ("{対象月}", '=IF($L$2="","",JIS("令和"&$L$8&"年"&$L$9&"月"))'), ("{理由}", "=$L$13"),
       ("{詳細注記}", f'=IF({det12},"※詳細については下記のとおり","")'),
       ("{明細項目1}", f'=IF({det12},"育児時短勤務を開始した月の標準報酬月額","")'),
       ("{明細金額1}", f'=IF(AND({det12},$L$14<>""),TEXT($L$14,"#,##0")&"円","")'),
       ("{明細項目2}", f'=IF({det12},"対象月の報酬額","")'),
       ("{明細金額2}", f'=IF(AND({det12},$L$15<>""),TEXT($L$15,"#,##0")&"円","")'),
       ("{明細項目3}", '=IF($L$12=3,"算出した支給額（最低限度額以下）","")'),
       ("{明細金額3}", '=IF(AND($L$12=3,$L$16<>""),TEXT($L$16,"#,##0")&"円","")')]
for i_, (t_, f_) in enumerate(tok, 2):
    nt[f"N{i_}"] = t_; nt[f"O{i_}"] = f_
    nt[f"N{i_}"].font = nt[f"O{i_}"].font = Font(name=FN, size=9, color="7F7F7F")
nt.print_area = "A1:I37"
nt.page_setup.orientation = "portrait"; nt.page_setup.paperSize = 9
nt.sheet_properties.pageSetUpPr = openpyxl.worksheet.properties.PageSetupProperties(fitToPage=True)
nt.page_setup.fitToWidth = 1; nt.page_setup.fitToHeight = 1
nt.page_margins.left = nt.page_margins.right = 0.8

# ================= 使い方 =================
guide.column_dimensions["A"].width = 3; guide.column_dimensions["B"].width = 120
G = [("育児時短勤務手当金　管理台帳　使い方", 16, True), ("", 10, False),
     ("■ 毎月の流れ（ファイルを開いたとき「マクロを有効にする」を押してください）", 12, True),
     ("0. 開くと、保留中・未処理・要確認の件数が表示されます。", 11, False),
     ("1. 申請書の取込：メールで届いた電子申請書(Excel)を1つのフォルダに保存 →「請求記録」上部の［フォルダ内の申請書を一括取込］。取り込んだファイルは「取込済」フォルダへ移動します。", 11, False),
     ("　　1件ずつ選ぶときは［申請書ファイルを取り込む］（複数選択可）。入力エラーが残っている申請書・同じ職員同じ月の重複は取り込まず、理由を表示します。", 11, False),
     ("　　紙の申請書は黄色い列に直接入力（最低限：職員番号・対象年・対象月・報酬額）。", 11, False),
     ("2. 氏名・所属・標準報酬月額・判定（○△×）・決定額・ステータスが自動で出ます。「チェック」列に文字が出た行は、申請書と人給/マスタの食い違い等があるので確認します。", 11, False),
     ("3. 基幹システムへ入力したら、［未処理に支給月を一括入力］で支給月（例：R8.10）をまとめて入れます（ステータスが「支給済」になります）。個別に入れるときは「支給月」列で選びます。", 11, False),
     ("4. 支給を保留するときは「保留理由」（と保留開始日・次回確認予定日）を入れるだけ。「保留一覧」に自動で載り、経過日数が出ます。解決したら「保留解消日」または「支給月」を入れると一覧から消えます（履歴は残ります）。", 11, False),
     ("　　標準報酬月額：申請書の標準報酬月額は、台帳（職員マスタ）に登録が無い場合の判定に使います。取込ボタンは、初めての職員や標準報酬月額が空の職員を職員マスタへ自動登録します。台帳の額と申請書の額が違うときは「チェック」列に表示します（判定は台帳の額を優先）。", 11, False),
     ("6. 不支給通知書：不支給の請求は「不支給通知」シートに自動で一覧されます。①「請求記録」の緑の列で「不支給理由（区分）」（判定×・下限以下は自動候補。部分休業の取得実績なし等は選択）と、決裁完了後に「通知日」を入力 → ②「不支給通知」シートの［選択行の通知書を表示］で確認・印刷、または［未出力を一括PDF出力］［未出力を一括印刷］。", 11, False),
     ("　　出力した行には「通知書出力日」が入り、二重出力を防ぎます（再出力は出力日を消します）。理由文は「設定」シートで編集できます。", 11, False),
     ("5. 請求前に保留する場合（育休期間の変更待ち等）は「職員マスタ」の【職員単位の保留】に入れます。", 11, False),
     ("", 10, False),
     ("■ シートの役割", 12, True),
     ("請求記録：1請求1行の台帳（ここが本体。3,000行まで）／保留一覧：保留中の請求・職員と理由別件数／月次集計：対象月別・支給月別の件数と金額／職員別一覧：従来のリストと同じ見方（月×職員）", 11, False),
     ("職員マスタ：職員ごとの時短期間・標準報酬月額・子の生年月日／人給データ：人給の出力を貼り付ける場所（職員マスタに自動反映）／設定：最低限度額(2,411円)・給付率・保留理由の一覧", 11, False),
     ("", 10, False),
     ("■ 計算ルール（従来の「短時間支給リスト」と同じ）", 12, True),
     ("報酬額 ≧ 標準報酬月額 →×（支給なし）／標準報酬月額の90%以上100%未満 →△（逓減）：率＝(9×標準報酬月額−9×報酬額)÷(10×報酬額)を小数4位に四捨五入し、報酬額×率の円未満切捨て", 11, False),
     ("報酬額 ＜ 標準報酬月額の90% →○：報酬額×10%（円未満切捨て）／計算額が最低限度額（設定シート：2,411円）以下なら不支給", 11, False),
     ("決定額を手で直したいときは「決定額（手修正）」列に入力します（旧リストの金額を引き継いだ行には備考があります）。", 11, False),
     ("", 10, False),
     ("■ 注意", 12, True),
     ("・個人情報を含むファイルです。保存場所・持ち出しにご注意ください。", 11, False),
     ("・旧リストから移行した行の保留開始日は不明のため空欄です（入れると経過日数が出ます）。", 11, False)]
for i, (t, s, b) in enumerate(G, 2):
    guide.cell(i, 2, t).font = Font(name=FN, size=s, bold=b)
    guide.cell(i, 2).alignment = Alignment(wrap_text=True, vertical="top")
guide.sheet_view.showGridLines = False

# ================= 旧リスト移行 =================
if legacy:
    lw = openpyxl.load_workbook(legacy, data_only=True)
    lc = openpyxl.load_workbook(legacy)  # コメント用
    ws = lw["短時間支給リスト"]; wc = lc["短時間支給リスト"]

    def hold_reason(t):
        if "住居" in t: return "住居手当の確認"
        if "通勤" in t: return "通勤手当の確認"
        if "標準報酬" in t: return "標準報酬月額の変更確認"
        if "育休" in t: return "育休期間の変更待ち"
        if "部分休業" in t: return "部分休業の取得状況確認"
        return "その他"

    def todate(v):
        return v if isinstance(v, dt.datetime) else None

    def calc(a, s, lim=2411):
        D = lambda x: Decimal(str(x))
        if a >= s: return 0
        if a >= s * 0.9:
            rate = (D(9) * s - D(9) * a) / (D(10) * a)
            rate = rate.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
            v = int((D(a) * rate).to_integral_value(rounding="ROUND_FLOOR"))
        else:
            v = int(D(a) * Decimal("0.1") // 1)
        return 0 if v <= lim else v

    mrow = R0; rrow = R0; diff = []
    labels = []
    for idxm in range(17):
        labels.append((7 + (3 + idxm) // 12, (3 + idxm) % 12 + 1))
    for r in range(5, 105):
        no = ws.cell(r, 1).value
        if not isinstance(no, (int, float)): continue
        s_std = ws.cell(r, 9).value
        s_std = s_std if isinstance(s_std, (int, float)) else None
        g = ws.cell(r, 7).value
        kind = "部分休業" if g == "部分休業" else None
        memo = []
        for cc in range(2, 10):
            cm = wc.cell(r, cc).comment
            if cm and cm.text.strip(): memo.append(cm.text.strip().replace("\n", ""))
        mas.cell(mrow, 1, no)
        mas.cell(mrow, 3, ws.cell(r, 3).value if isinstance(ws.cell(r, 3).value, str) and not ws.cell(r, 3).value.startswith("#") else None)
        mas.cell(mrow, 5, todate(ws.cell(r, 4).value))
        mas.cell(mrow, 7, todate(ws.cell(r, 6).value))
        mas.cell(mrow, 8, todate(g) if kind is None else None)
        if kind: mas.cell(mrow, 9, kind)
        hrs = ws.cell(r, 8).value
        if isinstance(hrs, (int, float)) and hrs > 0: mas.cell(mrow, 10, hrs)
        elif isinstance(hrs, str) and "部分休業" in hrs: mas.cell(mrow, 9, "部分休業")
        if s_std: mas.cell(mrow, 11, s_std)
        mas.cell(mrow, 12, "／".join(memo) if memo else None)
        staff_hold = None
        bm = wc.cell(r, 2).comment
        if bm and "保留" in bm.text: staff_hold = hold_reason(bm.text)
        for idxm in range(17):
            cc = 10 + idxm * 4
            cm = wc.cell(r, cc).comment
            if cm and "保留" in cm.text and wc.cell(r, cc + 3).value is None and staff_hold is None and not wc.cell(r, cc).value:
                staff_hold = hold_reason(cm.text)
        recs_for_staff = []
        for idxm, (yy, mm) in enumerate(labels):
            cc = 10 + idxm * 4
            rew, dec, pm = ws.cell(r, cc).value, ws.cell(r, cc + 1).value, ws.cell(r, cc + 3).value
            if not isinstance(rew, (int, float)): continue
            rrow_ = rrow
            rec[f"{c['no']}{rrow_}"] = no; rec[f"{c['y']}{rrow_}"] = yy; rec[f"{c['m']}{rrow_}"] = mm; rec[f"{c['rew']}{rrow_}"] = rew
            if isinstance(pm, str): rec[f"{c['pm']}{rrow_}"] = pm
            notes = []
            cmt = wc.cell(r, cc).comment
            cmt_t = cmt.text.strip().replace("\n", "") if cmt else ""
            if cmt_t: notes.append(cmt_t)
            if "保留" in cmt_t: rec[f"{c['hr']}{rrow_}"] = hold_reason(cmt_t)
            if staff_hold and pm is None and r == 24:
                rec[f"{c['hr']}{rrow_}"] = staff_hold
            if s_std and isinstance(dec, (int, float)):
                new = calc(rew, s_std)
                if new != dec and new > 0:
                    rec[f"{c['man']}{rrow_}"] = dec
                    notes.append(f"旧リストの決定額{dec:,}円を引継ぎ（新計算{new:,}円）")
                    diff.append((no, yy, mm, rew, s_std, dec, new))
            elif isinstance(dec, (int, float)):
                rec[f"{c['man']}{rrow_}"] = dec
                notes.append("標準報酬月額不明のため旧リストの決定額を引継ぎ")
            if notes: rec[f"{c['memo']}{rrow_}"] = "／".join(notes)
            rrow += 1
        if staff_hold and r != 24:
            mas.cell(mrow, 13, staff_hold)
        mrow += 1
    print("migrated staff", mrow - R0, "records", rrow - R0, "mismatch", len(diff))
    for x in diff[:40]: print("  diff", x)

for ws_ in (rec, hold, mat, mas, jk, mon, cfg, guide):
    ws_.sheet_view.zoomScale = 90
wb.calculation.fullCalcOnLoad = True
wb.active = 1
wb.save(dst)
print("saved", dst)
