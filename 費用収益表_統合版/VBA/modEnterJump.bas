Attribute VB_Name = "modEnterJump"
Option Explicit

' Enter キーで「次の手入力セル（黄色）」へ移動する。
'   ・Enter        次の黄色セルへ（右へ→行末まで来たら次の行の最初の黄色へ）
'   ・Shift+Enter  前の黄色セルへ
'   ・同じシートの中だけを移動する。先に黄色セルがなければ通常の Enter と同じ動き
'   ・黄色セルでの入力確定（Enter）の直後にも、次の黄色セルへ移動する（Tab・矢印・マウスの移動はそのまま）
'   ・このブックがアクティブな間だけキー割り当てを変える。Alt+F8 の ToggleEnterJump で ON/OFF
'   ・黄色の判定は「セルの塗りつぶしが INPUT_COLOR」（ブック側の手入力セルの色と同じ）

Public Const INPUT_COLOR As Long = 10027007        ' RGB(255,255,153)
Private Const MAX_ROWS_AHEAD As Long = 3000        ' 先を探す行数の上限（入力_業務は1600行）
Private Const MAX_COL As Long = 24                 ' 探す列の右端（X列）

Private mEnabled As Boolean
Private mInit As Boolean
Private mPendSheet As String
Private mPendAddr As String

Private Sub EnsureInit()
    If Not mInit Then
        mEnabled = True
        mInit = True
    End If
End Sub

Public Sub ToggleEnterJump()
    Call EnsureInit
    mEnabled = Not mEnabled
    If mEnabled Then
        Call EnableEnterKey
        MsgBox "Enterキーで次の黄色セルへ移動します。" & vbCrLf & "Shift+Enterで前の黄色セルへ戻ります。", _
               vbInformation, "Enterキーの移動"
    Else
        Call DisableEnterKey
        MsgBox "Enterキーを通常の動作に戻しました。", vbInformation, "Enterキーの移動"
    End If
End Sub

Public Sub EnableEnterKey()
    Call EnsureInit
    If Not mEnabled Then
        Call DisableEnterKey
        Exit Sub
    End If
    Dim book As String
    book = "'" & ThisWorkbook.Name & "'!"
    Call SetOnKey("~", book & "EnterKeyForward")
    Call SetOnKey("{ENTER}", book & "EnterKeyForward")
    Call SetOnKey("+~", book & "EnterKeyBackward")
    Call SetOnKey("+{ENTER}", book & "EnterKeyBackward")
End Sub

Public Sub DisableEnterKey()
    Call SetOnKey("~", "")
    Call SetOnKey("{ENTER}", "")
    Call SetOnKey("+~", "")
    Call SetOnKey("+{ENTER}", "")
End Sub

Private Sub SetOnKey(ByVal key As String, ByVal proc As String)
    On Error Resume Next
    If proc = "" Then
        Application.OnKey key
    Else
        Application.OnKey key, proc
    End If
    Err.Clear
    On Error GoTo 0
End Sub

Private Function IsInputCell(ByVal c As Range) As Boolean
    Dim a As Range
    On Error Resume Next
    Set a = c.MergeArea.Cells(1, 1)
    If c.Address <> a.Address Then Exit Function          ' 結合セルの左上以外は対象外
    If c.EntireColumn.Hidden Or c.EntireRow.Hidden Then Exit Function
    IsInputCell = (c.Interior.Color = INPUT_COLOR)
    On Error GoTo 0
End Function

' 現在のセルの次（前）の黄色セルを探す。なければ Nothing
Private Function FindInput(ByVal cur As Range, ByVal backward As Boolean) As Range
    Dim ws As Worksheet
    Dim r As Long, c As Long, r0 As Long, c0 As Long
    Dim rLast As Long, step As Long, n As Long
    Dim cell As Range

    Set ws = cur.Worksheet
    rLast = ws.UsedRange.Row + ws.UsedRange.Rows.Count - 1
    If backward Then step = -1 Else step = 1
    r0 = cur.Row
    c0 = cur.Column + cur.MergeArea.Columns.Count - 1
    If backward Then c0 = cur.Column
    r = r0
    c = c0 + step
    Do
        Do While c >= 1 And c <= MAX_COL
            Set cell = ws.Cells(r, c)
            If IsInputCell(cell) Then
                Set FindInput = cell
                Exit Function
            End If
            c = c + step
        Loop
        If step = 1 Then c = 1 Else c = MAX_COL
        r = r + step
        n = n + 1
        If r < 1 Or r > rLast Or n > MAX_ROWS_AHEAD Then Exit Do
    Loop
End Function

Private Function EnterMoveTarget(ByVal cell As Range, ByVal backward As Boolean) As Range
    Dim area As Range, ws As Worksheet, dirn As Long
    If Not Application.MoveAfterReturn Then Exit Function
    Set area = cell.MergeArea
    Set ws = cell.Worksheet
    dirn = Application.MoveAfterReturnDirection
    If backward Then
        Select Case dirn
            Case xlDown: dirn = xlUp
            Case xlUp: dirn = xlDown
            Case xlToRight: dirn = xlToLeft
            Case xlToLeft: dirn = xlToRight
        End Select
    End If
    On Error Resume Next
    Select Case dirn
        Case xlDown: Set EnterMoveTarget = ws.Cells(area.Row + area.Rows.Count, area.Column)
        Case xlUp: Set EnterMoveTarget = ws.Cells(area.Row - 1, area.Column)
        Case xlToRight: Set EnterMoveTarget = ws.Cells(area.Row, area.Column + area.Columns.Count)
        Case xlToLeft: Set EnterMoveTarget = ws.Cells(area.Row, area.Column - 1)
    End Select
    On Error GoTo 0
End Function

Public Sub EnterKeyForward()
    Call EnterKeyMove(False)
End Sub

Public Sub EnterKeyBackward()
    Call EnterKeyMove(True)
End Sub

Private Sub EnterKeyMove(ByVal backward As Boolean)
    Dim cur As Range, nxt As Range, tgt As Range

    On Error Resume Next
    If Not ActiveWorkbook Is ThisWorkbook Then
        Call DisableEnterKey
        Set tgt = EnterMoveTarget(ActiveCell, backward)
        If Not tgt Is Nothing Then tgt.Select
        Exit Sub
    End If
    If TypeName(Selection) <> "Range" Then Exit Sub
    If Application.CutCopyMode <> 0 Then            ' コピー中の Enter は貼り付け
        ActiveSheet.Paste
        Application.CutCopyMode = False
        Exit Sub
    End If
    Set cur = ActiveCell
    On Error GoTo 0
    If cur Is Nothing Then Exit Sub

    Set nxt = FindInput(cur, backward)
    If Not nxt Is Nothing Then
        nxt.Select
    Else
        Set tgt = EnterMoveTarget(cur, backward)
        If Not tgt Is Nothing Then
            On Error Resume Next
            tgt.Select
            On Error GoTo 0
        End If
    End If
End Sub

' 黄色セルに値が入力されたとき（ThisWorkbook の SheetChange から呼ぶ）
Public Sub OnInputCellChanged(ByVal Target As Range)
    Call EnsureInit
    If Not mEnabled Then Exit Sub
    If Target.Cells.Count <> Target.Cells(1, 1).MergeArea.Cells.Count Then Exit Sub
    If Not IsInputCell(Target.Cells(1, 1)) Then Exit Sub
    mPendSheet = Target.Worksheet.Name
    mPendAddr = Target.Cells(1, 1).Address(False, False)
    Application.OnTime Now, "'" & ThisWorkbook.Name & "'!AfterInputCommit"
End Sub

Public Sub AfterInputCommit()
    Dim ws As Worksheet, cell As Range, act As Range
    Dim fwd As Range, back As Range, nxt As Range

    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets(mPendSheet)
    If ws Is Nothing Then Exit Sub
    If ActiveSheet.Name <> mPendSheet Then Exit Sub
    Set act = ActiveCell
    On Error GoTo 0
    If act Is Nothing Then Exit Sub
    Set cell = ws.Range(mPendAddr)

    Set fwd = EnterMoveTarget(cell, False)
    Set back = EnterMoveTarget(cell, True)
    If Not fwd Is Nothing Then
        If act.Address = fwd.MergeArea.Cells(1, 1).Address Then
            Set nxt = FindInput(cell, False)
            If Not nxt Is Nothing Then nxt.Select
            Exit Sub
        End If
    End If
    If Not back Is Nothing Then
        If act.Address = back.MergeArea.Cells(1, 1).Address Then
            Set nxt = FindInput(cell, True)
            If Not nxt Is Nothing Then nxt.Select
            Exit Sub
        End If
    End If
    If Not Application.MoveAfterReturn Then
        If act.Address = cell.MergeArea.Cells(1, 1).Address Then
            Set nxt = FindInput(cell, False)
            If Not nxt Is Nothing Then nxt.Select
        End If
    End If
End Sub
