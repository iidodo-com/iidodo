Attribute VB_Name = "modClaim"
Option Explicit

' =====================================================================
'  AddClaimSheet
'  Adds one sheet per claim period (a copy of the template sheet) and
'  fills it with the rows of the calc sheet that fall in that period.
'
'  Nothing on the worksheets is hard-coded here: cells are reached through
'  workbook Names (Formulas > Name Manager). Wording of messages, the sheet
'  name prefix and the template position are stored on the setting sheet.
'  If you move the input cells, just re-point the Names; no code change.
' =====================================================================

' header cells of the template sheet (change only if the template layout changes)
Private Const T_ID As String = "F3"
Private Const T_NAME As String = "F4"
Private Const T_FROM As String = "F5"
Private Const T_TO As String = "H5"
Private Const T_RATE As String = "F6"
Private Const T_DATE As String = "F7"
Private Const T_P_START As String = "N3"      ' benefit period block (right side of the header)
Private Const T_P_LEGAL As String = "N4"
Private Const T_P_ADDST As String = "N5"
Private Const T_P_ADDEN As String = "N6"
Private Const T_P_FINAL As String = "N7"
Private Const T_P_EXT As String = "N8"

' columns of the calc sheet table (= columns of the template detail rows)
Private Const COL_PAYCLASS As Long = 4      ' D  salary class (10/8/none)
Private Const COL_BENEFIT As Long = 5       ' E  statutory / additional
Private Const COL_START As Long = 6         ' F  period start
Private Const COL_END As Long = 7           ' G  period end
Private Const COL_WORKDAYS As Long = 8      ' H  working days of the month
Private Const COL_RATE As Long = 10         ' J  daily allowance (B)
Private Const COL_PAY As Long = 11          ' K  daily pay (C)

Private Function Cel(ByVal nm As String) As Range
    Set Cel = ThisWorkbook.Names(nm).RefersToRange
End Function

Public Sub AddClaimSheet()
    Dim vFrom As Variant, vTo As Variant
    Dim dFrom As Date, dTo As Date
    Dim tbl As Range, idx() As Long
    Dim n As Long, i As Long, k As Long, t As Long
    Dim s As Variant, e As Variant, s2 As Double, e2 As Double
    Dim tpl As Worksheet, ws As Worksheet, nm As String
    Dim firstRow As Long

    vFrom = Cel("CLAIM_FROM").Value2
    vTo = Cel("CLAIM_TO").Value2
    If IsEmpty(vFrom) Or IsEmpty(vTo) Then
        MsgBox Cel("MSG_NO_PERIOD").Value, vbExclamation
        Exit Sub
    End If
    If Not (IsNumeric(vFrom) And IsNumeric(vTo)) Then
        MsgBox Cel("MSG_NO_PERIOD").Value, vbExclamation
        Exit Sub
    End If
    dFrom = CDate(vFrom)
    dTo = CDate(vTo)
    If dFrom > dTo Then
        MsgBox Cel("MSG_ORDER").Value, vbExclamation
        Exit Sub
    End If

    ' 1) rows of the calc sheet that overlap the claim period
    Set tbl = Cel("CALC_TABLE")
    ReDim idx(1 To tbl.Rows.Count)
    For i = 1 To tbl.Rows.Count
        s = tbl.Cells(i, COL_START).Value2
        e = tbl.Cells(i, COL_END).Value2
        If IsNumeric(s) And IsNumeric(e) And Not IsEmpty(s) And Not IsEmpty(e) Then
            If CDbl(e) >= CDbl(dFrom) And CDbl(s) <= CDbl(dTo) Then
                n = n + 1
                idx(n) = i
            End If
        End If
    Next i
    If n = 0 Then
        MsgBox Cel("MSG_NO_ROWS").Value, vbExclamation
        Exit Sub
    End If
    If n > CLng(Cel("TPL_ROWS").Value2) Then
        MsgBox Cel("MSG_TOO_MANY").Value, vbExclamation
        Exit Sub
    End If

    ' 2) copy the template to the end of the book and name the copy
    Set tpl = ThisWorkbook.Worksheets(CStr(Cel("TPL_NAME").Value))
    tpl.Copy After:=ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count)
    Set ws = ThisWorkbook.Worksheets(ThisWorkbook.Worksheets.Count)
    nm = CStr(Cel("SET_PREFIX").Value) & Format(dFrom, "yyyymm")
    If Format(dFrom, "yyyymm") <> Format(dTo, "yyyymm") Then
        nm = nm & CStr(Cel("SET_SEP").Value) & Format(dTo, "yyyymm")
    End If
    ws.Name = UniqueName(nm)

    ' 3) header values
    ws.Range(T_ID).Value = Cel("EMP_ID").Value
    ws.Range(T_NAME).Value = Cel("EMP_NAME").Value
    ws.Range(T_FROM).Value2 = CDbl(dFrom)
    ws.Range(T_TO).Value2 = CDbl(dTo)
    ws.Range(T_RATE).Value2 = Cel("DAILY_RATE").Value2
    ws.Range(T_DATE).Value2 = CDbl(Date)
    ws.Range(T_P_START).Value2 = Cel("P_START").Value2
    ws.Range(T_P_LEGAL).Value2 = Cel("P_LEGAL_END").Value2
    ws.Range(T_P_ADDST).Value2 = Cel("P_ADD_START").Value2
    ws.Range(T_P_ADDEN).Value2 = Cel("P_ADD_END").Value2
    ws.Range(T_P_FINAL).Value2 = Cel("P_FINAL").Value2
    ws.Range(T_P_EXT).Value2 = Cel("EXT_DAYS").Value2

    ' 4) detail rows: values only (the other columns are formulas in the template)
    firstRow = CLng(Cel("TPL_FIRST_ROW").Value2)
    For k = 1 To n
        i = idx(k)
        t = firstRow + k - 1
        s2 = tbl.Cells(i, COL_START).Value2
        e2 = tbl.Cells(i, COL_END).Value2
        If s2 < CDbl(dFrom) Then s2 = CDbl(dFrom)
        If e2 > CDbl(dTo) Then e2 = CDbl(dTo)
        ws.Cells(t, COL_PAYCLASS).Value = tbl.Cells(i, COL_PAYCLASS).Value
        ws.Cells(t, COL_BENEFIT).Value = tbl.Cells(i, COL_BENEFIT).Value
        ws.Cells(t, COL_START).Value2 = s2
        ws.Cells(t, COL_END).Value2 = e2
        ws.Cells(t, COL_WORKDAYS).Value2 = tbl.Cells(i, COL_WORKDAYS).Value2
        ws.Cells(t, COL_RATE).Value2 = tbl.Cells(i, COL_RATE).Value2
        ws.Cells(t, COL_PAY).Value2 = tbl.Cells(i, COL_PAY).Value2
    Next k

    ws.Activate
    MsgBox Cel("MSG_DONE").Value, vbInformation
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
        nm = baseName & CStr(Cel("SET_DUP").Value) & CStr(i)
    Loop
    UniqueName = Left$(nm, 31)
End Function
