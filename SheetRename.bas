Attribute VB_Name = "SheetRename"
Option Explicit

' 最初の「R?短期」シートのC1(令和N年度)に合わせて、シート名を付け替える
'   短期系  : R(N)短期 / R(N+1)短期
'   掛金系  : R(N)掛金（短期） / R(N+1)掛金（短期）
' 2系統を別々に処理するので、番号がずれていても動く。
' シート名を変えると、他シートの数式・印刷範囲は Excel が自動で追従する。
Public Sub RenameSheetsByC1()
    Dim base As Worksheet, a As Long, n As Long
    Set base = FindLowest("短期", a)
    If base Is Nothing Then
        MsgBox "「R数字短期」という名前のシートが見つかりません。", vbExclamation
        Exit Sub
    End If
    n = Val(Mid$(CStr(base.Range("C1").Value), 3))   ' 「令和9年度」→ 9
    If n < 2 Then
        MsgBox "C1が「令和N年度」の形式ではありません: " & CStr(base.Range("C1").Value), vbExclamation
        Exit Sub
    End If

    Dim ev As Boolean: ev = Application.EnableEvents
    Application.EnableEvents = False
    RenameFamily "短期", n
    RenameFamily "掛金（短期）", n
    Application.EnableEvents = ev
End Sub

' 名前が「R数字＋suffix」のシートのうち、数字が最小のものを返す
Private Function FindLowest(ByVal suffix As String, ByRef num As Long) As Worksheet
    Dim ws As Worksheet, k As Long
    For Each ws In ThisWorkbook.Worksheets
        If ws.Name Like "R#*" & suffix Then
            k = Val(Mid$(ws.Name, 2))
            If ws.Name = "R" & k & suffix Then
                If FindLowest Is Nothing Then
                    Set FindLowest = ws: num = k
                ElseIf k < num Then
                    Set FindLowest = ws: num = k
                End If
            End If
        End If
    Next ws
End Function

Private Sub RenameFamily(ByVal suffix As String, ByVal n As Long)
    Dim w1 As Worksheet, w2 As Worksheet, a As Long
    Set w1 = FindLowest(suffix, a)
    If w1 Is Nothing Then
        MsgBox "「R数字" & suffix & "」のシートが見つからないため、この系統は変更しません。", vbExclamation
        Exit Sub
    End If
    If a = n Then Exit Sub
    On Error Resume Next
    Set w2 = ThisWorkbook.Worksheets("R" & (a + 1) & suffix)
    On Error GoTo 0

    On Error GoTo Fail
    If n > a Then            ' 増やす時は後ろのシートから先(名前の重複を避ける)
        If Not w2 Is Nothing Then w2.Name = "R" & (n + 1) & suffix
        w1.Name = "R" & n & suffix
    Else                     ' 減らす時は前のシートから先
        w1.Name = "R" & n & suffix
        If Not w2 Is Nothing Then w2.Name = "R" & (n + 1) & suffix
    End If
    Exit Sub
Fail:
    MsgBox "「" & suffix & "」系のシート名変更に失敗しました: " & Err.Description & vbCrLf & _
           "同じ名前のシートが既にないか確認してください。", vbExclamation
End Sub
