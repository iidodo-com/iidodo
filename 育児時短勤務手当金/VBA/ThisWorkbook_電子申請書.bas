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

' 複数シートを選択（グループ化）したまま入力すると、他のシートにも同じ値が書き込まれてしまうため、常に1シートに戻す
Private Sub Workbook_SheetSelectionChange(ByVal Sh As Object, ByVal Target As Range)
    If ActiveWindow.SelectedSheets.Count > 1 Then
        Application.EnableEvents = False
        Sh.Select
        Application.EnableEvents = True
    End If
End Sub

Private Sub Workbook_Open()
    Worksheets("入力").Select
End Sub
