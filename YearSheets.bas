Attribute VB_Name = "YearSheets"
Option Explicit

' C1の年度に合わせて、シート名を付け替えるだけのマクロ(ボタンに登録するマクロ名は ChangeYearSheets のまま)。
'   最初の「R数字長期」(または「R数字短期」)シートのC1の数字 N を読み、
'   前のシート=R(N)、後ろのシート=R(N+1) にする。掛金のシート(R数字長期掛金 / R数字掛金（短期）)も同じ。
' シート名を変えると、他シートの数式・印刷範囲は Excel が自動で追従する。
' 実行時の確認・完了のポップアップは出さない(エラーのときだけ表示する)。
Public Sub ChangeYearSheets()
    Dim s1 As Worksheet, s2 As Worksheet, k1 As Worksheet, k2 As Worksheet
    Dim sfx As String, ksfx As String, n As Long, plan As String

    If HasPair("長期") Then
        sfx = "長期": ksfx = "長期掛金"
    ElseIf HasPair("短期") Then
        sfx = "短期": ksfx = "掛金（短期）"
    Else
        MsgBox "「R数字長期」または「R数字短期」のシートが2枚見つかりません。", vbExclamation
        Exit Sub
    End If
    GetPair sfx, s1, s2
    GetPair ksfx, k1, k2

    n = YearOf(s1.Range("C1").Value)
    If n < 2 Then
        MsgBox s1.Name & "!C1 に年度の数字(例: 8)を入れてください。" & vbCrLf & "現在の値: " & CStr(s1.Range("C1").Text), vbExclamation
        Exit Sub
    End If

    plan = PlanLine(s1, "R" & n & sfx) & PlanLine(s2, "R" & (n + 1) & sfx) & _
           PlanLine(k1, "R" & n & ksfx) & PlanLine(k2, "R" & (n + 1) & ksfx)
    If Len(plan) = 0 Then Exit Sub                     ' すでに合っているときは何もしない
    If NameClash(s1, s2, k1, k2, n, sfx, ksfx) Then Exit Sub

    On Error GoTo Fail
    SetPair s1, s2, n, sfx
    SetPair k1, k2, n, ksfx
    Exit Sub
Fail:
    MsgBox "シート名の変更に失敗しました: " & Err.Description & vbCrLf & _
           "一部だけ変わっている場合は、シート名を確認してから、もう一度実行してください。", vbExclamation
End Sub

' 変更があるときだけ「旧名 → 新名」の1行を返す
Private Function PlanLine(ByVal ws As Worksheet, ByVal newName As String) As String
    If ws Is Nothing Then Exit Function
    If ws.Name <> newName Then PlanLine = "  " & ws.Name & "  →  " & newName & vbCrLf
End Function

' 新しい名前が、4シート以外の既存シートと重なるか
Private Function NameClash(ByVal s1 As Worksheet, ByVal s2 As Worksheet, ByVal k1 As Worksheet, ByVal k2 As Worksheet, _
                           ByVal n As Long, ByVal sfx As String, ByVal ksfx As String) As Boolean
    Dim nm As Variant, ws As Worksheet, own As Boolean
    For Each nm In Array("R" & n & sfx, "R" & (n + 1) & sfx, "R" & n & ksfx, "R" & (n + 1) & ksfx)
        For Each ws In ThisWorkbook.Worksheets
            If ws.Name = CStr(nm) Then
                own = (SameSheet(ws, s1) Or SameSheet(ws, s2) Or SameSheet(ws, k1) Or SameSheet(ws, k2))
                If Not own Then
                    MsgBox "「" & nm & "」という名前のシートが、対象の4シート以外に既にあります。" & vbCrLf & "名前を変えてから、もう一度実行してください。", vbExclamation
                    NameClash = True
                    Exit Function
                End If
            End If
        Next ws
    Next nm
End Function

Private Function SameSheet(ByVal a As Worksheet, ByVal b As Worksheet) As Boolean
    If b Is Nothing Then Exit Function
    SameSheet = (a.Name = b.Name)
End Function

' 一度仮名にしてから付け替える(名前の重複を避けるため)
Private Sub SetPair(ByVal w1 As Worksheet, ByVal w2 As Worksheet, ByVal n As Long, ByVal suffix As String)
    If w1 Is Nothing Then Exit Sub
    w1.Name = "tmp_a"
    If Not w2 Is Nothing Then w2.Name = "tmp_b"
    w1.Name = "R" & n & suffix
    If Not w2 Is Nothing Then w2.Name = "R" & (n + 1) & suffix
End Sub

' 「令和７年度」「令和7年度」または数字 → 年度の数字(読めなければ0)
Private Function YearOf(ByVal v As Variant) As Long
    Dim t As String
    If IsError(v) Then Exit Function
    If IsEmpty(v) Then Exit Function
    If VarType(v) = vbString Then
        t = CStr(v)
        If t Like "令和*年度" Then
            t = Mid$(t, 3, Len(t) - 4)
            On Error Resume Next
            t = StrConv(t, vbNarrow)
            On Error GoTo 0
            If IsNumeric(t) Then YearOf = CLng(t)
        End If
    ElseIf IsNumeric(v) Then
        YearOf = CLng(v)
    End If
End Function

' 「R数字＋suffix」のシートが2枚あるか
Private Function HasPair(ByVal suffix As String) As Boolean
    Dim a As Worksheet, b As Worksheet
    GetPair suffix, a, b
    HasPair = Not (a Is Nothing Or b Is Nothing)
End Function

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
