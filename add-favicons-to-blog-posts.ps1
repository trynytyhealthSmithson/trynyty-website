# ───────────────────────────────────────────────────────────────────
# TRYNYTY — Add favicon tags to remaining blog posts
# ───────────────────────────────────────────────────────────────────
# This script safely adds 3 favicon-related lines to each of the 5
# remaining blog posts. It only makes ONE change per file: adding
# the favicon tags immediately before the existing stylesheet link.
#
# HOW TO USE:
#   1. Drop this file into your repo folder (same place as index.html)
#   2. Right-click it -> "Run with PowerShell"  (or run it from a
#      PowerShell window in that folder)
#   3. It will print what it changed. Then you can git push as usual.
#
# SAFE TO RE-RUN: if a file already has the favicon tags, it skips it.
# ───────────────────────────────────────────────────────────────────

$files = @(
    "post-2027-call-letter.html",
    "post-cms-risk-adjustment.html",
    "post-mssp-lead-analysis.html",
    "post-v24-v28.html",
    "post-vbc-barriers.html"
)

$oldLine = '  <link rel="stylesheet" href="styles.css" />'
$newBlock = @"
  <link rel="icon" type="image/png" href="logo.png" />
  <link rel="apple-touch-icon" href="logo.png" />
  <meta property="og:image" content="logo.png" />
  <link rel="stylesheet" href="styles.css" />
"@

Write-Host ""
Write-Host "TRYNYTY favicon patcher" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan
Write-Host ""

foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        Write-Host "SKIP  $file  (not found in this folder)" -ForegroundColor Yellow
        continue
    }

    $content = Get-Content $file -Raw

    if ($content -match 'rel="icon" type="image/png" href="logo.png"') {
        Write-Host "SKIP  $file  (already has favicon tags)" -ForegroundColor Yellow
        continue
    }

    if ($content -notmatch [regex]::Escape($oldLine)) {
        Write-Host "SKIP  $file  (couldn't find stylesheet link — file may differ from expected format)" -ForegroundColor Yellow
        continue
    }

    $updated = $content -replace [regex]::Escape($oldLine), $newBlock.TrimEnd()
    Set-Content -Path $file -Value $updated -NoNewline -Encoding UTF8
    Write-Host "OK    $file" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Review the files if you want, then deploy:" -ForegroundColor Cyan
Write-Host '  git add .' -ForegroundColor White
Write-Host '  git commit -m "Add favicon tags to blog posts"' -ForegroundColor White
Write-Host '  git push' -ForegroundColor White
Write-Host '  git push origin master:main --force' -ForegroundColor White
Write-Host ""
