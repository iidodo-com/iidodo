Attribute VB_Name = "modR5Tools"
Option Explicit
'==========================================================================
' R5決算 統合ブック用ツール（標準モジュール）
'   R5_Menu            : メニュー（番号入力）
'   R5_SaveSnapshot    : 全シートの値を保存（数値固定の基準を作る）
'   R5_CompareSnapshot : 再計算して基準と比較し、差分を「差分レポート」に出力
'   R5_ScanErrors      : エラー値セルの一覧を「走査レポート」に出力
'   R5_ScanHardcodes   : 数式内の直書き数値の一覧を「走査レポート」に出力
'   R5_CheckLinks      : 外部リンクの有無を確認
'   R5_MakeSheetList   : シート一覧（リンク・使用範囲・数式数・エラー数）を作成
'   R5_ExportPdf       : 各シートを印刷範囲どおりにPDF出力
' 注意: Windows版Excel専用（ADODB.Stream, Scripting.Dictionary, VBScript.RegExp を使用）
'==========================================================================

Private Const SNAP_HEAD As String = "#R5SNAP1"
Private Const REPORT_MAX As Long = 30000
Private Const TOOL_SHEETS As String = "|目次|整合チェック|ハードコード一覧|改修ログ|差分レポート|走査レポート|シート一覧|"
Private Const PDF_SKIP As String = "|全伝票|災害伝票|"

'--------------------------------------------------------------------------
Public Sub R5_Menu()
    Dim s As String
    s = InputBox("実行する番号を入力してください" & vbLf & vbLf & _
        "1: 数値スナップショット保存（基準を作る）" & vbLf & _
        "2: 再計算してスナップショットと比較" & vbLf & _
        "3: エラー値の走査" & vbLf & _
        "4: ハードコード（数式内の直書き数値）の走査" & vbLf & _
        "5: 外部リンクの確認" & vbLf & _
        "6: シート一覧の作成" & vbLf & _
        "7: 全シートPDF出力", "R5決算ツール", "1")
    Select Case Trim$(s)
        Case "1": R5_SaveSnapshot
        Case "2": R5_CompareSnapshot
        Case "3": R5_ScanErrors
        Case "4": R5_ScanHardcodes
        Case "5": R5_CheckLinks
        Case "6": R5_MakeSheetList
        Case "7": R5_ExportPdf
    End Select
End Sub

'--------------------------------------------------------------------------
Private Function IsToolSheet(ByVal nm As String) As Boolean
    IsToolSheet = (InStr(TOOL_SHEETS, "|" & nm & "|") > 0)
End Function

Private Function ColLetter(ByVal c As Long) As String
    Dim s As String
    Do While c > 0
        s = Chr$(65 + (c - 1) Mod 26) & s
        c = (c - 1) \ 26
    Loop
    ColLetter = s
End Function

Private Function EscText(ByVal s As String) As String
    s = Replace(s, "\", "\\")
    s = Replace(s, vbCr, "\r")
    s = Replace(s, vbLf, "\n")
    s = Replace(s, vbTab, "\t")
    EscText = s
End Function

' セル値を (種別, 文字列) に変換。空セルは種別 "" を返す
Private Sub CellToText(ByVal v As Variant, ByRef t As String, ByRef txt As String)
    t = "": txt = ""
    If IsError(v) Then
        t = "E": txt = CStr(v)
    ElseIf IsEmpty(v) Then
        Exit Sub
    ElseIf VarType(v) = vbString Then
        If Len(v) = 0 Then Exit Sub
        t = "S": txt = EscText(CStr(v))
    ElseIf VarType(v) = vbBoolean Then
        t = "B": txt = CStr(v)
    Else
        t = "N": txt = Trim$(Str$(v))
    End If
End Sub

' 範囲の値を必ず2次元配列で返す
Private Function RangeValues(ByVal rng As Range) As Variant
    Dim a() As Variant
    If rng.Cells.Count = 1 Then
        ReDim a(1 To 1, 1 To 1)
        a(1, 1) = rng.Value2
        RangeValues = a
    Else
        RangeValues = rng.Value2
    End If
End Function

Private Function SameValue(ByVal t1 As String, ByVal v1 As String, _
                           ByVal t2 As String, ByVal v2 As String) As Boolean
    Dim a As Double, b As Double, tol As Double
    If t1 <> t2 Then Exit Function
    If t1 = "N" Then
        a = Val(v1): b = Val(v2)
        tol = 0.000000001
        If Abs(a) > 1 Then tol = tol * Abs(a)
        SameValue = (Abs(a - b) <= tol)
    Else
        SameValue = (v1 = v2)
    End If
End Function

Private Function ReportSheet(ByVal nm As String) As Worksheet
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(nm)
    On Error GoTo 0
    If ws Is Nothing Then
        Set ws = ThisWorkbook.Worksheets.Add(After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count))
        ws.Name = nm
    Else
        ws.Cells.Clear
    End If
    Set ReportSheet = ws
End Function

' 先頭 nRows 行・nCols 列だけを正確な大きさの配列にしてシートへ書き込む
Private Sub WriteRows(ByVal ws As Worksheet, ByVal topRow As Long, ByRef rep() As Variant, _
                      ByVal nRows As Long, ByVal nCols As Long)
    Dim a() As Variant, i As Long, j As Long
    If nRows < 1 Then Exit Sub
    ReDim a(1 To nRows, 1 To nCols)
    For i = 1 To nRows
        For j = 1 To nCols
            a(i, j) = rep(i, j)
        Next j
    Next i
    ws.Cells(topRow, 1).Resize(nRows, nCols).Value = a
End Sub

Private Sub BeginWork()
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.StatusBar = "処理中..."
End Sub

Private Sub EndWork()
    Application.StatusBar = False
    Application.EnableEvents = True
    Application.ScreenUpdating = True
End Sub

'--------------------------------------------------------------------------
' 1. スナップショット保存
'--------------------------------------------------------------------------
Public Sub R5_SaveSnapshot()
    Dim path As String, ws As Worksheet, arr As Variant, rng As Range
    Dim r As Long, c As Long, r0 As Long, c0 As Long, t As String, txt As String
    Dim st As Object, buf As String, n As Long

    path = Application.GetSaveAsFilename( _
        InitialFileName:=ThisWorkbook.Path & "\snapshot_" & Format(Now, "yyyymmdd_hhnnss") & ".r5snap", _
        FileFilter:="R5スナップショット (*.r5snap),*.r5snap", Title:="スナップショットの保存先")
    If path = "False" Then Exit Sub

    On Error GoTo EH
    BeginWork
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2: st.Charset = "UTF-8": st.Open
    st.WriteText SNAP_HEAD & vbTab & ThisWorkbook.Name & vbTab & Format(Now, "yyyy-mm-dd hh:nn:ss") & vbLf
    For Each ws In ThisWorkbook.Worksheets
        If Not IsToolSheet(ws.Name) Then
            Set rng = ws.UsedRange
            r0 = rng.Row: c0 = rng.Column
            arr = RangeValues(rng)
            For r = 1 To UBound(arr, 1)
                For c = 1 To UBound(arr, 2)
                    CellToText arr(r, c), t, txt
                    If Len(t) > 0 Then
                        buf = buf & ws.Name & vbTab & ColLetter(c0 + c - 1) & (r0 + r - 1) & vbTab & t & vbTab & txt & vbLf
                        n = n + 1
                        If Len(buf) > 200000 Then st.WriteText buf: buf = ""
                    End If
                Next c
            Next r
        End If
    Next ws
    If Len(buf) > 0 Then st.WriteText buf
    st.SaveToFile path, 2
    st.Close
    EndWork
    MsgBox "保存しました（" & Format(n, "#,##0") & " セル）" & vbLf & path, vbInformation, "R5決算ツール"
    Exit Sub
EH:
    EndWork
    MsgBox "スナップショット保存でエラー: " & Err.Description, vbExclamation, "R5決算ツール"
End Sub

'--------------------------------------------------------------------------
' 2. 再計算してスナップショットと比較
'--------------------------------------------------------------------------
Public Sub R5_CompareSnapshot()
    Dim path As Variant, st As Object, lines() As String, i As Long, p() As String
    Dim dict As Object, ws As Worksheet, rng As Range, arr As Variant
    Dim r As Long, c As Long, r0 As Long, c0 As Long, t As String, txt As String
    Dim key As String, old As String, ot As String, ov As String, k As Long
    Dim rep() As Variant, nRep As Long, nChg As Long, nAdd As Long, nDel As Long, nSame As Long
    Dim out As Worksheet, ks As Variant, sp() As String

    path = Application.GetOpenFilename("R5スナップショット (*.r5snap),*.r5snap", , "比較するスナップショットを選択")
    If VarType(path) = vbBoolean Then Exit Sub
    If MsgBox("全数式を再計算してから比較します。よろしいですか？", vbOKCancel + vbQuestion, "R5決算ツール") <> vbOK Then Exit Sub

    On Error GoTo EH
    BeginWork
    Application.CalculateFull
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2: st.Charset = "UTF-8": st.Open
    st.LoadFromFile CStr(path)
    lines = Split(st.ReadText(-1), vbLf)
    st.Close
    If Left$(lines(0), Len(SNAP_HEAD)) <> SNAP_HEAD Then Err.Raise vbObjectError + 1, , "スナップショット形式が違います"

    Set dict = CreateObject("Scripting.Dictionary")
    dict.CompareMode = 0
    For i = 1 To UBound(lines)
        If Len(lines(i)) > 0 Then
            p = Split(lines(i), vbTab, 4)
            If UBound(p) = 3 Then dict(p(0) & vbTab & p(1)) = p(2) & vbTab & p(3)
        End If
    Next i

    ReDim rep(1 To REPORT_MAX, 1 To 5)
    For Each ws In ThisWorkbook.Worksheets
        If Not IsToolSheet(ws.Name) Then
            Set rng = ws.UsedRange
            r0 = rng.Row: c0 = rng.Column
            arr = RangeValues(rng)
            For r = 1 To UBound(arr, 1)
                For c = 1 To UBound(arr, 2)
                    CellToText arr(r, c), t, txt
                    If Len(t) > 0 Then
                        key = ws.Name & vbTab & ColLetter(c0 + c - 1) & (r0 + r - 1)
                        If dict.Exists(key) Then
                            old = dict(key)
                            k = InStr(old, vbTab)
                            ot = Left$(old, k - 1): ov = Mid$(old, k + 1)
                            If SameValue(ot, ov, t, txt) Then
                                nSame = nSame + 1
                            Else
                                nChg = nChg + 1
                                If nRep < REPORT_MAX Then
                                    nRep = nRep + 1
                                    rep(nRep, 1) = "値変更": rep(nRep, 2) = ws.Name
                                    rep(nRep, 3) = ColLetter(c0 + c - 1) & (r0 + r - 1)
                                    rep(nRep, 4) = "'" & ov: rep(nRep, 5) = "'" & txt
                                End If
                            End If
                            dict.Remove key
                        Else
                            nAdd = nAdd + 1
                            If nRep < REPORT_MAX Then
                                nRep = nRep + 1
                                rep(nRep, 1) = "追加": rep(nRep, 2) = ws.Name
                                rep(nRep, 3) = ColLetter(c0 + c - 1) & (r0 + r - 1)
                                rep(nRep, 4) = "": rep(nRep, 5) = "'" & txt
                            End If
                        End If
                    End If
                Next c
            Next r
        End If
    Next ws
    For Each ks In dict.Keys
        nDel = nDel + 1
        If nRep < REPORT_MAX Then
            sp = Split(CStr(ks), vbTab)
            old = dict(ks): k = InStr(old, vbTab)
            nRep = nRep + 1
            rep(nRep, 1) = "削除": rep(nRep, 2) = sp(0): rep(nRep, 3) = sp(1)
            rep(nRep, 4) = "'" & Mid$(old, k + 1): rep(nRep, 5) = ""
        End If
    Next ks

    Set out = ReportSheet("差分レポート")
    out.Range("A1").Value = "スナップショット比較結果"
    out.Range("A2").Value = "基準: " & CStr(path)
    out.Range("A3").Value = "一致 " & Format(nSame, "#,##0") & " / 値変更 " & Format(nChg, "#,##0") & _
        " / 追加 " & Format(nAdd, "#,##0") & " / 削除 " & Format(nDel, "#,##0") & "（数値は相対誤差1e-9以内を一致とする）"
    out.Range("A5:E5").Value = Array("区分", "シート", "セル", "基準の値", "現在の値")
    out.Range("A5:E5").Font.Bold = True
    WriteRows out, 6, rep, nRep, 5
    out.Columns("A:E").AutoFit
    EndWork
    If nChg + nAdd + nDel = 0 Then
        MsgBox "差分なし（" & Format(nSame, "#,##0") & " セルすべて一致）", vbInformation, "R5決算ツール"
    Else
        MsgBox "差分あり: 値変更 " & nChg & " / 追加 " & nAdd & " / 削除 " & nDel & vbLf & "「差分レポート」シートを確認してください", vbExclamation, "R5決算ツール"
        out.Activate
    End If
    Exit Sub
EH:
    EndWork
    MsgBox "比較でエラー: " & Err.Description, vbExclamation, "R5決算ツール"
End Sub

'--------------------------------------------------------------------------
' 3. エラー値の走査
'--------------------------------------------------------------------------
Public Sub R5_ScanErrors()
    Dim ws As Worksheet, rng As Range, arr As Variant, r As Long, c As Long, r0 As Long, c0 As Long
    Dim rep() As Variant, n As Long, total As Long, out As Worksheet, addr As String
    On Error GoTo EH
    BeginWork
    ReDim rep(1 To REPORT_MAX, 1 To 4)
    For Each ws In ThisWorkbook.Worksheets
        If Not IsToolSheet(ws.Name) Then
            Set rng = ws.UsedRange
            r0 = rng.Row: c0 = rng.Column
            arr = RangeValues(rng)
            For r = 1 To UBound(arr, 1)
                For c = 1 To UBound(arr, 2)
                    If IsError(arr(r, c)) Then
                        total = total + 1
                        If n < REPORT_MAX Then
                            n = n + 1
                            addr = ColLetter(c0 + c - 1) & (r0 + r - 1)
                            rep(n, 1) = ws.Name: rep(n, 2) = addr: rep(n, 3) = CStr(arr(r, c))
                            rep(n, 4) = "'" & ws.Range(addr).Formula
                        End If
                    End If
                Next c
            Next r
        End If
    Next ws
    Set out = ReportSheet("走査レポート")
    out.Range("A1").Value = "エラー値セルの一覧（" & total & " 件）"
    out.Range("A3:D3").Value = Array("シート", "セル", "エラー", "数式")
    out.Range("A3:D3").Font.Bold = True
    WriteRows out, 4, rep, n, 4
    out.Columns("A:C").AutoFit
    EndWork
    MsgBox "エラー値セル: " & total & " 件", IIf(total = 0, vbInformation, vbExclamation), "R5決算ツール"
    Exit Sub
EH:
    EndWork
    MsgBox "走査でエラー: " & Err.Description, vbExclamation, "R5決算ツール"
End Sub

'--------------------------------------------------------------------------
' 4. ハードコード（数式内の直書き数値）の走査
'--------------------------------------------------------------------------
Public Sub R5_ScanHardcodes()
    Dim ws As Worksheet, rng As Range, arr As Variant, r As Long, c As Long, r0 As Long, c0 As Long
    Dim rep() As Variant, n As Long, total As Long, out As Worksheet, f As String, g As String
    Dim reStr As Object, reSheet As Object, reRef As Object, reNum As Object
    On Error GoTo EH
    BeginWork
    Set reStr = CreateObject("VBScript.RegExp"): reStr.Global = True: reStr.Pattern = """[^""]*"""
    Set reSheet = CreateObject("VBScript.RegExp"): reSheet.Global = True
    reSheet.Pattern = "'[^']*'!|[^\s,()+\-*/=<>&^;:'!]+!"
    Set reRef = CreateObject("VBScript.RegExp"): reRef.Global = True
    reRef.Pattern = "\$?[A-Z]{1,3}\$?[0-9]+"
    Set reNum = CreateObject("VBScript.RegExp"): reNum.Global = True
    reNum.Pattern = "(^|[^A-Za-z0-9_.])([0-9]{5,}|[0-9]+\.[0-9]+)"
    ReDim rep(1 To REPORT_MAX, 1 To 4)
    For Each ws In ThisWorkbook.Worksheets
        If Not IsToolSheet(ws.Name) Then
            Set rng = ws.UsedRange
            r0 = rng.Row: c0 = rng.Column
            If rng.Cells.Count = 1 Then
                ReDim arr(1 To 1, 1 To 1): arr(1, 1) = rng.Formula
            Else
                arr = rng.Formula
            End If
            For r = 1 To UBound(arr, 1)
                For c = 1 To UBound(arr, 2)
                    f = CStr(arr(r, c))
                    If Left$(f, 1) = "=" Then
                        g = reStr.Replace(f, "")
                        g = reSheet.Replace(g, "")
                        g = reRef.Replace(g, "R")
                        If reNum.Test(g) Then
                            total = total + 1
                            If n < REPORT_MAX Then
                                n = n + 1
                                rep(n, 1) = ws.Name: rep(n, 2) = ColLetter(c0 + c - 1) & (r0 + r - 1)
                                rep(n, 3) = "'" & f
                            End If
                        End If
                    End If
                Next c
            Next r
        End If
    Next ws
    Set out = ReportSheet("走査レポート")
    out.Range("A1").Value = "数式内の直書き数値（" & total & " 件）"
    out.Range("A3:C3").Value = Array("シート", "セル", "数式")
    out.Range("A3:C3").Font.Bold = True
    WriteRows out, 4, rep, n, 3
    out.Columns("A:B").AutoFit
    EndWork
    MsgBox "直書き数値を含む数式: " & total & " 件", vbInformation, "R5決算ツール"
    Exit Sub
EH:
    EndWork
    MsgBox "走査でエラー: " & Err.Description, vbExclamation, "R5決算ツール"
End Sub

'--------------------------------------------------------------------------
' 5. 外部リンクの確認
'--------------------------------------------------------------------------
Public Sub R5_CheckLinks()
    Dim v As Variant, nm As Name, msg As String, cnt As Long
    v = ThisWorkbook.LinkSources(1)
    If Not IsEmpty(v) Then msg = msg & "外部リンク先: " & (UBound(v) - LBound(v) + 1) & " 件" & vbLf
    For Each nm In ThisWorkbook.Names
        If InStr(nm.RefersTo, "[") > 0 Then cnt = cnt + 1: msg = msg & "名前: " & nm.Name & " -> " & nm.RefersTo & vbLf
    Next nm
    If Len(msg) = 0 Then
        MsgBox "外部リンクはありません。", vbInformation, "R5決算ツール"
    Else
        MsgBox msg, vbExclamation, "R5決算ツール"
    End If
End Sub

'--------------------------------------------------------------------------
' 6. シート一覧の作成
'--------------------------------------------------------------------------
Public Sub R5_MakeSheetList()
    Dim ws As Worksheet, out As Worksheet, i As Long, rng As Range
    Dim nf As Long, ne As Long, fr As Range, er As Range
    On Error GoTo EH
    BeginWork
    Set out = ReportSheet("シート一覧")
    out.Range("A1:F1").Value = Array("No", "シート", "使用範囲", "数式セル数", "エラー値セル数", "表示")
    out.Range("A1:F1").Font.Bold = True
    i = 1
    For Each ws In ThisWorkbook.Worksheets
        If Not IsToolSheet(ws.Name) Then
            i = i + 1
            nf = 0: ne = 0
            Set fr = Nothing: Set er = Nothing
            On Error Resume Next
            Set fr = ws.UsedRange.SpecialCells(-4123)
            Set er = ws.UsedRange.SpecialCells(-4123, 16)
            On Error GoTo EH
            If Not fr Is Nothing Then nf = fr.Cells.Count
            If Not er Is Nothing Then ne = er.Cells.Count
            out.Cells(i, 1).Value = i - 1
            out.Hyperlinks.Add Anchor:=out.Cells(i, 2), Address:="", _
                SubAddress:="'" & ws.Name & "'!A1", TextToDisplay:=ws.Name
            out.Cells(i, 3).Value = ws.UsedRange.Address(False, False)
            out.Cells(i, 4).Value = nf
            out.Cells(i, 5).Value = ne
            out.Cells(i, 6).Value = IIf(ws.Visible = -1, "表示", "非表示")
        End If
    Next ws
    out.Columns("A:F").AutoFit
    EndWork
    out.Activate
    Exit Sub
EH:
    EndWork
    MsgBox "シート一覧でエラー: " & Err.Description, vbExclamation, "R5決算ツール"
End Sub

'--------------------------------------------------------------------------
' 7. 全シートPDF出力（印刷範囲どおり。全伝票・災害伝票は除外）
'--------------------------------------------------------------------------
Public Sub R5_ExportPdf()
    Dim fd As Object, folder As String, ws As Worksheet, i As Long, ok As Long, ng As Long, nm As String
    Set fd = Application.FileDialog(4)
    fd.Title = "PDFの出力先フォルダを選択"
    If fd.Show <> -1 Then Exit Sub
    folder = fd.SelectedItems(1)
    BeginWork
    On Error Resume Next
    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = -1 And InStr(PDF_SKIP, "|" & ws.Name & "|") = 0 Then
            i = i + 1
            nm = ws.Name
            nm = Replace(Replace(Replace(Replace(nm, "/", "_"), "\", "_"), ":", "_"), "*", "_")
            Err.Clear
            ws.ExportAsFixedFormat Type:=0, Filename:=folder & "\" & Format(i, "000") & "_" & nm & ".pdf", _
                Quality:=0, IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=False
            If Err.Number = 0 Then ok = ok + 1 Else ng = ng + 1
        End If
    Next ws
    On Error GoTo 0
    EndWork
    MsgBox "PDF出力: 成功 " & ok & " / 失敗 " & ng & vbLf & folder, vbInformation, "R5決算ツール"
End Sub
