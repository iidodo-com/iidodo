Attribute VB_Name = "Step1Tables"
Option Compare Database
Option Explicit

' ============================================================
'  検出事項データベース(Access版 v2) 第1段階: テーブルとマスタ
'  ※ 空の新しい .accdb で、1回だけ Step1_Setup を実行する。
'  ※ m_problem.tsv を、この .accdb と同じフォルダに置いておく。
' ============================================================

Public Sub Step1_Setup()
    Dim db As DAO.Database, stp As String, tsv As String
    On Error GoTo EH

    Set db = CurrentDb
    stp = "事前確認"
    If TableExists(db, "T_検出事項") Or TableExists(db, "M_問題点") Then
        MsgBox "既にテーブルがあります。空の新しいデータベースで実行してください。", vbExclamation
        Exit Sub
    End If
    tsv = CurrentProject.Path & "\m_problem.tsv"
    If Dir(tsv) = "" Then
        MsgBox "m_problem.tsv が見つかりません。" & vbCrLf & tsv & vbCrLf & _
               "このデータベースと同じフォルダに置いてください。", vbExclamation
        Exit Sub
    End If

    stp = "マスタ用テーブルの作成"
    db.Execute "CREATE TABLE M_区分 (区分ID LONG PRIMARY KEY, 区分名 TEXT(20) NOT NULL)", dbFailOnError
    db.Execute "CREATE TABLE M_グループ (グループID LONG PRIMARY KEY, グループ名 TEXT(30) NOT NULL)", dbFailOnError
    db.Execute "CREATE TABLE M_対応状況 (対応状況ID LONG PRIMARY KEY, 対応状況名 TEXT(100) NOT NULL)", dbFailOnError
    db.Execute "CREATE TABLE M_備考区分 (備考区分ID LONG PRIMARY KEY, 備考区分名 TEXT(100) NOT NULL)", dbFailOnError
    db.Execute "CREATE TABLE M_問題点 (問題点ID LONG PRIMARY KEY, 項目1 TEXT(100), 項目2 TEXT(100), " & _
               "項目3 TEXT(100), 区分名 TEXT(20), 問題点 TEXT(255), 内容説明 TEXT(255), 有効 YESNO)", dbFailOnError

    stp = "検出事項テーブルの作成"
    db.Execute "CREATE TABLE T_検出事項 (検出ID COUNTER PRIMARY KEY, 監査年度 LONG, 実地監査年月日 DATETIME, " & _
               "対象局課名 TEXT(100), グループID LONG, 担当者 TEXT(50), 問題点ID LONG, " & _
               "内容 MEMO, 詳細 MEMO, 対応状況ID LONG, 備考区分 TEXT(100), 根拠規定 TEXT(255), " & _
               "キーワード TEXT(255), 周知要否 YESNO, 登録者 TEXT(50), 登録日時 DATETIME)", dbFailOnError
    db.TableDefs.Refresh

    stp = "小さなマスタの投入"
    LoadSmallMasters db

    stp = "問題点マスタの投入(2,035件)"
    LoadProblems db, tsv

    stp = "クエリの作成"
    CreateQueries db

    MsgBox "第1段階が完了しました。" & vbCrLf & vbCrLf & _
           "次に、イミディエイトウィンドウで Step1_Check を実行して、件数を確認してください。" & vbCrLf & _
           "(リレーションは、確認後の第2段階で設定します)", vbInformation
    Exit Sub

EH:
    MsgBox "「" & stp & "」で止まりました。" & vbCrLf & "エラー " & Err.Number & ": " & Err.Description, vbExclamation
End Sub

' 件数の確認(結果をメッセージで表示)
Public Sub Step1_Check()
    Dim s As String, t As Variant
    For Each t In Array("M_区分", "M_グループ", "M_対応状況", "M_備考区分", "M_問題点", "T_検出事項")
        s = s & t & ": " & DCount("*", CStr(t)) & " 件" & vbCrLf
    Next
    s = s & vbCrLf & "(期待値: M_区分 5 / M_グループ 6 / M_対応状況 5 / M_備考区分 3 / M_問題点 2035 / T_検出事項 0)"
    MsgBox s, vbInformation, "第1段階の確認"
End Sub

Private Sub LoadSmallMasters(db As DAO.Database)
    Dim v As Variant, i As Long
    v = Array("押印関係", "記載関係", "計算誤り", "書類漏れ", "その他")
    For i = 0 To UBound(v): db.Execute "INSERT INTO M_区分 (区分ID, 区分名) VALUES (" & (i + 1) & ", '" & v(i) & "')", dbFailOnError: Next
    ' グループ名は問題点入力表(xls)の列見出しより。年度ごとに M_グループ を編集して使う。
    v = Array("高谷G", "松本G", "川口G", "山口G", "竹下G", "谷本G")
    For i = 0 To UBound(v): db.Execute "INSERT INTO M_グループ (グループID, グループ名) VALUES (" & (i + 1) & ", '" & v(i) & "')", dbFailOnError: Next
    v = Array("実査当日是正済み(回答不要)", "後日是正済み", "是正後の報告を求めた", "以後適切に処理するよう指導した", "その他")
    For i = 0 To UBound(v): db.Execute "INSERT INTO M_対応状況 (対応状況ID, 対応状況名) VALUES (" & (i + 1) & ", '" & v(i) & "')", dbFailOnError: Next
    v = Array("①是正に際し金銭の動きがあった", "②是正はできないが同種の事務が今後も想定される", "③その他特記事項")
    For i = 0 To UBound(v): db.Execute "INSERT INTO M_備考区分 (備考区分ID, 備考区分名) VALUES (" & (i + 1) & ", '" & v(i) & "')", dbFailOnError: Next
End Sub

Private Sub LoadProblems(db As DAO.Database, tsv As String)
    Dim txt As String, lines() As String, p() As String, rs As DAO.Recordset, i As Long
    txt = ReadUtf8(tsv)
    lines = Split(Replace(txt, vbCr, ""), vbLf)
    Set rs = db.OpenRecordset("M_問題点", dbOpenDynaset)
    DBEngine.Workspaces(0).BeginTrans
    For i = 1 To UBound(lines)
        If Len(lines(i)) > 0 Then
            p = Split(lines(i), vbTab)
            If UBound(p) >= 5 Then
                rs.AddNew
                rs!問題点ID = CLng(p(0))
                If Len(p(1)) > 0 Then rs!項目1 = p(1)
                If Len(p(2)) > 0 Then rs!項目2 = p(2)
                If Len(p(3)) > 0 Then rs!項目3 = p(3)
                If Len(p(4)) > 0 Then rs!区分名 = p(4)
                rs!問題点 = p(5)
                If UBound(p) >= 6 Then
                    If Len(p(6)) > 0 Then rs!内容説明 = p(6)
                End If
                rs!有効 = True
                rs.Update
            End If
        End If
    Next
    DBEngine.Workspaces(0).CommitTrans
    rs.Close
End Sub

Private Function ReadUtf8(path As String) As String
    Dim st As Object
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2
    st.Charset = "utf-8"
    st.Open
    st.LoadFromFile path
    ReadUtf8 = st.ReadText
    st.Close
End Function

Private Sub CreateQueries(db As DAO.Database)
    SaveQuery db, "Q_検出事項一覧", _
        "SELECT T.検出ID, T.監査年度, T.実地監査年月日, T.対象局課名, G.グループ名, T.担当者, " & _
        "M.項目1, M.項目2, M.項目3, M.区分名, M.問題点, T.内容, T.詳細, " & _
        "S.対応状況名, T.備考区分, T.根拠規定, T.キーワード, T.周知要否, T.登録者, T.登録日時, T.グループID, T.問題点ID " & _
        "FROM ((T_検出事項 AS T LEFT JOIN M_問題点 AS M ON T.問題点ID = M.問題点ID) " & _
        "LEFT JOIN M_グループ AS G ON T.グループID = G.グループID) " & _
        "LEFT JOIN M_対応状況 AS S ON T.対応状況ID = S.対応状況ID"
    ' 問題点入力表: 問題点 x グループ の件数(1問題点=1件なので行数を数える)
    SaveQuery db, "Q_問題点入力表", _
        "TRANSFORM Count(Q.検出ID) AS 件数 " & _
        "SELECT Q.監査年度, Q.項目1, Q.項目2, Q.項目3, Q.区分名, Q.問題点, Count(Q.検出ID) AS 合計 " & _
        "FROM Q_検出事項一覧 AS Q " & _
        "GROUP BY Q.監査年度, Q.項目1, Q.項目2, Q.項目3, Q.区分名, Q.問題点 PIVOT Q.グループ名"
End Sub

Private Sub SaveQuery(db As DAO.Database, nm As String, sql As String)
    On Error Resume Next
    db.QueryDefs.Delete nm
    On Error GoTo 0
    db.CreateQueryDef nm, sql
End Sub

Private Function TableExists(db As DAO.Database, nm As String) As Boolean
    Dim t As DAO.TableDef
    For Each t In db.TableDefs
        If t.Name = nm Then TableExists = True: Exit Function
    Next
End Function
