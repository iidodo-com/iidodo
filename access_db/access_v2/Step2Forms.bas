Attribute VB_Name = "Step2Forms"
Option Compare Database
Option Explicit

' ============================================================
'  検出事項データベース(Access版 v2) 第2段階: 入力フォームとメニュー
'  ※ 第1段階(Step1_Setup)が済んだデータベースで、1回だけ Step2_BuildForms を実行する。
'  ※ F_input_code.txt を、この .accdb と同じフォルダに置いておく。
' ============================================================

Private Const FONT_NM As String = "Meiryo UI"

Public Sub Step2_BuildForms()
    Dim stp As String, codePath As String, code As String
    On Error GoTo EH

    stp = "前提の確認"
    If Not TableExists("T_検出事項") Or Not TableExists("M_問題点") Then
        MsgBox "T_検出事項 または M_問題点 がありません。先に第1段階(Step1_Setup)を実行してください。", vbExclamation
        Exit Sub
    End If
    codePath = CurrentProject.Path & "\F_input_code.txt"
    If Dir(codePath) = "" Then
        MsgBox "F_input_code.txt が見つかりません。" & vbCrLf & codePath & vbCrLf & _
               "このデータベースと同じフォルダに置いてください。", vbExclamation
        Exit Sub
    End If
    code = ReadUtf8(codePath)

    stp = "入力フォームの作成"
    BuildInputForm code
    stp = "メニューフォームの作成"
    BuildMenu
    stp = "起動フォームの設定"
    SetStartup "F_メニュー"

    MsgBox "第2段階が完了しました。" & vbCrLf & "いったん閉じて開き直すと、メニューが表示されます。", vbInformation
    Exit Sub
EH:
    MsgBox "「" & stp & "」で止まりました。" & vbCrLf & "エラー " & Err.Number & ": " & Err.Description, vbExclamation
End Sub

' ---------------- 部品 ----------------
' ラベル付きのコントロールを作る(ラベルは左の列に置く)
Private Function Mk(frm As Form, ct As Long, nm As String, cap As String, src As String, _
                    x As Long, y As Long, w As Long, h As Long) As Control
    Dim c As Control
    Set c = CreateControl(frm.Name, ct, acDetail, "", src, x, y, w, h)
    c.Name = nm
    On Error Resume Next
    c.FontName = FONT_NM
    c.FontSize = 10
    With c.Controls(0)
        .Caption = cap
        .Left = 300: .Top = y: .Width = 2200: .Height = h
        .FontName = FONT_NM: .FontSize = 10
        .ForeColor = RGB(64, 64, 64)
    End With
    On Error GoTo 0
    Set Mk = c
End Function

Private Sub Heading(frm As Form, nm As String, cap As String, y As Long)
    Dim c As Control
    Set c = CreateControl(frm.Name, acLabel, acDetail, "", "", 300, y, 10000, 300)
    c.Name = nm
    c.Caption = cap
    c.FontName = FONT_NM: c.FontSize = 11: c.FontBold = True
    c.ForeColor = RGB(31, 78, 120)
End Sub

Private Sub SetCombo(c As Control, rowSrc As String, cols As Long, widths As String, bound As Long, limit As Boolean)
    c.RowSourceType = "Table/Query"
    c.RowSource = rowSrc
    c.ColumnCount = cols
    c.ColumnWidths = widths
    c.BoundColumn = bound
    c.LimitToList = limit
End Sub

Private Function MkButton(frm As Form, nm As String, cap As String, x As Long, y As Long, w As Long, primary As Boolean) As Control
    Dim b As Control
    Set b = CreateControl(frm.Name, acCommandButton, acDetail, "", "", x, y, w, 360)
    b.Name = nm
    b.Caption = cap
    b.FontName = FONT_NM: b.FontSize = 10: b.FontBold = primary
    Set MkButton = b
End Function

' ---------------- 入力フォーム ----------------
Private Sub BuildInputForm(code As String)
    Dim frm As Form, oldName As String, c As Control, y As Long, ban As Control

    DeleteForm "F_検出入力"
    Set frm = CreateForm
    oldName = frm.Name
    frm.RecordSource = "T_検出事項"
    frm.DefaultView = 0
    frm.NavigationButtons = True
    frm.RecordSelectors = False
    frm.DividingLines = False
    frm.AutoCenter = True
    frm.Caption = "検出事項 入力"
    frm.Section(acDetail).BackColor = RGB(240, 243, 248)
    frm.HasModule = True

    ' タイトル帯とボタン
    Set ban = CreateControl(frm.Name, acLabel, acDetail, "", "", 0, 0, 10900, 540)
    ban.Name = "lblTitle"
    ban.Caption = "  検出事項 入力"
    ban.FontName = FONT_NM: ban.FontSize = 14: ban.FontBold = True
    ban.BackStyle = 1: ban.BackColor = RGB(31, 78, 120): ban.ForeColor = RGB(255, 255, 255)
    Set c = MkButton(frm, "btnSave", "保存して次へ", 5800, 90, 2000, True)
    Set c = MkButton(frm, "btnDelete", "削除", 7900, 90, 1200, False)
    Set c = MkButton(frm, "btnClose", "閉じる", 9200, 90, 1300, False)

    ' 記録を探す
    y = 700
    Set c = Mk(frm, acComboBox, "cmbFind", "記録を探す", "", 2600, y, 7900, 330)
    SetCombo c, "SELECT 検出ID, 対象局課名, 問題点 FROM Q_検出事項一覧 ORDER BY 検出ID DESC;", 3, "900;3200;5000", 1, False
    c.ListWidth = 9500

    ' 基本情報
    y = 1180: Heading frm, "hd1", "基本情報(登録後も残ります)", y
    y = y + 380
    Set c = Mk(frm, acTextBox, "txtYear", "監査年度(令和)", "監査年度", 2600, y, 900, 330)
    c.DefaultValue = "=Year(Date())-2018"
    y = y + 430
    Set c = Mk(frm, acTextBox, "txtDate", "実地監査年月日", "実地監査年月日", 2600, y, 1700, 330)
    c.Format = "yyyy/mm/dd"
    y = y + 430
    Set c = Mk(frm, acTextBox, "txtDept", "対象局課名 *", "対象局課名", 2600, y, 6000, 330)
    y = y + 430
    Set c = Mk(frm, acComboBox, "cmbGroup", "グループ", "グループID", 2600, y, 2400, 330)
    SetCombo c, "SELECT グループID, グループ名 FROM M_グループ ORDER BY グループID;", 2, "0;2300", 1, True
    y = y + 430
    Set c = Mk(frm, acTextBox, "txtTanto", "担当者", "担当者", 2600, y, 2400, 330)

    ' 問題点の分類
    y = y + 560: Heading frm, "hd2", "問題点の分類(上から順に選択)", y
    y = y + 380
    Set c = Mk(frm, acComboBox, "cmb1", "項目1", "", 2600, y, 7900, 330)
    SetCombo c, "SELECT DISTINCT M.項目1 FROM M_問題点 AS M ORDER BY M.項目1;", 1, "7800", 1, False
    y = y + 430
    Set c = Mk(frm, acComboBox, "cmb2", "項目(2)", "", 2600, y, 7900, 330)
    SetCombo c, "SELECT DISTINCT M.項目2 FROM M_問題点 AS M ORDER BY M.項目2;", 1, "7800", 1, False
    y = y + 430
    Set c = Mk(frm, acComboBox, "cmb3", "項目(3)", "", 2600, y, 7900, 330)
    SetCombo c, "SELECT DISTINCT M.項目3 FROM M_問題点 AS M WHERE M.項目3 Is Not Null ORDER BY M.項目3;", 1, "7800", 1, False
    y = y + 430
    Set c = Mk(frm, acComboBox, "cmbCat", "区分", "", 2600, y, 2400, 330)
    SetCombo c, "SELECT K.区分ID, K.区分名 FROM M_区分 AS K ORDER BY K.区分ID;", 2, "0;2300", 2, False
    y = y + 430
    Set c = Mk(frm, acComboBox, "cmbProb", "問題点 *", "問題点ID", 2600, y, 7900, 330)
    SetCombo c, "SELECT M.問題点ID, M.区分名, M.問題点 FROM M_問題点 AS M ORDER BY M.問題点ID;", 3, "0;1300;6400", 1, True
    c.ListWidth = 8200: c.ListRows = 20

    ' 内容
    y = y + 560: Heading frm, "hd3", "内容", y
    y = y + 380
    Set c = Mk(frm, acTextBox, "txtNaiyo", "内容(要約)", "内容", 2600, y, 7900, 900)
    c.ScrollBars = 2
    y = y + 1000
    Set c = Mk(frm, acTextBox, "txtShosai", "詳細(事例・誤/正・金額)", "詳細", 2600, y, 7900, 1500)
    c.ScrollBars = 2

    ' 対応・その他
    y = y + 1660: Heading frm, "hd4", "対応・その他", y
    y = y + 380
    Set c = Mk(frm, acComboBox, "cmbStatus", "対応状況", "対応状況ID", 2600, y, 4200, 330)
    SetCombo c, "SELECT 対応状況ID, 対応状況名 FROM M_対応状況 ORDER BY 対応状況ID;", 2, "0;4100", 1, True
    y = y + 430
    Set c = Mk(frm, acComboBox, "cmbBiko", "備考区分", "備考区分", 2600, y, 7900, 330)
    SetCombo c, "SELECT 備考区分名 FROM M_備考区分 ORDER BY 備考区分ID;", 1, "7800", 1, False
    y = y + 430
    Set c = Mk(frm, acTextBox, "txtKonkyo", "根拠規定", "根拠規定", 2600, y, 7900, 330)
    y = y + 430
    Set c = Mk(frm, acTextBox, "txtKw", "キーワード(;区切り)", "キーワード", 2600, y, 7900, 330)
    y = y + 430
    Set c = Mk(frm, acCheckBox, "chkShuchi", "全庁周知が必要", "周知要否", 2600, y, 300, 300)

    frm.Section(acDetail).Height = y + 500
    frm.Width = 10900

    ' フォームのコード(既定のOption行などを消してから、全部書き込む)
    If frm.Module.CountOfLines > 0 Then frm.Module.DeleteLines 1, frm.Module.CountOfLines
    frm.Module.InsertText code

    ' イベントの接続(コードを入れた後で行う)
    frm.OnLoad = "[Event Procedure]"
    frm.OnCurrent = "[Event Procedure]"
    frm.BeforeUpdate = "[Event Procedure]"
    frm.AfterUpdate = "[Event Procedure]"
    frm.Controls("cmb1").AfterUpdate = "[Event Procedure]"
    frm.Controls("cmb2").AfterUpdate = "[Event Procedure]"
    frm.Controls("cmb3").AfterUpdate = "[Event Procedure]"
    frm.Controls("cmbCat").AfterUpdate = "[Event Procedure]"
    frm.Controls("cmbFind").AfterUpdate = "[Event Procedure]"
    frm.Controls("btnSave").OnClick = "[Event Procedure]"
    frm.Controls("btnDelete").OnClick = "[Event Procedure]"
    frm.Controls("btnClose").OnClick = "[Event Procedure]"

    DoCmd.Close acForm, oldName, acSaveYes
    DoCmd.Rename "F_検出入力", acForm, oldName
End Sub

' ---------------- メニュー ----------------
Private Sub BuildMenu()
    Dim frm As Form, oldName As String, b As Control, y As Long, i As Long, ban As Control
    Dim caps As Variant, fns As Variant

    caps = Array("検出事項を新規入力", "検出事項を検索・修正", "検出事項一覧を開く", "問題点入力表(集計)を開く", _
                 "グループ名の設定", "問題点マスタを開く", "終了")
    fns = Array("=mnuInput()", "=mnuEdit()", "=mnuList()", "=mnuCross()", "=mnuGroup()", "=mnuMaster()", "=mnuQuit()")

    DeleteForm "F_メニュー"
    Set frm = CreateForm
    oldName = frm.Name
    frm.RecordSource = ""
    frm.NavigationButtons = False
    frm.RecordSelectors = False
    frm.DividingLines = False
    frm.AutoCenter = True
    frm.Caption = "検出事項データベース"
    frm.Section(acDetail).BackColor = RGB(240, 243, 248)

    Set ban = CreateControl(frm.Name, acLabel, acDetail, "", "", 0, 0, 6400, 600)
    ban.Name = "lblTitle"
    ban.Caption = "  検出事項データベース"
    ban.FontName = FONT_NM: ban.FontSize = 15: ban.FontBold = True
    ban.BackStyle = 1: ban.BackColor = RGB(31, 78, 120): ban.ForeColor = RGB(255, 255, 255)

    y = 900
    For i = 0 To UBound(caps)
        Set b = CreateControl(frm.Name, acCommandButton, acDetail, "", "", 600, y, 5200, 520)
        b.Name = "btnM" & i
        b.Caption = caps(i)
        b.FontName = FONT_NM: b.FontSize = 11
        b.OnClick = fns(i)
        y = y + 680
    Next
    frm.Section(acDetail).Height = y + 200
    frm.Width = 6400

    DoCmd.Close acForm, oldName, acSaveYes
    DoCmd.Rename "F_メニュー", acForm, oldName
End Sub

Private Sub SetStartup(nm As String)
    Dim p As DAO.Property
    On Error Resume Next
    CurrentDb.Properties.Delete "StartUpForm"
    On Error GoTo 0
    Set p = CurrentDb.CreateProperty("StartUpForm", dbText, nm)
    CurrentDb.Properties.Append p
End Sub

' ---------------- メニューから呼ぶ関数 ----------------
Public Function mnuInput()
    DoCmd.OpenForm "F_検出入力"
    DoCmd.GoToRecord , , acNewRec
End Function

Public Function mnuEdit()
    DoCmd.OpenForm "F_検出入力"
    DoCmd.GoToRecord , , acLast
End Function

Public Function mnuList()
    DoCmd.OpenQuery "Q_検出事項一覧"
End Function

Public Function mnuCross()
    DoCmd.OpenQuery "Q_問題点入力表"
End Function

Public Function mnuGroup()
    DoCmd.OpenTable "M_グループ"
End Function

Public Function mnuMaster()
    DoCmd.OpenTable "M_問題点"
End Function

Public Function mnuQuit()
    Application.Quit
End Function

' ---------------- 共通 ----------------
Private Sub DeleteForm(nm As String)
    On Error Resume Next
    DoCmd.Close acForm, nm, acSaveNo
    DoCmd.DeleteObject acForm, nm
    On Error GoTo 0
End Sub

Private Function TableExists(nm As String) As Boolean
    Dim t As DAO.TableDef
    For Each t In CurrentDb.TableDefs
        If t.Name = nm Then TableExists = True: Exit Function
    Next
End Function

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
