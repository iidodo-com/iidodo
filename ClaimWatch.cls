VERSION 1.0 CLASS
BEGIN
  MultiUse = -1  'True
END
Attribute VB_Name = "ClaimWatch"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = False
Attribute VB_Exposed = False
Option Explicit

' 「請求シート雛形」の請求期間が入力されたことを見つけて、modClaim の処理を呼ぶ

Private WithEvents xlApp As Application

Public Sub Start()
    Set xlApp = Application
End Sub

Private Sub xlApp_SheetChange(ByVal Sh As Object, ByVal Target As Range)
    If Sh.Parent.Name <> ThisWorkbook.Name Then Exit Sub
    If Sh.Name <> TPL_SHEET Then Exit Sub
    If Intersect(Target, Sh.Range(T_FROM & "," & T_TO)) Is Nothing Then Exit Sub
    CheckTemplateInput
End Sub
