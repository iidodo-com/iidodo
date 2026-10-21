Attribute VB_Name = "modForm"
Option Explicit

Public Function ErrorCount() As Long
    ErrorCount = Application.WorksheetFunction.CountIf(Worksheets("入力").Range("K6:K52"), ChrW(10005) & "*")
End Function

Public Function ErrorList() As String
    Dim r As Long, s As String, n As Long
    With Worksheets("入力")
        For r = 6 To 52
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

' 翌月分を作るために月ごとに変わる項目だけを消す
Public Sub 翌月分用にクリア()
    If MsgBox("対象月・報酬額・通勤手当（月額）・請求日・添付書類チェックを消します。よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    Dim a As Variant
    With Worksheets("入力")
        .Unprotect
        For Each a In Array("D7", "F7", "C28:H28", "C30:H30", "C32:H32", "C33:D33", "C34:D34", "D37", "F37", "H37", "C43:D43", "C44:D44", "C45:D45", "C46:D46", "C47:D47", "C48:D48", "C49:D49", "C50:D50", "C51:D51", "C52:D52")
            .Range(a).ClearContents
        Next a
        .Protect
        .Activate
        .Range("D7").Select
    End With
End Sub
