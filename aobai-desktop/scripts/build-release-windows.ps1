$ErrorActionPreference = "Stop"

# Keep this file ASCII-only. Windows PowerShell 5.1 treats UTF-8 files without
# a BOM as the active ANSI code page, corrupting non-ASCII path literals.
function ConvertFrom-UnicodeJson([string] $value) {
    return ConvertFrom-Json ('"' + $value + '"')
}

function Invoke-Checked([scriptblock] $command, [string] $description) {
    & $command
    if ($LASTEXITCODE -ne 0) {
        throw "$description failed with exit code $LASTEXITCODE"
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseName = ConvertFrom-UnicodeJson '\u9ccc\u62dc\u00b7\u684c\u9762\u5ba0\u7269-windows'
$sourceLauncherName = ConvertFrom-UnicodeJson '\u542f\u52a8\u9ccc\u62dc.bat'
$releaseLauncherName = ConvertFrom-UnicodeJson '\u53cc\u51fb\u542f\u52a8\u9ccc\u62dc.bat'
$releaseRoot = Join-Path (Join-Path $projectRoot "release") $releaseName
$stagingRoot = Join-Path (Join-Path $projectRoot "release") ".windows-package-staging"
$runtimeRoot = Join-Path $stagingRoot ".runtime"
$skinRoot = Join-Path $stagingRoot "skin"
$sourceExe = Join-Path $projectRoot "src-tauri\target\release\aobai-desktop.exe"
$sourceLauncher = Join-Path $PSScriptRoot $sourceLauncherName
$sourceSkin = Join-Path $projectRoot "skin\aobai"

Set-Location $projectRoot
Invoke-Checked { npm run build } "npm run build"
Invoke-Checked { cargo build --manifest-path src-tauri/Cargo.toml --release } "cargo build"

foreach ($required in @($sourceExe, $sourceLauncher, $sourceSkin)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Required packaging input is missing: $required"
    }
}

if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
}

try {
    New-Item -ItemType Directory -Force $runtimeRoot | Out-Null
    New-Item -ItemType Directory -Force $skinRoot | Out-Null
    Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $runtimeRoot "aobai-desktop.exe") -Force
    Copy-Item -LiteralPath $sourceLauncher -Destination (Join-Path $stagingRoot $releaseLauncherName) -Force
    Copy-Item -LiteralPath $sourceSkin -Destination $skinRoot -Recurse -Force

    New-Item -ItemType Directory -Force $releaseRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $stagingRoot ".runtime") -Destination $releaseRoot -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $stagingRoot "skin") -Destination $releaseRoot -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $stagingRoot $releaseLauncherName) -Destination $releaseRoot -Force
}
finally {
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
}

$releaseLauncher = Join-Path $releaseRoot $releaseLauncherName
if (-not (Test-Path -LiteralPath $releaseLauncher)) {
    throw "Release launcher was not created: $releaseLauncher"
}

Write-Host "Windows launcher created: $releaseLauncher"
