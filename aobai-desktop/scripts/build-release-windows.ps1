$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot "release\鳌拜·桌面宠物-windows"

Set-Location $projectRoot
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --release

New-Item -ItemType Directory -Force (Join-Path $releaseRoot ".runtime") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $releaseRoot "skin") | Out-Null
Copy-Item "src-tauri\target\release\aobai-desktop.exe" (Join-Path $releaseRoot ".runtime\aobai-desktop.exe") -Force
Copy-Item "scripts\启动鳌拜.bat" (Join-Path $releaseRoot "双击启动鳌拜.bat") -Force
Copy-Item "skin\aobai" (Join-Path $releaseRoot "skin") -Recurse -Force

Write-Host "Windows 启动器已生成：$(Join-Path $releaseRoot '双击启动鳌拜.bat')"
