Attribute VB_Name = "ExtRefPatch"
Option Explicit

' DB_設定・DB_集計 などの数式にある「別ファイル参照」を取り除き、このブック内の同名シートを参照するように直す。
'   例) =SUMPRODUCT(1*([★長期標準報酬_R7R8.xlsx]DBP1BC2!$AP$2:$AP$10000>$C$8)*…)
'     → =SUMPRODUCT(1*(DBP1BC2!$AP$2:$AP$10000>$C$8)*…)
' 式の中身(関数・範囲・条件)は変えない。ファイル名は問わない(「[…….xlsx]」の形を全部取り除く)。短期・長期のどちらのブックでも使える。
' 実行前に必ずブックを別名で保存しておくこと(マクロの結果は元に戻せない)。
'
' 対象シートは TARGETS(カンマ区切り)。ほかのシートも直したいときは、ここにシート名を足す。
Private Const TARGETS As String = "DB_設定,DB_集計"

Public Sub PatchExternalRefsDB()
    Dim reBook As Object, rePath As Object, reSheet As Object
    Dim nm As Variant, ws As Worksheet, rng As Range, c As Range
    Dim f As String, g As String, books As String, missing As String, nm2 As String
    Dim ms As Object, m As Object
    Dim nHit As Long, nDone As Long, nSkip As Long, nFmt As Long, calcMode As Long

    Set reBook = CreateObject("VBScript.RegExp")
    reBook.Pattern = "\[[^\]]*\.xls[xm]?\]": reBook.Global = True: reBook.IgnoreCase = True
    Set rePath = CreateObject("VBScript.RegExp")                     ' 'C:\dir\[book.xlsx]Sheet'! の形
    rePath.Pattern = "'[^'\[\]]*\[[^\]]*\.xls[xm]?\]([^']*)'!": rePath.Global = True: rePath.IgnoreCase = True
    Set reSheet = CreateObject("VBScript.RegExp")                    ' 数式の中のシート名
    reSheet.Pattern = "(?:'([^']+)'|([^\s'()+\-*/,&=<>^!:;\[\]""]+))!": reSheet.Global = True

    ' ---- 1回目: 何を直すか調べる(まだ書き換えない)
    For Each nm In Split(TARGETS, ",")
        If SheetExists(CStr(nm)) Then
            Set ws = ThisWorkbook.Worksheets(CStr(nm))
            Set rng = Nothing
            On Error Resume Next
            Set rng = ws.UsedRange.SpecialCells(xlCellTypeFormulas)
            On Error GoTo 0
            If Not rng Is Nothing Then
                For Each c In rng.Cells
                    f = c.Formula
                    If reBook.Test(f) Then
                        nHit = nHit + 1
                        Set ms = reBook.Execute(f)
                        For Each m In ms
                            If InStr(books, m.Value) = 0 Then books = books & m.Value & vbCrLf
                        Next m
                        g = Clean(f, rePath, reBook)
                        Set ms = reSheet.Execute(g)
                        For Each m In ms
                            If Len(m.SubMatches(0) & "") > 0 Then nm2 = m.SubMatches(0) Else nm2 = m.SubMatches(1) & ""
                            If Len(nm2) > 0 Then
                                If Not SheetExists(nm2) Then
                                    If InStr(missing, "  " & nm2 & vbCrLf) = 0 Then missing = missing & "  " & nm2 & vbCrLf
                                End If
                            End If
                        Next m
                    End If
                Next c
            End If
        End If
    Next nm

    If nHit = 0 Then
        MsgBox "別ファイルを参照している数式は見つかりませんでした。(対象: " & TARGETS & ")", vbInformation
        Exit Sub
    End If
    If Len(missing) > 0 Then
        MsgBox "このブックに次のシートがありません。先に別ファイルからシートをコピーするか、作成してください。" & vbCrLf & _
               "(無いまま直すと、Excelが「ファイルを開く」画面を出して式が壊れるため、何も変更していません)" & vbCrLf & vbCrLf & missing, vbExclamation
        Exit Sub
    End If
    If MsgBox("対象シート(" & TARGETS & ")の " & nHit & " セルから、次の別ファイル参照を取り除きます。" & vbCrLf & vbCrLf & books & vbCrLf & _
              "実行前にブックを別名保存しましたか？", vbOKCancel + vbQuestion, "外部参照パッチ") <> vbOK Then Exit Sub

    ' ---- 2回目: 書き換える
    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fail
    For Each nm In Split(TARGETS, ",")
        If SheetExists(CStr(nm)) Then
            Set ws = ThisWorkbook.Worksheets(CStr(nm))
            Set rng = Nothing
            On Error Resume Next
            Set rng = ws.UsedRange.SpecialCells(xlCellTypeFormulas)
            On Error GoTo Fail
            If Not rng Is Nothing Then
                For Each c In rng.Cells
                    f = c.Formula
                    If reBook.Test(f) Then
                        If c.HasArray Then
                            nSkip = nSkip + 1                      ' 配列数式は手作業で確認
                        Else
                            g = Clean(f, rePath, reBook)
                            If c.NumberFormat = "@" Then c.NumberFormat = "General": nFmt = nFmt + 1   ' 文字列形式だと式が計算されないため
                            c.Formula = g
                            nDone = nDone + 1
                        End If
                    End If
                Next c
            End If
        End If
    Next nm
Fail:
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description & vbCrLf & "セル: " & c.Parent.Name & "!" & c.Address(False, False), vbExclamation
    Else
        Application.Calculate
        MsgBox "変更したセル: " & nDone & vbCrLf & _
               "表示形式を「文字列」から「標準」に直したセル: " & nFmt & vbCrLf & _
               "配列数式のため未変更: " & nSkip & vbCrLf & vbCrLf & _
               "残っているリンク: " & RemainingLinks() & vbCrLf & _
               "(データ → リンクの編集 でも確認できます。残っていれば、他のシートや名前の定義にも同じ参照があります)", vbInformation, "外部参照パッチ"
    End If
End Sub

' パス付き 'C:\dir\[book.xlsx]Sheet'! → 'Sheet'! にし、残りの [book.xlsx] を取り除く
Private Function Clean(ByVal f As String, ByVal rePath As Object, ByVal reBook As Object) As String
    Dim t As String
    t = rePath.Replace(f, "'$1'!")
    Clean = reBook.Replace(t, "")
End Function

Private Function RemainingLinks() As String
    Dim lk As Variant, i As Long
    lk = ThisWorkbook.LinkSources(xlExcelLinks)
    If IsEmpty(lk) Then
        RemainingLinks = "なし"
    Else
        For i = LBound(lk) To UBound(lk)
            RemainingLinks = RemainingLinks & vbCrLf & "  " & lk(i)
        Next i
    End If
End Function

Private Function SheetExists(ByVal nm As String) As Boolean
    Dim s As Object
    For Each s In ThisWorkbook.Sheets
        If s.Name = nm Then SheetExists = True: Exit Function
    Next s
End Function
