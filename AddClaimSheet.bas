Attribute VB_Name = "modClaim"
Option Explicit

' =====================================================================
'  請求シートの自動追加
'  「請求シート雛形」の黄色（請求期間の始・終）を入れて、
'  ボタン（マクロ CheckTemplateInput）を押すと、新しい請求シートが追加されます。
'  - FreezeActiveSheet: 今のシートの式を値に変えて、記録として固定する
' =====================================================================
Public Const TPL_SHEET As String = "請求シート雛形"    ' 複写元のシート名
Public Const T_FROM As String = "F5"                    ' 雛形の請求期間（始）
Public Const T_TO As String = "H5"                      ' 雛形の請求期間（終）
Private Const NAME_PREFIX As String = "請求_"           ' 追加するシート名の先頭

' 雛形の請求期間が両方入っていたら、新しいシートを追加して雛形を空に戻す
Public Sub CheckTemplateInput()
    Dim tpl As Worksheet, vF As Variant, vT As Variant
    Set tpl = ThisWorkbook.Worksheets(TPL_SHEET)
    vF = tpl.Range(T_FROM).Value2
    vT = tpl.Range(T_TO).Value2
    If IsEmpty(vF) Or IsEmpty(vT) Then Exit Sub
    If Not (IsNumeric(vF) And IsNumeric(vT)) Then Exit Sub
    If CDbl(vF) > CDbl(vT) Then
        MsgBox "開始日が終了日より後になっています。", vbExclamation
        Exit Sub
    End If
    Application.EnableEvents = False
    On Error GoTo done
    tpl.Range(T_FROM).ClearContents
    tpl.Range(T_TO).ClearContents
    CreateClaimSheet CDate(vF), CDate(vT)
done:
    Application.EnableEvents = True
End Sub

Public Sub CreateClaimSheet(ByVal dFrom As Date, ByVal dTo As Date)
    Dim ws As Worksheet, nm As String, ev As Boolean
    ev = Application.EnableEvents
    Application.EnableEvents = False
    ThisWorkbook.Worksheets(TPL_SHEET).Copy After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count)
    Set ws = ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count)
    nm = NAME_PREFIX & WarekiMonth(dFrom)
    If WarekiMonth(dFrom) <> WarekiMonth(dTo) Then
        nm = nm & "-" & WarekiMonth(dTo)
    End If
    ws.Name = UniqueName(nm)
    DeleteButtons ws
    ws.Range(T_FROM).Value2 = CDbl(dFrom)
    ws.Range(T_TO).Value2 = CDbl(dTo)
    Application.EnableEvents = ev
    ws.Activate
End Sub

Public Sub FreezeActiveSheet()
    If MsgBox("このシートの式を値に変えます（元に戻せません）。よろしいですか？", vbYesNo + vbQuestion) <> vbYes Then Exit Sub
    With ActiveSheet.UsedRange
        .Value2 = .Value2
    End With
End Sub

' 和暦の年月（例 R7.4）。シート名に使う
Private Function WarekiMonth(ByVal d As Date) As String
    WarekiMonth = Application.WorksheetFunction.Text(d, "[$-411]ge.m")
End Function

' 複写したシートのボタン（フォームコントロール・ActiveX）を削除する。雛形にだけボタンを残す
Private Sub DeleteButtons(ByVal ws As Worksheet)
    Dim i As Long
    On Error Resume Next
    For i = ws.Shapes.Count To 1 Step -1
        If ws.Shapes(i).Type = 8 Or ws.Shapes(i).Type = 12 Then ws.Shapes(i).Delete
    Next i
    On Error GoTo 0
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
