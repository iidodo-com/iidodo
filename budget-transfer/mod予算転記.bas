Attribute VB_Name = "mod予算転記"
Option Explicit

' ============================================================
'  業務経理 予算編成ブック用  自動転記マクロ
'   転記メニュー          ... 当年度推計を転記を呼び出す
'   当年度推計を転記      ... 費用収益表ブック -> ○予定損益のC列
'  ※転記の履歴（旧値・新値）はシート「転記ログ」に残します。
' ============================================================

Private Const SH_PL As String = "○予定損益"
Private Const SH_SET As String = "費用収益表_転記設定"
Private Const SH_LOG As String = "転記ログ"

Private mLog As Worksheet
Private mLogRow As Long
Private mCount As Long

Public Sub 転記メニュー()
    Call 当年度推計を転記
End Sub

' ------------------------------------------------------------
'  当年度推計（費用収益表）の転記
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
