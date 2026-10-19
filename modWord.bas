Option Explicit

' 借用証書・添書のWord出力
'   「Word差込データ」シートの値を、Wordテンプレート内の {{項目}} に差し込みます。
'   テンプレートは、このブックと同じフォルダーに置きます。

Private Const SHEET_DATA As String = "Word差込データ"

Public Sub Make_Shakuyo()
    MakeWordDoc "借用証書", "借用証書テンプレート.docx"
End Sub

Public Sub Make_Soesho()
    MakeWordDoc "添書", "添書テンプレート.docx"
End Sub

Public Sub Make_Moushikomi()
    MakeWordDoc "貸付申込書", "貸付申込書テンプレート.docx"
End Sub

Private Sub MakeWordDoc(ByVal kind As String, ByVal tmplName As String)
    Dim wsData As Worksheet
    Dim tmplPath As String, outPath As String
    Dim wdApp As Object, wdDoc As Object
    Dim r As Long, lastRow As Long
    Dim miss As String, ngCount As Long
    Dim ans As Long
    Dim grp As String
    Dim marks As Collection
    Dim m As Variant
    Dim tok As String, val As String, n As Long

    On Error GoTo EH

    Set wsData = ThisWorkbook.Worksheets(SHEET_DATA)

    ' --- 入力チェック(不足があれば中止) ---
    miss = CStr(ThisWorkbook.Names("chk_missing").RefersToRange.Value)
    If Len(miss) > 0 Then
        MsgBox "入力が不足しているため、" & kind & "を出力できません。" & vbCrLf & vbCrLf & _
               "不足している項目:" & miss & vbCrLf & vbCrLf & _
               "「申込シミュレーション」の黄色のセルに入力してから、もう一度ボタンを押してください。", _
               vbExclamation, "Word出力"
        Exit Sub
    End If
    If kind = "借用証書" Then
        If Val(CStr(ThisWorkbook.Names("dat_amt").RefersToRange.Value)) <= 0 Then
            MsgBox "借用証書に記入する金額が0円です。" & vbCrLf & vbCrLf & _
                   "「申込シミュレーション」で申込希望金額を入力するか、申込可能額が出る状態にしてください。", _
                   vbExclamation, "Word出力"
            Exit Sub
        End If
    End If

    If kind = "貸付申込書" Then
        grp = CStr(ThisWorkbook.Names("dat_group").RefersToRange.Value)
        If grp <> "普通貸付" And grp <> "特別貸付" Then
            MsgBox "この貸付申込書は、普通貸付・特別貸付用の様式です。" & vbCrLf & vbCrLf & _
                   "現在の貸付区分は「" & grp & "」のため出力できません。" & vbCrLf & _
                   "住宅貸付・災害貸付は、共済組合の所定の申込書をお使いください。", _
                   vbExclamation, "Word出力"
            Exit Sub
        End If
    End If

    ' --- ×の項目があるときは確認 ---
    ngCount = CLng(Val(CStr(ThisWorkbook.Names("chk_ng").RefersToRange.Value)))
    If ngCount > 0 Then
        ans = MsgBox("申込内容に「×」の項目が" & ngCount & "件あります。" & vbCrLf & vbCrLf & _
                     "このまま" & kind & "を出力しますか？" & vbCrLf & _
                     "(「いいえ」を選ぶと中止します。「申込シミュレーション」の判定の内訳で確認できます)", _
                     vbYesNo + vbExclamation + vbDefaultButton2, "Word出力")
        If ans <> vbYes Then Exit Sub
    End If

    ' --- テンプレートの場所 ---
    tmplPath = FindTemplate(tmplName)
    If Len(tmplPath) = 0 Then Exit Sub

    ' --- Wordを起動 ---
    Application.StatusBar = "Wordで" & kind & "を作成しています..."
    On Error Resume Next
    Set wdApp = GetObject(, "Word.Application")
    If wdApp Is Nothing Then Set wdApp = CreateObject("Word.Application")
    On Error GoTo EH
    If wdApp Is Nothing Then
        Application.StatusBar = False
        MsgBox "Wordを起動できませんでした。" & vbCrLf & _
               "Wordがインストールされているパソコンで実行してください。", vbCritical, "Word出力"
        Exit Sub
    End If

    ' --- テンプレートから新しい文書を作成(テンプレート自体は変更しません) ---
    Set wdDoc = wdApp.Documents.Add(Template:=tmplPath, NewTemplate:=False, DocumentType:=0)
    wdApp.Visible = True
    On Error Resume Next
    wdApp.ActiveWindow.View.Type = 3    ' 印刷レイアウト(○で囲む位置の計算に必要)
    On Error GoTo EH

    ' --- 差し込み ---
    lastRow = wsData.Cells(wsData.Rows.Count, 1).End(-4162).Row   ' xlUp
    Set marks = New Collection
    For r = 5 To lastRow
        If CStr(wsData.Cells(r, 1).Value) = kind Then
            tok = CStr(wsData.Cells(r, 2).Value)
            val = CStr(wsData.Cells(r, 3).Value)
            n = CircleLen(tok)
            If n > 0 Then
                PrepareCircle wdDoc, tok, (val = ChrW(&H25CB)), n, marks    ' ○ で囲む項目
            Else
                ReplaceToken wdDoc, tok, val
            End If
        End If
    Next r
    ' 文字をすべて差し込んだ後に、該当する項目を○で囲む
    For Each m In marks
        If m(2) Then DrawCircle wdDoc, m(0), CLng(m(1))
    Next m

    ' --- 保存して表示 ---
    outPath = OutputFolder() & kind & "_" & SafeName(CStr(ThisWorkbook.Names("dat_name").RefersToRange.Value)) & _
              "_" & Format(Now, "yyyymmdd_hhnnss") & ".docx"
    wdDoc.SaveAs2 FileName:=outPath, FileFormat:=12
    wdApp.Activate
    Application.StatusBar = False

    MsgBox kind & "をWordに出力しました。" & vbCrLf & vbCrLf & outPath & vbCrLf & vbCrLf & _
           "内容を確認して、印刷してください。", vbInformation, "Word出力"
    Exit Sub

EH:
    Application.StatusBar = False
    MsgBox kind & "の出力でエラーが発生しました。" & vbCrLf & vbCrLf & _
           "エラー番号:" & Err.Number & vbCrLf & Err.Description & vbCrLf & vbCrLf & _
           "・Wordで同じ名前の文書が開いたままになっていないか" & vbCrLf & _
           "・保存先フォルダーに書き込めるか" & vbCrLf & "を確認してください。", vbCritical, "Word出力"
    On Error Resume Next
    If Not wdDoc Is Nothing Then wdDoc.Close False
End Sub

' ○で囲む項目の、項目名から囲む文字数を返す(0=囲む項目ではない)
Private Function CircleLen(ByVal tok As String) As Long
    Select Case tok
        Case "{{事由自動車}}"
            CircleLen = 9
        Case "{{事由出産}}", "{{事由医療}}", "{{事由入学}}", "{{事由結婚}}", "{{事由葬祭}}", "{{事由修学}}"
            CircleLen = 2
        Case "{{現在なし}}", "{{同時なし}}"
            CircleLen = 3
        Case "{{現在住宅}}", "{{現在特別}}", "{{現在普通}}", "{{現在災害}}", _
             "{{同時住宅}}", "{{同時特別}}", "{{同時普通}}", "{{同時災害}}"
            CircleLen = 4
        Case Else
            CircleLen = 0
    End Select
End Function

' 項目名の文字を消して、その位置を覚えておく(あとで○を描く)
Private Sub PrepareCircle(ByVal doc As Object, ByVal tok As String, ByVal doIt As Boolean, _
                          ByVal n As Long, ByVal marks As Collection)
    Dim rng As Object
    Set rng = doc.Content
    With rng.Find
        .ClearFormatting
        .Text = tok
        .Forward = True
        .Wrap = 0
        .Format = False
        .MatchCase = True
        .MatchWildcards = False
    End With
    If rng.Find.Execute Then
        rng.Text = ""
        marks.Add Array(rng, n, doIt)
    End If
End Sub

' 項目名の直後にある n 文字を、楕円(○)で囲む。失敗したときは文字の「○」を前に付ける
Private Sub DrawCircle(ByVal doc As Object, ByVal rng As Object, ByVal n As Long)
    Dim st As Long
    Dim r1 As Object, r2 As Object, shp As Object
    Dim x1 As Single, x2 As Single, y1 As Single, fs As Single

    On Error GoTo Fallback
    st = rng.Start
    Set r1 = doc.Range(st, st + n)
    Set r2 = doc.Range(st + n, st + n)
    x1 = r1.Information(5)      ' wdHorizontalPositionRelativeToPage
    y1 = r1.Information(6)      ' wdVerticalPositionRelativeToPage
    x2 = r2.Information(5)
    fs = r1.Font.Size
    If fs <= 0 Or fs > 50 Then fs = 9
    If x2 <= x1 Then x2 = x1 + fs * n

    Set shp = doc.Shapes.AddShape(9, x1 - 3, y1 - 2, x2 - x1 + 6, fs + 5, r1)    ' 9 = 楕円
    shp.Fill.Visible = 0
    shp.Line.ForeColor.RGB = 0
    shp.Line.Weight = 0.75
    shp.WrapFormat.Type = 3             ' 文字の前面
    shp.RelativeHorizontalPosition = 1  ' ページ基準
    shp.RelativeVerticalPosition = 1
    shp.Left = x1 - 3
    shp.Top = y1 - 2
    Exit Sub

Fallback:
    If shp Is Nothing Then
        On Error Resume Next
        rng.InsertAfter ChrW(&H25CB)
    End If
End Sub

' テンプレート内の項目(例 {{金額千}})を値に置き換える(複数行の値にも対応)
Private Sub ReplaceToken(ByVal doc As Object, ByVal tok As String, ByVal val As String)
    Dim rng As Object
    Dim guard As Long
    If Len(tok) = 0 Then Exit Sub
    val = Replace(val, vbCrLf, vbCr)
    val = Replace(val, vbLf, vbCr)
    Do
        Set rng = doc.Content
        With rng.Find
            .ClearFormatting
            .Text = tok
            .Forward = True
            .Wrap = 0
            .Format = False
            .MatchCase = True
            .MatchWildcards = False
        End With
        If Not rng.Find.Execute Then Exit Do
        rng.Text = val
        guard = guard + 1
        If guard > 100 Then Exit Do
    Loop
End Sub

' テンプレートを探す(見つからなければ選択してもらう)
Private Function FindTemplate(ByVal tmplName As String) As String
    Dim p As String
    p = ThisWorkbook.Path & Application.PathSeparator & tmplName
    On Error Resume Next
    If Len(Dir(p)) > 0 Then
        FindTemplate = p
        Exit Function
    End If
    On Error GoTo 0

    MsgBox "「" & tmplName & "」が見つかりません。" & vbCrLf & vbCrLf & _
           "このブックと同じフォルダーにテンプレートを置くと、次回から自動で読み込みます。" & vbCrLf & _
           "今回は、テンプレートのファイルを選んでください。", vbExclamation, "Word出力"
    With Application.FileDialog(3)    ' msoFileDialogFilePicker
        .Title = tmplName & " を選んでください"
        .AllowMultiSelect = False
        .Filters.Clear
        .Filters.Add "Word文書", "*.docx;*.dotx"
        If .Show = -1 Then FindTemplate = .SelectedItems(1)
    End With
End Function

' 保存先(クラウド上のブックのときは「ドキュメント」フォルダー)
Private Function OutputFolder() As String
    Dim p As String
    p = ThisWorkbook.Path
    If Len(p) = 0 Or Left(LCase(p), 4) = "http" Then
        p = Environ("USERPROFILE") & "\Documents"
    End If
    If Right(p, 1) <> "\" And Right(p, 1) <> "/" Then p = p & Application.PathSeparator
    OutputFolder = p
End Function

' ファイル名に使えない文字を取り除く
Private Function SafeName(ByVal s As String) As String
    Dim ch As Variant
    s = Trim(s)
    If Len(s) = 0 Then s = "無名"
    For Each ch In Array("\", "/", ":", "*", "?", """", "<", ">", "|", " ", "　")
        s = Replace(s, ch, "")
    Next ch
    SafeName = s
End Function
