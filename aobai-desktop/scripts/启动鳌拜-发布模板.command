#!/bin/zsh
set -u
unsetopt BG_NICE

aobai_launcher_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
aobai_binary="$aobai_launcher_dir/.runtime/aobai-desktop"
aobai_log_path="${TMPDIR:-/tmp}/aobai-desktop.log"
export AOBAI_SKIN_DIR="$aobai_launcher_dir/skin"

if [[ ! -x "$aobai_binary" ]]; then
  print -u2 "启动失败：运行文件缺失或不可执行。"
  print -u2 "请保留‘双击启动鳌拜.command’与隐藏的 .runtime 目录在同一文件夹。"
  read -r "?按回车键关闭…"
  exit 1
fi

if pgrep -f -- "$aobai_binary" >/dev/null 2>&1; then
  exit 0
fi

nohup "$aobai_binary" >"$aobai_log_path" 2>&1 </dev/null &
disown
exit 0
