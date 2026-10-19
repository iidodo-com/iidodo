Attribute VB_Name = "modWord"
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

Private Sub MakeWordDoc(ByVal kind As String, ByVal tmplName As String)
    Dim wsData As Worksheet
    Dim tmplPath As String, outPath As String
    Dim wdApp As Object, wdDoc As Object
    Dim r As Long, lastRow As Long
    Dim miss As String, ngCount As Long
    Dim ans As Long

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

    ' --- 差し込み ---
    lastRow = wsData.Cells(wsData.Rows.Count, 1).End(-4162).Row   ' xlUp
    For r = 5 To lastRow
        If CStr(wsData.Cells(r, 1).Value) = kind Then
            ReplaceToken wdDoc, CStr(wsData.Cells(r, 2).Value), CStr(wsData.Cells(r, 3).Value)
        End If
    Next r

    ' --- 保存して表示 ---
    outPath = OutputFolder() & kind & "_" & SafeName(CStr(ThisWorkbook.Names("dat_name").RefersToRange.Value)) & _
              "_" & Format(Now, "yyyymmdd_hhnnss") & ".docx"
    wdDoc.SaveAs2 FileName:=outPath, FileFormat:=12
    wdApp.Visible = True
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
