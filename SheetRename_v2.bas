Attribute VB_Name = "SheetRename"
Option Explicit

' C1の年度に合わせて、シート名を付け替える(ポップアップなし。エラーのときだけ表示)。
'   最初の「R数字短期」(無ければ「R数字長期」)の前のシートのC1の数字 N を読み、
'   各系統の「前のシート=R(N)、後ろのシート=R(N+1)」に付け替える。系統は次のとおり。
'     短期系  : R数字短期 / R数字掛金（短期）
'     こども  : R数字掛金（子ども）
'     介護系  : R数字介護 / R数字掛金（介護）
'     長期系  : R数字長期 / R数字長期掛金
'   「前・後ろ」はタブの並び順で決める(今の番号は見ない)。非表示のシート(古いR5介護など)は対象外。
' シート名を変えると、他シートの数式・印刷範囲は Excel が自動で追従する。
' シート保護(パスワードなし・ブック構造の保護なし)をかけていても、名前の付け替えはできる。
'
' ボタンに登録するマクロ名は RenameSheetsByC1 のまま(ChangeYearSheets でも同じ動作)。
Public Sub RenameSheetsByC1()
    Dim sfxs As Variant, sfx As Variant
    Dim base1 As Worksheet, base2 As Worksheet, w1 As Worksheet, w2 As Worksheet
    Dim n As Long, ev As Boolean

    GetPair "短期", base1, base2
    If base1 Is Nothing Then GetPair "長期", base1, base2
    If base1 Is Nothing Then
        MsgBox "「R数字短期」または「R数字長期」のシートが見つかりません。", vbExclamation
        Exit Sub
    End If
    If IsEmpty(base1.Range("C1").Value) Or Not IsNumeric(base1.Range("C1").Value) Then
        MsgBox base1.Name & "!C1 に年度の数字(例: 8)を入れてください。", vbExclamation
        Exit Sub
    End If
    n = CLng(base1.Range("C1").Value)                 ' C1の数字(表示は「令和8年度」)
    If n < 2 Then
        MsgBox "C1の数字が小さすぎます: " & n, vbExclamation
        Exit Sub
    End If

    ev = Application.EnableEvents
    Application.EnableEvents = False
    On Error GoTo Fail
    sfxs = Array("短期", "掛金（短期）", "掛金（子ども）", "介護", "掛金（介護）", "長期", "長期掛金")
    For Each sfx In sfxs
        GetPair CStr(sfx), w1, w2
        SetPair w1, w2, n, CStr(sfx)
    Next sfx
    Application.EnableEvents = ev
    Exit Sub
Fail:
    Application.EnableEvents = ev
    MsgBox "シート名の変更に失敗しました: " & Err.Description & vbCrLf & _
           "同じ名前の別シートが既にないか確認してください。", vbExclamation
End Sub

Public Sub ChangeYearSheets()
    RenameSheetsByC1
End Sub

' 名前が「R数字＋suffix」の表示中のシートを、タブの並び順で最初の2枚だけ返す
Private Sub GetPair(ByVal suffix As String, ByRef w1 As Worksheet, ByRef w2 As Worksheet)
    Dim ws As Worksheet
    Set w1 = Nothing: Set w2 = Nothing
    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = xlSheetVisible Then
            If ws.Name Like "R#*" & suffix Then
                If ws.Name = "R" & Val(Mid$(ws.Name, 2)) & suffix Then
                    If w1 Is Nothing Then
                        Set w1 = ws
                    ElseIf w2 Is Nothing Then
                        Set w2 = ws
                    End If
                End If
            End If
        End If
    Next ws
End Sub

' 一度仮名にしてから付け替える(名前の重複を避けるため)。すでに合っていれば何もしない
Private Sub SetPair(ByVal w1 As Worksheet, ByVal w2 As Worksheet, ByVal n As Long, ByVal suffix As String)
    If w1 Is Nothing Then Exit Sub
    If w1.Name = "R" & n & suffix Then
        If w2 Is Nothing Then Exit Sub
        If w2.Name = "R" & (n + 1) & suffix Then Exit Sub
    End If
    w1.Name = "tmp_a"
    If Not w2 Is Nothing Then w2.Name = "tmp_b"
    w1.Name = "R" & n & suffix
    If Not w2 Is Nothing Then w2.Name = "R" & (n + 1) & suffix
End Sub
