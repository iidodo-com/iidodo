Attribute VB_Name = "mod予算書ブック"
Option Explicit

' 広島市職員共済組合 事業計画概況・予算書 補助マクロ
' 帳票シートの印刷範囲・列幅・行高・罫線・図形は変更しない。
' 変更するのは、手入力セルの黄色表示の切替（入力ガイドのE9）、Enterキーの移動（G9）、シート保護、
' PDF出力・印刷プレビュー用の一時コピー（出力後に削除）、カメラ図の更新のみ。
' （決算書ブックの補助マクロを、この予算書ブック向けに作り直したもの）

' 手入力セルの黄色は条件付き書式で表示している。入力ガイドのこのセルが 1 のときだけ表示される。
Private Const INPUT_COLOR_CELL As String = "E9"
Public gInputColorSuspended As Boolean
Public gInputColorBackup As Variant

' Enterキーで次の手入力セルへ移動する機能のオン／オフ（入力ガイドのこのセルが 1 のとき有効）
Private Const ENTER_JUMP_CELL As String = "G9"

Private mInSheet() As String
Private mInAddr() As String
Private mInCount As Long
Private mInIndex As Collection

Private mPendSheet As String
Private mPendAddr As String

Private Const SHEET_GUIDE As String = "入力ガイド"
Private Const SHEET_LIST As String = "入力セル一覧"
Private Const SHEET_CHECK As String = "チェック"
Private Const COVER_SHEET As String = "表紙等"
Private Const TOC_SHEET As String = "目次"
Private Const TEMP_PREFIX As String = "_tmp表紙"

' 入力セル一覧の明細は6行目から。最終行は実際のデータで求める
Private Const LIST_FIRST_ROW As Long = 6
' チェックシートの明細は7行目から
Private Const CHECK_FIRST_ROW As Long = 7

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
          " 7  カメラ図の更新" & vbCrLf & _
          " 8  入力ガイドにボタンを配置" & vbCrLf & _
          " 9  Enterキーで次の手入力セルへ移動 ON/OFF"

    ans = InputBox(msg, "予算書 マクロメニュー", "1")
    Select Case Trim$(ans)
        Case "1": Call RunFullCheckAndDiagnose
        Case "2": Call ToggleInputHighlight
        Case "3": Call JumpToNextUnfilledCell
        Case "4": Call ExportFormsToPDF
        Case "5": Call PrintFormsWizard
        Case "6": Call ToggleSheetProtection
        Case "7": Call RefreshCameraPictures
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

    For i = ws.Shapes.Count To 1 Step -1
        If Left$(ws.Shapes(i).Name, 4) = "Btn_" Then ws.Shapes(i).Delete
    Next i

    ' 名前, 表示文字, マクロ名, セル
    defs = Array( _
        Array("Btn_Menu", "メニュー", "ShowCommandMenu", "A10"), _
        Array("Btn_Check", "整合性チェック", "RunFullCheckAndDiagnose", "B10"), _
        Array("Btn_Highlight", "入力セル色付け", "ToggleInputHighlight", "C10"), _
        Array("Btn_Jump", "未入力セルへ移動", "JumpToNextUnfilledCell", "D10"), _
        Array("Btn_Pdf", "PDF出力", "ExportFormsToPDF", "A20"), _
        Array("Btn_Print", "印刷プレビュー", "PrintFormsWizard", "B20"), _
        Array("Btn_Protect", "シート保護", "ToggleSheetProtection", "C20"), _
        Array("Btn_Camera", "カメラ図の更新", "RefreshCameraPictures", "D20"))

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
    Dim ngCount As Long
    Dim totalChecks As Long
    Dim blankCount As Long
    Dim r As Long
    Dim lastRow As Long
    Dim firstNgRow As Long
    Dim shown As Long
    Dim ngDetails As String

    Set wsChk = GetSheet(SHEET_CHECK)
    Set wsList = GetSheet(SHEET_LIST)
    If wsChk Is Nothing Or wsList Is Nothing Then
        MsgBox "「" & SHEET_CHECK & "」「" & SHEET_LIST & "」のいずれかが見つかりません。", vbExclamation
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
        wsList.Range(wsList.Cells(LIST_FIRST_ROW, 7), wsList.Cells(ListLastRow(), 7)), "未入力（空欄）")

    If ngCount = 0 Then
        MsgBox "整合性チェック：全 " & totalChecks & " 項目 異常なし" & vbCrLf & _
               "手入力セルの空欄：" & blankCount & " 件（該当額が0円の場合は空欄のままで構いません）", _
               vbInformation, "整合性チェック"
        Exit Sub
    End If

    lastRow = wsChk.Cells(wsChk.Rows.Count, 1).End(xlUp).Row
    For r = CHECK_FIRST_ROW To lastRow
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

' ------------------------------------------------------------------------------------------
' 入力セル一覧の行から対象セルを取得する（C列のHYPERLINK式の「!」以降を使う）
' ------------------------------------------------------------------------------------------
Private Function ListLastRow() As Long
    Dim wsList As Worksheet
    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then Exit Function
    ListLastRow = wsList.Cells(wsList.Rows.Count, 3).End(xlUp).Row
    If ListLastRow < LIST_FIRST_ROW Then ListLastRow = LIST_FIRST_ROW
End Function

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
    Dim lastRow As Long
    Dim target As Range

    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then
        MsgBox "「" & SHEET_LIST & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If
    lastRow = ListLastRow()
    If lastRowChecked < LIST_FIRST_ROW Or lastRowChecked >= lastRow Then lastRowChecked = LIST_FIRST_ROW - 1

    For r = lastRowChecked + 1 To lastRow
        If CStr(wsList.Cells(r, 7).Value) = "未入力（空欄）" Then
            Set target = GetTargetCellFromListRow(wsList, r)
            If Not target Is Nothing Then
                lastRowChecked = r
                target.Worksheet.Activate
                target.Select
                MsgBox "未入力のセルへ移動しました（" & (r - LIST_FIRST_ROW + 1) & " / " & _
                       (lastRow - LIST_FIRST_ROW + 1) & "）" & vbCrLf & vbCrLf & _
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
' カメラ図の更新
' 概況ページの表は、カメラ元表の範囲を図で表示している。リンクされた図（カメラ）は自動で更新されるが、
' 図が静止画になっていた場合は、リンクされた図として作り直す。
' ------------------------------------------------------------------------------------------
Public Sub RefreshCameraPictures()
    Dim m As Variant
    Dim i As Long
    Dim parts() As String
    Dim ws As Worksheet
    Dim srcWs As Worksheet
    Dim shp As Shape
    Dim cnt As Long
    Dim k As Long
    Dim target As Shape
    Dim L As Double, T As Double, W As Double, H As Double
    Dim pic As Object
    Dim fixedCount As Long
    Dim failed As String
    Dim prevSheet As Object
    Dim prevCalc As Boolean

    m = CameraMap()
    Set prevSheet = ActiveSheet
    prevCalc = Application.ScreenUpdating
    Application.ScreenUpdating = False
    On Error GoTo ErrHandler

    For i = LBound(m) To UBound(m)
        parts = Split(CStr(m(i)), "|")
        Set ws = GetSheet(parts(0))
        Set srcWs = GetSheet(parts(2))
        If Not ws Is Nothing And Not srcWs Is Nothing Then
            k = 0
            Set target = Nothing
            For Each shp In ws.Shapes
                If shp.Type = msoLinkedPicture Or shp.Type = msoPicture Then
                    k = k + 1
                    If k = CLng(parts(1)) Then
                        Set target = shp
                        Exit For
                    End If
                End If
            Next shp
            If Not target Is Nothing Then
                If target.Type = msoLinkedPicture Then
                    target.DrawingObject.Formula = "='" & parts(2) & "'!" & parts(3)
                Else
                    L = target.Left: T = target.Top: W = target.Width: H = target.Height
                    srcWs.Range(parts(3)).Copy
                    ws.Activate
                    Set pic = ws.Pictures.Paste(True)
                    pic.Left = L: pic.Top = T: pic.Width = W: pic.Height = H
                    target.Delete
                    Application.CutCopyMode = False
                    fixedCount = fixedCount + 1
                End If
                cnt = cnt + 1
            Else
                failed = failed & parts(0) & "（" & parts(1) & "番目の図）" & vbCrLf
            End If
        End If
    Next i

    prevSheet.Activate
    Application.ScreenUpdating = prevCalc
    If Len(failed) > 0 Then
        MsgBox "更新できなかった図があります。" & vbCrLf & failed, vbExclamation, "カメラ図の更新"
    End If
    Exit Sub

ErrHandler:
    Application.CutCopyMode = False
    Application.ScreenUpdating = True
    MsgBox "カメラ図の更新中にエラーが発生しました。" & vbCrLf & Err.Description, vbExclamation, "カメラ図の更新"
End Sub

' カメラ図の対応表： シート名|図の番号（シート内の図の順）|転記元シート|転記元の範囲
Private Function CameraMap() As Variant
    Dim m(1 To 34) As String
    m(1) = "総括_総－2|1|総括_2.3ｶﾒラ|$A$2:$J$17"
    m(2) = "総括_総－3|1|総括_2.3ｶﾒラ|$A$21:$J$59"
    m(3) = "総括_総－4|1|総括_4ｶﾒラ|$A$1:$J$30"
    m(4) = "総括_総－5|1|総括_5ｶﾒラ|$A$29:$M$42"
    m(5) = "総括_総－5|2|総括_5ｶﾒラ|$P$3:$S$5"
    m(6) = "総括_総－5|3|総括_5ｶﾒラ|$V$3:$AE$13"
    m(7) = "短期_概況_短－１|1|短期_カメラ１|$B$26:$K$38"
    m(8) = "短期_概況_短－１|2|短期_カメラ１|$B$61:$K$69"
    m(9) = "短期_概況_短－１|3|短期_カメラ１|$B$74:$K$82"
    m(10) = "短期_概況_短－２|1|短期_カメラ１|$O$3:$R$5"
    m(11) = "短期_概況_短－２|2|短期_カメラ１|$U$3:$AE$13"
    m(12) = "短期_概況_短－２|3|短期_カメラ２|$B$2:$L$24"
    m(13) = "短期_概況_短－３|1|短期_カメラ２(2)|$B$2:$G$60"
    m(14) = "厚年_概況|1|厚年_長ｶﾒ2|$O$2:$U$19"
    m(15) = "厚年_概況|2|厚年_長ｶﾒ1|$C$8:$J$9"
    m(16) = "厚年_概況|3|厚年_長ｶﾒ1|$X$5:$AA$7"
    m(17) = "厚年_概況|4|厚年_長ｶﾒ1|$O$1:$V$4"
    m(18) = "退職等_概況|1|退職等_長ｶﾒ2|$B$2:$H$17"
    m(19) = "退職等_概況|2|退職等_長ｶﾒ1|$F$1:$I$4"
    m(20) = "経過的_概況|1|経過的_長ｶﾒ2|$O$2:$T$16"
    m(21) = "経過的_概況|2|経過的_長ｶﾒ1|$G$5:$J$7"
    m(22) = "経過的_概況|3|経過的_長ｶﾒ1|$B$1:$E$4"
    m(23) = "預託金_概況|1|預託金_カメラ|$B$2:$L$9"
    m(24) = "預託金_概況|2|預託金_カメラ|$R$2:$AH$7"
    m(25) = "業務_概況|1|業務_業ｶﾒ|$K$14:$P$31"
    m(26) = "業務_概況|2|業務_業ｶﾒ|$B$2:$H$8"
    m(27) = "業務_概況|3|業務_業ｶﾒ|$B$10:$H$11"
    m(28) = "保健_概況_保健－1|1|保健_保ｶﾒ2|$B$1:$G$56"
    m(29) = "保健_概況_保健－1|2|保健_保ｶﾒ1|$C$5:$L$15"
    m(30) = "保健_概況_保健－2|1|保健_保ｶﾒ3|$B$2:$G$30"
    m(31) = "貸付_概況_貸-1|1|貸付_貸ｶﾒ2|$A$12:$F$25"
    m(32) = "貸付_概況_貸-1|2|貸付_貸ｶﾒ1|$M$12:$Q$18"
    m(33) = "貸付_概況_貸-2|1|貸付_貸ｶﾒ2|$H$12:$R$30"
    m(34) = "貸付_概況_貸-2|2|貸付_貸ｶﾒ3|$A$2:$F$16"
    CameraMap = m
End Function

' ------------------------------------------------------------------------------------------
' 帳票のPDF出力
' ------------------------------------------------------------------------------------------
Public Sub ExportFormsToPDF()
    Dim mode As String
    Dim sheetNames() As String
    Dim cnt As Long
    Dim pdfPath As String
    Dim defaultFileName As String

    mode = Trim$(InputBox("出力する範囲の番号（1～3）を入力してください。" & vbCrLf & _
                          "出力順は目次のとおりです（中扉を各セクションの前に入れます）。" & vbCrLf & vbCrLf & _
                          " 1  全帳票（表紙・目次・事業計画概況・予算）" & vbCrLf & _
                          " 2  表紙・目次・事業計画概況のみ" & vbCrLf & _
                          " 3  予算の中扉と、各経理の予算書のみ", _
                          "PDF出力", "1"))
    If mode = "" Then Exit Sub
    If mode <> "1" And mode <> "2" And mode <> "3" Then
        MsgBox "1～3 の番号を入力してください。", vbExclamation
        Exit Sub
    End If

    defaultFileName = "令和８年度_広島市職員共済組合_事業計画概況・予算書.pdf"
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

    Call SuspendInputColor

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    ThisWorkbook.Activate
    Call RefreshCameraPictures
    cnt = PrepareSheetList(mode, sheetNames)
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
    Dim sheetNames() As String
    Dim cnt As Long

    If MsgBox("全帳票の印刷プレビューを表示します。" & vbCrLf & _
              "表示順は目次のとおりです（中扉を各セクションの前に入れます）。" & vbCrLf & _
              "印刷範囲・余白・改ページは各シートの設定のままです。", _
              vbOKCancel + vbQuestion, "印刷プレビュー") <> vbOK Then Exit Sub

    Call SuspendInputColor

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    ThisWorkbook.Activate
    Call RefreshCameraPictures
    cnt = PrepareSheetList("1", sheetNames)
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
' 「表紙等」シートには、表紙と各中扉の計11ページが1枚に入っている。そのまま出力すると中扉が
' 先頭にまとまるため、区画ごとに一時コピーを作り、各セクションの直前に差し込んで出力する。
' 一時コピーは出力後に削除する。元のシートの並び順・書式・印刷設定は変更しない。
'   区画 1 表紙 / 2 事業計画概況 / 3 予算 / 4 短期 / 5 厚生年金 / 6 退職等年金 / 7 業務 /
'        8 保健 / 9 貸付 / 10 経過的長期 / 11 退職等年金預託金管理
' ------------------------------------------------------------------------------------------
' 事業計画概況のシート（目次の順）
Private Function GaikyoSheets() As Variant
    Dim a As Variant
    a = Array( _
        "総括_総－2", "総括_総－3", "総括_総－4", _
        "総括_総－5", "短期_概況_短－１", "短期_概況_短－２", _
        "短期_概況_短－３", "厚年_概況", "退職等_概況", _
        "経過的_概況", "預託金_概況", "業務_概況", _
        "保健_概況_保健－1", "保健_概況_保健－2", "貸付_概況_貸-1", _
        "貸付_概況_貸-2")
    GaikyoSheets = a
End Function

' 予算書のシート（目次の順）
Private Function YosanSheets() As Variant
    Dim a As Variant
    a = Array( _
        "短期_予算総則", "短期_予定損益", "短期_損益説明書", _
        "短期_予定貸借", "短期_貸借説明書", "厚年_予定損益", _
        "厚年_損益説明書", "厚年_予定貸借・説明", "退職等_予定損益", _
        "退職等_損益説明書", "退職等_予定貸借・説明", "経過的_予定損益", _
        "経過的_損益説明書", "経過的_予定貸借・説明", "預託金_予算総則", _
        "預託金_損益計算・説明", "預託金_貸借・説明", "業務_予算総則", _
        "業務_予定損益", "業務_損益説明書", "業務_予定貸借", _
        "業務_貸借説明書", "保健_予算総則", "保健_予定損益", _
        "保健_損益説明書", "保健_予定貸借", "保健_貸借説明書", _
        "貸付_予算総則", "貸付_予定損益", "貸付_損益説明書", _
        "貸付_予定貸借", "貸付_貸借説明書")
    YosanSheets = a
End Function

' 出力するシート名を目次の順に並べて返す（戻り値は件数）。一時コピーを作成する。
'   mode 1=全帳票 2=表紙・目次・事業計画概況 3=予算
Private Function PrepareSheetList(ByVal mode As String, ByRef names() As String) As Long
    Dim wsCover As Worksheet
    Dim cp As Worksheet
    Dim cnt As Long
    Dim v As Variant
    Dim anchors As Variant
    Dim i As Long

    Set wsCover = GetSheet(COVER_SHEET)
    If wsCover Is Nothing Then Err.Raise vbObjectError + 1, , "「" & COVER_SHEET & "」シートが見つかりません。"

    ' 区画の一時コピー（表紙等のA列～U列、行範囲）を、出力順に1枚ずつ作る
    '   順序, 区画の行範囲, 直前に置くシート, 出力する mode
    anchors = Array( _
        Array(1, "$A$1:$U$36", TOC_SHEET, "12"), _
        Array(2, "$A$37:$U$50", "総括_総－2", "12"), _
        Array(3, "$A$51:$U$64", "短期_予算総則", "13"), _
        Array(4, "$A$65:$U$78", "短期_予算総則", "13"), _
        Array(5, "$A$79:$U$92", "厚年_予定損益", "13"), _
        Array(6, "$A$93:$U$106", "退職等_予定損益", "13"), _
        Array(10, "$A$149:$U$162", "経過的_予定損益", "13"), _
        Array(11, "$A$163:$U$176", "預託金_予算総則", "13"), _
        Array(7, "$A$107:$U$120", "業務_予算総則", "13"), _
        Array(8, "$A$121:$U$134", "保健_予算総則", "13"), _
        Array(9, "$A$135:$U$148", "貸付_予算総則", "13"))
    For i = LBound(anchors) To UBound(anchors)
        If InStr(CStr(anchors(i)(3)), mode) > 0 Then
            If Not GetSheet(CStr(anchors(i)(2))) Is Nothing Then
                wsCover.Copy Before:=GetSheet(CStr(anchors(i)(2)))
                Set cp = ActiveSheet
                cp.Name = TEMP_PREFIX & Format$(CLng(anchors(i)(0)), "00")
                cp.PageSetup.PrintArea = CStr(anchors(i)(1))
            End If
        End If
    Next i

    ' 並び順は、シートの順に一時コピーを差し込んだ順（＝目次の順）
    Dim ws As Worksheet
    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = xlSheetVisible Then
            If IsOutputSheet(ws.Name, mode) Then
                cnt = cnt + 1
                ReDim Preserve names(1 To cnt)
                names(cnt) = ws.Name
            End If
        End If
    Next ws
    PrepareSheetList = cnt
End Function

Private Function InList(ByVal arr As Variant, ByVal s As String) As Boolean
    Dim v As Variant
    For Each v In arr
        If CStr(v) = s Then
            InList = True
            Exit Function
        End If
    Next v
End Function

' 出力対象か。管理用・カメラ元表・手持資料・非表示参考シートは対象外
Private Function IsOutputSheet(ByVal sName As String, ByVal mode As String) As Boolean
    If Left$(sName, Len(TEMP_PREFIX)) = TEMP_PREFIX Then
        IsOutputSheet = True
        Exit Function
    End If
    If sName = TOC_SHEET Then
        IsOutputSheet = (mode = "1" Or mode = "2")
    ElseIf InList(GaikyoSheets(), sName) Then
        IsOutputSheet = (mode = "1" Or mode = "2")
    ElseIf InList(YosanSheets(), sName) Then
        IsOutputSheet = (mode = "1" Or mode = "3")
    End If
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

' ------------------------------------------------------------------------------------------
' シート保護 ON/OFF（手入力セル以外を編集不可にする。パスワードなし）
' 数値の手入力セル＝黄色表示の条件付き書式の対象セル。文字だけの入力欄は保護中は編集できない。
' ------------------------------------------------------------------------------------------
Public Sub ToggleSheetProtection()
    Dim wsGuide As Worksheet
    Dim ws As Worksheet
    Dim fc As Object
    Dim ans As VbMsgBoxResult

    Set wsGuide = GetSheet(SHEET_GUIDE)
    If wsGuide Is Nothing Then
        MsgBox "「" & SHEET_GUIDE & "」シートが見つかりません。", vbExclamation
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
                 "　・入力ガイド E9・G9（表示・Enterキーの切替）" & vbCrLf & _
                 "　・各帳票・カメラ元表・手持資料の数値の手入力セル（黄色表示のセル）" & vbCrLf & _
                 "文字の入力欄（手持資料の説明など）は、保護を解除してから編集してください。" & vbCrLf & _
                 "パスワードは設定しません。同じ操作でいつでも解除できます。", _
                 vbOKCancel + vbQuestion, "シート保護")
    If ans <> vbOK Then Exit Sub

    Application.ScreenUpdating = False
    On Error GoTo ErrHandler

    For Each ws In ThisWorkbook.Worksheets
        ws.Unprotect
        ws.Cells.Locked = True
    Next ws

    wsGuide.Range(INPUT_COLOR_CELL).Locked = False
    wsGuide.Range(ENTER_JUMP_CELL).Locked = False
    For Each ws In ThisWorkbook.Worksheets
        If IsInputFormSheet(ws) Then
            For Each fc In ws.Cells.FormatConditions
                If fc.Type = xlExpression Then
                    If InStr(fc.Formula1, "ISFORMULA") > 0 Then fc.AppliesTo.Locked = False
                End If
            Next fc
        End If
    Next ws

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
' Enterキーで次の手入力セルへ移動
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

' 手入力セルの一覧を作る（タブの順に、各シートの黄色表示の対象セルを上から下・左から右の順に）
Public Sub BuildInputOrder()
    Dim ws As Worksheet
    Dim g As Variant

    mInCount = 0
    Set mInIndex = New Collection
    ReDim mInSheet(1 To 20000)
    ReDim mInAddr(1 To 20000)

    ' 1. 入力ガイドの設定欄
    For Each g In Array(INPUT_COLOR_CELL, ENTER_JUMP_CELL)
        Call AddInput(SHEET_GUIDE, CStr(g))
    Next g

    ' 2. 帳票シート（タブの順）
    For Each ws In ThisWorkbook.Worksheets
        If IsInputFormSheet(ws) Then Call AddSheetInputs(ws)
    Next ws
End Sub

' 手入力セルを持つシートか（管理用シートは除く）
Private Function IsInputFormSheet(ByVal ws As Worksheet) As Boolean
    Select Case ws.Name
        Case SHEET_GUIDE, SHEET_LIST, SHEET_CHECK
            IsInputFormSheet = False
        Case Else
            IsInputFormSheet = (ws.Visible = xlSheetVisible)
    End Select
End Function

' シートの「黄色表示」の条件付き書式（数式でないセルだけに適用）の対象セルを、並べて登録する
Private Sub AddSheetInputs(ByVal ws As Worksheet)
    Dim fc As Object
    Dim c As Range
    Dim keys() As Long
    Dim n As Long
    Dim i As Long
    Dim j As Long
    Dim tmp As Long
    Dim dup As Boolean

    ReDim keys(1 To 5000)
    On Error Resume Next
    For Each fc In ws.Cells.FormatConditions
        If fc.Type = xlExpression Then
            If InStr(fc.Formula1, "ISFORMULA") > 0 Then
                For Each c In fc.AppliesTo.Cells
                    If n < 5000 Then
                        n = n + 1
                        keys(n) = c.Row * 1000& + c.Column
                    End If
                Next c
            End If
        End If
    Next fc
    On Error GoTo 0
    If n = 0 Then Exit Sub

    ' 行→列の順に並べ替え（挿入ソート）
    For i = 2 To n
        tmp = keys(i)
        j = i - 1
        Do While j >= 1
            If keys(j) <= tmp Then Exit Do
            keys(j + 1) = keys(j)
            j = j - 1
        Loop
        keys(j + 1) = tmp
    Next i

    For i = 1 To n
        dup = False
        If i > 1 Then dup = (keys(i) = keys(i - 1))
        If Not dup Then
            Call AddInput(ws.Name, ws.Cells(keys(i) \ 1000&, keys(i) Mod 1000&).Address(False, False))
        End If
    Next i
End Sub

Private Sub AddInput(ByVal sName As String, ByVal addr As String)
    If mInCount >= 20000 Then Exit Sub
    mInCount = mInCount + 1
    mInSheet(mInCount) = sName
    mInAddr(mInCount) = addr
    On Error Resume Next
    mInIndex.Add mInCount, sName & "!" & addr
    On Error GoTo 0
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

    If mInCount = 0 Then Exit Sub
    If idx > mInCount Then idx = 1
    If idx < 1 Then idx = mInCount
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
    If Not ActiveWorkbook Is ThisWorkbook Then
        Call DisableEnterKey
        Set tgt = EnterMoveTarget(ActiveCell, backward)
        If Not tgt Is Nothing Then tgt.Select
        Exit Sub
    End If
    If TypeName(Selection) <> "Range" Then Exit Sub

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
    If Not Application.MoveAfterReturn Then
        If act.Address = cell.MergeArea.Cells(1, 1).Address Then Call GoToInput(idx + 1)
    End If
End Sub

' ------------------------------------------------------------------------------------------
' 共通
' ------------------------------------------------------------------------------------------
Private Function GetSheet(ByVal sName As String) As Worksheet
    On Error Resume Next
    Set GetSheet = ThisWorkbook.Worksheets(sName)
    On Error GoTo 0
End Function

Private Function ToLongOrMinus1(ByVal c As Range) As Long
    If IsError(c.Value) Then
        ToLongOrMinus1 = -1
    ElseIf IsNumeric(c.Value) And Not IsEmpty(c.Value) Then
        ToLongOrMinus1 = CLng(c.Value)
    Else
        ToLongOrMinus1 = -1
    End If
End Function
