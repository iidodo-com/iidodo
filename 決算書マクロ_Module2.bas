Attribute VB_Name = "Module2"
Option Explicit

' 広島市職員共済組合 決算書 補助マクロ
' 帳票シートの印刷範囲・列幅・行高・罫線・図形は変更しない。
' 変更するのは手入力セルの黄色表示の切替（入力ガイドのG10）とシート保護のみ。

' 手入力セルの黄色は条件付き書式で表示している。入力ガイドのこのセルが 1 のときだけ表示される。
Private Const INPUT_COLOR_CELL As String = "G10"

' 印刷・PDF出力のために黄色表示を一時的に止めているか／止める前の値
Public gInputColorSuspended As Boolean
Public gInputColorBackup As Variant

' Enterキーで次の手入力セルへ移動する機能のオン／オフ（入力ガイドのこのセルが 1 のとき有効）
Private Const ENTER_JUMP_CELL As String = "G19"

' 手入力セルの並び（入力セル一覧の順）。Enter の移動先を決めるのに使う
Private mInSheet() As String
Private mInAddr() As String
Private mInCount As Long
Private mInIndex As Collection

' 入力直後の移動のために覚えておくセル
Private mPendSheet As String
Private mPendAddr As String

Private Const SHEET_GUIDE As String = "入力ガイド"
Private Const SHEET_LIST As String = "入力セル一覧"
Private Const SHEET_PREV As String = "前年度貼付"
Private Const SHEET_CHECK As String = "チェック"
Private Const SHEET_LOAN_INPUT As String = "貸付_入力"
Private Const COVER_SHEET As String = "表紙等"

' 出力用の一時コピー（表紙等の区画ごと）につけるシート名の先頭
Private Const TEMP_PREFIX As String = "_tmp表紙"

' 入力セル一覧の明細行（6行目～842行目）
Private Const LIST_FIRST_ROW As Long = 6
Private Const LIST_LAST_ROW As Long = 842

' チェックシートの明細行（7行目～193行目）
Private Const CHECK_FIRST_ROW As Long = 7
Private Const CHECK_LAST_ROW As Long = 193

' ------------------------------------------------------------------------------------------
' メニュー
' ------------------------------------------------------------------------------------------
Public Sub ShowCommandMenu()
    Dim msg As String
    Dim ans As String

    msg = "実行する処理の番号（1～9）を入力してください。" & vbCrLf & vbCrLf & _
          " 1  整合性チェックの結果確認" & vbCrLf & _
          " 2  手入力セルの色付け表示 ON/OFF" & vbCrLf & _
          " 3  未入力セルへ移動" & vbCrLf & _
          " 4  帳票のPDF出力" & vbCrLf & _
          " 5  帳票の印刷プレビュー" & vbCrLf & _
          " 6  シート保護 ON/OFF" & vbCrLf & _
          " 7  来年度への繰越" & vbCrLf & _
          " 8  入力ガイドにボタンを配置" & vbCrLf & _
          " 9  Enterキーで次の手入力セルへ移動 ON/OFF"

    ans = InputBox(msg, "決算書 マクロメニュー", "1")
    Select Case Trim$(ans)
        Case "1": Call RunFullCheckAndDiagnose
        Case "2": Call ToggleInputHighlight
        Case "3": Call JumpToNextUnfilledCell
        Case "4": Call ExportFormsToPDF
        Case "5": Call PrintFormsWizard
        Case "6": Call ToggleSheetProtection
        Case "7": Call RollOverToNextYear
        Case "8": Call SetupGuideButtons
        Case "9": Call ToggleEnterJump
    End Select
End Sub

' ------------------------------------------------------------------------------------------
' 入力ガイドへのボタン配置
' ------------------------------------------------------------------------------------------
Public Sub SetupGuideButtons()
    Dim ws As Worksheet
    Dim shp As Shape
    Dim i As Long
    Dim defs As Variant
    Dim d As Variant
    Dim rng As Range

    Set ws = GetSheet(SHEET_GUIDE)
    If ws Is Nothing Then
        MsgBox "「" & SHEET_GUIDE & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False

    ' 以前に配置したボタンを削除してから再配置する
    For i = ws.Shapes.Count To 1 Step -1
        If Left$(ws.Shapes(i).Name, 4) = "Btn_" Then ws.Shapes(i).Delete
    Next i

    ' 名前, 表示文字, マクロ名, セル
    defs = Array( _
        Array("Btn_Menu", "メニュー", "ShowCommandMenu", "A10"), _
        Array("Btn_Check", "整合性チェック", "RunFullCheckAndDiagnose", "B10"), _
        Array("Btn_Highlight", "入力セル色付け", "ToggleInputHighlight", "C10"), _
        Array("Btn_Jump", "未入力セルへ移動", "JumpToNextUnfilledCell", "D10"), _
        Array("Btn_Pdf", "PDF出力", "ExportFormsToPDF", "A19"), _
        Array("Btn_Print", "印刷プレビュー", "PrintFormsWizard", "B19"), _
        Array("Btn_Protect", "シート保護", "ToggleSheetProtection", "C19"), _
        Array("Btn_Roll", "来年度へ繰越", "RollOverToNextYear", "D19"))

    For Each d In defs
        Set rng = ws.Range(CStr(d(3)))
        If rng.RowHeight < 20 Then rng.RowHeight = 20
        Set shp = ws.Shapes.AddShape(msoShapeRectangle, rng.Left + 2, rng.Top + 1, _
                                     rng.Width - 4, rng.Height - 2)
        With shp
            .Name = CStr(d(0))
            .Fill.ForeColor.RGB = RGB(242, 242, 242)
            .Line.ForeColor.RGB = RGB(128, 128, 128)
            .Line.Weight = 0.75
            .Shadow.Visible = msoFalse
            With .TextFrame2.TextRange
                .Text = CStr(d(1))
                .Font.NameFarEast = "ＭＳ Ｐゴシック"
                .Font.Name = "ＭＳ Ｐゴシック"
                .Font.Size = 9
                .Font.Bold = msoFalse
                .Font.Fill.ForeColor.RGB = RGB(0, 0, 0)
                .ParagraphFormat.Alignment = msoAlignCenter
            End With
            .TextFrame2.VerticalAnchor = msoAnchorMiddle
            .OnAction = CStr(d(2))
            .Placement = xlMove
        End With
    Next d

    Application.ScreenUpdating = True
    ws.Activate
    ws.Range("A1").Select
    MsgBox "「" & SHEET_GUIDE & "」シートにボタンを配置しました。", vbInformation
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "ボタンの配置中にエラーが発生しました。" & vbCrLf & Err.Description, vbExclamation
End Sub

' ------------------------------------------------------------------------------------------
' 整合性チェックの結果確認
' ------------------------------------------------------------------------------------------
Public Sub RunFullCheckAndDiagnose()
    Dim wsChk As Worksheet
    Dim wsList As Worksheet
    Dim wsPrev As Worksheet
    Dim ngCount As Long
    Dim totalChecks As Long
    Dim blankCount As Long
    Dim prevBlank As Long
    Dim r As Long
    Dim firstNgRow As Long
    Dim shown As Long
    Dim ngDetails As String

    Set wsChk = GetSheet(SHEET_CHECK)
    Set wsList = GetSheet(SHEET_LIST)
    Set wsPrev = GetSheet(SHEET_PREV)
    If wsChk Is Nothing Or wsList Is Nothing Or wsPrev Is Nothing Then
        MsgBox "「" & SHEET_CHECK & "」「" & SHEET_LIST & "」「" & SHEET_PREV & "」のいずれかが見つかりません。", vbExclamation
        Exit Sub
    End If

    Application.Calculation = xlCalculationAutomatic
    Application.CalculateFull

    ngCount = ToLongOrMinus1(wsChk.Range("L6"))
    totalChecks = ToLongOrMinus1(wsChk.Range("M6"))
    If ngCount < 0 Or totalChecks < 0 Then
        MsgBox "「" & SHEET_CHECK & "」シートの集計セル（L6、M6）がエラーです。", vbExclamation
        Exit Sub
    End If

    blankCount = Application.WorksheetFunction.CountIf( _
        wsList.Range(wsList.Cells(LIST_FIRST_ROW, 7), wsList.Cells(LIST_LAST_ROW, 7)), "未入力（空欄）")
    prevBlank = Application.WorksheetFunction.CountBlank(wsPrev.Range("E8:E332"))

    If ngCount = 0 Then
        MsgBox "整合性チェック：全 " & totalChecks & " 項目 異常なし" & vbCrLf & _
               "前年度貼付の空欄：" & prevBlank & " 件" & vbCrLf & _
               "手入力セルの空欄：" & blankCount & " 件（該当額が0円の場合は空欄のままで構いません）", _
               vbInformation, "整合性チェック"
        Exit Sub
    End If

    ' NG の明細を最大20件まで表示する
    For r = CHECK_FIRST_ROW To CHECK_LAST_ROW
        If wsChk.Cells(r, 8).Value = "NG" Then
            If firstNgRow = 0 Then firstNgRow = r
            shown = shown + 1
            If shown <= 20 Then
                ngDetails = ngDetails & "No." & wsChk.Cells(r, 1).Value & " [" & wsChk.Cells(r, 2).Value & "] " & _
                            wsChk.Cells(r, 4).Value & "（差額 " & Format$(wsChk.Cells(r, 7).Value, "#,##0") & "）" & vbCrLf
            End If
        End If
    Next r
    If shown > 20 Then ngDetails = ngDetails & "ほか " & (shown - 20) & " 件" & vbCrLf

    MsgBox "整合性チェックで " & ngCount & " 件のNGがあります。" & vbCrLf & vbCrLf & _
           ngDetails & vbCrLf & "「" & SHEET_CHECK & "」シートの該当行へ移動します。", _
           vbExclamation, "整合性チェック"
    If firstNgRow > 0 Then
        wsChk.Activate
        wsChk.Cells(firstNgRow, 4).Select
    End If
End Sub

' ------------------------------------------------------------------------------------------
' 手入力セルの黄色表示 ON/OFF
' 黄色は条件付き書式で出しており、セル本来の塗りは変更しない。画面表示用で、印刷には出さない。
' ------------------------------------------------------------------------------------------
Public Sub ToggleInputHighlight()
    Dim ws As Worksheet

    Set ws = GetSheet(SHEET_GUIDE)
    If ws Is Nothing Then Exit Sub

    On Error GoTo ErrHandler
    gInputColorSuspended = False
    If ws.Range(INPUT_COLOR_CELL).Value = 1 Then
        ws.Range(INPUT_COLOR_CELL).Value = 0
        MsgBox "手入力セルの黄色表示を止めました。", vbInformation, "入力セルの黄色表示"
    Else
        ws.Range(INPUT_COLOR_CELL).Value = 1
        MsgBox "手入力セルを黄色で表示します。" & vbCrLf & _
               "黄色は画面表示用で、印刷・PDF出力・印刷プレビューには出ません。", _
               vbInformation, "入力セルの黄色表示"
    End If
    Exit Sub

ErrHandler:
    MsgBox "黄色表示を切り替えられませんでした。" & vbCrLf & _
           "「" & SHEET_GUIDE & "」シートが保護されている場合は保護を解除してください。", vbExclamation
End Sub

' 印刷・PDF出力の前に黄色表示を止める（止める前の値を覚えておく）
Public Sub SuspendInputColor()
    Dim ws As Worksheet

    If gInputColorSuspended Then Exit Sub
    Set ws = GetSheet(SHEET_GUIDE)
    If ws Is Nothing Then Exit Sub

    On Error Resume Next
    gInputColorBackup = ws.Range(INPUT_COLOR_CELL).Value
    ws.Range(INPUT_COLOR_CELL).Value = 0
    If Err.Number = 0 Then gInputColorSuspended = True
    Err.Clear
    On Error GoTo 0
End Sub

' 黄色表示を元に戻す
Public Sub ResumeInputColor()
    Dim ws As Worksheet
    Dim prevEvents As Boolean

    If Not gInputColorSuspended Then Exit Sub
    gInputColorSuspended = False
    Set ws = GetSheet(SHEET_GUIDE)
    If ws Is Nothing Then Exit Sub

    prevEvents = Application.EnableEvents
    Application.EnableEvents = False
    On Error Resume Next
    ws.Range(INPUT_COLOR_CELL).Value = gInputColorBackup
    On Error GoTo 0
    Application.EnableEvents = prevEvents
End Sub

' 入力セル一覧のC列（HYPERLINK式）から対象セルを取得する
Private Function GetTargetCellFromListRow(ByVal wsList As Worksheet, ByVal rowNum As Long) As Range
    Dim sName As String
    Dim fText As String
    Dim cAddr As String
    Dim p1 As Long
    Dim p2 As Long

    On Error Resume Next
    sName = Trim$(CStr(wsList.Cells(rowNum, 2).Value))
    fText = wsList.Cells(rowNum, 3).Formula
    p1 = InStr(fText, "!")
    If p1 > 0 Then
        p2 = InStr(p1, fText, """")
        If p2 > p1 Then
            cAddr = Mid$(fText, p1 + 1, p2 - p1 - 1)
            Set GetTargetCellFromListRow = ThisWorkbook.Worksheets(sName).Range(cAddr)
        End If
    End If
    On Error GoTo 0
End Function

' ------------------------------------------------------------------------------------------
' 未入力セルへ移動（実行のたびに次の未入力セルへ進む）
' ------------------------------------------------------------------------------------------
Public Sub JumpToNextUnfilledCell()
    Static lastRowChecked As Long
    Dim wsList As Worksheet
    Dim r As Long
    Dim target As Range

    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then
        MsgBox "「" & SHEET_LIST & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If
    If lastRowChecked < LIST_FIRST_ROW Or lastRowChecked >= LIST_LAST_ROW Then lastRowChecked = LIST_FIRST_ROW - 1

    For r = lastRowChecked + 1 To LIST_LAST_ROW
        If CStr(wsList.Cells(r, 7).Value) = "未入力（空欄）" Then
            Set target = GetTargetCellFromListRow(wsList, r)
            If Not target Is Nothing Then
                lastRowChecked = r
                target.Worksheet.Activate
                target.Select
                MsgBox "未入力のセルへ移動しました（" & (r - LIST_FIRST_ROW + 1) & " / " & _
                       (LIST_LAST_ROW - LIST_FIRST_ROW + 1) & "）" & vbCrLf & vbCrLf & _
                       "経理区分：" & wsList.Cells(r, 1).Value & vbCrLf & _
                       "シート　：" & target.Worksheet.Name & "（" & target.Address(False, False) & "）" & vbCrLf & _
                       "項目　　：" & wsList.Cells(r, 4).Value & vbCrLf & vbCrLf & _
                       "該当額が0円の場合は空欄のままで構いません。" & vbCrLf & _
                       "もう一度実行すると次の未入力セルへ移動します。", _
                       vbInformation, "未入力セル"
                Exit Sub
            End If
        End If
    Next r

    lastRowChecked = LIST_FIRST_ROW - 1
    MsgBox "これ以降の未入力セルはありません。次回は先頭から検索します。", vbInformation, "未入力セル"
End Sub

' ------------------------------------------------------------------------------------------
' 帳票のPDF出力
' ------------------------------------------------------------------------------------------
Public Sub ExportFormsToPDF()
    Dim mode As String
    Dim sheetNames() As String
    Dim cnt As Long
    Dim pdfPath As String
    Dim fy As String
    Dim defaultFileName As String

    fy = CStr(ThisWorkbook.Worksheets(SHEET_GUIDE).Range("C6").Value)
    mode = Trim$(InputBox("出力する範囲の番号（1～3）を入力してください。" & vbCrLf & _
                          "出力順は目次のとおりです（中扉を各セクションの前に入れます）。" & vbCrLf & vbCrLf & _
                          " 1  全帳票（表紙・目次・事業状況報告書・決算報告書・各経理の財務諸表）" & vbCrLf & _
                          " 2  表紙・目次・事業状況報告書・決算報告書のみ" & vbCrLf & _
                          " 3  財務諸表の中扉と、各経理の財務諸表・附属明細表・決算精算表のみ", _
                          "PDF出力", "1"))
    If mode = "" Then Exit Sub
    If mode <> "1" And mode <> "2" And mode <> "3" Then
        MsgBox "1～3 の番号を入力してください。", vbExclamation
        Exit Sub
    End If

    defaultFileName = "令和" & fy & "年度_広島市職員共済組合_決算書.pdf"
    If ThisWorkbook.Path <> "" Then
        pdfPath = ThisWorkbook.Path & Application.PathSeparator & defaultFileName
    Else
        pdfPath = CStr(Application.GetSaveAsFilename(InitialFileName:=defaultFileName, _
                                                     FileFilter:="PDFファイル (*.pdf), *.pdf"))
        If pdfPath = "False" Or pdfPath = "" Then Exit Sub
    End If

    If Dir(pdfPath) <> "" Then
        If MsgBox("同名のファイルがあります。上書きしますか？" & vbCrLf & pdfPath, _
                  vbYesNo + vbQuestion, "PDF出力") <> vbYes Then Exit Sub
    End If

    ' 黄色表示は出力前に止め、出力後に戻す
    Call SuspendInputColor

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    ThisWorkbook.Activate
    cnt = PrepareSheetList(mode, False, sheetNames)
    If cnt = 0 Then
        Call DeleteTempSheets
        Application.EnableEvents = True
        Application.ScreenUpdating = True
        Call ResumeInputColor
        MsgBox "出力対象の帳票シートがありません。", vbExclamation
        Exit Sub
    End If

    ThisWorkbook.Worksheets(sheetNames).Select
    ActiveSheet.ExportAsFixedFormat Type:=xlTypePDF, _
                                    Filename:=pdfPath, _
                                    Quality:=xlQualityStandard, _
                                    IncludeDocProperties:=True, _
                                    IgnorePrintAreas:=False, _
                                    OpenAfterPublish:=True
    Call DeleteTempSheets
    ThisWorkbook.Worksheets(SHEET_GUIDE).Select
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Call ResumeInputColor

    MsgBox "PDFに出力しました。" & vbCrLf & pdfPath, vbInformation, "PDF出力"
    Exit Sub

ErrHandler:
    Dim errMsg As String
    errMsg = Err.Description
    On Error Resume Next
    Call DeleteTempSheets
    ThisWorkbook.Worksheets(SHEET_GUIDE).Select
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Call ResumeInputColor
    On Error GoTo 0
    MsgBox "PDF出力中にエラーが発生しました。" & vbCrLf & errMsg, vbCritical, "PDF出力"
End Sub

' ------------------------------------------------------------------------------------------
' 帳票の印刷プレビュー（プレビュー画面から印刷できる）
' ------------------------------------------------------------------------------------------
Public Sub PrintFormsWizard()
    Dim includeBlank As VbMsgBoxResult
    Dim sheetNames() As String
    Dim cnt As Long

    includeBlank = MsgBox("全帳票の印刷プレビューを表示します。" & vbCrLf & _
                          "表示順は目次のとおりです（中扉を各セクションの前に入れます）。" & vbCrLf & _
                          "印刷範囲・余白・改ページは各シートの設定のままです。" & vbCrLf & vbCrLf & _
                          "両面印刷の調整用白紙シート（「白紙」を含むシート）を含めますか？" & vbCrLf & _
                          "　はい　　：含める" & vbCrLf & _
                          "　いいえ：含めない", _
                          vbYesNoCancel + vbQuestion, "印刷プレビュー")
    If includeBlank = vbCancel Then Exit Sub

    ' 黄色表示は印刷前に止め、プレビューを閉じたあとに戻す
    Call SuspendInputColor

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    ThisWorkbook.Activate
    cnt = PrepareSheetList("1", (includeBlank = vbYes), sheetNames)
    If cnt = 0 Then
        Call DeleteTempSheets
        Application.EnableEvents = True
        Application.ScreenUpdating = True
        Call ResumeInputColor
        MsgBox "印刷対象の帳票シートがありません。", vbExclamation
        Exit Sub
    End If

    Application.ScreenUpdating = True
    ThisWorkbook.Worksheets(sheetNames).PrintPreview
    Call DeleteTempSheets
    ThisWorkbook.Worksheets(SHEET_GUIDE).Select
    Application.EnableEvents = True
    Call ResumeInputColor
    Exit Sub

ErrHandler:
    Dim errMsg As String
    errMsg = Err.Description
    On Error Resume Next
    Call DeleteTempSheets
    ThisWorkbook.Worksheets(SHEET_GUIDE).Select
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Call ResumeInputColor
    On Error GoTo 0
    MsgBox "印刷プレビューの表示中にエラーが発生しました。" & vbCrLf & errMsg, vbCritical, "印刷プレビュー"
End Sub

' ------------------------------------------------------------------------------------------
' 出力順（目次の順）
' 「表紙等」シートには、表紙と各中扉の計12ページが1枚に入っている。そのまま出力すると中扉が
' 先頭にまとまるため、区画ごとに一時コピーを作り、各セクションの直前に差し込んで出力する。
' 一時コピーは出力後に削除する。元のシートの並び順・書式・印刷設定は変更しない。
'   区画 1 表紙 / 2 事業状況報告書 / 3 決算報告書 / 4 財務諸表 / 5～12 短期～貸付の各経理
' ------------------------------------------------------------------------------------------
' 出力するシート名を目次の順に並べて返す（戻り値は件数）。一時コピーを作成する。
Private Function PrepareSheetList(ByVal mode As String, ByVal includeBlank As Boolean, _
                                  ByRef names() As String) As Long
    Dim wsCover As Worksheet
    Dim anchor As Worksheet
    Dim cp As Worksheet
    Dim ws As Worksheet
    Dim seg As Long
    Dim segFirst As Long
    Dim segLast As Long
    Dim coverEnd As Long
    Dim cnt As Long

    Set wsCover = GetSheet(COVER_SHEET)
    If wsCover Is Nothing Then Err.Raise vbObjectError + 1, , "「" & COVER_SHEET & "」シートが見つかりません。"

    Select Case mode
        Case "2": segFirst = 1: segLast = 3
        Case "3": segFirst = 4: segLast = 12
        Case Else: segFirst = 1: segLast = 12
    End Select

    coverEnd = GetCoverEndRow(wsCover)
    For seg = segFirst To segLast
        Set anchor = GetSegmentAnchor(seg)
        If Not anchor Is Nothing Then
            wsCover.Copy Before:=anchor
            Set cp = ActiveSheet
            cp.Name = TEMP_PREFIX & Format$(seg, "00")
            cp.PageSetup.PrintArea = GetSegmentArea(seg, coverEnd)
        End If
    Next seg

    ' 並び順は、元のシート順に一時コピーを差し込んだ順（＝目次の順）
    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = xlSheetVisible Then
            If Left$(ws.Name, Len(TEMP_PREFIX)) = TEMP_PREFIX Or IsPrintableFormSheet(ws.Name, mode, includeBlank) Then
                cnt = cnt + 1
                ReDim Preserve names(1 To cnt)
                names(cnt) = ws.Name
            End If
        End If
    Next ws
    PrepareSheetList = cnt
End Function

Private Sub DeleteTempSheets()
    Dim i As Long
    Dim prevAlerts As Boolean

    prevAlerts = Application.DisplayAlerts
    Application.DisplayAlerts = False
    For i = ThisWorkbook.Worksheets.Count To 1 Step -1
        If Left$(ThisWorkbook.Worksheets(i).Name, Len(TEMP_PREFIX)) = TEMP_PREFIX Then
            ThisWorkbook.Worksheets(i).Delete
        End If
    Next i
    Application.DisplayAlerts = prevAlerts
End Sub

' 区画の一時コピーを差し込む位置（このシートの直前）
Private Function GetSegmentAnchor(ByVal seg As Long) As Worksheet
    Select Case seg
        Case 1: Set GetSegmentAnchor = GetSheet("目次")
        Case 2: Set GetSegmentAnchor = GetSheet("報告_概況P1-2")
        Case 3: Set GetSegmentAnchor = GetSheet("報告_総括P3-5")
        Case 4, 5: Set GetSegmentAnchor = FirstSheetWithPrefix("短期_")
        Case 6: Set GetSegmentAnchor = FirstSheetWithPrefix("厚生_")
        Case 7: Set GetSegmentAnchor = FirstSheetWithPrefix("退職等_")
        Case 8: Set GetSegmentAnchor = FirstSheetWithPrefix("経過的_")
        Case 9: Set GetSegmentAnchor = FirstSheetWithPrefix("預託金_")
        Case 10: Set GetSegmentAnchor = FirstSheetWithPrefix("業務_")
        Case 11: Set GetSegmentAnchor = FirstSheetWithPrefix("保健_")
        Case 12: Set GetSegmentAnchor = FirstSheetWithPrefix("貸付_")
    End Select
End Function

Private Function FirstSheetWithPrefix(ByVal prefix As String) As Worksheet
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        If Left$(ws.Name, Len(prefix)) = prefix And ws.Name <> SHEET_LOAN_INPUT Then
            Set FirstSheetWithPrefix = ws
            Exit Function
        End If
    Next ws
End Function

' 「表紙等」の印刷範囲（A1:R188）を区画ごとに分けたセル範囲
Private Function GetSegmentArea(ByVal seg As Long, ByVal coverEnd As Long) As String
    Select Case seg
        Case 1: GetSegmentArea = "$A$1:$R$" & coverEnd
        Case 2: GetSegmentArea = "$A$" & (coverEnd + 1) & ":$R$51"
        Case 3: GetSegmentArea = "$A$52:$R$65"
        Case 4: GetSegmentArea = "$A$66:$R$79"
        Case 5: GetSegmentArea = "$A$80:$R$93"
        Case 6: GetSegmentArea = "$A$94:$R$107"
        Case 7: GetSegmentArea = "$A$108:$R$121"
        Case 8: GetSegmentArea = "$A$122:$R$135"
        Case 9: GetSegmentArea = "$A$136:$R$149"
        Case 10: GetSegmentArea = "$A$150:$R$162"
        Case 11: GetSegmentArea = "$A$163:$R$175"
        Case 12: GetSegmentArea = "$A$176:$R$188"
    End Select
End Function

' 表紙ページの最終行。1ページ目は表紙のあと自動改ページで事業状況報告書の中扉に続くため、
' Excel が決めた最初の改ページ位置を使う。取得できない場合は用紙・余白・拡大率から計算する。
Private Function GetCoverEndRow(ByVal ws As Worksheet) As Long
    Dim r As Long
    Dim i As Long
    Dim h As Double
    Dim limit As Double
    Dim zoomPct As Double

    On Error Resume Next
    r = ws.HPageBreaks(1).Location.Row - 1
    On Error GoTo 0
    If r >= 20 And r < 51 Then
        GetCoverEndRow = r
        Exit Function
    End If

    zoomPct = 100
    If VarType(ws.PageSetup.Zoom) <> vbBoolean Then zoomPct = CDbl(ws.PageSetup.Zoom)
    limit = (841.9 - ws.PageSetup.TopMargin - ws.PageSetup.BottomMargin) / (zoomPct / 100)
    For i = 1 To 51
        h = h + ws.Rows(i).RowHeight
        If h > limit Then Exit For
    Next i
    GetCoverEndRow = i - 1
End Function

Private Function IsPrintableFormSheet(ByVal sName As String, ByVal mode As String, _
                                      ByVal includeBlankSheets As Boolean) As Boolean
    ' 管理用・内部計算用のシートは対象外
    Select Case sName
        Case SHEET_GUIDE, SHEET_LIST, SHEET_PREV, SHEET_CHECK, SHEET_LOAN_INPUT, _
             "報告_P8グラフデータ", "報告_預託金のカメラ", COVER_SHEET
            IsPrintableFormSheet = False
            Exit Function
    End Select

    If InStr(sName, "白紙") > 0 Then
        IsPrintableFormSheet = includeBlankSheets
        Exit Function
    End If

    Select Case mode
        Case "2"
            IsPrintableFormSheet = (sName = "目次" Or Left$(sName, 3) = "報告_")
        Case "3"
            IsPrintableFormSheet = Not (sName = "目次" Or Left$(sName, 3) = "報告_")
        Case Else
            IsPrintableFormSheet = True
    End Select
End Function

' ------------------------------------------------------------------------------------------
' シート保護 ON/OFF（手入力セル以外を編集不可にする。パスワードなし）
' ------------------------------------------------------------------------------------------
Public Sub ToggleSheetProtection()
    Dim wsGuide As Worksheet
    Dim wsList As Worksheet
    Dim ws As Worksheet
    Dim r As Long
    Dim target As Range
    Dim ans As VbMsgBoxResult

    Set wsGuide = GetSheet(SHEET_GUIDE)
    Set wsList = GetSheet(SHEET_LIST)
    If wsGuide Is Nothing Or wsList Is Nothing Then
        MsgBox "「" & SHEET_GUIDE & "」「" & SHEET_LIST & "」のいずれかが見つかりません。", vbExclamation
        Exit Sub
    End If

    Application.ScreenUpdating = False

    If wsGuide.ProtectContents Then
        On Error Resume Next
        For Each ws In ThisWorkbook.Worksheets
            ws.Unprotect
        Next ws
        On Error GoTo 0
        Application.ScreenUpdating = True
        MsgBox "全シートの保護を解除しました。", vbInformation, "シート保護"
        Exit Sub
    End If

    Application.ScreenUpdating = True
    ans = MsgBox("全シートを保護します。" & vbCrLf & vbCrLf & _
                 "編集できるのは次のセルだけになります。" & vbCrLf & _
                 "　・入力ガイド C6:C9、G10・G19（表示・Enterキーの切替）" & vbCrLf & _
                 "　・前年度貼付 E8:E332" & vbCrLf & _
                 "　・入力セル一覧に載っている手入力セル（貸付_入力を含む）" & vbCrLf & _
                 "パスワードは設定しません。同じ操作でいつでも解除できます。", _
                 vbOKCancel + vbQuestion, "シート保護")
    If ans <> vbOK Then Exit Sub

    Application.ScreenUpdating = False
    On Error GoTo ErrHandler

    ' 全セルをロックしてから、入力セルのロックを外す
    For Each ws In ThisWorkbook.Worksheets
        ws.Unprotect
        ws.Cells.Locked = True
    Next ws

    wsGuide.Range("C6:C9").Locked = False
    wsGuide.Range(INPUT_COLOR_CELL).Locked = False
    wsGuide.Range(ENTER_JUMP_CELL).Locked = False
    ThisWorkbook.Worksheets(SHEET_PREV).Range("E8:E332").Locked = False
    For r = LIST_FIRST_ROW To LIST_LAST_ROW
        Set target = GetTargetCellFromListRow(wsList, r)
        If Not target Is Nothing Then target.Locked = False
    Next r

    ' 書式変更・フィルター・並べ替えは許可する
    For Each ws In ThisWorkbook.Worksheets
        ws.Protect DrawingObjects:=False, Contents:=True, Scenarios:=True, _
                   AllowFormattingCells:=True, AllowFormattingColumns:=True, _
                   AllowFormattingRows:=True, AllowFiltering:=True, AllowSorting:=True
    Next ws

    Application.ScreenUpdating = True
    MsgBox "全シートを保護しました。", vbInformation, "シート保護"
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "シート保護の設定中にエラーが発生しました。" & vbCrLf & Err.Description, vbExclamation, "シート保護"
End Sub

' ------------------------------------------------------------------------------------------
' 来年度への繰越
' 1. ブックのバックアップを保存  2. 前年度貼付のF列の値をE列へ貼り付け  3. 年度を+1
' ------------------------------------------------------------------------------------------
Public Sub RollOverToNextYear()
    Dim wsGuide As Worksheet
    Dim wsPaste As Worksheet
    Dim ws As Worksheet
    Dim curYear As Long
    Dim nextYear As Long
    Dim ans As VbMsgBoxResult
    Dim backupPath As String
    Dim ext As String

    Set wsGuide = GetSheet(SHEET_GUIDE)
    Set wsPaste = GetSheet(SHEET_PREV)
    If wsGuide Is Nothing Or wsPaste Is Nothing Then
        MsgBox "「" & SHEET_GUIDE & "」「" & SHEET_PREV & "」のいずれかが見つかりません。", vbExclamation
        Exit Sub
    End If

    curYear = CLng(Val(wsGuide.Range("C6").Value))
    nextYear = curYear + 1

    ans = MsgBox("令和" & nextYear & "年度分の作成に切り替えます。次の処理を実行しますか？" & vbCrLf & vbCrLf & _
                 "1. 令和" & curYear & "年度のブックをバックアップとして保存" & vbCrLf & _
                 "2. 「" & SHEET_PREV & "」のF列（今年度の値）をE列（前年度の値）へ値のみ貼り付け" & vbCrLf & _
                 "3. 「" & SHEET_GUIDE & "」の対象年度を令和" & nextYear & "年度、作成年を令和" & (nextYear + 1) & "年に変更" & vbCrLf & vbCrLf & _
                 "今年度の決算が確定していることを確認してから実行してください。", _
                 vbYesNo + vbExclamation, "来年度への繰越")
    If ans <> vbYes Then Exit Sub

    ' バックアップ（保存済みのブックのみ）。拡張子は元のブックに合わせる
    If ThisWorkbook.Path = "" Then
        If MsgBox("このブックはまだ保存されていないため、バックアップを作成できません。" & vbCrLf & _
                  "バックアップなしで続行しますか？", vbYesNo + vbExclamation, "来年度への繰越") <> vbYes Then Exit Sub
    Else
        ext = Mid$(ThisWorkbook.Name, InStrRev(ThisWorkbook.Name, "."))
        backupPath = ThisWorkbook.Path & Application.PathSeparator & _
                     "Backup_令和" & curYear & "年度決算書_" & Format$(Now, "yyyymmdd_hhnnss") & ext
        On Error Resume Next
        ThisWorkbook.SaveCopyAs backupPath
        If Err.Number <> 0 Then
            Err.Clear
            On Error GoTo 0
            MsgBox "バックアップの保存に失敗したため、処理を中止しました。", vbCritical, "来年度への繰越"
            Exit Sub
        End If
        On Error GoTo 0
    End If

    Application.ScreenUpdating = False

    On Error Resume Next
    For Each ws In ThisWorkbook.Worksheets
        ws.Unprotect
    Next ws
    On Error GoTo 0

    ' F列は数式のため、再計算してから値だけをE列へ貼り付ける
    Application.CalculateFull
    wsPaste.Range("E8:E332").Value = wsPaste.Range("F8:F332").Value

    wsGuide.Range("C6").Value = nextYear
    wsGuide.Range("C7").Value = nextYear + 1

    Application.CalculateFull
    Application.ScreenUpdating = True

    wsGuide.Activate
    wsGuide.Range("C6").Select

    MsgBox "令和" & nextYear & "年度への繰越処理が完了しました。" & vbCrLf & vbCrLf & _
           "前年度欄・前期繰越欄・前年度徴収率（「" & SHEET_PREV & "」E8:E332）を更新しました。" & _
           IIf(backupPath <> "", vbCrLf & "バックアップ：" & backupPath, "") & vbCrLf & vbCrLf & _
           "シート保護は解除されています。必要に応じて再度設定してください。", _
           vbInformation, "来年度への繰越"
End Sub

' ------------------------------------------------------------------------------------------
' Enterキーで次の手入力セルへ移動
'   ・Enter       次の手入力セル（入力セル一覧の順）へ。別のシートにあるときはそのシートへ移る
'   ・Shift+Enter 前の手入力セルへ
'   ・手入力セル以外では、Enter は通常どおり（設定した方向へ1セル）動く
'   ・入力ガイドの G19 が 1 のときだけ有効。このブックがアクティブな間だけキー割り当てを変える
' ------------------------------------------------------------------------------------------
Public Sub ToggleEnterJump()
    Dim ws As Worksheet

    Set ws = GetSheet(SHEET_GUIDE)
    If ws Is Nothing Then Exit Sub

    On Error GoTo ErrHandler
    If ws.Range(ENTER_JUMP_CELL).Value = 1 Then
        ws.Range(ENTER_JUMP_CELL).Value = 0
        Call DisableEnterKey
        MsgBox "Enterキーを通常の動作に戻しました。", vbInformation, "Enterキーの移動"
    Else
        ws.Range(ENTER_JUMP_CELL).Value = 1
        Call EnableEnterKey
        MsgBox "Enterキーで次の手入力セルへ移動します。" & vbCrLf & _
               "Shift+Enterで前の手入力セルへ戻ります。", vbInformation, "Enterキーの移動"
    End If
    Exit Sub

ErrHandler:
    MsgBox "切り替えられませんでした。「" & SHEET_GUIDE & "」シートが保護されている場合は保護を解除してください。", vbExclamation
End Sub

Public Function EnterJumpEnabled() As Boolean
    Dim ws As Worksheet

    Set ws = GetSheet(SHEET_GUIDE)
    If ws Is Nothing Then Exit Function
    On Error Resume Next
    EnterJumpEnabled = (ws.Range(ENTER_JUMP_CELL).Value = 1)
    On Error GoTo 0
End Function

' ブックを開いたとき・アクティブになったときに、Enterキーの割り当てを設定する
Public Sub EnableEnterKey()
    Dim book As String

    If mInCount = 0 Then Call BuildInputOrder
    If Not EnterJumpEnabled() Or mInCount = 0 Then
        Call DisableEnterKey
        Exit Sub
    End If

    book = "'" & ThisWorkbook.Name & "'!"
    Call SetOnKey("~", book & "EnterKeyForward")
    Call SetOnKey("{ENTER}", book & "EnterKeyForward")
    Call SetOnKey("+~", book & "EnterKeyBackward")
    Call SetOnKey("+{ENTER}", book & "EnterKeyBackward")
End Sub

' 他のブックに切り替えたとき・閉じるときに、Enterキーを元に戻す
Public Sub DisableEnterKey()
    Call SetOnKey("~", "")
    Call SetOnKey("{ENTER}", "")
    Call SetOnKey("+~", "")
    Call SetOnKey("+{ENTER}", "")
End Sub

' キー割り当ての設定。別のファイルを開く途中（保護ビューなどで有効なブックがない間）は
' OnKey が失敗することがあるが、エラーは出さずに無視する。
Private Sub SetOnKey(ByVal key As String, ByVal proc As String)
    On Error Resume Next
    If proc = "" Then
        Application.OnKey key
    Else
        Application.OnKey key, proc
    End If
    Err.Clear
    On Error GoTo 0
End Sub

' 入力セル一覧の並びで、手入力セルの一覧を作る
Public Sub BuildInputOrder()
    Dim wsList As Worksheet
    Dim r As Long
    Dim target As Range
    Dim addr As String

    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then Exit Sub

    mInCount = 0
    Set mInIndex = New Collection
    ReDim mInSheet(1 To LIST_LAST_ROW - LIST_FIRST_ROW + 1)
    ReDim mInAddr(1 To LIST_LAST_ROW - LIST_FIRST_ROW + 1)

    For r = LIST_FIRST_ROW To LIST_LAST_ROW
        Set target = GetTargetCellFromListRow(wsList, r)
        If Not target Is Nothing Then
            addr = target.Address(False, False)
            mInCount = mInCount + 1
            mInSheet(mInCount) = target.Worksheet.Name
            mInAddr(mInCount) = addr
            On Error Resume Next
            mInIndex.Add mInCount, target.Worksheet.Name & "!" & addr
            On Error GoTo 0
        End If
    Next r
End Sub

' セルが手入力セルなら、その番号（1～）を返す。違えば 0
Private Function InputIndexOf(ByVal cell As Range) As Long
    Dim key As String

    If mInIndex Is Nothing Then Exit Function
    On Error Resume Next
    key = cell.Worksheet.Name & "!" & cell.MergeArea.Cells(1, 1).Address(False, False)
    InputIndexOf = CLng(mInIndex(key))
    If Err.Number <> 0 Then InputIndexOf = 0
    Err.Clear
    On Error GoTo 0
End Function

Private Sub GoToInput(ByVal idx As Long)
    Dim ws As Worksheet

    If idx < 1 Or idx > mInCount Then Exit Sub
    Set ws = GetSheet(mInSheet(idx))
    If ws Is Nothing Then Exit Sub
    If ws.Visible <> xlSheetVisible Then Exit Sub

    On Error Resume Next
    If Not ActiveSheet Is ws Then ws.Activate
    ws.Range(mInAddr(idx)).Select
    On Error GoTo 0
End Sub

' Excel の Enter が動かす先のセル（backward=True のときは Shift+Enter の先）
Private Function EnterMoveTarget(ByVal cell As Range, ByVal backward As Boolean) As Range
    Dim area As Range
    Dim dirn As Long
    Dim ws As Worksheet

    If Not Application.MoveAfterReturn Then Exit Function
    Set area = cell.MergeArea
    Set ws = cell.Worksheet
    dirn = Application.MoveAfterReturnDirection

    If backward Then
        Select Case dirn
            Case xlDown: dirn = xlUp
            Case xlUp: dirn = xlDown
            Case xlToRight: dirn = xlToLeft
            Case xlToLeft: dirn = xlToRight
        End Select
    End If

    On Error Resume Next
    Select Case dirn
        Case xlDown: Set EnterMoveTarget = ws.Cells(area.Row + area.Rows.Count, area.Column)
        Case xlUp: Set EnterMoveTarget = ws.Cells(area.Row - 1, area.Column)
        Case xlToRight: Set EnterMoveTarget = ws.Cells(area.Row, area.Column + area.Columns.Count)
        Case xlToLeft: Set EnterMoveTarget = ws.Cells(area.Row, area.Column - 1)
    End Select
    On Error GoTo 0
End Function

Public Sub EnterKeyForward()
    Call EnterKeyMove(False)
End Sub

Public Sub EnterKeyBackward()
    Call EnterKeyMove(True)
End Sub

' 入力待ちの状態で Enter が押されたとき
Private Sub EnterKeyMove(ByVal backward As Boolean)
    Dim cell As Range
    Dim idx As Long
    Dim tgt As Range

    On Error Resume Next
    ' 他のブックが前面のときは割り当てを戻し、通常の Enter と同じ動きにする
    If Not ActiveWorkbook Is ThisWorkbook Then
        Call DisableEnterKey
        Set tgt = EnterMoveTarget(ActiveCell, backward)
        If Not tgt Is Nothing Then tgt.Select
        Exit Sub
    End If
    If TypeName(Selection) <> "Range" Then Exit Sub

    ' コピー中の Enter は貼り付け（Excel の通常の動作）
    If Application.CutCopyMode <> 0 Then
        ActiveSheet.Paste
        Application.CutCopyMode = False
        Exit Sub
    End If

    Set cell = ActiveCell
    If cell Is Nothing Then Exit Sub
    idx = InputIndexOf(cell)
    On Error GoTo 0

    If idx > 0 Then
        Call GoToInput(IIf(backward, idx - 1, idx + 1))
    Else
        ' 手入力セル以外は通常の Enter と同じ動き
        Set tgt = EnterMoveTarget(cell, backward)
        If Not tgt Is Nothing Then
            On Error Resume Next
            tgt.Select
            On Error GoTo 0
        End If
    End If
End Sub

' 手入力セルに値が入力されたとき（Workbook_SheetChange から呼ばれる）。
' Enter で確定した場合は、Excel が動かしたあとで次の手入力セルへ移動する。
Public Sub OnInputCellChanged(ByVal Target As Range)
    Dim cell As Range

    If Not EnterJumpEnabled() Then Exit Sub
    Set cell = Target.Cells(1, 1)
    If Target.Cells.Count <> cell.MergeArea.Cells.Count Then Exit Sub
    If InputIndexOf(cell) = 0 Then Exit Sub

    mPendSheet = cell.Worksheet.Name
    mPendAddr = cell.Address(False, False)
    Application.OnTime Now, "'" & ThisWorkbook.Name & "'!AfterInputCommit"
End Sub

Public Sub AfterInputCommit()
    Dim ws As Worksheet
    Dim cell As Range
    Dim act As Range
    Dim fwd As Range
    Dim back As Range
    Dim idx As Long

    Set ws = GetSheet(mPendSheet)
    If ws Is Nothing Then Exit Sub
    On Error Resume Next
    If ActiveSheet.Name <> mPendSheet Then Exit Sub
    Set act = ActiveCell
    On Error GoTo 0
    If act Is Nothing Then Exit Sub

    Set cell = ws.Range(mPendAddr)
    idx = InputIndexOf(cell)
    If idx = 0 Then Exit Sub

    Set fwd = EnterMoveTarget(cell, False)
    Set back = EnterMoveTarget(cell, True)

    If Not fwd Is Nothing Then
        If act.Address = fwd.MergeArea.Cells(1, 1).Address Then
            Call GoToInput(idx + 1)
            Exit Sub
        End If
    End If
    If Not back Is Nothing Then
        If act.Address = back.MergeArea.Cells(1, 1).Address Then
            Call GoToInput(idx - 1)
            Exit Sub
        End If
    End If
    ' Enter で動かない設定（MoveAfterReturn=False）のときは、入力したセルに残っている
    If Not Application.MoveAfterReturn Then
        If act.Address = cell.MergeArea.Cells(1, 1).Address Then Call GoToInput(idx + 1)
    End If
    ' Tab・矢印キー・マウスで動いたときは、そのまま
End Sub

' ------------------------------------------------------------------------------------------
' 共通
' ------------------------------------------------------------------------------------------
Private Function GetSheet(ByVal sName As String) As Worksheet
    On Error Resume Next
    Set GetSheet = ThisWorkbook.Worksheets(sName)
    On Error GoTo 0
End Function

' セルの値を Long で返す。エラー値・数値以外は -1
Private Function ToLongOrMinus1(ByVal c As Range) As Long
    If IsError(c.Value) Then
        ToLongOrMinus1 = -1
    ElseIf IsNumeric(c.Value) And Not IsEmpty(c.Value) Then
        ToLongOrMinus1 = CLng(c.Value)
    Else
        ToLongOrMinus1 = -1
    End If
End Function
