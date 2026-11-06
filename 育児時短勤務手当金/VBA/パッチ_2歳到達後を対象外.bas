Attribute VB_Name = "modパッチ_対象外"
Option Explicit
' ==================================================================
'  パッチ：対象月が「子の2歳到達日の前々日」（職員マスタF列）より後の月の請求を、
'          「不支給」ではなく「対象外」にする
'
'  【適用方法】（作業前に必ずこのファイルのコピーを保存してください）
'   1. Alt+F11 → ファイル → ファイルのインポート で、このファイルを取り込む
'   2. Alt+F8 → 「二歳到達後を対象外にする」を実行（1回だけ。何回実行しても同じ結果です）
'   3. 完了メッセージを確認し、取り込んだこのモジュールは削除して構いません
'
'  【変更内容】「請求記録」のステータス列の数式だけを書き換えます（入力内容は変わりません）
'   ・保留中（保留理由があり、解消日・支給月が空）  → 従来どおり「保留中」
'   ・支給月があり決定額が0円を超える              → 従来どおり「支給済」
'   ・対象月の初日が、職員マスタF列の日付より後    → 「対象外」（新規）
'   ・上記以外                                   → 従来どおり（不支給／要確認／未処理）
'   ※対象月の途中で到達日（前々日）を迎える月は、請求期間があるので「対象外」にしません
'   ※「対象外」は「不支給通知」の一覧には灰色の「対象外」として表示しますが、Word作成の対象にはなりません
'  【あわせて書き換えるもの】
'   ・「請求記録」の「不支給連番」列（一覧に「対象外」も載せるため）
'   ・「不支給通知」シートのJ列（状況）の数式（「対象外」を表示）と、「対象外」の灰色表示
' ==================================================================

Private Function 列記号(ByVal w As Worksheet, ByVal 見出し As String) As String
    Dim k As Variant
    k = Application.Match(見出し, w.Rows(5), 0)
    If Not IsError(k) Then 列記号 = Split(w.Cells(1, k).Address(True, False), "$")(0)
End Function

Public Sub 二歳到達後を対象外にする()
    Dim w As Worksheet, m As Worksheet, st As String, hr As String, he As String, pm As String
    Dim fin As String, mr As String, bom As String, last As Long, f As String, n As Long, msg As String
    Dim sq As String, g As String, h As String, nl As Worksheet, fc As Object, has As Boolean

    Set w = ThisWorkbook.Worksheets("請求記録")
    Set m = ThisWorkbook.Worksheets("職員マスタ")
    st = 列記号(w, "ステータス"): hr = 列記号(w, "保留理由"): he = 列記号(w, "保留解消日"): pm = 列記号(w, "支給月")
    fin = 列記号(w, "決定額"): mr = 列記号(w, "マスタ行"): bom = 列記号(w, "対象月初日")
    If st = "" Then msg = msg & "ステータス "
    If hr = "" Then msg = msg & "保留理由 "
    If he = "" Then msg = msg & "保留解消日 "
    If pm = "" Then msg = msg & "支給月 "
    If fin = "" Then msg = msg & "決定額 "
    If mr = "" Then msg = msg & "マスタ行 "
    If bom = "" Then msg = msg & "対象月初日 "
    If msg <> "" Then
        MsgBox "「請求記録」の5行目に、次の見出しが見つかりません：" & vbLf & msg & vbLf & "パッチを適用できません。", vbExclamation
        Exit Sub
    End If
    If InStr(CStr(m.Range("F5").Value), "2歳") = 0 Then
        If MsgBox("職員マスタのF列の見出しが「子の2歳到達日の前々日」ではありません（" & m.Range("F5").Value & "）。" & vbLf & "このまま続けますか？", vbYesNo + vbExclamation) <> vbYes Then Exit Sub
    End If
    If MsgBox("「請求記録」のステータス列の数式を書き換えます（入力内容は変わりません）。" & vbLf & "よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub

    f = "=IF($B6='','',IF(AND($@hr@6<>'',$@he@6='',$@pm@6=''),'保留中',IF(AND($@pm@6<>'',N($@fin@6)>0),'支給済'," & _
        "IF(AND($@mr@6<>'',$@bom@6<>'',IFERROR(AND(ISNUMBER(INDEX(職員マスタ!$F$6:$F$405,$@mr@6)),INDEX(職員マスタ!$F$6:$F$405,$@mr@6)>0," & _
        "INDEX(職員マスタ!$F$6:$F$405,$@mr@6)<$@bom@6),FALSE)),'対象外'," & _
        "IF($@pm@6<>'','不支給',IF($@fin@6='','要確認',IF($@fin@6=0,'不支給','未処理')))))))"
    f = Replace(f, "'", Chr(34))
    f = Replace(f, "@hr@", hr): f = Replace(f, "@he@", he): f = Replace(f, "@pm@", pm)
    f = Replace(f, "@fin@", fin): f = Replace(f, "@mr@", mr): f = Replace(f, "@bom@", bom)

    last = w.Cells(w.Rows.Count, st).End(xlUp).Row
    If last < 6 Then last = 3005
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    w.Range(st & "6:" & st & last).Formula = f
    ' --- 不支給連番（対象外も数える） ---
    sq = 列記号(w, "不支給連番")
    If sq <> "" Then
        g = "=IF(OR($@st@6='不支給',$@st@6='対象外'),COUNTIF($@st@$6:$@st@6,'不支給')+COUNTIF($@st@$6:$@st@6,'対象外'),'')"
        g = Replace(Replace(g, "'", Chr(34)), "@st@", st)
        w.Range(sq & "6:" & sq & last).Formula = g
    End If
    ' --- 不支給通知シートの状況（J列） ---
    On Error Resume Next
    Set nl = ThisWorkbook.Worksheets("不支給通知")
    On Error GoTo 0
    If Not nl Is Nothing Then
        h = "=IF($L7='','',IF(INDEX(請求記録!$@st@$6:$@st@$3005,$L7)='対象外','対象外',IF($G7='','理由未選択',IF($H7='','通知日未入力',IF($I7='','出力待ち','出力済')))))"
        h = Replace(Replace(h, "'", Chr(34)), "@st@", st)
        nl.Range("J7:J306").Formula = h
        has = False
        On Error Resume Next
        For Each fc In nl.Range("J7:J306").FormatConditions
            If InStr(fc.Formula1, "対象外") > 0 Then has = True
        Next fc
        If Not has Then
            Set fc = nl.Range("J7:J306").FormatConditions.Add(Type:=xlExpression, Formula1:="=$J7=" & Chr(34) & "対象外" & Chr(34))
            fc.Interior.Color = RGB(217, 217, 217)
        End If
        On Error GoTo 0
    End If
    Application.Calculation = xlCalculationAutomatic
    Application.Calculate
    Application.ScreenUpdating = True
    n = Application.WorksheetFunction.CountIf(w.Range(st & "6:" & st & last), "対象外")
    MsgBox "パッチを適用しました。" & vbLf & "ステータスが「対象外」の請求：" & n & " 件" & vbLf & vbLf & "※「不支給通知」の一覧には、状況「対象外」（灰色）で表示されます。", vbInformation
End Sub
