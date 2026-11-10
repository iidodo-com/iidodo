Attribute VB_Name = "mod標準報酬転記"
Option Explicit

' ============================================================
'  予算書ブック（総括）用  標準報酬等の自動転記マクロ
'   標準報酬等を転記 ... 標準報酬資料（短期・長期、当年度分と翌年度分）を選ぶと、
'                         「総括_2.3ｶﾒラ」「総括_4ｶﾒラ」のF列（当年度末見込）・G列（翌年度末推計）へ転記します。
'                         ブックは2～4個選べます（短期2＋長期2が基本。1種類だけでも可）。
'  対象：組合員数・標準報酬月額（3月）・標準期末手当等
'    短期資料 ... 短期組合員数、任意継続、短期の標準報酬（2.3ｶﾒラ 5・12・24・28・30・34・38・50行）、
'                 短期の標準期末手当等（4ｶﾒラ 4・8・10・14・18行）
'    長期資料 ... 一般・特別職・市長・特定消防・継続長期の組合員数（2.3ｶﾒラ 3・4・6・7・9行）、
'                 長期の標準報酬（2.3ｶﾒラ 22・26・32・36・42行）、長期の標準期末手当等（4ｶﾒラ 2・6・12・16・22行）
'  ※後期高齢者等短期組合員（8・40行・4ｶﾒラ20行）と被扶養者数は資料にないため対象外です。
'    短期組合員（5・30行・4ｶﾒラ10行）は、同じ列の後期高齢者等の現在値を除いて転記します。
'  ※転記の履歴（旧値・新値）はシート「転記ログ」に残します。
' ============================================================

Private Const SH_K As String = "総括_2.3ｶﾒラ"
Private Const SH_M As String = "総括_4ｶﾒラ"
Private Const SH_LOG As String = "転記ログ"

Private mLog As Worksheet
Private mLogRow As Long
Private mCount As Long

Public Sub TransferStandardRemuneration()
    Call 標準報酬等を転記
End Sub

Public Sub 標準報酬等を転記()
    Dim fd As FileDialog
    Dim n As Long, i As Long, j As Long
    Dim wbs(1 To 4) As Workbook
    Dim opened(1 To 4) As Boolean
    Dim wss(1 To 4) As Worksheet
    Dim kind(1 To 4) As String
    Dim yr(1 To 4) As Long
    Dim yF As Long, yG As Long
    Dim wsK As Worksheet, wsM As Worksheet
    Dim msg As String, col As String

    mCount = 0
    Set wsK = SheetOf(ThisWorkbook, SH_K)
    Set wsM = SheetOf(ThisWorkbook, SH_M)
    If wsK Is Nothing Or wsM Is Nothing Then
        MsgBox "「" & SH_K & "」「" & SH_M & "」のシートが見つかりません。", vbExclamation
        Exit Sub
    End If

    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    With fd
        .Title = "標準報酬資料を選んでください（Ctrlキーを押しながらクリック：短期・長期の当年度分と翌年度分）"
        .AllowMultiSelect = True
        .Filters.Clear
        .Filters.Add "Excelブック", "*.xlsx;*.xlsm;*.xls;*.xlsb"
        If .Show <> -1 Then Exit Sub
        n = .SelectedItems.Count
        If n < 2 Or n > 4 Then
            MsgBox "ブックを2～4個選んでください。", vbExclamation
            Exit Sub
        End If
        On Error GoTo ErrHandler
        Application.ScreenUpdating = False
        For i = 1 To n
            Set wbs(i) = OpenReadOnly(.SelectedItems(i), opened(i))
        Next i
    End With

    For i = 1 To n
        Set wss(i) = wbs(i).Worksheets(1)
        If IsTanki(wss(i)) Then
            kind(i) = "短期"
        ElseIf IsChoki(wss(i)) Then
            kind(i) = "長期"
        Else
            MsgBox "標準報酬資料の形式ではありません：" & wbs(i).Name & vbCrLf & _
                   "（E1に「短期人数」または「長期人数」、Y2／U2に「標準期末手当」がある形式）", vbExclamation
            GoTo Cleanup
        End If
        yr(i) = CLng(Val(wss(i).Range("C1").Value))
    Next i

    ' 年度は2種類まで。小さい方を当年度（F列）、大きい方を翌年度（G列）
    yF = yr(1): yG = yr(1)
    For i = 2 To n
        If yr(i) < yF Then yF = yr(i)
        If yr(i) > yG Then yG = yr(i)
    Next i
    If yF = yG Or yF = 0 Then
        MsgBox "年度（各ブックのC1）が1種類しかない、または数値ではありません。当年度分と翌年度分を選んでください。", vbExclamation
        GoTo Cleanup
    End If
    For i = 1 To n
        If yr(i) <> yF And yr(i) <> yG Then
            MsgBox "年度が3種類以上あります（令和" & yr(i) & "年度：" & wbs(i).Name & "）。", vbExclamation
            GoTo Cleanup
        End If
        For j = i + 1 To n
            If kind(i) = kind(j) And yr(i) = yr(j) Then
                MsgBox "同じ種類・同じ年度のブックが重複しています：" & wbs(i).Name & "／" & wbs(j).Name, vbExclamation
                GoTo Cleanup
            End If
        Next j
    Next i

    msg = ""
    For i = 1 To n
        If yr(i) = yF Then col = "F" Else col = "G"
        msg = msg & col & "列 ← " & kind(i) & "（令和" & yr(i) & "年度）" & wbs(i).Name & vbCrLf
    Next i
    msg = msg & vbCrLf
    If ReiwaYear(CStr(wsK.Range("F2").Value)) <> yF Or ReiwaYear(CStr(wsK.Range("G2").Value)) <> yG Then
        msg = msg & "【注意】概況シートの見出し（" & wsK.Range("F2").Value & "／" & wsK.Range("G2").Value & "）と年度が一致しません。" & vbCrLf & vbCrLf
    End If
    msg = msg & "「総括_2.3ｶﾒラ」「総括_4ｶﾒラ」の該当セルを上書きします。よろしいですか？"
    If MsgBox(msg, vbQuestion + vbYesNo + vbDefaultButton2, "標準報酬等の転記") <> vbYes Then GoTo Cleanup

    Call StartLog
    For i = 1 To n
        If yr(i) = yF Then col = "F" Else col = "G"
        If kind(i) = "短期" Then
            Call ApplyTanki(wss(i), col, wsK, wsM)
        Else
            Call ApplyChoki(wss(i), col, wsK, wsM)
        End If
    Next i
    Application.Calculate

Cleanup:
    On Error Resume Next
    For i = 1 To 4
        If opened(i) Then wbs(i).Close SaveChanges:=False
    Next i
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    On Error GoTo 0
    If mCount > 0 Then
        MsgBox "転記しました（" & mCount & "セル）。" & vbCrLf & _
               "後期高齢者等短期組合員・被扶養者数は変更していません。" & vbCrLf & _
               "履歴はシート「" & SH_LOG & "」に残しています。", vbInformation, "標準報酬等の転記"
        mCount = 0
    End If
    Exit Sub

ErrHandler:
    MsgBox "転記中にエラーが発生しました。" & vbCrLf & Err.Number & "：" & Err.Description, vbCritical
    Resume Cleanup
End Sub

' 3月の行（B列が「3月」の最初の行）
Private Function Row3gatsu(ByVal s As Worksheet) As Long
    Dim r As Long
    For r = 5 To 30
        If Trim$(CStr(s.Cells(r, 2).Value)) = "3月" Then
            Row3gatsu = r
            Exit Function
        End If
    Next r
    Err.Raise vbObjectError + 1, , "標準報酬資料の3月の行が見つかりません（" & s.Parent.Name & "）"
End Function

' 短期の標準報酬資料1つ分を、概況シートの指定列（"F" または "G"）へ転記する
Private Sub ApplyTanki(ByVal s As Worksheet, ByVal col As String, ByVal wsK As Worksheet, ByVal wsM As Worksheet)
    Dim r3 As Long, r As Long, rr As Long
    Dim nm As String
    nm = s.Parent.Name
    r3 = Row3gatsu(s)

    ' ---- 2.3ｶﾒラ  組合員数（3月末、人）
    Call PutVal(wsK, col & "5", Nv(s, r3, 17) + Nv(s, r3, 19) - NumOf(wsK.Range(col & "8").Value), nm & " 3月 短期組合員（病院＋病院以外）－後期高齢者等(" & col & "8)")
    Call PutVal(wsK, col & "12", Nv(s, r3, 23), nm & " 3月 任意継続組合員")

    ' ---- 2.3ｶﾒラ  標準報酬月額総額（3月、千円）短期
    Call PutVal(wsK, col & "24", Th(Nv(s, r3, 6) + Nv(s, r3, 8) + Nv(s, r3, 10) + Nv(s, r3, 12) + Nv(s, r3, 14)), nm & " 3月 一般組合員 標準報酬(短期)")
    Call PutVal(wsK, col & "28", Th(Nv(s, r3, 12) + Nv(s, r3, 14)), nm & " 3月 うち特別職 標準報酬(短期)")
    Call PutVal(wsK, col & "30", Th(Nv(s, r3, 18) + Nv(s, r3, 20)) - NumOf(wsK.Range(col & "40").Value), nm & " 3月 短期組合員 標準報酬－後期高齢者等(" & col & "40)")
    Call PutVal(wsK, col & "34", Th(Nv(s, r3, 16)), nm & " 3月 市長組合員 標準報酬(短期)")
    Call PutVal(wsK, col & "38", Th(Nv(s, r3, 22)), nm & " 3月 特定消防組合員 標準報酬(短期)")
    Call PutVal(wsK, col & "50", Th(Nv(s, r3, 24)), nm & " 3月 任意継続組合員 標準報酬")

    ' ---- 4ｶﾒラ  標準期末手当等の年間総額（千円）短期（資料の17行目）
    rr = 0
    For r = 18 To 25
        If InStr(CStr(s.Cells(r, 29).Value), "予算書用一般") > 0 Then
            rr = r
            Exit For
        End If
    Next r
    If rr = 0 Then Err.Raise vbObjectError + 2, , "「予算書用一般」の行が見つかりません（" & nm & "）"
    Call PutVal(wsM, col & "4", Th(Nv(s, rr, 30)), nm & " 予算書用一般（標準期末手当等 年間）")
    Call PutVal(wsM, col & "8", Th(Nv(s, 17, 29) + Nv(s, 17, 30)), nm & " 特別職（病院理事長等＋病院以外）")
    Call PutVal(wsM, col & "10", Th(Nv(s, 17, 31)) - NumOf(wsM.Range(col & "20").Value), nm & " 短期組合員 － 後期高齢者等(" & col & "20)")
    Call PutVal(wsM, col & "14", Th(Nv(s, 17, 32)), nm & " 市長組合員")
    Call PutVal(wsM, col & "18", Th(Nv(s, 17, 33)), nm & " 特定消防組合員")
End Sub

' 長期の標準報酬資料1つ分を、概況シートの指定列（"F" または "G"）へ転記する
Private Sub ApplyChoki(ByVal s As Worksheet, ByVal col As String, ByVal wsK As Worksheet, ByVal wsM As Worksheet)
    Dim r3 As Long, cnt As Double
    Dim nm As String, helper As String
    nm = s.Parent.Name
    r3 = Row3gatsu(s)

    ' ---- 2.3ｶﾒラ  組合員数（3月末、人）
    Call PutVal(wsK, col & "3", Nv(s, r3, 5) + Nv(s, r3, 7) + Nv(s, r3, 9) + Nv(s, r3, 11) + Nv(s, r3, 13), nm & " 3月 一般組合員（専従・病院・その他・特別職）")
    Call PutVal(wsK, col & "4", Nv(s, r3, 11) + Nv(s, r3, 13), nm & " 3月 うち特別職")
    Call PutVal(wsK, col & "6", Nv(s, r3, 15), nm & " 3月 市長組合員")
    Call PutVal(wsK, col & "7", Nv(s, r3, 17), nm & " 3月 特定消防組合員")
    ' 継続長期組合員：表示は「人数＋改行＋［人数］」。計算用セル（F→L9、G→M9）にも人数を入れる
    cnt = Nv(s, r3, 19)
    Call PutText(wsK, col & "9", CStr(cnt) & vbLf & "［" & CStr(cnt) & "］", nm & " 3月 継続長期（［ ］内は同数として転記。退職派遣者が異なる場合は修正）")
    If col = "F" Then helper = "L9" Else helper = "M9"
    Call PutVal(wsK, helper, cnt, nm & " 継続長期 計算用")

    ' ---- 2.3ｶﾒラ  標準報酬月額総額（3月、千円）長期
    Call PutVal(wsK, col & "22", Th(Nv(s, r3, 6) + Nv(s, r3, 8) + Nv(s, r3, 10) + Nv(s, r3, 12) + Nv(s, r3, 14)), nm & " 3月 一般組合員 標準報酬(長期)")
    Call PutVal(wsK, col & "26", Th(Nv(s, r3, 12) + Nv(s, r3, 14)), nm & " 3月 うち特別職 標準報酬(長期)")
    Call PutVal(wsK, col & "32", Th(Nv(s, r3, 16)), nm & " 3月 市長組合員 標準報酬(長期)")
    Call PutVal(wsK, col & "36", Th(Nv(s, r3, 18)), nm & " 3月 特定消防組合員 標準報酬(長期)")
    Call PutVal(wsK, col & "42", Th(Nv(s, r3, 20)), nm & " 3月 継続長期組合員 標準報酬")

    ' ---- 4ｶﾒラ  標準期末手当等の年間総額（千円）長期（資料の17行目：V=一般職の各区分、Y=特別職、Z=市長、AA=特定消防、AB=継続長期）
    Call PutVal(wsM, col & "2", Th(Nv(s, 17, 22) + Nv(s, 17, 23) + Nv(s, 17, 24) + Nv(s, 17, 25)), nm & " 一般組合員（一般職＋特別職）標準期末手当等")
    Call PutVal(wsM, col & "6", Th(Nv(s, 17, 25)), nm & " うち特別職")
    Call PutVal(wsM, col & "12", Th(Nv(s, 17, 26)), nm & " 市長組合員")
    Call PutVal(wsM, col & "16", Th(Nv(s, 17, 27)), nm & " 特定消防組合員")
    Call PutVal(wsM, col & "22", Th(Nv(s, 17, 28)), nm & " 継続長期組合員")
End Sub

Private Function IsTanki(ByVal s As Worksheet) As Boolean
    IsTanki = (InStr(CStr(s.Range("E1").Value), "短期人数") > 0) And (InStr(CStr(s.Range("Y2").Value), "標準期末手当") > 0)
End Function

Private Function IsChoki(ByVal s As Worksheet) As Boolean
    IsChoki = (InStr(CStr(s.Range("E1").Value), "長期人数") > 0) And (InStr(CStr(s.Range("U2").Value), "標準期末手当") > 0)
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

Private Sub PutText(ByVal ws As Worksheet, ByVal addr As String, ByVal v As String, ByVal note As String)
    Dim oldV As Variant
    oldV = ws.Range(addr).Value
    ws.Range(addr).Value = v
    mLog.Cells(mLogRow, 1).Value = Now
    mLog.Cells(mLogRow, 1).NumberFormat = "yyyy/mm/dd hh:mm"
    mLog.Cells(mLogRow, 2).Value = ws.Name
    mLog.Cells(mLogRow, 3).Value = addr
    mLog.Cells(mLogRow, 4).Value = Replace(CStr(oldV), vbLf, " ")
    mLog.Cells(mLogRow, 5).Value = Replace(v, vbLf, " ")
    mLog.Cells(mLogRow, 6).Value = note
    mLogRow = mLogRow + 1
    mCount = mCount + 1
End Sub
