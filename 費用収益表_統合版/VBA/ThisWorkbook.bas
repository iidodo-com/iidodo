Attribute VB_Name = "ThisWorkbook"
Option Explicit

Private Sub Workbook_Open()
    Call EnableEnterKey
End Sub

Private Sub Workbook_Activate()
    Call EnableEnterKey
End Sub

Private Sub Workbook_Deactivate()
    Call DisableEnterKey
End Sub

Private Sub Workbook_BeforeClose(Cancel As Boolean)
    Call DisableEnterKey
End Sub

Private Sub Workbook_SheetChange(ByVal Sh As Object, ByVal Target As Range)
    Call OnInputCellChanged(Target)
End Sub
