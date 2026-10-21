# -*- coding: utf-8 -*-
"""電子申請書(育児時短勤務手当金請求書)を元様式から生成する。 python build_form.py 元様式.xlsx 出力.xlsx"""
import sys
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side, Protection
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule

src, dst = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src)
fo, ura = wb.worksheets[0], wb.worksheets[1]
fo.title, ura.title = "請求書(表)", "請求書(裏)"
inp = wb.create_sheet("入力", 0)
ex = wb.create_sheet("共済組合提出データ")
guide = wb.create_sheet("使い方", 0)

FN = "Meiryo UI"
YEL = PatternFill("solid", fgColor="FFF9C4")
GRY = PatternFill("solid", fgColor="E7E6E6")
SEC = PatternFill("solid", fgColor="1F4E78")
thin = Side(style="thin", color="999999")
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)

for col, w in {"A": 1.5, "B": 34, "C": 8, "D": 7, "E": 3.5, "F": 7, "G": 3.5, "H": 7, "I": 4, "J": 2, "K": 62, "L": 46}.items():
    inp.column_dimensions[col].width = w
inp.sheet_view.showGridLines = False
inp.sheet_view.zoomScale = 100

inp["B1"] = "育児時短勤務手当金請求書　入力シート"
inp["B1"].font = Font(name=FN, size=16, bold=True)
inp.merge_cells("B2:L2")
inp["B3"] = "黄色いセルに入力してください。右の「チェック」欄が ✓（緑）になれば正しく入力できています。✕（赤）は必ず直してください。☆の項目（標準報酬月額・決定額・個人番号）は共済組合が記入するので入力不要です。"
inp.merge_cells("B3:L3")
inp["B3"].alignment = Alignment(wrap_text=True, vertical="top")
inp["B3"].font = Font(name=FN, size=10)
inp.row_dimensions[3].height = 30
inp["K4"], inp["L4"] = "チェック（自動）", "記入例・説明"
for c in ("K4", "L4"):
    inp[c].font = Font(name=FN, size=10, bold=True, color="FFFFFF")
    inp[c].fill = SEC

inputs = []  # 入力セル(保護解除・黄色)


def sec(r, t):
    inp.merge_cells(f"B{r}:L{r}")
    inp[f"B{r}"] = t
    inp[f"B{r}"].font = Font(name=FN, size=11, bold=True, color="FFFFFF")
    inp[f"B{r}"].fill = SEC


def label(r, t):
    inp[f"B{r}"] = t
    inp[f"B{r}"].font = Font(name=FN, size=10)
    inp[f"B{r}"].alignment = Alignment(wrap_text=True, vertical="center")
    inp[f"K{r}"].font = Font(name=FN, size=10)
    inp[f"K{r}"].alignment = Alignment(wrap_text=True, vertical="center")


def hint(r, t):
    inp[f"L{r}"] = t
    inp[f"L{r}"].font = Font(name=FN, size=9, color="7F7F7F")
    inp[f"L{r}"].alignment = Alignment(wrap_text=True, vertical="center")


def cell_in(addr, merge_to=None, fmt=None):
    c = inp[addr]
    if merge_to:
        inp.merge_cells(f"{addr}:{merge_to}")
    c.font = Font(name=FN, size=11)
    c.alignment = Alignment(horizontal="center" if not merge_to else "left", vertical="center", shrink_to_fit=False)
    if fmt:
        c.number_format = fmt
    inputs.append((addr, merge_to))


def static(addr, t):
    inp[addr] = t
    inp[addr].font = Font(name=FN, size=10)
    inp[addr].alignment = Alignment(horizontal="center", vertical="center")


def dv(addr, **kw):
    msg = kw.pop("msg")
    d = DataValidation(showErrorMessage=True, errorStyle="stop", errorTitle="入力エラー", error=msg, **kw)
    d.add(addr)
    inp.add_data_validation(d)


def date_row(r, era="令和", auto=False, ymax=30):
    if era in ("令和", "令和auto"):
        static(f"C{r}", "令和")
    else:
        cell_in(f"C{r}")
        dv(f"C{r}", type="list", formula1='"昭和,平成"', msg="「昭和」か「平成」を選んでください。")
    for col, mark in (("D", "E"), ("F", "G"), ("H", "I")):
        static(f"{mark}{r}", {"E": "年", "G": "月", "I": "日"}[mark])
        if not auto:
            cell_in(f"{col}{r}")
    if not auto:
        dv(f"D{r}", type="whole", operator="between", formula1="1", formula2=str(ymax), msg=f"年は1〜{ymax}の数字で入力してください。")
        dv(f"F{r}", type="whole", operator="between", formula1="1", formula2="12", msg="月は1〜12の数字で入力してください。")
        dv(f"H{r}", type="whole", operator="between", formula1="1", formula2="31", msg="日は1〜31の数字で入力してください。")
    else:
        for col in "DFH":
            inp[f"{col}{r}"].fill = GRY
            inp[f"{col}{r}"].alignment = Alignment(horizontal="center")


def serial(r, era_expr="2018"):
    return (f'=IF(COUNT(D{r},F{r},H{r})<3,"",IFERROR(IF(AND(D{r}>=1,F{r}>=1,F{r}<=12,H{r}>=1,'
            f'DAY(DATE(D{r}+{era_expr},F{r},H{r}))=H{r}),DATE(D{r}+{era_expr},F{r},H{r}),""),""))')


def chk(r, blank, mblank, errs=(), warns=()):
    f = '"✓"'
    for cond, m in reversed(list(warns)):
        f = f'IF({cond},"△ {m}",{f})'
    for cond, m in reversed(list(errs)):
        f = f'IF({cond},"✕ {m}",{f})'
    if blank:
        f = f'IF({blank},"✕ {mblank}",{f})' if mblank else f'IF({blank},"",{f})'
    inp[f"K{r}"] = "=" + f


def kata_bad(x):
    u = f'_xlfn.UNICODE(MID({x}&REPT(" ",60),ROW($1:$60),1))'
    return f"SUMPRODUCT(({u}<>32)*({u}<>12288)*((({u}<12449)+({u}>12540))>0))"


def tel_bad(x):
    t = f'SUBSTITUTE({x},"-","")'
    m = f"MID({t},ROW($1:$15),1)"
    return f'SUMPRODUCT((ROW($1:$15)<=LEN({t}))*((({m}<"0")+({m}>"9"))>0))'


def reqdate(r):
    return f"COUNTA(D{r},F{r},H{r})=0"


# ---------- ① 請求する月 ----------
sec(5, "① 請求する月")
label(6, "職員番号（7桁）")
cell_in("C6", "I6", "0")
dv("C6", type="whole", operator="between", formula1="1", formula2="99999999", msg="職員番号は数字だけで入力してください。")
hint(6, "共済組合への提出データ用です（請求書には印字されません）")
chk(6, 'C6=""', "未入力です", [("NOT(ISNUMBER(C6))", "数字で入力してください")], [("LEN(C6)<>7", "職員番号は通常7桁です。確認してください")])

label(7, "請求対象月（令和　年　月分）")
static("C7", "令和"); cell_in("D7"); static("E7", "年"); cell_in("F7"); static("G7", "月分")
dv("D7", type="whole", operator="between", formula1="7", formula2="30", msg="令和7〜30の数字で入力してください。")
dv("F7", type="whole", operator="between", formula1="1", formula2="12", msg="月は1〜12の数字で入力してください。")
inp["N7"] = '=IF(AND(ISNUMBER(D7),ISNUMBER(F7)),IFERROR(DATE(D7+2018,F7,1),""),"")'
inp["O7"] = '=IF(N7="","",EOMONTH(N7,0))'
hint(7, "育児時短勤務をした月。令和7年4月分以降が対象。月が終わってから請求します")
chk(7, "COUNTA(D7,F7)=0", "未入力です",
    [('N7=""', "年と月を入力してください"), ("N7<DATE(2025,4,1)", "令和7年4月分以降が対象です"),
     ("N7>=DATE(YEAR(TODAY()),MONTH(TODAY()),1)", "まだ月が終わっていません。勤務した月の翌月以降に請求してください")])

# ---------- ② 組合員 ----------
sec(8, "② 組合員")
label(9, "組合員等記号番号")
cell_in("C9", "D9", "@"); static("E9", "―"); cell_in("F9", "I9", "@")
hint(9, "組合員証・資格情報通知書の記号と番号（半角）")
chk(9, 'AND(C9="",F9="")', "未入力です", [('C9=""', "記号が未入力です"), ('F9=""', "番号が未入力です")])
label(10, "フリガナ")
cell_in("C10", "I10", "@")
hint(10, "全角カタカナ　例：ヒロシマ　ハナコ（姓と名の間は空白）")
chk(10, 'C10=""', "未入力です", [(f"{kata_bad('C10')}>0", "全角カタカナで入力してください（半角カナ・ひらがな・漢字は不可）")],
    [('AND(ISERROR(FIND(" ",C10)),ISERROR(FIND("　",C10)))', "姓と名の間に空白を入れてください")])
label(11, "組合員氏名")
cell_in("C11", "I11", "@")
hint(11, "例：広島　花子")
chk(11, 'C11=""', "未入力です")
label(12, "性別")
cell_in("C12", "D12")
dv("C12", type="list", formula1='"女,男"', msg="「女」か「男」を選んでください。")
chk(12, 'C12=""', "未入力です（選択してください）")
label(13, "生年月日")
date_row(13, era="昭和", ymax=64)
inp["N13"] = serial(13, 'IF(C13="昭和",1925,1988)')
hint(13, "昭和・平成を選び、年月日を数字で入力")
chk(13, f'AND(C13="",{reqdate(13)})', "未入力です",
    [('C13=""', "昭和・平成を選んでください"), (f'COUNT(D13,F13,H13)<3', "年・月・日をすべて入力してください"),
     ('AND(C13="昭和",D13>64)', "昭和は64年までです"), ('AND(C13="平成",D13>31)', "平成は31年までです"),
     ('N13=""', "存在しない日付です")],
    [('OR(N7="")', "") ] if False else [('AND(N7<>"",OR(N7-N13<18*365,N7-N13>70*365))', "年齢が18〜70歳の範囲外です。生年月日を確認してください")])

# ---------- ③ 所属機関 ----------
sec(14, "③ 所属機関")
label(15, "名称"); cell_in("C15", "I15", "@"); hint(15, "例：環境局環境保全課／○○保育園")
chk(15, 'C15=""', "未入力です")
label(16, "所在地"); cell_in("C16", "I16", "@"); hint(16, "例：広島市中区国泰寺町1-6-34")
chk(16, 'C16=""', "未入力です")

# ---------- ④ 時短勤務 ----------
sec(17, "④ 育児時短勤務（部分休業）の内容")
label(18, "勤務区分"); cell_in("C18", "I18")
dv("C18", type="list", formula1='"育児短時間勤務,部分休業"', msg="一覧から選んでください。")
hint(18, "承認書の区分（育児短時間勤務／部分休業）")
chk(18, 'C18=""', "未入力です（選択してください）")
label(19, "初回の請求ですか"); cell_in("C19", "I19")
dv("C19", type="list", formula1='"初回請求,2回目以降"', msg="一覧から選んでください。")
hint(19, "初回請求のときは母子手帳等の写しが必要です")
chk(19, 'C19=""', "未入力です（選択してください）")
label(20, "育児短時間勤務又は部分休業期間（開始）"); date_row(20); inp["N20"] = serial(20)
hint(20, "承認書に記載された期間の開始日")
chk(20, reqdate(20), "未入力です", [('N20=""', "年月日が正しくありません（存在しない日付など）")])
label(21, "育児短時間勤務又は部分休業期間（終了）"); date_row(21); inp["N21"] = serial(21)
hint(21, "承認書に記載された期間の終了日")
chk(21, reqdate(21), "未入力です", [('N21=""', "年月日が正しくありません（存在しない日付など）"), ('AND(N20<>"",N21<N20)', "終了日が開始日より前です")])
label(22, "支給終了の特別事由の開始日（該当時のみ）"); date_row(22); inp["N22"] = serial(22)
hint(22, "産前産後休業・介護休業・育児休業を新たに始める場合のみ。その前日が請求期間の終了日になります")
chk(22, reqdate(22), "", [('N22=""', "年月日が正しくありません")])
label(23, "育児時短勤務手当金請求期間（開始）【自動】"); date_row(23, auto=True)
label(24, "育児時短勤務手当金請求期間（終了）【自動】"); date_row(24, auto=True)
inp["N23"] = '=IF(OR(N7="",N20="",N21=""),"",MAX(N7,N20))'
inp["N24"] = '=IF(OR(N7="",N20="",N21="",N26=""),"",MIN(O7,N21,O26,IF(N22="",O7,N22-1)))'
for r, n in ((23, "N23"), (24, "N24")):
    inp[f"D{r}"] = f'=IF({n}="","",YEAR({n})-2018)'
    inp[f"F{r}"] = f'=IF({n}="","",MONTH({n}))'
    inp[f"H{r}"] = f'=IF({n}="","",DAY({n}))'
hint(23, "対象月・勤務期間・子の2歳到達日から自動計算（入力不要）")
hint(24, "子が2歳になる月は「2歳の誕生日の前々日」まで")
inp["K23"] = '=IF(N23="","",IF(AND(N24<>"",N24<N23),"✕ 請求期間がありません。対象月が勤務期間外か、子が2歳に達しています","✓"))'
inp["K24"] = '=IF(N24="","",IF(N24<N23,"✕ 請求期間がありません（上の入力を確認）","✓"))'
label(25, "育児時短勤務に係る子の名前"); cell_in("C25", "I25", "@"); hint(25, "例：広島　太郎")
chk(25, 'C25=""', "未入力です")
label(26, "子の生年月日"); date_row(26); inp["N26"] = serial(26)
inp["O26"] = '=IF(N26="","",DATE(YEAR(N26)+2,MONTH(N26),DAY(N26)-2))'
hint(26, "令和の年月日（母子手帳等で確認）")
chk(26, reqdate(26), "未入力です",
    [('N26=""', "年月日が正しくありません（存在しない日付など）"),
     ('AND(N20<>"",N26>N20)', "子の生年月日が勤務開始日より後になっています"),
     ('AND(N7<>"",O26<N7)', "対象月には子が2歳に達しています（2歳の誕生日の前々日までが対象）")])

# ---------- ⑤ 報酬 ----------
sec(27, "⑤ 報酬・通勤手当")
label(28, "支給対象月に支払われた報酬の額（円）"); cell_in("C28", "H28", "#,##0"); static("I28", "円")
dv("C28", type="whole", operator="between", formula1="0", formula2="99999999", msg="円の数字（整数）で入力してください。")
hint(28, "支給明細書の額（期末勤勉手当・給与改定差額を除く）。1月当たりの通勤手当を含む")
chk(28, 'C28=""', "未入力です", [("NOT(ISNUMBER(C28))", "数字で入力してください")],
    [("C28=0", "0円です。支給明細書を確認してください"), ("C28>1000000", "金額が大きすぎます。桁を確認してください")])
label(29, "通勤手当の有無"); cell_in("C29", "D29")
dv("C29", type="list", formula1='"有,無"', msg="「有」か「無」を選んでください。")
chk(29, 'C29=""', "未入力です（選択してください）")
label(30, "1月当たりの通勤手当の額（円）"); cell_in("C30", "H30", "#,##0"); static("I30", "円")
dv("C30", type="whole", operator="between", formula1="0", formula2="9999999", msg="円の数字（整数）で入力してください。")
hint(30, "「無」の場合は空欄。報酬の額に含めた通勤手当の額")
chk(30, "", "", [('AND(C29="有",OR(C30="",N(C30)=0))', "通勤手当が「有」の場合は金額を入力してください"),
                 ('AND(C29="無",N(C30)>0)', "通勤手当が「無」なのに金額が入力されています"),
                 ('AND(ISNUMBER(C30),ISNUMBER(C28),C30>C28)', "通勤手当が報酬の額より大きくなっています")],
    [('N(C30)>150000', "通勤手当が月15万円を超えています。確認してください"),
     ('AND(C31="数か月分一括支給",N35<>"",C30<>N35)', "一括支給の計算補助（下欄）の額と異なります")])
inp["K30"] = inp["K30"].value.replace("=IF(", '=IF(AND(C29="",C30=""),"",IF(', 1) + ")"
label(31, "通勤手当の支給方法（「有」の場合）"); cell_in("C31", "I31")
dv("C31", type="list", formula1='"毎月支給,数か月分一括支給"', msg="一覧から選んでください。")
hint(31, "数か月分をまとめて支給された場合は下の計算補助を使います")
chk(31, 'AND(C29="有",C31="")', "未入力です（選択してください）")
label(32, "【計算補助】一括支給された通勤手当の総額（円）"); cell_in("C32", "H32", "#,##0"); static("I32", "円")
label(33, "【計算補助】支給月数（か月分）"); cell_in("C33", "D33"); static("E33", "か月")
label(34, "【計算補助】請求月は何か月目か"); cell_in("C34", "D34"); static("E34", "か月目")
for a in ("C32", "C33", "C34"):
    dv(a, type="whole", operator="between", formula1="1", formula2="99999999" if a == "C32" else "12", msg="数字（整数）で入力してください。")
hint(32, "一括支給のときだけ入力。1月当たり＝総額÷月数（端数は最終月に加算）")
chk(32, 'AND(C31="数か月分一括支給",OR(C32="",C33="",C34=""))', "総額・月数・何か月目を入力してください",
    [('AND(C31="数か月分一括支給",C34>C33)', "請求月が月数より大きくなっています")])
inp["K32"] = '=IF(C31<>"数か月分一括支給","",' + inp["K32"].value[1:] + ")"
label(35, "【計算補助】1月当たりの通勤手当の額（自動）")
inp["N35"] = '=IF(AND(C31="数か月分一括支給",ISNUMBER(C32),ISNUMBER(C33),ISNUMBER(C34),N(C33)>0,N(C34)<=N(C33)),IF(C34=C33,C32-INT(C32/C33)*(C33-1),INT(C32/C33)),"")'
inp["C35"] = '=IF(N35="","",N35)'
inp.merge_cells("C35:H35"); inp["C35"].number_format = '#,##0"円"'; inp["C35"].fill = GRY
inp["C35"].alignment = Alignment(horizontal="right")

# ---------- ⑥ 請求者 ----------
sec(36, "⑥ 請求日・請求者")
label(37, "請求日"); date_row(37); inp["N37"] = serial(37)
hint(37, "提出する日（対象月の末日より後）")
chk(37, reqdate(37), "未入力です",
    [('N37=""', "年月日が正しくありません（存在しない日付など）"), ('AND(O7<>"",N37<=O7)', "請求日が対象月の末日以前です")],
    [('N37>TODAY()+1', "請求日が未来の日付です")])
label(38, "請求者　氏名"); cell_in("C38", "I38", "@"); hint(38, "組合員本人の氏名")
chk(38, 'C38=""', "未入力です", [], [('SUBSTITUTE(SUBSTITUTE(C38," ","")," ","")<>SUBSTITUTE(SUBSTITUTE(C11," ","")," ","")', "組合員氏名と異なります")])
label(39, "請求者　℡（連絡先）"); cell_in("C39", "I39", "@"); hint(39, "半角数字とハイフン　例：090-1234-5678")
chk(39, 'C39=""', "未入力です", [(f"{tel_bad('C39')}>0", "半角の数字とハイフンで入力してください"), ('LEN(SUBSTITUTE(C39,"-",""))<4', "桁数が足りません")])
label(40, "庶務担当　氏名"); cell_in("C40", "I40", "@"); hint(40, "所属の庶務担当者")
chk(40, 'C40=""', "未入力です")
label(41, "庶務担当　℡"); cell_in("C41", "I41", "@"); hint(41, "内線可　例：81-2345")
chk(41, 'C41=""', "未入力です", [(f"{tel_bad('C41')}>0", "半角の数字とハイフンで入力してください")])

# ---------- ⑦ 添付書類 ----------
sec(42, "⑦ 添付書類（用意した書類は ✓ を選んでください）")
att = [
    (43, "【育児短時間勤務】育児短時間勤務承認書（写）", "育児短時間勤務", "TRUE"),
    (44, "【育児短時間勤務】出勤簿（写）", "育児短時間勤務", "TRUE"),
    (45, "【育児短時間勤務】支給明細書（写）", "育児短時間勤務", "TRUE"),
    (46, "【育児短時間勤務】通勤手当一括支給の額がわかる支給明細書（写）", "育児短時間勤務", 'C31="数か月分一括支給"'),
    (47, "【育児短時間勤務】母子手帳等（写）（初回のみ）", "育児短時間勤務", 'C19="初回請求"'),
    (48, "【部分休業】部分休業承認請求書兼承認書（写）又は庶務事務システム承認画面", "部分休業", "TRUE"),
    (49, "【部分休業】出勤簿（写）", "部分休業", "TRUE"),
    (50, "【部分休業】支給明細書（写）", "部分休業", "TRUE"),
    (51, "【部分休業】通勤手当一括支給の額がわかる支給明細書（写）", "部分休業", 'C31="数か月分一括支給"'),
    (52, "【部分休業】母子手帳等（写）（初回のみ）", "部分休業", 'C19="初回請求"'),
]
for r, t, kind, need in att:
    label(r, t); cell_in(f"C{r}", f"D{r}")
    dv(f"C{r}", type="list", formula1='"✓"', msg="✓ を選ぶか、空欄にしてください。")
    chk(r, f'AND(C18=\"{kind}\",{need},C{r}<>\"✓\")', "書類を用意して ✓ を選んでください" if False else "必要な書類です。用意して ✓ を選んでください",
        [], [(f'AND(C18<>"",C18<>"{kind}",C{r}="✓")', "選んだ勤務区分と異なる書類にチェックがあります")])
    inp[f"K{r}"] = (f'=IF(C18="","",IF(AND(C18="{kind}",{need},C{r}<>"✓"),"✕ 必要な書類です。用意して ✓ を選んでください",'
                    f'IF(AND(C18<>"{kind}",C{r}="✓"),"△ 選んだ勤務区分と異なる書類にチェックがあります",IF(AND(C18="{kind}",{need}),"✓","")))) ')
    inp[f"K{r}"] = inp[f"K{r}"].value.strip()

LAST = 52
# ---------- 見た目・書式 ----------
for a, m in inputs:
    rng = [a]
    if m:
        c0, r0 = openpyxl.utils.cell.coordinate_from_string(a)
        c1, _ = openpyxl.utils.cell.coordinate_from_string(m)
        rng = [f"{openpyxl.utils.get_column_letter(i)}{r0}" for i in range(openpyxl.utils.column_index_from_string(c0), openpyxl.utils.column_index_from_string(c1) + 1)]
    for x in rng:
        inp[x].fill = YEL
        inp[x].border = BOX
        inp[x].protection = Protection(locked=False)
for r in range(6, LAST + 1):
    inp.row_dimensions[r].height = 24 if inp[f"B{r}"].fill != SEC else 20
for r in (5, 8, 14, 17, 27, 36, 42):
    inp.row_dimensions[r].height = 20
for r in (7, 20, 21, 22, 28, 30, 31, 32, 37, 43, 46, 48, 51):
    inp.row_dimensions[r].height = 30
red = PatternFill("solid", bgColor="FFC7CE", fgColor="FFC7CE")
inp.conditional_formatting.add(f"C6:I{LAST}", FormulaRule(formula=['LEFT($K6,1)="✕"'], fill=red))
inp.conditional_formatting.add(f"K6:K{LAST}", FormulaRule(formula=['LEFT($K6,1)="✕"'], font=Font(color="C00000", bold=True)))
inp.conditional_formatting.add(f"K6:K{LAST}", FormulaRule(formula=['LEFT($K6,1)="△"'], font=Font(color="B45F06", bold=True)))
inp.conditional_formatting.add(f"K6:K{LAST}", FormulaRule(formula=['LEFT($K6,1)="✓"'], font=Font(color="2E7D32")))
for rows, kind in ((range(43, 48), "部分休業"), (range(48, 53), "育児短時間勤務")):
    inp.conditional_formatting.add(f"B{rows[0]}:I{rows[-1]}", FormulaRule(formula=[f'$C$18="{kind}"'], fill=PatternFill("solid", bgColor="D9D9D9", fgColor="D9D9D9"), font=Font(color="A6A6A6")))

# バナー
inp["B2"] = ('=IF(COUNTIF(K6:K52,"✕*")>0,"✕ 入力エラーが "&COUNTIF(K6:K52,"✕*")&" 件あります。赤い項目を直してください。",'
             'IF(COUNTIF(K6:K52,"△*")>0,"△ エラーはありません。注意が "&COUNTIF(K6:K52,"△*")&" 件あります。内容を確認してください。（印刷できます）",'
             '"✓ すべて正しく入力されています。「請求書(表)」「請求書(裏)」を印刷し、添付書類をそろえて提出してください。"))')
inp["B2"].font = Font(name=FN, size=12, bold=True)
inp["B2"].alignment = Alignment(vertical="center", wrap_text=True)
inp.row_dimensions[2].height = 30
inp.conditional_formatting.add("B2:L2", FormulaRule(formula=['LEFT($B$2,1)="✕"'], fill=PatternFill("solid", bgColor="FFC7CE", fgColor="FFC7CE"), font=Font(color="9C0006", bold=True)))
inp.conditional_formatting.add("B2:L2", FormulaRule(formula=['LEFT($B$2,1)="△"'], fill=PatternFill("solid", bgColor="FFEB9C", fgColor="FFEB9C"), font=Font(color="7F6000", bold=True)))
inp.conditional_formatting.add("B2:L2", FormulaRule(formula=['LEFT($B$2,1)="✓"'], fill=PatternFill("solid", bgColor="C6EFCE", fgColor="C6EFCE"), font=Font(color="006100", bold=True)))
for col in ("N", "O"):
    inp.column_dimensions[col].hidden = True
inp.freeze_panes = "A5"
inp.protection.sheet = True
inp.protection.formatColumns = False
inp.sheet_properties.pageSetUpPr = openpyxl.worksheet.properties.PageSetupProperties(fitToPage=True)
inp.page_setup.orientation = "landscape"; inp.page_setup.fitToHeight = 0

# ---------- 請求書(表) ----------
def I(a):
    return f"入力!{a}"


def put(addr, f):
    fo[addr] = f
    al = fo[addr].alignment
    fo[addr].alignment = Alignment(horizontal=al.horizontal, vertical="center", wrap_text=al.wrap_text, shrink_to_fit=True)


def v(a):
    return f'=IF({I(a)}="","",{I(a)})'


put("X2", v("D7")); put("AC2", v("F7"))
put("AB6", v("C9")); put("AF6", v("F9"))
put("I6", v("C10")); put("I7", v("C11"))
put("R8", '=IF(入力!C12="女","（女）・ 男",IF(入力!C12="男","女 ・（男）","女 ・ 男"))')
put("H9", '=IF(入力!C13="昭和","（Ｓ）・ Ｈ",IF(入力!C13="平成","Ｓ ・（Ｈ）","Ｓ ・ Ｈ"))')
put("L9", v("D13")); put("O9", v("F13")); put("R9", v("H13"))
put("K11", v("C15")); put("K13", v("C16"))
for r, src_r in ((15, 20), (16, 23)):
    for tgt, col in (("M", "D"), ("Q", "F"), ("U", "H")):
        put(f"{tgt}{r}", v(f"{col}{src_r}"))
for r, src_r in ((15, 21), (16, 24)):
    for tgt, col in (("AB", "D"), ("AF", "F"), ("AJ", "H")):
        put(f"{tgt}{r}", v(f"{col}{src_r}"))
put("K17", v("C25")); put("X17", v("D26")); put("AC17", v("F26")); put("AH17", v("H26"))
put("N19", v("C28"))
put("K21", '="通勤手当：" & IF(入力!C29="有","（有）・ 無",IF(入力!C29="無","有 ・（無）","有 ・ 無")) & "　（該当するものに〇で囲んでください。）"')
put("X22", '=IF(入力!C30="","",入力!C30)')
put("AE25", v("C40")); put("AI25", v("C41"))
put("G27", v("D37")); put("J27", v("F37")); put("M27", v("H37"))
put("W27", v("C38")); put("Z31", v("C39"))
chkmap = {"K43": 43, "K44": 44, "K45": 45, "K46": 46, "K48": 47, "Y43": 48, "Y45": 49, "Y46": 50, "Y47": 51, "Y49": 52}
for a, r in chkmap.items():
    put(a, f'=IF(入力!C{r}="✓","☑","□")')
fo["A51"] = '=IF(COUNTIF(入力!K6:K52,"✕*")>0,"※入力エラーがあります。入力シートを直してから印刷してください（このまま提出しないでください）","")'
fo.merge_cells("A51:AM51")
fo["A51"].font = Font(name=FN, size=12, bold=True, color="FF0000")
fo["A51"].alignment = Alignment(horizontal="center")
fo.print_area = "A1:AM51"
fo.sheet_properties.pageSetUpPr = openpyxl.worksheet.properties.PageSetupProperties(fitToPage=True)
fo.page_setup.fitToWidth = 1; fo.page_setup.fitToHeight = 1; fo.page_setup.scale = None
fo.page_setup.paperSize = 9; fo.page_setup.orientation = "portrait"
fo.print_options.horizontalCentered = True
fo.protection.sheet = True
ura.protection.sheet = True
ura.sheet_properties.pageSetUpPr = openpyxl.worksheet.properties.PageSetupProperties(fitToPage=True)
ura.page_setup.fitToWidth = 1; ura.page_setup.fitToHeight = 1; ura.page_setup.scale = None; ura.page_setup.paperSize = 9

# ---------- 共済組合提出データ ----------
cols = [("職員番号", "C6"), ("対象年(令和)", "D7"), ("対象月", "F7"), ("報酬額", "C28"), ("通勤手当有無", "C29"), ("通勤手当月額", "C30"),
        ("氏名", "C11"), ("組合員記号", "C9"), ("組合員番号", "F9"), ("勤務区分", "C18"), ("時短開始日", "N20"), ("時短終了日", "N21"),
        ("請求期間開始", "N23"), ("請求期間終了", "N24"), ("子の氏名", "C25"), ("子の生年月日", "N26"), ("所属名称", "C15"),
        ("請求日", "N37"), ("初回請求", "C19")]
for i, (h, a) in enumerate(cols, 1):
    ex.cell(1, i, h).font = Font(name=FN, bold=True, color="FFFFFF")
    ex.cell(1, i).fill = SEC
    ex.cell(2, i, f'=IF(入力!{a}="","",入力!{a})')
    ex.column_dimensions[openpyxl.utils.get_column_letter(i)].width = 14
    if h.endswith("日") or h in ("請求期間開始", "請求期間終了"):
        ex.cell(2, i).number_format = "yyyy/m/d"
ex.cell(1, 20, "入力エラー件数").font = Font(name=FN, bold=True, color="FFFFFF")
ex.cell(1, 20).fill = SEC
ex.cell(2, 20, '=COUNTIF(入力!K6:K52,"✕*")')
ex["A4"] = "【共済組合の方へ】2行目（A2:T2）をコピーし、管理台帳の「請求記録」へ『値のみ貼り付け』してください（職員の方は触らないでください）。"
ex["A4"].font = Font(name=FN, size=10, color="C00000")
ex.protection.sheet = True

# ---------- 使い方 ----------
guide.column_dimensions["A"].width = 3; guide.column_dimensions["B"].width = 110
lines = [("育児時短勤務手当金請求書（電子申請書）　使い方", 16, True),
         ("", 10, False),
         ("■ 職員・庶務担当の方", 12, True),
         ("1. このファイルを開き、「入力」シートの黄色いセルに入力します（インストール不要・Excelだけで動きます）。", 11, False),
         ("2. 入力すると、右側の「チェック」欄が自動で ✓（OK）／✕（エラー）／△（要確認）になります。✕ は必ず直してください。", 11, False),
         ("3. 日付は「令和」の年・月・日を数字で入力します（例：令和8年4月 → 年に8、月に4）。請求期間は自動で計算されます。", 11, False),
         ("4. 「入力」シート最上段が緑色（✓）になったら、「請求書(表)」「請求書(裏)」を印刷し、所属機関の長の確認欄に記入・押印します。", 11, False),
         ("5. 添付書類（承認書・出勤簿・支給明細書の写し等）を添えて、庶務担当を通じて共済組合へ提出します。", 11, False),
         ("※入力エラーが残ったまま印刷すると、請求書の下に赤字で警告が印字されます。", 11, False),
         ("※1か月分ごとに1回請求します。翌月分は、このファイルを「名前を付けて保存」し、対象月と報酬額などを書き換えて使えます。", 11, False),
         ("※☆の項目（個人番号・標準報酬月額・決定額）と所属機関の長の氏名等は入力不要です。", 11, False),
         ("", 10, False),
         ("■ 共済組合の方", 12, True),
         ("・受け取ったファイルの「共済組合提出データ」シートの2行目をコピーし、管理台帳「請求記録」に値のみ貼り付けます。", 11, False),
         ("・請求期間の始期は『勤務開始日が月の途中ならその日から』で自動計算しています（運用が異なる場合はお知らせください）。", 11, False),
         ("", 10, False),
         ("■ 動作環境", 12, True),
         ("Excel 2013以降（マクロ不使用）。シートは保護（パスワードなし）されており、黄色いセル以外は書き換えできません。", 11, False)]
for i, (t, s, b) in enumerate(lines, 2):
    guide.cell(i, 2, t).font = Font(name=FN, size=s, bold=b)
    guide.cell(i, 2).alignment = Alignment(wrap_text=True)
guide.sheet_view.showGridLines = False

wb.calculation.fullCalcOnLoad = True
wb.active = 1
wb.save(dst)
print("saved", dst)
