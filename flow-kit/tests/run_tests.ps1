<#
.SYNOPSIS
  クラウドフロー作成支援キットのテストを実行する（Windows PowerShell 5.1 対応）。

.DESCRIPTION
  tests/ 配下の入力（cases.csv など）と期待出力を使い、tools/ のツールを実行して結果を比べる。
  すべて成功なら終了コード 0、失敗があれば 1。

.PARAMETER Target
  実行するテスト。all / make_expression / build_guide / ps51（PowerShell 5.1 互換の静的チェック）

.PARAMETER UpdateGolden
  期待出力（expected/*.txt）を、現在のツールの出力で作り直す。作り直した内容は必ず目視で確認すること。

.EXAMPLE
  powershell -NoProfile -File .\tests\run_tests.ps1
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'make_expression', 'build_guide', 'ps51')]
    [string]$Target = 'all',
    [switch]$UpdateGolden
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$script:Pass = 0
$script:Fail = 0
$script:Msgs = New-Object System.Collections.ArrayList

function Report([bool]$Ok, [string]$Name, [string]$Detail) {
    if ($Ok) {
        $script:Pass++
        Write-Host ('[OK]   ' + $Name)
    }
    else {
        $script:Fail++
        Write-Host ('[NG]   ' + $Name)
        if ($Detail -ne '') { Write-Host ('       ' + $Detail) }
    }
}

function Read-Utf8([string]$Path) {
    return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Normalize([string]$s) {
    return ($s -replace "`r`n", "`n").TrimEnd("`n", "`r", ' ')
}

# 別プロセスではなく、同じセッションでスクリプトを呼ぶ（終了コードは $LASTEXITCODE で取る）
function Invoke-Tool([string]$ToolPath, [hashtable]$ToolArgs) {
    $global:LASTEXITCODE = 0
    $lines = & $ToolPath @ToolArgs
    $code = $global:LASTEXITCODE
    $text = ''
    if ($null -ne $lines) { $text = (@($lines) -join "`n") }
    return New-Object PSObject -Property @{ Text = $text; Code = $code }
}

# ======================= make_expression =======================
function Test-MakeExpression {
    Write-Host '--- make_expression ---'
    $tool = Join-Path (Join-Path $Root 'tools') 'make_expression.ps1'
    $dir = Join-Path (Join-Path $Root 'tests') 'make_expression'
    $expDir = Join-Path $Root 'expressions'
    $cases = Import-Csv -LiteralPath (Join-Path $dir 'cases.csv') -Encoding UTF8
    $goldenCases = @('c01', 'c03', 'c13', 'c14')

    foreach ($c in $cases) {
        $toolArgs = @{}
        if ($c.requirement -ne '') { $toolArgs['Requirement'] = $c.requirement }
        if ($c.id_arg -ne '') { $toolArgs['Id'] = $c.id_arg }
        if ($c.param -ne '') {
            $kv = $c.param.Split('=', 2)
            $toolArgs['Param'] = @{ $kv[0] = $kv[1] }
        }
        $r = Invoke-Tool $tool $toolArgs
        $name = 'make_expression ' + $c.case

        # 1) 終了コード
        Report ($r.Code -eq [int]$c.expected_exit) ($name + ' 終了コード') ('期待 ' + $c.expected_exit + ' / 実際 ' + $r.Code)

        # 2) 採用された ID と、式がライブラリの記載と一致するか
        if ($c.expected_id -ne '') {
            $m = [regex]::Match($r.Text, '採用: .*?ID: (E[0-9]+)')
            $got = ''
            if ($m.Success) { $got = $m.Groups[1].Value }
            Report ($got -eq $c.expected_id) ($name + ' 採用ID') ('期待 ' + $c.expected_id + ' / 実際 ' + $got)

            # ライブラリのファイルから「式（貼り付け用）」節の最初のコードブロックを独立に取り出して比較
            $mdFile = $null
            foreach ($f in (Get-ChildItem -LiteralPath $expDir -Filter '*.md')) {
                if ((Read-Utf8 $f.FullName) -match ('(?m)^- ID: ' + $c.expected_id + '\s*$')) { $mdFile = $f }
            }
            if ($null -ne $mdFile) {
                $md = Normalize (Read-Utf8 $mdFile.FullName)
                $mm = [regex]::Match($md, '(?s)## 式（貼り付け用）.*?```text\n(.*?)\n```')
                $expr = $mm.Groups[1].Value
                # -Param 指定時は置換後の式と比べる
                if ($c.param -ne '') {
                    $kv2 = $c.param.Split('=', 2)
                    $expr = $expr.Replace('<' + $kv2[0] + '>', $kv2[1])
                }
                Report (($expr -ne '') -and $r.Text.Contains($expr)) ($name + ' 式がライブラリと一致') ('出力に次の式が含まれない: ' + $expr)
            }
            else {
                Report $false ($name + ' ライブラリのファイル特定') ('ID ' + $c.expected_id + ' のファイルが見つからない')
            }
        }
        else {
            Report ($r.Text.Contains('該当する式がライブラリにありません')) ($name + ' 該当なしメッセージ') '「該当する式がライブラリにありません」が出力に無い'
        }

        # 3) 期待出力（ゴールデン）との完全比較
        if ($goldenCases -contains $c.case) {
            $gpath = Join-Path (Join-Path $dir 'expected') ($c.case + '.txt')
            if ($UpdateGolden) {
                [System.IO.File]::WriteAllText($gpath, ((Normalize $r.Text) + "`n"), (New-Object System.Text.UTF8Encoding($true)))
                Write-Host ('       期待出力を更新: ' + $gpath)
            }
            if (Test-Path -LiteralPath $gpath) {
                $want = Normalize (Read-Utf8 $gpath)
                $have = Normalize $r.Text
                Report ($want -eq $have) ($name + ' 期待出力と完全一致') '期待出力ファイルと差異あり（差異を確認し、意図した変更なら -UpdateGolden で更新）'
            }
            else {
                Report $false ($name + ' 期待出力ファイル') ('見つからない: ' + $gpath)
            }
        }
    }

    # -Param の置換が残っていないこと
    $r14 = Invoke-Tool $tool @{ Id = 'E07'; Param = @{ '値' = "triggerBody()?['comment']" } }
    Report ((-not $r14.Text.Contains('<値>')) -and $r14.Text.Contains("string(triggerBody()?['comment'])")) 'make_expression -Param で <値> が置換される' '<値> が残っている、または置換後の式が無い'

    # -List
    $rl = Invoke-Tool $tool @{ List = $true }
    $okList = ($rl.Code -eq 0)
    foreach ($id in @('E00', 'E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09', 'E10', 'E11', 'E12')) {
        if (-not $rl.Text.Contains($id + ':')) { $okList = $false }
    }
    Report $okList 'make_expression -List が全式を列挙する' 'E00〜E12 のいずれかが一覧に無い'

    # -OutFile（BOM 付き UTF-8 で保存される）
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('make_expression_test_' + [guid]::NewGuid().ToString('N') + '.md')
    try {
        [void](Invoke-Tool $tool @{ Requirement = '月末日を求めたい'; OutFile = $tmp })
        $bytes = [System.IO.File]::ReadAllBytes($tmp)
        $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
        Report $hasBom 'make_expression -OutFile は BOM 付き UTF-8' 'BOM が付いていない'
    }
    finally {
        if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }
    }
}

# ======================= build_guide =======================
function Test-BuildGuide {
    Write-Host '--- build_guide ---'
    $tool = Join-Path (Join-Path $Root 'tools') 'build_guide.ps1'
    $dir = Join-Path (Join-Path $Root 'tests') 'build_guide'
    $cases = Import-Csv -LiteralPath (Join-Path $dir 'cases.csv') -Encoding UTF8
    $goldenCases = @('b01', 'b02', 'b04')

    foreach ($c in $cases) {
        $specPath = Join-Path $Root $c.spec
        $r = Invoke-Tool $tool @{ Spec = $specPath }
        $name = 'build_guide ' + $c.case
        Report ($r.Code -eq [int]$c.expected_exit) ($name + ' 終了コード') ('期待 ' + $c.expected_exit + ' / 実際 ' + $r.Code)
        if ($c.must_contain -ne '') {
            foreach ($needle in ($c.must_contain -split '\|\|')) {
                Report $r.Text.Contains($needle) ($name + ' に含まれる: ' + $needle) '出力に見つからない'
            }
        }
        if ($c.must_not_contain -ne '') {
            foreach ($needle in ($c.must_not_contain -split '\|\|')) {
                Report (-not $r.Text.Contains($needle)) ($name + ' に含まれない: ' + $needle) '含まれてはいけない文字が出力にある'
            }
        }
        if ($goldenCases -contains $c.case) {
            $gpath = Join-Path (Join-Path $dir 'expected') ($c.case + '.md')
            if ($UpdateGolden) {
                [System.IO.File]::WriteAllText($gpath, ((Normalize $r.Text) + "`n"), (New-Object System.Text.UTF8Encoding($true)))
                Write-Host ('       期待出力を更新: ' + $gpath)
            }
            if (Test-Path -LiteralPath $gpath) {
                Report ((Normalize (Read-Utf8 $gpath)) -eq (Normalize $r.Text)) ($name + ' 期待出力と完全一致') '期待出力ファイルと差異あり（意図した変更なら -UpdateGolden で更新）'
            }
            else { Report $false ($name + ' 期待出力ファイル') ('見つからない: ' + $gpath) }
        }
    }

    # 出力に書いた「サンプルで確認済み」の根拠が、samples/ のサンプルに実在するか
    $sd = Join-Path (Join-Path $Root 'samples') 'actions'
    $excelOn = (Read-Utf8 (Join-Path $sd 'excel__list_rows_in_table__pagination_on.json')) | ConvertFrom-Json
    $excelOff = (Read-Utf8 (Join-Path $sd 'excel__list_rows_in_table__pagination_off.json')) | ConvertFrom-Json
    $feOn = (Read-Utf8 (Join-Path $sd 'control__apply_to_each__concurrency_on.json')) | ConvertFrom-Json
    $feOff = (Read-Utf8 (Join-Path $sd 'control__apply_to_each__concurrency_off.json')) | ConvertFrom-Json
    $scope = (Read-Utf8 (Join-Path $sd 'control__scope__run_after_failed.json')) | ConvertFrom-Json
    Report ($excelOn.runtimeConfiguration.paginationPolicy.minimumItemCount -eq 5000) '根拠サンプル: Excel の paginationPolicy.minimumItemCount' ''
    Report ($null -eq $excelOff.PSObject.Properties['runtimeConfiguration']) '根拠サンプル: ページネーションなしは runtimeConfiguration がない' ''
    Report ($excelOn.inputs.host.operationId -eq 'GetItems') '根拠サンプル: Excel の operationId GetItems' ''
    Report ($feOn.runtimeConfiguration.concurrency.repetitions -eq 4) '根拠サンプル: Apply to each の concurrency.repetitions' ''
    Report ($null -eq $feOff.PSObject.Properties['runtimeConfiguration']) '根拠サンプル: 並列なしは runtimeConfiguration がない' ''
    Report ($feOff.foreach -eq "@outputs('List_rows_present_in_a_table')?['body/value']") '根拠サンプル: foreach の式' ''
    Report ((@($scope.runAfter.Try) -join ',') -eq 'TimedOut,Failed') '根拠サンプル: スコープの runAfter（TimedOut, Failed）' ''
    Report ($scope.actions.'Send_an_email_(V2)'.inputs.host.operationId -eq 'SendEmailV2') '根拠サンプル: メール送信の operationId SendEmailV2' ''

    # HTML 出力
    $tmpH = Join-Path ([System.IO.Path]::GetTempPath()) ('build_guide_test_' + [guid]::NewGuid().ToString('N') + '.html')
    $tmpM = Join-Path ([System.IO.Path]::GetTempPath()) ('build_guide_test_' + [guid]::NewGuid().ToString('N') + '.md')
    try {
        [void](Invoke-Tool $tool @{ Spec = (Join-Path (Join-Path $Root 'docs') 'spec_example.md'); Html = $tmpH; OutFile = $tmpM })
        $html = Read-Utf8 $tmpH
        Report ($html.Contains('class="copy"') -and $html.Contains('<table>') -and $html.Contains('<h2>')) 'build_guide -Html: コピーボタン・表・見出しがある' ''
        Report (-not $html.Contains('**')) 'build_guide -Html: Markdown の記号（**）が残っていない' ''
        Report ($html.Contains('<svg') -and $html.Contains('<details>') -and $html.Contains('</details>')) 'build_guide -Html: 図（SVG）と折りたたみ（くわしい情報）がある' ''
        Report (-not $html.Contains(':::') -and -not $html.Contains('svgfig')) 'build_guide -Html: 内部の目印（:::／svgfig）が残っていない' ''
        Report ($html.Contains('式を貼る場所：Send an email (V2) の Subject') -and -not $html.Contains('G2')) 'build_guide -Html: 式を貼る場所の図が、その箱・欄に合わせてあり、検証用の名前（G2）が出ない' ''
        Report ($html.Contains('どの「＋」を押すか') -and $html.Contains('<ol start="2">')) 'build_guide -Html: 枠の外の＋の図と、番号の続き（start）がある' ''
        Report (-not $html.Contains('<script>alert')) 'build_guide -Html: 想定外のスクリプトがない' ''
        $bytes = [System.IO.File]::ReadAllBytes($tmpM)
        Report ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) 'build_guide -OutFile は BOM 付き UTF-8' ''
    }
    finally {
        foreach ($t in @($tmpH, $tmpM)) { if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Force } }
    }
}

# ======================= PowerShell 5.1 互換の静的チェック =======================
function Test-Ps51 {
    Write-Host '--- ps51 互換チェック ---'
    $files = New-Object System.Collections.ArrayList
    foreach ($d in @('tools', 'tests')) {
        $p = Join-Path $Root $d
        if (Test-Path -LiteralPath $p) {
            foreach ($f in (Get-ChildItem -LiteralPath $p -Recurse -Filter '*.ps1')) { [void]$files.Add($f) }
        }
    }
    # 7 以降でだけ現れるトークン（名前で比べる。5.1 では存在しない名前もあるため）
    $badKinds = @('AndAnd', 'OrOr', 'QuestionQuestion', 'QuestionQuestionEquals', 'QuestionDot', 'QuestionLBracket', 'Question')
    $badParams = @('-Parallel', '-AsHashtable', '-AdditionalChildPath', '-NoEmphasis', '-SkipHttpErrorCheck')
    $badEncodings = @('utf8BOM', 'utf8NoBOM')
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($Root.Length + 1)
        $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
        $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
        Report $hasBom ($rel + ' が BOM 付き UTF-8') 'BOM がない（5.1 で日本語が化ける）'

        $tokens = $null
        $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($f.FullName, [ref]$tokens, [ref]$errors)
        Report (@($errors).Count -eq 0) ($rel + ' に構文エラーがない') (($errors | ForEach-Object { $_.Message }) -join ' / ')

        $found = New-Object System.Collections.ArrayList
        foreach ($t in $tokens) {
            if ($badKinds -contains $t.Kind.ToString()) { [void]$found.Add(($t.Kind.ToString() + ' (行 ' + $t.Extent.StartLineNumber + ')')) }
            if ($t.Kind.ToString() -eq 'Parameter') {
                foreach ($bp in $badParams) {
                    if ($t.Text -ieq $bp) { [void]$found.Add($t.Text + ' (行 ' + $t.Extent.StartLineNumber + ')') }
                }
            }
        }
        # コマンドごとのチェック
        $cmds = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)
        foreach ($cmd in $cmds) {
            $cname = $cmd.GetCommandName()
            if ($null -eq $cname) { continue }
            $paramNames = @()
            $positional = 0
            $els = $cmd.CommandElements
            for ($i = 1; $i -lt $els.Count; $i++) {
                if ($els[$i] -is [System.Management.Automation.Language.CommandParameterAst]) { $paramNames += $els[$i].ParameterName }
                else { $positional++ }
            }
            $lower = $cname.ToLowerInvariant()
            if ($lower -eq 'convertto-json' -and ($paramNames -notcontains 'Depth')) {
                [void]$found.Add('ConvertTo-Json に -Depth がない (行 ' + $cmd.Extent.StartLineNumber + ')')
            }
            if (@('get-content', 'set-content', 'out-file', 'add-content', 'import-csv', 'export-csv') -contains $lower -and ($paramNames -notcontains 'Encoding')) {
                [void]$found.Add($cname + ' に -Encoding がない (行 ' + $cmd.Extent.StartLineNumber + ')')
            }
            if ($lower -eq 'join-path' -and $positional -gt 2) {
                [void]$found.Add('Join-Path に3つ以上のパス（5.1 は不可） (行 ' + $cmd.Extent.StartLineNumber + ')')
            }
            if ($lower -eq 'convertfrom-json' -and ($paramNames -contains 'AsHashtable')) {
                [void]$found.Add('ConvertFrom-Json -AsHashtable (行 ' + $cmd.Extent.StartLineNumber + ')')
            }
            if (@('get-content', 'set-content', 'out-file', 'add-content', 'import-csv', 'export-csv') -contains $lower) {
                for ($i = 1; $i -lt $els.Count - 1; $i++) {
                    $e1 = $els[$i]
                    if ($e1 -is [System.Management.Automation.Language.CommandParameterAst] -and $e1.ParameterName -eq 'Encoding') {
                        $v = $els[$i + 1].Extent.Text.Trim('"', "'")
                        if ($badEncodings -contains $v) { [void]$found.Add('-Encoding ' + $v + ' は 5.1 非対応 (行 ' + $cmd.Extent.StartLineNumber + ')') }
                    }
                }
            }
        }
        Report ($found.Count -eq 0) ($rel + ' に 7 以降専用の書き方がない') ($found -join ' / ')
    }
}

if ($Target -eq 'all' -or $Target -eq 'ps51') { Test-Ps51 }
if ($Target -eq 'all' -or $Target -eq 'make_expression') { Test-MakeExpression }
if ($Target -eq 'all' -or $Target -eq 'build_guide') { Test-BuildGuide }

Write-Host ''
Write-Host ('結果: 成功 {0} / 失敗 {1}' -f $script:Pass, $script:Fail)
if ($script:Fail -gt 0) { exit 1 }
exit 0
