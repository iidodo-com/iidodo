Attribute VB_Name = "modLedger"
Option Explicit

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
            ws.Cells(nxt, "B").Resize(1, 20).Value = sh.Range("A2").Resize(1, 20).Value
            ws.Cells(nxt, "A").Value = Date
            取込1件 = True
        End If
    End If
    wbSrc.Close SaveChanges:=False
End Function

' ファイルを選んで取り込む（複数選択可）
Public Sub 申請書ファイルを取り込む()
    Dim fd As Variant, f As Variant, ok As Long, ng As Long, msg As String
    fd = Application.GetOpenFilename("Excelファイル (*.xlsx;*.xlsm),*.xlsx;*.xlsm", , "電子申請書を選択（複数可）", , True)
    If Not IsArray(fd) Then Exit Sub
    Application.ScreenUpdating = False
    For Each f In fd
        If 取込1件(CStr(f), msg) Then ok = ok + 1 Else ng = ng + 1
    Next f
    Application.ScreenUpdating = True
    MsgBox ok & " 件取り込みました。" & IIf(ng > 0, vbLf & vbLf & "取り込めなかったファイル：" & vbLf & msg, ""), vbInformation
End Sub

' フォルダ内の申請書をまとめて取り込み、取り込んだファイルは「取込済」フォルダへ移す
'  （メールの添付ファイルを1つのフォルダに保存してから使う）
Public Sub 申請書フォルダを一括取り込む()
    Dim d As FileDialog, p As String, f As String, names As New Collection, v As Variant
    Dim ok As Long, ng As Long, msg As String, dest As String
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
    MsgBox ok & " 件取り込みました（「取込済」フォルダへ移動）。" & IIf(ng > 0, vbLf & vbLf & "取り込めなかったファイル（フォルダに残しています）：" & vbLf & msg, ""), vbInformation
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
    n = Application.WorksheetFunction.CountIf(w.Range("AD6:AD3005"), "未処理")
    If n = 0 Then MsgBox "未処理の請求はありません。", vbInformation: Exit Sub
    If MsgBox("未処理 " & n & " 件の支給月を " & s & " にします（ステータスは「支給済」になります）。よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    Application.ScreenUpdating = False
    For r = 6 To 3005
        If w.Cells(r, "AD").Value = "未処理" Then w.Cells(r, "AJ").Value = s
    Next r
    Application.ScreenUpdating = True
    MsgBox n & " 件に支給月 " & s & " を入力しました。", vbInformation
End Sub
