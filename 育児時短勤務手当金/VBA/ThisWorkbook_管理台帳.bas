Attribute VB_Name = "ThisWorkbook"
' 開いたときに、対応が必要な件数を知らせる
Private Sub Workbook_Open()
    Dim w As Worksheet, n As Long, m As Long, k As Long, j As Long, h As Long, s As String
    Application.Calculate
    Set w = Worksheets("請求記録")
    n = Application.WorksheetFunction.CountIf(w.Range("AD6:AD3005"), "保留中")
    m = Application.WorksheetFunction.CountIf(w.Range("AI6:AI3005"), ">" & Worksheets("設定").Range("C7").Value)
    k = Application.WorksheetFunction.CountIf(w.Range("AD6:AD3005"), "未処理")
    j = Application.WorksheetFunction.CountIf(w.Range("AD6:AD3005"), "要確認")
    h = Application.WorksheetFunction.CountIf(Worksheets("職員マスタ").Range("P6:P405"), "保留中")
    If n + k + j + h = 0 Then Exit Sub
    s = "保留中の請求：" & n & " 件（うち " & Worksheets("設定").Range("C7").Value & " 日超：" & m & " 件）" & vbLf & _
        "保留中の職員（請求前）：" & h & " 人" & vbLf & _
        "未処理（支給月が未入力）：" & k & " 件" & vbLf & _
        "要確認（標準報酬月額が不明など）：" & j & " 件"
    MsgBox s, vbInformation, "管理台帳：対応が必要な件数"
End Sub
