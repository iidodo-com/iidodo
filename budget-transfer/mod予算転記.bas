Attribute VB_Name = "mod予算転記"
Option Explicit

' ============================================================
'  業務経理 予算編成ブック用  自動転記マクロ
'   転記メニュー          ... 番号で選んで実行
'   前年度決算額を転記    ... 決算書ブック -> ○予定損益・○予定貸借のB列
'   当年度推計を転記      ... 費用収益表ブック -> ○予定損益のC列
'  ※転記の履歴（旧値・新値）はシート「転記ログ」に残します。
' ============================================================

Private Const SH_PL As String = "○予定損益"
Private Const SH_BS As String = "○予定貸借"
Private Const SH_GEN As String = "○予算総則"
Private Const SH_SET As String = "費用収益表_転記設定"
Private Const SH_LOG As String = "転記ログ"

Private mLog As Worksheet
Private mLogRow As Long
Private mCount As Long

Public Sub 転記メニュー()
    Dim s As String
    s = InputBox("実行する転記を番号で入力してください。" & vbCrLf & vbCrLf & _
        "1：前年度決算額（決算書ブック → ○予定損益・○予定貸借のB列）" & vbCrLf & _
        "2：当年度推計（費用収益表ブック → ○予定損益のC列）", "予算書 自動転記", "1")
    Select Case Trim$(s)
        Case "1": Call 前年度決算額を転記
        Case "2": Call 当年度推計を転記
    End Select
End Sub

' ------------------------------------------------------------
'  1. 前年度決算額の転記
' ------------------------------------------------------------
Public Sub 前年度決算額を転記()
    Dim fn As String
    Dim wbSrc As Workbook
    Dim wsF As Worksheet, wsK As Worksheet, wsG As Worksheet
    Dim wsPL As Worksheet, wsBS As Worksheet
    Dim srcYear As Long, budYear As Long, needYear As Long
    Dim openedHere As Boolean
    Dim msg As String
    Dim i As Long, pairs As Variant
    Dim d As Double

    mCount = 0
    fn = PickFile("前年度の決算書ブック（入力ガイドのあるブック）を選んでください")
    If Len(fn) = 0 Then Exit Sub

    Set wsPL = SheetOf(ThisWorkbook, SH_PL)
    Set wsBS = SheetOf(ThisWorkbook, SH_BS)
    If wsPL Is Nothing Or wsBS Is Nothing Then
        MsgBox "「" & SH_PL & "」「" & SH_BS & "」のシートが見つかりません。", vbExclamation
        Exit Sub
    End If

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    Set wbSrc = OpenReadOnly(fn, openedHere)
    Set wsF = SheetOf(wbSrc, "業務_財務諸表P47")
    Set wsK = SheetOf(wbSrc, "業務_決算精算表P51")
    Set wsG = SheetOf(wbSrc, "入力ガイド")
    If wsF Is Nothing Or wsK Is Nothing Or wsG Is Nothing Then
        MsgBox "選んだブックは決算書ではありません（「業務_財務諸表P47」「業務_決算精算表P51」「入力ガイド」が必要です）。", vbExclamation
        GoTo Cleanup
    End If

    srcYear = CLng(Val(wsG.Range("C6").Value))
    budYear = ReiwaYear(CStr(SheetOf(ThisWorkbook, SH_GEN).Range("H4").Value))
    needYear = budYear - 2

    msg = "転記元：" & wbSrc.Name & vbCrLf & _
          "決算書の対象年度：令和" & srcYear & "年度" & vbCrLf & _
          "この予算書（令和" & budYear & "年度予算）の前年度：令和" & needYear & "年度" & vbCrLf & vbCrLf
    If srcYear <> needYear Then
        msg = msg & "【注意】年度が一致しません。このまま転記すると誤った年度の決算額が入ります。" & vbCrLf
    End If
    msg = msg & "○予定損益・○予定貸借のB列（決算額、千円）を上書きします。よろしいですか？"
    If MsgBox(msg, IIf(srcYear <> needYear, vbExclamation, vbQuestion) + vbYesNo + vbDefaultButton2, "前年度決算額の転記") <> vbYes Then GoTo Cleanup

    Call StartLog
    ' ---- 予定損益（B列）  [転記先, 決算書の財務諸表P47のセル]
    pairs = Array("B10", "F38", "B11", "F39", "B13", "F42", "B16", "F44", "B21", "G47", _
                  "B25", "G50", "B29", "G54", "B44", "B38", "B45", "B39", "B46", "B40", _
                  "B47", "B41", "B48", "B42", "B49", "B43", "B50", "B44", "B51", "B45", _
                  "B52", "B46", "B53", "B47", "B54", "B48", "B56", "B49", "B57", "B50", _
                  "B58", "B51", "B59", "B52", "B70", "D56")
    For i = 0 To UBound(pairs) Step 2
        Call PutVal(wsPL, CStr(pairs(i)), KS(wsF, CStr(pairs(i + 1))), wbSrc.Name & " 業務_財務諸表P47!" & pairs(i + 1))
    Next i
    Call PutVal(wsPL, "B12", KD(wsF, "G41", "F42"), "補助金等収入(G41)-連合会交付金(F42)")
    Call PutVal(wsPL, "B66", KS(wsK, "A36"), wbSrc.Name & " 業務_決算精算表P51!A36")
    Call PutVal(wsPL, "B20", 0, "決算書に該当科目なし")
    Call PutVal(wsPL, "B55", 0, "決算書に該当科目なし")
    Call PutVal(wsPL, "B62", 0, "決算書に該当科目なし")

    ' ---- 予定貸借（B列）
    pairs = Array("B9", "C7", "B10", "C8", "B13", "C9", "B18", "B14", "B25", "G7", _
                  "B26", "G8", "B27", "G9", "B28", "G10", "B36", "H14")
    For i = 0 To UBound(pairs) Step 2
        Call PutVal(wsBS, CStr(pairs(i)), KS(wsF, CStr(pairs(i + 1))), wbSrc.Name & " 業務_財務諸表P47!" & pairs(i + 1))
    Next i
    Call PutVal(wsBS, "B11", 0, "決算書に該当科目なし")
    Call PutVal(wsBS, "B12", 0, "決算書に該当科目なし")
    Call PutVal(wsBS, "B32", 0, "決算書に該当科目なし")
    Call PutVal(wsBS, "B35", 0, "決算書に該当科目なし")

    ' ---- 千円単位の端数処理で生じた貸借・損益の差を調整する
    Application.Calculate
    msg = ""
    d = wsPL.Range("B35").Value - wsPL.Range("B73").Value
    If d <> 0 Then
        If Abs(d) <= 3 Then
            If wsPL.Range("B29").Value > 0 Then
                Call PutVal(wsPL, "B29", wsPL.Range("B29").Value - d, "端数調整(" & d & ")")
            Else
                Call PutVal(wsPL, "B70", wsPL.Range("B70").Value + d, "端数調整(" & d & ")")
            End If
            msg = msg & "予定損益の端数調整：" & d & "千円（当期利益金／損失金で調整）" & vbCrLf
        Else
            msg = msg & "【要確認】予定損益の借方・貸方が" & d & "千円ずれています。" & vbCrLf
        End If
    End If
    Application.Calculate
    d = wsBS.Range("B39").Value - wsBS.Range("B21").Value
    If d <> 0 Then
        If Abs(d) <= 3 Then
            Call PutVal(wsBS, "B9", wsBS.Range("B9").Value + d, "端数調整(" & d & ")")
            msg = msg & "予定貸借の端数調整：" & d & "千円（普通預金で調整）" & vbCrLf
        Else
            msg = msg & "【要確認】予定貸借の資産合計と負債・純資産合計が" & d & "千円ずれています。" & vbCrLf
        End If
    End If
    Application.Calculate

Cleanup:
    On Error Resume Next
    If Not wbSrc Is Nothing Then
        If openedHere Then wbSrc.Close SaveChanges:=False
    End If
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    On Error GoTo 0
    If mCount > 0 Then
        MsgBox "前年度決算額を転記しました（" & mCount & "セル）。" & vbCrLf & msg & _
               "履歴はシート「" & SH_LOG & "」に残しています。", vbInformation, "前年度決算額の転記"
        mCount = 0
    End If
    Exit Sub

ErrHandler:
    MsgBox "転記中にエラーが発生しました。" & vbCrLf & Err.Number & "：" & Err.Description, vbCritical
    Resume Cleanup
End Sub

' ------------------------------------------------------------
'  2. 当年度推計（費用収益表）の転記
'     「費用収益表_転記設定」シートの参照セル（短期・長期）を使う
' ------------------------------------------------------------
Public Sub 当年度推計を転記()
    Dim fn As String
    Dim wbSrc As Workbook, wsSrc As Worksheet, wsSet As Worksheet, wsPL As Worksheet
    Dim openedHere As Boolean
    Dim r As Long, lastRow As Long
    Dim unit As Double, v As Double, nUse As Long
    Dim sName As String, a As String

    mCount = 0
    Set wsSet = SheetOf(ThisWorkbook, SH_SET)
    Set wsPL = SheetOf(ThisWorkbook, SH_PL)
    If wsSet Is Nothing Or wsPL Is Nothing Then
        MsgBox "「" & SH_SET & "」「" & SH_PL & "」のシートが見つかりません。", vbExclamation
        Exit Sub
    End If

    lastRow = wsSet.Cells(wsSet.Rows.Count, 1).End(xlUp).Row
    For r = 8 To lastRow
        If Len(Trim$(CStr(wsSet.Cells(r, 3).Value))) > 0 Or Len(Trim$(CStr(wsSet.Cells(r, 4).Value))) > 0 Then nUse = nUse + 1
    Next r
    If nUse = 0 Then
        MsgBox "「" & SH_SET & "」シートに、短期・長期の参照セルが1つも設定されていません。" & vbCrLf & _
               "費用収益表の各科目のセル番地（例：D10）を黄色の欄に入力してから実行してください。", vbExclamation
        Exit Sub
    End If

    fn = PickFile("費用収益表のブックを選んでください")
    If Len(fn) = 0 Then Exit Sub

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    Set wbSrc = OpenReadOnly(fn, openedHere)
    sName = Trim$(CStr(wsSet.Range("B4").Value))
    Set wsSrc = SheetOf(wbSrc, sName)
    If wsSrc Is Nothing Then
        MsgBox "選んだブックに「" & sName & "」シートがありません。設定シートのB4を確認してください。", vbExclamation
        GoTo Cleanup
    End If
    unit = Val(wsSet.Range("B5").Value)
    If unit <= 0 Then unit = 1

    If MsgBox("転記元：" & wbSrc.Name & "（" & sName & "）" & vbCrLf & _
              "○予定損益のC列（当年度推計、千円）に、短期＋長期の合計を上書きします（" & nUse & "科目）。" & vbCrLf & _
              "よろしいですか？", vbQuestion + vbYesNo + vbDefaultButton2, "当年度推計の転記") <> vbYes Then GoTo Cleanup

    Call StartLog
    For r = 8 To lastRow
        If Len(Trim$(CStr(wsSet.Cells(r, 3).Value))) > 0 Or Len(Trim$(CStr(wsSet.Cells(r, 4).Value))) > 0 Then
            v = RefVal(wsSrc, CStr(wsSet.Cells(r, 3).Value)) + RefVal(wsSrc, CStr(wsSet.Cells(r, 4).Value))
            a = Trim$(CStr(wsSet.Cells(r, 1).Value))
            Call PutVal(wsPL, a, Application.WorksheetFunction.Round(v / unit, 0), _
                        wbSrc.Name & " " & sName & " 短期[" & wsSet.Cells(r, 3).Value & "]+長期[" & wsSet.Cells(r, 4).Value & "]")
        End If
    Next r
    Application.Calculate

Cleanup:
    On Error Resume Next
    If Not wbSrc Is Nothing Then
        If openedHere Then wbSrc.Close SaveChanges:=False
    End If
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    On Error GoTo 0
    If mCount > 0 Then
        MsgBox "当年度推計を転記しました（" & mCount & "セル）。" & vbCrLf & _
               "設定のない科目は変更していません。履歴はシート「" & SH_LOG & "」に残しています。", vbInformation, "当年度推計の転記"
        mCount = 0
    End If
    Exit Sub

ErrHandler:
    MsgBox "転記中にエラーが発生しました。" & vbCrLf & Err.Number & "：" & Err.Description, vbCritical
    Resume Cleanup
End Sub

' ======================= 共通部品 =======================

Private Function PickFile(ByVal ttl As String) As String
    Dim fd As FileDialog
    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    With fd
        .Title = ttl
        .AllowMultiSelect = False
        .Filters.Clear
        .Filters.Add "Excelブック", "*.xlsx;*.xlsm;*.xls;*.xlsb"
        If .Show = -1 Then PickFile = .SelectedItems(1)
    End With
End Function

' 読み取り専用で開く（マクロ・リンク更新は動かさない）。すでに開いていればそれを使う
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

' "令和８年度" -> 8
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

' 円 -> 千円（四捨五入）。数値でなければ0
Private Function KS(ByVal ws As Worksheet, ByVal addr As String) As Double
    KS = Application.WorksheetFunction.Round(NumOf(ws.Range(addr).Value) / 1000, 0)
End Function

Private Function KD(ByVal ws As Worksheet, ByVal a As String, ByVal b As String) As Double
    KD = Application.WorksheetFunction.Round((NumOf(ws.Range(a).Value) - NumOf(ws.Range(b).Value)) / 1000, 0)
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

' 参照セル（"D10" や "'Sheet'!D10" ではなく、転記元シート内のセル番地）の数値。空欄は0
Private Function RefVal(ByVal ws As Worksheet, ByVal addr As String) As Double
    addr = Trim$(addr)
    If Len(addr) = 0 Then Exit Function
    RefVal = NumOf(ws.Range(addr).Value)
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
        mLog.Columns("B").ColumnWidth = 16
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
