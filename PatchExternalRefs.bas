Attribute VB_Name = "PatchExternalRefs"
Option Explicit

' 表示中のシートの全数式から、別ファイル参照 [★短期標準報酬_R7R8.xlsx] を取り除き、
' このブック内の同名シートを参照するように直す。式の中身(関数・範囲・条件)は変えない。
'   例) =...[★短期標準報酬_R7R8.xlsx]DBP2BB1!$A$2:$A$10000...
'     → =...DBP2BB1!$A$2:$A$10000...
' 使い方: 直したいシートを表示して PatchExternalRefs を実行。実行前にブックを別名保存しておくこと。

Private Const OLD_BOOK As String = "★短期標準報酬_R7R8.xlsx"
' 参照先として、このブックに必ず存在していてほしいシート(無いと Excel が「ファイルを開く」画面を出すため先に確認する)
Private Const REQUIRED As String = "DBP1BC2,DBP7C85,DBP2BB1,DBP59FA,DB_設定"

Public Sub PatchExternalRefs()
    Dim ws As Worksheet, nm As Variant, missing As String
    Dim rng As Range, c As Range
    Dim token As String, f As String
    Dim nDone As Long, nSkip As Long

    Set ws = ActiveSheet
    token = "[" & OLD_BOOK & "]"

    For Each nm In Split(REQUIRED, ",")
        If Not SheetExists(CStr(nm)) Then missing = missing & vbCrLf & "  " & nm
    Next nm
    If Len(missing) > 0 Then
        MsgBox "このブックに次のシートがありません。先にコピーまたは作成してください。" & missing, vbExclamation
        Exit Sub
    End If

    On Error Resume Next
    Set rng = ws.UsedRange.SpecialCells(xlCellTypeFormulas)
    On Error GoTo 0
    If rng Is Nothing Then MsgBox "数式がありません。", vbInformation: Exit Sub

    If MsgBox("シート「" & ws.Name & "」の数式から" & vbCrLf & token & vbCrLf & "を取り除きます。よろしいですか？", _
              vbOKCancel + vbQuestion) <> vbOK Then Exit Sub

    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fin
    For Each c In rng.Cells
        f = c.Formula
        If InStr(1, f, token, vbTextCompare) > 0 Then
            If c.HasArray Then
                nSkip = nSkip + 1                      ' 配列数式は手作業で確認
            Else
                c.Formula = Replace(f, token, "", , , vbTextCompare)
                nDone = nDone + 1
            End If
        End If
    Next c
Fin:
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description & vbCrLf & "セル: " & c.Address(False, False), vbExclamation
    End If
    MsgBox "変更したセル: " & nDone & vbCrLf & "配列数式のため未変更: " & nSkip & vbCrLf & _
           "リンクが残っていないか、データ → リンクの編集 で確認してください。", vbInformation
End Sub

Private Function SheetExists(ByVal nm As String) As Boolean
    Dim s As Object
    For Each s In ThisWorkbook.Sheets
        If s.Name = nm Then SheetExists = True: Exit Function
    Next s
End Function
