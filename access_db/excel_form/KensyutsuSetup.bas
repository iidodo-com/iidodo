Attribute VB_Name = "KensyutsuSetup"
Option Explicit

' ============================================================
'  検出事項 入力フォームの自動作成
'  使い方: ブックを .xlsm で保存 → このファイルをインポート → InstallForm を1回実行
'  前提:  ファイル→オプション→トラストセンター→トラストセンターの設定→マクロの設定
'         「VBA プロジェクト オブジェクト モデルへのアクセスを信頼する」にチェック
' ============================================================

' 入力フォーム(UserForm: frmInput)を作成する。1回だけ実行する。
Public Sub InstallForm()
    Dim vbc As Object, ws As Worksheet, r As Long, n As Long, s As String
    On Error GoTo EH

    Set ws = ThisWorkbook.Worksheets("フォームコード")

    ' 既に frmInput があれば作り直す
    For Each vbc In ThisWorkbook.VBProject.VBComponents
        If vbc.Name = "frmInput" Then
            ThisWorkbook.VBProject.VBComponents.Remove vbc
            Exit For
        End If
    Next

    Set vbc = ThisWorkbook.VBProject.VBComponents.Add(3)   ' 3 = UserForm
    vbc.Name = "frmInput"

    n = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    For r = 1 To n
        s = s & ws.Cells(r, 1).Value & vbCrLf
    Next
    If vbc.CodeModule.CountOfLines > 0 Then vbc.CodeModule.DeleteLines 1, vbc.CodeModule.CountOfLines
    vbc.CodeModule.AddFromString s

    MsgBox "入力フォームを作成しました。" & vbCrLf & "続けて OpenInputForm を実行すると、入力画面が開きます。", vbInformation
    Exit Sub

EH:
    MsgBox "作成できませんでした: " & Err.Description & vbCrLf & vbCrLf & _
           "「VBAプロジェクト オブジェクト モデルへのアクセスを信頼する」を有効にしてから、もう一度実行してください。" & vbCrLf & _
           "(ファイル → オプション → トラストセンター → トラストセンターの設定 → マクロの設定)", vbExclamation
End Sub

' 入力フォームを開く(モードレス: シートを見ながら入力できる)
Public Sub OpenInputForm()
    Dim f As Object
    Set f = VBA.UserForms.Add("frmInput")
    f.Show vbModeless
End Sub

' 任意: Ctrl+Shift+I で入力フォームを開けるようにする(Excelを閉じると解除)
Public Sub SetShortcut()
    Application.OnKey "^+I", "OpenInputForm"
    MsgBox "Ctrl+Shift+I で入力フォームを開けます。", vbInformation
End Sub
