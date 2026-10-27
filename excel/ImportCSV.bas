Attribute VB_Name = "ImportCSV"
Option Explicit

' ============================================================
'  発券機CSVの取り込み（市民部・厚生部共通）
'  フォルダを選ぶと、その下のCSVを全部読んで、区×年月×15分枠の
'  小さな集計表にして「取込_○○」シートへ書き込みます。
'  元データそのものはブックに残らないので、ファイルは軽いままです。
' ============================================================

Private Const BASE_YEAR As Long = 2023
Private Const MAX_MONTH As Long = 72
Private Const MAX_NAMES As Long = 500
Private Const FIRST_ROW As Long = 8
Private Const LAST_ROW As Long = 1007
Private Const NAME_LAST_ROW As Long = 507

Private cnt() As Long
Private ssum() As Double
Private scnt() As Long
Private nmCnt() As Long
Private nmSum() As Double
Private nmN() As Long
Private nmTot() As Long
Private nmKey() As String
Private nmCount As Long
Private nmDic As Object
Private seen As Object
Private nFiles As Long
Private nDup As Long
Private nSkip As Long
Private nRows As Long

Public Sub Import_Shimin()
    RunImport "取込_市民部", False
End Sub

Public Sub Import_Kosei()
    RunImport "取込_厚生部", True
End Sub

' ---- 区名から区番号（1～8）を返す。見つからなければ0 ------------
Private Function WardOf(ByVal s As String) As Long
    Dim keys As Variant, nums As Variant, i As Long
    keys = Array("安佐南区", "安佐北区", "中区", "東区", "南区", "西区", "安芸区", "佐伯区")
    nums = Array(5, 6, 1, 2, 3, 4, 7, 8)
    WardOf = 0
    For i = 0 To 7
        If InStr(s, keys(i)) > 0 Then
            WardOf = nums(i)
            Exit Function
        End If
    Next i
End Function

' ---- ファイル名の「CD＋6桁」から年月日を取り出す ------------------
Private Function ParseDate(ByVal fname As String, ByRef y As Long, ByRef m As Long, ByRef d As Long) As Boolean
    Dim u As String, p As Long, t As String
    u = UCase$(fname)
    p = InStr(1, u, "CD")
    Do While p > 0
        t = Mid$(u, p + 2, 6)
        If t Like "######" Then
            y = 2000 + CLng(Mid$(t, 1, 2))
            m = CLng(Mid$(t, 3, 2))
            d = CLng(Mid$(t, 5, 2))
            ParseDate = True
            Exit Function
        End If
        p = InStr(p + 1, u, "CD")
    Loop
    ParseDate = False
End Function

' ---- "HH:MM:SS" を秒に直す。読めなければ-1 -----------------------
Private Function Secs(ByVal s As String) As Long
    Dim a As Long, b As Long, h As String, n As String, c As String
    a = InStr(s, ":")
    If a = 0 Then Secs = -1: Exit Function
    b = InStr(a + 1, s, ":")
    If b = 0 Then Secs = -1: Exit Function
    h = Trim$(Left$(s, a - 1))
    n = Mid$(s, a + 1, b - a - 1)
    c = Mid$(s, b + 1)
    If Not (IsNumeric(h) And IsNumeric(n) And IsNumeric(c)) Then Secs = -1: Exit Function
    Secs = CLng(h) * 3600 + CLng(n) * 60 + CLng(c)
End Function

' ---- メイン処理 ---------------------------------------------------
Private Sub RunImport(ByVal sheetName As String, ByVal withNames As Boolean)
    Dim fd As Object, root As String, t0 As Double
    Set fd = Application.FileDialog(4)
    fd.Title = "発券機CSVが入っているフォルダを選んでください"
    If fd.Show <> -1 Then Exit Sub
    root = fd.SelectedItems(1)
    t0 = Timer

    Dim oldCalc As Long
    oldCalc = Application.Calculation
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Application.Calculation = -4135
    On Error GoTo Fin

    ReDim cnt(1 To 8, 1 To MAX_MONTH, 0 To 95)
    ReDim ssum(1 To 8, 1 To MAX_MONTH)
    ReDim scnt(1 To 8, 1 To MAX_MONTH)
    ReDim nmCnt(1 To MAX_NAMES, 0 To 95)
    ReDim nmSum(1 To MAX_NAMES)
    ReDim nmN(1 To MAX_NAMES)
    ReDim nmTot(1 To MAX_NAMES)
    ReDim nmKey(1 To MAX_NAMES)
    nmCount = 0
    Set nmDic = CreateObject("Scripting.Dictionary")
    Set seen = CreateObject("Scripting.Dictionary")
    nFiles = 0: nDup = 0: nSkip = 0: nRows = 0

    ScanFolders root, withNames
    WriteMain sheetName, root
    If withNames Then WriteNames
    Application.StatusBar = False
    Application.Calculation = oldCalc
    Application.Calculate
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    MsgBox "取り込みが終わりました。" & vbCrLf & _
           "ファイル：" & nFiles & "　重複スキップ：" & nDup & "　行数：" & Format$(nRows, "#,##0") & vbCrLf & _
           "所要時間：" & Format$(Timer - t0, "0.0") & "秒", vbInformation
    Exit Sub
Fin:
    Dim msg As String
    msg = Err.Description
    Application.StatusBar = False
    Application.Calculation = oldCalc
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    MsgBox "取り込み中にエラーが出ました：" & msg, vbExclamation
End Sub

' ---- 浅いフォルダから順に読む（同じ区・同じ日は最初の1つだけ使う）--
Private Sub ScanFolders(ByVal root As String, ByVal withNames As Boolean)
    Dim fso As Object, q As Collection, fld As Object, sf As Object, fl As Object
    Dim stm As Object, w As Long, y As Long, m As Long, d As Long, key As String, mi As Long
    Dim txt As String, nm As String
    Set fso = CreateObject("Scripting.FileSystemObject")
    Set stm = CreateObject("ADODB.Stream")
    Set q = New Collection
    q.Add root
    Do While q.Count > 0
        Set fld = fso.GetFolder(q(1))
        q.Remove 1
        For Each sf In fld.SubFolders
            If InStr(sf.Name, "全区") = 0 Then q.Add sf.Path
        Next sf
        w = WardOf(fld.Name)
        For Each fl In fld.Files
            nm = fl.Name
            If LCase$(Right$(nm, 4)) = ".csv" Then
                If ParseDate(nm, y, m, d) Then
                    If w = 0 Then
                        nSkip = nSkip + 1
                    Else
                        key = w & "|" & (y * 10000 + m * 100 + d)
                        If seen.Exists(key) Then
                            nDup = nDup + 1
                        Else
                            seen.Add key, 1
                            nFiles = nFiles + 1
                            mi = (y - BASE_YEAR) * 12 + m
                            If mi >= 1 And mi <= MAX_MONTH Then
                                stm.Type = 2
                                stm.Charset = "Shift_JIS"
                                stm.Open
                                stm.LoadFromFile fl.Path
                                txt = stm.ReadText(-1)
                                stm.Close
                                CountLines txt, w, mi, withNames
                            End If
                        End If
                    End If
                End If
            End If
        Next fl
        Application.StatusBar = "取込中… ファイル " & nFiles & "　行数 " & Format$(nRows, "#,##0")
        DoEvents
    Loop
End Sub

' ---- 1ファイル分の行を数える ------------------------------------
Private Sub CountLines(ByVal txt As String, ByVal w As Long, ByVal mi As Long, ByVal withNames As Boolean)
    Dim lines() As String, i As Long, f() As String, t0 As Long, t1 As Long, t2 As Long
    Dim sl As Long, ok As Boolean, k As String, idx As Long, mn As Double
    lines = Split(txt, vbLf)
    For i = 0 To UBound(lines)
        f = Split(lines(i), ",")
        If UBound(f) >= 40 Then
            t0 = Secs(f(4))
            If t0 >= 0 Then
                sl = t0 \ 900
                If sl <= 95 Then
                    cnt(w, mi, sl) = cnt(w, mi, sl) + 1
                    nRows = nRows + 1
                    t1 = Secs(f(39))
                    t2 = Secs(f(40))
                    ok = (t1 >= 0 And t2 >= t1)
                    If ok Then
                        mn = (t2 - t1) / 60
                        ssum(w, mi) = ssum(w, mi) + mn
                        scnt(w, mi) = scnt(w, mi) + 1
                    End If
                    If withNames Then
                        k = Replace(f(2), """", "")
                        If nmDic.Exists(k) Then
                            idx = nmDic(k)
                        ElseIf nmCount < MAX_NAMES Then
                            nmCount = nmCount + 1
                            idx = nmCount
                            nmDic.Add k, idx
                            nmKey(idx) = k
                        Else
                            idx = 0
                        End If
                        If idx > 0 Then
                            nmTot(idx) = nmTot(idx) + 1
                            nmCnt(idx, sl) = nmCnt(idx, sl) + 1
                            If ok Then
                                nmSum(idx) = nmSum(idx) + mn
                                nmN(idx) = nmN(idx) + 1
                            End If
                        End If
                    End If
                End If
            End If
        End If
    Next i
End Sub

' ---- 区×年月の表を書き出す ----------------------------------------
Private Sub WriteMain(ByVal sheetName As String, ByVal root As String)
    Dim ws As Worksheet, w As Long, mi As Long, j As Long, n As Long, tot As Long
    Dim names As Variant, out() As Variant, r As Long
    names = Array("", "中区", "東区", "南区", "西区", "安佐南区", "安佐北区", "安芸区", "佐伯区")
    Set ws = ThisWorkbook.Worksheets(sheetName)
    n = 0
    For w = 1 To 8
        For mi = 1 To MAX_MONTH
            tot = 0
            For j = 0 To 95
                tot = tot + cnt(w, mi, j)
            Next j
            If tot > 0 Then n = n + 1
        Next mi
    Next w
    ws.Range(ws.Cells(FIRST_ROW, 1), ws.Cells(LAST_ROW, 101)).ClearContents
    If n > 0 Then
        ReDim out(1 To n, 1 To 101)
        r = 0
        For w = 1 To 8
            For mi = 1 To MAX_MONTH
                tot = 0
                For j = 0 To 95
                    tot = tot + cnt(w, mi, j)
                Next j
                If tot > 0 Then
                    r = r + 1
                    out(r, 1) = names(w)
                    out(r, 2) = (BASE_YEAR + (mi - 1) \ 12) * 100 + ((mi - 1) Mod 12) + 1
                    out(r, 3) = tot
                    out(r, 4) = ssum(w, mi)
                    out(r, 5) = scnt(w, mi)
                    For j = 0 To 95
                        If cnt(w, mi, j) > 0 Then out(r, 6 + j) = cnt(w, mi, j)
                    Next j
                End If
            Next mi
        Next w
        ws.Range(ws.Cells(FIRST_ROW, 1), ws.Cells(FIRST_ROW + n - 1, 101)).Value = out
    End If
    ws.Range("B3").Value = root
    ws.Range("B4").Value = Format$(Now, "yyyy/mm/dd hh:nn")
    ws.Range("B5").Value = "ファイル " & Format$(nFiles, "#,##0") & "　重複スキップ " & Format$(nDup, "#,##0") & "　取込件数 " & Format$(nRows, "#,##0")
End Sub

' ---- 業務別の表を書き出す（発券数の多い順）-----------------------
Private Sub WriteNames()
    Dim ws As Worksheet, ord() As Long, i As Long, j As Long, k As Long, tmp As Long
    Dim out() As Variant, n As Long
    Set ws = ThisWorkbook.Worksheets("取込_業務別")
    ws.Range(ws.Cells(FIRST_ROW, 1), ws.Cells(NAME_LAST_ROW, 100)).ClearContents
    n = nmCount
    If n = 0 Then Exit Sub
    ReDim ord(1 To n)
    For i = 1 To n
        ord(i) = i
    Next i
    For i = 1 To n - 1
        For j = i + 1 To n
            If nmTot(ord(j)) > nmTot(ord(i)) Then
                tmp = ord(i): ord(i) = ord(j): ord(j) = tmp
            End If
        Next j
    Next i
    ReDim out(1 To n, 1 To 100)
    For i = 1 To n
        k = ord(i)
        out(i, 1) = nmKey(k)
        out(i, 2) = nmTot(k)
        out(i, 3) = nmSum(k)
        out(i, 4) = nmN(k)
        For j = 0 To 95
            If nmCnt(k, j) > 0 Then out(i, 5 + j) = nmCnt(k, j)
        Next j
    Next i
    ws.Range(ws.Cells(FIRST_ROW, 1), ws.Cells(FIRST_ROW + n - 1, 100)).Value = out
End Sub
