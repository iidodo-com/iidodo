Attribute VB_Name = "KensyutsuDB"
Option Compare Database
Option Explicit

' ============================================================
'  検出事項データベース 初期構築モジュール
'  使い方: README.md を参照。Setup を 1 回だけ実行する。
' ============================================================

Public Sub Setup()
    Dim db As DAO.Database
    MsgBox "KensyutsuDB v3 の構築を開始します。", vbInformation
    Set db = CurrentDb

    If TableExists("T_検出事項") Then
        MsgBox "既に T_検出事項 が存在します。上書き防止のため中止します。", vbExclamation
        Exit Sub
    End If

    Dim tsv As String
    tsv = CurrentProject.Path & "\m_problem.tsv"
    If Dir(tsv) = "" Then
        MsgBox "m_problem.tsv が見つかりません。" & vbCrLf & tsv & vbCrLf & _
               "このデータベースと同じフォルダに置いてください。", vbExclamation
        Exit Sub
    End If

    CreateTables db
    CreateRelationships db
    LoadMasters db, tsv
    CreateQueries db
    SetupForms

    MsgBox "構築が完了しました。F_メニュー から操作できます。", vbInformation
End Sub

' フォームだけを(再)作成する。既存の F_検出入力 / F_メニュー は削除してから作り直す。
Public Sub SetupForms()
    MsgBox "KensyutsuDB v3 のフォームを作成します。", vbInformation
    On Error Resume Next
    DoCmd.Close acForm, "F_検出入力", acSaveNo
    DoCmd.Close acForm, "F_メニュー", acSaveNo
    DoCmd.DeleteObject acForm, "F_検出入力"
    DoCmd.DeleteObject acForm, "F_メニュー"
    On Error GoTo 0
    BuildInputForm
    BuildMenuForm
    SetStartupForm "F_メニュー"
End Sub

' ---------------- テーブル ----------------
Private Sub CreateTables(db As DAO.Database)
    db.Execute "CREATE TABLE M_区分 (区分ID LONG PRIMARY KEY, 区分名 TEXT(20) NOT NULL)", dbFailOnError
    db.Execute "CREATE TABLE M_グループ (グループID LONG PRIMARY KEY, グループ名 TEXT(30) NOT NULL)", dbFailOnError
    db.Execute "CREATE TABLE M_対応状況 (対応状況ID LONG PRIMARY KEY, 対応状況名 TEXT(100) NOT NULL)", dbFailOnError
    db.Execute "CREATE TABLE M_問題点 (問題点ID LONG PRIMARY KEY, 項目1 TEXT(100), 項目2 TEXT(100), " & _
               "項目3 TEXT(100), 区分名 TEXT(20), 問題点 TEXT(255), 内容説明 TEXT(255), 有効 YESNO)", dbFailOnError
    db.Execute "CREATE TABLE T_検出事項 (検出ID COUNTER PRIMARY KEY, 監査年度 LONG, 実地監査年月日 DATETIME, " & _
               "対象局課名 TEXT(100), グループID LONG, 担当者 TEXT(50), 問題点ID LONG, 件数 LONG, " & _
               "内容 MEMO, 詳細 MEMO, 対応状況ID LONG, 備考区分 TEXT(10), 根拠規定 TEXT(255), " & _
               "キーワード TEXT(255), 周知要否 YESNO, 登録日時 DATETIME)", dbFailOnError
    db.TableDefs.Refresh
End Sub

Private Sub CreateRelationships(db As DAO.Database)
    db.Execute "ALTER TABLE T_検出事項 ADD CONSTRAINT FK_問題点 FOREIGN KEY (問題点ID) REFERENCES M_問題点 (問題点ID)", dbFailOnError
    db.Execute "ALTER TABLE T_検出事項 ADD CONSTRAINT FK_グループ FOREIGN KEY (グループID) REFERENCES M_グループ (グループID)", dbFailOnError
    db.Execute "ALTER TABLE T_検出事項 ADD CONSTRAINT FK_対応状況 FOREIGN KEY (対応状況ID) REFERENCES M_対応状況 (対応状況ID)", dbFailOnError
End Sub

' ---------------- マスタ投入 ----------------
Private Sub LoadMasters(db As DAO.Database, tsv As String)
    Dim v As Variant, i As Long

    v = Array("押印関係", "記載関係", "計算誤り", "書類漏れ", "その他")
    For i = 0 To UBound(v)
        db.Execute "INSERT INTO M_区分 (区分ID, 区分名) VALUES (" & (i + 1) & ", '" & v(i) & "')"
    Next

    ' グループ名は問題点入力表(xls)の列見出しから。年度ごとに M_グループ を編集して使う。
    v = Array("高谷G", "松本G", "川口G", "山口G", "竹下G", "谷本G")
    For i = 0 To UBound(v)
        db.Execute "INSERT INTO M_グループ (グループID, グループ名) VALUES (" & (i + 1) & ", '" & v(i) & "')"
    Next

    ' 対応状況は実地監査報告書・検出事項一覧の記載例から。必要に応じて追加・修正する。
    v = Array("実査当日是正済み(回答不要)", "後日是正済み", "是正後の報告を求めた", _
              "以後適切に処理するよう指導した", "その他")
    For i = 0 To UBound(v)
        db.Execute "INSERT INTO M_対応状況 (対応状況ID, 対応状況名) VALUES (" & (i + 1) & ", '" & v(i) & "')"
    Next

    Dim txt As String, lines() As String, p() As String, rs As DAO.Recordset
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

' ---------------- クエリ ----------------
Private Sub CreateQueries(db As DAO.Database)
    SaveQuery db, "Q_検出事項一覧", _
        "SELECT T.検出ID, T.監査年度, T.実地監査年月日, T.対象局課名, G.グループ名, T.担当者, " & _
        "M.項目1, M.項目2, M.項目3, M.区分名, M.問題点, T.件数, T.内容, T.詳細, " & _
        "S.対応状況名, T.備考区分, T.根拠規定, T.キーワード, T.周知要否, T.グループID, T.問題点ID " & _
        "FROM ((T_検出事項 AS T LEFT JOIN M_問題点 AS M ON T.問題点ID = M.問題点ID) " & _
        "LEFT JOIN M_グループ AS G ON T.グループID = G.グループID) " & _
        "LEFT JOIN M_対応状況 AS S ON T.対応状況ID = S.対応状況ID"

    SaveQuery db, "Q_問題点入力表", CrosstabSql(0)
End Sub

' 年度指定(0=全年度)の問題点入力表(クロス集計)SQL
Public Function CrosstabSql(ByVal fy As Long) As String
    Dim w As String
    If fy > 0 Then w = " WHERE Q.監査年度 = " & fy
    CrosstabSql = "TRANSFORM Sum(Q.件数) AS 件数計 " & _
        "SELECT Q.監査年度, Q.項目1, Q.項目2, Q.項目3, Q.区分名, Q.問題点, Sum(Q.件数) AS 合計 " & _
        "FROM Q_検出事項一覧 AS Q" & w & _
        " GROUP BY Q.監査年度, Q.項目1, Q.項目2, Q.項目3, Q.区分名, Q.問題点 PIVOT Q.グループ名"
End Function

Private Sub SaveQuery(db As DAO.Database, nm As String, sql As String)
    On Error Resume Next
    db.QueryDefs.Delete nm
    On Error GoTo 0
    db.CreateQueryDef nm, sql
End Sub

' ---------------- 入力フォーム ----------------
Private Function AddCtl(frm As Form, ct As Long, nm As String, cap As String, src As String, _
                        ByRef y As Long, h As Long, w As Long) As Control
    Dim c As Control
    Set c = CreateControl(frm.Name, ct, acDetail, "", src, 2600, y, w, h)
    c.Name = nm
    With c.Controls(0)
        .Caption = cap
        .Left = 200
        .Top = y
        .Width = 2300
    End With
    y = y + h + 120
    Set AddCtl = c
End Function

Private Sub BuildInputForm()
    Dim frm As Form, c As Control, y As Long, oldName As String, code As String

    Set frm = CreateForm
    oldName = frm.Name
    frm.RecordSource = "T_検出事項"
    frm.DefaultView = 0
    frm.NavigationButtons = True
    frm.RecordSelectors = False
    frm.Caption = "検出事項入力"
    frm.HasModule = True

    code = FormCode()
    If frm.Module.CountOfLines > 0 Then frm.Module.DeleteLines 1, frm.Module.CountOfLines
    frm.Module.InsertText code

    y = 200
    ' --- 基本情報 ---
    Set c = AddCtl(frm, acTextBox, "txtYear", "監査年度(令和)", "監査年度", y, 330, 1200)
    c.DefaultValue = "=Year(Date())-2018"
    Set c = AddCtl(frm, acTextBox, "txtDate", "実地監査年月日", "実地監査年月日", y, 330, 2000)
    c.Format = "yyyy/mm/dd"
    Set c = AddCtl(frm, acTextBox, "txtDept", "対象局課名", "対象局課名", y, 330, 4500)
    Set c = AddCtl(frm, acComboBox, "cmbGroup", "グループ", "グループID", y, 330, 2500)
    c.RowSourceType = "Table/Query"
    c.RowSource = "SELECT グループID, グループ名 FROM M_グループ ORDER BY グループID;"
    c.ColumnCount = 2: c.ColumnWidths = "0;2400": c.BoundColumn = 1: c.LimitToList = True
    Set c = AddCtl(frm, acTextBox, "txtTanto", "担当者", "担当者", y, 330, 2500)

    ' --- 問題点の選択(絞り込み) ---
    y = y + 200
    Set c = AddCtl(frm, acComboBox, "cmbA", "絞込: 項目1", "", y, 330, 7000)
    c.RowSourceType = "Table/Query": c.LimitToList = False
    Set c = AddCtl(frm, acComboBox, "cmbB", "絞込: 項目(2)", "", y, 330, 7000)
    c.RowSourceType = "Table/Query": c.LimitToList = False
    Set c = AddCtl(frm, acComboBox, "cmbC", "絞込: 項目(3)", "", y, 330, 7000)
    c.RowSourceType = "Table/Query": c.LimitToList = False
    Set c = AddCtl(frm, acComboBox, "cmbProblem", "問題点(必須)", "問題点ID", y, 330, 7000)
    c.RowSourceType = "Table/Query"
    c.ColumnCount = 4: c.ColumnWidths = "0;1500;3800;3000": c.ListWidth = 9000
    c.BoundColumn = 1: c.LimitToList = True: c.ListRows = 20

    ' --- 内容 ---
    Set c = AddCtl(frm, acTextBox, "txtCount", "件数", "件数", y, 330, 1000)
    c.DefaultValue = "1"
    Set c = AddCtl(frm, acTextBox, "txtNaiyo", "内容(要約)", "内容", y, 900, 7000)
    c.ScrollBars = 2
    Set c = AddCtl(frm, acTextBox, "txtShosai", "詳細(事例・誤/正・金額等)", "詳細", y, 1800, 7000)
    c.ScrollBars = 2
    Set c = AddCtl(frm, acComboBox, "cmbStatus", "対応状況", "対応状況ID", y, 330, 4000)
    c.RowSourceType = "Table/Query"
    c.RowSource = "SELECT 対応状況ID, 対応状況名 FROM M_対応状況 ORDER BY 対応状況ID;"
    c.ColumnCount = 2: c.ColumnWidths = "0;3900": c.BoundColumn = 1: c.LimitToList = True
    Set c = AddCtl(frm, acTextBox, "txtBiko", "備考区分(①②③)", "備考区分", y, 330, 1500)
    Set c = AddCtl(frm, acTextBox, "txtKonkyo", "根拠規定", "根拠規定", y, 330, 7000)
    Set c = AddCtl(frm, acTextBox, "txtKw", "キーワード(;区切り)", "キーワード", y, 330, 7000)
    Set c = AddCtl(frm, acCheckBox, "chkShuchi", "全庁周知の要否", "周知要否", y, 300, 300)

    frm.Section(acDetail).Height = y + 300
    frm.Width = 10000

    frm.OnLoad = "[Event Procedure]"
    frm.OnCurrent = "[Event Procedure]"
    frm.BeforeUpdate = "[Event Procedure]"
    Controls_Wire frm

    DoCmd.Close acForm, oldName, acSaveYes
    DoCmd.Rename "F_検出入力", acForm, oldName
End Sub

Private Sub Controls_Wire(frm As Form)
    frm.Controls("cmbA").AfterUpdate = "[Event Procedure]"
    frm.Controls("cmbB").AfterUpdate = "[Event Procedure]"
    frm.Controls("cmbC").AfterUpdate = "[Event Procedure]"
End Sub

' フォームに埋め込むイベントコード(` は二重引用符に置換)
Private Function FormCode() As String
    Dim s As String
    s = "Option Compare Database" & vbCrLf & "Option Explicit" & vbCrLf & vbCrLf
    s = s & "Private Function Esc(ByVal t As String) As String" & vbCrLf
    s = s & "    Esc = Replace(t, `'`, `''`)" & vbCrLf
    s = s & "End Function" & vbCrLf & vbCrLf
    s = s & "Private Sub RefreshLists()" & vbCrLf
    s = s & "    Dim a As String, b As String, c As String, w As String" & vbCrLf
    s = s & "    a = Nz(Me.cmbA, ``): b = Nz(Me.cmbB, ``): c = Nz(Me.cmbC, ``)" & vbCrLf
    s = s & "    w = `有効 = True`" & vbCrLf
    s = s & "    If a <> `` Then w = w & ` AND 項目1 = '` & Esc(a) & `'`" & vbCrLf
    s = s & "    Me.cmbA.RowSource = `SELECT DISTINCT 項目1 FROM M_問題点 WHERE 有効 = True ORDER BY 項目1;`" & vbCrLf
    s = s & "    Me.cmbB.RowSource = `SELECT DISTINCT 項目2 FROM M_問題点 WHERE ` & w & ` ORDER BY 項目2;`" & vbCrLf
    s = s & "    If b <> `` Then w = w & ` AND 項目2 = '` & Esc(b) & `'`" & vbCrLf
    s = s & "    Me.cmbC.RowSource = `SELECT DISTINCT 項目3 FROM M_問題点 WHERE ` & w & ` AND 項目3 Is Not Null ORDER BY 項目3;`" & vbCrLf
    s = s & "    If c <> `` Then w = w & ` AND 項目3 = '` & Esc(c) & `'`" & vbCrLf
    s = s & "    Me.cmbProblem.RowSource = `SELECT 問題点ID, 区分名, 問題点, 内容説明 FROM M_問題点 WHERE ` & w & ` ORDER BY 区分名, 問題点ID;`" & vbCrLf
    s = s & "End Sub" & vbCrLf & vbCrLf
    s = s & "Private Sub Form_Load()" & vbCrLf & "    RefreshLists" & vbCrLf & "End Sub" & vbCrLf & vbCrLf
    s = s & "Private Sub Form_Current()" & vbCrLf
    s = s & "    If Not IsNull(Me.cmbProblem) Then" & vbCrLf
    s = s & "        Me.cmbA = DLookup(`項目1`, `M_問題点`, `問題点ID = ` & Me.cmbProblem)" & vbCrLf
    s = s & "        Me.cmbB = DLookup(`項目2`, `M_問題点`, `問題点ID = ` & Me.cmbProblem)" & vbCrLf
    s = s & "        Me.cmbC = DLookup(`項目3`, `M_問題点`, `問題点ID = ` & Me.cmbProblem)" & vbCrLf
    s = s & "    Else" & vbCrLf
    s = s & "        Me.cmbA = Null: Me.cmbB = Null: Me.cmbC = Null" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "    RefreshLists" & vbCrLf & "End Sub" & vbCrLf & vbCrLf
    s = s & "Private Sub cmbA_AfterUpdate()" & vbCrLf
    s = s & "    Me.cmbB = Null: Me.cmbC = Null: RefreshLists" & vbCrLf & "End Sub" & vbCrLf & vbCrLf
    s = s & "Private Sub cmbB_AfterUpdate()" & vbCrLf
    s = s & "    Me.cmbC = Null: RefreshLists" & vbCrLf & "End Sub" & vbCrLf & vbCrLf
    s = s & "Private Sub cmbC_AfterUpdate()" & vbCrLf & "    RefreshLists" & vbCrLf & "End Sub" & vbCrLf & vbCrLf
    s = s & "Private Sub Form_BeforeUpdate(Cancel As Integer)" & vbCrLf
    s = s & "    If IsNull(Me.cmbProblem) Then" & vbCrLf
    s = s & "        MsgBox `問題点を選択してください。`, vbExclamation" & vbCrLf
    s = s & "        Cancel = True: Exit Sub" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "    Me![登録日時] = Now" & vbCrLf & "End Sub" & vbCrLf
    FormCode = Replace(s, "`", Chr(34))
End Function

' ---------------- メニュー ----------------
Private Sub BuildMenuForm()
    Dim frm As Form, c As Control, y As Long, oldName As String, i As Long
    Dim caps As Variant, fns As Variant

    caps = Array("検出事項を新規入力", "検出事項一覧を開く(絞込・並替可)", "キーワード検索", _
                 "復命用 検出事項一覧をExcel出力", "問題点入力表(集計)をExcel出力")
    fns = Array("=OpenInput()", "=OpenList()", "=OpenSearch()", "=ExportList()", "=ExportCrosstab()")

    Set frm = CreateForm
    oldName = frm.Name
    frm.Caption = "検出事項データベース"
    frm.NavigationButtons = False
    frm.RecordSelectors = False
    frm.RecordSource = ""
    y = 300
    For i = 0 To UBound(caps)
        Set c = CreateControl(frm.Name, acCommandButton, acDetail, "", "", 400, y, 6000, 600)
        c.Caption = caps(i)
        c.OnClick = fns(i)
        y = y + 800
    Next
    frm.Section(acDetail).Height = y + 200
    frm.Width = 6800
    DoCmd.Close acForm, oldName, acSaveYes
    DoCmd.Rename "F_メニュー", acForm, oldName
End Sub

Private Sub SetStartupForm(nm As String)
    Dim p As DAO.Property
    On Error Resume Next
    CurrentDb.Properties.Delete "StartUpForm"
    On Error GoTo 0
    Set p = CurrentDb.CreateProperty("StartUpForm", dbText, nm)
    CurrentDb.Properties.Append p
End Sub

' ---------------- メニューから呼ぶ関数 ----------------
Public Function OpenInput()
    DoCmd.OpenForm "F_検出入力"
    DoCmd.GoToRecord , , acNewRec
End Function

Public Function OpenList()
    DoCmd.OpenQuery "Q_検出事項一覧"
End Function

Public Function OpenSearch()
    Dim kw As String, k As String, sql As String
    kw = InputBox("検索するキーワードを入力してください" & vbCrLf & "(問題点・内容・詳細・キーワードを対象)", "キーワード検索")
    If Len(kw) = 0 Then Exit Function
    k = Replace(Replace(kw, "'", "''"), "*", "")
    sql = "SELECT * FROM Q_検出事項一覧 WHERE 問題点 Like '*" & k & "*' OR 内容 Like '*" & k & "*' " & _
          "OR 詳細 Like '*" & k & "*' OR キーワード Like '*" & k & "*' ORDER BY 監査年度 DESC, 検出ID"
    SaveQuery CurrentDb, "Q_検索結果", sql
    DoCmd.OpenQuery "Q_検索結果"
End Function

' 復命用「検出事項一覧」: 課名・項目・問題点(件数)・備考・詳細・対応状況・区分・担当
Public Function ExportList()
    Dim fy As Long, sql As String, f As String
    fy = AskYear()
    If fy = 0 Then Exit Function
    sql = "SELECT 対象局課名 AS 課名等, 項目2 & IIf(IsNull(項目3), '', ' ' & 項目3) AS 項目, " & _
          "問題点 & '(' & 件数 & '件)' AS [問題点(件数)], 備考区分 AS 備考, 詳細, " & _
          "対応状況名 AS 対応状況, 区分名 AS 問題点区分, 担当者 AS 担当 " & _
          "FROM Q_検出事項一覧 WHERE 監査年度 = " & fy & " ORDER BY 対象局課名, 検出ID"
    SaveQuery CurrentDb, "Q_出力_検出事項一覧", sql
    f = CurrentProject.Path & "\検出事項一覧_R" & fy & ".xlsx"
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Q_出力_検出事項一覧", f, True
    MsgBox "出力しました: " & f, vbInformation
End Function

' 問題点入力表: 問題点 x グループ のクロス集計
Public Function ExportCrosstab()
    Dim fy As Long, f As String
    fy = AskYear()
    If fy = 0 Then Exit Function
    SaveQuery CurrentDb, "Q_出力_問題点入力表", CrosstabSql(fy)
    f = CurrentProject.Path & "\問題点入力表_R" & fy & ".xlsx"
    DoCmd.TransferSpreadsheet acExport, acSpreadsheetTypeExcel12Xml, "Q_出力_問題点入力表", f, True
    MsgBox "出力しました: " & f, vbInformation
End Function

Private Function AskYear() As Long
    Dim s As String
    s = InputBox("出力する監査年度(令和 何年度か。例: 8)を入力してください", "年度指定", CStr(Year(Date) - 2018))
    If IsNumeric(s) Then AskYear = CLng(s) Else AskYear = 0
End Function

' ---------------- 共通 ----------------
Private Function TableExists(nm As String) As Boolean
    Dim t As DAO.TableDef
    For Each t In CurrentDb.TableDefs
        If t.Name = nm Then TableExists = True: Exit Function
    Next
End Function
