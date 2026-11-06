Attribute VB_Name = "SheetRename"
Option Explicit

' 最初の「R?短期」シートのC1(令和N年度)に合わせて、4シートの名前を付け替える
'   R(N)短期 / R(N+1)短期 / R(N)掛金（短期） / R(N+1)掛金（短期）
' シート名を変えると、他シートの数式・印刷範囲は Excel が自動で追従する。
Public Sub RenameSheetsByC1()
    Dim ws As Worksheet, first As Worksheet
    Dim a As Long, n As Long, k As Long

    ' 名前が「R数字短期」のシートのうち、数字が最小のものを探す
    For Each ws In ThisWorkbook.Worksheets
        If ws.Name Like "R#*短期" Then
            k = Val(Mid$(ws.Name, 2))
            If first Is Nothing Then
                Set first = ws: a = k
            ElseIf k < a Then
                Set first = ws: a = k
            End If
        End If
    Next ws
    If first Is Nothing Then Exit Sub

    n = Val(Mid$(CStr(first.Range("C1").Value), 3))   ' 「令和9年度」→ 9
    If n < 2 Or n = a Then Exit Sub

    On Error GoTo Fin
    Application.EnableEvents = False
    If n > a Then          ' 増やす時は後ろのシートから先に変える(名前の重複を避ける)
        Ren "R" & (a + 1) & "短期", "R" & (n + 1) & "短期"
        Ren "R" & a & "短期", "R" & n & "短期"
        Ren "R" & (a + 1) & "掛金（短期）", "R" & (n + 1) & "掛金（短期）"
        Ren "R" & a & "掛金（短期）", "R" & n & "掛金（短期）"
    Else                   ' 減らす時は前のシートから先に変える
        Ren "R" & a & "短期", "R" & n & "短期"
        Ren "R" & (a + 1) & "短期", "R" & (n + 1) & "短期"
        Ren "R" & a & "掛金（短期）", "R" & n & "掛金（短期）"
        Ren "R" & (a + 1) & "掛金（短期）", "R" & (n + 1) & "掛金（短期）"
    End If
Fin:
    Application.EnableEvents = True
    If Err.Number <> 0 Then MsgBox "シート名の変更に失敗しました: " & Err.Description, vbExclamation
End Sub

Private Sub Ren(ByVal oldName As String, ByVal newName As String)
    ThisWorkbook.Worksheets(oldName).Name = newName
End Sub
