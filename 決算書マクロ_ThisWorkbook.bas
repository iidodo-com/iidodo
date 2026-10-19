Attribute VB_Name = "ThisWorkbook"
Attribute VB_Base = "0{00020819-0000-0000-C000-000000000046}"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = True
Attribute VB_TemplateDerived = False
Attribute VB_Customizable = True
Option Explicit

' 手入力セルの黄色は画面表示用。印刷の前に黄色表示を止め、印刷が済んだら元に戻す。
' （PDF出力・印刷プレビューのマクロは、自分で止めて戻している）

Private Sub Workbook_BeforePrint(Cancel As Boolean)
    Call SuspendInputColor
End Sub

' 印刷後の最初の操作で黄色表示を戻す
Private Sub Workbook_SheetSelectionChange(ByVal Sh As Object, ByVal Target As Range)
    Call ResumeInputColor
End Sub

Private Sub Workbook_SheetActivate(ByVal Sh As Object)
    Call ResumeInputColor
End Sub

' 黄色表示が止まったまま保存・終了しないようにする
Private Sub Workbook_BeforeSave(ByVal SaveAsUI As Boolean, Cancel As Boolean)
    Call ResumeInputColor
End Sub

Private Sub Workbook_BeforeClose(Cancel As Boolean)
    Call ResumeInputColor
End Sub
