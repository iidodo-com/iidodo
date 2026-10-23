Attribute VB_Name = "modForm"
Option Explicit

Private Const MAIL_TO As String = "fukuri@city.hiroshima.lg.jp"

Public Function ErrorCount() As Long
    ErrorCount = Application.WorksheetFunction.CountIf(Worksheets("入力").Range("K6:K57"), ChrW(10005) & "*")
End Function

Public Function ErrorList() As String
    Dim r As Long, s As String, n As Long
    With Worksheets("入力")
        For r = 6 To 57
            If Left(.Cells(r, "K").Value, 1) = ChrW(10005) Then
                n = n + 1
                If n <= 12 Then s = s & "・" & .Cells(r, "B").Value & "：" & Mid(.Cells(r, "K").Value, 3) & vbLf
            End If
        Next r
    End With
    If n > 12 Then s = s & "…ほか " & (n - 12) & " 件" & vbLf
    ErrorList = "「入力」シートの赤い項目を直してください（" & n & "件）" & vbLf & vbLf & s
End Function

' 入力チェック後、表・裏をまとめて印刷
Public Sub 請求書を印刷()
    If ErrorCount() > 0 Then
        MsgBox ErrorList(), vbExclamation, "入力エラー"
        Exit Sub
    End If
    Worksheets("請求書(表)").PrintOut
    Worksheets("請求書(裏)").PrintOut
End Sub

' 請求日に今日の日付を入れる
Public Sub 請求日を今日にする()
    With Worksheets("入力")
        .Range("D37").Value = Year(Date) - 2018
        .Range("F37").Value = Month(Date)
        .Range("H37").Value = Day(Date)
    End With
End Sub

' 翌月分を作るために月ごとに変わる項目だけを消す
Public Sub 翌月分用にクリア()
    If MsgBox("対象月・給与明細の金額・請求日・添付書類チェックを消します（通勤手当の複数月分の入力は残します）。よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    Dim a As Variant
    With Worksheets("入力")
        .Unprotect
        For Each a In Array("D7", "F7", "D37", "F37", "H37", "C43:D43", "C44:D44", "C45:D45", "C46:D46", "C47:D47", "C48:D48", "C49:D49", "C50:D50", "C51:D51", "C52:D52")
            .Range(a).ClearContents
        Next a
        .Protect
        .Activate
        .Range("D7").Select
    End With
    Worksheets("給与明細").Range("B15:I15,B17:I17,B19:I19,B23:I23,B25:I25,B29:I29,C9:D9,C49").ClearContents
End Sub

' 共済組合(fukuri@city.hiroshima.lg.jp)宛のメール下書きを作る
'  添付：請求書データ(マクロなしxlsx) と 請求書PDF(表・裏)。内容を確認して［送信］を押す
Public Sub 共済組合へメール送信()
    Dim ws As Worksheet, tmp As String, base As String, fx As String, fp As String
    Dim nb As Workbook, i As Long, c As Range, ol As Object, mi As Object, body As String
    Set ws = Worksheets("入力")
    If ErrorCount() > 0 Then
        MsgBox ErrorList(), vbExclamation, "入力エラーがあるため送信できません"
        Exit Sub
    End If
    tmp = Environ("TEMP") & "\育短請求\"
    If Dir(tmp, vbDirectory) = "" Then MkDir tmp
    base = "育短請求_" & ws.Range("C6").Value & "_R" & ws.Range("D7").Value & "." & ws.Range("F7").Value
    fx = tmp & base & ".xlsx"
    fp = tmp & base & ".pdf"
    If Dir(fx) <> "" Then Kill fx
    If Dir(fp) <> "" Then Kill fp

    On Error GoTo Fail
    Application.ScreenUpdating = False
    Application.EnableEvents = False
    Worksheets(Array("請求書(表)", "請求書(裏)")).Select
    ActiveSheet.ExportAsFixedFormat Type:=xlTypePDF, Filename:=fp, Quality:=xlQualityStandard
    ws.Select Replace:=True

    ThisWorkbook.Worksheets.Copy
    Set nb = ActiveWorkbook
    With nb.Worksheets("入力")
        .Unprotect
        For i = .Shapes.Count To 1 Step -1
            .Shapes(i).Delete
        Next i
        For Each c In .Range("C28,C30:C35,N35,K6:K57")
            c.Value = c.Value
        Next c
        .Protect
    End With
    Application.DisplayAlerts = False
    nb.Worksheets("給与明細").Delete
    nb.SaveAs Filename:=fx, FileFormat:=xlOpenXMLWorkbook
    nb.Close SaveChanges:=False
    Application.DisplayAlerts = True
    Application.ScreenUpdating = True
    ThisWorkbook.Activate
    ws.Select Replace:=True
    Application.EnableEvents = True

    body = "広島市職員共済組合　御中" & vbCrLf & vbCrLf & _
           "育児時短勤務手当金の請求書を送付します。" & vbCrLf & vbCrLf & _
           "・対象月：令和" & ws.Range("D7").Value & "年" & ws.Range("F7").Value & "月分" & vbCrLf & _
           "・職員番号：" & ws.Range("C6").Value & vbCrLf & _
           "・氏名：" & ws.Range("C11").Value & vbCrLf & _
           "・所属：" & ws.Range("C15").Value & vbCrLf & _
           "・勤務区分：" & ws.Range("C18").Value & vbCrLf & _
           "・請求者連絡先：" & ws.Range("C39").Value & vbCrLf & _
           "・庶務担当：" & ws.Range("C40").Value & "（" & ws.Range("C41").Value & "）" & vbCrLf & vbCrLf & _
           "添付：請求書データ（Excel）、請求書（PDF）" & vbCrLf & _
           "※承認書・出勤簿・支給明細書等の写しは、このメールに添付するか、庶務担当を通じて提出します。" & vbCrLf

    On Error GoTo NoOutlook
    Set ol = CreateObject("Outlook.Application")
    Set mi = ol.CreateItem(0)
    With mi
        .To = MAIL_TO
        .Subject = "【育児時短勤務手当金請求】令和" & ws.Range("D7").Value & "年" & ws.Range("F7").Value & "月分　" & ws.Range("C11").Value & "（" & ws.Range("C6").Value & "）"
        .Body = body
        .Attachments.Add fx
        .Attachments.Add fp
        .Display
    End With
    MsgBox "メールの下書きを作成しました（宛先：" & MAIL_TO & "）。" & vbLf & "承認書・出勤簿・支給明細書などの写しを追加し、内容を確認してから［送信］を押してください。", vbInformation
    Exit Sub

NoOutlook:
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.DisplayAlerts = True
    Shell "explorer.exe """ & Left(tmp, Len(tmp) - 1) & """", vbNormalFocus
    MsgBox "Outlookを起動できませんでした。" & vbLf & "開いたフォルダの2ファイル（Excel・PDF）を、" & MAIL_TO & " 宛のメールに添付して送信してください。", vbExclamation
    Exit Sub

Fail:
    Application.EnableEvents = True
    Application.ScreenUpdating = True
    Application.DisplayAlerts = True
    On Error Resume Next
    ThisWorkbook.Activate
    ws.Select Replace:=True
    MsgBox "メール用ファイルの作成に失敗しました。" & vbLf & Err.Description, vbExclamation
End Sub
