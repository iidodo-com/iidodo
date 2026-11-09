Attribute VB_Name = "YearPatch"
Option Explicit

' 年度パッチ(短期ブック・介護=長期ブックのどちらでも、同じ名前のマクロで使える統合版)。
' ブックを作り直さず、今開いているブックの数式・書式だけを書き換える。
' 何度実行しても結果は同じ(上書き)。実行前に必ずブックを別名で保存しておくこと(マクロの結果は元に戻せない)。
'
' 【使い方】 古い SheetRename / ApplyYearPatch / ApplyDbPatch / KaigoYearPatch のモジュールは削除してから、これを取り込む。
'   ApplyYearPatch     … 年度まわりの数式を当てる(短期ブックは「R数字短期」、長期ブックは「R数字長期」を自動で判別)
'   ApplyDbPatch       … DB_集計の年度ラベルなどを当てる(短期は H28,V28 も。長期は H39,R28 も)
'   RenameSheetsByC1   … C1の年度に合わせてシート名を付け替える
'
' 対象シート(名前ではなく「タブの並び順」で決める)
'   本体系 : 「R数字短期」または「R数字長期」の前のシート=s1、後ろのシート=s2
'   掛金系 : 「R数字掛金（短期）」または「R数字長期掛金」の前=k1、後ろ=k2
Private Const FMT As String = """令和""0""年度"""
Private Const LINK_BONUS As Boolean = True     ' 長期ブック: V6,V12(賞与支給率)を前のシートにリンクする(Falseで行わない)

' ============================================================
'  入口
' ============================================================
Public Sub ApplyYearPatch()
    If HasPair("短期") Then
        ApplyShort
    ElseIf HasPair("長期") Then
        ApplyKaigo
    Else
        MsgBox "「R数字短期」または「R数字長期」のシートが2枚見つかりません。", vbExclamation
    End If
End Sub

Public Sub ApplyDbPatch()
    If HasPair("短期") Then
        DbShort
    ElseIf HasPair("長期") Then
        DbKaigo
    Else
        MsgBox "「R数字短期」または「R数字長期」のシートが2枚見つかりません。", vbExclamation
    End If
End Sub

Public Sub RenameSheetsByC1()
    Dim s1 As Worksheet, s2 As Worksheet, k1 As Worksheet, k2 As Worksheet
    Dim sfx As String, ksfx As String, n As Long, ev As Boolean
    If HasPair("短期") Then
        sfx = "短期": ksfx = "掛金（短期）"
    ElseIf HasPair("長期") Then
        sfx = "長期": ksfx = "長期掛金"
    Else
        MsgBox "「R数字短期」または「R数字長期」のシートが2枚見つかりません。", vbExclamation
        Exit Sub
    End If
    GetPair sfx, s1, s2
    GetPair ksfx, k1, k2
    n = YearOf(s1.Range("C1").Value)
    If n < 2 Then
        MsgBox s1.Name & "!C1 から年度を読み取れません(数字または「令和N年度」): " & CStr(s1.Range("C1").Text), vbExclamation
        Exit Sub
    End If
    ev = Application.EnableEvents
    Application.EnableEvents = False
    On Error GoTo Fail
    SetPair s1, s2, n, sfx
    SetPair k1, k2, n, ksfx
    Application.EnableEvents = ev
    Exit Sub
Fail:
    Application.EnableEvents = ev
    MsgBox "シート名の変更に失敗しました: " & Err.Description & vbCrLf & "同じ名前の別シートが既にないか確認してください。", vbExclamation
End Sub

' ============================================================
'  短期ブック
'   1. s1のC1を数字にして、表示形式を「"令和"0"年度"」にする   2. s2のC1 = s1のC1 + 1
'   3. s2のZ5,Z6,Z11,Z12 = s1の同じセル(賞与支給率)
'   4. s2のE20,H25,H27,H28,Q27,V28 を、C1の年度から文言を作る数式にする
'   5. 「=C1」と参照している数式を ="令和"&C1&"年度" にする
'   6. k1,k2のA1をs1のC1から自動で出し、k2のP123をその年度から作る日付にする
' ============================================================
Private Sub ApplyShort()
    Dim s1 As Worksheet, s2 As Worksheet, k1 As Worksheet, k2 As Worksheet
    Dim n As Long, log As String, r As Variant, nRef As Long
    Dim calcMode As Long

    GetPair "短期", s1, s2
    GetPair "掛金（短期）", k1, k2
    n = YearOf(s1.Range("C1").Value)
    If n < 2 Then
        MsgBox s1.Name & "!C1 から年度の数字を読み取れません(「令和7年度」または数字が必要): " & CStr(s1.Range("C1").Text), vbExclamation
        Exit Sub
    End If
    If MsgBox("次のシートにパッチを当てます。実行前にブックを別名保存しましたか？" & vbCrLf & vbCrLf & _
              "前のシート(年度の元): " & s1.Name & vbCrLf & _
              "後ろのシート(+1年): " & s2.Name & vbCrLf & _
              "掛金(前/後ろ): " & NameOf(k1) & " / " & NameOf(k2), _
              vbOKCancel + vbQuestion, "年度パッチ(短期)") <> vbOK Then Exit Sub

    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fail

    s1.Range("C1").Value = n
    s1.Range("C1").NumberFormat = FMT
    log = log & "1. " & s1.Name & "!C1 = " & n & "(表示:令和" & n & "年度)" & vbCrLf

    s2.Range("C1").Formula = "='" & s1.Name & "'!C1+1"
    s2.Range("C1").NumberFormat = FMT
    log = log & "2. " & s2.Name & "!C1 = " & s1.Name & "!C1+1" & vbCrLf

    For Each r In Array("Z5", "Z6", "Z11", "Z12")
        s2.Range(CStr(r)).Formula = "='" & s1.Name & "'!" & r
    Next r
    log = log & "3. " & s2.Name & "!Z5,Z6,Z11,Z12 を " & s1.Name & " にリンク" & vbCrLf

    s2.Range("E20").Formula = Fm("=`R`&($C$1-1)&`.3月：`&TEXT('" & s1.Name & "'!C16,`#,##0`)&`人→Ｒ`&$C$1&`.3月：`&TEXT(C16,`#,##0`)&`人→`&TEXT(D20,`+#,##0;-#,##0;0`)&`人。`")
    s2.Range("H25").Formula = Fm("=`R`&$C$1&`.3平均標準報酬月額◆`")
    s2.Range("H27").Formula = Fm("=`R`&($C$1-1)&`.3退職実績人数・標準報酬`")
    s2.Range("Q27").Formula = Fm("=`R`&($C$1-1)&`.4実績`")
    If SheetExists("DB_集計") Then
        s2.Range("H28").Formula = Fm("=`病院予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&DB_集計!F7&`円】`")
        s2.Range("V28").Formula = Fm("=`人事課予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&TEXT(DB_集計!F13,`#,##0`)&`円】`")
        log = log & "4. " & s2.Name & "!E20,H25,H27,H28,Q27,V28 を数式化" & vbCrLf
    Else
        log = log & "4. DB_集計 が無いため H28,V28 は未変更(他の4セルは数式化)" & vbCrLf
    End If

    nRef = FixC1Refs(s1) + FixC1Refs(s2)
    log = log & "5. 「=C1」を ""令和""&C1&""年度"" に変更: " & nRef & " セル" & vbCrLf

    If Not k1 Is Nothing Then
        k1.Range("A1").Formula = Fm("=`R`&'" & s1.Name & "'!C1&`年度`")
        log = log & "6. " & k1.Name & "!A1 = R(" & s1.Name & "のC1)年度" & vbCrLf
    End If
    If Not k2 Is Nothing Then
        k2.Range("A1").Formula = Fm("=`R`&('" & s1.Name & "'!C1+1)&`年度`")
        k2.Range("P123").Formula = "=DATE(2018+VALUE(MID(A1,2,LEN(A1)-3)),6,30)"
        log = log & "   " & k2.Name & "!A1 = R(" & s1.Name & "のC1+1)年度、P123 をA1の年度から作る日付に変更" & vbCrLf
    End If

Fail:
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description & vbCrLf & vbCrLf & "ここまでの内容:" & vbCrLf & log, vbExclamation
    Else
        Application.Calculate
        MsgBox "完了しました。" & vbCrLf & vbCrLf & log, vbInformation, "年度パッチ(短期)"
    End If
End Sub

' 短期: DB_集計の年度ラベルを数式化し、s2のH28,V28を年度と平均標準報酬額つきの数式にする
Private Sub DbShort()
    Dim s1 As Worksheet, s2 As Worksheet, db As Worksheet
    Dim nDone As Long, calcMode As Long
    GetPair "短期", s1, s2
    If Not SheetExists("DB_集計") Then
        MsgBox "DB_集計 シートがありません。", vbExclamation
        Exit Sub
    End If
    Set db = ThisWorkbook.Worksheets("DB_集計")
    If IsEmpty(s2.Range("C1").Value) Or Not IsNumeric(s2.Range("C1").Value) Then
        MsgBox s2.Name & "!C1 が数字ではありません。先に ApplyYearPatch を実行してください。", vbExclamation
        Exit Sub
    End If
    If MsgBox("DB_集計の年度表示を、" & s2.Name & " のC1から出す数式にします。" & vbCrLf & _
              "あわせて " & s2.Name & " のH28、V28も数式にします。" & vbCrLf & _
              "実行前にブックを別名保存しましたか？", vbOKCancel + vbQuestion, "DB年度パッチ(短期)") <> vbOK Then Exit Sub

    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fail
    nDone = FixDbLabels(db, s2.Name, "短期")
    s2.Range("H28").Formula = Fm("=`病院予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&DB_集計!F7&`円】`")
    s2.Range("V28").Formula = Fm("=`人事課予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&TEXT(DB_集計!F13,`#,##0`)&`円】`")
Fail:
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description, vbExclamation
    Else
        Application.Calculate
        MsgBox "完了しました。" & vbCrLf & "DB_集計の数式化: " & nDone & " セル" & vbCrLf & s2.Name & "!H28, V28 を数式化", vbInformation, "DB年度パッチ(短期)"
    End If
End Sub

' ============================================================
'  長期(介護)ブック
'   1. s1のC1を数字にして、表示形式を「"令和"0"年度"」にする(「令和７年度」→ 7。全角でも可)
'   2. s2のC1 = s1のC1 + 1                 3. 「=C1」と参照している数式を ="令和"&C1&"年度" にする
'   4. s2のV6,V12(賞与支給率) = s1の同じセル(V15は対象外)   ※LINK_BONUS を False にすると行わない
'   5. s2のH25,H27,H38,H39,R28 を、C1の年度(とDB_集計の平均標準報酬額)から作る数式にする
'   6. k1,k2のA1(「R８年度」など)を s1のC1 から自動で出す
'   7. DB_集計の年度ラベル(「R○長期」「R○.4」)をC1から出す数式にする
'   8. フォント・太字・行の高さを短期ブックにそろえる
' ============================================================
Private Sub ApplyKaigo()
    Dim s1 As Worksheet, s2 As Worksheet, k1 As Worksheet, k2 As Worksheet
    Dim n As Long, log As String, calcMode As Long, nRef As Long

    GetPair "長期", s1, s2
    GetPair "長期掛金", k1, k2
    n = YearOf(s1.Range("C1").Value)
    If n < 2 Then
        MsgBox s1.Name & "!C1 から年度の数字を読み取れません(「令和7年度」または数字が必要): " & CStr(s1.Range("C1").Text), vbExclamation
        Exit Sub
    End If
    If MsgBox("次のシートにパッチを当てます。実行前にブックを別名保存しましたか？" & vbCrLf & vbCrLf & _
              "前の長期シート(年度の元): " & s1.Name & vbCrLf & _
              "後ろの長期シート(+1年): " & s2.Name & vbCrLf & _
              "掛金(前/後ろ): " & NameOf(k1) & " / " & NameOf(k2), _
              vbOKCancel + vbQuestion, "年度パッチ(長期)") <> vbOK Then Exit Sub

    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fail

    s1.Range("C1").Value = n
    s1.Range("C1").NumberFormat = FMT
    s2.Range("C1").Formula = "='" & s1.Name & "'!C1+1"
    s2.Range("C1").NumberFormat = FMT
    log = log & "1-2. " & s1.Name & "!C1 = " & n & "、" & s2.Name & "!C1 = " & s1.Name & "!C1+1" & vbCrLf

    nRef = FixC1Refs(s1) + FixC1Refs(s2)
    log = log & "3. 「=C1」を ""令和""&C1&""年度"" に変更: " & nRef & " セル" & vbCrLf

    If LINK_BONUS Then
        s2.Range("V6").Formula = "='" & s1.Name & "'!V6"
        s2.Range("V12").Formula = "='" & s1.Name & "'!V12"
        log = log & "4. " & s2.Name & "!V6,V12 を " & s1.Name & " にリンク" & vbCrLf
    End If

    s2.Range("H25").Formula = Fm("=`R`&$C$1&`.3平均標準報酬月額◆`")
    s2.Range("H27").Formula = Fm("=`Ｒ`&($C$1-1)&`.3退職実績人数×◆`")
    s2.Range("H38").Formula = Fm("=`R`&$C$1&`.4人事課見込人数×◆`")
    If SheetExists("DB_集計") Then
        s2.Range("H39").Formula = Fm("=`市ﾎｰﾑﾍﾟｰｼﾞ採用予定数×R`&($C$1-1)&`.4新採平均標準報酬【`&TEXT(DB_集計!F14,`#,##0`)&`円】`")
        s2.Range("R28").Formula = Fm("=`市ﾎｰﾑﾍﾟｰｼﾞ採用予定数×R`&($C$1-1)&`.4新採平均標準報酬【`&TEXT(DB_集計!F10,`#,##0`)&`円】`")
        log = log & "5. " & s2.Name & "!H25,H27,H38,H39,R28 を数式化(H39,R28は平均標準報酬額つき)" & vbCrLf
    Else
        s2.Range("H39").Formula = Fm("=`市ﾎｰﾑﾍﾟｰｼﾞ採用予定数×R`&($C$1-1)&`.4新採平均標準報酬`")
        s2.Range("R28").Formula = "=H39"
        log = log & "5. DB_集計 が無いため H39,R28 は金額なしで数式化(H25,H27,H38も数式化)" & vbCrLf
    End If

    If Not k1 Is Nothing Then
        k1.Range("A1").Formula = Fm("=`R`&JIS('" & s1.Name & "'!C1)&`年度`")
        log = log & "6. " & k1.Name & "!A1 を " & s1.Name & "!C1 から自動に" & vbCrLf
    End If
    If Not k2 Is Nothing Then
        k2.Range("A1").Formula = Fm("=`R`&JIS('" & s1.Name & "'!C1+1)&`年度`")
        log = log & "   " & k2.Name & "!A1 を " & s1.Name & "!C1+1 から自動に" & vbCrLf
    End If

    If SheetExists("DB_集計") Then log = log & "7. DB_集計の年度ラベル: " & FixDbLabels(ThisWorkbook.Worksheets("DB_集計"), s2.Name, "長期") & " セル" & vbCrLf

    FixFormats k1, k2, s1, s2
    log = log & "8. フォント・太字・行の高さをそろえました" & vbCrLf

Fail:
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description & vbCrLf & vbCrLf & "ここまでの内容:" & vbCrLf & log, vbExclamation
    Else
        Application.Calculate
        MsgBox "完了しました。" & vbCrLf & vbCrLf & log, vbInformation, "年度パッチ(長期)"
    End If
End Sub

' 長期: DB_集計の年度ラベルを数式化し、s2のH39,R28を年度と平均標準報酬額つきの数式にする
Private Sub DbKaigo()
    Dim s1 As Worksheet, s2 As Worksheet, db As Worksheet
    Dim nDone As Long, calcMode As Long
    GetPair "長期", s1, s2
    If Not SheetExists("DB_集計") Then
        MsgBox "DB_集計 シートがありません。", vbExclamation
        Exit Sub
    End If
    Set db = ThisWorkbook.Worksheets("DB_集計")
    If IsEmpty(s2.Range("C1").Value) Or Not IsNumeric(s2.Range("C1").Value) Then
        MsgBox s2.Name & "!C1 が数字ではありません。先に ApplyYearPatch を実行してください。", vbExclamation
        Exit Sub
    End If
    If MsgBox("DB_集計の年度表示を、" & s2.Name & " のC1から出す数式にします。" & vbCrLf & _
              "あわせて " & s2.Name & " のH39、R28も数式にします。" & vbCrLf & _
              "実行前にブックを別名保存しましたか？", vbOKCancel + vbQuestion, "DB年度パッチ(長期)") <> vbOK Then Exit Sub

    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    On Error GoTo Fail
    nDone = FixDbLabels(db, s2.Name, "長期")
    s2.Range("H39").Formula = Fm("=`市ﾎｰﾑﾍﾟｰｼﾞ採用予定数×R`&($C$1-1)&`.4新採平均標準報酬【`&TEXT(DB_集計!F14,`#,##0`)&`円】`")
    s2.Range("R28").Formula = Fm("=`市ﾎｰﾑﾍﾟｰｼﾞ採用予定数×R`&($C$1-1)&`.4新採平均標準報酬【`&TEXT(DB_集計!F10,`#,##0`)&`円】`")
Fail:
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description, vbExclamation
    Else
        Application.Calculate
        MsgBox "完了しました。" & vbCrLf & "DB_集計の数式化: " & nDone & " セル" & vbCrLf & s2.Name & "!H39, R28 を数式化", vbInformation, "DB年度パッチ(長期)"
    End If
End Sub

' 書式を短期ブックにそろえる(長期ブック用)
'  ・長期/掛金シートのフォント WenQuanYi Zen Hei → ＭＳ Ｐゴシック、推移シート → HGｺﾞｼｯｸM
'  ・DB_シートは全部 游ゴシック(太字・サイズはそのまま)。DB_設定の小見出しは太字を外す
'  ・DB_シートの1行目の高さ 22.2、ほかの行は自動(DB_集計の4行目だけ 31.95)
Private Sub FixFormats(ByVal k1 As Worksheet, ByVal k2 As Worksheet, ByVal s1 As Worksheet, ByVal s2 As Worksheet)
    Dim ws As Worksheet, nm As Variant, c As Range, p As Variant, v As Variant

    For Each v In Array(k1, k2, s1, s2)
        If Not v Is Nothing Then ReplaceFont v, "WenQuanYi Zen Hei", "ＭＳ Ｐゴシック"
    Next v
    If SheetExists("推移") Then ReplaceFont ThisWorkbook.Worksheets("推移"), "WenQuanYi Zen Hei", "HGｺﾞｼｯｸM"

    For Each nm In Array("DB_使い方", "DB_設定", "DB_集計", "DB_確定版との照合")
        If SheetExists(CStr(nm)) Then
            Set ws = ThisWorkbook.Worksheets(CStr(nm))
            ws.Cells.Font.Name = "游ゴシック"
            ws.UsedRange.Rows.AutoFit
            ws.Rows(1).RowHeight = 22.2
            If CStr(nm) = "DB_集計" Then ws.Rows(4).RowHeight = 31.95
            If CStr(nm) = "DB_設定" Then
                For Each c In ws.Range("A15:A60").Cells
                    For Each p In Array("DBの列の意味", "① 病院機構", "② 専従・病院以外の一般", "③ 特定消防", "共通")
                        If Trim$(Replace(CStr(c.Value), ChrW(&H3000), " ")) Like p & "*" Then c.Font.Bold = False
                    Next p
                Next c
            End If
        End If
    Next nm
End Sub

Private Sub ReplaceFont(ByVal ws As Worksheet, ByVal fromName As String, ByVal toName As String)
    Application.FindFormat.Clear
    Application.ReplaceFormat.Clear
    Application.FindFormat.Font.Name = fromName
    Application.ReplaceFormat.Font.Name = toName
    ws.Cells.Replace What:="", Replacement:="", LookAt:=xlPart, SearchFormat:=True, ReplaceFormat:=True
    Application.FindFormat.Clear
    Application.ReplaceFormat.Clear
End Sub

' ============================================================
'  共通の部品
' ============================================================

' 「令和７年度」「令和7年度」または数字 → 年度の数字(読めなければ0)
Private Function YearOf(ByVal v As Variant) As Long
    Dim t As String
    If IsError(v) Then Exit Function
    If IsEmpty(v) Then Exit Function
    If VarType(v) = vbString Then
        t = CStr(v)
        If t Like "令和*年度" Then
            t = Mid$(t, 3, Len(t) - 4)
            On Error Resume Next
            t = StrConv(t, vbNarrow)
            On Error GoTo 0
            If IsNumeric(t) Then YearOf = CLng(t)
        End If
    ElseIf IsNumeric(v) Then
        YearOf = CLng(v)
    End If
End Function

Private Function NameOf(ByVal ws As Worksheet) As String
    If ws Is Nothing Then NameOf = "(なし)" Else NameOf = ws.Name
End Function

' `(バッククォート)を " に直す(式を読みやすく書くため)
Private Function Fm(ByVal s As String) As String
    Fm = Replace(s, "`", Chr(34))
End Function

Private Function SheetExists(ByVal nm As String) As Boolean
    Dim s As Object
    For Each s In ThisWorkbook.Sheets
        If s.Name = nm Then SheetExists = True: Exit Function
    Next s
End Function

' 「R数字＋suffix」のシートが2枚あるか
Private Function HasPair(ByVal suffix As String) As Boolean
    Dim a As Worksheet, b As Worksheet
    GetPair suffix, a, b
    HasPair = Not (a Is Nothing Or b Is Nothing)
End Function

' 名前が「R数字＋suffix」のシートを、タブの並び順で最初の2枚だけ返す
Private Sub GetPair(ByVal suffix As String, ByRef w1 As Worksheet, ByRef w2 As Worksheet)
    Dim ws As Worksheet
    Set w1 = Nothing: Set w2 = Nothing
    For Each ws In ThisWorkbook.Worksheets
        If ws.Name Like "R#*" & suffix Then
            If ws.Name = "R" & Val(Mid$(ws.Name, 2)) & suffix Then
                If w1 Is Nothing Then
                    Set w1 = ws
                ElseIf w2 Is Nothing Then
                    Set w2 = ws
                End If
            End If
        End If
    Next ws
End Sub

' 一度仮名にしてから付け替える(名前の重複を避けるため)
Private Sub SetPair(ByVal w1 As Worksheet, ByVal w2 As Worksheet, ByVal n As Long, ByVal suffix As String)
    If w1 Is Nothing Then Exit Sub
    w1.Name = "tmp_a"
    If Not w2 Is Nothing Then w2.Name = "tmp_b"
    w1.Name = "R" & n & suffix
    If Not w2 Is Nothing Then w2.Name = "R" & (n + 1) & suffix
End Sub

' 数式が「=C1」または「=$C$1」のセルを ="令和"&C1&"年度" に直す(C1自身は除く)。直した数を返す
Private Function FixC1Refs(ByVal ws As Worksheet) As Long
    Dim rng As Range, c As Range, f As String
    On Error Resume Next
    Set rng = ws.UsedRange.SpecialCells(xlCellTypeFormulas)
    On Error GoTo 0
    If rng Is Nothing Then Exit Function
    For Each c In rng.Cells
        If c.Address(False, False) <> "C1" Then
            f = c.Formula
            If f = "=C1" Or f = "=$C$1" Then
                c.Formula = Fm("=`令和`&C1&`年度`")
                FixC1Refs = FixC1Refs + 1
            End If
        End If
    Next c
End Function

' DB_集計の「R○短期(長期)」「R○.4」を含む文字だけのセルを、s2のC1から出す数式にする。直した数を返す
Private Function FixDbLabels(ByVal db As Worksheet, ByVal s2name As String, ByVal word As String) As Long
    Dim rng As Range, c As Range, f As String
    On Error Resume Next
    Set rng = db.Range("A1:G40").SpecialCells(xlCellTypeConstants, xlTextValues)
    On Error GoTo 0
    If rng Is Nothing Then Exit Function
    For Each c In rng.Cells
        f = LabelFormula(CStr(c.Value), s2name, word)
        If Len(f) > 0 Then
            c.Formula = f
            FixDbLabels = FixDbLabels + 1
        End If
    Next c
End Function

' 「R○短期(長期)」→ "R"&(s2のC1)&"短期(長期)"、「R○.4」→ "R"&(s2のC1-1)&".4"。含まなければ空文字
Private Function LabelFormula(ByVal txt As String, ByVal s2name As String, ByVal word As String) As String
    Dim re As Object, ms As Object, m As Object
    Dim pos As Long, out As String, expr As String
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "R\d+(" & word & "|\.4)"
    re.Global = True
    Set ms = re.Execute(txt)
    If ms.Count = 0 Then Exit Function
    pos = 0
    For Each m In ms
        If m.FirstIndex > pos Then out = out & Lit(Mid$(txt, pos + 1, m.FirstIndex - pos)) & "&"
        If m.SubMatches(0) = word Then
            expr = """R""&'" & s2name & "'!$C$1&""" & word & """"
        Else
            expr = """R""&('" & s2name & "'!$C$1-1)&"".4"""
        End If
        out = out & expr & "&"
        pos = m.FirstIndex + m.Length
    Next m
    If pos < Len(txt) Then
        out = out & Lit(Mid$(txt, pos + 1))
    Else
        out = Left$(out, Len(out) - 1)
    End If
    LabelFormula = "=" & out
End Function

Private Function Lit(ByVal s As String) As String
    Lit = """" & Replace(s, """", """""") & """"
End Function
