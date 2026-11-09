Attribute VB_Name = "mod概況転記"
Option Explicit

' ============================================================
'  01 R8概況（総括）用  標準報酬等の自動転記マクロ
'   標準報酬等を転記 ... 短期の標準報酬資料（Book5＝当年度、Book6＝翌年度）を
'                         2つ選ぶと、「2.3ｶﾒラ」「4ｶﾒラ」のF列（当年度末見込）・
'                         G列（翌年度末推計）へ転記します。
'  対象：組合員数・標準報酬月額（3月）・標準期末手当等（短期）
'  ※長期（一般組合員・継続長期など）、後期高齢者等短期、被扶養者数は資料にないため対象外です。
'    短期組合員（5行・30行）は、同じ列の後期高齢者等短期組合員（8行・40行）の現在値を除いて転記します。
'  ※転記の履歴（旧値・新値）はシート「転記ログ」に残します。
' ============================================================

Private Const SH_K As String = "2.3ｶﾒラ"
Private Const SH_M As String = "4ｶﾒラ"
Private Const SH_LOG As String = "転記ログ"

Private mLog As Worksheet
Private mLogRow As Long
Private mCount As Long

Public Sub 標準報酬等を転記()
    Dim fd As FileDialog
    Dim fn1 As String, fn2 As String
    Dim wb1 As Workbook, wb2 As Workbook
    Dim open1 As Boolean, open2 As Boolean
    Dim ws1 As Worksheet, ws2 As Worksheet, wsK As Worksheet, wsM As Worksheet
    Dim y1 As Long, y2 As Long, yF As Long, yG As Long
    Dim msg As String
    Dim tmp As Worksheet

    mCount = 0
    Set wsK = SheetOf(ThisWorkbook, SH_K)
    Set wsM = SheetOf(ThisWorkbook, SH_M)
    If wsK Is Nothing Or wsM Is Nothing Then
        MsgBox "「" & SH_K & "」「" & SH_M & "」のシートが見つかりません。", vbExclamation
        Exit Sub
    End If

    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    With fd
        .Title = "短期の標準報酬資料を2つ選んでください（Ctrlキーを押しながらクリック：当年度分と翌年度分）"
        .AllowMultiSelect = True
        .Filters.Clear
        .Filters.Add "Excelブック", "*.xlsx;*.xlsm;*.xls;*.xlsb"
        If .Show <> -1 Then Exit Sub
        If .SelectedItems.Count <> 2 Then
            MsgBox "ブックを2つ選んでください（当年度分と翌年度分）。", vbExclamation
            Exit Sub
        End If
        fn1 = .SelectedItems(1)
        fn2 = .SelectedItems(2)
    End With

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    Set wb1 = OpenReadOnly(fn1, open1)
    Set wb2 = OpenReadOnly(fn2, open2)
    Set ws1 = wb1.Worksheets(1)
    Set ws2 = wb2.Worksheets(1)

    If Not IsTanki(ws1) Or Not IsTanki(ws2) Then
        MsgBox "短期の標準報酬資料（E1に「短期人数・標準報酬等」、Y2に「標準期末手当等総額」がある形式）を選んでください。", vbExclamation
        GoTo Cleanup
    End If
    y1 = CLng(Val(ws1.Range("C1").Value))
    y2 = CLng(Val(ws2.Range("C1").Value))
    If y1 = y2 Or y1 = 0 Or y2 = 0 Then
        MsgBox "2つのブックのC1（年度）が同じ、または数値ではありません。（" & y1 & "／" & y2 & "）", vbExclamation
        GoTo Cleanup
    End If
    ' 年度の小さい方を当年度（F列）、大きい方を翌年度（G列）とする
    If y1 > y2 Then
        Set tmp = ws1: Set ws1 = ws2: Set ws2 = tmp
        yF = y2: yG = y1
    Else
        yF = y1: yG = y2
    End If

    msg = "F列（令和" & yF & "年度末見込）← " & ws1.Parent.Name & vbCrLf & _
          "G列（令和" & yG & "年度末推計）← " & ws2.Parent.Name & vbCrLf & vbCrLf
    If ReiwaYear(CStr(wsK.Range("F2").Value)) <> yF Or ReiwaYear(CStr(wsK.Range("G2").Value)) <> yG Then
        msg = msg & "【注意】概況シートの見出し（" & wsK.Range("F2").Value & "／" & wsK.Range("G2").Value & "）と年度が一致しません。" & vbCrLf & vbCrLf
    End If
    msg = msg & "「2.3ｶﾒラ」「4ｶﾒラ」の短期の組合員数・標準報酬・標準期末手当等を上書きします。よろしいですか？"
    If MsgBox(msg, vbQuestion + vbYesNo + vbDefaultButton2, "標準報酬等の転記") <> vbYes Then GoTo Cleanup

    Call StartLog
    Call Apply(ws1, "F", wsK, wsM)
    Call Apply(ws2, "G", wsK, wsM)
    Application.Calculate

Cleanup:
    On Error Resume Next
    If open1 Then wb1.Close SaveChanges:=False
    If open2 Then wb2.Close SaveChanges:=False
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    On Error GoTo 0
    If mCount > 0 Then
        MsgBox "転記しました（" & mCount & "セル）。" & vbCrLf & _
               "長期・後期高齢者等短期・被扶養者数は変更していません。" & vbCrLf & _
               "履歴はシート「" & SH_LOG & "」に残しています。", vbInformation, "標準報酬等の転記"
        mCount = 0
    End If
    Exit Sub

ErrHandler:
    MsgBox "転記中にエラーが発生しました。" & vbCrLf & Err.Number & "：" & Err.Description, vbCritical
    Resume Cleanup
End Sub

' 標準報酬資料1つ分を、概況シートの指定列（"F" または "G"）へ転記する
Private Sub Apply(ByVal s As Worksheet, ByVal col As String, ByVal wsK As Worksheet, ByVal wsM As Worksheet)
    Dim r3 As Long, r As Long, rr As Long
    Dim gen As Double, tok As Double, tan As Double

    ' 3月の行（B列が「3月」の最初の行）
    For r = 5 To 30
        If Trim$(CStr(s.Cells(r, 2).Value)) = "3月" Then
            r3 = r
            Exit For
        End If
    Next r
    If r3 = 0 Then Err.Raise vbObjectError + 1, , "標準報酬資料の3月の行が見つかりません（" & s.Parent.Name & "）"

    ' ---- 2.3ｶﾒラ  組合員数（3月末、人）
    gen = Nv(s, r3, 5) + Nv(s, r3, 7) + Nv(s, r3, 9) + Nv(s, r3, 11) + Nv(s, r3, 13)
    tok = Nv(s, r3, 11) + Nv(s, r3, 13)
    Call PutVal(wsK, col & "3", gen, s.Parent.Name & " 3月 一般組合員（専従・病院・その他・特別職）")
    Call PutVal(wsK, col & "4", tok, s.Parent.Name & " 3月 うち特別職")
    Call PutVal(wsK, col & "5", Nv(s, r3, 17) + Nv(s, r3, 19) - NumOf(wsK.Range(col & "8").Value), s.Parent.Name & " 3月 短期組合員（病院＋病院以外）－後期高齢者等(" & col & "8)")
    Call PutVal(wsK, col & "6", Nv(s, r3, 15), s.Parent.Name & " 3月 市長組合員")
    Call PutVal(wsK, col & "7", Nv(s, r3, 21), s.Parent.Name & " 3月 特定消防組合員")
    Call PutVal(wsK, col & "12", Nv(s, r3, 23), s.Parent.Name & " 3月 任意継続組合員")

    ' ---- 2.3ｶﾒラ  標準報酬月額総額（3月、千円）短期
    Call PutVal(wsK, col & "24", Th(Nv(s, r3, 6) + Nv(s, r3, 8) + Nv(s, r3, 10) + Nv(s, r3, 12) + Nv(s, r3, 14)), s.Parent.Name & " 3月 一般組合員 標準報酬(短期)")
    Call PutVal(wsK, col & "28", Th(Nv(s, r3, 12) + Nv(s, r3, 14)), s.Parent.Name & " 3月 うち特別職 標準報酬(短期)")
    Call PutVal(wsK, col & "30", Th(Nv(s, r3, 18) + Nv(s, r3, 20)) - NumOf(wsK.Range(col & "40").Value), s.Parent.Name & " 3月 短期組合員 標準報酬－後期高齢者等(" & col & "40)")
    Call PutVal(wsK, col & "34", Th(Nv(s, r3, 16)), s.Parent.Name & " 3月 市長組合員 標準報酬(短期)")
    Call PutVal(wsK, col & "38", Th(Nv(s, r3, 22)), s.Parent.Name & " 3月 特定消防組合員 標準報酬(短期)")
    Call PutVal(wsK, col & "50", Th(Nv(s, r3, 24)), s.Parent.Name & " 3月 任意継続組合員 標準報酬")

    ' ---- 4ｶﾒラ  標準期末手当等の年間総額（千円）短期（資料の17行目）
    rr = 0
    For r = 18 To 25
        If InStr(CStr(s.Cells(r, 29).Value), "予算書用一般") > 0 Then
            rr = r
            Exit For
        End If
    Next r
    If rr = 0 Then Err.Raise vbObjectError + 2, , "「予算書用一般」の行が見つかりません（" & s.Parent.Name & "）"
    Call PutVal(wsM, col & "4", Th(Nv(s, rr, 30)), s.Parent.Name & " 予算書用一般（標準期末手当等 年間）")
    Call PutVal(wsM, col & "8", Th(Nv(s, 17, 29) + Nv(s, 17, 30)), s.Parent.Name & " 特別職（病院理事長等＋病院以外）")
    ' 短期組合員は後期高齢者等短期組合員（同じ列の20行目）を除いた額
    Call PutVal(wsM, col & "10", Th(Nv(s, 17, 31)) - NumOf(wsM.Range(col & "20").Value), s.Parent.Name & " 短期組合員 － 後期高齢者等(" & col & "20)")
    Call PutVal(wsM, col & "14", Th(Nv(s, 17, 32)), s.Parent.Name & " 市長組合員")
    Call PutVal(wsM, col & "18", Th(Nv(s, 17, 33)), s.Parent.Name & " 特定消防組合員")
End Sub

Private Function IsTanki(ByVal s As Worksheet) As Boolean
    IsTanki = (InStr(CStr(s.Range("E1").Value), "短期人数") > 0) And (InStr(CStr(s.Range("Y2").Value), "標準期末手当") > 0)
End Function

Private Function Nv(ByVal s As Worksheet, ByVal r As Long, ByVal c As Long) As Double
    Nv = NumOf(s.Cells(r, c).Value)
End Function

' 円 -> 千円（四捨五入）
Private Function Th(ByVal v As Double) As Double
    Th = Application.WorksheetFunction.Round(v / 1000, 0)
End Function

Private Function NumOf(ByVal v As Variant) As Double
    If IsError(v) Then
        NumOf = 0
    ElseIf VarType(v) = vbDouble Or VarType(v) = vbLong Or VarType(v) = vbInteger Or VarType(v) = vbCurrency Then
        NumOf = CDbl(v)
    Else
        NumOf = 0
    End If
End Function

Private Function ReiwaYear(ByVal s As String) As Long
    Dim t As String, ch As String, d As String, i As Long
    t = StrConv(s, vbNarrow)
    For i = 1 To Len(t)
        ch = Mid$(t, i, 1)
        If ch Like "[0-9]" Then
            d = d & ch
        ElseIf Len(d) > 0 Then
            Exit For
        End If
    Next i
    If Len(d) > 0 Then ReiwaYear = CLng(d)
End Function

Private Function OpenReadOnly(ByVal fn As String, ByRef openedHere As Boolean) As Workbook
    Dim wb As Workbook
    Dim nm As String
    nm = Mid$(fn, InStrRev(fn, "\") + 1)
    openedHere = False
    On Error Resume Next
    Set wb = Workbooks(nm)
    On Error GoTo 0
    If wb Is Nothing Then
        Application.EnableEvents = False
        Set wb = Workbooks.Open(Filename:=fn, UpdateLinks:=0, ReadOnly:=True)
        Application.EnableEvents = True
        openedHere = True
    End If
    Set OpenReadOnly = wb
End Function

Private Function SheetOf(ByVal wb As Workbook, ByVal nm As String) As Worksheet
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = wb.Worksheets(nm)
    On Error GoTo 0
    Set SheetOf = ws
End Function

Private Sub StartLog()
    Set mLog = SheetOf(ThisWorkbook, SH_LOG)
    If mLog Is Nothing Then
        Set mLog = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        mLog.Name = SH_LOG
        mLog.Range("A1:F1").Value = Array("日時", "転記先シート", "転記先セル", "旧値", "新値", "転記元・備考")
        mLog.Range("A1:F1").Interior.Color = RGB(217, 217, 217)
        mLog.Range("A1:F1").Font.Bold = True
        mLog.Columns("A").ColumnWidth = 18
        mLog.Columns("B").ColumnWidth = 12
        mLog.Columns("C").ColumnWidth = 10
        mLog.Columns("D:E").ColumnWidth = 14
        mLog.Columns("F").ColumnWidth = 60
        mLog.Tab.Color = RGB(166, 166, 166)
    End If
    mLogRow = mLog.Cells(mLog.Rows.Count, 1).End(xlUp).Row + 1
    mCount = 0
End Sub

Private Sub PutVal(ByVal ws As Worksheet, ByVal addr As String, ByVal v As Double, ByVal note As String)
    Dim oldV As Variant
    oldV = ws.Range(addr).Value
    ws.Range(addr).Value = v
    mLog.Cells(mLogRow, 1).Value = Now
    mLog.Cells(mLogRow, 1).NumberFormat = "yyyy/mm/dd hh:mm"
    mLog.Cells(mLogRow, 2).Value = ws.Name
    mLog.Cells(mLogRow, 3).Value = addr
    mLog.Cells(mLogRow, 4).Value = oldV
    mLog.Cells(mLogRow, 5).Value = v
    mLog.Cells(mLogRow, 6).Value = note
    mLogRow = mLogRow + 1
    mCount = mCount + 1
End Sub
