Attribute VB_Name = "modパッチ_職員別対象外"
Option Explicit
' ==================================================================
'  パッチ：「職員別一覧」で、子の2歳到達日の前々日（職員マスタF列）が属する月の「翌月以降」の月に
'          「対象外」と表示し、赤く塗る
'
'   例）F列が令和8年12月26日 → 令和8年12月分までは通常どおり、令和9年1月分から「対象外」（赤）
'
'  【適用方法】（作業前に必ずこのファイルのコピーを保存してください）
'   1. Alt+F11 → ファイル → ファイルのインポート で、このファイルを取り込む
'   2. Alt+F8 → 「職員別一覧に対象外を表示する」を実行（何回実行しても同じ結果です）
'   3. 完了メッセージを確認し、取り込んだこのモジュールは削除して構いません
'
'  【変更内容】「職員別一覧」の月ごとのセルの数式と書式だけを書き換えます（入力内容は変わりません）
'   ・保留中の請求がある月                  → 「保留」（従来どおり）
'   ・支給済の請求がある月                  → 決定額（従来どおり。到達後でも支給済ならそのまま）
'   ・F列の月より後の月                     → 「対象外」（赤塗り・白文字）
'   ・それ以外                              → 従来どおり（決定額／空欄）
'   ・4行目に各月の1日の日付（灰色の小さな文字）を補助として入れます
' ==================================================================

Private Function 列記号(ByVal w As Worksheet, ByVal 見出し As String, ByVal 番目 As Long) As String
    Dim c As Long, k As Long
    For c = 1 To 80
        If CStr(w.Cells(5, c).Value) = 見出し Then
            k = k + 1
            If k = 番目 Then 列記号 = Split(w.Cells(1, c).Address(True, False), "$")(0): Exit Function
        End If
    Next c
End Function

Public Sub 職員別一覧に対象外を表示する()
    Dim w As Worksheet, m As Worksheet, nL As String, kL As String, sL As String, fL As String
    Dim c As Long, lastC As Long, lastR As Long, t As String, p As Long, f As String
    Dim i As Long, fc As Object, msg As String, n As Long, oldSh As Worksheet, oldCell As Range

    Set w = ThisWorkbook.Worksheets("請求記録")
    Set m = ThisWorkbook.Worksheets("職員別一覧")
    nL = 列記号(w, "職員番号", 1): kL = 列記号(w, "対象月", 2): sL = 列記号(w, "ステータス", 1): fL = 列記号(w, "決定額", 1)
    If nL = "" Then msg = msg & "職員番号 "
    If kL = "" Then msg = msg & "対象月（R8.4形式の列） "
    If sL = "" Then msg = msg & "ステータス "
    If fL = "" Then msg = msg & "決定額 "
    If msg <> "" Then
        MsgBox "「請求記録」の5行目に、次の見出しが見つかりません：" & vbLf & msg & vbLf & "パッチを適用できません。", vbExclamation
        Exit Sub
    End If

    ' 月の列（職員別一覧の5行目が「R8.4」の形式の列）
    c = 4
    Do While CStr(m.Cells(5, c).Value) Like "R*.*"
        c = c + 1
    Loop
    lastC = c - 1
    If lastC < 4 Then MsgBox "職員別一覧の5行目に、月の見出し（R7.4 など）が見つかりません。", vbExclamation: Exit Sub
    lastR = m.Cells(m.Rows.Count, "A").End(xlUp).Row
    If lastR < 6 Then lastR = 405
    If MsgBox("「職員別一覧」の月ごとの数式と書式を書き換えます（入力内容は変わりません）。" & vbLf & "よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    ' 4行目：各月の1日（補助）
    For c = 4 To lastC
        t = CStr(m.Cells(5, c).Value)
        p = InStr(t, ".")
        m.Cells(4, c).Value = DateSerial(2018 + Val(Mid(t, 2, p - 2)), Val(Mid(t, p + 1)), 1)
        m.Cells(4, c).NumberFormat = "yyyy/m"
        m.Cells(4, c).Font.Size = 8
        m.Cells(4, c).Font.Color = RGB(166, 166, 166)
    Next c
    m.Range("A3").Value = "赤＝対象外（子の2歳到達日の前々日（職員マスタF列）が属する月の翌月以降）"
    m.Range("A3").Font.Size = 9
    m.Range("A3").Font.Color = RGB(192, 0, 0)

    ' 数式（D6を基準に全体へ）
    f = "=IF($A6='','',IF(COUNTIFS(請求記録!$@n@$6:$@n@$3005,$A6,請求記録!$@k@$6:$@k@$3005,D$5,請求記録!$@s@$6:$@s@$3005,'保留中')>0,'保留'," & _
        "IF(COUNTIFS(請求記録!$@n@$6:$@n@$3005,$A6,請求記録!$@k@$6:$@k@$3005,D$5,請求記録!$@s@$6:$@s@$3005,'支給済')>0," & _
        "SUMIFS(請求記録!$@f@$6:$@f@$3005,請求記録!$@n@$6:$@n@$3005,$A6,請求記録!$@k@$6:$@k@$3005,D$5)," & _
        "IF(AND(ISNUMBER(職員マスタ!$F6),職員マスタ!$F6>0,D$4>職員マスタ!$F6),'対象外'," & _
        "IF(COUNTIFS(請求記録!$@n@$6:$@n@$3005,$A6,請求記録!$@k@$6:$@k@$3005,D$5)=0,''," & _
        "SUMIFS(請求記録!$@f@$6:$@f@$3005,請求記録!$@n@$6:$@n@$3005,$A6,請求記録!$@k@$6:$@k@$3005,D$5))))))"
    f = Replace(f, "'", Chr(34))
    f = Replace(f, "@n@", nL): f = Replace(f, "@k@", kL): f = Replace(f, "@s@", sL): f = Replace(f, "@f@", fL)
    m.Range(m.Cells(6, 4), m.Cells(lastR, lastC)).Formula = f

    ' 書式：対象外＝赤塗り（条件付き書式は選択セル基準で式が解釈されるため、D6を選択して追加する）
    Set oldSh = ActiveSheet
    Set oldCell = ActiveCell
    m.Activate
    m.Range("D6").Select
    On Error Resume Next
    For i = m.Range(m.Cells(6, 4), m.Cells(lastR, lastC)).FormatConditions.Count To 1 Step -1
        If InStr(m.Range(m.Cells(6, 4), m.Cells(lastR, lastC)).FormatConditions(i).Formula1, "対象外") > 0 Then m.Range(m.Cells(6, 4), m.Cells(lastR, lastC)).FormatConditions(i).Delete
    Next i
    On Error GoTo 0
    Set fc = m.Range(m.Cells(6, 4), m.Cells(lastR, lastC)).FormatConditions.Add(Type:=xlExpression, Formula1:="=D6=" & Chr(34) & "対象外" & Chr(34))
    fc.Interior.Color = RGB(255, 0, 0)
    fc.Font.Color = RGB(255, 255, 255)
    fc.Font.Bold = True
    On Error Resume Next
    fc.SetFirstPriority
    On Error GoTo 0
    oldSh.Activate
    oldCell.Select

    Application.Calculation = xlCalculationAutomatic
    Application.Calculate
    Application.ScreenUpdating = True
    n = Application.WorksheetFunction.CountIf(m.Range(m.Cells(6, 4), m.Cells(lastR, lastC)), "対象外")
    MsgBox "パッチを適用しました。" & vbLf & "職員別一覧の「対象外」のセル：" & n & " 個", vbInformation
End Sub
