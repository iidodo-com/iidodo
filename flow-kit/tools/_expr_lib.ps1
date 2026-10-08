<#
  式ライブラリ（expressions/*.md）を読む共通部品。
  make_expression.ps1 と build_guide.ps1 から dot-source（. で読み込み）して使う。
  Windows PowerShell 5.1 で動作する書き方に限定している。
#>

# --- ファイルを UTF-8 として読む（文字コードを明示） ---
function Read-Utf8Lines([string]$Path) {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
    return ,($text -split "\r?\n")
}

# --- ライブラリの読み込み ---
function Get-Library([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir)) {
        throw "式ライブラリのフォルダーが見つかりません: $Dir"
    }
    $items = New-Object System.Collections.ArrayList
    $files = Get-ChildItem -LiteralPath $Dir -Filter '*.md' | Where-Object { $_.Name -match '^[0-9][0-9]_' } | Sort-Object Name
    foreach ($f in $files) {
        $lines = Read-Utf8Lines $f.FullName
        $title = ''
        $exprId = ''
        $kw = ''
        $status = ''
        foreach ($ln in $lines) {
            if ($title -eq '' -and $ln.StartsWith('# ')) { $title = $ln.Substring(2).Trim() }
            elseif ($ln.StartsWith('- ID: ')) { $exprId = $ln.Substring(6).Trim() }
            elseif ($ln.StartsWith('- キーワード: ')) { $kw = $ln.Substring(9).Trim() }
            elseif ($ln.StartsWith('- 検証状況: ')) { $status = $ln.Substring(8).Trim() }
        }
        if ($exprId -eq '' -or $title -eq '') { continue }
        $kwList = @()
        foreach ($k in ($kw -split '[,、]')) {
            $kk = $k.Trim()
            if ($kk -ne '') { $kwList += $kk }
        }
        $o = New-Object PSObject -Property @{
            Id       = $exprId
            Title    = $title
            File     = $f.Name
            Keywords = $kwList
            Status   = $status
            Lines    = $lines
        }
        [void]$items.Add($o)
    }
    return ,$items
}

# --- 「## 見出し」ごとに本文を取り出す ---
function Get-Sections($Lines) {
    $sec = [ordered]@{}
    $cur = ''
    foreach ($ln in $Lines) {
        if ($ln.StartsWith('## ')) {
            $cur = $ln.Substring(3).Trim()
            $sec[$cur] = New-Object System.Collections.ArrayList
        }
        elseif ($cur -ne '') {
            [void]$sec[$cur].Add($ln)
        }
    }
    return $sec
}

# --- 要件（日本語）とキーワードを照合し、一致度の高い順に返す（一致なしは空の配列） ---
function Get-RankedExpr($Lib, [string]$Requirement) {
    $found = New-Object System.Collections.ArrayList
    foreach ($e in $Lib) {
        $score = 0
        $hits = @()
        foreach ($k in $e.Keywords) {
            if ($k.Length -lt 2) { continue }   # 1文字のキーワードは誤ヒットしやすいので使わない（例：「要件」の「件」）
            if ($Requirement.IndexOf($k, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $score += $k.Length
                $hits += $k
            }
        }
        if ($score -gt 0) {
            [void]$found.Add((New-Object PSObject -Property @{ Entry = $e; Score = $score; Hits = $hits }))
        }
    }
    # スコアの降順（同点は ID 順）
    $sorted = @($found | Sort-Object @{ Expression = 'Score'; Descending = $true }, @{ Expression = { $_.Entry.Id }; Descending = $false })
    return $sorted   # 呼び出し側は @(Get-RankedExpr ...) で受け取る（1件・0件でも配列になる）
}

# --- 「## 式（貼り付け用）」節の最初のコードブロック（本番で貼る式）を取り出す ---
function Get-FirstExprBlock($Entry) {
    $sec = Get-Sections $Entry.Lines
    if (-not $sec.Contains('式（貼り付け用）')) { return '' }
    $inBlock = $false
    $buf = New-Object System.Collections.ArrayList
    foreach ($ln in $sec['式（貼り付け用）']) {
        if (-not $inBlock) {
            if ($ln.StartsWith('```')) { $inBlock = $true }
        }
        else {
            if ($ln.StartsWith('```')) { break }
            [void]$buf.Add($ln)
        }
    }
    return (($buf -join "`n").Trim())
}
