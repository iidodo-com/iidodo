Attribute VB_Name = "Module1"

Option Explicit

' ============================================================
'  来庁者ダッシュボード用マクロ（初心者向けにコメントを多めに書いています）
'  ボタンを押すと、黄色い「選択セル」を自動で切り替えて、
'  グラフがアニメーションのように動きます。
' ============================================================

Private Const SHEET_DASH As String = "ダッシュボード"
Private paletteNo As Long

' ---- 初期状態に戻す ------------------------------------------
Public Sub ResetAll()
    With ThisWorkbook.Worksheets(SHEET_DASH)
        .Range("D4").Value = "全区"
        .Range("J4").Value = "全期間"
        .Range("P4").Value = TimeSerial(9, 0, 0)
        .Range("V4").Value = TimeSerial(16, 30, 0)
        .Activate
        .Range("D4").Select
    End With
End Sub

' ---- 区を1つずつ自動で切り替える -----------------------------
Public Sub PlayWards()
    Dim ws As Worksheet, names As Variant, i As Long, keep As Variant
    Set ws = ThisWorkbook.Worksheets(SHEET_DASH)
    names = Array("全区", "中区", "東区", "南区", "西区", "安佐南区", "安佐北区", "安芸区", "佐伯区")
    keep = ws.Range("D4").Value
    ws.Activate
    On Error GoTo Done
    For i = LBound(names) To UBound(names)
        ws.Range("D4").Value = names(i)
        Application.StatusBar = "表示中： " & names(i) & "（Escキーで中断できます）"
        Application.Calculate
        DoEvents
        Application.Wait Now + TimeSerial(0, 0, 2)
    Next i
Done:
    ws.Range("D4").Value = keep
    Application.StatusBar = False
End Sub

' ---- 月を1つずつ自動で切り替える -----------------------------
Public Sub PlayMonths()
    Dim ws As Worksheet, names As Variant, i As Long, keep As Variant
    Set ws = ThisWorkbook.Worksheets(SHEET_DASH)
    names = Array("全期間", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月")
    keep = ws.Range("J4").Value
    ws.Activate
    On Error GoTo Done
    For i = LBound(names) To UBound(names)
        ws.Range("J4").Value = names(i)
        Application.StatusBar = "表示中： " & names(i) & "（Escキーで中断できます）"
        Application.Calculate
        DoEvents
        Application.Wait Now + TimeSerial(0, 0, 1)
    Next i
Done:
    ws.Range("J4").Value = keep
    Application.StatusBar = False
End Sub

' ---- 開庁時間の終了を延ばしていくと「時間外」がどう減るか見せる ----
Public Sub PlayEndTime()
    Dim ws As Worksheet, m As Long, keep As Variant
    Set ws = ThisWorkbook.Worksheets(SHEET_DASH)
    keep = ws.Range("V4").Value
    ws.Activate
    On Error GoTo Done
    For m = 15 * 60 To 18 * 60 Step 15
        ws.Range("V4").Value = m / 1440
        Application.StatusBar = "開庁時間の終了： " & Format(m \ 60, "0") & ":" & Format(m Mod 60, "00")
        Application.Calculate
        DoEvents
        Application.Wait Now + TimeSerial(0, 0, 1)
    Next m
Done:
    ws.Range("V4").Value = keep
    Application.StatusBar = False
End Sub

' ---- ダッシュボードをPDFで保存 ------------------------------
Public Sub ExportPDF()
    Dim ws As Worksheet, p As String
    Set ws = ThisWorkbook.Worksheets(SHEET_DASH)
    If ThisWorkbook.Path = "" Then
        MsgBox "先にこのファイルを保存してから実行してください。", vbInformation
        Exit Sub
    End If
    p = ThisWorkbook.Path & "\ダッシュボード_" & ws.Range("D4").Value & "_" & ws.Range("J4").Value & ".pdf"
    ws.ExportAsFixedFormat Type:=xlTypePDF, Filename:=p, Quality:=xlQualityStandard, OpenAfterPublish:=True
End Sub

' ---- ヒートマップの配色を切り替える -------------------------
Public Sub CycleColors()
    Dim ws As Worksheet, fc As Object, lo As Long, mid As Long, hi As Long
    paletteNo = (paletteNo + 1) Mod 4
    Select Case paletteNo
        Case 0: lo = RGB(247, 251, 255): mid = RGB(255, 213, 128): hi = RGB(214, 69, 69)
        Case 1: lo = RGB(247, 252, 245): mid = RGB(116, 196, 118): hi = RGB(0, 90, 50)
        Case 2: lo = RGB(255, 255, 255): mid = RGB(158, 202, 225): hi = RGB(8, 48, 107)
        Case Else: lo = RGB(250, 245, 255): mid = RGB(203, 160, 230): hi = RGB(84, 39, 143)
    End Select
    For Each ws In ThisWorkbook.Worksheets
        If ws.Name = "ヒートマップ" Or ws.Name = "カレンダー" Then
            For Each fc In ws.Cells.FormatConditions
                If fc.Type = 3 Then
                    fc.ColorScaleCriteria(1).FormatColor.Color = lo
                    fc.ColorScaleCriteria(2).FormatColor.Color = mid
                    fc.ColorScaleCriteria(3).FormatColor.Color = hi
                End If
            Next fc
        End If
    Next ws
End Sub

' ---- 全シートの選択を「全区」に揃える ------------------------
Public Sub AllWardsReset()
    Dim n As Variant
    For Each n In Array("ヒートマップ", "カレンダー", "業務ランキング")
        ThisWorkbook.Worksheets(n).Range("C3").Value = "全区"
    Next n
    ThisWorkbook.Worksheets("シミュレーター").Range("C4").Value = "全区"
End Sub
