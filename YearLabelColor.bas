Attribute VB_Name = "YearLabelColor"
Option Explicit

' 後ろの「R数字長期」(または「R数字短期」)シート(R8長期)の23～44行目で、
' 年度(C1)から日本語の文言を作っている数式のセルを、黄色に着色する。
'   例) ="Ｒ"&($C$1-1)&".3退職実績人数×◆"
' 判定: その行範囲の数式のうち、数式の中に $C$1 を含むセル。ふつうの数式や文字だけのセルは変えない。
' 何度実行しても結果は同じ。実行時のポップアップは出さない(エラーのときだけ表示)。
Private Const ROW_FROM As Long = 23
Private Const ROW_TO As Long = 44

Public Sub ColorYearFormulasYellow()
    Dim s2 As Worksheet, area As Range, rng As Range, c As Range

    Set s2 = SecondSheet()
    If s2 Is Nothing Then
        MsgBox "「R数字長期」または「R数字短期」のシートが2枚見つかりません。", vbExclamation
        Exit Sub
    End If

    Set area = Intersect(s2.Rows(ROW_FROM & ":" & ROW_TO), s2.UsedRange)
    If area Is Nothing Then Exit Sub
    On Error Resume Next
    Set rng = area.SpecialCells(xlCellTypeFormulas)
    On Error GoTo 0
    If rng Is Nothing Then Exit Sub

    For Each c In rng.Cells
        If InStr(c.Formula, "$C$1") > 0 Then c.Interior.Color = RGB(255, 255, 0)
    Next c
End Sub

' 色を元に戻したいとき(対象セルを塗りつぶしなしにする)
Public Sub ClearYearFormulaColor()
    Dim s2 As Worksheet, area As Range, rng As Range, c As Range

    Set s2 = SecondSheet()
    If s2 Is Nothing Then Exit Sub
    Set area = Intersect(s2.Rows(ROW_FROM & ":" & ROW_TO), s2.UsedRange)
    If area Is Nothing Then Exit Sub
    On Error Resume Next
    Set rng = area.SpecialCells(xlCellTypeFormulas)
    On Error GoTo 0
    If rng Is Nothing Then Exit Sub

    For Each c In rng.Cells
        If InStr(c.Formula, "$C$1") > 0 Then c.Interior.Pattern = xlNone
    Next c
End Sub

' 後ろ(2枚目)の「R数字長期」、無ければ「R数字短期」のシートを返す(タブの並び順)
Private Function SecondSheet() As Worksheet
    Dim a As Worksheet, b As Worksheet
    GetPair "長期", a, b
    If b Is Nothing Then GetPair "短期", a, b
    Set SecondSheet = b
End Function

Private Sub GetPair(ByVal suffix As String, ByRef w1 As Worksheet, ByRef w2 As Worksheet)
    Dim ws As Worksheet
    Set w1 = Nothing: Set w2 = Nothing
    For Each ws In ThisWorkbook.Worksheets
        If ws.Name Like "R#*" & suffix Then
            If ws.Name = "R" & Val(Mid$(ws.Name, 2)) & suffix Then
                If w1 Is Nothing Then
                    Set w1 = ws
                ElseIf w2 Is Nothing Then
                    Set w2 = ws
                End If
            End If
        End If
    Next ws
End Sub
