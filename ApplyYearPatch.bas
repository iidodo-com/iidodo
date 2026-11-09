Attribute VB_Name = "ApplyYearPatch"
Option Explicit

' 年度まわりのパッチ。ブックを作り直さず、今開いているブックの数式だけを書き換える。
' 何度実行しても結果は同じ(上書き)。実行前に必ずブックを別名で保存しておくこと(マクロの結果は元に戻せない)。
'
' 対象シート(名前ではなく「タブの並び順」で決める)
'   短期系 : 「R数字短期」の前のシート=s1、後ろのシート=s2
'   掛金系 : 「R数字掛金（短期）」の前のシート=k1、後ろのシート=k2(紫タブ)
'
' 内容
'   1. s1のC1を数字にして、表示形式を「"令和"0"年度"」にする(「令和7年度」→ 7)
'   2. s2のC1 = s1のC1 + 1(同じ表示形式)
'   3. s2のZ5,Z6,Z11,Z12 = s1の同じセル(賞与支給率)
'   4. s2のE20,H25,H27,H28,Q27,V28 を、C1の年度から文言を作る数式にする
'   5. 「=C1」と参照している数式(s1,s2内)を ="令和"&C1&"年度" にする
'   6. k1,k2のA1(「R8年度」など)を s1のC1 から自動で出し、k2のP123 をその年度から作る日付にする
Private Const FMT As String = """令和""0""年度"""

Public Sub ApplyYearPatch()
    Dim s1 As Worksheet, s2 As Worksheet, k1 As Worksheet, k2 As Worksheet
    Dim v As Variant, n As Long, log As String, r As Variant
    Dim calcMode As Long

    GetPair "短期", s1, s2
    GetPair "掛金（短期）", k1, k2
    If s1 Is Nothing Or s2 Is Nothing Then
        MsgBox "「R数字短期」のシートが2枚見つかりません。", vbExclamation
        Exit Sub
    End If

    If MsgBox("次のシートにパッチを当てます。実行前にブックを別名保存しましたか？" & vbCrLf & vbCrLf & _
              "前のシート(年度の元): " & s1.Name & vbCrLf & _
              "後ろのシート(+1年): " & s2.Name & vbCrLf & _
              "掛金(前/後ろ): " & NameOf(k1) & " / " & NameOf(k2), _
              vbOKCancel + vbQuestion, "年度パッチ") <> vbOK Then Exit Sub

    ' ---- 1. s1!C1 を数字にする
    v = s1.Range("C1").Value
    If VarType(v) = vbString Then
        If v Like "令和*年度" Then n = Val(Mid$(v, 3))
    ElseIf IsNumeric(v) And Not IsEmpty(v) Then
        n = CLng(v)
    End If
    If n < 2 Then
        MsgBox s1.Name & "!C1 から年度の数字を読み取れません(「令和7年度」または数字が必要): " & CStr(v), vbExclamation
        Exit Sub
    End If

    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fail

    s1.Range("C1").Value = n
    s1.Range("C1").NumberFormat = FMT
    log = log & "1. " & s1.Name & "!C1 = " & n & "(表示:令和" & n & "年度)" & vbCrLf

    ' ---- 2. s2!C1
    s2.Range("C1").Formula = "='" & s1.Name & "'!C1+1"
    s2.Range("C1").NumberFormat = FMT
    log = log & "2. " & s2.Name & "!C1 = " & s1.Name & "!C1+1" & vbCrLf

    ' ---- 3. 賞与支給率
    For Each r In Array("Z5", "Z6", "Z11", "Z12")
        s2.Range(CStr(r)).Formula = "='" & s1.Name & "'!" & r
    Next r
    log = log & "3. " & s2.Name & "!Z5,Z6,Z11,Z12 を " & s1.Name & " にリンク" & vbCrLf

    ' ---- 4. 文言の6セル
    s2.Range("E20").Formula = Fm("=`R`&($C$1-1)&`.3月：`&TEXT('" & s1.Name & "'!C16,`#,##0`)&`人→Ｒ`&$C$1&`.3月：`&TEXT(C16,`#,##0`)&`人→`&TEXT(D20,`+#,##0;-#,##0;0`)&`人。`")
    s2.Range("H25").Formula = Fm("=`R`&$C$1&`.3平均標準報酬月額◆`")
    s2.Range("H27").Formula = Fm("=`R`&($C$1-1)&`.3退職実績人数・標準報酬`")
    s2.Range("Q27").Formula = Fm("=`R`&($C$1-1)&`.4実績`")
    If SheetExists("DB_集計") Then
        s2.Range("H28").Formula = Fm("=`病院予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&DB_集計!F7&`円】`")
        s2.Range("V28").Formula = Fm("=`人事課予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&TEXT(DB_集計!F13,`#,##0`)&`円】`")
        log = log & "4. " & s2.Name & "!E20,H25,H27,H28,Q27,V28 を数式化" & vbCrLf
    Else
        log = log & "4. DB_集計 が無いため H28,V28 は未変更(他の4セルは数式化)" & vbCrLf
    End If

    ' ---- 5. 「=C1」参照
    Dim nRef As Long
    nRef = FixC1Refs(s1, "C1") + FixC1Refs(s2, "C1")
    log = log & "5. 「=C1」を ""令和""&C1&""年度"" に変更: " & nRef & " セル" & vbCrLf

    ' ---- 6. 掛金シートの年度(A1)と、紫タブの日付
    If Not k1 Is Nothing Then
        k1.Range("A1").Formula = "=""R""&'" & s1.Name & "'!C1&""年度"""
        log = log & "6. " & k1.Name & "!A1 = R(" & s1.Name & "のC1)年度" & vbCrLf
    End If
    If Not k2 Is Nothing Then
        k2.Range("A1").Formula = "=""R""&('" & s1.Name & "'!C1+1)&""年度"""
        k2.Range("P123").Formula = "=DATE(2018+VALUE(MID(A1,2,LEN(A1)-3)),6,30)"
        log = log & "   " & k2.Name & "!A1 = R(" & s1.Name & "のC1+1)年度、P123 をA1の年度から作る日付に変更" & vbCrLf
    End If

Fail:
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description & vbCrLf & vbCrLf & "ここまでの内容:" & vbCrLf & log, vbExclamation
    Else
        Application.Calculate
        MsgBox "完了しました。" & vbCrLf & vbCrLf & log, vbInformation, "年度パッチ"
    End If
End Sub

' `(バッククォート)を " に直す(式を読みやすく書くため)
Private Function NameOf(ByVal ws As Worksheet) As String
    If ws Is Nothing Then NameOf = "(なし)" Else NameOf = ws.Name
End Function

Private Function Fm(ByVal s As String) As String
    Fm = Replace(s, "`", Chr(34))
End Function

' 数式が「=C1」または「=$C$1」のセルを ="令和"&C1&"年度" に直す。直した数を返す
Private Function FixC1Refs(ByVal ws As Worksheet, ByVal skipAddr As String) As Long
    Dim rng As Range, c As Range, f As String
    On Error Resume Next
    Set rng = ws.UsedRange.SpecialCells(xlCellTypeFormulas)
    On Error GoTo 0
    If rng Is Nothing Then Exit Function
    For Each c In rng.Cells
        If c.Address(False, False) <> skipAddr Then
            f = c.Formula
            If f = "=C1" Or f = "=$C$1" Then
                c.Formula = Fm("=`令和`&C1&`年度`")
                FixC1Refs = FixC1Refs + 1
            End If
        End If
    Next c
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
