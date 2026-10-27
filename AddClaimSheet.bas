Attribute VB_Name = "modClaim"
Option Explicit

' =====================================================================
'  請求シートの追加
'  AddClaimSheet    : 「請求シート雛形」を複写し、請求期間を入れる
'  FreezeActiveSheet: 今のシートの式を値に変えて、記録として固定する
'  ※請求期間を入れると、そのシートの明細は自動で出ます（式は雛形に入っています）。
' =====================================================================
Private Const TPL_SHEET As String = "請求シート雛形"   ' 複写元のシート名
Private Const T_FROM As String = "F5"                   ' 雛形の請求期間（始）
Private Const T_TO As String = "H5"                     ' 雛形の請求期間（終）
Private Const NAME_PREFIX As String = "請求_"           ' 追加するシート名の先頭

Public Sub AddClaimSheet()
    Dim sFrom As String, sTo As String
    sFrom = InputBox("請求期間の開始日を入力してください。" & vbCrLf & "（例 2025/4/1）", "請求シートの追加")
    If Len(sFrom) = 0 Then Exit Sub
    sTo = InputBox("請求期間の終了日を入力してください。" & vbCrLf & "（例 2025/4/30）", "請求シートの追加")
    If Len(sTo) = 0 Then Exit Sub
    If Not IsDate(sFrom) Or Not IsDate(sTo) Then
        MsgBox "日付で入力してください。", vbExclamation
        Exit Sub
    End If
    CreateClaimSheet CDate(sFrom), CDate(sTo)
End Sub

Public Sub CreateClaimSheet(ByVal dFrom As Date, ByVal dTo As Date)
    Dim ws As Worksheet, nm As String
    If dFrom > dTo Then
        MsgBox "開始日が終了日より後になっています。", vbExclamation
        Exit Sub
    End If
    ThisWorkbook.Worksheets(TPL_SHEET).Copy After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count)
    Set ws = ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count)
    nm = NAME_PREFIX & Format(dFrom, "yyyymm")
    If Format(dFrom, "yyyymm") <> Format(dTo, "yyyymm") Then
        nm = nm & "-" & Format(dTo, "yyyymm")
    End If
    ws.Name = UniqueName(nm)
    ws.Range(T_FROM).Value2 = CDbl(dFrom)
    ws.Range(T_TO).Value2 = CDbl(dTo)
    ws.Activate
End Sub

Public Sub FreezeActiveSheet()
    If MsgBox("このシートの式を値に変えます（元に戻せません）。よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    With ActiveSheet.UsedRange
        .Value2 = .Value2
    End With
End Sub

Private Function SheetExists(ByVal nm As String) As Boolean
    Dim w As Worksheet
    For Each w In ThisWorkbook.Worksheets
        If w.Name = nm Then
            SheetExists = True
            Exit Function
        End If
    Next w
End Function

Private Function UniqueName(ByVal baseName As String) As String
    Dim nm As String, i As Long
    nm = baseName
    i = 1
    Do While SheetExists(nm)
        i = i + 1
        nm = baseName & "_" & CStr(i)
    Loop
    UniqueName = Left$(nm, 31)
End Function
