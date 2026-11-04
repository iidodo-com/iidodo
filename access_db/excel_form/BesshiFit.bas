Attribute VB_Name = "BesshiFit"
Option Explicit

' 別紙(復命用)シートの行を整える。
'  ・データのある行と合計行だけを表示し、空き行は隠す
'  ・行の高さを、原本の規則(内容の行数に応じて 28/30/40/55/65/77)に揃える
' 絞り込み(復命用一覧の C2/C3)を変えたあとに実行する。
Public Sub FitBesshiRows()
    Const SHEET_NAME As String = "別紙(復命用)"
    Const FIRST_ROW As Long = 9
    Const LAST_ROW As Long = 158
    Dim ws As Worksheet, r As Long, h As Double, steps As Variant, i As Long, hasData As Boolean, isTotal As Boolean

    On Error GoTo EH
    Set ws = ThisWorkbook.Worksheets(SHEET_NAME)
    steps = Array(28, 30, 40, 55, 65, 77)
    Application.ScreenUpdating = False

    For r = FIRST_ROW To LAST_ROW
        hasData = (CStr(ws.Cells(r, 1).Value) <> "")
        isTotal = (Not hasData) And (CStr(ws.Cells(r, 9).Value) <> "")
        If hasData Or isTotal Then
            ws.Rows(r).Hidden = False
            ws.Rows(r).AutoFit
            h = ws.Rows(r).RowHeight
            If isTotal Then
                ws.Rows(r).RowHeight = 22.5
            Else
                For i = 0 To UBound(steps)
                    If h <= steps(i) Then ws.Rows(r).RowHeight = steps(i): Exit For
                Next
            End If
        Else
            ws.Rows(r).Hidden = True
        End If
    Next
    Application.ScreenUpdating = True
    MsgBox "別紙の行を整えました。", vbInformation
    Exit Sub
EH:
    Application.ScreenUpdating = True
    MsgBox "整えられませんでした: " & Err.Description, vbExclamation
End Sub
