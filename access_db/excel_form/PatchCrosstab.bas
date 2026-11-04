Attribute VB_Name = "PatchCrosstab"
Option Explicit

' 問題点入力表の「対象局課名」を「空欄=全て／一部の文字でも検索可」に直す(何度実行しても安全)
Public Sub PatchCrosstab()
    Dim ws As Worksheet, wi As Worksheet
    Dim c As Long, keyCol As Long, lastRow As Long, kl As String, step As String

    On Error GoTo EH

    step = "シートの確認"
    Set ws = ThisWorkbook.Worksheets("問題点入力表")
    Set wi = ThisWorkbook.Worksheets("入力")

    step = "入力シートの列の確認"
    If Trim(wi.Range("D1").Value) <> "対象局課名" Or Trim(wi.Range("E1").Value) <> "グループ" _
       Or Left(wi.Range("L1").Value, 2) <> "件数" Or Left(wi.Range("T1").Value, 2) <> "キー" Then
        MsgBox "入力シートの列の並びが想定と違います(D=対象局課名, E=グループ, L=件数, T=キー)。" & vbCrLf & _
               "列を入れ替えている場合は、作成者に連絡してください。", vbExclamation
        Exit Sub
    End If

    step = "キー列の検索"
    For c = 1 To 40
        If Trim(ws.Cells(5, c).Value) = "キー" Then keyCol = c: Exit For
    Next
    If keyCol = 0 Then
        MsgBox "問題点入力表の5行目に「キー」の見出しが見つかりません。", vbExclamation
        Exit Sub
    End If
    kl = Split(ws.Cells(1, keyCol).Address(True, False), "$")(0)
    lastRow = ws.Cells(ws.Rows.Count, keyCol).End(xlUp).Row

    step = "入力件数計(E2)の更新"
    ws.Range("E2").Formula = _
        "=SUMIFS(入力!$L$2:$L$2001,入力!$B$2:$B$2001,$B$2,入力!$D$2:$D$2001,""*""&$B$3&""*"")"

    step = "グループ列(G～" & kl & "の手前)の更新"
    ws.Range(ws.Cells(6, 7), ws.Cells(lastRow, keyCol - 1)).Formula = _
        "=IF(G$5="""","""",SUMIFS(入力!$L$2:$L$2001,入力!$T$2:$T$2001,$" & kl & "6,入力!$B$2:$B$2001,$B$2,入力!$E$2:$E$2001,G$5,入力!$D$2:$D$2001,""*""&$B$3&""*""))"

    step = "見出しの更新"
    ws.Range("A3").Value = "対象局課名(空欄=全て)"

    step = "再計算"
    Application.Calculation = xlCalculationAutomatic
    Application.Calculate

    MsgBox "直しました(" & (lastRow - 5) & " 行)。B3 を空欄にすると全件、文字を入れると一部が合う局課だけを集計します。", vbInformation
    Exit Sub

EH:
    MsgBox "「" & step & "」で止まりました。" & vbCrLf & "エラー: " & Err.Description, vbExclamation
End Sub
