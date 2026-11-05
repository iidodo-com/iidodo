Attribute VB_Name = "AccessRefresh"
Option Explicit

' ============================================================
'  Excel側: Access(データ本体)から検出事項を読み込み、「入力」シートに反映する(読み取り専用)
'  使い方:
'    1. SetAccessPath で、データ本体(バックエンド .accdb)を選ぶ(最初の1回)
'    2. 復命用一覧の C2 に年度を入れる
'    3. RefreshFromAccess を実行 → 別紙・復命用一覧・問題点入力表が最新になる
'  ※ Accessから読み込む運用では、「入力」シートへ直接入力しない(更新のたびに置き換わります)。
' ============================================================

Private Const SET_SHEET As String = "M_設定"
Private Const IN_SHEET As String = "入力"
Private Const MAX_ROWS As Long = 2000

' Accessファイル(データ本体)の場所を指定する
Public Sub SetAccessPath()
    Dim fd As Object, ws As Worksheet
    Set ws = ThisWorkbook.Worksheets(SET_SHEET)
    Set fd = Application.FileDialog(3)
    With fd
        .Title = "データ本体(バックエンド)の Access ファイルを選択してください"
        .Filters.Clear
        .Filters.Add "Access データベース", "*.accdb;*.mdb"
        .AllowMultiSelect = False
        If .Show <> -1 Then Exit Sub
        ws.Range("K1").Value = "Accessデータ本体のパス"
        ws.Range("K2").Value = .SelectedItems(1)
    End With
    MsgBox "設定しました。続けて RefreshFromAccess を実行してください。", vbInformation
End Sub

Private Function S(ByVal x As Variant) As Variant
    If IsNull(x) Then S = "" Else S = x
End Function

' Accessから読み込んで「入力」シートへ反映する
Public Sub RefreshFromAccess()
    Dim cn As Object, rs As Object, ws As Worksheet, path As String, fy As Variant, sql As String
    Dim v As Variant, n As Long, i As Long, j As Long, stp As String
    Dim a1() As Variant, a2() As Variant

    On Error GoTo EH
    stp = "設定の確認"
    path = CStr(ThisWorkbook.Worksheets(SET_SHEET).Range("K2").Value)
    If Len(path) = 0 Then MsgBox "先に SetAccessPath で Access ファイルを指定してください。", vbExclamation: Exit Sub
    If Dir(path) = "" Then MsgBox "Access ファイルが見つかりません:" & vbCrLf & path, vbExclamation: Exit Sub
    fy = ThisWorkbook.Worksheets("復命用一覧").Range("C2").Value
    If Not IsNumeric(fy) Or IsEmpty(fy) Then MsgBox "復命用一覧の C2(監査年度)に数字を入れてください。", vbExclamation: Exit Sub

    stp = "Accessへの接続"
    Set cn = CreateObject("ADODB.Connection")
    cn.Open "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=" & path & ";Mode=Read;Persist Security Info=False;"

    stp = "データの読み込み"
    sql = "SELECT 監査年度, 実地監査年月日, 対象局課名, グループ名, 担当者, 項目1, 項目2, 項目3, 区分名, 問題点, " & _
          "内容, 詳細, 対応状況名, 備考区分, 根拠規定, キーワード, 周知要否 " & _
          "FROM Q_検出事項一覧 WHERE 監査年度 = " & CLng(fy) & " ORDER BY 実地監査年月日, 検出ID"
    Set rs = CreateObject("ADODB.Recordset")
    rs.Open sql, cn, 0, 1

    stp = "入力シートの更新"
    Set ws = ThisWorkbook.Worksheets(IN_SHEET)
    Application.ScreenUpdating = False
    ws.Range("B2:K" & (MAX_ROWS + 1)).ClearContents
    ws.Range("M2:S" & (MAX_ROWS + 1)).ClearContents

    If rs.EOF Then
        MsgBox "令和" & fy & "年度のデータはありません。", vbInformation
    Else
        v = rs.GetRows                      ' v(列, 行)
        n = UBound(v, 2) + 1
        If n > MAX_ROWS Then
            MsgBox n & " 件ありますが、先頭の " & MAX_ROWS & " 件までを反映します。", vbExclamation
            n = MAX_ROWS
        End If
        ReDim a1(1 To n, 1 To 10)
        ReDim a2(1 To n, 1 To 7)
        For i = 1 To n
            For j = 1 To 10: a1(i, j) = S(v(j - 1, i - 1)): Next
            For j = 1 To 6: a2(i, j) = S(v(j + 9, i - 1)): Next
            If IsNull(v(16, i - 1)) Then
                a2(i, 7) = ""
            ElseIf v(16, i - 1) Then
                a2(i, 7) = "要"
            Else
                a2(i, 7) = "不要"
            End If
        Next
        ws.Range("B2").Resize(n, 10).Value = a1
        ws.Range("M2").Resize(n, 7).Value = a2
        Application.Calculate
        MsgBox "令和" & fy & "年度の " & n & " 件を反映しました。", vbInformation
    End If

    rs.Close: cn.Close
    Application.ScreenUpdating = True
    Exit Sub

EH:
    Application.ScreenUpdating = True
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    If Not cn Is Nothing Then cn.Close
    MsgBox "「" & stp & "」で止まりました。" & vbCrLf & "エラー: " & Err.Description & vbCrLf & vbCrLf & _
           "(接続でのエラーなら、Access データベース エンジン(ACE)が入っているか、" & vbCrLf & _
           " Excel と Office の32ビット/64ビットが合っているかを確認してください)", vbExclamation
End Sub
