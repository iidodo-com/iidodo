Attribute VB_Name = "PatchSearch"
Option Explicit

' 局課名の曖昧検索に直す(何度実行しても安全。PatchFilter / PatchCrosstab の内容も含む)
'  ・空欄 = 全て
'  ・「区役所」は「区」として検索(例: 東区役所 → 東区)
'  ・スペース(全角可)で区切ると、すべての語を含む局課だけを表示(最大3語)
Public Sub PatchSearch()
    Dim w1 As Worksheet, w2 As Worksheet, w3 As Worksheet
    Dim c As Long, keyCol As Long, lastRow As Long, kl As String, step As String, crit As String

    On Error GoTo EH

    step = "シートの確認"
    Set w1 = ThisWorkbook.Worksheets("入力")
    Set w2 = ThisWorkbook.Worksheets("問題点入力表")
    Set w3 = ThisWorkbook.Worksheets("復命用一覧")

    step = "入力シートの列の確認"
    If Trim(w1.Range("D1").Value) <> "対象局課名" Or Trim(w1.Range("E1").Value) <> "グループ" _
       Or Left(w1.Range("L1").Value, 2) <> "件数" Or Left(w1.Range("T1").Value, 2) <> "キー" Then
        MsgBox "入力シートの列の並びが想定と違います(D=対象局課名, E=グループ, L=件数, T=キー)。" & vbCrLf & _
               "列を入れ替えている場合は、作成者に連絡してください。", vbExclamation
        Exit Sub
    End If

    step = "問題点入力表のキー列の検索"
    For c = 1 To 40
        If Trim(w2.Cells(5, c).Value) = "キー" Then keyCol = c: Exit For
    Next
    If keyCol = 0 Then
        MsgBox "問題点入力表の5行目に「キー」の見出しが見つかりません。", vbExclamation
        Exit Sub
    End If
    kl = Split(w2.Cells(1, keyCol).Address(True, False), "$")(0)
    lastRow = w2.Cells(w2.Rows.Count, keyCol).End(xlUp).Row
    If keyCol >= 16 Then
        MsgBox "問題点入力表のキー列が P 列以降にあり、作業用セルと重なります。作成者に連絡してください。", vbExclamation
        Exit Sub
    End If

    ' ---- 復命用一覧: 検索語の自動分解(K:M列。非表示) ----
    step = "復命用一覧の検索語の分解"
    w3.Range("K2").Value = "正規化": w3.Range("K3").Value = "語1": w3.Range("K4").Value = "語2": w3.Range("K5").Value = "語3"
    w3.Range("L2").Formula = "=TRIM(SUBSTITUTE(SUBSTITUTE($C$3,""　"","" ""),""区役所"",""区""))"
    w3.Range("L3").Formula = "=IFERROR(LEFT(L2,FIND("" "",L2)-1),L2)"
    w3.Range("M3").Formula = "=IFERROR(TRIM(MID(L2,FIND("" "",L2)+1,200)),"""")"
    w3.Range("L4").Formula = "=IFERROR(LEFT(M3,FIND("" "",M3)-1),M3)"
    w3.Range("M4").Formula = "=IFERROR(TRIM(MID(M3,FIND("" "",M3)+1,200)),"""")"
    w3.Range("L5").Formula = "=M4"
    w3.Columns("K:M").Hidden = True
    w3.Range("B3").Value = "対象局課名(空欄=全て)"
    w3.Range("E3").Value = "→ 空欄=全て／スペース区切りで複数語(すべてを含む局課)／「東区役所」は「東区」として検索"

    ' ---- 問題点入力表: 検索語の自動分解(P:R列。非表示) ----
    step = "問題点入力表の検索語の分解"
    w2.Range("P2").Value = "正規化": w2.Range("P3").Value = "語1": w2.Range("P4").Value = "語2": w2.Range("P5").Value = "語3"
    w2.Range("Q2").Formula = "=TRIM(SUBSTITUTE(SUBSTITUTE($B$3,""　"","" ""),""区役所"",""区""))"
    w2.Range("Q3").Formula = "=IFERROR(LEFT(Q2,FIND("" "",Q2)-1),Q2)"
    w2.Range("R3").Formula = "=IFERROR(TRIM(MID(Q2,FIND("" "",Q2)+1,200)),"""")"
    w2.Range("Q4").Formula = "=IFERROR(LEFT(R3,FIND("" "",R3)-1),R3)"
    w2.Range("R4").Formula = "=IFERROR(TRIM(MID(R3,FIND("" "",R3)+1,200)),"""")"
    w2.Range("Q5").Formula = "=R4"
    w2.Columns("P:R").Hidden = True
    w2.Range("A3").Value = "対象局課名(空欄=全て)"

    ' ---- 入力シート U列(抽出・非表示) ----
    step = "入力シートの抽出列(U列)"
    w1.Range("U2:U2001").Formula = _
        "=IF(AND(B2<>"""",B2='復命用一覧'!$C$2," & _
        "OR('復命用一覧'!$L$3="""",ISNUMBER(SEARCH('復命用一覧'!$L$3,D2)))," & _
        "OR('復命用一覧'!$L$4="""",ISNUMBER(SEARCH('復命用一覧'!$L$4,D2)))," & _
        "OR('復命用一覧'!$L$5="""",ISNUMBER(SEARCH('復命用一覧'!$L$5,D2)))),1,0)"

    ' ---- 問題点入力表の集計 ----
    crit = "入力!$D$2:$D$2001,""*""&$Q$3&""*"",入力!$D$2:$D$2001,""*""&$Q$4&""*"",入力!$D$2:$D$2001,""*""&$Q$5&""*"""
    step = "入力件数計(E2)の更新"
    w2.Range("E2").Formula = "=SUMIFS(入力!$L$2:$L$2001,入力!$B$2:$B$2001,$B$2," & crit & ")"
    step = "グループ列の更新"
    w2.Range(w2.Cells(6, 7), w2.Cells(lastRow, keyCol - 1)).Formula = _
        "=IF(G$5="""","""",SUMIFS(入力!$L$2:$L$2001,入力!$T$2:$T$2001,$" & kl & "6,入力!$B$2:$B$2001,$B$2,入力!$E$2:$E$2001,G$5," & crit & "))"

    step = "再計算"
    Application.Calculation = xlCalculationAutomatic
    Application.Calculate

    MsgBox "直しました。対象局課名に「東区役所」「東区 建設」のように入力して試してください。" & vbCrLf & _
           "(復命用一覧の C3 と、問題点入力表の B3)", vbInformation
    Exit Sub

EH:
    MsgBox "「" & step & "」で止まりました。" & vbCrLf & "エラー: " & Err.Description, vbExclamation
End Sub
