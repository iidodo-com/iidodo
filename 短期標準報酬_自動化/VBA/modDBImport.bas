Attribute VB_Name = "modDBImport"
Option Explicit

' 基幹システム抽出データ(4ファイル)を同じフォルダから読み込み、DBP1BC2/DBP7C85/DBP2BB1/DBP59FA の4シートへ書き込む
' ボタン「データを取り込む」から ImportDB を実行する

Private Const COL_BIRTH As Long = 12    ' L列 A07_SEI_YMD(生年月日)
Private Const COL_LOSS As Long = 31     ' AE列 A07_SOSITU_YMD(資格喪失日。在職は00000000)
Private Const MAX_ROWS As Long = 10000  ' 集計式が見る最終行
Private Const RUN_SHEET As String = "実行"
Private Const LOG_FIRST As Long = 14    ' 取込結果の先頭行
Private Const SCAN_FIRST As Long = 22   ' 判定結果の先頭行

' 読み込んだファイルごとの情報（添字が同じものが同じファイル）
Private mF() As String      ' ファイル名
Private mS() As String      ' 元シート名
Private mD() As Variant     ' データ(2次元配列)
Private mR() As Long        ' 行数(見出し含む)
Private mC() As Long        ' 列数
Private mBmin() As Double   ' 生年月日の最小
Private mBmax() As Double   ' 生年月日の最大
Private mShare() As Double  ' 資格喪失日のある行の割合
Private mKind() As String   ' 判定結果 ACQ/RET/E60/E61/?
Private mNote() As String   ' 備考
Private mN As Long

Public Sub ImportDB()
    Dim wsRun As Worksheet
    Dim folder As String, sep As String, f As String
    Dim names() As String, n As Long, i As Long
    Dim wb As Workbook, sh As Worksheet
    Dim prevEvents As Boolean, prevAlerts As Boolean, prevUpd As Boolean
    Dim msg As String

    Set wsRun = ThisWorkbook.Worksheets(RUN_SHEET)
    folder = ThisWorkbook.Path
    If Len(folder) = 0 Then
        MsgBox "このブックを一度保存してから実行してください。", vbExclamation
        Exit Sub
    End If
    If Left$(folder, 4) = "http" Then
        MsgBox "OneDrive/SharePoint上では実行できません。パソコン内のフォルダに置いてください。", vbExclamation
        Exit Sub
    End If
    sep = Application.PathSeparator

    ' フォルダ内のExcelファイル一覧（このブック自身と一時ファイルは除く）
    n = 0
    f = Dir(folder & sep & "*.xls*")
    Do While Len(f) > 0
        If StrComp(f, ThisWorkbook.Name, vbTextCompare) <> 0 And Left$(f, 2) <> "~$" And Left$(f, 1) <> "." Then
            ReDim Preserve names(0 To n)
            names(n) = f
            n = n + 1
        End If
        f = Dir()
    Loop
    If n = 0 Then
        MsgBox "同じフォルダに抽出ファイルがありません。" & vbCrLf & folder, vbExclamation
        Exit Sub
    End If

    If MsgBox("同じフォルダの抽出ファイルを読み込み、DBP1BC2・DBP7C85・DBP2BB1・DBP59FAの各シートの" & _
              "既存データを書き換えます。よろしいですか？" & vbCrLf & folder, vbOKCancel + vbQuestion) <> vbOK Then Exit Sub

    prevEvents = Application.EnableEvents
    prevAlerts = Application.DisplayAlerts
    prevUpd = Application.ScreenUpdating
    On Error GoTo EH
    Application.EnableEvents = False
    Application.DisplayAlerts = False
    Application.ScreenUpdating = False

    ClearLogs wsRun
    ReDim mF(0 To n - 1): ReDim mS(0 To n - 1): ReDim mD(0 To n - 1)
    ReDim mR(0 To n - 1): ReDim mC(0 To n - 1)
    ReDim mBmin(0 To n - 1): ReDim mBmax(0 To n - 1): ReDim mShare(0 To n - 1)
    ReDim mKind(0 To n - 1): ReDim mNote(0 To n - 1)
    mN = n
    For i = 0 To n - 1
        Application.StatusBar = "読み込み中 (" & (i + 1) & "/" & n & ") " & names(i)
        mF(i) = names(i)
        Set wb = Nothing
        On Error Resume Next
        Set wb = Workbooks.Open(Filename:=folder & sep & names(i), UpdateLinks:=0, ReadOnly:=True, AddToMru:=False)
        If Err.Number <> 0 Then
            mNote(i) = "開けませんでした"
            Err.Clear
        End If
        On Error GoTo EH
        If Not wb Is Nothing Then
            If SheetExists(wb, "DB_集計") Then
                mNote(i) = "集計ツール本体のため対象外"
            Else
                Set sh = FindRawSheet(wb)
                If sh Is Nothing Then
                    mNote(i) = "抽出データのシートが見つかりません"
                Else
                    ReadSheet sh, i
                End If
            End If
            wb.Close SaveChanges:=False
            Set wb = Nothing
        End If
    Next i

    ' 4種類への振り分け
    msg = Classify()
    WriteScan wsRun
    If Len(msg) > 0 Then
        Application.StatusBar = False
        Restore prevEvents, prevAlerts, prevUpd
        MsgBox "取り込めませんでした（何も書き換えていません）。" & vbCrLf & msg & vbCrLf & _
               "「実行」シートの判定結果を確認してください。", vbExclamation
        Exit Sub
    End If

    ' 書き込み
    Dim tgt As Variant, kinds As Variant, k As Long, idx As Long, r As Long
    tgt = Array("DBP1BC2", "DBP7C85", "DBP2BB1", "DBP59FA")
    kinds = Array("ACQ", "RET", "E60", "E61")
    For k = 0 To 3
        idx = FindKind(CStr(kinds(k)))
        Application.StatusBar = "書き込み中 " & tgt(k)
        WriteData ThisWorkbook.Worksheets(CStr(tgt(k))), mD(idx), mR(idx), mC(idx)
        r = LOG_FIRST + k
        wsRun.Cells(r, 2).Value = tgt(k)
        wsRun.Cells(r, 3).Value = mF(idx)
        wsRun.Cells(r, 4).Value = mS(idx)
        wsRun.Cells(r, 5).Value = mR(idx) - 1
        wsRun.Cells(r, 6).Value = mC(idx)
        wsRun.Cells(r, 7).Value = Now
    Next k
    Application.Calculate
    Application.StatusBar = False
    Restore prevEvents, prevAlerts, prevUpd
    MsgBox "4つのシートにデータを書き込みました。" & vbCrLf & _
           "DBP1BC2：" & mF(FindKind("ACQ")) & vbCrLf & _
           "DBP7C85：" & mF(FindKind("RET")) & vbCrLf & _
           "DBP2BB1：" & mF(FindKind("E60")) & vbCrLf & _
           "DBP59FA：" & mF(FindKind("E61")), vbInformation
    Exit Sub
EH:
    Dim em As String
    em = Err.Description
    On Error Resume Next
    If Not wb Is Nothing Then wb.Close SaveChanges:=False
    Application.StatusBar = False
    Restore prevEvents, prevAlerts, prevUpd
    MsgBox "エラーで中断しました：" & em, vbCritical
End Sub

Private Sub Restore(ev As Boolean, al As Boolean, up As Boolean)
    Application.EnableEvents = ev
    Application.DisplayAlerts = al
    Application.ScreenUpdating = up
End Sub

Private Function SheetExists(wb As Workbook, nm As String) As Boolean
    Dim s As Worksheet
    For Each s In wb.Worksheets
        If s.Name = nm Then
            SheetExists = True
            Exit Function
        End If
    Next s
End Function

' 先頭行がA07_SHOZOKU_NO / A07_SHO_NO の「元データ」シートを選ぶ（加工・編集・コピー等は後回し）
Private Function FindRawSheet(wb As Workbook) As Worksheet
    Dim s As Worksheet, best As Worksheet, sc As Long, bs As Long
    bs = -1
    For Each s In wb.Worksheets
        If CStr(s.Cells(1, 1).Value) = "A07_SHOZOKU_NO" And CStr(s.Cells(1, 2).Value) = "A07_SHO_NO" Then
            sc = 1
            If s.Name Like "DBP*" Then sc = 2
            If s.Name Like "DBP[0-9A-Z][0-9A-Z][0-9A-Z][0-9A-Z]" Then sc = 4
            If InStr(s.Name, "元データ") > 0 And InStr(s.Name, "加工") = 0 Then sc = 3
            If InStr(s.Name, "加工") > 0 Or InStr(s.Name, "編集") > 0 Or InStr(s.Name, "(") > 0 Or InStr(s.Name, "昨年") > 0 Then sc = 0
            If sc > bs Then
                bs = sc
                Set best = s
            End If
        End If
    Next s
    Set FindRawSheet = best
End Function

Private Sub ReadSheet(sh As Worksheet, i As Long)
    Dim lastRow As Long, lastCol As Long, j As Long
    Dim v As Double, nz As Long, tot As Long
    Dim d As Variant
    lastRow = sh.Cells(sh.Rows.Count, 1).End(xlUp).Row
    lastCol = sh.Cells(1, sh.Columns.Count).End(xlToLeft).Column
    If lastRow < 2 Or lastCol < COL_LOSS Then
        mNote(i) = "データがありません"
        Exit Sub
    End If
    d = sh.Range(sh.Cells(1, 1), sh.Cells(lastRow, lastCol)).Value
    mS(i) = sh.Name
    mD(i) = d
    mR(i) = lastRow
    mC(i) = lastCol
    mBmin(i) = 99999999
    mBmax(i) = 0
    For j = 2 To lastRow
        v = Val(CStr(d(j, COL_BIRTH)))
        If v > 0 Then
            If v < mBmin(i) Then mBmin(i) = v
            If v > mBmax(i) Then mBmax(i) = v
        End If
        tot = tot + 1
        If Val(CStr(d(j, COL_LOSS))) <> 0 Then nz = nz + 1
    Next j
    If tot > 0 Then mShare(i) = nz / tot
End Sub

Private Function IsOk(i As Long) As Boolean
    IsOk = (Len(mS(i)) > 0 And mR(i) >= 2)
End Function

' 戻り値：問題があれば説明文、なければ空文字
Private Function Classify() As String
    Dim i As Long, nNarrow As Long, a As Long, b As Long, j As Long, c As Long
    Dim nm As Variant, kk As Variant, s As String
    a = -1: b = -1
    For i = 0 To mN - 1
        mKind(i) = ""
        If IsOk(i) Then
            If mBmax(i) - mBmin(i) < 30000 Then
                nNarrow = nNarrow + 1
                If a < 0 Then
                    a = i
                Else
                    b = i
                End If
            ElseIf mShare(i) >= 0.5 Then
                mKind(i) = "RET"
            Else
                mKind(i) = "ACQ"
            End If
        End If
    Next i
    If nNarrow = 2 Then
        If mBmin(a) > mBmin(b) Then
            mKind(a) = "E60": mKind(b) = "E61"
        Else
            mKind(b) = "E60": mKind(a) = "E61"
        End If
    ElseIf nNarrow > 0 Then
        If a >= 0 Then mKind(a) = "?"
        If b >= 0 Then mKind(b) = "?"
    End If
    nm = Array("資格取得(DBP1BC2)", "資格喪失(DBP7C85)", "来年度60歳到達者(DBP2BB1)", "今年度60歳到達者(DBP59FA)")
    kk = Array("ACQ", "RET", "E60", "E61")
    For j = 0 To 3
        c = 0
        For i = 0 To mN - 1
            If mKind(i) = kk(j) Then c = c + 1
        Next i
        If c = 0 Then s = s & "・" & nm(j) & " のファイルが見つかりません" & vbCrLf
        If c > 1 Then s = s & "・" & nm(j) & " の候補が" & c & "個あります（不要なファイルをフォルダから出してください）" & vbCrLf
    Next j
    For i = 0 To mN - 1
        If mKind(i) = "?" Then s = s & "・" & mF(i) & " は60歳到達者のファイルが1つしかなく、来年度／今年度を判定できません" & vbCrLf
    Next i
    Classify = s
End Function

Private Function FindKind(k As String) As Long
    Dim i As Long
    FindKind = -1
    For i = 0 To mN - 1
        If mKind(i) = k Then
            FindKind = i
            Exit Function
        End If
    Next i
End Function

Private Sub WriteData(t As Worksheet, d As Variant, nR As Long, nC As Long)
    Dim j As Long, i As Long, isText As Boolean
    If nR > MAX_ROWS Then Err.Raise 513, , t.Name & " は" & MAX_ROWS & "行を超えています"
    t.Cells.ClearContents
    t.Cells.NumberFormat = "General"
    ' 元データが文字列の列(日付8桁など)は文字列のまま書く
    For j = 1 To nC
        isText = False
        For i = 2 To nR
            If Not IsEmpty(d(i, j)) Then
                isText = (VarType(d(i, j)) = vbString)
                Exit For
            End If
        Next i
        If isText Then t.Range(t.Cells(1, j), t.Cells(MAX_ROWS, j)).NumberFormat = "@"
    Next j
    t.Range(t.Cells(1, 1), t.Cells(nR, nC)).Value = d
End Sub

Private Sub ClearLogs(ws As Worksheet)
    ws.Range(ws.Cells(LOG_FIRST, 2), ws.Cells(LOG_FIRST + 3, 7)).ClearContents
    ws.Range(ws.Cells(SCAN_FIRST, 2), ws.Cells(SCAN_FIRST + 29, 7)).ClearContents
End Sub

Private Sub WriteScan(ws As Worksheet)
    Dim i As Long, r As Long, kn As String
    For i = 0 To mN - 1
        If i > 29 Then Exit For
        r = SCAN_FIRST + i
        ws.Cells(r, 2).Value = mF(i)
        ws.Cells(r, 3).Value = mS(i)
        If IsOk(i) Then
            ws.Cells(r, 4).Value = CLng(mBmin(i)) & " ～ " & CLng(mBmax(i))
            ws.Cells(r, 5).Value = Format(mShare(i), "0%")
            Select Case mKind(i)
                Case "ACQ": kn = "資格取得 → DBP1BC2"
                Case "RET": kn = "資格喪失 → DBP7C85"
                Case "E60": kn = "来年度60歳到達者 → DBP2BB1"
                Case "E61": kn = "今年度60歳到達者 → DBP59FA"
                Case Else: kn = "判定できません"
            End Select
            ws.Cells(r, 6).Value = kn
        Else
            ws.Cells(r, 6).Value = mNote(i)
        End If
    Next i
End Sub
