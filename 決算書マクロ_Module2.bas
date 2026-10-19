Attribute VB_Name = "Module2"
Option Explicit

' 広島市職員共済組合 決算書 補助マクロ
' 帳票シートの印刷範囲・列幅・行高・罫線・図形は変更しない。
' 変更するのは手入力セルの背景色（色付け表示のON/OFF）とシート保護のみ。

' 手入力セルの色付け表示に使う色 RGB(255, 255, 204)。「貸付_入力」シートの入力欄と同じ色。
Private Const INPUT_HIGHLIGHT_COLOR As Long = 13434879

Private Const SHEET_GUIDE As String = "入力ガイド"
Private Const SHEET_LIST As String = "入力セル一覧"
Private Const SHEET_PREV As String = "前年度貼付"
Private Const SHEET_CHECK As String = "チェック"
Private Const SHEET_LOAN_INPUT As String = "貸付_入力"

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

    msg = "実行する処理の番号（1～8）を入力してください。" & vbCrLf & vbCrLf & _
          " 1  整合性チェックの結果確認" & vbCrLf & _
          " 2  手入力セルの色付け表示 ON/OFF" & vbCrLf & _
          " 3  未入力セルへ移動" & vbCrLf & _
          " 4  帳票のPDF出力" & vbCrLf & _
          " 5  帳票の印刷プレビュー" & vbCrLf & _
          " 6  シート保護 ON/OFF" & vbCrLf & _
          " 7  来年度への繰越" & vbCrLf & _
          " 8  入力ガイドにボタンを配置"

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
' 手入力セルの色付け表示 ON/OFF
' 帳票にもともと塗りがあるセル（黄色など）は変更しない。
' ------------------------------------------------------------------------------------------
Public Sub ToggleInputHighlight()
    Dim ans As VbMsgBoxResult

    If CountHighlightedCells() > 0 Then
        Call ApplyInputHighlight(False)
        MsgBox "手入力セルの色付けを解除しました。", vbInformation, "入力セル色付け"
    Else
        ans = MsgBox("帳票シートの手入力セルを薄黄色で表示します。" & vbCrLf & _
                     "もう一度実行するか、PDF出力・印刷プレビューを実行すると解除されます。" & vbCrLf & _
                     "もともと塗りつぶしのあるセルは変更しません。", _
                     vbOKCancel + vbQuestion, "入力セル色付け")
        If ans = vbOK Then
            Call ApplyInputHighlight(True)
            MsgBox "手入力セルを色付けしました。", vbInformation, "入力セル色付け"
        End If
    End If
End Sub

Public Sub ApplyInputHighlight(ByVal turnOn As Boolean)
    Dim wsList As Worksheet
    Dim r As Long
    Dim target As Range

    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then Exit Sub

    Application.ScreenUpdating = False
    For r = LIST_FIRST_ROW To LIST_LAST_ROW
        Set target = GetTargetCellFromListRow(wsList, r)
        ' 「貸付_入力」シートは入力欄が常に色付きのため対象外
        If Not target Is Nothing Then
            If target.Worksheet.Name <> SHEET_LOAN_INPUT Then
                If turnOn Then
                    If target.Interior.ColorIndex = xlNone Then target.Interior.Color = INPUT_HIGHLIGHT_COLOR
                Else
                    If target.Interior.Pattern = xlSolid And target.Interior.Color = INPUT_HIGHLIGHT_COLOR Then
                        target.Interior.ColorIndex = xlNone
                    End If
                End If
            End If
        End If
    Next r
    Application.ScreenUpdating = True
End Sub

' 色付け中のセル数（色付け状態の判定用）
Private Function CountHighlightedCells() As Long
    Dim wsList As Worksheet
    Dim r As Long
    Dim target As Range
    Dim n As Long

    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then Exit Function

    For r = LIST_FIRST_ROW To LIST_LAST_ROW
        Set target = GetTargetCellFromListRow(wsList, r)
        If Not target Is Nothing Then
            If target.Worksheet.Name <> SHEET_LOAN_INPUT Then
                If target.Interior.Pattern = xlSolid And target.Interior.Color = INPUT_HIGHLIGHT_COLOR Then
                    n = n + 1
                    Exit For
                End If
            End If
        End If
    Next r
    CountHighlightedCells = n
End Function

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
    Dim ws As Worksheet
    Dim pdfPath As String
    Dim fy As String
    Dim defaultFileName As String

    fy = CStr(ThisWorkbook.Worksheets(SHEET_GUIDE).Range("C6").Value)
    mode = Trim$(InputBox("出力する範囲の番号（1～3）を入力してください。" & vbCrLf & vbCrLf & _
                          " 1  全帳票（表紙・目次・事業状況報告書・決算報告書・各経理の財務諸表）" & vbCrLf & _
                          " 2  表紙・目次・事業状況報告書・決算報告書のみ" & vbCrLf & _
                          " 3  各経理の財務諸表・附属明細表・決算精算表のみ", _
                          "PDF出力", "1"))
    If mode = "" Then Exit Sub
    If mode <> "1" And mode <> "2" And mode <> "3" Then
        MsgBox "1～3 の番号を入力してください。", vbExclamation
        Exit Sub
    End If

    ' 色付け表示は出力前に解除する
    Call ApplyInputHighlight(False)

    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = xlSheetVisible Then
            If IsPrintableFormSheet(ws.Name, mode, False) Then
                cnt = cnt + 1
                ReDim Preserve sheetNames(1 To cnt)
                sheetNames(cnt) = ws.Name
            End If
        End If
    Next ws

    If cnt = 0 Then
        MsgBox "出力対象の帳票シートがありません。", vbExclamation
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

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    ThisWorkbook.Activate
    ThisWorkbook.Worksheets(sheetNames).Select
    ActiveSheet.ExportAsFixedFormat Type:=xlTypePDF, _
                                    Filename:=pdfPath, _
                                    Quality:=xlQualityStandard, _
                                    IncludeDocProperties:=True, _
                                    IgnorePrintAreas:=False, _
                                    OpenAfterPublish:=True
    ThisWorkbook.Worksheets(SHEET_GUIDE).Select
    Application.ScreenUpdating = True

    MsgBox cnt & " シートをPDFに出力しました。" & vbCrLf & pdfPath, vbInformation, "PDF出力"
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    ThisWorkbook.Worksheets(SHEET_GUIDE).Select
    MsgBox "PDF出力中にエラーが発生しました。" & vbCrLf & Err.Description, vbCritical, "PDF出力"
End Sub

' ------------------------------------------------------------------------------------------
' 帳票の印刷プレビュー（プレビュー画面から印刷できる）
' ------------------------------------------------------------------------------------------
Public Sub PrintFormsWizard()
    Dim includeBlank As VbMsgBoxResult
    Dim sheetNames() As String
    Dim cnt As Long
    Dim ws As Worksheet

    includeBlank = MsgBox("全帳票の印刷プレビューを表示します。" & vbCrLf & _
                          "印刷範囲・余白・改ページは各シートの設定のままです。" & vbCrLf & vbCrLf & _
                          "両面印刷の調整用白紙シート（「白紙」を含むシート）を含めますか？" & vbCrLf & _
                          "　はい　　：含める" & vbCrLf & _
                          "　いいえ：含めない", _
                          vbYesNoCancel + vbQuestion, "印刷プレビュー")
    If includeBlank = vbCancel Then Exit Sub

    ' 色付け表示は印刷前に解除する
    Call ApplyInputHighlight(False)

    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = xlSheetVisible Then
            If IsPrintableFormSheet(ws.Name, "1", (includeBlank = vbYes)) Then
                cnt = cnt + 1
                ReDim Preserve sheetNames(1 To cnt)
                sheetNames(cnt) = ws.Name
            End If
        End If
    Next ws

    If cnt = 0 Then
        MsgBox "印刷対象の帳票シートがありません。", vbExclamation
        Exit Sub
    End If

    ThisWorkbook.Activate
    ThisWorkbook.Worksheets(sheetNames).PrintPreview
    ThisWorkbook.Worksheets(SHEET_GUIDE).Select
End Sub

Private Function IsPrintableFormSheet(ByVal sName As String, ByVal mode As String, _
                                      ByVal includeBlankSheets As Boolean) As Boolean
    ' 管理用・内部計算用のシートは対象外
    Select Case sName
        Case SHEET_GUIDE, SHEET_LIST, SHEET_PREV, SHEET_CHECK, SHEET_LOAN_INPUT, _
             "報告_P8グラフデータ", "報告_預託金のカメラ"
            IsPrintableFormSheet = False
            Exit Function
    End Select

    If InStr(sName, "白紙") > 0 Then
        IsPrintableFormSheet = includeBlankSheets
        Exit Function
    End If

    Select Case mode
        Case "2"
            IsPrintableFormSheet = (sName = "表紙等" Or sName = "目次" Or Left$(sName, 3) = "報告_")
        Case "3"
            IsPrintableFormSheet = Not (sName = "表紙等" Or sName = "目次" Or Left$(sName, 3) = "報告_")
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
                 "　・入力ガイド C6:C9" & vbCrLf & _
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
