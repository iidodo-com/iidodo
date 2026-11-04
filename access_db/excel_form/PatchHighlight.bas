Attribute VB_Name = "PatchHighlight"
Option Explicit

' 問題点入力表: 「0より大きい」の黄色い塗りを、数値のセルだけに直す(空欄の予備列が黄色になる不具合の修正)
Public Sub PatchHighlight()
    Dim ws As Worksheet, lastRow As Long, c As Long, keyCol As Long, rng As Range
    On Error GoTo EH
    Set ws = ThisWorkbook.Worksheets("問題点入力表")
    For c = 1 To 40
        If Trim(ws.Cells(5, c).Value) = "キー" Then keyCol = c: Exit For
    Next
    If keyCol = 0 Then MsgBox "5行目に「キー」の見出しが見つかりません。", vbExclamation: Exit Sub
    lastRow = ws.Cells(ws.Rows.Count, keyCol).End(xlUp).Row

    Set rng = ws.Range(ws.Cells(6, 6), ws.Cells(lastRow, keyCol - 1))   ' F列～グループ列の最後
    rng.FormatConditions.Delete
    With rng.FormatConditions.Add(Type:=xlExpression, Formula1:="=AND(ISNUMBER(F6),F6>0)")
        .Interior.Color = RGB(255, 230, 153)
    End With
    MsgBox "直しました。", vbInformation
    Exit Sub
EH:
    MsgBox "直せませんでした: " & Err.Description, vbExclamation
End Sub
