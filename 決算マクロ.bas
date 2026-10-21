Attribute VB_Name = "決算マクロ"
Option Explicit

'=====================================================================
' 決算業務統合ブック 用マクロ
'   使い方: Alt+F8 -> 「決算メニュー」を実行
'   前提  : このモジュールを取り込んだブックを .xlsm で保存して使用
'   注意  : 数式の計算結果は変更しません。入力欄(ロックされていないセル)への
'           書き込みと、ファイル出力だけを行います。
'=====================================================================

Private Const SH_IN As String = "入力"
Private Const SH_CHECK As String = "検算"
Private Const IN_FIRST As Long = 20
Private Const IN_LAST As Long = 219

'--------------------------------------------------------------------
' メニュー
'--------------------------------------------------------------------
Public Sub 決算メニュー()
    Dim s As String
    s = InputBox("実行する番号を入力してください。" & vbCrLf & vbCrLf & _
        "1 : 基幹データ取込（CSV/Excelの試算表を入力シートへ）" & vbCrLf & _
        "2 : 検算を実行" & vbCrLf & _
        "3 : 決算書PDF出力" & vbCrLf & _
        "4 : 次年度ブック作成（前年度欄・年度を繰り越し）", "決算メニュー", "1")
    s = Trim$(StrConv(s, vbNarrow))
    Select Case s
        Case "1": 基幹データ取込
        Case "2": 検算を実行
        Case "3": 決算書PDF出力
        Case "4": 次年度ブック作成
    End Select
End Sub

'--------------------------------------------------------------------
' 共通部品
'--------------------------------------------------------------------
Private Function FindSheet(ByVal wb As Object, ByVal pat As String) As Object
    Dim ws As Object
    For Each ws In wb.Worksheets
        If ws.Name Like pat Then
            Set FindSheet = ws
            Exit Function
        End If
    Next ws
    Set FindSheet = Nothing
End Function

' 当年度の総括表(メモなし)。先頭が「〇」(U+3007)のシート。「○」(U+25CB)の前年度シートとは区別する
Private Function 総括シート(ByVal wb As Object) As Object
    Set 総括シート = FindSheet(wb, ChrW(&H3007) & "総括*メモなし*")
End Function

' 指定列の最終データ行（End(xlUp)。取得できなければ UsedRange で代用）
Private Function LastRow(ByVal ws As Object, ByVal col As Long) As Long
    Dim r As Long
    r = 0
    On Error Resume Next
    r = ws.Cells(ws.Rows.Count, col).End(-4162).Row
    On Error GoTo 0
    If r < 1 Then r = ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    LastRow = r
End Function

' 値のコピー（コピー元が空欄ならコピー先も空欄にする）
Private Sub CopyVal(ByVal dst As Object, ByVal src As Object)
    If IsEmpty(src.Value2) Then
        dst.ClearContents
    Else
        dst.Value2 = src.Value2
    End If
End Sub

' セルの値を文字列に。エラー値は空文字
Private Function SafeStr(ByVal v As Variant) As String
    If IsError(v) Then
        SafeStr = ""
    ElseIf IsNull(v) Then
        SafeStr = ""
    Else
        SafeStr = CStr(v)
    End If
End Function

' 文字列/数値 -> 数値。空白・変換不能は Empty
Private Function ToNum(ByVal v As Variant) As Variant
    Dim t As String
    ToNum = Empty
    If IsError(v) Then Exit Function
    If IsEmpty(v) Then Exit Function
    If VarType(v) = vbString Then
        t = Trim$(CStr(v))
        t = StrConv(t, vbNarrow)
        t = Replace(t, ",", "")
        t = Replace(t, " ", "")
        t = Replace(t, ChrW(&H25B2), "-")
        t = Replace(t, ChrW(&H25B3), "-")
        If Len(t) = 0 Then Exit Function
        If IsNumeric(t) Then ToNum = CDbl(t)
    ElseIf IsNumeric(v) Then
        ToNum = CDbl(v)
    End If
End Function

Private Function 検算NG件数(ByVal wb As Object) As Long
    Dim ws As Object, r As Long, n As Long, lastR As Long, v As Variant
    Set ws = wb.Worksheets(SH_CHECK)
    lastR = LastRow(ws, 6)
    For r = 5 To lastR
        v = ws.Cells(r, "F").Value
        If Not IsError(v) Then
            If CStr(v) = "NG" Then n = n + 1
        End If
    Next r
    検算NG件数 = n
End Function

'--------------------------------------------------------------------
' 1 基幹データ取込
'--------------------------------------------------------------------
Public Sub 基幹データ取込()
    Dim fn As Variant, wbS As Workbook, n As Long, skipped As Long, ws As Worksheet
    fn = Application.GetOpenFilename( _
        "基幹システム出力 (*.csv;*.txt;*.xls;*.xlsx;*.xlsm),*.csv;*.txt;*.xls;*.xlsx;*.xlsm", , _
        "基幹システムの出力ファイル（勘定科目・借方・貸方）を選択")
    If VarType(fn) = vbBoolean Then Exit Sub

    Application.ScreenUpdating = False
    On Error GoTo EH
    Set wbS = Workbooks.Open(Filename:=CStr(fn), ReadOnly:=True, UpdateLinks:=0)
    Set ws = ThisWorkbook.Worksheets(SH_IN)
    n = 取込_本体(wbS.Worksheets(1), ws, skipped)
    wbS.Close SaveChanges:=False
    Set wbS = Nothing
    Application.Calculate
    Application.ScreenUpdating = True
    ws.Activate

    Dim msg As String
    msg = n & " 行を取り込みました。" & vbCrLf
    If skipped > 0 Then msg = msg & "※貼り付け欄(" & (IN_LAST - IN_FIRST + 1) & "行)を超えた " & skipped & " 行は取り込んでいません。" & vbCrLf
    msg = msg & vbCrLf & ws.Range("D17").Value & vbCrLf & ws.Range("D18").Value
    msg = msg & vbCrLf & "検算NG: " & 検算NG件数(ThisWorkbook) & " 件"
    MsgBox msg, vbInformation, "基幹データ取込"
    Exit Sub
EH:
    Application.ScreenUpdating = True
    If Not wbS Is Nothing Then wbS.Close SaveChanges:=False
    MsgBox "取込に失敗しました。" & vbCrLf & Err.Description, vbExclamation, "基幹データ取込"
End Sub

' 取込先: 入力!A20:C219 に 勘定科目 / 借方 / 貸方 を値で書き込む。戻り値=取り込んだ行数
Public Function 取込_本体(ByVal wsSrc As Object, ByVal wsDst As Object, ByRef skipped As Long) As Long
    Dim cName As Long, cDr As Long, cCr As Long, hdr As Long
    Dim r As Long, c As Long, t As String
    Dim a As Long, b As Long, d As Long

    ' 見出し行(科目・借方・貸方)を探す。見つからなければ 1・2・3 列目とみなす
    For r = 1 To 30
        a = 0: b = 0: d = 0
        For c = 1 To 30
            t = SafeStr(wsSrc.Cells(r, c).Value)
            t = Replace(Replace(t, " ", ""), ChrW(&H3000), "")
            If a = 0 Then
                If t = "科目" Or t = "勘定科目" Or t = "科目名" Or t = "勘定科目名" Then a = c
            End If
            If b = 0 Then
                If InStr(t, "借方") > 0 Then b = c
            End If
            If d = 0 Then
                If InStr(t, "貸方") > 0 Then d = c
            End If
        Next c
        If a > 0 And b > 0 And d > 0 Then
            cName = a: cDr = b: cCr = d: hdr = r
            Exit For
        End If
    Next r
    If cName = 0 Then
        cName = 1: cDr = 2: cCr = 3: hdr = 0
    End If

    Dim k As Long, lastR As Long, nm As String, dr As Variant, cr As Variant
    For r = IN_FIRST To IN_LAST
        wsDst.Cells(r, 1).ClearContents
        wsDst.Cells(r, 2).ClearContents
        wsDst.Cells(r, 3).ClearContents
    Next r

    lastR = LastRow(wsSrc, cName)
    k = 0: skipped = 0
    For r = hdr + 1 To lastR
        nm = Trim$(SafeStr(wsSrc.Cells(r, cName).Value))
        If Len(nm) > 0 Then
            If InStr(nm, "合計") = 0 And InStr(nm, "小計") = 0 Then
                dr = ToNum(wsSrc.Cells(r, cDr).Value)
                cr = ToNum(wsSrc.Cells(r, cCr).Value)
                If Not (IsEmpty(dr) And IsEmpty(cr)) Then
                    If k >= IN_LAST - IN_FIRST + 1 Then
                        skipped = skipped + 1
                    Else
                        wsDst.Cells(IN_FIRST + k, 1).Value = nm
                        If Not IsEmpty(dr) Then wsDst.Cells(IN_FIRST + k, 2).Value = dr
                        If Not IsEmpty(cr) Then wsDst.Cells(IN_FIRST + k, 3).Value = cr
                        k = k + 1
                    End If
                End If
            End If
        End If
    Next r
    取込_本体 = k
End Function

'--------------------------------------------------------------------
' 2 検算
'--------------------------------------------------------------------
Public Sub 検算を実行()
    Dim ws As Worksheet, r As Long, lastR As Long, ng As Long, total As Long, lst As String, v As Variant
    Application.CalculateFull
    Set ws = ThisWorkbook.Worksheets(SH_CHECK)
    lastR = LastRow(ws, 6)
    For r = 5 To lastR
        v = ws.Cells(r, "F").Value
        If Not IsError(v) Then
            If CStr(v) <> "" Then total = total + 1
            If CStr(v) = "NG" Then
                ng = ng + 1
                If ng <= 8 Then lst = lst & vbCrLf & " No." & ws.Cells(r, "A").Value & "  " & Left$(CStr(ws.Cells(r, "B").Value), 34)
            End If
        End If
    Next r
    ws.Activate
    If ng = 0 Then
        MsgBox "すべてOKです。（" & total & "項目）", vbInformation, "検算結果"
    Else
        MsgBox "NGが " & ng & " 件あります。（全" & total & "項目）" & lst & vbCrLf & vbCrLf & "検算シートで差を確認してください。", vbExclamation, "検算結果"
    End If
End Sub

'--------------------------------------------------------------------
' 3 決算書PDF出力（印刷対象シートを1つのPDFに）
'--------------------------------------------------------------------
Public Sub 決算書PDF出力()
    Dim wb As Workbook, prev As Object, wsC As Object, f As Variant
    Dim lst() As Variant, n As Long, y As Variant
    Set wb = ThisWorkbook
    Set prev = ActiveSheet
    y = wb.Worksheets(SH_IN).Range("B5").Value

    ReDim lst(0 To 6)
    lst(0) = "決算精算表": lst(1) = "財務諸表": lst(2) = "附属明細表"
    lst(3) = "業務経理P18": lst(4) = "業務経理P19"
    n = 4
    Set wsC = 総括シート(wb)
    If Not wsC Is Nothing Then n = n + 1: lst(n) = wsC.Name
    ReDim Preserve lst(0 To n)

    f = Application.GetSaveAsFilename(InitialFileName:="決算書_令和" & y & "年度.pdf", _
            FileFilter:="PDF (*.pdf),*.pdf", Title:="PDFの保存先")
    If VarType(f) = vbBoolean Then Exit Sub

    On Error GoTo EH
    wb.Worksheets(lst).Select
    ActiveSheet.ExportAsFixedFormat Type:=0, Filename:=CStr(f), Quality:=0, _
        IncludeDocProperties:=True, IgnorePrintAreas:=False, OpenAfterPublish:=True
    prev.Select
    Exit Sub
EH:
    On Error Resume Next
    prev.Select
    MsgBox "PDF出力に失敗しました。" & vbCrLf & Err.Description, vbExclamation, "決算書PDF出力"
End Sub

'--------------------------------------------------------------------
' 4 次年度ブック作成
'--------------------------------------------------------------------
Public Sub 次年度ブック作成()
    Dim wbSrc As Workbook, wbN As Workbook, y As Long, f As Variant, ng As Long, ext As String
    Set wbSrc = ThisWorkbook
    y = CLng(wbSrc.Worksheets(SH_IN).Range("B5").Value)

    If MsgBox("令和" & y & "年度のブックを元に、令和" & (y + 1) & "年度用の新しいブックを作成します。" & vbCrLf & _
              "（このブック自体は変更しません）" & vbCrLf & vbCrLf & _
              "・決算書P18/P19、総括表の「前年度」欄に今年度の決算額を引き継ぎます" & vbCrLf & _
              "・入力シート、予算額（事業計画額）、今年度欄をクリアします" & vbCrLf & vbCrLf & _
              "よろしいですか？", vbYesNo + vbQuestion, "次年度ブック作成") <> vbYes Then Exit Sub

    Application.CalculateFull
    ng = 検算NG件数(wbSrc)
    If ng > 0 Then
        If MsgBox("検算にNGが " & ng & " 件あります。このまま繰り越しますか？", vbYesNo + vbExclamation, "次年度ブック作成") <> vbYes Then Exit Sub
    End If

    ext = Mid$(wbSrc.Name, InStrRev(wbSrc.Name, "."))
    f = Application.GetSaveAsFilename(InitialFileName:="決算業務統合ブック_令和" & (y + 1) & "年度" & ext, _
            FileFilter:="Excelブック (*" & ext & "),*" & ext, Title:="新年度ブックの保存先")
    If VarType(f) = vbBoolean Then Exit Sub
    If StrComp(CStr(f), wbSrc.FullName, vbTextCompare) = 0 Then
        MsgBox "元のブックと同じファイル名は指定できません。", vbExclamation
        Exit Sub
    End If

    On Error GoTo EH
    Application.ScreenUpdating = False
    wbSrc.SaveCopyAs CStr(f)
    Set wbN = Workbooks.Open(CStr(f))
    次年度_適用 wbN
    Application.CalculateFull
    wbN.Save
    Application.ScreenUpdating = True
    wbN.Worksheets(SH_IN).Activate
    MsgBox "令和" & (y + 1) & "年度用ブックを作成しました。" & vbCrLf & CStr(f) & vbCrLf & vbCrLf & _
           "【残りの手作業】" & vbCrLf & _
           "1. 入力シート：審査日・統計システム確定値・基幹データ（マクロ1で取込）" & vbCrLf & _
           "2. 附属明細表：未払金・未収金などの明細、固定資産・減価償却の明細" & vbCrLf & _
           "3. 決算書P18/P19：事業計画額（予算額）、P18の定款繰入額（AJ9）・AJ11" & vbCrLf & _
           "4. 総括表：他の経理（短期・長期・保健・貸付）の今年度欄" & vbCrLf & _
           "5. セルコメントの文章、総括表（メモあり）の参照先", vbInformation, "次年度ブック作成"
    Exit Sub
EH:
    Application.ScreenUpdating = True
    MsgBox "次年度ブックの作成に失敗しました。" & vbCrLf & Err.Description, vbExclamation, "次年度ブック作成"
End Sub

' 新年度ブックへの繰越処理(本体)。書き込み先は全て「ロックされていない入力セル」
Public Sub 次年度_適用(ByVal wb As Object)
    Dim wsIn As Object, w18 As Object, w19 As Object, wsA As Object, wsC As Object
    Dim r As Long, i As Long, y As Long
    Dim cur As Variant, prv As Variant

    Set wsIn = wb.Worksheets(SH_IN)
    Set w18 = wb.Worksheets("業務経理P18")
    Set w19 = wb.Worksheets("業務経理P19")
    Set wsA = wb.Worksheets("附属明細表")
    Set wsC = 総括シート(wb)
    y = CLng(wsIn.Range("B5").Value)

    ' (1) 決算書: 前年度欄 <- 今年度の値（値として貼り付け）
    For r = 6 To 11
        CopyVal w18.Cells(r, "Y"), w18.Cells(r, "AJ")
    Next r
    CopyVal w18.Range("Y21"), w18.Range("AJ21")
    For r = 27 To 31
        CopyVal w18.Cells(r, "AN"), w18.Cells(r, "V")
    Next r
    For r = 5 To 25
        CopyVal w19.Cells(r, "AN"), w19.Cells(r, "V")
    Next r
    wsA.Range("E115").Value2 = wsA.Range("Q115").Value2     ' 減価償却累計額の前期繰越額

    ' (2) 総括表(メモなし): 前年度列 <- 今年度列
    If Not wsC Is Nothing Then
        cur = Array("E", "H", "K", "N", "Q")
        prv = Array("F", "I", "L", "O", "R")
        For i = 0 To 4
            For r = 6 To 27
                CopyVal wsC.Range(prv(i) & r), wsC.Range(cur(i) & r)
            Next r
            For r = 29 To 48
                CopyVal wsC.Range(prv(i) & r), wsC.Range(cur(i) & r)
            Next r
        Next i
        ' 今年度欄のクリア（数式セルは残す。業務経理K列は精算表へのリンクなので残る）
        For i = 0 To 4
            For r = 7 To 48
                If r <> 28 Then
                    If Not wsC.Range(cur(i) & r).HasFormula Then wsC.Range(cur(i) & r).ClearContents
                End If
            Next r
        Next i
    End If

    ' (3) 予算額・定款繰入額のクリア（前年の予算が残らないように）
    For r = 5 To 25
        w19.Cells(r, "M").ClearContents
    Next r
    For r = 27 To 31
        w18.Cells(r, "M").ClearContents
    Next r
    w18.Range("AJ9").ClearContents
    w18.Range("AJ11").ClearContents
    wsA.Range("E125").ClearContents

    ' (4) 入力シート
    wsIn.Range("B5").Value2 = y + 1
    wsIn.Range("B6").ClearContents
    For r = 11 To 14
        wsIn.Cells(r, "B").ClearContents
    Next r
    For r = IN_FIRST To IN_LAST
        wsIn.Cells(r, 1).ClearContents
        wsIn.Cells(r, 2).ClearContents
        wsIn.Cells(r, 3).ClearContents
    Next r

    ' (5) 総括表シート名を新年度に
    If Not wsC Is Nothing Then
        On Error Resume Next
        wsC.Name = ChrW(&H3007) & "総括" & ChrW(&H3000) & y & ChrW(&HFF5E) & (y + 1) & ChrW(&HFF08) & "メモなし" & ChrW(&HFF09)
        On Error GoTo 0
    End If
End Sub
