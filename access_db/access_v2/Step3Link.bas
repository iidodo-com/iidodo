Attribute VB_Name = "Step3Link"
Option Compare Database
Option Explicit

' ============================================================
'  第3段階(Access側): 分割後のリンク先の確認・付け替え
'  ※ データベースの分割は、Access標準の機能(データベースツール → Access データベース)で行う。
'  ※ 分割後、フロントエンド(画面側)を各自のパソコンに配る。共有フォルダの場所が変わったときは
'     Step3_Relink でリンク先を付け替える。
' ============================================================

' 現在のリンク先を表示する
Public Sub Step3_ListLinks()
    Dim db As DAO.Database, td As DAO.TableDef, s As String, n As Long
    Set db = CurrentDb
    For Each td In db.TableDefs
        If Len(td.Connect) > 0 Then
            n = n + 1
            If n = 1 Then s = td.Connect & vbCrLf & vbCrLf
            s = s & td.Name & vbCrLf
        End If
    Next
    If n = 0 Then
        MsgBox "リンクテーブルはありません(まだ分割されていません)。", vbInformation
    Else
        MsgBox "リンク先: " & vbCrLf & s, vbInformation
    End If
End Sub

' リンク先(データ本体)を付け替える
Public Sub Step3_Relink()
    Dim db As DAO.Database, td As DAO.TableDef, p As String, n As Long
    On Error GoTo EH
    p = InputBox("データ本体(バックエンド)の .accdb のフルパスを入力してください。" & vbCrLf & _
                 "例: \\サーバー名\共有\検出事項\KensyutsuData_be.accdb", "リンク先の付け替え")
    If Len(p) = 0 Then Exit Sub
    If Dir(p) = "" Then MsgBox "ファイルが見つかりません:" & vbCrLf & p, vbExclamation: Exit Sub
    Set db = CurrentDb
    For Each td In db.TableDefs
        If Len(td.Connect) > 0 Then
            td.Connect = ";DATABASE=" & p
            td.RefreshLink
            n = n + 1
        End If
    Next
    MsgBox n & " 個のテーブルのリンク先を付け替えました。", vbInformation
    Exit Sub
EH:
    MsgBox "付け替えできませんでした: " & Err.Description, vbExclamation
End Sub
