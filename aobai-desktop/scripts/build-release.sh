#!/bin/sh
set -eu

aobai_project_root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
case "${1:-}" in
  "") aobai_release_root="$aobai_project_root/release/鳌拜·桌面宠物" ;;
  --candidate) aobai_release_root="$aobai_project_root/release/鳌拜·桌面宠物-本地候选" ;;
  *) printf '用法：build-release.sh [--candidate]\n' >&2; exit 2 ;;
esac
aobai_cargo_root=${CARGO_HOME:-"${HOME}/.cargo"}
aobai_rustup_root=${RUSTUP_HOME:-"${HOME}/.rustup"}
aobai_flag_separator=$(printf '\037')

if command -v cargo >/dev/null 2>&1; then
  aobai_cargo_command=$(command -v cargo)
elif [ -x "$aobai_cargo_root/bin/cargo" ]; then
  aobai_cargo_command="$aobai_cargo_root/bin/cargo"
else
  printf '构建失败：未找到 Rust cargo。\n' >&2
  exit 1
fi

# Release binaries otherwise retain local dependency source paths in panic metadata.
export CARGO_ENCODED_RUSTFLAGS="--remap-path-prefix=${aobai_project_root}=workspace${aobai_flag_separator}--remap-path-prefix=${aobai_cargo_root}=cargo-home${aobai_flag_separator}--remap-path-prefix=${aobai_rustup_root}=rustup-home"

cd "$aobai_project_root"
npm run build
"$aobai_cargo_command" build --manifest-path src-tauri/Cargo.toml --release

mkdir -p "$aobai_release_root/.runtime" "$aobai_release_root/skin"
rsync -a "$aobai_project_root/src-tauri/target/release/aobai-desktop" "$aobai_release_root/.runtime/aobai-desktop"
if [ -f "$aobai_release_root/启动鳌拜.command" ] && [ ! -e "$aobai_release_root/双击启动鳌拜.command" ]; then
  mv "$aobai_release_root/启动鳌拜.command" "$aobai_release_root/双击启动鳌拜.command"
fi
rsync -a "$aobai_project_root/scripts/启动鳌拜-发布模板.command" "$aobai_release_root/双击启动鳌拜.command"
rsync -a "$aobai_project_root/skin/aobai" "$aobai_release_root/skin/"
chmod +x "$aobai_release_root/.runtime/aobai-desktop" "$aobai_release_root/双击启动鳌拜.command"

printf '启动器已生成：%s\n' "$aobai_release_root/双击启动鳌拜.command"
