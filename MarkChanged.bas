Attribute VB_Name = "MarkChanged"
Option Explicit

' 修正で「数字が変わった」セルに、赤字とコメント(修正前→修正後・理由)を付ける。
' 長期(R数字長期)・介護(R数字介護)・短期・掛金(短期/子ども)の各ブックで使える。該当するシートが無いブックでは、その分は何もしない。
' 何度実行しても同じ結果(すでにコメントがあれば、追記しない)。ポップアップは出さない(失敗したときだけ表示)。
' シート保護(パスワードなし)がかかっていても、一時的に解除して、元どおり保護し直す。
' 「前」「後ろ」は、タブの並び順(表示中のシートのみ)で決める。
Private failed As String

Public Sub MarkChangedCells()
    failed = ""
    Mark "介護", 1, "AA18", "2,048,000円", "2,086,000円", "3月の人数で割っていた式を、年間の平均人数で割る方式(短期と同じ)に直した"
    Mark "介護", 1, "AB18", "2,098,000円", "2,153,000円", "3月の人数で割っていた式を、年間の平均人数で割る方式(短期と同じ)に直した"
    Mark "介護", 1, "AC18", "0円", "3,536,000円", "参照先が標準報酬の列(J)になっていた誤りを、人数の列(K)に直し、年間の平均人数で割る方式にした"
    Mark "介護", 1, "AF18", "594,238,000円", "812,000円", "参照先が人数の列(M)になっていた誤りを、短期組合員(病院以外)のS列に直し、年間の平均人数で割る方式にした"
    Mark "介護", 1, "AH18", "2,077,000円", "2,151,000円", "3月の人数で割っていた式を、年間の平均人数で割る方式(短期と同じ)に直した"
    Mark "介護", 1, "Y19", "1,561,000円", "1,571,000円", "3月の人数(C16)で割っていた式を、年間の平均人数(D19)で割る方式(短期と同じ)に直した"
    Mark "掛金（短期）", 1, "Q98", "1,318,975", "1,318,976", "端数調整の「-1」をやめた(今年度から調整しないため)"
    Mark "掛金（短期）", 2, "H135", "197,632", "197,631", "端数調整の「+1」をやめた(今年度から調整しないため)"
    Mark "掛金（短期）", 2, "P135", "197,632", "197,631", "H135の端数調整をやめた影響"
    Mark "掛金（短期）", 2, "Q135", "202,079", "202,078", "H135の端数調整をやめた影響"
    Mark "掛金（子ども）", 1, "B56", "0", "7,340,000", "空白のセル(R8短期!F19)を参照していた誤りを、短期の掛金シートと同じR8短期!E20に直した"
    Mark "掛金（子ども）", 1, "B53", "11,320,000", "3,980,000", "B56(=B58-B56)の修正の影響"
    Mark "掛金（子ども）", 2, "P123", "2027/6/1", "2027/6/30", "手入力の日付を、前年度の3月末の3か月後を求める数式に変えた(表示は「令和9年度・6月」のまま)"
    Mark "短期", 2, "E20", "R8.3月：19,360人→R9.3月：19,548人", "R8.3月：19,346人→R9.3月：19,534人(+188人は同じ)", "手入力の文言だった数字が、実際の人数(C16)と違っていたため、数式にして実際の値が出るようにした"
    Mark "長期", 1, "W16", "510,783,000円", "503,918,000円", "3月分の期末手当を、人数で割り戻さず、12月実績を支給率で按分する方式(短期の当年度と同じ)に直した"
    Mark "長期", 1, "X16", "1,433,724,000円", "1,411,665,000円", "3月分の期末手当を、人数で割り戻さず、12月実績を支給率で按分する方式(短期の当年度と同じ)に直した"
    Mark "長期", 1, "AA16", "218,775,000円", "208,723,000円", "3月分の期末手当を、人数で割り戻さず、12月実績を支給率で按分する方式(短期の当年度と同じ)に直した"
    Mark "長期", 1, "U16", "2,167,428,000円", "2,128,452,000円", "3月分の修正の影響(合計)"
    Mark "長期", 1, "U17", "21,924,282,000円", "21,885,306,000円", "3月分の修正の影響(年間総額)"
    Mark "長期", 1, "W18", "1,605,814円", "1,590,000円", "年間の平均人数で割って千円未満を切り捨てる方式(短期と同じ)に直した"
    Mark "長期", 1, "X18", "1,731,064円", "1,726,000円", "年間の平均人数で割って千円未満を切り捨てる方式(短期と同じ)に直した"
    Mark "長期", 1, "AA18", "1,670,942円", "1,660,000円", "年間の平均人数で割って千円未満を切り捨てる方式(短期と同じ)に直した"
    Mark "長期", 1, "U19", "1,695,089円", "1,686,000円", "年間の平均人数で割って千円未満を切り捨てる方式(短期と同じ)に直した"
    Mark "長期", 1, "X19", "1,696,313円", "1,693,000円", "年間の平均人数で割って千円未満を切り捨てる方式(短期と同じ)に直した(千円未満の切り捨てを付けた)"
    Mark "長期", 2, "V6", "2.125", "2.1", "R7長期のV6へのリンクにした(賞与支給率を前の年度と同じにする)。2.125に戻すときは、直接入力してください"
    Mark "長期", 2, "V12", "2.125", "2.1", "R7長期のV12へのリンクにした(賞与支給率を前の年度と同じにする)。2.125に戻すときは、直接入力してください"
    If Len(failed) > 0 Then MsgBox "次のシートは、保護の解除ができず、印を付けられませんでした(パスワードがかかっている可能性があります):" & vbCrLf & failed, vbExclamation
End Sub

Private Sub Mark(ByVal fam As String, ByVal pos As Long, ByVal addr As String, ByVal before As String, ByVal after As String, ByVal why As String)
    Dim ws As Worksheet, prot As Boolean, txt As String, c As Range
    Set ws = FindSheet(fam, pos)
    If ws Is Nothing Then Exit Sub
    txt = "数字が変わりました" & vbLf & "修正前: " & before & vbLf & "修正後: " & after & vbLf & "理由: " & why
    prot = ws.ProtectContents
    If prot Then
        On Error Resume Next
        ws.Unprotect
        On Error GoTo 0
        If ws.ProtectContents Then
            If InStr(failed, ws.Name) = 0 Then failed = failed & "  " & ws.Name & vbCrLf
            Exit Sub
        End If
    End If
    Set c = ws.Range(addr)
    c.Font.Color = RGB(255, 0, 0)
    If c.Comment Is Nothing Then
        c.AddComment txt
    ElseIf InStr(c.Comment.Text, "数字が変わりました") = 0 Then
        c.Comment.Text c.Comment.Text & vbLf & vbLf & txt
    End If
    On Error Resume Next
    c.Comment.Shape.TextFrame.Characters.Font.Color = RGB(255, 0, 0)
    c.Comment.Shape.TextFrame.AutoSize = True
    On Error GoTo 0
    If prot Then ws.Protect DrawingObjects:=True, Contents:=True, Scenarios:=True
End Sub

' 名前が「R数字＋fam」の表示中のシートの、pos番目(1=前、2=後ろ)を返す
Private Function FindSheet(ByVal fam As String, ByVal pos As Long) As Worksheet
    Dim ws As Worksheet, k As Long
    For Each ws In ThisWorkbook.Worksheets
        If ws.Visible = xlSheetVisible Then
            If ws.Name Like "R#*" & fam Then
                If ws.Name = "R" & Val(Mid$(ws.Name, 2)) & fam Then
                    k = k + 1
                    If k = pos Then Set FindSheet = ws: Exit Function
                End If
            End If
        End If
    Next ws
End Function
