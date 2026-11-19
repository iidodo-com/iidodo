Attribute VB_Name = "mod予算書ブック"
Option Explicit

' 広島市職員共済組合 事業計画概況・予算書 補助マクロ
' 帳票シートの印刷範囲・列幅・行高・罫線・図形は変更しない。
' 変更するのは、手入力セルの黄色表示の切替（入力ガイドのE9）、Enterキーの移動（G9）、シート保護、
' PDF出力・印刷プレビュー用の一時コピー（出力後に削除）、カメラ図の更新のみ。
' （決算書ブックの補助マクロを、この予算書ブック向けに作り直したもの）

' 手入力セルの黄色はセルの塗りで表示し、マクロで付け外しする。入力ガイドのこのセルが 1 のとき表示。
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
Private Const TEMP_PREFIX As String = "_tmp"

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
' 黄色はセルの塗り。元の塗りは入力セル一覧のH列に記録してあり、消すときに戻す。印刷には出さない。
' ------------------------------------------------------------------------------------------
Public Sub ToggleInputHighlight()
    Dim ws As Worksheet
    Dim turnOn As Boolean
    Dim prevEvents As Boolean

    Set ws = GetSheet(SHEET_GUIDE)
    If ws Is Nothing Then Exit Sub

    On Error GoTo ErrHandler
    gInputColorSuspended = False
    turnOn = Not (ws.Range(INPUT_COLOR_CELL).Value = 1)
    prevEvents = Application.EnableEvents
    Application.EnableEvents = False
    ws.Range(INPUT_COLOR_CELL).Value = IIf(turnOn, 1, 0)
    Application.EnableEvents = prevEvents
    Call ApplyInputColor(turnOn)
    If turnOn Then
        MsgBox "手入力セルを黄色で表示します。" & vbCrLf & _
               "黄色は画面表示用で、印刷・PDF出力・印刷プレビューの前に自動で消えます。", _
               vbInformation, "入力セルの黄色表示"
    Else
        MsgBox "手入力セルの黄色表示を止めました。", vbInformation, "入力セルの黄色表示"
    End If
    Exit Sub

ErrHandler:
    Application.EnableEvents = True
    MsgBox "黄色表示を切り替えられませんでした。" & vbCrLf & _
           "「" & SHEET_GUIDE & "」シートが保護されている場合は保護を解除してください。", vbExclamation
End Sub

' 手入力セル（入力セル一覧に載っているセル）を黄色に塗る／元の塗りに戻す。
' 元の塗りは入力セル一覧のH列（-1＝塗りなし、0以上＝色）に記録してある。数式が入ったセルは黄色にしない。
Public Sub ApplyInputColor(ByVal turnOn As Boolean)
    Dim wsList As Worksheet
    Dim ws As Worksheet
    Dim r As Long
    Dim lastRow As Long
    Dim curName As String
    Dim sName As String
    Dim addr As String
    Dim c As Range
    Dim orig As Variant
    Dim prevScreen As Boolean
    Dim prevEvents As Boolean

    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then Exit Sub

    prevScreen = Application.ScreenUpdating
    prevEvents = Application.EnableEvents
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    On Error Resume Next
    lastRow = ListLastRow()
    For r = LIST_FIRST_ROW To lastRow
        sName = CStr(wsList.Cells(r, 2).Value)
        If sName <> curName Then
            Set ws = Nothing
            Set ws = GetSheet(sName)
            curName = sName
        End If
        If Not ws Is Nothing Then
            addr = ListAddr(wsList, r)
            If Len(addr) > 0 Then
                Set c = Nothing
                Set c = ws.Range(addr)
                If Not c Is Nothing Then
                    If turnOn And Not c.HasFormula Then
                        c.Interior.Color = vbYellow
                    Else
                        orig = wsList.Cells(r, 8).Value
                        If IsNumeric(orig) And Not IsEmpty(orig) Then
                            If CLng(orig) >= 0 Then
                                c.Interior.Color = CLng(orig)
                            Else
                                c.Interior.ColorIndex = xlNone
                            End If
                        Else
                            c.Interior.ColorIndex = xlNone
                        End If
                    End If
                End If
            End If
        End If
    Next r
    Err.Clear
    On Error GoTo 0
    Application.EnableEvents = prevEvents
    Application.ScreenUpdating = prevScreen
End Sub

' 印刷・PDF出力の前に黄色表示を止める（止める前の値を覚えておく）
Public Sub SuspendInputColor()
    Dim ws As Worksheet
    Dim prevEvents As Boolean

    If gInputColorSuspended Then Exit Sub
    Set ws = GetSheet(SHEET_GUIDE)
    If ws Is Nothing Then Exit Sub

    gInputColorBackup = ws.Range(INPUT_COLOR_CELL).Value
    If Not (gInputColorBackup = 1) Then Exit Sub     ' もともと非表示なら何もしない
    prevEvents = Application.EnableEvents
    Application.EnableEvents = False
    On Error Resume Next
    ws.Range(INPUT_COLOR_CELL).Value = 0
    On Error GoTo 0
    Application.EnableEvents = prevEvents
    Call ApplyInputColor(False)
    gInputColorSuspended = True
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
    Call ApplyInputColor(True)
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

' 入力セル一覧の行のセル番地（C列のHYPERLINK式の「!」から次の「"」まで）
Private Function ListAddr(ByVal wsList As Worksheet, ByVal rowNum As Long) As String
    Dim fText As String
    Dim p1 As Long
    Dim p2 As Long

    On Error Resume Next
    fText = wsList.Cells(rowNum, 3).Formula
    On Error GoTo 0
    p1 = InStr(fText, "!")
    If p1 > 0 Then
        p2 = InStr(p1, fText, """")
        If p2 > p1 Then ListAddr = Mid$(fText, p1 + 1, p2 - p1 - 1)
    End If
End Function

Private Function GetTargetCellFromListRow(ByVal wsList As Worksheet, ByVal rowNum As Long) As Range
    Dim sName As String
    Dim cAddr As String

    On Error Resume Next
    sName = Trim$(CStr(wsList.Cells(rowNum, 2).Value))
    cAddr = ListAddr(wsList, rowNum)
    If Len(cAddr) > 0 Then Set GetTargetCellFromListRow = ThisWorkbook.Worksheets(sName).Range(cAddr)
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
' シートタブの色分け（入力セル一覧に載っているシート＝黄色、載っていないシート＝灰色）
' ------------------------------------------------------------------------------------------
Public Sub ColorSheetTabs()
    Dim wsList As Worksheet
    Dim ws As Worksheet
    Dim r As Long
    Dim lastRow As Long
    Dim dict As Object

    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then Exit Sub
    Set dict = CreateObject("Scripting.Dictionary")
    lastRow = ListLastRow()
    For r = LIST_FIRST_ROW To lastRow
        dict(CStr(wsList.Cells(r, 2).Value)) = 1
    Next r
    ' 黄＝手入力が必要（印刷する）／橙＝手入力が必要（印刷しない入力用）／青＝マクロで取り込む（印刷しない）
    ' 灰＝手入力が不要／緑＝管理用
    For Each ws In ThisWorkbook.Worksheets
        If ws.Name = SHEET_GUIDE Or ws.Name = SHEET_LIST Or ws.Name = SHEET_CHECK Then
            ws.Tab.Color = RGB(112, 173, 71)
        ElseIf Left$(ws.Name, 5) = "入力P32" Then
            ws.Tab.Color = RGB(255, 192, 0)
        ElseIf Left$(ws.Name, 6) = "入力標準報酬" Then
            ws.Tab.Color = RGB(91, 155, 213)
        ElseIf dict.Exists(ws.Name) Then
            ws.Tab.Color = RGB(255, 255, 0)
        Else
            ws.Tab.Color = RGB(166, 166, 166)
        End If
    Next ws
    MsgBox "シートタブを色分けしました。" & vbCrLf & _
           "黄＝手入力が必要、橙＝手入力が必要（印刷しない）、青＝マクロで取り込む（印刷しない）、" & vbCrLf & _
           "灰＝手入力が不要、緑＝管理用", vbInformation, "シートタブの色分け"
End Sub

' ------------------------------------------------------------------------------------------
' カメラ図の更新
' 概況ページの表は、カメラ元表の範囲を撮った図（静止画）。元表から撮り直して差し替える。
' （リンクした図のままだとExcelが応答しなくなるため、静止画にしている）
' ------------------------------------------------------------------------------------------
Public Sub RefreshCameraPictures()
    Dim m As Variant
    Dim i As Long
    Dim parts() As String
    Dim ws As Worksheet
    Dim srcWs As Worksheet
    Dim shp As Shape
    Dim target As Shape
    Dim newPic As Shape
    Dim pLeft As Double, pTop As Double, pWidth As Double, pHeight As Double
    Dim camName As String
    Dim failed As String
    Dim prevSheet As Object
    Dim prevScreen As Boolean
    Dim prevEvents As Boolean
    Dim suspendedHere As Boolean
    Dim haveSize As Boolean

    m = CameraMap()
    Set prevSheet = ActiveSheet
    prevScreen = Application.ScreenUpdating
    prevEvents = Application.EnableEvents
    Application.ScreenUpdating = False
    Application.EnableEvents = False

    ' 図に黄色が写らないよう、撮る間だけ黄色表示を止める
    If Not gInputColorSuspended Then
        Call SuspendInputColor
        suspendedHere = gInputColorSuspended
    End If

    On Error GoTo ErrHandler
    For i = LBound(m) To UBound(m)
        parts = Split(CStr(m(i)), "|")
        Set ws = GetSheet(parts(0))
        Set srcWs = GetSheet(parts(2))
        If Not ws Is Nothing And Not srcWs Is Nothing Then
            camName = "Cam_" & parts(1)
            Set target = Nothing
            On Error Resume Next
            Set target = ws.Shapes(camName)
            On Error GoTo ErrHandler
            If target Is Nothing Then
                ' 名前のない図は、まだ更新していない図のうち最初のものを使う
                For Each shp In ws.Shapes
                    If (shp.Type = msoPicture Or shp.Type = msoLinkedPicture) And Left$(shp.Name, 4) <> "Cam_" Then
                        Set target = shp
                        Exit For
                    End If
                Next shp
            End If
            ' 壊れた図（ほぼ大きさのない図）は削除して、対応表の位置で作り直す
            If Not target Is Nothing Then
                If (target.Width < 20 Or target.Height < 20) And UBound(parts) >= 7 Then
                    target.Delete
                    Set target = Nothing
                End If
            End If
            haveSize = (UBound(parts) >= 7)
            If target Is Nothing And Not haveSize Then
                failed = failed & parts(0) & "（" & parts(1) & "番目の図）" & vbCrLf
            Else
                If target Is Nothing Then
                    pLeft = Val(parts(4)): pTop = Val(parts(5)): pWidth = Val(parts(6)): pHeight = Val(parts(7))
                Else
                    pLeft = target.Left: pTop = target.Top: pWidth = target.Width: pHeight = target.Height
                End If
                Set newPic = PasteRangePicture(srcWs.Range(parts(3)), ws)
                If newPic Is Nothing Then
                    failed = failed & parts(0) & "（" & parts(1) & "番目の図：貼り付けできませんでした）" & vbCrLf
                    GoTo NextCam
                End If
                If Not target Is Nothing Then target.Delete
                ' 縦横比を保ったまま、元の図の枠に収める（図をゆがめない）
                newPic.LockAspectRatio = msoTrue
                newPic.Width = pWidth
                If newPic.Height > pHeight Then newPic.Height = pHeight
                newPic.Left = pLeft: newPic.Top = pTop
                newPic.Name = camName
                newPic.Placement = xlMove
            End If
        End If
NextCam:
    Next i

    Application.CutCopyMode = False
    prevSheet.Activate
    If suspendedHere Then Call ResumeInputColor
    Application.EnableEvents = prevEvents
    Application.ScreenUpdating = prevScreen
    If Len(failed) > 0 Then
        MsgBox "更新できなかった図があります。" & vbCrLf & failed, vbExclamation, "カメラ図の更新"
    End If
    Exit Sub

ErrHandler:
    Dim errMsg As String
    errMsg = Err.Description
    On Error Resume Next
    Application.CutCopyMode = False
    If suspendedHere Then Call ResumeInputColor
    Application.EnableEvents = prevEvents
    Application.ScreenUpdating = True
    On Error GoTo 0
    MsgBox "カメラ図の更新中にエラーが発生しました。" & vbCrLf & errMsg, vbExclamation, "カメラ図の更新"
End Sub

' 範囲を図としてコピーし、シートへ貼り付けて、その図を返す。
' クリップボードの準備が間に合わず「データを貼り付けできません」になることがあるため、数回やり直す。
Private Function PasteRangePicture(ByVal src As Range, ByVal ws As Worksheet) As Shape
    Dim attempt As Long
    Dim before As Long

    ws.Activate
    On Error Resume Next
    ws.Range("A1").Select
    For attempt = 1 To 8
        Err.Clear
        before = ws.Shapes.Count
        Application.CutCopyMode = False
        src.CopyPicture Appearance:=xlScreen, Format:=xlPicture
        DoEvents
        If attempt > 1 Then Application.Wait Now + TimeSerial(0, 0, 1)
        ws.Paste
        If Err.Number = 0 And ws.Shapes.Count = before + 1 Then
            Set PasteRangePicture = ws.Shapes(ws.Shapes.Count)
            Exit For
        End If
        DoEvents
    Next attempt
    Err.Clear
    On Error GoTo 0
End Function

' カメラ図の対応表： シート名|図の番号（シート内の図の順）|転記元シート|転記元の範囲|左|上|幅|高さ（ポイント。図が消えたときの復元位置）
Private Function CameraMap() As Variant
    Dim m(1 To 34) As String
    m(1) = "概況01総括_総－2|1|概況01総括_2.3ｶﾒラ|$A$2:$J$17|116.2|209.3|477.4|238.5"
    m(2) = "概況01総括_総－3|1|概況01総括_2.3ｶﾒラ|$A$21:$J$59|109.1|54.1|559.1|591.0"
    m(3) = "概況01総括_総－4|1|概況01総括_4ｶﾒラ|$A$1:$J$30|116.2|56.3|509.3|442.5"
    m(4) = "概況01総括_総－5|1|概況01総括_5ｶﾒラ|$A$29:$M$42|115.3|51.6|519.1|212.6"
    m(5) = "概況01総括_総－5|2|概況01総括_5ｶﾒラ|$P$3:$S$5|115.3|375.7|497.0|56.8"
    m(6) = "概況01総括_総－5|3|概況01総括_5ｶﾒラ|$V$3:$AE$13|117.0|474.9|494.3|124.3"
    m(7) = "概況02短期_短－１|1|概況02短期_カメラ１|$B$26:$K$38|89.7|126.7|512.2|176.3"
    m(8) = "概況02短期_短－１|2|概況02短期_カメラ１|$B$61:$K$69|90.5|362.2|521.7|137.3"
    m(9) = "概況02短期_短－１|3|概況02短期_カメラ１|$B$74:$K$82|89.7|553.5|521.7|137.2"
    m(10) = "概況02短期_短－２|1|概況02短期_カメラ１|$O$3:$R$5|115.4|88.5|536.8|59.2"
    m(11) = "概況02短期_短－２|2|概況02短期_カメラ１|$U$3:$AE$13|115.4|186.7|536.8|172.5"
    m(12) = "概況02短期_短－２|3|概況02短期_カメラ２|$B$2:$L$24|115.4|396.0|536.8|352.5"
    m(13) = "概況02短期_短－３|1|概況02短期_カメラ２(2)|$B$2:$G$60|116.9|49.5|533.8|753.0"
    m(14) = "概況03厚年|1|概況03厚年_長ｶﾒ2|$O$2:$U$19|118.0|476.3|534.2|309.0"
    m(15) = "概況03厚年|2|概況03厚年_長ｶﾒ1|$C$8:$J$9|114.4|260.9|543.1|48.2"
    m(16) = "概況03厚年|3|概況03厚年_長ｶﾒ1|$X$5:$AA$7|123.3|360.8|358.5|62.3"
    m(17) = "概況03厚年|4|概況03厚年_長ｶﾒ1|$O$1:$V$4|118.9|132.8|380.7|64.3"
    m(18) = "概況04退職等|1|概況04退職等_長ｶﾒ2|$B$2:$H$17|103.8|289.9|499.5|308.9"
    m(19) = "概況04退職等|2|概況04退職等_長ｶﾒ1|$F$1:$I$4|102.9|132.8|240.5|81.2"
    m(20) = "概況05経過的|1|概況05経過的_長ｶﾒ2|$O$2:$T$16|107.3|464.2|513.8|288.3"
    m(21) = "概況05経過的|2|概況05経過的_長ｶﾒ1|$G$5:$J$7|115.3|343.4|387.0|68.3"
    m(22) = "概況05経過的|3|概況05経過的_長ｶﾒ1|$B$1:$E$4|118.9|174.0|216.6|71.0"
    m(23) = "概況06預託金|1|概況06預託金_カメラ|$B$2:$L$9|111.8|59.7|539.8|158.4"
    m(24) = "概況06預託金|2|概況06預託金_カメラ|$R$2:$AH$7|111.8|297.7|463.7|146.8"
    m(25) = "概況07業務|1|概況07業務_業ｶﾒ|$K$14:$P$31|117.0|477.5|557.2|313.5"
    m(26) = "概況07業務|2|概況07業務_業ｶﾒ|$B$2:$H$8|116.2|94.1|549.3|157.0"
    m(27) = "概況07業務|3|概況07業務_業ｶﾒ|$B$10:$H$11|116.2|370.4|549.3|45.8"
    m(28) = "概況08保健_保健－1|1|概況08保健_保ｶﾒ2|$B$1:$G$56|92.2|242.4|557.3|650.3"
    m(29) = "概況08保健_保健－1|2|概況08保健_保ｶﾒ1|$C$5:$L$15|94.0|82.7|553.7|136.5"
    m(30) = "概況08保健_保健－2|1|概況08保健_保ｶﾒ3|$B$2:$G$30|115.3|50.9|557.1|579.1"
    m(31) = "概況09貸付_貸-1|1|概況09貸付_貸ｶﾒ2|$A$12:$F$25|116.2|436.9|552.0|207.5"
    m(32) = "概況09貸付_貸-1|2|概況09貸付_貸ｶﾒ1|$M$12:$Q$18|120.6|228.5|551.0|128.0"
    m(33) = "概況09貸付_貸-2|1|概況09貸付_貸ｶﾒ2|$H$12:$R$30|117.0|55.4|552.0|279.4"
    m(34) = "概況09貸付_貸-2|2|概況09貸付_貸ｶﾒ3|$A$2:$F$16|116.2|503.8|552.0|267.6"
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
    ' OneDrive/SharePoint上のブック（パスが http で始まる）は Dir が使えないため、保存先を選んでもらう
    If ThisWorkbook.Path <> "" And LCase$(Left$(ThisWorkbook.Path, 4)) <> "http" Then
        pdfPath = ThisWorkbook.Path & "\" & defaultFileName
    Else
        pdfPath = CStr(Application.GetSaveAsFilename(InitialFileName:=defaultFileName, _
                                                     FileFilter:="PDFファイル (*.pdf), *.pdf"))
        If pdfPath = "False" Or pdfPath = "" Then Exit Sub
    End If

    Dim exists As Boolean
    On Error Resume Next
    exists = (Dir(pdfPath) <> "")
    On Error GoTo 0
    If exists Then
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
        "概況01総括_総－2", "概況01総括_総－3", "概況01総括_総－4", _
        "概況01総括_総－5", "概況02短期_短－１", "概況02短期_短－２", _
        "概況02短期_短－３", "概況03厚年", "概況04退職等", _
        "概況05経過的", "概況06預託金", "概況07業務", _
        "概況08保健_保健－1", "概況08保健_保健－2", "概況09貸付_貸-1", _
        "概況09貸付_貸-2")
    GaikyoSheets = a
End Function

' 予算書のシート（目次の順）
Private Function YosanSheets() As Variant
    Dim a As Variant
    a = Array( _
        "予算02短期_予算総則", "予算02短期_予定損益", "予算02短期_損益説明書", _
        "予算02短期_予定貸借", "予算02短期_貸借説明書", "予算03厚年_予定損益", _
        "予算03厚年_損益説明書", "予算03厚年_予定貸借・説明", "予算04退職等_予定損益", _
        "予算04退職等_損益説明書", "予算04退職等_予定貸借・説明", "予算05経過的_予定損益", _
        "予算05経過的_損益説明書", "予算05経過的_予定貸借・説明", "予算06預託金_予算総則", _
        "予算06預託金_損益計算・説明", "予算06預託金_貸借・説明", "予算07業務_予算総則", _
        "予算07業務_予定損益", "予算07業務_損益説明書", "予算07業務_予定貸借", _
        "予算07業務_貸借説明書", "予算08保健_予算総則", "予算08保健_予定損益", _
        "予算08保健_損益説明書", "予算08保健_予定貸借", "予算08保健_貸借説明書", _
        "予算09貸付_予算総則", "予算09貸付_予定損益", "予算09貸付_損益説明書", _
        "予算09貸付_予定貸借", "予算09貸付_貸借説明書")
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
        Array(2, "$A$37:$U$50", "概況01総括_総－2", "12"), _
        Array(3, "$A$51:$U$64", "予算02短期_予算総則", "13"), _
        Array(4, "$A$65:$U$78", "予算02短期_予算総則", "13"), _
        Array(5, "$A$79:$U$92", "予算03厚年_予定損益", "13"), _
        Array(6, "$A$93:$U$106", "予算04退職等_予定損益", "13"), _
        Array(10, "$A$149:$U$162", "予算05経過的_予定損益", "13"), _
        Array(11, "$A$163:$U$176", "予算06預託金_予算総則", "13"), _
        Array(7, "$A$107:$U$120", "予算07業務_予算総則", "13"), _
        Array(8, "$A$121:$U$134", "予算08保健_予算総則", "13"), _
        Array(9, "$A$135:$U$148", "予算09貸付_予算総則", "13"))
    For i = LBound(anchors) To UBound(anchors)
        If InStr(CStr(anchors(i)(3)), mode) > 0 Then
            If Not GetSheet(CStr(anchors(i)(2))) Is Nothing Then
                wsCover.Copy Before:=GetSheet(CStr(anchors(i)(2)))
                Set cp = ActiveSheet
                cp.Name = TEMP_PREFIX & "表紙" & Format$(CLng(anchors(i)(0)), "00")
                cp.PageSetup.PrintArea = CStr(anchors(i)(1))
                cp.PageSetup.CenterFooter = ""
            End If
        End If
    Next i

    ' 目次のページ番号を下部中央に付け、各経理の頁数が目次に合うよう空白ページを足す
    Call ApplyNumberingAndBlanks(mode)

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
' 目次（T列）の頁番号どおりに、フッター中央へ頁番号を付ける。
'   各経理の先頭シートに FirstPageNumber を設定し、頁数が次の経理の開始頁に足りないときは
'   番号付きの空白ページ（一時シート）を経理の末尾に足す。表紙・目次・中扉には番号を付けない。
Private Sub ApplyNumberingAndBlanks(ByVal mode As String)
    Dim keys As Variant
    Dim cells As Variant
    Dim s As Long
    Dim ws As Worksheet
    Dim firstWs As Worksheet
    Dim lastWs As Worksheet
    Dim wsToc As Worksheet
    Dim startNo As Long
    Dim nextNo As Long
    Dim used As Long
    Dim pc As Long
    Dim unknown As Boolean
    Dim need As Long
    Dim k As Long
    Dim blank As Worksheet
    Dim blankSeq As Long
    Dim report As String

    keys = Array("概況01", "概況02", "概況03", "概況04", "概況05", "概況06", "概況07", "概況08", "概況09", _
                 "予算02", "予算03", "予算04", "予算05", "予算06", "予算07", "予算08", "予算09")
    cells = Array("T9", "T11", "T13", "T15", "T17", "T19", "T21", "T23", "T25", _
                  "T39", "T41", "T43", "T45", "T47", "T49", "T51", "T53")

    Set wsToc = GetSheet(TOC_SHEET)
    If wsToc Is Nothing Then Exit Sub
    wsToc.PageSetup.CenterFooter = ""

    For s = LBound(keys) To UBound(keys)
        Set firstWs = Nothing
        Set lastWs = Nothing
        used = 0
        unknown = False
        startNo = TocPageNumber(wsToc.Range(CStr(cells(s))).Value)
        nextNo = 0
        If s < UBound(keys) Then nextNo = TocPageNumber(wsToc.Range(CStr(cells(s + 1))).Value)

        For Each ws In ThisWorkbook.Worksheets
            If ws.Visible = xlSheetVisible Then
                If Left$(ws.Name, 5) = CStr(keys(s)) Then
                    If IsOutputSheet(ws.Name, mode) Then
                        If firstWs Is Nothing Then Set firstWs = ws
                        Set lastWs = ws
                        pc = 0
                        On Error Resume Next
                        ws.PageSetup.CenterFooter = "&9&P"
                        ws.PageSetup.FirstPageNumber = IIf(ws Is firstWs And startNo > 0, startNo, xlAutomatic)
                        pc = ws.PageSetup.Pages.Count
                        On Error GoTo 0
                        If pc <= 0 Then unknown = True Else used = used + pc
                    End If
                End If
            End If
        Next ws

        If Not firstWs Is Nothing And startNo > 0 And nextNo > 0 Then
            If unknown Then
                report = report & CStr(keys(s)) & "：頁数を取得できないため空白ページ調整をしていません" & vbCrLf
            ElseIf used < nextNo - startNo Then
                need = nextNo - startNo - used
                For k = 1 To need
                    blankSeq = blankSeq + 1
                    Set blank = ThisWorkbook.Worksheets.Add(After:=lastWs)
                    blank.Name = TEMP_PREFIX & "空白" & Format$(blankSeq, "00")
                    blank.Range("A1").Value = " "
                    blank.PageSetup.PrintArea = "$A$1"
                    On Error Resume Next
                    blank.PageSetup.PaperSize = lastWs.PageSetup.PaperSize
                    blank.PageSetup.Orientation = lastWs.PageSetup.Orientation
                    On Error GoTo 0
                    blank.PageSetup.CenterFooter = "&9&P"
                    blank.PageSetup.FirstPageNumber = xlAutomatic
                    Set lastWs = blank
                Next k
            ElseIf used > nextNo - startNo Then
                report = report & CStr(keys(s)) & "：" & used & "頁（目次は " & (nextNo - startNo) & "頁分）。目次か改ページを確認してください" & vbCrLf
            End If
        End If
    Next s

    If report <> "" Then
        MsgBox "頁数の確認が必要です。" & vbCrLf & vbCrLf & report, vbExclamation, "頁番号"
    End If
End Sub

Private Function TocPageNumber(ByVal v As Variant) As Long
    Dim t As String
    t = Trim$(StrConv(CStr(v), vbNarrow))
    If IsNumeric(t) Then TocPageNumber = CLng(Val(t))
End Function


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
' 数値の手入力セル＝入力セル一覧に載っているセル。文字だけの入力欄は保護中は編集できない。
' ------------------------------------------------------------------------------------------
Public Sub ToggleSheetProtection()
    Dim wsGuide As Worksheet
    Dim ws As Worksheet
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
    Dim wsList As Worksheet
    Dim r As Long
    Dim target As Range
    Set wsList = GetSheet(SHEET_LIST)
    If Not wsList Is Nothing Then
        For r = LIST_FIRST_ROW To ListLastRow()
            Set target = GetTargetCellFromListRow(wsList, r)
            If Not target Is Nothing Then target.MergeArea.Locked = False
        Next r
    End If

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
    Dim wsList As Worksheet
    Dim r As Long
    Dim lastRow As Long
    Dim addr As String
    Dim g As Variant

    mInCount = 0
    Set mInIndex = New Collection
    ReDim mInSheet(1 To 20000)
    ReDim mInAddr(1 To 20000)

    ' 1. 入力ガイドの設定欄
    For Each g In Array(INPUT_COLOR_CELL, ENTER_JUMP_CELL)
        Call AddInput(SHEET_GUIDE, CStr(g))
    Next g

    ' 2. 入力セル一覧の順（タブの順、各シートは上から下・左から右）
    Set wsList = GetSheet(SHEET_LIST)
    If wsList Is Nothing Then Exit Sub
    lastRow = ListLastRow()
    For r = LIST_FIRST_ROW To lastRow
        addr = ListAddr(wsList, r)
        If Len(addr) > 0 Then Call AddInput(CStr(wsList.Cells(r, 2).Value), addr)
    Next r
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

    ' 入力ガイドの E9（黄色表示）・G9（Enter移動）を手で変えたとき
    If Target.Worksheet.Name = SHEET_GUIDE Then
        If Not Intersect(Target, Target.Worksheet.Range(INPUT_COLOR_CELL)) Is Nothing Then
            gInputColorSuspended = False
            Call ApplyInputColor(Target.Worksheet.Range(INPUT_COLOR_CELL).Value = 1)
        End If
        If Not Intersect(Target, Target.Worksheet.Range(ENTER_JUMP_CELL)) Is Nothing Then Call EnableEnterKey
    End If

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
