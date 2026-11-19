Attribute VB_Name = "YearPatch"
Option Explicit

' 年度パッチ(第2版)。短期ブック(短期・こども・介護)と、長期ブックの両方に使える。
' ブックを作り直さず、今開いているブックの数式・色だけを書き換える。何度実行しても結果は同じ(上書き)。
' 実行前に必ずブックを別名で保存しておくこと(マクロの結果は元に戻せない)。
' シート保護(パスワードなし)がかかっていても、一時的に解除して、元どおり保護し直す。
'
' 【使い方】 古い YearPatch / ApplyYearPatch / ApplyDbPatch / KaigoYearPatch / YearLabelColor のモジュールを削除してから、これを取り込む。
'   ApplyYearPatch … 年度まわりの数式を当てる(短期ブックは「R数字短期」、長期ブックは「R数字長期」を自動で判別)
'   ApplyDbPatch   … DB_集計のラベルと聴取人数の部分だけを当てる
' シート名の付け替えは SheetRename_v2.bas(RenameSheetsByC1)を使う。
'
' 対象シート(名前ではなく「タブの並び順」で決める。非表示のシートは対象外)
'   短期 / 掛金（短期） / 掛金（子ども） / 介護 / 掛金（介護） / 長期 / 長期掛金 の、それぞれ前のシート=1枚目、後ろのシート=2枚目
Private Const FMT As String = """令和""0""年度"""
Private Const LINK_BONUS As Boolean = True     ' 長期ブック: V6,V12(賞与支給率)を前のシートにリンクする(Falseで行わない)
Private protList As String
Private failedSheets As String

Public Sub ApplyYearPatch()
    If HasPair("短期") Then
        ApplyTanki
    ElseIf HasPair("長期") Then
        ApplyLong
    Else
        MsgBox "「R数字短期」または「R数字長期」のシートが2枚見つかりません。", vbExclamation
    End If
End Sub

Public Sub ApplyDbPatch()
    If HasPair("短期") Then
        DbOnlyTanki
    ElseIf HasPair("長期") Then
        DbLong
    Else
        MsgBox "「R数字短期」または「R数字長期」のシートが2枚見つかりません。", vbExclamation
    End If
End Sub

' ============================================================
'  短期ブック(短期・こども・介護)
'   短期   : s1のC1を数字に(表示「令和N年度」)、s2のC1=s1+1、=C1の参照、賞与支給率(Z5,Z6,Z11,Z12)、
'            E20・H25・H27・Q27・H28・V28の文言、掛金(短期)のA1・P123・R9のD6:D13
'   こども : A1・P123・N124・N127・T61、R9のT55:T60(=前の年度)、R8のB56(誤った参照を訂正)
'   介護   : B1・A1・I22・S36・S37の年度の文言、賞与支給率・特別職の値を短期から、R9掛金のD5をR8から、
'            R8介護のAA18:AH18・Y19(1人当たり平均の誤りを訂正)・Y14、R9介護の文言(R9.3月予想 など)
'   DB     : DB_集計のD8・D14・D18を聴取人数の入力の起点にし、R9短期のD28・S28・D38は数式で受ける。年度ラベルも数式に
'   色     : 数式にしたセルは黄色。R9短期の18行目以降・R9介護の数式もすべて黄色。入力欄(DB_集計のD8・D14・D18、R8短期のC1)は薄いオレンジ。
' ============================================================
Private Sub ApplyTanki()
    Dim s1 As Worksheet, s2 As Worksheet, k1 As Worksheet, k2 As Worksheet
    Dim q1 As Worksheet, q2 As Worksheet, g1 As Worksheet, g2 As Worksheet, h1 As Worksheet, h2 As Worksheet
    Dim n As Long, r As Variant, i As Long, log As String, calcMode As Long, nRef As Long
    Dim c1 As String, c2 As String, v As Variant

    GetPair "短期", s1, s2
    GetPair "掛金（短期）", k1, k2
    GetPair "掛金（子ども）", q1, q2
    GetPair "介護", g1, g2
    GetPair "掛金（介護）", h1, h2
    n = YearOf(s1.Range("C1").Value)
    If n < 2 Then
        MsgBox s1.Name & "!C1 から年度の数字を読み取れません(「令和８年度」または数字が必要): " & CStr(s1.Range("C1").Text), vbExclamation
        Exit Sub
    End If
    If MsgBox("次のシートにパッチを当てます。実行前にブックを別名保存しましたか？" & vbCrLf & vbCrLf & _
              "短期: " & s1.Name & " / " & s2.Name & vbCrLf & _
              "掛金(短期): " & NameOf(k1) & " / " & NameOf(k2) & vbCrLf & _
              "こども: " & NameOf(q1) & " / " & NameOf(q2) & vbCrLf & _
              "介護: " & NameOf(g1) & " / " & NameOf(g2) & vbCrLf & _
              "掛金(介護): " & NameOf(h1) & " / " & NameOf(h2), _
              vbOKCancel + vbQuestion, "年度パッチ(短期・こども・介護)") <> vbOK Then Exit Sub

    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    protList = "": failedSheets = ""
    For Each v In Array(s1, s2, k1, k2, q1, q2, g1, g2, h1, h2)
        Unprot v
    Next v
    If SheetExists("DB_集計") Then Unprot ThisWorkbook.Worksheets("DB_集計")
    If SheetExists("DB_設定") Then Unprot ThisWorkbook.Worksheets("DB_設定")
    If Len(failedSheets) > 0 Then
        Reprot
        Application.Calculation = calcMode
        Application.ScreenUpdating = True
        MsgBox "保護を解除できないシートがあります(パスワードがかかっている可能性があります):" & vbCrLf & failedSheets & vbCrLf & "保護を解除してから、もう一度実行してください。", vbExclamation
        Exit Sub
    End If
    On Error GoTo Fail

    c1 = "'" & s1.Name & "'!$C$1"
    c2 = "'" & s2.Name & "'!$C$1"

    ' ---------------- 短期 ----------------
    s1.Range("C1").Value = n
    s1.Range("C1").NumberFormat = FMT
    s1.Range("C1").Interior.Color = RGB(252, 228, 214)               ' 入力欄(薄いオレンジ)
    PutF s2, "C1", "='" & s1.Name & "'!C1+1"
    s2.Range("C1").NumberFormat = FMT
    nRef = FixC1Refs(s1) + FixC1Refs(s2)
    For Each r In Array("Z5", "Z6", "Z11", "Z12")
        PutF s2, CStr(r), "='" & s1.Name & "'!" & r
    Next r
    PutF s2, "E20", Fm("=`R`&($C$1-1)&`.3月：`&TEXT('" & s1.Name & "'!C16,`#,##0`)&`人→Ｒ`&$C$1&`.3月：`&TEXT(C16,`#,##0`)&`人→`&TEXT(D20,`+#,##0;-#,##0;0`)&`人。`")
    PutF s2, "H25", Fm("=`R`&$C$1&`.3平均標準報酬月額◆`")
    PutF s2, "H27", Fm("=`R`&($C$1-1)&`.3退職実績人数・標準報酬`")
    PutF s2, "Q27", Fm("=`R`&($C$1-1)&`.4実績`")
    If SheetExists("DB_集計") Then
        PutF s2, "H28", Fm("=`病院予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&DB_集計!F7&`円】`")
        PutF s2, "V28", Fm("=`人事課予定数×R`&($C$1-1)&`.4採用平均標準報酬【`&TEXT(DB_集計!F13,`#,##0`)&`円】`")
    End If
    log = log & "短期: C1(" & n & ")、賞与支給率、文言、=C1(" & nRef & "か所)" & vbCrLf
    If Not k1 Is Nothing Then
        PutF k1, "A1", Fm("=`令和`&" & c1 & "&`年度`")
        PutF k1, "P123", "=DATE(2018+" & c1 & ",6,1)"
    End If
    If Not k2 Is Nothing Then
        PutF k2, "A1", Fm("=`令和`&(" & c1 & "+1)&`年度`")
        If Not k1 Is Nothing Then
            PutF k2, "P123", "=EOMONTH('" & k1.Name & "'!P127,3)"
            For i = 6 To 13
                PutF k2, "D" & i, "='" & k1.Name & "'!D" & i
            Next i
        End If
    End If
    If Not k1 Is Nothing Then log = log & "掛金(短期): A1、P123、R9のD6:D13" & vbCrLf

    ' ---------------- こども ----------------
    For Each v In Array(q1, q2)
        If Not v Is Nothing Then
            PutF v, "A1", Fm("=`R`&(YEAR(P123)-2018)")
            v.Range("N124").Value = "子ども・子育て支援金" & vbLf & "掛金負担金 総計"
            v.Range("N127").Formula = "=D94+M94+L109"
            v.Range("T61").Formula = "=ROUND(AVERAGE(T55:T60),0)"
        End If
    Next v
    If Not q1 Is Nothing Then
        If Not k1 Is Nothing Then PutF q1, "P123", "='" & k1.Name & "'!P123"
        PutF q1, "B56", "='" & s1.Name & "'!E20"
        If Not q2 Is Nothing Then
            PutF q2, "P123", "=EOMONTH('" & q1.Name & "'!P127,3)"
            For i = 55 To 60
                PutF q2, "T" & i, "='" & q1.Name & "'!T" & i
            Next i
        End If
        log = log & "こども: A1、P123、N124、N127、T61、B56、R9のT55:T60" & vbCrLf
    End If

    ' ---------------- 介護 ----------------
    If Not g1 Is Nothing Then
        PutF g1, "B1", Fm("=`１　令和`&" & c1 & "&`年度　介護人数・標準報酬等　見込み　`")
        For Each r In Array("Z6", "Z12", "Z15")
            PutF g1, CStr(r), "='" & s1.Name & "'!" & r
        Next r
        PutF g1, "AD7", "='" & s1.Name & "'!AD7"
        For i = 5 To 10
            PutF g1, "M" & i, "='" & s1.Name & "'!M" & i
            PutF g1, "N" & i, "='" & s1.Name & "'!N" & i
        Next i
        PutF g1, "AA18", "=ROUNDDOWN(AA17/AVERAGE(G5:G16),-3)"
        PutF g1, "AB18", "=ROUNDDOWN(AB17/AVERAGE(I5:I16),-3)"
        PutF g1, "AC18", "=ROUNDDOWN(AC17/AVERAGE(K5:K16),-3)"
        PutF g1, "AD18", "=ROUNDDOWN(AD17/AVERAGE(M5:M16),-3)"
        PutF g1, "AF18", "=ROUNDDOWN(AF17/AVERAGE(S5:S16),-3)"
        PutF g1, "AH18", "=ROUNDDOWN(AH17/AVERAGE(U5:U16),-3)"
        PutF g1, "Y19", "=ROUNDDOWN(Y17/D19,-3)"
        PutF g1, "Y14", "=SUM(Z14:AH14)"
        FixRelLabels g1, c1, n
    End If
    If Not g2 Is Nothing Then
        PutF g2, "B1", Fm("=`令和`&JIS(" & c2 & ")&`年度`")
        For Each r In Array("Z6", "Z12", "Z15")
            PutF g2, CStr(r), "='" & s2.Name & "'!" & r
        Next r
        FixRelLabels g2, c2, n + 1
    End If
    If Not h1 Is Nothing Then
        PutF h1, "A1", Fm("=`R`&" & c1 & "&`年度`")
        PutF h1, "I22", Fm("=`還付額実績`&CHAR(10)&`(R`&(" & c1 & "-1)&`.10～R`&" & c1 & "&`.9）`")
        PutF h1, "S36", Fm("=`R`&" & c1 & "&`.9まで実績`")
        PutF h1, "S37", Fm("=`R`&(" & c1 & "-1)&`.10月～R`&" & c1 & "&`.3月実績`")
    End If
    If Not h2 Is Nothing Then
        PutF h2, "A1", Fm("=`R`&" & c2 & "&`年度`")
        If Not h1 Is Nothing Then PutF h2, "D5", "='" & h1.Name & "'!D5"
    End If
    If Not g1 Is Nothing Then log = log & "介護: 年度の文言、賞与支給率、特別職の値、1人当たり平均(AA18:AH18・Y19)、R9掛金D5" & vbCrLf

    ' ---------------- DB_集計(聴取人数・ラベル) ----------------
    If SheetExists("DB_集計") Then log = log & DbPartTanki(s2) & vbCrLf

    ' ---------------- 黄色: R9短期の18行目以降・R9介護の数式 ----------------
    PaintFormulas s2, 18
    If Not g2 Is Nothing Then PaintFormulas g2, 1

Fail:
    Reprot
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    If Err.Number <> 0 Then
        MsgBox "途中で失敗しました: " & Err.Description & vbCrLf & vbCrLf & "ここまでの内容:" & vbCrLf & log, vbExclamation
    Else
        Application.Calculate
        MsgBox "完了しました。" & vbCrLf & vbCrLf & log, vbInformation, "年度パッチ(短期・こども・介護)"
    End If
End Sub

' DB_集計を聴取人数の入力の起点にし(D8,D14,D18)、R9短期のD28,S28,D38を数式で受ける。ラベルも年度から出す
Private Function DbPartTanki(ByVal s2 As Worksheet) As String
    Dim db As Worksheet, cnt As Long, c2 As String, st As Worksheet
    Set db = ThisWorkbook.Worksheets("DB_集計")
    c2 = "'" & s2.Name & "'!$C$1"
    cnt = FixDbLabels(db, s2.Name, "短期")
    PutF db, "F8", "=D8*F7"
    PutF db, "F14", "=D14*F13"
    PutF db, "F18", "=D18*F17"
    PutF db, "G8", Fm("=`人数は聴取値（ここに入力。`&`R`&" & c2 & "&`短期のD28へ流れる）`")
    PutF db, "G14", Fm("=`人数は聴取値（ここに入力。`&`R`&" & c2 & "&`短期のS28へ流れる）`")
    PutF db, "G18", Fm("=`人数は聴取値（ここに入力。`&`R`&" & c2 & "&`短期のD38へ流れる）`")
    db.Range("D8").Interior.Color = RGB(252, 228, 214)
    db.Range("D14").Interior.Color = RGB(252, 228, 214)
    db.Range("D18").Interior.Color = RGB(252, 228, 214)
    PutF s2, "D28", "=DB_集計!D8"
    PutF s2, "S28", "=DB_集計!D14"
    PutF s2, "D38", "=DB_集計!D18"
    If SheetExists("DB_設定") Then
        Set st = ThisWorkbook.Worksheets("DB_設定")
        PutF st, "C10", "='" & s2.Name & "'!D28"
        PutF st, "C11", "='" & s2.Name & "'!S28"
        PutF st, "C12", "='" & s2.Name & "'!D38"
    End If
    DbPartTanki = "DB_集計: 年度ラベル" & cnt & "か所、聴取人数(D8・D14・D18)→R9短期のD28・S28・D38"
End Function

' DB_集計のラベルと聴取人数の部分だけを当てる(短期ブック)
Private Sub DbOnlyTanki()
    Dim s1 As Worksheet, s2 As Worksheet, calcMode As Long, msg As String
    GetPair "短期", s1, s2
    If s2 Is Nothing Or Not SheetExists("DB_集計") Then
        MsgBox "R数字短期のシート(2枚)と DB_集計 が必要です。", vbExclamation
        Exit Sub
    End If
    If IsEmpty(s2.Range("C1").Value) Or Not IsNumeric(s2.Range("C1").Value) Then
        MsgBox s2.Name & "!C1 が数字ではありません。先に ApplyYearPatch を実行してください。", vbExclamation
        Exit Sub
    End If
    calcMode = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    protList = "": failedSheets = ""
    Unprot s2
    Unprot ThisWorkbook.Worksheets("DB_集計")
    If SheetExists("DB_設定") Then Unprot ThisWorkbook.Worksheets("DB_設定")
    If Len(failedSheets) = 0 Then msg = DbPartTanki(s2)
    Reprot
    Application.Calculation = calcMode
    Application.ScreenUpdating = True
    Application.Calculate
    If Len(failedSheets) > 0 Then MsgBox "保護を解除できないシートがあります: " & vbCrLf & failedSheets, vbExclamation Else MsgBox msg, vbInformation
End Sub

' ============================================================
'  長期ブック(旧称 介護)
'   1. s1のC1を数字にして、表示形式を「"令和"0"年度"」にする(「令和７年度」→ 7。全角でも可)
'   2. s2のC1 = s1のC1 + 1                 3. 「=C1」と参照している数式を ="令和"&C1&"年度" にする
'   4. s2のV6,V12(賞与支給率) = s1の同じセル(V15は対象外)   ※LINK_BONUS を False にすると行わない
'   5. s2のH25,H27,H38,H39,R28 を、C1の年度(とDB_集計の平均標準報酬額)から作る数式にする
'   6. k1,k2のA1(「R８年度」など)を s1のC1 から自動で出す
'   7. DB_集計の年度ラベル(「R○長期」「R○.4」)をC1から出す数式にする
'   8. フォント・太字・行の高さを短期ブックにそろえる
' ============================================================
Private Sub ApplyLong()
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
Private Sub DbLong()
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

' 「R数字＋suffix」の表示中のシートが2枚あるか
Private Function HasPair(ByVal suffix As String) As Boolean
    Dim a As Worksheet, b As Worksheet
    GetPair suffix, a, b
    HasPair = Not (a Is Nothing Or b Is Nothing)
End Function

' 名前が「R数字＋suffix」の表示中のシートを、タブの並び順で最初の2枚だけ返す
Private Sub GetPair(ByVal suffix As String, ByRef w1 As Worksheet, ByRef w2 As Worksheet)
    Dim ws As Worksheet
    Set w1 = Nothing: Set w2 = Nothing
    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = xlSheetVisible Then
            If ws.Name Like "R#*" & suffix Then
                If ws.Name = "R" & Val(Mid$(ws.Name, 2)) & suffix Then
                    If w1 Is Nothing Then
                        Set w1 = ws
                    ElseIf w2 Is Nothing Then
                        Set w2 = ws
                    End If
                End If
            End If
        End If
    Next ws
End Sub

' ---- シート保護(パスワードなし)の一時解除と再保護
Private Sub Unprot(ByVal ws As Object)
    If ws Is Nothing Then Exit Sub
    If ws.ProtectContents Then
        On Error Resume Next
        ws.Unprotect
        On Error GoTo 0
        If ws.ProtectContents Then
            failedSheets = failedSheets & "  " & ws.Name & vbCrLf
        Else
            protList = protList & ws.Name & "|"
        End If
    End If
End Sub

Private Sub Reprot()
    Dim nm As Variant
    For Each nm In Split(protList, "|")
        If Len(nm) > 0 Then ThisWorkbook.Worksheets(CStr(nm)).Protect DrawingObjects:=True, Contents:=True, Scenarios:=True
    Next nm
    protList = ""
End Sub

' 数式を入れて、黄色にする(表示形式が「文字列」のときは「標準」に直す)
Private Sub PutF(ByVal ws As Object, ByVal addr As String, ByVal f As String)
    If ws Is Nothing Then Exit Sub
    If ws.Range(addr).NumberFormat = "@" Then ws.Range(addr).NumberFormat = "General"
    ws.Range(addr).Formula = f
    ws.Range(addr).Interior.Color = RGB(255, 255, 0)
End Sub

' 指定行以降の、数式があるセルをすべて黄色にする
Private Sub PaintFormulas(ByVal ws As Worksheet, ByVal minRow As Long)
    Dim rng As Range, c As Range
    On Error Resume Next
    Set rng = ws.UsedRange.SpecialCells(xlCellTypeFormulas)
    On Error GoTo 0
    If rng Is Nothing Then Exit Sub
    For Each c In rng.Cells
        If c.Row >= minRow Then c.Interior.Color = RGB(255, 255, 0)
    Next c
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
                c.Interior.Color = RGB(255, 255, 0)
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
            c.Interior.Color = RGB(255, 255, 0)
            FixDbLabels = FixDbLabels + 1
        End If
    Next c
End Function

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

' 文字だけのセルにある「R9」「Ｒ８」「令和９年度」を、年度から出す数式に直す(介護のシート用)。
'   yrRef: 年度の数字を返す式(例 'R9短期'!$C$1)、yr: このシートの年度(R9介護なら9)。
'   前年度・翌年度(ずれ -1～+1)以外の古い年度の注記(例 R5)は、そのまま残す。
Private Sub FixRelLabels(ByVal ws As Worksheet, ByVal yrRef As String, ByVal yr As Long)
    Dim rng As Range, c As Range, f As String
    On Error Resume Next
    Set rng = ws.UsedRange.SpecialCells(xlCellTypeConstants, xlTextValues)
    On Error GoTo 0
    If rng Is Nothing Then Exit Sub
    For Each c In rng.Cells
        f = RelFormula(CStr(c.Value), yrRef, yr)
        If Len(f) > 0 Then
            c.Formula = f
            c.Interior.Color = RGB(255, 255, 0)
        End If
    Next c
End Sub

Private Function RelFormula(ByVal txt As String, ByVal yrRef As String, ByVal yr As Long) As String
    Dim re As Object, ms As Object, m As Object
    Dim pos As Long, out As String, d As Long, dd As String, ex As String, full As Boolean
    Set re = CreateObject("VBScript.RegExp")
    re.Pattern = "([RＲ])([0-9０-９]+)|令和([0-9０-９]+)年度"
    re.Global = True
    Set ms = re.Execute(txt)
    If ms.Count = 0 Then Exit Function
    For Each m In ms
        If Len(m.SubMatches(1) & "") > 0 Then dd = m.SubMatches(1) Else dd = m.SubMatches(2)
        d = CLng(StrConv(dd, vbNarrow)) - yr
        If d < -1 Or d > 1 Then Exit Function
    Next m
    pos = 0
    For Each m In ms
        If Len(m.SubMatches(1) & "") > 0 Then dd = m.SubMatches(1) Else dd = m.SubMatches(2)
        d = CLng(StrConv(dd, vbNarrow)) - yr
        full = (StrConv(dd, vbNarrow) <> dd)
        ex = yrRef
        If d > 0 Then ex = ex & "+" & d
        If d < 0 Then ex = ex & d
        ex = "(" & ex & ")"
        If full Then ex = "JIS" & ex
        If m.FirstIndex > pos Then out = out & Lit(Mid$(txt, pos + 1, m.FirstIndex - pos)) & "&"
        If Len(m.SubMatches(0) & "") > 0 Then
            out = out & Lit(m.SubMatches(0)) & "&" & ex & "&"
        Else
            out = out & """令和""&" & ex & "&""年度""&"
        End If
        pos = m.FirstIndex + m.Length
    Next m
    If pos < Len(txt) Then
        out = out & Lit(Mid$(txt, pos + 1))
    Else
        out = Left$(out, Len(out) - 1)
    End If
    RelFormula = "=" & out
End Function

Private Function Lit(ByVal s As String) As String
    Lit = """" & Replace(s, """", """""") & """"
End Function
