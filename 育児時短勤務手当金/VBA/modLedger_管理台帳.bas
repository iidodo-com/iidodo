Attribute VB_Name = "modLedger"
Option Explicit

' 電子申請書ファイル(複数選択可)の「共済組合提出データ」2行目を、請求記録の次の空行へ取り込む
Public Sub 申請書ファイルを取り込む()
    Dim fd As Variant, f As Variant, wbSrc As Workbook, ws As Worksheet
    Dim nxt As Long, dupe As Long, ok As Long, skip As Long, msg As String
    Set ws = ThisWorkbook.Worksheets("請求記録")
    fd = Application.GetOpenFilename("Excelファイル (*.xlsx;*.xlsm),*.xlsx;*.xlsm", , "電子申請書を選択（複数可）", , True)
    If Not IsArray(fd) Then Exit Sub
    Application.ScreenUpdating = False
    For Each f In fd
        Set wbSrc = Workbooks.Open(f, ReadOnly:=True, UpdateLinks:=0)
        On Error Resume Next
        Dim sh As Worksheet: Set sh = Nothing
        Set sh = wbSrc.Worksheets("共済組合提出データ")
        On Error GoTo 0
        If sh Is Nothing Then
            msg = msg & "×" & wbSrc.Name & "：様式が違います" & vbLf: skip = skip + 1
        ElseIf sh.Range("A2").Value = "" Then
            msg = msg & "×" & wbSrc.Name & "：データがありません" & vbLf: skip = skip + 1
        ElseIf Val(sh.Range("T2").Value) > 0 Then
            msg = msg & "×" & wbSrc.Name & "：申請書に入力エラーが残っています" & vbLf: skip = skip + 1
        Else
            dupe = Application.WorksheetFunction.CountIfs(ws.Range("B6:B3005"), sh.Range("A2").Value, ws.Range("C6:C3005"), sh.Range("B2").Value, ws.Range("D6:D3005"), sh.Range("C2").Value)
            If dupe > 0 Then
                msg = msg & "×" & wbSrc.Name & "：同じ職員・同じ月が登録済みです" & vbLf: skip = skip + 1
            Else
                nxt = ws.Cells(ws.Rows.Count, "B").End(xlUp).Row + 1
                If nxt < 6 Then nxt = 6
                ws.Cells(nxt, "B").Resize(1, 20).Value = sh.Range("A2").Resize(1, 20).Value
                ws.Cells(nxt, "A").Value = Date
                ok = ok + 1
            End If
        End If
        wbSrc.Close SaveChanges:=False
    Next f
    Application.ScreenUpdating = True
    MsgBox ok & " 件取り込みました。" & IIf(skip > 0, vbLf & vbLf & "取り込めなかったファイル：" & vbLf & msg, ""), vbInformation
End Sub
