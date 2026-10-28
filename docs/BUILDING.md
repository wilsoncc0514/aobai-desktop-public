# 源码构建与检查

更新日期：2026-10-28。应用目录为aobai-desktop/，版本/依赖以package.json、Cargo.toml及锁文件为准。推荐Node.js22与Rust stable；平台依赖按[Tauri官方说明](https://v2.tauri.app/start/prerequisites/)准备。

```sh
npm ci
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

命令在应用目录逐条执行，失败即停。Windows需要[专用步骤](WINDOWS_TESTING.md)中的退出码检查、MSVC与WebView2；不依赖npm check里的POSIX sh。macOS可额外用npm run check:rust。publicAssets.test.mjs用Vitest执行，不用node --test。

开发桌面运行：npm run tauri dev。npm run dev只提供Web预览，不验证托盘、系统凭据或窗口行为。

macOS候选：npm run bundle:candidate，公开仓输出release/鳌拜·桌面宠物-本地候选/。Windows打包：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release-windows.ps1，输出release/鳌拜·桌面宠物-windows/。完整布局与回退见[交付说明](RELEASE.md)。

Rust编译嵌入dist资源，不能在并行Rust编译时清空/重建同一dist；先完成前端构建再编译Rust。锁文件需要一起提交，不提交node_modules、dist、target或运行包。
