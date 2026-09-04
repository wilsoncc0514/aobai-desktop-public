@echo off
setlocal
set "AOBAI_LAUNCHER_DIR=%~dp0"
set "AOBAI_BINARY=%AOBAI_LAUNCHER_DIR%.runtime\aobai-desktop.exe"
set "AOBAI_SKIN_DIR=%AOBAI_LAUNCHER_DIR%skin"

if not exist "%AOBAI_BINARY%" (
  echo 启动失败：运行文件缺失。
  echo 请保留“双击启动鳌拜.bat”与隐藏的 .runtime 目录在同一个文件夹。
  pause
  exit /b 1
)

start "" /b "%AOBAI_BINARY%"
exit /b 0
