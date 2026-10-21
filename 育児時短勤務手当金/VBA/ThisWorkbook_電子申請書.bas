Attribute VB_Name = "ThisWorkbook_BeforePrint"
' 【使い方】VBEで「ThisWorkbook」を開き、下のコードを貼り付ける（modForm.basは標準モジュールにインポート）
' 請求書シートの印刷時に入力エラーがあれば、印刷を止めて内容を表示します。
Private Sub Workbook_BeforePrint(Cancel As Boolean)
    If ActiveSheet.Name Like "請求書*" Then
        If ErrorCount() > 0 Then
            MsgBox ErrorList(), vbExclamation, "入力エラーがあるため印刷できません"
            Cancel = True
        End If
    End If
End Sub
