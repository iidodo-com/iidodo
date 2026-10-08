<#
.SYNOPSIS
  日本語の業務手順書（Markdown）から、画面で組み立てるための構築手順書を出力する。

.DESCRIPTION
  入力の書式は docs/spec_format.md に定義している。
  出力する構築手順書には、次のものを含める。
    ・トリガーの種類と設定値
    ・アクションごとの コネクタ名／アクション名（英語表示名と日本語表示名の併記）／各項目の設定値／使う式
    ・エラー処理（「実行条件の構成（Run after）」とスコープを使った失敗時通知）
    ・構築後のテスト手順（テストデータと期待結果）
  アクション名・項目名は samples/ のサンプルにある書き方だけを根拠にする。
  サンプルにないものは推測で書かず、「要確認（サンプルなし）」と表示して一覧にまとめる。
  JSON を丸ごと生成してインポートする方式は採らない（画面で人が組み立てる前提）。

  Windows PowerShell 5.1 で動作する書き方に限定している（外部モジュール・ネットワーク不要）。

.PARAMETER Spec
  業務手順書（.md）のパス。

.PARAMETER OutFile
  指定すると、構築手順書（Markdown）を UTF-8（BOM 付き）で保存する。

.PARAMETER Html
  指定すると、HTML 版（コピーボタン・チェック欄つき）を保存する。

.PARAMETER ExpressionsDir
  式ライブラリのフォルダー（既定: このスクリプトの ../expressions）。

.EXAMPLE
  .\build_guide.ps1 .\docs\spec_example.md

.EXAMPLE
  .\build_guide.ps1 .\docs\spec_example.md -OutFile .\output\guide.md -Html .\output\guide.html
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][string]$Spec,
    [string]$OutFile = '',
    [string]$Html = '',
    [string]$ExpressionsDir = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '_expr_lib.ps1')
. (Join-Path $PSScriptRoot '_figures.ps1')   # 画面の見取り図（SVG）
if ([string]::IsNullOrEmpty($ExpressionsDir)) {
    $ExpressionsDir = Join-Path (Join-Path $PSScriptRoot '..') 'expressions'
}
if (-not (Test-Path -LiteralPath $Spec)) {
    Write-Output ('業務手順書が見つかりません: ' + $Spec)
    exit 1
}

# ===================== 表示用の印 =====================
$M_UI    = '［画面で確認済み］'
$M_JSON  = '［サンプルで確認済み］'
$M_GUESS = '［想定］'
$M_NG    = '［要確認（サンプルなし）］'

$script:O = New-Object System.Collections.ArrayList
function L([string]$s) { [void]$script:O.Add($s) }
$script:Unconfirmed = New-Object System.Collections.ArrayList
function Add-Unconfirmed([string]$where, [string]$what) {
    $key = $where + '｜' + $what
    if (-not $script:Unconfirmed.Contains($key)) { [void]$script:Unconfirmed.Add($key) }
}
$script:Warnings = New-Object System.Collections.ArrayList
function Add-Warning([string]$s) { if (-not $script:Warnings.Contains($s)) { [void]$script:Warnings.Add($s) } }

function Norm([string]$s) {
    if ($null -eq $s) { return '' }
    return (($s -replace '[\s　]', '').ToLowerInvariant())
}
function Cell([string]$s) {
    if ($null -eq $s) { return '' }
    return (($s -replace '\|', '\|') -replace '[\r\n]+', ' ')
}

# ===================== 動作のカタログ（サンプルで裏付けのあるものだけ） =====================
# Ui    : 画面の項目名（英語表示）。UiSeen = 実際の画面で見えた名前か
# Json  : サンプルでの書き方。JsonOk = サンプルにある
$Catalog = [ordered]@{}
$Catalog['InitVar'] = @{
    Aliases = @('変数の初期化', '変数を初期化', '変数を用意', '変数を作る')
    Connector = '組み込み（変数）'; ConnectorSeen = $false
    En = 'Initialize variable'; EnSeen = $false
    JsonType = 'InitializeVariable'
    Sample = 'samples/actions/variables__initialize_variable__basic.json'
}
$Catalog['Scope'] = @{
    Aliases = @('スコープ', 'まとめる')
    Connector = '組み込み（コントロール）'; ConnectorSeen = $false
    En = 'Scope'; EnSeen = $false
    JsonType = 'Scope'
    Sample = 'samples/actions/control__scope__run_after_failed.json'
}
$Catalog['ExcelList'] = @{
    Aliases = @('Excel表の行を一覧表示', 'Excel一覧取得', '表の行を一覧表示', 'Excelの表の行を一覧表示', 'Excelの表から行を取得')
    Connector = 'Excel Online (Business)'; ConnectorSeen = $true
    En = 'List rows present in a table'; EnSeen = $true
    JsonType = 'OpenApiConnection'
    Sample = 'samples/actions/excel__list_rows_in_table__pagination_off.json'
}
$Catalog['Foreach'] = @{
    Aliases = @('それぞれに適用', '繰り返し', 'ApplyToEach', '1件ずつ処理')
    Connector = '組み込み（コントロール）'; ConnectorSeen = $false
    En = 'Apply to each'; EnSeen = $true
    JsonType = 'Foreach'
    Sample = 'samples/actions/control__apply_to_each__concurrency_off.json'
}
$Catalog['Compose'] = @{
    Aliases = @('作成', 'Compose')
    Connector = '組み込み（データ操作）'; ConnectorSeen = $false
    En = 'Compose'; EnSeen = $true
    JsonType = 'Compose'
    Sample = 'samples/actions/control__apply_to_each__concurrency_off.json（中の Compose）'
}
$Catalog['Mail'] = @{
    Aliases = @('メール送信', 'メールを送る', 'メールを送信', 'メールの送信')
    Connector = 'Office 365 Outlook'; ConnectorSeen = $false
    En = 'Send an email (V2)'; EnSeen = $true
    JsonType = 'OpenApiConnection'
    Sample = 'samples/actions/control__scope__run_after_failed.json（中の Send_an_email_(V2)）'
}

function Get-ActionName([string]$kind) {
    return ($Catalog[$kind].En -replace ' ', '_')
}

# ===================== 業務手順書の読み込み =====================
function Split-Bullet([string]$ln) {
    $t = $ln.Trim()
    if (-not ($t.StartsWith('- ') -or $t.StartsWith('・'))) { return $null }
    $body = $t.Substring(1).Trim()
    $i1 = $body.IndexOf(':')
    $i2 = $body.IndexOf('：')
    $idx = -1
    if ($i1 -ge 0 -and $i2 -ge 0) { $idx = [Math]::Min($i1, $i2) }
    elseif ($i1 -ge 0) { $idx = $i1 }
    elseif ($i2 -ge 0) { $idx = $i2 }
    if ($idx -lt 1) { return $null }
    return @{ Label = $body.Substring(0, $idx).Trim(); Value = $body.Substring($idx + 1).Trim() }
}

function Get-Field($Fields, [string[]]$Names) {
    foreach ($f in $Fields) {
        $n = Norm $f.Label
        foreach ($x in $Names) { if ($n -eq (Norm $x)) { return $f.Value } }
    }
    return $null
}

function Read-Spec([string]$Path) {
    $lines = Read-Utf8Lines $Path
    $d = @{
        Title = ''
        Purpose = New-Object System.Collections.ArrayList
        Prep = New-Object System.Collections.ArrayList
        TriggerFields = New-Object System.Collections.ArrayList
        Steps = New-Object System.Collections.ArrayList
        ErrorFields = New-Object System.Collections.ArrayList
        HasErrorSection = $false
        Tests = New-Object System.Collections.ArrayList
        Problems = New-Object System.Collections.ArrayList
    }
    $section = ''
    $step = $null
    $cur = $null
    $test = $null
    $auto = 0
    foreach ($raw in $lines) {
        $ln = $raw.TrimEnd()
        if ($ln.Trim() -eq '') { continue }
        if ($ln.StartsWith('# ') -and $d.Title -eq '') { $d.Title = $ln.Substring(2).Trim(); continue }
        if ($ln.StartsWith('## ')) {
            $name = Norm ($ln.Substring(3))
            $section = ''
            foreach ($s in @('目的', '事前準備', 'トリガー', '手順', 'エラー処理', 'テスト')) {
                if ($name.StartsWith((Norm $s))) { $section = $s }
            }
            if ($section -eq '') { [void]$d.Problems.Add('未知の章「' + $ln.Substring(3).Trim() + '」は読み飛ばしました。') }
            if ($section -eq 'エラー処理') { $d.HasErrorSection = $true }
            $step = $null; $cur = $null; $test = $null
            continue
        }
        if ($ln.StartsWith('#### ') -and $section -eq '手順') {
            if ($null -eq $step) { [void]$d.Problems.Add('親の手順がない子の手順「' + $ln.Substring(5).Trim() + '」は読み飛ばしました。'); continue }
            $h = $ln.Substring(5).Trim()
            $m = [regex]::Match($h, '^(\d+(?:-\d+)*)[\.．、]?\s*(.*)$')
            $num = ''
            $ttl = $h
            if ($m.Success) { $num = $m.Groups[1].Value; $ttl = $m.Groups[2].Value }
            $c = @{ Num = $num; Title = $ttl; Fields = New-Object System.Collections.ArrayList; Children = New-Object System.Collections.ArrayList; Parent = $step; Kind = '' }
            [void]$step.Children.Add($c)
            $cur = $c
            continue
        }
        if ($ln.StartsWith('### ')) {
            $h = $ln.Substring(4).Trim()
            if ($section -eq '手順') {
                $m = [regex]::Match($h, '^(\d+(?:-\d+)*)[\.．、]?\s*(.*)$')
                $auto++
                $num = [string]$auto
                $ttl = $h
                if ($m.Success) { $num = $m.Groups[1].Value; $ttl = $m.Groups[2].Value }
                $step = @{ Num = $num; Title = $ttl; Fields = New-Object System.Collections.ArrayList; Children = New-Object System.Collections.ArrayList; Parent = $null; Kind = '' }
                [void]$d.Steps.Add($step)
                $cur = $step
            }
            elseif ($section -eq 'テスト') {
                $test = @{ Title = ($h -replace '^テスト\s*\d*\s*[:：]?\s*', ''); Fields = New-Object System.Collections.ArrayList }
                if ($test.Title -eq '') { $test.Title = $h }
                [void]$d.Tests.Add($test)
            }
            continue
        }
        $b = Split-Bullet $ln
        switch ($section) {
            '目的'       { [void]$d.Purpose.Add(($ln.Trim() -replace '^[-・]\s*', '')) }
            '事前準備'   { [void]$d.Prep.Add(($ln.Trim() -replace '^[-・]\s*', '')) }
            'トリガー'   { if ($null -ne $b) { [void]$d.TriggerFields.Add($b) } }
            'エラー処理' { if ($null -ne $b) { [void]$d.ErrorFields.Add($b) } }
            '手順'       { if ($null -ne $b -and $null -ne $cur) { [void]$cur.Fields.Add($b) } }
            'テスト'     { if ($null -ne $b -and $null -ne $test) { [void]$test.Fields.Add($b) } }
        }
    }
    return $d
}

function Resolve-Kind([string]$action) {
    $a = Norm $action
    $best = ''
    $bestLen = 0
    foreach ($k in $Catalog.Keys) {
        foreach ($al in $Catalog[$k].Aliases) {
            $n = Norm $al
            if ($n.Length -eq 0) { continue }
            $hit = ($a -eq $n)
            if (-not $hit -and $n.Length -ge 4 -and $a.Contains($n)) { $hit = $true }
            if ($hit -and $n.Length -gt $bestLen) { $best = $k; $bestLen = $n.Length }
        }
    }
    return $best
}

# ===================== 式の解決 =====================
$script:Lib = Get-Library $ExpressionsDir
$script:ExprCache = @{}
$script:NeedJst = $false
$script:StepExprs = New-Object System.Collections.ArrayList
$script:ExprRx = [regex]'\{\{式[:：]\s*(.+?)\}\}'
$script:MixedExpr = $false

function Resolve-Expr([string]$req) {
    if ($script:ExprCache.ContainsKey($req)) { return $script:ExprCache[$req] }
    $info = @{ Req = $req; Found = $false; Id = ''; Title = ''; Expr = ''; Status = '' }
    $r = @(Get-RankedExpr $script:Lib $req)
    if ($r.Count -gt 0) {
        $e = $r[0].Entry
        $info.Found = $true
        $info.Id = $e.Id
        $info.Title = $e.Title
        $info.Status = $e.Status
        $info.Expr = Get-FirstExprBlock $e
        if ($info.Expr.Contains("outputs('Compose_JST')")) { $script:NeedJst = $true }
    }
    $script:ExprCache[$req] = $info
    return $info
}

function Expand-Value([string]$v) {
    if ($null -eq $v) { return '' }
    $res = $v
    foreach ($m in $script:ExprRx.Matches($v)) {
        $info = Resolve-Expr $m.Groups[1].Value.Trim()
        if ($info.Found) {
            $repl = '〔式 ' + $info.Id + '：下の「使う式」を貼る〕'
            $dup = $false
            foreach ($x in $script:StepExprs) { if ($x.Id -eq $info.Id) { $dup = $true } }
            if (-not $dup) { [void]$script:StepExprs.Add($info) }
        }
        else {
            $repl = '〔式：要確認（式ライブラリにありません）〕'
            Add-Unconfirmed '式' ('要件「' + $info.Req + '」に合う式が式ライブラリにありません')
        }
        if ($v.Trim() -ne $m.Value) {
            $script:MixedExpr = $true
            Add-Unconfirmed '式' '文章の途中に式を入れる操作と、JSON での書き方（@{...} の埋め込み）のサンプルがありません'
        }
        $res = $res.Replace($m.Value, $repl)
    }
    return $res
}

# ===================== 読み込みと前処理 =====================
$SpecData = Read-Spec $Spec
if ($SpecData.Title -eq '') { $SpecData.Title = '（フロー名なし）'; Add-Warning '1行目の見出し（# フロー名）がありません。' }
foreach ($p in $SpecData.Problems) { Add-Warning $p }

function Get-AllSteps($Steps) {
    $all = New-Object System.Collections.ArrayList
    foreach ($s in $Steps) {
        [void]$all.Add($s)
        foreach ($c in $s.Children) { [void]$all.Add($c) }
    }
    return ,$all
}
$allSteps = Get-AllSteps $SpecData.Steps
if ($allSteps.Count -eq 0) { Add-Warning '「## 手順」に手順（### 1. …）がありません。' }

foreach ($s in $allSteps) {
    $act = Get-Field $s.Fields @('動作')
    if ($null -eq $act) {
        Add-Warning ('手順 ' + $s.Num + '「' + $s.Title + '」に「動作」の項目がありません。')
        $s.Kind = ''
        $s['ActionText'] = ''
    }
    else {
        $s['ActionText'] = $act
        $s.Kind = Resolve-Kind $act
    }
    foreach ($f in $s.Fields) { [void](Expand-Value $f.Value) }
}
foreach ($f in $SpecData.ErrorFields) { [void](Expand-Value $f.Value) }
$script:StepExprs.Clear()

# トリガー
$trigKind = ''
$trigType = Get-Field $SpecData.TriggerFields @('種類')
if ($null -eq $trigType) { Add-Warning '「## トリガー」に「種類」がありません。' }
elseif ((Norm $trigType).Contains('手動') -or (Norm $trigType).Contains('ボタン')) { $trigKind = 'Manual' }

$hasError = $false
if ($SpecData.HasErrorSection) { $hasError = $true }
if (-not $hasError) { Add-Warning '「## エラー処理」が書かれていません。失敗しても誰にも通知されないフローになります（構築手順書にエラー処理は含めません）。' }

# ===================== 構築順序の組み立て =====================
$nodes = New-Object System.Collections.ArrayList
function New-Node($kind, $step, $title, $parentNode, $where) {
    return @{ Kind = $kind; Step = $step; Title = $title; Parent = $parentNode; Where = $where; Seq = 0; Auto = ($null -eq $step); ActionName = '' }
}

$topSteps = New-Object System.Collections.ArrayList
$initSteps = New-Object System.Collections.ArrayList
foreach ($s in $SpecData.Steps) {
    if ($s.Kind -eq 'InitVar') { [void]$initSteps.Add($s) } else { [void]$topSteps.Add($s) }
}
if ($initSteps.Count -gt 0 -and $topSteps.Count -gt 0) {
    $firstNonInit = $topSteps[0]
    $idxInit = $SpecData.Steps.IndexOf($initSteps[$initSteps.Count - 1])
    $idxFirst = $SpecData.Steps.IndexOf($firstNonInit)
    if ($idxInit -gt $idxFirst) { Add-Warning '変数の初期化は、トリガーの直下にまとめて作る手順に並べ替えました（サンプルの置き方に合わせるため）。' }
}

$prevTop = 'トリガー'
foreach ($s in $initSteps) {
    $where = if ($prevTop -eq 'トリガー') { 'トリガーの直下の「＋」を押す' } else { '直前の箱（' + $prevTop + '）の下の「＋」を押す' }
    $n = New-Node 'InitVar' $s $s.Title $null $where
    $n.ActionName = $Catalog['InitVar'].En
    [void]$nodes.Add($n)
    $prevTop = $Catalog['InitVar'].En
}

$tryNode = $null
if ($hasError) {
    $where = if ($prevTop -eq 'トリガー') { 'トリガーの直下の「＋」を押す' } else { '直前の箱（' + $prevTop + '）の下の「＋」を押す' }
    $tryNode = New-Node 'Try' $null 'Try（エラー処理の対象をまとめるスコープ）' $null $where
    $tryNode.ActionName = 'Try'
    [void]$nodes.Add($tryNode)
}

$container = if ($hasError) { 'Try' } else { '' }
$prevInContainer = ''
function Get-Where([string]$containerName, [string]$prevName, $parentNode) {
    if ($prevName -ne '') { return ('直前の箱（' + $prevName + '）の下の「＋」を押す') }
    if ($null -ne $parentNode) { return ('「' + $parentNode.ActionName + '」の中の「＋」を押す') }
    if ($containerName -ne '') { return ($containerName + ' の中の「＋」を押す') }
    return ($(if ($prevTop -eq 'トリガー') { 'トリガーの直下の「＋」を押す' } else { '直前の箱（' + $prevTop + '）の下の「＋」を押す' }))
}

if ($script:NeedJst) {
    $jstEntry = $null
    foreach ($e in $script:Lib) { if ($e.Id -eq 'E00') { $jstEntry = $e } }
    $n = New-Node 'JstCompose' $null '現在日時（日本時間）を作る（式で日本時間の日付を使うため自動で追加）' $null (Get-Where $container $prevInContainer $null)
    $n.ActionName = 'Compose_JST'
    [void]$nodes.Add($n)
    $prevInContainer = 'Compose_JST'
}

foreach ($s in $topSteps) {
    $kind = $s.Kind
    $n = New-Node $kind $s $s.Title $null (Get-Where $container $prevInContainer $null)
    if ($kind -ne '') { $n.ActionName = $Catalog[$kind].En } else { $n.ActionName = $s['ActionText'] }
    if ($kind -eq 'Scope') {
        $nm = Get-Field $s.Fields @('名前')
        if ($null -ne $nm -and $nm -ne '') { $n.ActionName = $nm }
    }
    [void]$nodes.Add($n)
    $prevInContainer = $n.ActionName
    $prevChild = ''
    foreach ($c in $s.Children) {
        $ck = $c.Kind
        $cn = New-Node $ck $c $c.Title $n (Get-Where '' $prevChild $n)
        if ($ck -ne '') { $cn.ActionName = $Catalog[$ck].En } else { $cn.ActionName = $c['ActionText'] }
        [void]$nodes.Add($cn)
        $prevChild = $cn.ActionName
    }
}

$catchNode = $null
$catchMail = $null
if ($hasError) {
    $catchNode = New-Node 'Catch' $null 'catch（失敗したときの通知をまとめるスコープ）' $null 'Try の下の「＋」を押す'
    $catchNode.ActionName = 'catch'
    [void]$nodes.Add($catchNode)
    $catchMail = New-Node 'CatchMail' $null '失敗を知らせるメールを送る' $catchNode '「catch」の中の「＋」を押す'
    $catchMail.ActionName = $Catalog['Mail'].En
    [void]$nodes.Add($catchMail)
}

$seq = 0
foreach ($n in $nodes) { $seq++; $n.Seq = $seq }
$stepNode = @{}
foreach ($n in $nodes) { if ($null -ne $n.Step) { $stepNode[$n.Step.Num] = $n } }

# ===================== 文書の出力 =====================
function Mark-Name([bool]$seen) { if ($seen) { return $M_UI } else { return $M_GUESS } }

# ---- 読みやすくするための道具 ----
function Strip-Marks([string]$s) {
    $t = [regex]::Replace($s, '\s*［(?:画面で確認済み|サンプルで確認済み|想定)］', '')
    $t = [regex]::Replace($t, '（[^）]*想定[^）]*）', '')
    return $t.Trim()
}
function Polite([string]$w) { return ([regex]::Replace($w, '押す$', '押します')) }
function Details-Begin([string]$title) { L (':::details ' + $title) }
function Details-End { L ':::' }
$script:FigComposeShown = $false
$script:FigApplyShown = $false

# ---- 図（SVG）。Markdown 出力では取り除き、HTML 出力だけに入れる ----
function Svg-Esc([string]$s) { return [System.Net.WebUtility]::HtmlEncode($s) }
function Svg-Clip([string]$s, [int]$max) {
    $w = 0
    $o = ''
    foreach ($ch in $s.ToCharArray()) {
        $u = 2
        if ([int]$ch -lt 128) { $u = 1 }
        if ($w + $u -gt $max) { return ($o + '…') }
        $w += $u
        $o += [string]$ch
    }
    return $o
}
function Svg-Head([int]$w, [int]$h, [string]$label) {
    return ('<figure class="fig"><svg viewBox="0 0 ' + $w + ' ' + $h + '" role="img" aria-label="' + (Svg-Esc $label) + '" xmlns="http://www.w3.org/2000/svg" font-family="Yu Gothic UI, Meiryo UI, Hiragino Sans, sans-serif">' +
        '<defs><marker id="ahx" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="var(--sub)"/></marker></defs>')
}
function Write-Svg($lines) {
    L '```svgfig'
    foreach ($x in $lines) { L $x }
    L '```'
}
function Write-Figure([string]$figHtml) {
    L '```svgfig'
    foreach ($x in ($figHtml -split "`r?`n")) { L $x }
    L '```'
}
$KindColor = @{ InitVar = '#7a52b3'; Scope = '#8c3a00'; ExcelList = '#107c41'; Foreach = '#5f6b7a'; Compose = '#7a52b3'; Mail = '#0f6cbd'; Try = '#8c3a00'; Catch = '#8c3a00'; CatchMail = '#0f6cbd'; JstCompose = '#7a52b3' }

# 入力欄の見取り図（どの欄に何を入れるか）
function New-PanelSvg([string]$title, [string]$color, $rows) {
    $n = $rows.Count
    $h = 124 + $n * 66
    $s = New-Object System.Collections.ArrayList
    [void]$s.Add((Svg-Head 760 $h ('入力欄の見取り図：' + $title)))
    [void]$s.Add('<rect x="10" y="10" width="740" height="' + ($h - 20) + '" rx="8" fill="var(--bg)" stroke="var(--line)"/>')
    [void]$s.Add('<rect x="26" y="26" width="24" height="24" rx="4" fill="' + $color + '"/>')
    [void]$s.Add('<text x="62" y="45" class="st" font-size="16" font-weight="bold">' + (Svg-Esc $title) + '</text>')
    [void]$s.Add('<text x="26" y="80" class="st" font-size="13" font-weight="bold">Parameters</text><text x="116" y="80" class="ss" font-size="13">Settings</text><text x="186" y="80" class="ss" font-size="13">Code view</text><text x="270" y="80" class="ss" font-size="13">About</text>')
    [void]$s.Add('<rect x="26" y="88" width="84" height="3" rx="1" fill="var(--acc)"/>')
    for ($i = 0; $i -lt $n; $i++) {
        $r = $rows[$i]
        $y = 108 + $i * 66
        $val = $r.Short
        if ($null -eq $val -or $val -eq '') { $val = (Strip-Marks $r.Value) }
        $val = Svg-Clip $val 78
        [void]$s.Add('<circle cx="42" cy="' + ($y + 34) + '" r="13" fill="var(--warn)"/><text x="42" y="' + ($y + 39) + '" text-anchor="middle" font-size="14" font-weight="bold" fill="#fff">' + ($i + 1) + '</text>')
        [void]$s.Add('<text x="70" y="' + ($y + 12) + '" class="ss" font-size="12">' + (Svg-Esc (Svg-Clip $r.Ui 80)) + '</text>')
        [void]$s.Add('<rect x="70" y="' + ($y + 18) + '" width="660" height="34" rx="4" fill="var(--card)" stroke="var(--acc)" stroke-width="2"/>')
        [void]$s.Add('<text x="82" y="' + ($y + 40) + '" class="st" font-size="14">' + (Svg-Esc $val) + '</text>')
    }
    [void]$s.Add('</svg><figcaption>入力欄の見取り図（実際の画面と、色や並びが少し違うことがあります）。丸い番号は、上の表の番号と同じです。</figcaption></figure>')
    return @($s)
}

# 完成図（箱の並び）
function New-FlowSvg($nodeList, [string]$trigText, [string]$trigSub) {
    $items = New-Object System.Collections.ArrayList
    [void]$items.Add(@{ T1 = $trigText; T2 = $trigSub; Color = '#0f6cbd'; Depth = 0; Cont = $false })
    $topDepth = 0
    foreach ($n in $nodeList) {
        $k = $n.Kind
        $col = '#a12020'
        if ($KindColor.ContainsKey($k)) { $col = $KindColor[$k] }
        $cont = ($k -eq 'Try' -or $k -eq 'Catch' -or $k -eq 'Scope' -or $k -eq 'Foreach')
        $d = 0
        if ($k -eq 'Try' -or $k -eq 'Catch') { $d = 0; $topDepth = 0 }
        elseif ($k -eq 'CatchMail') { $d = 1 }
        elseif ($null -ne $n.Parent) { $d = $topDepth + 1 }
        elseif ($k -eq 'InitVar') { $d = 0 }
        elseif ($hasError) { $d = 1 }
        if ($null -eq $n.Parent -and $k -ne 'Try' -and $k -ne 'Catch' -and $k -ne 'CatchMail') { $topDepth = $d }
        $t1 = $n.Title
        $t2 = $n.ActionName
        if ($k -eq 'Try') { $t1 = 'Try（本処理をまとめる箱）'; $t2 = '' }
        if ($k -eq 'Catch') { $t1 = 'catch（失敗したときだけ動く箱）'; $t2 = '' }
        if ($k -eq 'CatchMail') { $t1 = '失敗を知らせるメールを送る'; $t2 = $Catalog['Mail'].En }
        if ($k -eq 'JstCompose') { $t1 = '現在の日時（日本時間）を作る'; $t2 = 'Compose_JST' }
        [void]$items.Add(@{ T1 = $t1; T2 = $t2; Color = $col; Depth = $d; Cont = $cont })
    }
    $cnt = $items.Count
    $last = @{}
    $closing = New-Object 'int[]' $cnt
    for ($i = 0; $i -lt $cnt; $i++) {
        if ($items[$i].Cont) {
            $j = $i + 1
            while ($j -lt $cnt -and $items[$j].Depth -gt $items[$i].Depth) { $j++ }
            $lastIdx = $j - 1
            $last[$i] = $lastIdx
            if ($lastIdx -gt $i) { $closing[$lastIdx] = $closing[$lastIdx] + 1 }
        }
    }
    $y = 16
    $pos = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $cnt; $i++) {
        $h = 50
        if ($items[$i].Cont) { $h = 38 }
        $d = $items[$i].Depth
        [void]$pos.Add(@{ X = (30 + $d * 46); W = (700 - $d * 92); Y = $y; H = $h })
        $y = $y + $h + 10 * $closing[$i] + 18
    }
    $total = $y + 6
    $s = New-Object System.Collections.ArrayList
    [void]$s.Add((Svg-Head 760 $total '完成図（箱の並び）'))
    for ($i = 0; $i -lt $cnt; $i++) {
        if ($items[$i].Cont -and $last[$i] -gt $i) {
            $li = $last[$i]
            $extra = 1
            for ($m = $i + 1; $m -le $li; $m++) { if ($items[$m].Cont -and $last[$m] -eq $li -and $last[$m] -gt $m -and $items[$m].Depth -gt $items[$i].Depth) { $extra++ } }
            $bh = ($pos[$li].Y + $pos[$li].H + 10 * $extra) - $pos[$i].Y
            [void]$s.Add('<rect x="' + ($pos[$i].X - 8) + '" y="' + $pos[$i].Y + '" width="' + ($pos[$i].W + 16) + '" height="' + $bh + '" rx="8" fill="var(--bg)" stroke="' + $items[$i].Color + '" stroke-width="2"/>')
        }
    }
    for ($i = 0; $i -lt $cnt; $i++) {
        $it = $items[$i]
        $p = $pos[$i]
        if ($i -gt 0) {
            $cx = $p.X + [int]($p.W / 2)
            $prevBottom = $pos[$i - 1].Y + $pos[$i - 1].H + 10 * $closing[$i - 1]
            [void]$s.Add('<line x1="' + $cx + '" y1="' + ($prevBottom + 1) + '" x2="' + $cx + '" y2="' + ($p.Y - 2) + '" stroke="var(--sub)" stroke-width="2" marker-end="url(#ahx)"/>')
        }
        if ($it.Cont) {
            [void]$s.Add('<rect x="' + $p.X + '" y="' + $p.Y + '" width="' + $p.W + '" height="' + $p.H + '" rx="6" fill="' + $it.Color + '"/>')
            [void]$s.Add('<text x="' + ($p.X + 14) + '" y="' + ($p.Y + 25) + '" class="sw" font-size="14" font-weight="bold">' + (Svg-Esc (Svg-Clip ($it.T1 + $(if ($it.T2 -ne '') { '（' + $it.T2 + '）' } else { '' })) 80)) + '</text>')
        }
        else {
            [void]$s.Add('<rect x="' + $p.X + '" y="' + $p.Y + '" width="' + $p.W + '" height="' + $p.H + '" rx="6" fill="' + $it.Color + '"/>')
            [void]$s.Add('<text x="' + ($p.X + 14) + '" y="' + ($p.Y + 22) + '" class="sw" font-size="14" font-weight="bold">' + (Svg-Esc (Svg-Clip $it.T1 76)) + '</text>')
            if ($it.T2 -ne '') { [void]$s.Add('<text x="' + ($p.X + 14) + '" y="' + ($p.Y + 40) + '" class="sw" font-size="11">' + (Svg-Esc (Svg-Clip $it.T2 90)) + '</text>') }
        }
    }
    [void]$s.Add('</svg><figcaption>完成図：上から下へ、順番に動きます。枠で囲まれた箱は、中に箱が入っています。</figcaption></figure>')
    return @($s)
}

# ---------------- 冒頭 ----------------
L ('# ' + $SpecData.Title + ' の作り方（構築手順書）')
L ''
L '> Power Automate の画面を見ながら、**上から順に**進めると、このフローが作れます。難しい言葉は、最後の「用語の説明」にあります。'
L '> 画面の表示がこの手順書と少し違うときは、**近い名前のものを選んでください**。分からないときは、画面を撮って相談してください。'
L ''

$script:WarnInsertAt = $script:O.Count   # 警告の欄は、手順を書き終えたあとにここへ差し込む

L '## このフローでできること'
L ''
if ($SpecData.Purpose.Count -gt 0) { foreach ($p in $SpecData.Purpose) { L ('- ' + $p) } } else { L '- （目的の記載なし）' }
L ''

L '## 完成図'
L ''
L '作り終わると、画面には次のような「箱」が、上から下へ並びます。'
L ''
L '```tree'
L ($(if ($trigKind -eq 'Manual') { '[トリガー] Manually trigger a flow' } else { '[トリガー] ' + $trigType + '（要確認）' }))
function Tree-Lines {
    foreach ($n in $nodes) {
        $indent = ''
        if ($n.Kind -eq 'Try' -or $n.Kind -eq 'Catch') { $indent = '' }
        elseif ($n.Kind -eq 'InitVar') { $indent = '' }
        elseif ($hasError) { $indent = '   ' }
        $label = '[' + $n.ActionName + ']'
        $extra = ''
        if ($null -ne $n.Step -and $n.Kind -eq 'InitVar') { $v = Get-Field $n.Step.Fields @('変数名', '名前'); if ($null -ne $v) { $extra = '  変数 ' + $v } }
        if ($n.Kind -eq 'Try' -or $n.Kind -eq 'Catch') { $label = '[Scope] ' + $n.ActionName }
        if ($null -ne $n.Parent -and $n.Kind -ne 'CatchMail') { $indent = '      ' }
        L ($indent + $label + $extra + $(if ($n.Kind -eq '') { '  ← 要確認（サンプルなし）' } else { '' }))
    }
}
Tree-Lines
L '```'
$trigLabel = 'Manually trigger a flow'
$trigSubTxt = '手動で実行する（ボタンを押す）'
if ($trigKind -ne 'Manual') { $trigLabel = [string]$trigType; $trigSubTxt = '要確認（サンプルなし）' }
Write-Svg (New-FlowSvg $nodes $trigLabel $trigSubTxt)
L ''

L '## 作る前に用意するもの'
L ''
foreach ($p in $SpecData.Prep) { L ('- [ ] ' + $p) }
L '- [ ] Microsoft 365 のアカウントで、Power Automate（make.powerautomate.com）を開けること'
L ''

$stepCount = 0
foreach ($n in $nodes) { if ($n.Kind -ne 'Catch' -and $n.Kind -ne 'CatchMail') { $stepCount++ } }
L ('## 作り方の流れ（全 ' + $stepCount + ' 手順）')
L ''
L '- **はじめに**：フローを新しく作る'
foreach ($n in $nodes) {
    if ($n.Kind -eq 'Catch' -or $n.Kind -eq 'CatchMail') { continue }
    L ('- **手順 ' + $n.Seq + '**：' + $n.Title)
}
if ($hasError) { L '- **失敗したときの通知**を作る（エラー処理）' }
L '- **テスト**で、正しく動くか確認する'
L ''

# ---------- トリガー ----------
L '## はじめに：フローを新しく作る'
L ''
if ($trigKind -eq 'Manual') {
    L 'フローの「入れ物」を作ります。ボタンを押したときに動く、手動で実行するフローです。'
    L ''
    L '1. Power Automate の左のメニューで「Create」を押します。'
    L '2. 上の段の「Instant cloud flow」をクリックします。'
    L ('3. 「Flow name」に、フローの名前（例：`' + $SpecData.Title + '`）を入力します。')
    L '4. トリガーの一覧から「Manually trigger a flow」を選び、「Create」を押します。'
    L ''
    L '→ 編集画面が開き、一番上に「Manually trigger a flow」という箱が1つできます。ここから、箱を下へ足していきます。'
    L ''
    Details-Begin 'くわしい情報（確認したい方向け）'
    L ('- 画面の名前（英語表示）：`Manually trigger a flow` ' + $M_UI + '／日本語表示：' + $M_NG)
    L ('- 作り方の画面の名前（Create → Instant cloud flow）：' + $M_UI)
    L '- 設定値：なし（既定のまま）。'
    L ('- Code view で確認するポイント：`"type": "Request"`、`"kind": "Button"` ' + $M_JSON + '（`samples/triggers/request__manual__basic.json`）')
    Details-End
}
else {
    L ('- 種類：' + $(if ($null -ne $trigType) { $trigType } else { '（記載なし）' }) + ' ' + $M_NG)
    L ('- 画面の名前・設定値・作り方：' + $M_NG + '（手動以外のトリガーのサンプルがありません）')
    Add-Unconfirmed 'トリガー' ('「' + $(if ($null -ne $trigType) { $trigType } else { '（種類の記載なし）' }) + '」のトリガーのサンプルがありません')
    foreach ($f in $SpecData.TriggerFields) { if ((Norm $f.Label) -ne (Norm '種類') -and (Norm $f.Label) -ne (Norm 'トリガー条件')) { L ('- ' + $f.Label + '：' + $f.Value + '（手順書の記載をそのまま載せています）') } }
}
$tc = Get-Field $SpecData.TriggerFields @('トリガー条件')
if ($null -ne $tc) {
    L ('- トリガー条件：' + $tc + ' ' + $M_NG + '（トリガー条件の書き方のサンプルがありません）')
    Add-Unconfirmed 'トリガー' 'トリガー条件の設定のしかた・書き方のサンプルがありません'
}
L ''

# ---------- 各手順の部品 ----------
function Add-Row($rows, [string]$ui, [bool]$seen, [string]$value, [string]$json, [string]$short = '') {
    [void]$rows.Add(@{ Ui = $ui; Seen = $seen; Value = $value; Json = $json; Short = $short })
}
function Write-Rows($rows) {
    if ($rows.Count -eq 0) { return }
    L '| 番号 | 画面の入力欄 | 入れる内容 |'
    L '| --- | --- | --- |'
    $i = 0
    foreach ($r in $rows) {
        $i++
        L ('| ' + $i + ' | ' + (Cell $r.Ui) + ' | ' + (Cell (Strip-Marks $r.Value)) + ' |')
    }
}
function Write-Exprs($exprs) {
    if ($exprs.Count -eq 0) { return }
    L ''
    L '**使う式（コピーして、貼ります）**'
    if ($script:MixedExpr) { L ('- ※ 文章の途中に式を入れる項目です。入れ方は ' + $M_NG + '。まず文章だけを入力し、式の部分は、画面の動的なコンテンツ／式の窓から挿入してください。') }
    foreach ($x in $exprs) {
        L ''
        L ('- 式 ' + $x.Id + '：' + $x.Title + '（要件：' + $x.Req + '）')
        L ''
        L '  ```text'
        foreach ($el in ($x.Expr -split "`n")) { L ('  ' + $el) }
        L '  ```'
        if ($x.Expr.Contains("outputs('Compose_JST')")) { L '  - ※ この式は、「現在日時（日本時間）」の箱（`Compose_JST`）を使います。名前を変えないでください。' }
    }
    L ''
    L '貼り方：その項目の入力欄をクリックし、開いた窓の **「式（fx）」の欄**に貼って、「Add」（または「Update」）を押します。先頭に @ は付けません。'
    if (-not $script:FigComposeShown) {
        $script:FigComposeShown = $true
        L ''
        Write-Figure $script:FigCompose
    }
}
function Write-Extras($step, [string[]]$consumed) {
    $ex = New-Object System.Collections.ArrayList
    foreach ($f in $step.Fields) {
        $n = Norm $f.Label
        if ($n -eq (Norm '動作')) { continue }
        $hit = $false
        foreach ($c in $consumed) { if ($n -eq (Norm $c)) { $hit = $true } }
        if (-not $hit) { [void]$ex.Add($f) }
    }
    if ($ex.Count -gt 0) {
        L ''
        L ('**その他の記載** ' + $M_NG + '（この動作では、この項目の書き方のサンプルがありません。手順書の記載をそのまま載せます）')
        L ''
        foreach ($f in $ex) {
            L ('- ' + $f.Label + '：' + (Expand-Value $f.Value))
            Add-Unconfirmed ('手順 ' + $step.Num) ('項目「' + $f.Label + '」の設定のしかた・JSON の書き方')
        }
    }
}
function Write-AddBoxSteps($n, [string]$en, [string]$connector, [string]$renameTo) {
    L ('1. ' + (Polite $n.Where) + '。')
    L ('2. 出てきた画面の検索欄に `' + $en + '` と入力し、候補の中の「' + $en + '」（' + $connector + '）を選びます。')
    if ($renameTo -ne '') { L ('3. できた箱の右上の「…」→「Rename」を選び、名前を `' + $renameTo + '` に変えます。') }
}

L '## 手順（上から順に、箱を足していく）'
L ''
if ($hasError) {
    L ('> **すべての手順は、「Try」という名前のまとめる箱の中**に作ります（失敗したときに通知するため）。' + $(if ($initSteps.Count -gt 0) { '変数の初期化だけは、Try の外（トリガーのすぐ下）に作ります。' } else { '' }))
    L ''
}
foreach ($n in $nodes) {
    if ($n.Kind -eq 'Catch' -or $n.Kind -eq 'CatchMail') { continue }
    $script:StepExprs.Clear()
    $script:MixedExpr = $false
    $kind = $n.Kind
    $step = $n.Step
    L ('### 手順 ' + $n.Seq + '：' + $n.Title)
    L ''
    if ($null -ne $step) { L ('（業務手順書の手順 ' + $step.Num + '）'); L '' }

    if ($kind -eq 'Try') {
        L 'エラー処理のために、最初に「Try」という名前の**まとめる箱（スコープ）**を作ります。このあとの手順は、すべてこの箱の中に作ります。'
        L ''
        L '**やること**'
        L ''
        Write-AddBoxSteps $n 'Scope' '組み込み' 'Try'
        L ''
        Details-Begin 'くわしい情報（確認したい方向け）'
        L ('- 「Scope」の名前と「Rename」の操作は、画面で確認していません ' + $M_GUESS)
        L ('- Code view で確認するポイント：`"type": "Scope"`')
        Details-End
        L ''
        continue
    }

    if ($kind -eq 'JstCompose') {
        $jstE = $null
        foreach ($e in $script:Lib) { if ($e.Id -eq 'E00') { $jstE = $e } }
        $info = @{ Id = $jstE.Id; Title = $jstE.Title; Status = $jstE.Status; Expr = (Get-FirstExprBlock $jstE) }
        L 'このあとの手順で、「日本時間の今日」を使う式を貼ります。そのために、先に「現在の日時（日本時間）」を入れておく箱を作ります。'
        L ''
        L '**やること**'
        L ''
        Write-AddBoxSteps $n 'Compose' '組み込み（データ操作）' 'Compose_JST'
        L '4. 「Inputs」の欄をクリックし、開いた窓の「式（fx）」の欄に、下の文字を貼って、「Add」を押します。'
        L ''
        L '```text'
        foreach ($el in ($info.Expr -split "`n")) { L $el }
        L '```'
        L ''
        L '※ 箱の名前は、必ず `Compose_JST` にしてください（あとの式が、この名前で呼び出します）。'
        if (-not $script:FigComposeShown) {
            $script:FigComposeShown = $true
            L ''
            Write-Figure $script:FigCompose
        }
        L ''
        Details-Begin 'くわしい情報（確認したい方向け）'
        L ('- 式 ' + $info.Id + '：' + $info.Title + '（' + $info.Status + '）')
        L '- 日本時間にする理由：`utcNow()` は UTC（世界標準時）を返すため、必ず `convertTimeZone` で `Tokyo Standard Time` に変換します。'
        L ('- Code view で確認するポイント：`"type": "Compose"`')
        Details-End
        L ''
        continue
    }

    if ($kind -eq '') {
        L ('この動作（' + $step['ActionText'] + '）は、サンプルがないため、箱の名前や入力欄の名前を、この手順書では案内できません ' + $M_NG + '。手順書に書かれた内容を、そのまま載せます。')
        L ''
        L ('1. ' + (Polite $n.Where) + '。')
        L '2. 作りたい処理に合う箱を、画面の検索欄から探して選びます。'
        L ''
        Add-Unconfirmed ('手順 ' + $step.Num) ('動作「' + $step['ActionText'] + '」のサンプルがありません（箱の名前・項目名・JSON）')
        L '**手順書の記載（そのまま）**'
        L ''
        foreach ($f in $step.Fields) { if ((Norm $f.Label) -ne (Norm '動作')) { L ('- ' + $f.Label + '：' + (Expand-Value $f.Value)) } }
        Write-Exprs $script:StepExprs
        L ''
        continue
    }

    $def = $Catalog[$kind]
    L ('**使う箱：** `' + $def.En + '`（' + $def.Connector + '）')
    L ''
    L '**やること**'
    L ''
    Write-AddBoxSteps $n $def.En $def.Connector ''
    L '3. 左に開いたパネルで、次の欄に入力します（下の図と表のとおり）。'
    $rows = New-Object System.Collections.ArrayList
    $consumed = @('動作')
    $checks = New-Object System.Collections.ArrayList
    $sub = New-Object System.Collections.ArrayList     # 追加で表示する説明（Settings など）

    switch ($kind) {
        'InitVar' {
            $consumed += @('変数名', '名前', '種類', '型', 'データ型', '初期値', '値')
            $name = Get-Field $step.Fields @('変数名', '名前')
            $type = Get-Field $step.Fields @('種類', '型', 'データ型')
            $val = Get-Field $step.Fields @('初期値', '値')
            if ($null -eq $name) { Add-Warning ('手順 ' + $step.Num + '：変数名がありません。') }
            Add-Row $rows 'Name' $false $(if ($null -ne $name) { $name } else { '（手順書に記載なし）' }) 'inputs.variables[0].name'
            $typeShown = '（手順書に記載なし）'
            if ($null -ne $type) {
                $tn = Norm $type
                if ($tn -eq '整数' -or $tn -eq 'integer' -or $tn -eq 'int') { $typeShown = 'Integer（整数）'; [void]$checks.Add('"type": "integer"') }
                else {
                    $typeShown = $type + '（' + $M_NG + '）'
                    Add-Unconfirmed ('手順 ' + $step.Num) ('変数の種類「' + $type + '」の画面の選択肢・JSON の書き方（整数以外のサンプルがありません）')
                }
            }
            Add-Row $rows 'Type' $false $typeShown 'inputs.variables[0].type（整数は integer）'
            Add-Row $rows 'Value' $false $(if ($null -ne $val) { (Expand-Value $val) } else { '（手順書に記載なし）' }) 'inputs.variables[0].value'
            [void]$checks.Add('"type": "InitializeVariable"')
            if ($null -ne $name) { [void]$checks.Add('"name": "' + $name + '"') }
            [void]$checks.Add('"runAfter": {}（トリガーの直後のとき）')
        }
        'Scope' {
            $consumed += @('名前')
            $nm = Get-Field $step.Fields @('名前')
            if ($null -ne $nm) { [void]$sub.Add('- 箱の名前を `' + $nm + '` に変えます（箱の右上の「…」→「Rename」）。') }
            [void]$checks.Add('"type": "Scope"')
            [void]$checks.Add('"actions": { … }（中の箱）')
        }
        'ExcelList' {
            $consumed += @('場所', 'ドキュメントライブラリ', '文書ライブラリ', 'ファイル', 'テーブル', 'ページ分け', 'ページネーション', 'しきい値',
                           'フィルタークエリ', '並べ替え', '上位件数', 'スキップ件数', '列の選択', '日付時刻の形式')
            $loc = Get-Field $step.Fields @('場所')
            $lib = Get-Field $step.Fields @('ドキュメントライブラリ', '文書ライブラリ')
            $file = Get-Field $step.Fields @('ファイル')
            $tbl = Get-Field $step.Fields @('テーブル')
            $locShown = '（手順書に記載なし）'
            if ($null -ne $loc) {
                if ((Norm $loc).Contains('onedrive')) { $locShown = 'OneDrive for Business（プルダウンから選ぶ）' }
                else { $locShown = $loc + '（' + $M_NG + '）'; Add-Unconfirmed ('手順 ' + $step.Num) ('場所「' + $loc + '」を選んだときの JSON の書き方（OneDrive for Business 以外のサンプルがありません）') }
            }
            Add-Row $rows 'Location' $true $locShown 'inputs.parameters.source（OneDrive for Business は "me"）'
            Add-Row $rows 'Document Library' $true $(if ($null -ne $lib) { $lib + '（プルダウンから選ぶ）' } else { '（手順書に記載なし）' }) 'inputs.parameters.drive'
            Add-Row $rows 'File' $true $(if ($null -ne $file) { $file + '（右のフォルダーのアイコンで選ぶ）' } else { '（手順書に記載なし）' }) 'inputs.parameters.file'
            Add-Row $rows 'Table' $true $(if ($null -ne $tbl) { $tbl + '（プルダウンから選ぶ）' } else { '（手順書に記載なし）' }) 'inputs.parameters.table'
            foreach ($req in @(@('ファイル', $file), @('テーブル', $tbl))) { if ($null -eq $req[1]) { Add-Warning ('手順 ' + $step.Num + '：「' + $req[0] + '」がありません。') } }
            $adv = @(@('フィルタークエリ', 'Filter Query'), @('並べ替え', 'Order By'), @('上位件数', 'Top Count'), @('スキップ件数', 'Skip Count'), @('列の選択', 'Select Query'), @('日付時刻の形式', 'DateTime Format'))
            foreach ($a in $adv) {
                $v = Get-Field $step.Fields @($a[0])
                if ($null -ne $v) {
                    Add-Row $rows ($a[1] + '（Advanced parameters）') $true (Expand-Value $v) ('項目名は' + $M_NG)
                    Add-Unconfirmed ('手順 ' + $step.Num) ('詳細項目「' + $a[1] + '」を設定したときの JSON のキー名（設定した版のサンプルがありません）')
                }
            }
            if ($null -ne (Get-Field $step.Fields @('フィルタークエリ', '並べ替え', '上位件数', 'スキップ件数', '列の選択', '日付時刻の形式'))) {
                [void]$sub.Add('- 詳細項目（Filter Query など）は、「Advanced parameters」の「Show all」（または一覧）で表示してから入力します ' + $M_UI)
            }
            $pg = Get-Field $step.Fields @('ページ分け', 'ページネーション')
            $th = Get-Field $step.Fields @('しきい値')
            if ($null -eq $pg) {
                Add-Warning ('手順 ' + $step.Num + '（Excel 一覧取得）：ページ分け（ページネーション）の指定がありません。既定の上限で、一覧が途中で打ち切られる恐れがあります。')
                [void]$sub.Add('- **ページ分け（Pagination）：手順書に指定がありません。** 設定しないと、行数が多い表で一部しか取得できない恐れがあります。必要なら手順書に「ページ分け: オン」「しきい値: 5000」などを書いてください。')
            }
            elseif ((Norm $pg).Contains('オン') -or (Norm $pg) -eq 'on') {
                $thv = if ($null -ne $th -and $th -ne '') { $th } else { '（手順書に記載なし。例：5000）' }
                if ($null -eq $th) { Add-Warning ('手順 ' + $step.Num + '：ページ分けが「オン」ですが、しきい値の指定がありません。') }
                [void]$sub.Add('- **ページ分け（Pagination）をオンにする：** この箱の「Settings」タブ → `Pagination` をオン → しきい値（Threshold）に `' + $thv + '` を入力 ' + $M_GUESS + '（Settings タブの項目名は想定）')
                [void]$checks.Add('"runtimeConfiguration": { "paginationPolicy": { "minimumItemCount": ' + $(if ($null -ne $th) { $th } else { '<しきい値>' }) + ' } }  ← ページ分けをオンにした印 ' + $M_JSON)
            }
            else {
                [void]$sub.Add('- ページ分け：オフ（既定のまま）。Code view に `runtimeConfiguration` が**ない**ことを確認します。')
            }
            [void]$checks.Add('"operationId": "GetItems"（画面の名前は List rows present in a table）')
            [void]$checks.Add('"apiId": "/providers/Microsoft.PowerApps/apis/shared_excelonlinebusiness"')
        }
        'Foreach' {
            $consumed += @('繰り返す対象', '並列度')
            $tg = Get-Field $step.Fields @('繰り返す対象')
            $tgShown = '（手順書に記載なし）'
            if ($null -ne $tg) {
                $m = [regex]::Match($tg, '手順\s*(\d+(?:-\d+)*)')
                if ($m.Success -and $stepNode.ContainsKey($m.Groups[1].Value) -and $stepNode[$m.Groups[1].Value].Kind -eq 'ExcelList') {
                    $refn = $stepNode[$m.Groups[1].Value]
                    $nm = Get-ActionName 'ExcelList'
                    $tgShown = 'この欄をクリック →「動的なコンテンツ（⚡）」から、`' + $Catalog['ExcelList'].En + '` の下の **`value`** を選ぶ。見つからないときは「fx」に `outputs(''' + $nm + ''')?[''body/value'']` を貼る'
                    [void]$checks.Add('"foreach": "@outputs(''' + $nm + ''')?[''body/value'']"')
                }
                else {
                    $tgShown = $tg + '（' + $M_NG + '）'
                    Add-Unconfirmed ('手順 ' + $step.Num) '繰り返す対象が、Excel 一覧取得以外の結果のときの選び方・式の書き方（サンプルがありません）'
                }
            }
            else { Add-Warning ('手順 ' + $step.Num + '：「繰り返す対象」がありません。') }
            Add-Row $rows 'Select an output from previous steps' $true $tgShown 'foreach（@outputs(...)?[''body/value''] の式）' 'value（⚡の一覧から選ぶ）'
            $par = Get-Field $step.Fields @('並列度')
            $parN = 0
            if ($null -ne $par) { [void][int]::TryParse(($par -replace '[^\d]', ''), [ref]$parN) }
            if ($parN -ge 2) {
                [void]$sub.Add('- **並列実行をオンにする：** この箱の「Settings」タブ → `Concurrency control` をオン → 並列度（Degree of parallelism）を `' + $parN + '` にする ' + $M_GUESS + '（Settings タブの項目名は想定）')
                [void]$checks.Add('"runtimeConfiguration": { "concurrency": { "repetitions": ' + $parN + ' } }  ← 並列実行の印 ' + $M_JSON)
                foreach ($c in $step.Children) { if ($c.Kind -eq '' -and (Norm $c['ActionText']).Contains('変数')) { Add-Warning ('手順 ' + $step.Num + '：並列実行（' + $parN + '）のループの中で変数を更新しています。結果が不安定になる恐れがあります（並列度を 1 にするか、変数を使わない作りを検討）。') } }
            }
            else {
                [void]$sub.Add('- 並列実行：なし（既定のまま）。Code view に `runtimeConfiguration` が**ない**ことを確認します。')
            }
            [void]$checks.Add('"type": "Foreach"')
            [void]$checks.Add('"runAfter": { "<前の箱の名前（空白は _）>": ["Succeeded"] }')
        }
        'Compose' {
            $consumed += @('入力', '値')
            $inp = Get-Field $step.Fields @('入力', '値')
            Add-Row $rows 'Inputs' $true $(if ($null -ne $inp) { (Expand-Value $inp) } else { '（手順書に記載なし）' }) 'inputs（値がそのまま入る）'
            [void]$checks.Add('"type": "Compose"')
            [void]$checks.Add('"inputs": <入力した値>')
        }
        'Mail' {
            $consumed += @('宛先', '件名', '本文', '重要度')
            $to = Get-Field $step.Fields @('宛先')
            $sj = Get-Field $step.Fields @('件名')
            $bd = Get-Field $step.Fields @('本文')
            $im = Get-Field $step.Fields @('重要度')
            if ($null -eq $to) { Add-Warning ('手順 ' + $step.Num + '（メール送信）：宛先がありません。') }
            Add-Row $rows 'To' $false $(if ($null -ne $to) { $to } else { '（手順書に記載なし）' }) 'emailMessage/To'
            Add-Row $rows 'Subject' $false $(if ($null -ne $sj) { (Expand-Value $sj) } else { '（手順書に記載なし）' }) 'emailMessage/Subject'
            Add-Row $rows 'Body' $false $(if ($null -ne $bd) { (Expand-Value $bd) } else { '（手順書に記載なし）' }) 'emailMessage/Body（HTML で保存される）'
            if ($null -ne $im) { Add-Row $rows 'Importance' $false $im 'emailMessage/Importance（サンプルは Normal）' }
            [void]$sub.Add('- メール本文は **HTML として保存されます** ' + $M_JSON + '。改行は `<br>` を使います（式ライブラリ 09 参照）。')
            [void]$checks.Add('"operationId": "SendEmailV2"')
            [void]$checks.Add('"emailMessage/To": "…"、"emailMessage/Subject": "…"、"emailMessage/Body": "<p …>…</p>"')
        }
    }

    L ''
    if ($rows.Count -gt 0) {
        Write-Svg (New-PanelSvg $def.En $KindColor[$kind] $rows)
        L ''
        Write-Rows $rows
        L ''
    }
    if ($sub.Count -gt 0) {
        L '**あわせてやること**'
        L ''
        foreach ($s2 in $sub) { L (Strip-Marks $s2) }
    }
    if ($kind -eq 'Foreach' -and -not $script:FigApplyShown) {
        $script:FigApplyShown = $true
        L ''
        L '**「繰り返す対象」の入れ方（図）**'
        L ''
        Write-Figure $script:FigApply
    }
    Write-Exprs $script:StepExprs
    Write-Extras $step $consumed
    L ''
    Details-Begin 'くわしい情報（確認したい方向け）'
    L ('- 根拠のサンプル：`' + $def.Sample + '`')
    L ('- アクション名（英語表示）：`' + $def.En + '` ' + (Mark-Name $def.EnSeen) + '／日本語表示：' + $M_NG)
    L ('- コネクタ：' + $def.Connector + ' ' + $(if ($def.ConnectorSeen) { $M_UI } else { $M_GUESS }))
    foreach ($r in $rows) { L ('- 入力欄 `' + $r.Ui + '` ' + (Mark-Name $r.Seen) + ' → JSON：' + $r.Json) }
    foreach ($s2 in $sub) { if ($s2.Contains('［')) { L $s2 } }
    L '- Code view で確認するポイント（作ったあと、箱の「Code view」タブと見比べる。取り出し方は `docs/manual_sample_extraction.html`）：'
    foreach ($c in $checks) { L ('  - `' + ($c -replace '`', '') + '`') }
    Details-End
    L ''
}

# ---------- エラー処理 ----------
L '## 失敗したときにメールで知らせる（エラー処理）'
L ''
if ($hasError) {
    $ens = Get-Field $SpecData.ErrorFields @('通知先')
    $esj = Get-Field $SpecData.ErrorFields @('件名')
    $ebd = Get-Field $SpecData.ErrorFields @('本文')
    if ($null -eq $ens) { Add-Warning '「## エラー処理」に「通知先」がありません。' }
    L '処理の途中で失敗したときに、担当者へメールが届くようにします。'
    L ''
    L 'しくみ：本処理を「Try」の箱に入れ、もう1つ「catch」という名前の箱を作ります。**catch は、Try が失敗したときだけ動いて、メールを送ります。**（正常に終わったときは、catch は動きません。）'
    L ''
    L '### ① catch（まとめる箱）を作る'
    L ''
    L '1. 「Try」の箱の**下**の「＋」を押します。'
    L '2. 検索欄に `Scope` と入力し、「Scope」を選びます。'
    L '3. できた箱の右上の「…」→「Rename」を選び、名前を `catch` に変えます。'
    L ''
    L '### ② catch の中に、失敗を知らせるメールを作る'
    L ''
    L '1. `catch` の箱の中の「＋」を押します。'
    L '2. 検索欄に `Send an email (V2)` と入力し、「Send an email (V2)」（Office 365 Outlook）を選びます。'
    L '3. 左のパネルで、次の欄に入力します（下の図と表のとおり）。'
    L ''
    $script:StepExprs.Clear()
    $script:MixedExpr = $false
    $rows = New-Object System.Collections.ArrayList
    Add-Row $rows 'To' $false $(if ($null -ne $ens) { $ens } else { '（手順書に記載なし）' }) 'emailMessage/To'
    Add-Row $rows 'Subject' $false $(if ($null -ne $esj) { (Expand-Value $esj) } else { '（手順書に記載なし）' }) 'emailMessage/Subject'
    Add-Row $rows 'Body' $false $(if ($null -ne $ebd) { (Expand-Value $ebd) } else { '（手順書に記載なし）' }) 'emailMessage/Body（HTML で保存される）'
    Write-Svg (New-PanelSvg 'Send an email (V2)' $KindColor['Mail'] $rows)
    L ''
    Write-Rows $rows
    Write-Exprs $script:StepExprs
    L ''
    L '### ③ catch を「Try が失敗したときだけ動く」設定にする（実行条件）'
    L ''
    L '1. `catch` の箱をクリックし、左のパネルの「Settings」タブを開きます。'
    L '2. 「Run after」の下に、いま動かすきっかけになっている箱（直前の箱）が出ています。'
    L '3. 「＋ Select actions」を押し、一覧から **Try** にチェックを入れます。'
    L '4. Try の行で、「Is successful」の**チェックを外し**、「Has timed out」と「Has failed」に**チェック**を付けます（「Is skipped」は外したまま）。'
    L '5. 直前の箱（例：Apply to each など）の行が残っていたら、右端の**ゴミ箱**で削除します。残すと、その箱が成功し、かつ Try が失敗しないと動かない設定になり、catch が動かなくなります。'
    L '6. 保存します。'
    L ''
    Write-Figure $script:FigRunAfter
    L ''
    L '> 正常に終わったときは、catch の箱は灰色（実行されない）のままになります。'
    L ''
    Details-Begin 'くわしい情報（確認したい方向け）'
    L ('- Settings タブ、Run after、Select actions、Is successful／Has timed out／Is skipped／Has failed、ゴミ箱の表示は、実際の画面で確認しました ' + $M_UI)
    L ('- 「Scope」の名前、「Rename」、「Add an action」の操作は、画面で確認していません ' + $M_GUESS)
    L ('- メールの入力欄の名前（To・Subject・Body）は、画面で確認していません ' + $M_GUESS + '。JSON：`emailMessage/To`、`emailMessage/Subject`、`emailMessage/Body`（HTML で保存） ' + $M_JSON)
    L ('- Code view で確認するポイント（catch の箱）：`"type": "Scope"`、`"runAfter": { "Try": ["TimedOut", "Failed"] }` ' + $M_JSON + '（`samples/actions/control__scope__run_after_failed.json`）')
    Details-End
    L ''
}
else {
    L '- 手順書に「## エラー処理」がないため、エラー処理は含めていません。⚠ 失敗しても誰にも通知されません。'
    L ''
}

# ---------- テスト ----------
L '## テスト：正しく動くか確認する'
L ''
L '### 保存して、実行する'
L ''
L '1. 右上の「Save」（保存）を押します。**赤い印（Invalid parameters）が付いた箱が残っていると、保存できません。** 赤い箱を開いて、赤い * の付いた欄を入力してください。'
L ('2. 「Test」→「Manually」→「Run flow」→「Done」の順に押して、実行します。（画面の表記が違うときは、近い名前を選びます）')
L '3. 実行が終わると、各箱に印が付きます。**緑＝成功、赤＝失敗、灰色＝実行されなかった**です。箱をクリックすると、入力と出力が見られます。'
L ''
$ti = 0
if ($SpecData.Tests.Count -gt 0) {
    L '### 業務手順書のテスト（あなたが決めたもの）'
    L ''
    foreach ($t in $SpecData.Tests) {
        $ti++
        L ('#### テスト ' + $ti + '：' + $t.Title)
        L ''
        $pr = Get-Field $t.Fields @('準備')
        $op = Get-Field $t.Fields @('操作')
        $ex = Get-Field $t.Fields @('期待結果')
        L ('- [ ] 準備（テストデータ）：' + $(if ($null -ne $pr) { $pr } else { '（記載なし）' }))
        L ('- [ ] 操作：' + $(if ($null -ne $op) { $op } else { '（記載なし）' }))
        L ('- [ ] 期待結果：' + $(if ($null -ne $ex) { $ex } else { '（記載なし）' }))
        L ''
    }
}
L '### 標準のテスト（このツールが追加）'
L ''
L '#### 標準テスト A：最後まで正常に動く'
L ''
L '- [ ] 準備：業務手順書の手順どおりに、少ない件数のテストデータを用意する'
L '- [ ] 操作：フローを手動で実行する'
L ('- [ ] 期待結果：すべての箱が緑になる。' + $(if ($hasError) { '`catch` は灰色（実行されない）のまま。失敗通知のメールは届かない。' } else { '' }))
L ''
if ($hasError) {
    L '#### 標準テスト B：わざと失敗させて、失敗通知が届くことを確認する'
    L ''
    L '- [ ] 準備：**練習用のデータ**で行う（本番のデータでは行わない）。Try の中の箱が失敗する状態にする（例：Excel のファイル名を一時的に変える）'
    L '- [ ] 操作：フローを手動で実行する'
    L '- [ ] 期待結果：`Try` が赤になり、`catch` が緑で動いて、失敗通知のメールが届く（宛先・件名・本文が、上の設定どおり）'
    L '- [ ] 後片付け：変えた名前などを元に戻す'
    L ''
}
$hasExcel = $false
foreach ($n in $nodes) { if ($n.Kind -eq 'ExcelList') { $hasExcel = $true } }
if ($hasExcel) {
    L '#### 標準テスト C：行数の多い表で、全件が取得できる'
    L ''
    L '- [ ] 準備：Excel の表に、多めの行数のテストデータを入れる（ページ分けのしきい値より多い行数）'
    L '- [ ] 操作：フローを手動で実行する'
    L '- [ ] 期待結果：Excel の一覧取得の出力の件数が、表の行数と一致する（件数は、式ライブラリ 08「配列の件数」の式で数えられます）'
    L '- 注意：ページ分けの設定がない場合、既定の上限で打ち切られる恐れがあります。既定の上限の件数は、サンプルがなく**要確認**です。'
    L ''
}

# ---------- 要確認の一覧 ----------
L '## 最後に：まだ分かっていないこと（サンプルがないもの）'
L ''
L '日本語の画面表示の名前は、サンプルがないため、すべて **要確認** です。この手順書は英語表示の名前で書いています。日本語表示の画面のときは、英語名の意味から探してください。'
L ''
if ($script:Unconfirmed.Count -eq 0) {
    L '- この手順書の範囲で、サンプルがなくて書けなかった項目は、ほかにありません。'
}
else {
    L '| 場所 | 要確認の内容 |'
    L '| --- | --- |'
    foreach ($u in $script:Unconfirmed) {
        $parts = $u -split '｜', 2
        L ('| ' + (Cell $parts[0]) + ' | ' + (Cell $parts[1]) + ' |')
    }
    L ''
    L 'これらは、該当する箱のサンプル（`docs/sample_checklist.md` の手順で取り出したコードのプレビュー）を `samples/` に追加すると、次の版から、確認済みの書き方で出力できます。'
}
L ''

# ---------- 用語の説明 ----------
L '## 用語の説明'
L ''
L '- **箱（アクション）**：フローの中の、1つ1つの処理です。画面では、四角い箱で表示されます。'
L '- **トリガー**：フローが動き出す「きっかけ」です。一番上の箱です。'
L '- **＋（プラス）**：箱を足すためのボタンです。箱と箱の間や、まとめる箱の中にあります。'
L '- **スコープ（Scope）**：いくつかの箱を、まとめて入れる大きな箱です。この手順書では、「Try」と「catch」に使います。'
L '- **式（fx）**：日付の計算などを行う「命令」です。この手順書に載っているものを、コピーして貼ります。'
L '- **動的なコンテンツ（⚡）**：前の箱の結果を、入力欄に入れる機能です。'
L '- **Run after（実行条件）**：前の箱が、どうなったとき（成功／失敗…）に、その箱を動かすかの設定です。'
L '- **Code view**：箱の設定を、文字で見る画面です。作った内容を確認したい人向けです。'
L ''

# 警告の欄（手順の書き出し中に増えた警告も含めて、冒頭に差し込む）
if ($script:Warnings.Count -gt 0) {
    $wl = New-Object System.Collections.ArrayList
    [void]$wl.Add('## 作成時の警告')
    [void]$wl.Add('')
    foreach ($w in $script:Warnings) { [void]$wl.Add('- ⚠ ' + $w) }
    [void]$wl.Add('')
    $script:O.InsertRange($script:WarnInsertAt, $wl)
}

# ===================== Markdown → HTML（簡易） =====================
function ConvertTo-InlineHtml([string]$s) {
    $t = [System.Net.WebUtility]::HtmlEncode($s)
    $t = [regex]::Replace($t, '\*\*(.+?)\*\*', '<b>$1</b>')
    $t = [regex]::Replace($t, '`([^`]+)`', '<code class="en">$1</code>')
    return $t
}

function ConvertTo-HtmlGuide($Lines, [string]$Title) {
    $h = New-Object System.Collections.ArrayList
    $inCode = $false
    $codeLang = ''
    $codeBuf = New-Object System.Collections.ArrayList
    $codeId = 0
    $listType = ''
    $inTable = $false
    $tableRows = New-Object System.Collections.ArrayList
    $closeList = {
        if ($listType -ne '') { [void]$h.Add('</' + $listType + '>'); $listType = '' }
    }
    $flushTable = {
        if ($inTable) {
            [void]$h.Add('<table>')
            $first = $true
            foreach ($r in $tableRows) {
                $cells = $r.Trim().Trim('|') -split '(?<!\\)\|'
                if ($first) { $tag = 'th'; $first = $false } else { $tag = 'td' }
                $tr = '<tr>'
                foreach ($c in $cells) { $tr = $tr + '<' + $tag + '>' + (ConvertTo-InlineHtml ($c.Trim() -replace '\\\|', '|')) + '</' + $tag + '>' }
                [void]$h.Add($tr + '</tr>')
            }
            [void]$h.Add('</table>')
            $tableRows.Clear()
            $inTable = $false
        }
    }
    foreach ($raw in $Lines) {
        $ln = $raw
        if ($inCode) {
            if ($ln.Trim().StartsWith('```')) {
                if ($codeLang -eq 'svgfig') {
                    [void]$h.Add(($codeBuf -join "`n"))
                }
                elseif ($codeLang -eq 'tree') {
                    # 完成図（SVG）があるので、文字の図は HTML では出さない
                }
                else {
                    $codeId++
                    $txt = [System.Net.WebUtility]::HtmlEncode(($codeBuf -join "`n"))
                    [void]$h.Add('<div class="codewrap"><pre class="code" id="c' + $codeId + '">' + $txt + '</pre><button class="copy" type="button" data-target="c' + $codeId + '">コピー</button></div>')
                }
                $codeBuf.Clear()
                $inCode = $false
            }
            else { if ($codeLang -eq 'svgfig') { [void]$codeBuf.Add($ln) } else { [void]$codeBuf.Add(($ln -replace '^  ', '').TrimEnd()) } }
            continue
        }
        if ($ln.Trim().StartsWith('```')) {
            . $closeList
            . $flushTable
            $inCode = $true
            $codeLang = $ln.Trim().Substring(3).Trim()
            continue
        }
        if ($ln.StartsWith(':::details ')) {
            . $closeList
            . $flushTable
            [void]$h.Add('<details><summary>' + (ConvertTo-InlineHtml $ln.Substring(11)) + '</summary>')
            continue
        }
        if ($ln.Trim() -eq ':::') {
            . $closeList
            . $flushTable
            [void]$h.Add('</details>')
            continue
        }
        if ($ln.StartsWith('|')) {
            . $closeList
            $inTable = $true
            if ($ln -notmatch '^\|\s*-+') { [void]$tableRows.Add($ln) }
            continue
        }
        else { . $flushTable }
        if ($ln.Trim() -eq '') { . $closeList; continue }
        $m = [regex]::Match($ln, '^(#{1,4})\s+(.*)$')
        if ($m.Success) {
            . $closeList
            $lv = $m.Groups[1].Value.Length
            [void]$h.Add('<h' + $lv + '>' + (ConvertTo-InlineHtml $m.Groups[2].Value) + '</h' + $lv + '>')
            continue
        }
        if ($ln.StartsWith('> ')) {
            . $closeList
            [void]$h.Add('<div class="box">' + (ConvertTo-InlineHtml $ln.Substring(2)) + '</div>')
            continue
        }
        $m = [regex]::Match($ln, '^(\s*)-\s+\[ \]\s+(.*)$')
        if ($m.Success) {
            if ($listType -ne 'ul') { . $closeList; [void]$h.Add('<ul class="chk">'); $listType = 'ul' }
            [void]$h.Add('<li><label><input type="checkbox"> ' + (ConvertTo-InlineHtml $m.Groups[2].Value) + '</label></li>')
            continue
        }
        $m = [regex]::Match($ln, '^\s*-\s+(.*)$')
        if ($m.Success) {
            if ($listType -ne 'ul') { . $closeList; [void]$h.Add('<ul>'); $listType = 'ul' }
            [void]$h.Add('<li>' + (ConvertTo-InlineHtml $m.Groups[1].Value) + '</li>')
            continue
        }
        $m = [regex]::Match($ln, '^\s*\d+\.\s+(.*)$')
        if ($m.Success) {
            if ($listType -ne 'ol') { . $closeList; [void]$h.Add('<ol>'); $listType = 'ol' }
            [void]$h.Add('<li>' + (ConvertTo-InlineHtml $m.Groups[1].Value) + '</li>')
            continue
        }
        . $closeList
        [void]$h.Add('<p>' + (ConvertTo-InlineHtml $ln.Trim()) + '</p>')
    }
    . $closeList
    . $flushTable
    $css = ':root{--bg:#f7f8fa;--fg:#1f2430;--sub:#5a6272;--line:#d9dde5;--card:#fff;--acc:#0b5fd3;--code:#10151f;--code-fg:#e8edf7}' +
        '@media (prefers-color-scheme:dark){:root{--bg:#14171d;--fg:#e8ebf2;--sub:#a3abbb;--line:#2e3442;--card:#1b1f27;--acc:#6aa5ff;--code:#0b0e14}}' +
        '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:"Yu Gothic UI","Meiryo UI","Hiragino Sans",sans-serif;line-height:1.8;font-size:17px}' +
        '.wrap{max-width:960px;margin:0 auto;padding:16px}h1{font-size:1.6rem}h2{font-size:1.3rem;border-left:6px solid var(--acc);padding-left:.6em;margin:2em 0 .6em}h3{font-size:1.1rem;margin:1.5em 0 .3em;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.3em .8em}h4{font-size:1rem;margin:1em 0 .2em}' +
        'table{border-collapse:collapse;width:100%;background:var(--card);font-size:.93rem;margin:.6em 0}th,td{border:1px solid var(--line);padding:.35em .6em;text-align:left;vertical-align:top}th{background:var(--bg)}' +
        '.box{border:1px solid var(--line);background:var(--card);border-radius:8px;padding:.6em 1em;margin:.8em 0}code.en{font-family:Consolas,monospace;background:var(--line);padding:0 .3em;border-radius:4px;font-size:.92em}' +
        '.codewrap{position:relative}pre.code{background:var(--code);color:var(--code-fg);padding:.7em 5em .7em .8em;border-radius:8px;white-space:pre-wrap;word-break:break-all;font-size:.88em;line-height:1.5;font-family:Consolas,monospace;margin:.4em 0}' +
        '.copy{position:absolute;right:.4em;top:.4em;background:var(--acc);color:#fff;border:0;border-radius:6px;padding:.2em .8em;cursor:pointer;font:inherit}.copy.done{background:#1c8a46}' +
        'ul.chk{list-style:none;padding-left:.2em}li{margin:.25em 0}@media print{.copy{display:none}details{display:block}}' +
        ':root{--warn:#a05a00;--warn-bg2:#fff4e0;--ng:#a12020;--ng-bg2:#fdecec}@media (prefers-color-scheme:dark){:root{--warn:#ffc46b;--warn-bg2:#4a3515;--ng:#ff9c9c;--ng-bg2:#3a1a1a}}' +
        '.fig{margin:1em 0}.fig svg{width:100%;height:auto;max-width:900px;display:block;margin:0 auto}.fig figcaption{color:var(--sub);font-size:.9rem;text-align:center;margin-top:.3em}' +
        'svg .st{fill:var(--fg)}svg .ss{fill:var(--sub)}svg .sw{fill:#fff}svg .sw2{fill:var(--warn)}svg .sred{fill:var(--ng)}' +
        'details{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.4em 1em;margin:.8em 0}summary{cursor:pointer;font-weight:bold;color:var(--sub)}'
    $js = '(function(){function cp(t,b){function ok(){var o=b.textContent;b.textContent="コピーしました";b.classList.add("done");setTimeout(function(){b.textContent=o;b.classList.remove("done");},1500);}' +
        'function fb(){var a=document.createElement("textarea");a.value=t;a.style.position="fixed";a.style.opacity="0";document.body.appendChild(a);a.select();try{document.execCommand("copy");ok();}catch(e){window.prompt("Ctrl+C でコピーしてください",t);}document.body.removeChild(a);}' +
        'if(navigator.clipboard){navigator.clipboard.writeText(t).then(ok,fb);}else{fb();}}' +
        'document.querySelectorAll(".copy").forEach(function(b){b.addEventListener("click",function(){cp(document.getElementById(b.dataset.target).textContent,b);});});})();'
    $doc = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
        [System.Net.WebUtility]::HtmlEncode($Title) + '</title><style>' + $css + '</style></head><body><div class="wrap">' + ($h -join "`n") + '</div><script>' + $js + '</script></body></html>'
    return $doc
}

# ===================== 出力 =====================
function ConvertTo-PlainMd($Lines) {
    $res = New-Object System.Collections.ArrayList
    $skip = $false
    foreach ($ln in $Lines) {
        if ($skip) { if ($ln.Trim().StartsWith('```')) { $skip = $false }; continue }
        if ($ln.Trim() -eq '```svgfig') { $skip = $true; continue }
        if ($ln.Trim() -eq '```tree') { [void]$res.Add('```text'); continue }
        if ($ln.StartsWith(':::details ')) { [void]$res.Add('**' + $ln.Substring(11) + '**'); [void]$res.Add(''); continue }
        if ($ln.Trim() -eq ':::') { continue }
        [void]$res.Add($ln)
    }
    return $res
}
$md = ((ConvertTo-PlainMd $script:O) -join "`n")
Write-Output $md
if ($OutFile -ne '') {
    [System.IO.File]::WriteAllText($OutFile, ($md -replace "`n", "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($true)))
}
if ($Html -ne '') {
    $doc = ConvertTo-HtmlGuide $script:O ('構築手順書：' + $SpecData.Title)
    [System.IO.File]::WriteAllText($Html, $doc, (New-Object System.Text.UTF8Encoding($true)))
}
exit 0
