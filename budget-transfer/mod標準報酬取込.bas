Attribute VB_Name = "mod標準報酬取込"
Option Explicit

' ============================================================
'  標準報酬資料の取込マクロ
'   標準報酬資料（短期・長期の標準報酬ブック）の表を、このブックの入力用シート4枚へ「値」で取り込む。
'   取り込んだ表を指す数式で、概況（総括）の元表（総括_2.3ｶﾒラ・総括_4ｶﾒラ）が自動計算される。
'   マクロは取り込みだけを行い、集計はしない（集計はシートの数式）。
'
'   入力用シート（印刷しない）
'     入力標準報酬_短期当年度 ／ 入力標準報酬_短期翌年度
'     入力標準報酬_長期当年度 ／ 入力標準報酬_長期翌年度
'   資料の年度が小さい方が「当年度」、大きい方が「翌年度」のシートへ入る。
' ============================================================

Private Const SH_GUIDE As String = "入力ガイド"
Private Const SH_LOG As String = "取込ログ"
Private Const SH_K As String = "概況01総括_2.3ｶﾒラ"

Private mLog As Worksheet
Private mLogRow As Long

Public Sub ImportStandardRemuneration()
    Dim fd As FileDialog
    Dim nFiles As Long, f As Long, i As Long, j As Long, k As Long
    Dim wbs(1 To 4) As Workbook
    Dim opened(1 To 4) As Boolean
    Dim ws As Worksheet
    Dim cand(1 To 12) As Worksheet
    Dim cWb(1 To 12) As String
    Dim kind(1 To 12) As String
    Dim yr(1 To 12) As Long
    Dim dstName(1 To 12) As String
    Dim nc As Long
    Dim yF As Long, yG As Long
    Dim msg As String
    Dim wsK As Worksheet
    Dim done As Long

    Set wsK = SheetOf(ThisWorkbook, SH_K)

    Set fd = Application.FileDialog(msoFileDialogFilePicker)
    With fd
        .Title = "標準報酬資料のブックを選んでください（Ctrlキーを押しながらクリックで複数選択。短期・長期の当年度分と翌年度分）"
        .AllowMultiSelect = True
        .Filters.Clear
        .Filters.Add "Excelブック", "*.xlsx;*.xlsm;*.xls;*.xlsb"
        If .Show <> -1 Then Exit Sub
        nFiles = .SelectedItems.Count
        If nFiles < 1 Or nFiles > 4 Then
            MsgBox "ブックを1～4個選んでください。", vbExclamation
            Exit Sub
        End If
        On Error GoTo ErrHandler
        Application.ScreenUpdating = False
        For f = 1 To nFiles
            Set wbs(f) = OpenReadOnly(.SelectedItems(f), opened(f))
        Next f
    End With

    ' 選んだブックの全シートから、標準報酬資料の形式のシートを探す（シートの位置・名前は問わない）
    For f = 1 To nFiles
        For Each ws In wbs(f).Worksheets
            If ws.Visible = xlSheetVisible Then
                k = 0
                If IsTanki(ws) Then
                    k = 1
                ElseIf IsChoki(ws) Then
                    k = 2
                End If
                If k > 0 Then
                    If nc >= 12 Then
                        MsgBox "標準報酬資料のシートが多すぎます（12シートまで）。", vbExclamation
                        GoTo Cleanup
                    End If
                    nc = nc + 1
                    Set cand(nc) = ws
                    cWb(nc) = wbs(f).Name
                    kind(nc) = IIf(k = 1, "短期", "長期")
                    yr(nc) = YearOfSheet(ws)
                End If
            End If
        Next ws
    Next f

    If nc = 0 Then
        MsgBox "標準報酬資料の形式のシートが見つかりません。" & vbCrLf & _
               "（E1に「短期人数」または「長期人数」、短期はY2・長期はU2に「標準期末手当」があるシート）", vbExclamation
        GoTo Cleanup
    End If
    For i = 1 To nc
        If yr(i) = 0 Then
            MsgBox "年度を読み取れないシートがあります：" & cWb(i) & "「" & cand(i).Name & "」（C1）", vbExclamation
            GoTo Cleanup
        End If
    Next i

    ' 年度は2種類まで。小さい方を当年度、大きい方を翌年度のシートへ入れる
    yF = yr(1): yG = yr(1)
    For i = 2 To nc
        If yr(i) < yF Then yF = yr(i)
        If yr(i) > yG Then yG = yr(i)
    Next i
    If yF = yG Then
        MsgBox "年度が1種類しかありません。当年度分と翌年度分を選んでください。", vbExclamation
        GoTo Cleanup
    End If
    For i = 1 To nc
        If yr(i) <> yF And yr(i) <> yG Then
            MsgBox "年度が3種類以上あります（令和" & yr(i) & "年度：" & cWb(i) & "「" & cand(i).Name & "」）。" & vbCrLf & _
                   "当年度と翌年度の2年度分だけを選んでください。", vbExclamation
            GoTo Cleanup
        End If
        For j = i + 1 To nc
            If kind(i) = kind(j) And yr(i) = yr(j) Then
                MsgBox "同じ種類・同じ年度のシートが重複しています：" & vbCrLf & _
                       cWb(i) & "「" & cand(i).Name & "」／" & cWb(j) & "「" & cand(j).Name & "」", vbExclamation
                GoTo Cleanup
            End If
        Next j
    Next i

    msg = ""
    For i = 1 To nc
        dstName(i) = "入力標準報酬_" & kind(i) & IIf(yr(i) = yF, "当年度", "翌年度")
        If SheetOf(ThisWorkbook, dstName(i)) Is Nothing Then
            MsgBox "取り込み先のシート「" & dstName(i) & "」が見つかりません。", vbExclamation
            GoTo Cleanup
        End If
        msg = msg & cWb(i) & "「" & cand(i).Name & "」（令和" & yr(i) & "年度・" & kind(i) & "）  →  " & dstName(i) & vbCrLf
    Next i
    msg = msg & vbCrLf
    If Not wsK Is Nothing Then
        If ReiwaYear(CStr(wsK.Range("F2").Value)) <> yF Or ReiwaYear(CStr(wsK.Range("G2").Value)) <> yG Then
            msg = msg & "【注意】概況の見出し（" & wsK.Range("F2").Value & "／" & wsK.Range("G2").Value & "）と資料の年度が一致しません。" & vbCrLf & vbCrLf
        End If
    End If
    msg = msg & "入力用シートの内容を、上書きして取り込みます。よろしいですか？" & vbCrLf & _
                "（概況の元表は、取り込んだ表を指す数式で自動的に変わります）"
    If MsgBox(msg, vbQuestion + vbYesNo + vbDefaultButton2, "標準報酬資料の取込") <> vbYes Then GoTo Cleanup

    Call StartLog
    For i = 1 To nc
        Call CopyValues(cand(i), SheetOf(ThisWorkbook, dstName(i)), cWb(i))
        done = done + 1
    Next i
    Application.Calculate

Cleanup:
    On Error Resume Next
    For f = 1 To 4
        If opened(f) Then wbs(f).Close SaveChanges:=False
    Next f
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    On Error GoTo 0
    If done > 0 Then
        MsgBox "取り込みました（" & done & "シート）。" & vbCrLf & _
               "概況の元表は数式で自動計算されます。概況ページの図は「カメラ図の更新」で最新になります。" & vbCrLf & _
               "履歴はシート「" & SH_LOG & "」に残しています。", vbInformation, "標準報酬資料の取込"
    End If
    Exit Sub

ErrHandler:
    MsgBox "取り込み中にエラーが発生しました。" & vbCrLf & Err.Number & "：" & Err.Description, vbCritical
    Resume Cleanup
End Sub

' 資料のシートの内容（値）を、入力用シートへ取り込む。書式・列幅は入力用シートのものを使う。
Private Sub CopyValues(ByVal src As Worksheet, ByVal dst As Worksheet, ByVal bookName As String)
    Dim ur As Range
    Dim v As Variant
    Dim r As Long, c As Long
    Dim r0 As Long, c0 As Long
    Dim nWrite As Long, nSkip As Long
    Dim banner As String

    ' 取り込み前の内容を消す（数式は入っていない入力用シートなので、値だけを消す）
    banner = CStr(dst.Range("L1").Value)
    dst.Range("A1:BZ300").ClearContents

    Set ur = src.UsedRange
    r0 = ur.Row - 1: c0 = ur.Column - 1
    v = ur.Value2
    If Not IsArray(v) Then
        If Not IsEmpty(v) Then dst.Cells(ur.Row, ur.Column).Value2 = v
        nWrite = 1
    Else
        On Error Resume Next
        For r = 1 To UBound(v, 1)
            For c = 1 To UBound(v, 2)
                If Not IsEmpty(v(r, c)) Then
                    Err.Clear
                    dst.Cells(r0 + r, c0 + c).Value2 = v(r, c)
                    If Err.Number <> 0 Then
                        nSkip = nSkip + 1
                    Else
                        nWrite = nWrite + 1
                    End If
                End If
            Next c
        Next r
        On Error GoTo 0
    End If
    If Len(banner) > 0 Then dst.Range("L1").Value = banner      ' 上部の説明を戻す

    mLog.Cells(mLogRow, 1).Value = Now
    mLog.Cells(mLogRow, 1).NumberFormat = "yyyy/mm/dd hh:mm"
    mLog.Cells(mLogRow, 2).Value = bookName
    mLog.Cells(mLogRow, 3).Value = src.Name
    mLog.Cells(mLogRow, 4).Value = dst.Name
    mLog.Cells(mLogRow, 5).Value = nWrite
    mLog.Cells(mLogRow, 6).Value = nSkip
    mLogRow = mLogRow + 1
End Sub

' ------------------------------------------------------------
'  入力ガイドに「標準報酬資料の取込」ボタンを置く（E20）
'  SetupRemunerationButton を1回実行する。SetupGuideButtons のボタン（Btn_ で始まる名前）とは別名なので消えない。
' ------------------------------------------------------------
Public Sub SetupRemunerationButton()
    Dim ws As Worksheet
    Dim rng As Range
    Dim shp As Shape
    Dim i As Long

    Set ws = SheetOf(ThisWorkbook, SH_GUIDE)
    If ws Is Nothing Then
        MsgBox "「" & SH_GUIDE & "」シートが見つかりません。", vbExclamation
        Exit Sub
    End If

    On Error GoTo ErrHandler
    Application.ScreenUpdating = False
    For i = ws.Shapes.Count To 1 Step -1
        If ws.Shapes(i).Name = "Rem_Button" Then ws.Shapes(i).Delete
    Next i

    Set rng = ws.Range("E20")
    If rng.RowHeight < 20 Then rng.RowHeight = 20
    Set shp = ws.Shapes.AddShape(msoShapeRectangle, rng.Left + 2, rng.Top + 1, rng.Width - 4, rng.Height - 2)
    With shp
        .Name = "Rem_Button"
        .Fill.ForeColor.RGB = RGB(242, 242, 242)
        .Line.ForeColor.RGB = RGB(128, 128, 128)
        .Line.Weight = 0.75
        .Shadow.Visible = msoFalse
        With .TextFrame2.TextRange
            .Text = "標準報酬資料の取込"
            .Font.NameFarEast = "ＭＳ Ｐゴシック"
            .Font.Name = "ＭＳ Ｐゴシック"
            .Font.Size = 9
            .Font.Bold = msoFalse
            .Font.Fill.ForeColor.RGB = RGB(0, 0, 0)
            .ParagraphFormat.Alignment = msoAlignCenter
        End With
        .TextFrame2.VerticalAnchor = msoAnchorMiddle
        .OnAction = "ImportStandardRemuneration"
        .Placement = xlMove
    End With

    Application.ScreenUpdating = True
    MsgBox "「" & SH_GUIDE & "」のE20に「標準報酬資料の取込」ボタンを配置しました。", vbInformation
    Exit Sub

ErrHandler:
    Application.ScreenUpdating = True
    MsgBox "ボタンの配置中にエラーが発生しました。" & vbCrLf & Err.Description, vbExclamation
End Sub

' ============================================================
'  共通部品
' ============================================================
Private Function IsTanki(ByVal s As Worksheet) As Boolean
    IsTanki = (InStr(CStr(s.Range("E1").Value), "短期人数") > 0) And (InStr(CStr(s.Range("Y2").Value), "標準期末手当") > 0)
End Function

Private Function IsChoki(ByVal s As Worksheet) As Boolean
    IsChoki = (InStr(CStr(s.Range("E1").Value), "長期人数") > 0) And (InStr(CStr(s.Range("U2").Value), "標準期末手当") > 0)
End Function

' シートの年度（C1）。数値（7）でも文字（令和7年度、令和７年度）でも読み取る
Private Function YearOfSheet(ByVal s As Worksheet) As Long
    Dim v As Variant
    v = s.Range("C1").Value
    If IsError(v) Then Exit Function
    If VarType(v) = vbDouble Or VarType(v) = vbLong Or VarType(v) = vbInteger Then
        YearOfSheet = CLng(v)
    Else
        YearOfSheet = ReiwaYear(CStr(v))
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
        mLog.Range("A1:F1").Value = Array("日時", "資料のブック", "資料のシート", "取り込み先のシート", "取り込んだセル数", "取り込めなかったセル数")
        mLog.Range("A1:F1").Interior.Color = RGB(217, 217, 217)
        mLog.Range("A1:F1").Font.Bold = True
        mLog.Columns("A").ColumnWidth = 18
        mLog.Columns("B:D").ColumnWidth = 28
        mLog.Columns("E:F").ColumnWidth = 16
        mLog.Tab.Color = RGB(166, 166, 166)
    End If
    mLogRow = mLog.Cells(mLog.Rows.Count, 1).End(xlUp).Row + 1
End Sub
