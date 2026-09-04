#!/bin/sh
set -eu

aobai_cargo_root=${CARGO_HOME:-"${HOME}/.cargo"}
if command -v cargo >/dev/null 2>&1; then
  aobai_cargo_command=$(command -v cargo)
elif [ -x "$aobai_cargo_root/bin/cargo" ]; then
  aobai_cargo_command="$aobai_cargo_root/bin/cargo"
else
  printf '检查失败：未找到 Rust cargo。\n' >&2
  exit 1
fi

"$aobai_cargo_command" fmt --manifest-path src-tauri/Cargo.toml --check
"$aobai_cargo_command" clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
