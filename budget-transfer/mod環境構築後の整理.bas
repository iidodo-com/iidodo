Attribute VB_Name = "mod環境構築後の整理"
Option Explicit

' ============================================================
'  環境構築後の整理パッチ
'   ボタンの配置など、環境構築のときにしか使わないマクロを、ブックから削除する。
'   ボタンを配置したあとに、1回だけ実行する。
'
'   削除するもの
'     ・SetupGuideButtons（入力ガイドへのボタン配置）…… mod予算書ブック
'     ・SetupRemunerationButton（標準報酬資料の取込ボタンの配置）…… mod標準報酬取込
'     ・ShowCommandMenu の「8  入力ガイドにボタンを配置」の項目
'
'   必要な設定（初回のみ）
'     ファイル → オプション → トラストセンター → トラストセンターの設定 → マクロの設定
'     →「VBAプロジェクト オブジェクト モデルへのアクセスを信頼する」にチェック
'
'   ※ 配置済みのボタンはそのまま使える（ボタンが呼ぶマクロは削除しない）。
'   ※ このモジュール自体は、実行後にVBEで右クリック → 解放 で削除する。
' ============================================================

Public Sub RemoveSetupOnlyCode()
    Dim vbp As Object
    Dim result As String
    Dim ans As VbMsgBoxResult

    ans = MsgBox("環境構築のときにしか使わないマクロ（ボタンの配置）を、このブックから削除します。" & vbCrLf & vbCrLf & _
                 "・入力ガイドのボタンは、配置済みであることを確認してください。" & vbCrLf & _
                 "・削除したあとは、ボタンを置き直せません（必要なら元の .bas を取り込み直す）。" & vbCrLf & vbCrLf & _
                 "実行しますか？", vbYesNo + vbQuestion + vbDefaultButton2, "環境構築後の整理")
    If ans <> vbYes Then Exit Sub

    On Error Resume Next
    Set vbp = ThisWorkbook.VBProject
    If Err.Number <> 0 Or vbp Is Nothing Then
        Err.Clear
        MsgBox "VBAプロジェクトにアクセスできません。" & vbCrLf & _
               "ファイル → オプション → トラストセンター → トラストセンターの設定 → マクロの設定 で、" & vbCrLf & _
               "「VBAプロジェクト オブジェクト モデルへのアクセスを信頼する」にチェックを入れてから、もう一度実行してください。", _
               vbExclamation, "環境構築後の整理"
        Exit Sub
    End If
    If vbp.Protection = 1 Then
        On Error GoTo 0
        MsgBox "VBAプロジェクトがパスワードで保護されています。保護を解除してから、もう一度実行してください。", vbExclamation, "環境構築後の整理"
        Exit Sub
    End If
    On Error GoTo ErrHandler

    ' 1. メニューから「ボタンを配置」の項目を除く
    result = result & RemoveMenuItem(vbp, "mod予算書ブック")
    ' 2. 構築専用の手続きを削除
    result = result & RemoveProc(vbp, "mod予算書ブック", "SetupGuideButtons")
    result = result & RemoveProc(vbp, "mod標準報酬取込", "SetupRemunerationButton")

    MsgBox "整理しました。" & vbCrLf & vbCrLf & result & vbCrLf & _
           "このモジュール（mod環境構築後の整理）は、VBEで右クリック → 解放 で削除してください。" & vbCrLf & _
           "ブックを保存してください。", vbInformation, "環境構築後の整理"
    Exit Sub

ErrHandler:
    MsgBox "整理中にエラーが発生しました。" & vbCrLf & Err.Number & "：" & Err.Description, vbCritical, "環境構築後の整理"
End Sub

' ShowCommandMenu から、SetupGuideButtons に関係する行（メニューの表示と呼び出し）を削除する
Private Function RemoveMenuItem(ByVal vbp As Object, ByVal modName As String) As String
    Dim cm As Object
    Dim i As Long
    Dim ln As String
    Dim n As Long

    Set cm = GetCodeModule(vbp, modName)
    If cm Is Nothing Then
        RemoveMenuItem = "・" & modName & " が見つかりません（メニューの項目は未処理）" & vbCrLf
        Exit Function
    End If
    For i = cm.CountOfLines To 1 Step -1
        ln = cm.Lines(i, 1)
        If InStr(ln, "Call SetupGuideButtons") > 0 Or InStr(ln, "入力ガイドにボタンを配置") > 0 Then
            cm.DeleteLines i, 1
            n = n + 1
        End If
    Next i
    RemoveMenuItem = "・メニューの「ボタンを配置」の項目：" & n & " 行削除" & vbCrLf
End Function

' 指定の手続き（Subの全体と、直前のコメント）を削除する
Private Function RemoveProc(ByVal vbp As Object, ByVal modName As String, ByVal procName As String) As String
    Dim cm As Object
    Dim startLine As Long
    Dim cnt As Long

    Set cm = GetCodeModule(vbp, modName)
    If cm Is Nothing Then
        RemoveProc = "・" & procName & "：" & modName & " が見つかりません" & vbCrLf
        Exit Function
    End If
    On Error Resume Next
    startLine = cm.ProcStartLine(procName, 0)
    If Err.Number <> 0 Or startLine = 0 Then
        Err.Clear
        On Error GoTo 0
        RemoveProc = "・" & procName & "：すでにありません" & vbCrLf
        Exit Function
    End If
    cnt = cm.ProcCountLines(procName, 0)
    On Error GoTo 0
    cm.DeleteLines startLine, cnt
    RemoveProc = "・" & procName & "：削除しました（" & modName & "）" & vbCrLf
End Function

Private Function GetCodeModule(ByVal vbp As Object, ByVal modName As String) As Object
    Dim vbc As Object
    On Error Resume Next
    Set vbc = vbp.VBComponents(modName)
    On Error GoTo 0
    If Not vbc Is Nothing Then Set GetCodeModule = vbc.CodeModule
End Function
