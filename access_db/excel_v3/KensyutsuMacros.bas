Attribute VB_Name = "KensyutsuMacros"
Option Explicit

' ============================================================
'  検出事項データベース(Excel版 v3) マクロ集(フォームのコードを内蔵)
'   InstallForm     入力フォームを(再)作成する。このファイルをインポートして1回実行する
'   ExportFormCode  (InstallForm が失敗するとき用)フォームのコードをテキストファイルに書き出す
'   OpenInputForm   入力フォームを開く
'   SetShortcut     Ctrl+Shift+I で入力フォームを開けるようにする(任意)
'   FitBesshiRows   別紙(復命用)の行を整える(空き行を隠し、行の高さを原本の規則に揃える)
'
'  前提(InstallForm のみ):
'   ファイル→オプション→トラストセンター→トラストセンターの設定→マクロの設定
'   「VBA プロジェクト オブジェクト モデルへのアクセスを信頼する」にチェック
' ============================================================

' フォームのコード全体(各 FCn 関数に分割して内蔵)
Private Function FormCodeText() As String
    FormCodeText = FC1() & FC2() & FC3() & FC4() & FC5() & FC6() & FC7() & FC8()
End Function

' 入力フォーム(UserForm: frmInput)を作成する。既にあれば作り直す。
Public Sub InstallForm()
    Dim vbp As Object, vbc As Object, s As String, stp As String
    On Error GoTo EH

    stp = "VBAプロジェクトへのアクセス"
    Set vbp = ThisWorkbook.VBProject

    stp = "既存の frmInput の削除"
    Set vbc = Nothing
    On Error Resume Next
    Set vbc = vbp.VBComponents("frmInput")
    On Error GoTo EH
    If Not vbc Is Nothing Then vbp.VBComponents.Remove vbc

    stp = "フォームの追加"
    Set vbc = vbp.VBComponents.Add(3)          ' 3 = UserForm

    stp = "フォーム名の設定(frmInput)"
    vbc.Name = "frmInput"

    stp = "コードの組み立て"
    s = FormCodeText()

    stp = "既存コードの消去"
    If vbc.CodeModule.CountOfLines > 0 Then vbc.CodeModule.DeleteLines 1, vbc.CodeModule.CountOfLines

    stp = "コードの書き込み"
    vbc.CodeModule.AddFromString s

    MsgBox "入力フォームを作成しました。" & vbCrLf & "続けて OpenInputForm を実行すると、入力画面が開きます。", vbInformation
    Exit Sub

EH:
    MsgBox "「" & stp & "」で止まりました。" & vbCrLf & _
           "エラー " & Err.Number & " (&H" & Hex(Err.Number) & "): " & Err.Description & vbCrLf & vbCrLf & _
           "続けて ExportFormCode を実行すると、コードをテキストファイルに書き出せます(手動で貼り付ける方法)。", vbExclamation
End Sub

' InstallForm が使えないとき用: フォームのコードを frmInput_code.txt に書き出す。
' 書き出したら、VBE で「挿入→ユーザーフォーム」を作り、オブジェクト名を frmInput にして、
' コード表示(F7)にファイルの中身を全部貼り付ける。
Public Sub ExportFormCode()
    Dim p As String, st As Object
    On Error GoTo EH
    p = ThisWorkbook.Path
    If Len(p) = 0 Then p = CurDir
    p = p & "\frmInput_code.txt"
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2
    st.Charset = "utf-8"
    st.Open
    st.WriteText FormCodeText()
    st.SaveToFile p, 2
    st.Close
    MsgBox "書き出しました:" & vbCrLf & p, vbInformation
    Exit Sub
EH:
    MsgBox "書き出せませんでした: " & Err.Description, vbExclamation
End Sub

' 入力フォームを開く(モードレス: シートを見ながら入力できる)
Public Sub OpenInputForm()
    Dim f As Object
    Set f = VBA.UserForms.Add("frmInput")
    f.Show vbModeless
End Sub

' 任意: Ctrl+Shift+I で入力フォームを開けるようにする(Excelを閉じると解除)
Public Sub SetShortcut()
    Application.OnKey "^+I", "OpenInputForm"
    MsgBox "Ctrl+Shift+I で入力フォームを開けます。", vbInformation
End Sub

' 別紙(復命用)の行を整える。
'  ・データのある行と合計行だけを表示し、空き行は隠す
'  ・行の高さを、原本の規則(内容の行数に応じて 28/30/40/55/65/77)に揃える
' 絞り込み(復命用一覧の C2/C3)を変えたあとに実行する。
Public Sub FitBesshiRows()
    Const SHEET_NAME As String = "別紙(復命用)"
    Const FIRST_ROW As Long = 9
    Const LAST_ROW As Long = 158
    Dim ws As Worksheet, r As Long, h As Double, steps As Variant, i As Long, hasData As Boolean, isTotal As Boolean

    On Error GoTo EH
    Set ws = ThisWorkbook.Worksheets(SHEET_NAME)
    steps = Array(28, 30, 40, 55, 65, 77)
    Application.ScreenUpdating = False

    For r = FIRST_ROW To LAST_ROW
        hasData = (CStr(ws.Cells(r, 1).Value) <> "")
        isTotal = (Not hasData) And (CStr(ws.Cells(r, 9).Value) <> "")
        If hasData Or isTotal Then
            ws.Rows(r).Hidden = False
            ws.Rows(r).AutoFit
            h = ws.Rows(r).RowHeight
            If isTotal Then
                ws.Rows(r).RowHeight = 22.5
            Else
                For i = 0 To UBound(steps)
                    If h <= steps(i) Then ws.Rows(r).RowHeight = steps(i): Exit For
                Next
            End If
        Else
            ws.Rows(r).Hidden = True
        End If
    Next
    Application.ScreenUpdating = True
    MsgBox "別紙の行を整えました。", vbInformation
    Exit Sub
EH:
    Application.ScreenUpdating = True
    MsgBox "整えられませんでした: " & Err.Description, vbExclamation
End Sub

Private Function FC1() As String
    Dim s As String
    s = s & "Option Explicit" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ============================================================" & vbCrLf
    s = s & "'  検出事項 入力フォーム(UserForm 名: frmInput) v3" & vbCrLf
    s = s & "'  ・所属: 部局 → 局 → 部 → 課 / 分類: 項目1 → (2) → (3) → 区分 → 問題点" & vbCrLf
    s = s & "'  ・No.を入力して「読込」すると、その行を修正できる" & vbCrLf
    s = s & "'  コントロールは実行時に作成する(フォーム自体は空のままでよい)。" & vbCrLf
    s = s & "' ============================================================" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private WithEvents cmbD As MSForms.ComboBox" & vbCrLf
    s = s & "Private WithEvents cmbE As MSForms.ComboBox" & vbCrLf
    s = s & "Private WithEvents cmbF As MSForms.ComboBox" & vbCrLf
    s = s & "Private WithEvents cmb1 As MSForms.ComboBox" & vbCrLf
    s = s & "Private WithEvents cmb2 As MSForms.ComboBox" & vbCrLf
    s = s & "Private WithEvents cmb3 As MSForms.ComboBox" & vbCrLf
    s = s & "Private WithEvents cmbCat As MSForms.ComboBox" & vbCrLf
    s = s & "Private WithEvents btnReg As MSForms.CommandButton" & vbCrLf
    s = s & "Private WithEvents btnNew As MSForms.CommandButton" & vbCrLf
    s = s & "Private WithEvents btnDel As MSForms.CommandButton" & vbCrLf
    s = s & "Private WithEvents btnClose As MSForms.CommandButton" & vbCrLf
    s = s & "Private WithEvents btnLoad As MSForms.CommandButton" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private txtNo As MSForms.TextBox" & vbCrLf
    s = s & "Private txtYear As MSForms.TextBox" & vbCrLf
    s = s & "Private txtDate As MSForms.TextBox" & vbCrLf
    s = s & "Private txtTanto As MSForms.TextBox" & vbCrLf
    s = s & "Private cmbGroup As MSForms.ComboBox" & vbCrLf
    s = s & "Private cmbG As MSForms.ComboBox" & vbCrLf
    s = s & "Private cmbProb As MSForms.ComboBox" & vbCrLf
    s = s & "Private txtNaiyo As MSForms.TextBox" & vbCrLf
    s = s & "Private txtShosai As MSForms.TextBox" & vbCrLf
    s = s & "Private cmbStatus As MSForms.ComboBox" & vbCrLf
    s = s & "Private cmbBiko As MSForms.ComboBox" & vbCrLf
    s = s & "Private txtKonkyo As MSForms.TextBox" & vbCrLf
    s = s & "Private txtKw As MSForms.TextBox" & vbCrLf
    s = s & "Private chkShuchi As MSForms.CheckBox" & vbCrLf
    s = s & "Private lblMsg As MSForms.Label" & vbCrLf
    s = s & "Private lblMode As MSForms.Label" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private busy As Boolean" & vbCrLf
    s = s & "Private mRow As Long                        ' 0=新規入力 / それ以外=修正中の行" & vbCrLf
    s = s & "Private Const ROW_LAST As Long = 2001       ' 入力シートの最終行" & vbCrLf
    s = s & "Private Const FONT_NAME As String = ""Meiryo UI""" & vbCrLf
    s = s & "Private Const FONT_SIZE As Single = 10" & vbCrLf
    s = s & "' リストシートのキー列(キー列の右隣が値の列)" & vbCrLf
    s = s & "Private Const KC_E As Long = 17             ' 局   (キー=部局)" & vbCrLf
    s = s & "Private Const KC_F As Long = 20             ' 部   (キー=部局|局)" & vbCrLf
    s = s & "Private Const KC_G As Long = 23             ' 課   (キー=部局|局|部)" & vbCrLf
    s = s & "Private Const KC_2 As Long = 3              ' 項目2 (キー=項目1)" & vbCrLf
    s = s & "Private Const KC_3 As Long = 6              ' 項目3 (キー=項目1|項目2)" & vbCrLf
    s = s & "Private Const KC_C As Long = 9              ' 区分  (キー=項目1|項目2|項目3)" & vbCrLf
    s = s & "Private Const KC_P As Long = 12             ' 問題点(キー=項目1|項目2|項目3|区分)" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ---------- 部品作成(parent はフォームまたはフレーム) ----------" & vbCrLf
    s = s & "Private Function AddLbl(p As Object, cap As String, x As Single, y As Single, w As Single, Optional req As Boolean = False) As MSForms.Label" & vbCrLf
    s = s & "    Dim l As MSForms.Label" & vbCrLf
    s = s & "    Set l = p.Controls.Add(""Forms.Label.1"", , True)" & vbCrLf
    s = s & "    l.Caption = cap & IIf(req, "" *"", """")" & vbCrLf
    s = s & "    l.Left = x: l.Top = y + 3: l.Width = w: l.Height = 15" & vbCrLf
    s = s & "    l.Font.Name = FONT_NAME: l.Font.Size = FONT_SIZE" & vbCrLf
    s = s & "    l.ForeColor = IIf(req, RGB(192, 0, 0), RGB(0, 0, 0))" & vbCrLf
    s = s & "    l.Font.Bold = req" & vbCrLf
    s = s & "    l.BackStyle = fmBackStyleTransparent" & vbCrLf
    s = s & "    Set AddLbl = l" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Function AddTxt(p As Object, nm As String, x As Single, y As Single, w As Single, Optional h As Single = 20, Optional multi As Boolean = False) As MSForms.TextBox" & vbCrLf
    s = s & "    Dim t As MSForms.TextBox" & vbCrLf
    s = s & "    Set t = p.Controls.Add(""Forms.TextBox.1"", nm, True)" & vbCrLf
    s = s & "    t.Left = x: t.Top = y: t.Width = w: t.Height = h" & vbCrLf
    FC1 = s
End Function

Private Function FC2() As String
    Dim s As String
    s = s & "    t.Font.Name = FONT_NAME: t.Font.Size = FONT_SIZE" & vbCrLf
    s = s & "    t.BorderStyle = fmBorderStyleSingle: t.BorderColor = RGB(166, 166, 166)" & vbCrLf
    s = s & "    If multi Then" & vbCrLf
    s = s & "        t.MultiLine = True: t.EnterKeyBehavior = True: t.ScrollBars = fmScrollBarsVertical" & vbCrLf
    s = s & "        t.WordWrap = True" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "    Set AddTxt = t" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Function AddCmb(p As Object, nm As String, x As Single, y As Single, w As Single) As MSForms.ComboBox" & vbCrLf
    s = s & "    Dim c As MSForms.ComboBox" & vbCrLf
    s = s & "    Set c = p.Controls.Add(""Forms.ComboBox.1"", nm, True)" & vbCrLf
    s = s & "    c.Left = x: c.Top = y: c.Width = w: c.Height = 20" & vbCrLf
    s = s & "    c.Font.Name = FONT_NAME: c.Font.Size = FONT_SIZE" & vbCrLf
    s = s & "    c.Style = fmStyleDropDownList" & vbCrLf
    s = s & "    c.ListRows = 14" & vbCrLf
    s = s & "    c.BorderStyle = fmBorderStyleSingle: c.BorderColor = RGB(166, 166, 166)" & vbCrLf
    s = s & "    Set AddCmb = c" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Function AddFrame(nm As String, cap As String, y As Single, h As Single) As MSForms.Frame" & vbCrLf
    s = s & "    Dim f As MSForms.Frame" & vbCrLf
    s = s & "    Set f = Me.Controls.Add(""Forms.Frame.1"", nm, True)" & vbCrLf
    s = s & "    f.Caption = cap: f.Left = 10: f.Top = y: f.Width = 568: f.Height = h" & vbCrLf
    s = s & "    f.Font.Name = FONT_NAME: f.Font.Size = FONT_SIZE: f.Font.Bold = True" & vbCrLf
    s = s & "    f.ForeColor = RGB(31, 78, 120)" & vbCrLf
    s = s & "    f.BackColor = RGB(255, 255, 255)" & vbCrLf
    s = s & "    Set AddFrame = f" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Function AddBtn(p As Object, nm As String, cap As String, x As Single, y As Single, w As Single, h As Single, primary As Boolean) As MSForms.CommandButton" & vbCrLf
    s = s & "    Dim b As MSForms.CommandButton" & vbCrLf
    s = s & "    Set b = p.Controls.Add(""Forms.CommandButton.1"", nm, True)" & vbCrLf
    s = s & "    b.Caption = cap: b.Left = x: b.Top = y: b.Width = w: b.Height = h" & vbCrLf
    s = s & "    b.Font.Name = FONT_NAME: b.Font.Size = FONT_SIZE: b.Font.Bold = primary" & vbCrLf
    s = s & "    If primary Then" & vbCrLf
    s = s & "        b.BackColor = RGB(255, 255, 255): b.ForeColor = RGB(31, 78, 120)" & vbCrLf
    s = s & "    Else" & vbCrLf
    s = s & "        b.BackColor = RGB(214, 225, 240): b.ForeColor = RGB(31, 78, 120)" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "    Set AddBtn = b" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ---------- 初期化 ----------" & vbCrLf
    s = s & "Private Sub UserForm_Initialize()" & vbCrLf
    s = s & "    Dim fr As MSForms.Frame, ban As MSForms.Label" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    Me.Caption = ""検出事項 入力""" & vbCrLf
    s = s & "    Me.BackColor = RGB(240, 243, 248)" & vbCrLf
    s = s & "    Me.Width = 604: Me.Height = 600" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    Set ban = Me.Controls.Add(""Forms.Label.1"", ""lblTitle"", True)" & vbCrLf
    s = s & "    ban.Left = 0: ban.Top = 0: ban.Width = 604: ban.Height = 38" & vbCrLf
    s = s & "    ban.Caption = ""  検出事項 入力""" & vbCrLf
    s = s & "    ban.Font.Name = FONT_NAME: ban.Font.Size = 14: ban.Font.Bold = True" & vbCrLf
    s = s & "    ban.BackColor = RGB(31, 78, 120): ban.ForeColor = RGB(255, 255, 255)" & vbCrLf
    s = s & "    ban.BackStyle = fmBackStyleOpaque" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    Set btnReg = AddBtn(Me, ""btnReg"", ""登録"", 236, 4, 100, 30, True)" & vbCrLf
    s = s & "    Set btnNew = AddBtn(Me, ""btnNew"", ""新規"", 342, 4, 66, 30, False)" & vbCrLf
    s = s & "    Set btnDel = AddBtn(Me, ""btnDel"", ""削除"", 414, 4, 66, 30, False)" & vbCrLf
    s = s & "    Set btnClose = AddBtn(Me, ""btnClose"", ""閉じる"", 486, 4, 66, 30, False)" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    Set lblMsg = Me.Controls.Add(""Forms.Label.1"", ""lblMsg"", True)" & vbCrLf
    s = s & "    lblMsg.Left = 12: lblMsg.Top = 42: lblMsg.Width = 570: lblMsg.Height = 18" & vbCrLf
    s = s & "    lblMsg.Font.Name = FONT_NAME: lblMsg.Font.Size = 9" & vbCrLf
    s = s & "    lblMsg.ForeColor = RGB(0, 112, 192): lblMsg.BackStyle = fmBackStyleTransparent" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    ' --- 修正するとき ---" & vbCrLf
    s = s & "    Set fr = AddFrame(""fr0"", ""修正するとき(No.を入力して読込)"", 64, 50)" & vbCrLf
    FC2 = s
End Function

Private Function FC3() As String
    Dim s As String
    s = s & "    AddLbl fr, ""No."", 10, 6, 28" & vbCrLf
    s = s & "    Set txtNo = AddTxt(fr, ""txtNo"", 40, 6, 54)" & vbCrLf
    s = s & "    Set btnLoad = AddBtn(fr, ""btnLoad"", ""読込"", 102, 5, 60, 22, False)" & vbCrLf
    s = s & "    Set lblMode = fr.Controls.Add(""Forms.Label.1"", ""lblMode"", True)" & vbCrLf
    s = s & "    lblMode.Left = 176: lblMode.Top = 9: lblMode.Width = 370: lblMode.Height = 15" & vbCrLf
    s = s & "    lblMode.Font.Name = FONT_NAME: lblMode.Font.Size = FONT_SIZE: lblMode.Font.Bold = True" & vbCrLf
    s = s & "    lblMode.ForeColor = RGB(31, 78, 120): lblMode.BackStyle = fmBackStyleTransparent" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    ' --- 基本情報 ---" & vbCrLf
    s = s & "    Set fr = AddFrame(""fr1"", ""基本情報(登録後も残ります)"", 118, 62)" & vbCrLf
    s = s & "    AddLbl fr, ""監査年度(令和)"", 10, 6, 78, True" & vbCrLf
    s = s & "    Set txtYear = AddTxt(fr, ""txtYear"", 88, 6, 44)" & vbCrLf
    s = s & "    AddLbl fr, ""実地監査年月日"", 150, 6, 82" & vbCrLf
    s = s & "    Set txtDate = AddTxt(fr, ""txtDate"", 234, 6, 90)" & vbCrLf
    s = s & "    AddLbl fr, ""担当者"", 342, 6, 40" & vbCrLf
    s = s & "    Set txtTanto = AddTxt(fr, ""txtTanto"", 386, 6, 160)" & vbCrLf
    s = s & "    AddLbl fr, ""グループ"", 10, 32, 70" & vbCrLf
    s = s & "    Set cmbGroup = AddCmb(fr, ""cmbGroup"", 88, 32, 160)" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    ' --- 所属 ---" & vbCrLf
    s = s & "    Set fr = AddFrame(""fr2"", ""所属(上から順に選択。登録後も残ります)"", 186, 114)" & vbCrLf
    s = s & "    AddLbl fr, ""部局"", 10, 6, 70, True" & vbCrLf
    s = s & "    Set cmbD = AddCmb(fr, ""cmbD"", 88, 6, 458)" & vbCrLf
    s = s & "    AddLbl fr, ""局"", 10, 32, 70, True" & vbCrLf
    s = s & "    Set cmbE = AddCmb(fr, ""cmbE"", 88, 32, 458)" & vbCrLf
    s = s & "    AddLbl fr, ""部"", 10, 58, 70" & vbCrLf
    s = s & "    Set cmbF = AddCmb(fr, ""cmbF"", 88, 58, 458)" & vbCrLf
    s = s & "    AddLbl fr, ""課"", 10, 84, 70, True" & vbCrLf
    s = s & "    Set cmbG = AddCmb(fr, ""cmbG"", 88, 84, 458)" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    ' --- 分類 ---" & vbCrLf
    s = s & "    Set fr = AddFrame(""fr3"", ""問題点の分類(上から順に選択)"", 306, 158)" & vbCrLf
    s = s & "    AddLbl fr, ""項目1"", 10, 6, 70" & vbCrLf
    s = s & "    Set cmb1 = AddCmb(fr, ""cmb1"", 88, 6, 458)" & vbCrLf
    s = s & "    AddLbl fr, ""項目(2)"", 10, 32, 70" & vbCrLf
    s = s & "    Set cmb2 = AddCmb(fr, ""cmb2"", 88, 32, 458)" & vbCrLf
    s = s & "    AddLbl fr, ""項目(3)"", 10, 58, 70" & vbCrLf
    s = s & "    Set cmb3 = AddCmb(fr, ""cmb3"", 88, 58, 458)" & vbCrLf
    s = s & "    AddLbl fr, ""区分"", 10, 84, 70" & vbCrLf
    s = s & "    Set cmbCat = AddCmb(fr, ""cmbCat"", 88, 84, 140)" & vbCrLf
    s = s & "    AddLbl fr, ""問題点"", 10, 110, 70, True" & vbCrLf
    s = s & "    Set cmbProb = AddCmb(fr, ""cmbProb"", 88, 110, 458)" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    ' --- 内容 ---" & vbCrLf
    s = s & "    Set fr = AddFrame(""fr4"", ""内容"", 470, 152)" & vbCrLf
    s = s & "    AddLbl fr, ""内容(要約)"", 10, 6, 70" & vbCrLf
    s = s & "    Set txtNaiyo = AddTxt(fr, ""txtNaiyo"", 88, 6, 458, 44, True)" & vbCrLf
    s = s & "    AddLbl fr, ""詳細"", 10, 58, 70" & vbCrLf
    s = s & "    Set txtShosai = AddTxt(fr, ""txtShosai"", 88, 58, 458, 70, True)" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    ' --- 対応・その他 ---" & vbCrLf
    s = s & "    Set fr = AddFrame(""fr5"", ""対応・その他"", 626, 122)" & vbCrLf
    s = s & "    AddLbl fr, ""対応状況"", 10, 6, 70" & vbCrLf
    s = s & "    Set cmbStatus = AddCmb(fr, ""cmbStatus"", 88, 6, 240)" & vbCrLf
    s = s & "    Set chkShuchi = fr.Controls.Add(""Forms.CheckBox.1"", ""chkShuchi"", True)" & vbCrLf
    s = s & "    chkShuchi.Caption = ""全庁周知が必要"": chkShuchi.Left = 350: chkShuchi.Top = 8: chkShuchi.Width = 190" & vbCrLf
    s = s & "    chkShuchi.Font.Name = FONT_NAME: chkShuchi.Font.Size = FONT_SIZE: chkShuchi.BackStyle = fmBackStyleTransparent" & vbCrLf
    s = s & "    AddLbl fr, ""備考区分"", 10, 32, 70" & vbCrLf
    s = s & "    Set cmbBiko = AddCmb(fr, ""cmbBiko"", 88, 32, 458)" & vbCrLf
    s = s & "    AddLbl fr, ""根拠規定"", 10, 58, 70" & vbCrLf
    s = s & "    Set txtKonkyo = AddTxt(fr, ""txtKonkyo"", 88, 58, 458)" & vbCrLf
    s = s & "    AddLbl fr, ""キーワード"", 10, 84, 70" & vbCrLf
    s = s & "    Set txtKw = AddTxt(fr, ""txtKw"", 88, 84, 458)" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    Me.ScrollBars = fmScrollBarsVertical" & vbCrLf
    s = s & "    Me.ScrollHeight = 760" & vbCrLf
    s = s & "    Me.KeepScrollBarsVisible = fmScrollBarsNone" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    txtYear.Value = CStr(Year(Date) - 2018)" & vbCrLf
    s = s & "    txtDate.ControlTipText = ""例: 2026/6/4""" & vbCrLf
    FC3 = s
End Function

Private Function FC4() As String
    Dim s As String
    s = s & "" & vbCrLf
    s = s & "    FillList cmbGroup, ThisWorkbook.Worksheets(""M_設定""), 1, 2, 9" & vbCrLf
    s = s & "    FillList cmbStatus, ThisWorkbook.Worksheets(""M_設定""), 3, 2, 11" & vbCrLf
    s = s & "    FillList cmbBiko, ThisWorkbook.Worksheets(""M_設定""), 5, 2, 4" & vbCrLf
    s = s & "    FillList cmbD, ThisWorkbook.Worksheets(""リスト""), 15, 2, 0" & vbCrLf
    s = s & "    FillList cmb1, ThisWorkbook.Worksheets(""リスト""), 1, 2, 0" & vbCrLf
    s = s & "    mRow = 0" & vbCrLf
    s = s & "    ShowMode" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ---------- リストの読み込み ----------" & vbCrLf
    s = s & "' 1列を上から詰めてコンボに入れる。lastRow=0 なら最初の空白セルの手前まで。" & vbCrLf
    s = s & "Private Sub FillList(c As MSForms.ComboBox, ws As Worksheet, col As Long, firstRow As Long, lastRow As Long)" & vbCrLf
    s = s & "    Dim r As Long, v As Variant" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    c.Clear" & vbCrLf
    s = s & "    r = firstRow" & vbCrLf
    s = s & "    Do" & vbCrLf
    s = s & "        If lastRow > 0 And r > lastRow Then Exit Do" & vbCrLf
    s = s & "        v = ws.Cells(r, col).Value" & vbCrLf
    s = s & "        If Len(CStr(v)) = 0 Then" & vbCrLf
    s = s & "            If lastRow = 0 Then Exit Do" & vbCrLf
    s = s & "        Else" & vbCrLf
    s = s & "            c.AddItem CStr(v)" & vbCrLf
    s = s & "        End If" & vbCrLf
    s = s & "        r = r + 1" & vbCrLf
    s = s & "        If r > 5000 Then Exit Do" & vbCrLf
    s = s & "    Loop" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' 空白・全角空白を除いて比較用に整える" & vbCrLf
    s = s & "Private Function Norm(ByVal s As String) As String" & vbCrLf
    s = s & "    Norm = Replace(Replace(s, ChrW(12288), """"), "" "", """")" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' リストシートの「キー列(keyCol)=key」の行の、次列の値をコンボに入れる。入れた件数を返す" & vbCrLf
    s = s & "Private Function FillByKey(c As MSForms.ComboBox, keyCol As Long, key As String) As Long" & vbCrLf
    s = s & "    Dim ws As Worksheet, n As Long, r As Long, v As Variant, k As String, cnt As Long" & vbCrLf
    s = s & "    Set ws = ThisWorkbook.Worksheets(""リスト"")" & vbCrLf
    s = s & "    c.Clear" & vbCrLf
    s = s & "    n = ws.Cells(ws.Rows.Count, keyCol).End(xlUp).Row" & vbCrLf
    s = s & "    If n < 2 Then Exit Function" & vbCrLf
    s = s & "    v = ws.Range(ws.Cells(2, keyCol), ws.Cells(n, keyCol + 1)).Value" & vbCrLf
    s = s & "    k = Norm(key)" & vbCrLf
    s = s & "    For r = 1 To UBound(v, 1)" & vbCrLf
    s = s & "        If Norm(CStr(v(r, 1))) = k Then" & vbCrLf
    s = s & "            c.AddItem CStr(v(r, 2)): cnt = cnt + 1" & vbCrLf
    s = s & "        End If" & vbCrLf
    s = s & "    Next" & vbCrLf
    s = s & "    FillByKey = cnt" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub ShowCount(nm As String, n As Long)" & vbCrLf
    s = s & "    If n = 0 Then lblMsg.Caption = nm & "": 候補がありません。"" Else lblMsg.Caption = nm & "": "" & n & "" 件の候補があります。""" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' コンボの項目を文字で選ぶ(無ければ未選択)" & vbCrLf
    s = s & "Private Sub SelectItem(c As MSForms.ComboBox, ByVal t As String)" & vbCrLf
    s = s & "    Dim i As Long" & vbCrLf
    s = s & "    c.ListIndex = -1" & vbCrLf
    s = s & "    If Len(t) = 0 Then Exit Sub" & vbCrLf
    s = s & "    For i = 0 To c.ListCount - 1" & vbCrLf
    s = s & "        If Norm(CStr(c.List(i))) = Norm(t) Then c.ListIndex = i: Exit Sub" & vbCrLf
    s = s & "    Next" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ---------- 連動: 所属 ----------" & vbCrLf
    s = s & "Private Sub cmbD_Change()" & vbCrLf
    s = s & "    If busy Then Exit Sub" & vbCrLf
    FC4 = s
End Function

Private Function FC5() As String
    Dim s As String
    s = s & "    busy = True" & vbCrLf
    s = s & "    cmbE.Clear: cmbF.Clear: cmbG.Clear" & vbCrLf
    s = s & "    If cmbD.ListIndex >= 0 Then ShowCount ""局"", FillByKey(cmbE, KC_E, cmbD.Value)" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub cmbE_Change()" & vbCrLf
    s = s & "    If busy Then Exit Sub" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    cmbF.Clear: cmbG.Clear" & vbCrLf
    s = s & "    If cmbE.ListIndex >= 0 Then ShowCount ""部"", FillByKey(cmbF, KC_F, cmbD.Value & ""|"" & cmbE.Value)" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub cmbF_Change()" & vbCrLf
    s = s & "    If busy Then Exit Sub" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    cmbG.Clear" & vbCrLf
    s = s & "    If cmbF.ListIndex >= 0 Then ShowCount ""課"", FillByKey(cmbG, KC_G, cmbD.Value & ""|"" & cmbE.Value & ""|"" & cmbF.Value)" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ---------- 連動: 分類 ----------" & vbCrLf
    s = s & "Private Sub FillCat()" & vbCrLf
    s = s & "    ShowCount ""区分"", FillByKey(cmbCat, KC_C, cmb1.Value & ""|"" & cmb2.Value & ""|"" & cmb3.Value)" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub cmb1_Change()" & vbCrLf
    s = s & "    If busy Then Exit Sub" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    cmb2.Clear: cmb3.Clear: cmbCat.Clear: cmbProb.Clear" & vbCrLf
    s = s & "    If cmb1.ListIndex >= 0 Then ShowCount ""項目(2)"", FillByKey(cmb2, KC_2, cmb1.Value)" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub cmb2_Change()" & vbCrLf
    s = s & "    If busy Then Exit Sub" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    cmb3.Clear: cmbCat.Clear: cmbProb.Clear" & vbCrLf
    s = s & "    If cmb2.ListIndex >= 0 Then" & vbCrLf
    s = s & "        ShowCount ""項目(3)"", FillByKey(cmb3, KC_3, cmb1.Value & ""|"" & cmb2.Value)" & vbCrLf
    s = s & "        If cmb3.ListCount = 0 Then" & vbCrLf
    s = s & "            FillCat      ' 項目(3)が無い事務は、そのまま区分へ" & vbCrLf
    s = s & "            lblMsg.Caption = ""この項目には項目(3)がありません。区分を選んでください。""" & vbCrLf
    s = s & "        End If" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub cmb3_Change()" & vbCrLf
    s = s & "    If busy Then Exit Sub" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    cmbCat.Clear: cmbProb.Clear" & vbCrLf
    s = s & "    If cmb3.ListIndex >= 0 Then FillCat" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub cmbCat_Change()" & vbCrLf
    s = s & "    If busy Then Exit Sub" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    cmbProb.Clear" & vbCrLf
    s = s & "    If cmbCat.ListIndex >= 0 Then" & vbCrLf
    s = s & "        ShowCount ""問題点"", FillByKey(cmbProb, KC_P, cmb1.Value & ""|"" & cmb2.Value & ""|"" & cmb3.Value & ""|"" & cmbCat.Value)" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ---------- モード表示 ----------" & vbCrLf
    s = s & "Private Sub ShowMode()" & vbCrLf
    s = s & "    If mRow > 0 Then" & vbCrLf
    FC5 = s
End Function

Private Function FC6() As String
    Dim s As String
    s = s & "        lblMode.Caption = ""修正中: No."" & (mRow - 1) & ""(入力シート "" & mRow & "" 行目)""" & vbCrLf
    s = s & "        btnReg.Caption = ""修正を保存""" & vbCrLf
    s = s & "    Else" & vbCrLf
    s = s & "        lblMode.Caption = ""新規入力""" & vbCrLf
    s = s & "        btnReg.Caption = ""登録""" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ---------- 行の読込(修正) ----------" & vbCrLf
    s = s & "Private Function IsRowEmpty(ws As Worksheet, r As Long) As Boolean" & vbCrLf
    s = s & "    IsRowEmpty = (Application.WorksheetFunction.CountA(ws.Range(""B"" & r & "":N"" & r)) = 0)" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub btnLoad_Click()" & vbCrLf
    s = s & "    Dim n As Long, r As Long, ws As Worksheet" & vbCrLf
    s = s & "    lblMsg.Caption = """"" & vbCrLf
    s = s & "    If Len(txtNo.Value) = 0 Or Not IsNumeric(txtNo.Value) Then MsgBox ""No.を数字で入力してください。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    n = CLng(txtNo.Value): r = n + 1" & vbCrLf
    s = s & "    If r < 2 Or r > ROW_LAST Then MsgBox ""No.は 1～"" & (ROW_LAST - 1) & "" の範囲で入力してください。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    Set ws = ThisWorkbook.Worksheets(""入力"")" & vbCrLf
    s = s & "    If IsRowEmpty(ws, r) Then MsgBox ""No."" & n & "" の行にはデータがありません。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    LoadRow ws, r" & vbCrLf
    s = s & "    mRow = r" & vbCrLf
    s = s & "    ShowMode" & vbCrLf
    s = s & "    lblMsg.Caption = ""No."" & n & "" を読み込みました。直したら「修正を保存」を押してください。""" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub LoadRow(ws As Worksheet, r As Long)" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    txtYear.Value = CStr(ws.Range(""B"" & r).Value)" & vbCrLf
    s = s & "    If IsDate(ws.Range(""C"" & r).Value) Then txtDate.Value = Format(ws.Range(""C"" & r).Value, ""yyyy/mm/dd"") Else txtDate.Value = """"" & vbCrLf
    s = s & "    txtTanto.Value = CStr(ws.Range(""I"" & r).Value)" & vbCrLf
    s = s & "    SelectItem cmbGroup, CStr(ws.Range(""H"" & r).Value)" & vbCrLf
    s = s & "    ' 所属" & vbCrLf
    s = s & "    SelectItem cmbD, CStr(ws.Range(""D"" & r).Value)" & vbCrLf
    s = s & "    FillByKey cmbE, KC_E, CStr(cmbD.Value)" & vbCrLf
    s = s & "    SelectItem cmbE, CStr(ws.Range(""E"" & r).Value)" & vbCrLf
    s = s & "    FillByKey cmbF, KC_F, cmbD.Value & ""|"" & cmbE.Value" & vbCrLf
    s = s & "    SelectItem cmbF, CStr(ws.Range(""F"" & r).Value)" & vbCrLf
    s = s & "    FillByKey cmbG, KC_G, cmbD.Value & ""|"" & cmbE.Value & ""|"" & cmbF.Value" & vbCrLf
    s = s & "    SelectItem cmbG, CStr(ws.Range(""G"" & r).Value)" & vbCrLf
    s = s & "    ' 分類" & vbCrLf
    s = s & "    SelectItem cmb1, CStr(ws.Range(""J"" & r).Value)" & vbCrLf
    s = s & "    FillByKey cmb2, KC_2, CStr(cmb1.Value)" & vbCrLf
    s = s & "    SelectItem cmb2, CStr(ws.Range(""K"" & r).Value)" & vbCrLf
    s = s & "    FillByKey cmb3, KC_3, cmb1.Value & ""|"" & cmb2.Value" & vbCrLf
    s = s & "    SelectItem cmb3, CStr(ws.Range(""L"" & r).Value)" & vbCrLf
    s = s & "    FillByKey cmbCat, KC_C, cmb1.Value & ""|"" & cmb2.Value & ""|"" & cmb3.Value" & vbCrLf
    s = s & "    SelectItem cmbCat, CStr(ws.Range(""M"" & r).Value)" & vbCrLf
    s = s & "    FillByKey cmbProb, KC_P, cmb1.Value & ""|"" & cmb2.Value & ""|"" & cmb3.Value & ""|"" & cmbCat.Value" & vbCrLf
    s = s & "    SelectItem cmbProb, CStr(ws.Range(""N"" & r).Value)" & vbCrLf
    s = s & "    ' 内容など" & vbCrLf
    s = s & "    txtNaiyo.Value = CStr(ws.Range(""P"" & r).Value)" & vbCrLf
    s = s & "    txtShosai.Value = CStr(ws.Range(""Q"" & r).Value)" & vbCrLf
    s = s & "    SelectItem cmbStatus, CStr(ws.Range(""R"" & r).Value)" & vbCrLf
    s = s & "    SelectItem cmbBiko, CStr(ws.Range(""S"" & r).Value)" & vbCrLf
    s = s & "    txtKonkyo.Value = CStr(ws.Range(""T"" & r).Value)" & vbCrLf
    s = s & "    txtKw.Value = CStr(ws.Range(""U"" & r).Value)" & vbCrLf
    s = s & "    chkShuchi.Value = (CStr(ws.Range(""V"" & r).Value) = ""要"")" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "' ---------- 登録・修正の保存 ----------" & vbCrLf
    s = s & "Private Function NextRow(ws As Worksheet) As Long" & vbCrLf
    s = s & "    Dim v As Variant, i As Long, j As Long, blank As Boolean" & vbCrLf
    s = s & "    v = ws.Range(""B2:N"" & ROW_LAST).Value" & vbCrLf
    s = s & "    For i = 1 To UBound(v, 1)" & vbCrLf
    s = s & "        blank = True" & vbCrLf
    s = s & "        For j = 1 To UBound(v, 2)" & vbCrLf
    s = s & "            If IsError(v(i, j)) Then" & vbCrLf
    FC6 = s
End Function

Private Function FC7() As String
    Dim s As String
    s = s & "                blank = False: Exit For" & vbCrLf
    s = s & "            ElseIf Len(CStr(v(i, j))) > 0 Then" & vbCrLf
    s = s & "                blank = False: Exit For" & vbCrLf
    s = s & "            End If" & vbCrLf
    s = s & "        Next" & vbCrLf
    s = s & "        If blank Then NextRow = i + 1: Exit Function" & vbCrLf
    s = s & "    Next" & vbCrLf
    s = s & "    NextRow = 0" & vbCrLf
    s = s & "End Function" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub btnReg_Click()" & vbCrLf
    s = s & "    Dim ws As Worksheet, r As Long" & vbCrLf
    s = s & "    lblMsg.Caption = """"" & vbCrLf
    s = s & "    If Len(txtYear.Value) = 0 Or Not IsNumeric(txtYear.Value) Then MsgBox ""監査年度を数字で入力してください。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    If Len(cmbD.Value) = 0 Or Len(cmbE.Value) = 0 Or Len(cmbG.Value) = 0 Then MsgBox ""所属(部局・局・課)を選択してください。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    If Len(txtDate.Value) > 0 Then" & vbCrLf
    s = s & "        If Not IsDate(txtDate.Value) Then MsgBox ""実地監査年月日は 2026/6/4 の形式で入力してください。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "    If Len(cmbProb.Value) = 0 Then MsgBox ""問題点を選択してください。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    If Left(cmbProb.Value, 5) = ""（その他）"" And Len(Trim(txtNaiyo.Value)) = 0 Then" & vbCrLf
    s = s & "        MsgBox ""「（その他）」を選んだ場合は、内容(要約)を入力してください。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    Set ws = ThisWorkbook.Worksheets(""入力"")" & vbCrLf
    s = s & "    If mRow > 0 Then" & vbCrLf
    s = s & "        r = mRow" & vbCrLf
    s = s & "    Else" & vbCrLf
    s = s & "        r = NextRow(ws)" & vbCrLf
    s = s & "        If r = 0 Then MsgBox ""入力シートの 2～"" & ROW_LAST & "" 行目に、空いている行が見つかりません。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    ws.Range(""B"" & r).Value = CLng(txtYear.Value)" & vbCrLf
    s = s & "    If Len(txtDate.Value) > 0 Then ws.Range(""C"" & r).Value = CDate(txtDate.Value) Else ws.Range(""C"" & r).ClearContents" & vbCrLf
    s = s & "    ws.Range(""D"" & r).Value = cmbD.Value" & vbCrLf
    s = s & "    ws.Range(""E"" & r).Value = cmbE.Value" & vbCrLf
    s = s & "    ws.Range(""F"" & r).Value = cmbF.Value" & vbCrLf
    s = s & "    ws.Range(""G"" & r).Value = cmbG.Value" & vbCrLf
    s = s & "    ws.Range(""H"" & r).Value = cmbGroup.Value" & vbCrLf
    s = s & "    ws.Range(""I"" & r).Value = txtTanto.Value" & vbCrLf
    s = s & "    ws.Range(""J"" & r).Value = cmb1.Value" & vbCrLf
    s = s & "    ws.Range(""K"" & r).Value = cmb2.Value" & vbCrLf
    s = s & "    ws.Range(""L"" & r).Value = cmb3.Value" & vbCrLf
    s = s & "    ws.Range(""M"" & r).Value = cmbCat.Value" & vbCrLf
    s = s & "    ws.Range(""N"" & r).Value = cmbProb.Value" & vbCrLf
    s = s & "    ws.Range(""P"" & r).Value = txtNaiyo.Value" & vbCrLf
    s = s & "    ws.Range(""Q"" & r).Value = txtShosai.Value" & vbCrLf
    s = s & "    ws.Range(""R"" & r).Value = cmbStatus.Value" & vbCrLf
    s = s & "    ws.Range(""S"" & r).Value = cmbBiko.Value" & vbCrLf
    s = s & "    ws.Range(""T"" & r).Value = txtKonkyo.Value" & vbCrLf
    s = s & "    ws.Range(""U"" & r).Value = txtKw.Value" & vbCrLf
    s = s & "    ws.Range(""V"" & r).Value = IIf(chkShuchi.Value, ""要"", ""不要"")" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "    If mRow > 0 Then" & vbCrLf
    s = s & "        lblMsg.Caption = ""No."" & (r - 1) & "" を修正しました。""" & vbCrLf
    s = s & "    Else" & vbCrLf
    s = s & "        lblMsg.Caption = ""登録しました(No."" & (r - 1) & ""、入力シート "" & r & "" 行目)。続けて入力できます。""" & vbCrLf
    s = s & "    End If" & vbCrLf
    s = s & "    mRow = 0" & vbCrLf
    s = s & "    ShowMode" & vbCrLf
    s = s & "    ClearDetail" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub ClearDetail()" & vbCrLf
    s = s & "    busy = True" & vbCrLf
    s = s & "    cmb1.ListIndex = -1" & vbCrLf
    s = s & "    cmb2.Clear: cmb3.Clear: cmbCat.Clear: cmbProb.Clear" & vbCrLf
    s = s & "    txtNaiyo.Value = """": txtShosai.Value = """"" & vbCrLf
    s = s & "    cmbStatus.ListIndex = -1: cmbBiko.ListIndex = -1" & vbCrLf
    s = s & "    txtKonkyo.Value = """": txtKw.Value = """"" & vbCrLf
    s = s & "    chkShuchi.Value = False" & vbCrLf
    FC7 = s
End Function

Private Function FC8() As String
    Dim s As String
    s = s & "    txtNo.Value = """"" & vbCrLf
    s = s & "    busy = False" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub btnNew_Click()" & vbCrLf
    s = s & "    mRow = 0" & vbCrLf
    s = s & "    ShowMode" & vbCrLf
    s = s & "    ClearDetail" & vbCrLf
    s = s & "    lblMsg.Caption = ""新規入力にしました。""" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub btnDel_Click()" & vbCrLf
    s = s & "    Dim ws As Worksheet" & vbCrLf
    s = s & "    If mRow = 0 Then MsgBox ""削除するには、先にNo.を入力して「読込」してください。"", vbExclamation: Exit Sub" & vbCrLf
    s = s & "    If MsgBox(""No."" & (mRow - 1) & "" を削除しますか?"" & vbCrLf & ""(その行の入力内容を空にします)"", vbYesNo + vbQuestion, ""削除の確認"") <> vbYes Then Exit Sub" & vbCrLf
    s = s & "    Set ws = ThisWorkbook.Worksheets(""入力"")" & vbCrLf
    s = s & "    ws.Range(""B"" & mRow & "":N"" & mRow).ClearContents" & vbCrLf
    s = s & "    ws.Range(""P"" & mRow & "":V"" & mRow).ClearContents" & vbCrLf
    s = s & "    lblMsg.Caption = ""No."" & (mRow - 1) & "" を削除しました。""" & vbCrLf
    s = s & "    mRow = 0" & vbCrLf
    s = s & "    ShowMode" & vbCrLf
    s = s & "    ClearDetail" & vbCrLf
    s = s & "End Sub" & vbCrLf
    s = s & "" & vbCrLf
    s = s & "Private Sub btnClose_Click()" & vbCrLf
    s = s & "    Unload Me" & vbCrLf
    s = s & "End Sub" & vbCrLf
    FC8 = s
End Function
