Attribute VB_Name = "ApplyDbPatch"
Option Explicit

' DB_集計の年度表示(赤字の「R8短期」「R8.4」など)を、後ろの短期シートのC1から自動で出す。
' あわせて、後ろの短期シートのH28(V28)に、年度と平均標準報酬額(DB_集計から)を入れる。
' 先に ApplyYearPatch を実行して、C1が数字(表示:令和N年度)になっていること。
' 何度実行しても結果は同じ(上書き)。実行前に必ずブックを別名で保存しておくこと。
'
'   DB_集計: 文字だけのセルのうち「R○短期」「R○.4」を含むものを数式に置き換える
'            「R○短期」   → "R"&(s2のC1)&"短期"
'            「R○.4」     → "R"&(s2のC1-1)&".4"
'   s2!H28 : ="病院予定数×R"&(C1-1)&".4採用平均標準報酬【"&DB_集計!F7&"円】"
'   s2!V28 : ="人事課予定数×R"&(C1-1)&".4採用平均標準報酬【"&TEXT(DB_集計!F13,"#,##0")&"円】"
' ※数式になったセルは、文字の一部だけ赤くする書式は使えなくなる(セル全体の書式になる)

Public Sub ApplyDbPatch()
    Dim s1 As Worksheet, s2 As Worksheet, db As Worksheet
    Dim rng As Range, c As Range, f As String
    Dim nDone As Long, log As String, calcMode As Long

    GetPair "短期", s1, s2
    If s2 Is Nothing Then
        MsgBox "「R数字短期」のシートが2枚見つかりません。", vbExclamation
        Exit Sub
    End If
    If Not SheetExists("DB_集計") Then
        MsgBox "DB_集計 シートがありません。", vbExclamation
        Exit Sub
    End If
    Set db = ThisWorkbook.Worksheets("DB_集計")

    If IsEmpty(s2.Range("C1").Value) Or Not IsNumeric(s2.Range("C1").Value) Then
        MsgBox s2.Name & "!C1 が数字ではありません。先に ApplyYearPatch を実行してください。", vbExclamation
        Exit Sub
    End If

    If MsgBox("DB_集計の年度表示を、" & s2.Name & " のC1から出す数式にします。" & vbCrLf & _
              "あわせて " & s2.Name & " のH28、V28も数式にします。" & vbCrLf & _
              "実行前にブックを別名保存しましたか？", vbOKCancel + vbQuestion, "DB年度パッチ") <> vbOK Then Exit Sub

    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fail

    ' ---- DB_集計の年度ラベル(文字だけのセル)
    On Error Resume Next
    Set rng = db.Range("A1:G40").SpecialCells(xlCellTypeConstants, xlTextValues)
    On Error GoTo Fail
    If Not rng Is Nothing Then
        For Each c In rng.Cells
            f = LabelFormula(CStr(c.Value), s2.Name)
            If Len(f) > 0 Then
                c.Formula = f
                nDone = nDone + 1
                log = log & "  " & c.Address(False, False) & vbCrLf
            End If
        Next c
    End If

    ' ---- H28 / V28
    s2.Range("H28").Formula = Fm("=`病院予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&DB_集計!F7&`円】`")
    s2.Range("V28").Formula = Fm("=`人事課予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&TEXT(DB_集計!F13,`#,##0`)&`円】`")

Fail:
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description, vbExclamation
    Else
        Application.Calculate
        MsgBox "完了しました。" & vbCrLf & _
               "DB_集計の数式化: " & nDone & " セル" & vbCrLf & log & _
               s2.Name & "!H28, V28 を数式化", vbInformation, "DB年度パッチ"
    End If
End Sub

' 「R○短期」「R○.4」を含む文字を、C1から年度を出す数式に直す。含まなければ空文字
Private Function LabelFormula(ByVal txt As String, ByVal s2name As String) As String
    Dim re As Object, ms As Object, m As Object
    Dim pos As Long, out As String, expr As String
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "R\d+(短期|\.4)"
    re.Global = True
    Set ms = re.Execute(txt)
    If ms.Count = 0 Then Exit Function

    pos = 0
    For Each m In ms
        If m.FirstIndex > pos Then out = out & Lit(Mid$(txt, pos + 1, m.FirstIndex - pos)) & "&"
        If m.SubMatches(0) = "短期" Then
            expr = """R""&'" & s2name & "'!$C$1&""短期"""
        Else
            expr = """R""&('" & s2name & "'!$C$1-1)&"".4"""
        End If
        out = out & expr & "&"
        pos = m.FirstIndex + m.Length
    Next m
    If pos < Len(txt) Then
        out = out & Lit(Mid$(txt, pos + 1))
    Else
        out = Left$(out, Len(out) - 1)
    End If
    LabelFormula = "=" & out
End Function

' 文字を数式用の "…" にする(中の " は "" にする)
Private Function Lit(ByVal s As String) As String
    Lit = """" & Replace(s, """", """""") & """"
End Function

' `(バッククォート)を " に直す(式を読みやすく書くため)
Private Function Fm(ByVal s As String) As String
    Fm = Replace(s, "`", Chr(34))
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

Private Function SheetExists(ByVal nm As String) As Boolean
    Dim s As Object
    For Each s In ThisWorkbook.Sheets
        If s.Name = nm Then SheetExists = True: Exit Function
    Next s
End Function
