Attribute VB_Name = "modLedger"
Option Explicit

Private regNew As Long, regStd As Long

' 電子申請書1ファイルを請求記録の次の空行へ取り込む。成功なら True
Private Function 取込1件(ByVal f As String, ByRef msg As String) As Boolean
    Dim wbSrc As Workbook, sh As Worksheet, ws As Worksheet, nxt As Long, dupe As Long
    Set ws = ThisWorkbook.Worksheets("請求記録")
    Set wbSrc = Workbooks.Open(f, ReadOnly:=True, UpdateLinks:=0)
    On Error Resume Next
    Set sh = wbSrc.Worksheets("共済組合提出データ")
    On Error GoTo 0
    If sh Is Nothing Then
        msg = msg & "×" & wbSrc.Name & "：様式が違います" & vbLf
    ElseIf sh.Range("A2").Value = "" Then
        msg = msg & "×" & wbSrc.Name & "：データがありません" & vbLf
    ElseIf Val(sh.Range("T2").Value) > 0 Then
        msg = msg & "×" & wbSrc.Name & "：申請書に入力エラーが残っています" & vbLf
    Else
        dupe = Application.WorksheetFunction.CountIfs(ws.Range("B6:B3005"), sh.Range("A2").Value, ws.Range("C6:C3005"), sh.Range("B2").Value, ws.Range("D6:D3005"), sh.Range("C2").Value)
        If dupe > 0 Then
            msg = msg & "×" & wbSrc.Name & "：同じ職員・同じ月が登録済みです" & vbLf
        Else
            nxt = ws.Cells(ws.Rows.Count, "B").End(xlUp).Row + 1
            If nxt < 6 Then nxt = 6
            ws.Cells(nxt, "B").Resize(1, 22).Value = sh.Range("A2").Resize(1, 22).Value
            ws.Cells(nxt, "A").Value = Date
            職員マスタへ登録 sh.Range("A2").Value, sh.Range("V2").Value
            取込1件 = True
        End If
    End If
    wbSrc.Close SaveChanges:=False
End Function

Private Function 登録結果() As String
    If regNew + regStd > 0 Then 登録結果 = vbLf & "職員マスタ：新規登録 " & regNew & " 人／標準報酬月額を登録 " & regStd & " 人"
End Function

' 職員マスタに無い職員は職員番号と標準報酬月額を登録し、標準報酬月額が空なら申請書の額を入れる
Private Sub 職員マスタへ登録(ByVal no As Variant, ByVal std As Variant)
    Dim wm As Worksheet, mr As Variant, nr As Long
    Set wm = ThisWorkbook.Worksheets("職員マスタ")
    mr = Application.Match(no, wm.Range("A6:A405"), 0)
    If IsError(mr) Then
        nr = wm.Cells(wm.Rows.Count, "A").End(xlUp).Row + 1
        If nr < 6 Then nr = 6
        If nr > 405 Then Exit Sub
        wm.Cells(nr, "A").Value = no
        If IsNumeric(std) And std <> "" Then wm.Cells(nr, "K").Value = std: regStd = regStd + 1
        regNew = regNew + 1
    ElseIf wm.Cells(5 + mr, "K").Value = "" And IsNumeric(std) And std <> "" Then
        wm.Cells(5 + mr, "K").Value = std
        regStd = regStd + 1
    End If
End Sub

' ファイルを選んで取り込む（複数選択可）
Public Sub 申請書ファイルを取り込む()
    Dim fd As Variant, f As Variant, ok As Long, ng As Long, msg As String
    regNew = 0: regStd = 0
    fd = Application.GetOpenFilename("Excelファイル (*.xlsx;*.xlsm),*.xlsx;*.xlsm", , "電子申請書を選択（複数可）", , True)
    If Not IsArray(fd) Then Exit Sub
    Application.ScreenUpdating = False
    For Each f In fd
        If 取込1件(CStr(f), msg) Then ok = ok + 1 Else ng = ng + 1
    Next f
    Application.ScreenUpdating = True
    MsgBox ok & " 件取り込みました。" & 登録結果() & IIf(ng > 0, vbLf & vbLf & "取り込めなかったファイル：" & vbLf & msg, ""), vbInformation
End Sub

' フォルダ内の申請書をまとめて取り込み、取り込んだファイルは「取込済」フォルダへ移す
'  （メールの添付ファイルを1つのフォルダに保存してから使う）
Public Sub 申請書フォルダを一括取り込む()
    Dim d As FileDialog, p As String, f As String, names As New Collection, v As Variant
    Dim ok As Long, ng As Long, msg As String, dest As String
    regNew = 0: regStd = 0
    Set d = Application.FileDialog(msoFileDialogFolderPicker)
    d.Title = "電子申請書を保存したフォルダを選択"
    If d.Show <> -1 Then Exit Sub
    p = d.SelectedItems(1) & "\"
    f = Dir(p & "*.xls*")
    Do While f <> ""
        If Left(f, 2) <> "~$" Then names.Add f
        f = Dir()
    Loop
    If names.Count = 0 Then MsgBox "フォルダにExcelファイルがありません。", vbExclamation: Exit Sub
    dest = p & "取込済\"
    Application.ScreenUpdating = False
    For Each v In names
        If 取込1件(p & v, msg) Then
            If Dir(dest, vbDirectory) = "" Then MkDir dest
            If Dir(dest & v) <> "" Then Kill dest & v
            Name p & v As dest & v
            ok = ok + 1
        Else
            ng = ng + 1
        End If
    Next v
    Application.ScreenUpdating = True
    MsgBox ok & " 件取り込みました（「取込済」フォルダへ移動）。" & 登録結果() & IIf(ng > 0, vbLf & vbLf & "取り込めなかったファイル（フォルダに残しています）：" & vbLf & msg, ""), vbInformation
End Sub

' 基幹システム入力が済んだ「未処理」の請求に、支給月をまとめて入力する
Public Sub 未処理に支給月を一括入力()
    Dim w As Worksheet, s As String, r As Long, n As Long
    Set w = ThisWorkbook.Worksheets("請求記録")
    s = Trim(InputBox("「未処理」の請求すべてに入れる支給月を入力してください。" & vbLf & "（例：R8.10）", "支給月の一括入力"))
    If s = "" Then Exit Sub
    If IsError(Application.Match(s, ThisWorkbook.Worksheets("設定").Range("H3:H74"), 0)) Then
        MsgBox "「" & s & "」は支給月の一覧にありません。R8.10 の形式で入力してください。", vbExclamation
        Exit Sub
    End If
    n = Application.WorksheetFunction.CountIf(w.Range("AF6:AF3005"), "未処理")
    If n = 0 Then MsgBox "未処理の請求はありません。", vbInformation: Exit Sub
    If MsgBox("未処理 " & n & " 件の支給月を " & s & " にします（ステータスは「支給済」になります）。よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    Application.ScreenUpdating = False
    For r = 6 To 3005
        If w.Cells(r, "AF").Value = "未処理" Then w.Cells(r, "AL").Value = s
    Next r
    Application.ScreenUpdating = True
    MsgBox n & " 件に支給月 " & s & " を入力しました。", vbInformation
End Sub

' ===== 不支給通知書 =====
' 請求記録：AF=ステータス AO=不支給理由 AQ=通知日 AR=通知書出力日 AS=適用する不支給理由

' 請求記録（または不支給通知）で選んだ行の通知書を表示する
Public Sub 選択行の通知書を表示()
    Dim r As Long, wn As Worksheet
    Set wn = ThisWorkbook.Worksheets("不支給通知書")
    Select Case ActiveSheet.Name
        Case "請求記録"
            r = ActiveCell.Row
        Case "不支給通知"
            If IsNumeric(ActiveSheet.Cells(ActiveCell.Row, "B").Value) And ActiveSheet.Cells(ActiveCell.Row, "B").Value <> "" Then r = ActiveSheet.Cells(ActiveCell.Row, "B").Value
        Case Else
            MsgBox "「請求記録」または「不支給通知」シートで、通知書を出したい行のセルを選んでから押してください。", vbExclamation
            Exit Sub
    End Select
    If r < 6 Then MsgBox "通知書を出したい行（請求）を選んでください。", vbExclamation: Exit Sub
    wn.Range("L2").Value = r
    Application.Calculate
    wn.Activate
    wn.Range("A1").Select
    If ThisWorkbook.Worksheets("請求記録").Cells(r, "AF").Value <> "不支給" Then
        MsgBox "この請求のステータスは「不支給」ではありません（" & ThisWorkbook.Worksheets("請求記録").Cells(r, "AF").Value & "）。", vbExclamation
    End If
End Sub

' 出力できる行（不支給・理由あり・通知日あり・未出力）を集める。不備の件数も数える
Private Function 出力対象(ByRef noReason As Long, ByRef noDate As Long) As Collection
    Dim w As Worksheet, r As Long, c As New Collection
    Set w = ThisWorkbook.Worksheets("請求記録")
    For r = 6 To 3005
        If w.Cells(r, "AF").Value = "不支給" And w.Cells(r, "AR").Value = "" Then
            If w.Cells(r, "AS").Value = "" Then
                noReason = noReason + 1
            ElseIf w.Cells(r, "AQ").Value = "" Then
                noDate = noDate + 1
            Else
                c.Add r
            End If
        End If
    Next r
    Set 出力対象 = c
End Function

Private Function 不備メッセージ(ByVal noReason As Long, ByVal noDate As Long) As String
    If noReason > 0 Then 不備メッセージ = vbLf & "・不支給の理由が未選択：" & noReason & " 件（請求記録の「不支給理由（区分）」）"
    If noDate > 0 Then 不備メッセージ = 不備メッセージ & vbLf & "・通知日が未入力：" & noDate & " 件（請求記録の「通知日（決裁完了日）」）"
End Function

' 未出力の通知書を1人1ファイルのPDFで保存する（このファイルと同じ場所の「不支給通知書_日付」フォルダ）
Public Sub 未出力の通知書を一括PDF出力()
    Dim noR As Long, noD As Long, items As Collection, v As Variant, wn As Worksheet, w As Worksheet
    Dim folder As String, fn As String, n As Long
    If ThisWorkbook.Path = "" Then MsgBox "先にこのファイルを保存してください。", vbExclamation: Exit Sub
    Set items = 出力対象(noR, noD)
    If items.Count = 0 Then MsgBox "出力する通知書がありません。" & 不備メッセージ(noR, noD), vbInformation: Exit Sub
    If MsgBox(items.Count & " 件の通知書をPDFで保存します。" & 不備メッセージ(noR, noD) & vbLf & vbLf & "よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    folder = ThisWorkbook.Path & "\不支給通知書_" & Format(Date, "yyyymmdd")
    If Dir(folder, vbDirectory) = "" Then MkDir folder
    Set wn = ThisWorkbook.Worksheets("不支給通知書")
    Set w = ThisWorkbook.Worksheets("請求記録")
    On Error GoTo Fail
    Application.ScreenUpdating = False
    For Each v In items
        wn.Range("L2").Value = v
        Application.Calculate
        fn = folder & "\不支給通知書_" & w.Cells(v, "B").Value & "_R" & w.Cells(v, "C").Value & "." & w.Cells(v, "D").Value & ".pdf"
        wn.ExportAsFixedFormat Type:=xlTypePDF, Filename:=fn, Quality:=xlQualityStandard, OpenAfterPublish:=False
        w.Cells(v, "AR").Value = Date
        n = n + 1
    Next v
    Application.ScreenUpdating = True
    Shell "explorer.exe """ & folder & """", vbNormalFocus
    MsgBox n & " 件のPDFを保存しました。" & vbLf & folder, vbInformation
    Exit Sub
Fail:
    Application.ScreenUpdating = True
    MsgBox "PDFの保存に失敗しました（" & n & " 件まで保存済み）。" & vbLf & Err.Description, vbExclamation
End Sub

' 未出力の通知書をまとめて印刷する
Public Sub 未出力の通知書を一括印刷()
    Dim noR As Long, noD As Long, items As Collection, v As Variant, wn As Worksheet, w As Worksheet, n As Long
    Set items = 出力対象(noR, noD)
    If items.Count = 0 Then MsgBox "出力する通知書がありません。" & 不備メッセージ(noR, noD), vbInformation: Exit Sub
    If MsgBox(items.Count & " 件の通知書を印刷します。" & 不備メッセージ(noR, noD) & vbLf & vbLf & "よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    Set wn = ThisWorkbook.Worksheets("不支給通知書")
    Set w = ThisWorkbook.Worksheets("請求記録")
    For Each v In items
        wn.Range("L2").Value = v
        Application.Calculate
        wn.PrintOut Copies:=1
        w.Cells(v, "AR").Value = Date
        n = n + 1
    Next v
    MsgBox n & " 件の通知書を印刷しました。", vbInformation
End Sub

' ===== 不支給通知書（Word） =====
' 「不支給通知書テンプレート.docx」（台帳と同じフォルダ）の {通知日} などを差し込み、1つのWord文書にまとめる（1通＝1ページ）

Private Sub Word差し込み(ByVal rows As Collection)
    Dim wd As Object, out As Object, tmp As Object, tpl As String, outPath As String, v As Variant
    Dim wn As Worksheet, w As Worksheet, i As Long, rg As Object, n As Long, k As Long
    Set wn = ThisWorkbook.Worksheets("不支給通知書")
    Set w = ThisWorkbook.Worksheets("請求記録")
    tpl = ThisWorkbook.Path & "\不支給通知書テンプレート.docx"
    If Dir(tpl) = "" Then
        Dim f As Variant
        f = Application.GetOpenFilename("Word文書 (*.docx),*.docx", , "不支給通知書テンプレートを選択")
        If VarType(f) = vbBoolean Then Exit Sub
        tpl = CStr(f)
    End If
    If ThisWorkbook.Path = "" Then MsgBox "先にこのファイルを保存してください。", vbExclamation: Exit Sub
    outPath = ThisWorkbook.Path & "\不支給通知書_" & Format(Date, "yyyymmdd") & ".docx"
    k = 1
    Do While Dir(outPath) <> ""
        k = k + 1
        outPath = ThisWorkbook.Path & "\不支給通知書_" & Format(Date, "yyyymmdd") & "_" & k & ".docx"
    Loop
    On Error GoTo NoWord
    Set wd = CreateObject("Word.Application")
    On Error GoTo Fail
    wd.Visible = True
    For Each v In rows
        wn.Range("L2").Value = v
        Application.Calculate
        Set tmp = wd.Documents.Open(tpl, ReadOnly:=True)
        For i = 2 To 15
            置換 tmp, CStr(wn.Cells(i, "N").Value), CStr(wn.Cells(i, "O").Value)
        Next i
        If out Is Nothing Then
            Set out = tmp
            out.SaveAs2 outPath
        Else
            Set rg = out.Content
            rg.Collapse 0
            rg.InsertBreak 7
            Set rg = out.Content
            rg.Collapse 0
            rg.FormattedText = tmp.Content.FormattedText
            tmp.Close False
        End If
        w.Cells(v, "AR").Value = Date
        n = n + 1
    Next v
    out.Save
    out.Activate
    MsgBox n & " 件の通知書をWord文書にまとめました。" & vbLf & outPath & vbLf & "内容を確認して、印刷してください。", vbInformation
    Exit Sub
NoWord:
    MsgBox "Wordを起動できませんでした。", vbExclamation
    Exit Sub
Fail:
    MsgBox "Wordへの差し込みに失敗しました（" & n & " 件まで処理済み）。" & vbLf & Err.Description, vbExclamation
End Sub

Private Sub 置換(ByVal doc As Object, ByVal tok As String, ByVal val As String)
    If tok = "" Then Exit Sub
    If Len(val) > 250 Then val = Left(val, 250)
    With doc.Content.Find
        .ClearFormatting
        .Replacement.ClearFormatting
        .Text = tok
        .Replacement.Text = val
        .Forward = True
        .Wrap = 0
        .MatchWildcards = False
        .Execute Replace:=2
    End With
End Sub

' 未出力の通知書をWordにまとめる
Public Sub 未出力の通知書をWordで作成()
    Dim noR As Long, noD As Long, items As Collection
    Set items = 出力対象(noR, noD)
    If items.Count = 0 Then MsgBox "出力する通知書がありません。" & 不備メッセージ(noR, noD), vbInformation: Exit Sub
    If MsgBox(items.Count & " 件の通知書をWordで作成します。" & 不備メッセージ(noR, noD) & vbLf & vbLf & "よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    Word差し込み items
End Sub

' 選んだ行の通知書だけをWordで作成する（出力済みでも可）
Public Sub 選択行の通知書をWordで作成()
    Dim r As Long, c As New Collection
    Select Case ActiveSheet.Name
        Case "請求記録"
            r = ActiveCell.Row
        Case "不支給通知"
            If IsNumeric(ActiveSheet.Cells(ActiveCell.Row, "B").Value) And ActiveSheet.Cells(ActiveCell.Row, "B").Value <> "" Then r = ActiveSheet.Cells(ActiveCell.Row, "B").Value
        Case Else
            MsgBox "「請求記録」または「不支給通知」シートで、通知書を出したい行を選んでから押してください。", vbExclamation
            Exit Sub
    End Select
    If r < 6 Then MsgBox "通知書を出したい行（請求）を選んでください。", vbExclamation: Exit Sub
    If ThisWorkbook.Worksheets("請求記録").Cells(r, "AF").Value <> "不支給" Then MsgBox "この請求は「不支給」ではありません。", vbExclamation: Exit Sub
    c.Add r
    Word差し込み c
End Sub

' ===== 旧い管理台帳の入力内容を引き継ぐ =====
Public Sub 旧台帳から引き継ぐ()
    Dim f As Variant, wo As Workbook, so As Worksheet, sn As Worksheet, j As Long, k As Variant, r As Long, c As Variant, h As Variant
    f = Application.GetOpenFilename("Excelファイル (*.xlsx;*.xlsm),*.xlsx;*.xlsm", , "引き継ぐ元（旧い管理台帳）を選択")
    If VarType(f) = vbBoolean Then Exit Sub
    If MsgBox("選んだ台帳の入力内容（請求記録・職員マスタ・人給データ・設定）で、このファイルの入力内容を置き換えます。" & vbLf & "よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fail
    Set wo = Workbooks.Open(f, ReadOnly:=True, UpdateLinks:=0)
    ' 請求記録：見出し名で対応づけ（先頭23列は申請書データ）
    Set so = wo.Worksheets("請求記録"): Set sn = ThisWorkbook.Worksheets("請求記録")
    h = Array("決定額（手修正）", "保留理由", "保留開始日", "保留解消日", "次回確認予定日", "支給月", "備考", "不支給理由（区分）", "理由の個別記載", "通知日（決裁完了日）", "通知書出力日")
    For j = 1 To 23
        k = Application.Match(sn.Cells(5, j).Value, so.Rows(5), 0)
        If Not IsError(k) Then sn.Range(sn.Cells(6, j), sn.Cells(3005, j)).Value = so.Range(so.Cells(6, k), so.Cells(3005, k)).Value
    Next j
    For Each c In h
        j = Application.Match(c, sn.Rows(5), 0)
        k = Application.Match(c, so.Rows(5), 0)
        If Not IsError(k) Then sn.Range(sn.Cells(6, j), sn.Cells(3005, j)).Value = so.Range(so.Cells(6, k), so.Cells(3005, k)).Value
    Next c
    ' 職員マスタ：数式でないセルだけ引き継ぐ
    Set so = wo.Worksheets("職員マスタ"): Set sn = ThisWorkbook.Worksheets("職員マスタ")
    For r = 6 To 405
        For c = 1 To 15
            If Not so.Cells(r, c).HasFormula Then sn.Cells(r, c).Value = so.Cells(r, c).Value
        Next c
    Next r
    ' 人給データ・設定
    ThisWorkbook.Worksheets("人給データ").Range("A2:AB700").Value = wo.Worksheets("人給データ").Range("A2:AB700").Value
    ThisWorkbook.Worksheets("設定").Range("C3:C7").Value = wo.Worksheets("設定").Range("C3:C7").Value
    ThisWorkbook.Worksheets("設定").Range("F3:F14").Value = wo.Worksheets("設定").Range("F3:F14").Value
    wo.Close SaveChanges:=False
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "引き継ぎが完了しました。内容を確認して、保存してください。", vbInformation
    Exit Sub
Fail:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    MsgBox "引き継ぎに失敗しました。" & vbLf & Err.Description, vbExclamation
End Sub
