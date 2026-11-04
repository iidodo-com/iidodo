Attribute VB_Name = "KensyutsuInput"
Option Explicit

' 入力フォームを開く(モードレス: シートを見ながら入力できる)
Public Sub OpenInputForm()
    frmInput.Show vbModeless
End Sub

' 任意: Ctrl+Shift+I で入力フォームを開けるようにする(1回実行。Excelを閉じると解除)
Public Sub SetShortcut()
    Application.OnKey "^+I", "OpenInputForm"
    MsgBox "Ctrl+Shift+I で入力フォームを開けます。", vbInformation
End Sub
