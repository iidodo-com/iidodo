<#
.SYNOPSIS
  日本語で書いた要件から、式ライブラリ（expressions/）の該当する式を探して出力する。

.DESCRIPTION
  ./expressions/ の各ファイル先頭にある「キーワード」と要件を照合し、最も一致するファイルから
  「用途／式／入力の想定／出力例／よくある誤り／検証方法（Compose）」を出力する。
  ライブラリにない式は作らない（推測で式を書かないための仕様）。該当がなければ終了コード 2 を返す。

  Windows PowerShell 5.1 で動作する書き方に限定している（外部モジュール・ネットワーク不要）。

.PARAMETER Requirement
  日本語の要件。例: "日本時間の今日の日付を yyyy/MM/dd で出したい"

.PARAMETER List
  ライブラリの一覧（ID・用途・キーワード）を表示して終了する。

.PARAMETER Id
  要件の照合を行わず、指定した ID（例: E03）の式を出力する。

.PARAMETER Param
  式中の <名前> を置き換える。例: -Param @{ '値' = "triggerBody()?['name']" }

.PARAMETER Top
  上位何件を出力するか（既定 1）。

.PARAMETER OutFile
  指定すると、結果を UTF-8（BOM 付き）でファイルにも保存する。

.PARAMETER ExpressionsDir
  式ライブラリのフォルダー（既定: このスクリプトの ../expressions）。

.EXAMPLE
  .\make_expression.ps1 -Requirement "翌営業日を求めたい（土日は除く）"

.EXAMPLE
  .\make_expression.ps1 -List

.EXAMPLE
  .\make_expression.ps1 -Id E07 -Param @{ '値' = "triggerBody()?['comment']" }
#>
[CmdletBinding()]
param(
    [string]$Requirement = '',
    [switch]$List,
    [string]$Id = '',
    [hashtable]$Param = @{},
    [int]$Top = 1,
    [string]$OutFile = '',
    [string]$ExpressionsDir = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrEmpty($ExpressionsDir)) {
    $ExpressionsDir = Join-Path (Join-Path $PSScriptRoot '..') 'expressions'
}

# --- 式ライブラリを読む共通部品（build_guide と共用） ---
. (Join-Path $PSScriptRoot '_expr_lib.ps1')

# --- 検証ケース（### Exx_n）のうち、観察ではないものを先頭から n 件取り出す ---
function Get-VerifyCases($SectionLines, [int]$Max) {
    $out = New-Object System.Collections.ArrayList
    $blocks = New-Object System.Collections.ArrayList
    $curBlock = $null
    foreach ($ln in $SectionLines) {
        if ($ln.StartsWith('### ')) {
            $curBlock = New-Object System.Collections.ArrayList
            [void]$curBlock.Add($ln)
            [void]$blocks.Add($curBlock)
        }
        elseif ($null -ne $curBlock) {
            [void]$curBlock.Add($ln)
        }
    }
    $n = 0
    foreach ($b in $blocks) {
        if ($b[0].Contains('【観察】') -or $b[0].Contains('【誤りの再現】') -or $b[0].Contains('【前提確認】') -or $b[0].Contains('【範囲外の再現】')) { continue }
        foreach ($l in $b) { [void]$out.Add($l) }
        $n++
        if ($n -ge $Max) { break }
    }
    return ,$out
}

function Trim-Blank($Lines) {
    $arr = New-Object System.Collections.ArrayList
    foreach ($l in $Lines) { [void]$arr.Add($l) }
    while ($arr.Count -gt 0 -and $arr[0].Trim() -eq '') { $arr.RemoveAt(0) }
    while ($arr.Count -gt 0 -and $arr[$arr.Count - 1].Trim() -eq '') { $arr.RemoveAt($arr.Count - 1) }
    return ,$arr
}

$lib = Get-Library $ExpressionsDir
if ($lib.Count -eq 0) {
    Write-Error "式ライブラリにファイルがありません: $ExpressionsDir"
    exit 1
}

# --- 一覧表示 ---
if ($List) {
    $buf = New-Object System.Collections.ArrayList
    [void]$buf.Add('# 式ライブラリの一覧')
    [void]$buf.Add('')
    foreach ($e in $lib) {
        [void]$buf.Add(('- {0}: {1}（{2}）' -f $e.Id, $e.Title, $e.File))
        [void]$buf.Add(('    キーワード: ' + ($e.Keywords -join ', ')))
    }
    $text = ($buf -join "`r`n")
    Write-Output $text
    if ($OutFile -ne '') {
        [System.IO.File]::WriteAllText($OutFile, $text + "`r`n", (New-Object System.Text.UTF8Encoding($true)))
    }
    exit 0
}

# --- 候補の選定 ---
$ranked = New-Object System.Collections.ArrayList
if ($Id -ne '') {
    foreach ($e in $lib) {
        if ($e.Id -eq $Id) {
            [void]$ranked.Add((New-Object PSObject -Property @{ Entry = $e; Score = 999; Hits = @('（ID 指定）') }))
        }
    }
    if ($ranked.Count -eq 0) {
        Write-Output ("ID '{0}' の式はライブラリにありません。-List で一覧を確認してください。" -f $Id)
        exit 2
    }
}
else {
    if ([string]::IsNullOrWhiteSpace($Requirement)) {
        Write-Output '要件を -Requirement で指定してください（例: -Requirement "翌営業日を求めたい"）。一覧は -List で表示できます。'
        exit 1
    }
    $ranked = @(Get-RankedExpr $lib $Requirement)
    if ($ranked.Count -eq 0) {
        $msg = New-Object System.Collections.ArrayList
        [void]$msg.Add('該当する式がライブラリにありません。')
        [void]$msg.Add('このツールはライブラリにある式だけを出力します（推測で式を作りません）。')
        [void]$msg.Add('')
        [void]$msg.Add('現在ある式:')
        foreach ($e in $lib) { [void]$msg.Add(('- {0}: {1}' -f $e.Id, $e.Title)) }
        [void]$msg.Add('')
        [void]$msg.Add('新しい用途の式が必要な場合は、式を追加（expressions/ にファイルを追加）し、Compose で検証してください。')
        $text = ($msg -join "`r`n")
        Write-Output $text
        if ($OutFile -ne '') {
            [System.IO.File]::WriteAllText($OutFile, $text + "`r`n", (New-Object System.Text.UTF8Encoding($true)))
        }
        exit 2
    }
}

if ($Top -lt 1) { $Top = 1 }

# --- 出力の組み立て ---
$out = New-Object System.Collections.ArrayList
[void]$out.Add('# 式の提案')
[void]$out.Add('')
if ($Id -eq '') { [void]$out.Add('- 要件: ' + $Requirement) }

$shown = 0
foreach ($r in $ranked) {
    if ($shown -ge $Top) { break }
    $e = $r.Entry
    $sec = Get-Sections $e.Lines
    [void]$out.Add(('- 採用: {0}（ID: {1} / ファイル: expressions/{2}）' -f $e.Title, $e.Id, $e.File))
    [void]$out.Add('- 一致したキーワード: ' + ($r.Hits -join ', '))
    [void]$out.Add('- 検証状況: ' + $e.Status)
    [void]$out.Add('')
    foreach ($name in @('用途', '式（貼り付け用）', '入力の想定', '出力例', 'よくある誤り')) {
        if ($sec.Contains($name)) {
            [void]$out.Add('## ' + $name)
            [void]$out.Add('')
            foreach ($l in (Trim-Blank $sec[$name])) { [void]$out.Add($l) }
            [void]$out.Add('')
        }
    }
    [void]$out.Add('## 検証方法（Compose）')
    [void]$out.Add('')
    [void]$out.Add('1. 手動でトリガーするテスト用フローを作り、「作成（Compose）」アクションを追加する。')
    [void]$out.Add('2. Compose の入力欄で「式」タブ（fx）を開き、下の検証用の式を貼り付ける（先頭の @ は不要）。')
    [void]$out.Add('3. フローを保存して手動実行し、実行履歴で Compose の出力を開いて、期待出力と一致するか確認する。')
    [void]$out.Add('4. 他のケースと、観察ケースを含む全手順は expressions/VERIFY.md を参照。')
    [void]$out.Add('')
    $vsec = $null
    foreach ($key in $sec.Keys) { if ($key.StartsWith('検証')) { $vsec = $sec[$key] } }
    if ($null -ne $vsec) {
        foreach ($l in (Trim-Blank (Get-VerifyCases $vsec 3))) { [void]$out.Add($l) }
        [void]$out.Add('')
    }
    $shown++
}

if ($ranked.Count -gt $shown) {
    [void]$out.Add('## 他の候補')
    [void]$out.Add('')
    for ($i = $shown; $i -lt $ranked.Count; $i++) {
        $e2 = $ranked[$i].Entry
        [void]$out.Add(('- {0}: {1}（一致: {2}）' -f $e2.Id, $e2.Title, ($ranked[$i].Hits -join ', ')))
    }
    [void]$out.Add('')
    [void]$out.Add('他の候補を見るには -Id（例: -Id ' + $ranked[$shown].Entry.Id + '）か -Top 2 を指定する。')
}

$text = ($out -join "`r`n")

# --- <名前> の置換 ---
foreach ($key in $Param.Keys) {
    $text = $text.Replace('<' + [string]$key + '>', [string]$Param[$key])
}

Write-Output $text
if ($OutFile -ne '') {
    [System.IO.File]::WriteAllText($OutFile, $text + "`r`n", (New-Object System.Text.UTF8Encoding($true)))
}
exit 0
