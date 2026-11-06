Attribute VB_Name = "SheetRename"
Option Explicit

' 「R?短期」の前のほうのシートのC1(年度の数字 N)から N を取り、4シートの名前を付け替える
'   短期系 : 前のシート → R(N)短期      後ろのシート → R(N+1)短期
'   掛金系 : 前のシート → R(N)掛金（短期）後ろのシート → R(N+1)掛金（短期）
' 「前・後ろ」はタブの並び順で決める(今の番号は見ない)。
' シート名を変えると、他シートの数式・印刷範囲は Excel が自動で追従する。
Public Sub RenameSheetsByC1()
    Dim s1 As Worksheet, s2 As Worksheet, k1 As Worksheet, k2 As Worksheet
    Dim n As Long, ev As Boolean

    GetPair "短期", s1, s2
    GetPair "掛金（短期）", k1, k2
    If s1 Is Nothing Then
        MsgBox "「R数字短期」という名前のシートが見つかりません。", vbExclamation
        Exit Sub
    End If

    If Not IsNumeric(s1.Range("C1").Value) Or IsEmpty(s1.Range("C1").Value) Then
        MsgBox "C1が数字ではありません(例: 8)。", vbExclamation
        Exit Sub
    End If
    n = CLng(s1.Range("C1").Value)                    ' C1の数字(表示は「令和8年度」)
    If n < 2 Then
        MsgBox "C1の数字が小さすぎます: " & n, vbExclamation
        Exit Sub
    End If

    ev = Application.EnableEvents
    Application.EnableEvents = False
    On Error GoTo Fail
    SetPair s1, s2, n, "短期"
    SetPair k1, k2, n, "掛金（短期）"
    Application.EnableEvents = ev
    Exit Sub
Fail:
    Application.EnableEvents = ev
    MsgBox "シート名の変更に失敗しました: " & Err.Description & vbCrLf & _
           "同じ名前の別シートが既にないか確認してください。", vbExclamation
End Sub

' 名前が「R数字＋suffix」のシートを、タブの並び順で最初の2枚だけ返す
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

' 一度仮名にしてから付け替える(名前の重複を避けるため)
Private Sub SetPair(ByVal w1 As Worksheet, ByVal w2 As Worksheet, ByVal n As Long, ByVal suffix As String)
    If w1 Is Nothing Then Exit Sub
    w1.Name = "tmp_a"
    If Not w2 Is Nothing Then w2.Name = "tmp_b"
    w1.Name = "R" & n & suffix
    If Not w2 Is Nothing Then w2.Name = "R" & (n + 1) & suffix
End Sub
