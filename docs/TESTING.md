# 测试方法与已验证范围

更新日期：2026-10-28。测试结果必须绑定仓库、完整提交SHA、平台和执行日期；本文件提供入口，不替代新机器实测。

## 既有证据

| 范围 | 最近记录 | 不能据此声明 |
| --- | --- | --- |
| 本地Apple Silicon自动检查 | 177项前端、38项Rust；TypeScript/Vite、fmt/clippy通过 | Windows、Intel Mac或全动作原生通过 |
| 独立公开导出检查 | 同样177/38，另19项图片/打包Python检查通过 | 全套私有制作过程检查已公开或所有图片均自然 |
| macOS原生 | 任务元数据、真实气泡、精简右键、一次完整伸展回idle | 每一帧爪支撑/尾巴相位、混合DPI及所有动作均通过 |
| 四秒渐隐 | 生产组件假时钟覆盖4秒停留、300ms渐隐、新提醒重置、去重及卸载清理 | 已原生录到渐隐全过程 |
| 公开基线CI | [87a99ac 的 macos-14 / windows-latest 检查已成功](https://github.com/wilsoncc0514/aobai-desktop-public/actions/runs/40647666599)，2026-10-28核对 | Windows11真实桌面、其他提交或未来运行均已通过 |
| Windows | 旧PowerShell 5.1打包与历史GUI结果存在 | 本轮Windows桌面验收完成 |

远端CI状态以对应提交的Checks/Actions为准，不能把运行中或旧提交的绿灯写为当前通过。Unix专用测试在Windows会跳过，测试数不要求跨平台相同。

## 自动检查入口

从应用目录执行 `npm ci`、`npm test`、`npm run build`，再执行 `cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。命令失败即停止依赖步骤。

macOS可用 `npm run check:rust`；Windows用Windows指南中的直接Cargo命令，不依赖POSIX sh。`publicAssets.test.mjs` 属于Vitest套件，用 `npm test` 或Vitest执行，不用 `node --test`。Python检查是可选补充，需要与脚本匹配的Pillow/NumPy等既有环境，不在本轮自动安装新依赖。

## 原生与报告

Windows必须使用[当前交接](WINDOWS_TESTING.md)和[结果模板](WINDOWS_TEST_RESULT_TEMPLATE.md)。macOS同样分别记录状态栏、隐藏后显示、拖动、皮肤、任务深链、Jev凭据授权与退出重开；浏览器、Vue host renderer和CI都不能替代这些检查。

动画检查同时观察起势、保持、收势、动作间休息、猫的重心、爪部支撑、尾部延迟、毛缘与尺度；自动像素指标不是自然动作的最终证明。录屏/截图只留必要裁剪，公开前去除个人信息，不提交原始桌面、日志或认证文件。

本轮说明规范化只验证文档链接、工作目录、命令/输出与源码的一致性，不修改运行代码、不重新宣称上述软件或原生检查已执行。当前Mac无Windows/PowerShell环境，Windows命令仍需按交接在目标机器执行。
