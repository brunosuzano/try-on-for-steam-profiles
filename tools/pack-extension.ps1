# Packs the extension into dist/try-on-for-steam-profiles-<version>.zip, the
# file the Chrome Web Store, Edge Add-ons and the other Chromium stores take.
#
#   powershell -ExecutionPolicy Bypass -File tools/pack-extension.ps1
#
# The zip holds manifest.json and exactly the files it references (service
# worker, content script, icons), so nothing else in the repo can leak into
# a release: no fixtures, docs, archive or icon drafts. It refuses to pack
# when the three version strings disagree, when a referenced file is
# missing, or when the working tree has uncommitted changes (a zip should
# match a commit; -AllowDirty overrides that one for a trial pack).
#
# Plain PowerShell 5.1, no Node. Entries are written with forward slashes:
# Compress-Archive in 5.1 writes backslashes, which other unzippers read as
# part of the file name rather than a folder.

param([switch]$AllowDirty)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($message) {
    Write-Host "REFUSED: $message" -ForegroundColor Red
    exit 1
}

# ---- versions ----
$manifestText = [IO.File]::ReadAllText((Join-Path $root 'manifest.json'))
$manifest = $manifestText | ConvertFrom-Json
$script = [IO.File]::ReadAllText((Join-Path $root 'try-on-for-steam-profiles.user.js'))

$metaVersion = [regex]::Match($script, '//\s*@version\s+(\S+)').Groups[1].Value
$constVersion = [regex]::Match($script, "SCRIPT_VERSION\s*=\s*'([^']+)'").Groups[1].Value
$version = $manifest.version

if (-not $version -or -not $metaVersion -or -not $constVersion) {
    Fail "couldn't read every version (manifest '$version', @version '$metaVersion', SCRIPT_VERSION '$constVersion')"
}
if ($version -ne $metaVersion -or $version -ne $constVersion) {
    Fail "versions disagree: manifest $version, @version $metaVersion, SCRIPT_VERSION $constVersion"
}
if ($version -notmatch '^\d+(\.\d+){0,3}$') {
    Fail "manifest version '$version' isn't 1-4 dot-separated numbers, which Chrome requires"
}

# ---- what the manifest references ----
$files = New-Object System.Collections.Generic.List[string]
$files.Add('manifest.json')
if ($manifest.background.service_worker) { $files.Add($manifest.background.service_worker) }
foreach ($cs in @($manifest.content_scripts)) {
    foreach ($js in @($cs.js)) { if ($js) { $files.Add($js) } }
    foreach ($css in @($cs.css)) { if ($css) { $files.Add($css) } }
}
foreach ($p in $manifest.icons.PSObject.Properties) { $files.Add($p.Value) }
if ($manifest.action -and $manifest.action.default_icon) {
    foreach ($p in $manifest.action.default_icon.PSObject.Properties) { $files.Add($p.Value) }
}
$files = $files | ForEach-Object { $_ -replace '\\', '/' } | Sort-Object -Unique

$allowed = @('.json', '.js', '.png')
foreach ($f in $files) {
    if ($f -match '(^|/)\.\.(/|$)' -or [IO.Path]::IsPathRooted($f)) { Fail "'$f' points outside the repo" }
    if ($allowed -notcontains [IO.Path]::GetExtension($f).ToLower()) { Fail "'$f' isn't a .json, .js or .png" }
    if (-not (Test-Path -LiteralPath (Join-Path $root $f) -PathType Leaf)) { Fail "'$f' is referenced by manifest.json but missing" }
}

# ---- clean tree ----
$dirty = git status --porcelain
if ($LASTEXITCODE -ne 0) { Fail 'git status failed' }
if ($dirty -and -not $AllowDirty) {
    Fail "uncommitted changes; commit first, or pass -AllowDirty for a trial pack`n$($dirty -join "`n")"
}
$commit = (git rev-parse --short HEAD).Trim()

# ---- zip ----
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "try-on-for-steam-profiles-$version.zip"
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

$zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($f in $files) {
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, (Join-Path $root $f), $f, [IO.Compression.CompressionLevel]::Optimal)
    }
} finally {
    $zip.Dispose()
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLower()
$size = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB, 1)

Write-Host "Packed $version from $commit$(if ($dirty) { ' (with uncommitted changes)' })" -ForegroundColor Green
$files | ForEach-Object { Write-Host "  $_" }
Write-Host "$zipPath  ($size KB)"
Write-Host "sha256 $hash"
