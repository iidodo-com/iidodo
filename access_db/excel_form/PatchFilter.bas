Attribute VB_Name = "PatchFilter"
Option Explicit

' 局課名の絞り込みを「空欄=全て／一部の文字でも検索可」に直す(1回だけ実行)
Public Sub PatchFilter()
    Dim w1 As Worksheet, w2 As Worksheet, w3 As Worksheet, n As Long
    Set w1 = ThisWorkbook.Worksheets("入力")
    Set w2 = ThisWorkbook.Worksheets("問題点入力表")
    Set w3 = ThisWorkbook.Worksheets("復命用一覧")

    ' 入力シート U列(抽出・非表示の自動列)
    w1.Range("U2:U2001").Formula = _
        "=IF(AND(B2<>"""",B2='復命用一覧'!$C$2,OR('復命用一覧'!$C$3="""",'復命用一覧'!$C$3=""*"",ISNUMBER(SEARCH('復命用一覧'!$C$3,D2)))),1,0)"

    ' 問題点入力表: 入力件数計 と 各グループ列(G～N)
    w2.Range("E2").Formula = _
        "=SUMIFS(入力!$L$2:$L$2001,入力!$B$2:$B$2001,$B$2,入力!$D$2:$D$2001,""*""&$B$3&""*"")"
    n = w2.Cells(w2.Rows.Count, "O").End(xlUp).Row
    w2.Range("G6:N" & n).Formula = _
        "=IF(G$5="""","""",SUMIFS(入力!$L$2:$L$2001,入力!$T$2:$T$2001,$O6,入力!$B$2:$B$2001,$B$2,入力!$E$2:$E$2001,G$5,入力!$D$2:$D$2001,""*""&$B$3&""*""))"

    ' 見出しの注記
    w3.Range("B3").Value = "対象局課名(空欄=全て)"
    w2.Range("A3").Value = "対象局課名(空欄=全て)"

    Application.Calculation = xlCalculationAutomatic
    Application.Calculate
    MsgBox "直しました。復命用一覧の C3(対象局課名)を空欄にすると全件、文字を入れると一部が合う局課だけが表示されます。", vbInformation
End Sub
