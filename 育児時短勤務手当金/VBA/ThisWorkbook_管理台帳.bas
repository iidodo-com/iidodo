Attribute VB_Name = "ThisWorkbook"
' 「不支給通知」シートの「作成」欄に○を入れると、請求記録にも反映する
Private Sub Workbook_SheetChange(ByVal Sh As Object, ByVal Target As Range)
    Dim rg As Range, c As Range, r As Variant
    If Sh.Name <> "不支給通知" Then Exit Sub
    Set rg = Intersect(Target, Sh.Range("K7:K306"))
    If rg Is Nothing Then Exit Sub
    Application.EnableEvents = False
    For Each c In rg.Cells
        r = Sh.Cells(c.Row, "B").Value
        If IsNumeric(r) And r <> "" Then
            If Trim(CStr(c.Value)) <> "" Then
                ThisWorkbook.Worksheets("請求記録").Cells(r, "AT").Value = "○"
            Else
                ThisWorkbook.Worksheets("請求記録").Cells(r, "AT").ClearContents
            End If
        End If
        c.Formula = "=IF($L" & c.Row & "="""","""",IF(INDEX(請求記録!$AT$6:$AT$3005,$L" & c.Row & ")="""","""",INDEX(請求記録!$AT$6:$AT$3005,$L" & c.Row & ")))"
    Next c
    Application.EnableEvents = True
End Sub
