# 鳌拜·桌面宠物

更新日期：2026-10-28。轻量Tauri 2 + Vue/TypeScript桌宠，程序元数据 **0.4.1**。本仓为独立历史的公开源码快照，不含原始参考照片、制作过程、记忆或私有交接。

- 猫画布为 208×208；透明窗口为 208×272，头顶 64px 留给通知，不缩小猫。
- 正面蹲坐、尾段拍地、翻肚皮、舔爪、踩奶、伸展与小盹；保留起势和收势，悬停不触发跑动，不自动巡航。
- 按下互动、按住拖动，松手自然回坐；任务通知不强切身体动作。
- 外观、动作（含 Jev）、窗口和行为集中在状态栏/系统托盘；右键鳌拜仅有 Codex 任务通知与暂时隐藏。
- 通知气泡完整显示 4 秒，再以 0.3 秒渐隐；不自动标已读。新提醒重新计时，同一提醒不会因状态刷新反复弹出。
- 可选 Codex 本地任务跟随默认关闭，区分主任务与子任务、进行中/待处理/完成/中断/未知；不显示或自动查询额度。
- 默认本地规则；Jev 仅在用户明确启用后联网，选择已有行为，不生成动画帧。
- 可选开机启动默认关闭；保留位置、活动模式、窗口层级及外部 v2 皮肤选择。

## 使用与构建入口

| 目标 | 说明 |
| --- | --- |
| 用户操作与启动 | [使用指南](docs/USAGE.md) |
| Windows环境、打包与真机检查 | [Windows测试](docs/WINDOWS_TESTING.md) / [结果模板](docs/WINDOWS_TEST_RESULT_TEMPLATE.md) |
| 源码开发与检查 | [构建指南](docs/BUILDING.md) |
| 设置、凭据、任务通知与隐私 | [配置说明](docs/CONFIGURATION.md) / [安全说明](SECURITY.md) |
| 输出目录、同步、Release与回退 | [交付说明](docs/RELEASE.md) |
| 当前证据与平台限制 | [测试说明](docs/TESTING.md) |
| 排错与全部文档 | [故障排查](docs/TROUBLESHOOTING.md) / [文档索引](docs/README.md) |

```sh
git clone https://github.com/wilsoncc0514/aobai-desktop-public.git
cd aobai-desktop-public/aobai-desktop
npm ci
npm test
npm run build
npm run tauri dev
```

开发需要Node.js 22、Rust stable与平台Tauri依赖；Windows用上方专用步骤，不将POSIX脚本当作通用命令。源码克隆不自带可执行程序，不能拿旧ZIP代替新提交构建。

当前公开实现基线为 `87a99acf1d4e22762f365a813afcb20355e40d51`，文档提交在其后继续。Mac自动检查和局部原生结果不代表本轮Windows/Intel Mac/跨DPI或全部动画自然性通过；实时CI从对应提交的Checks查看。

本仓没有选定开源许可证。公开可查看不等于授予原始代码或美术宽泛再使用许可，见[权利状态](RIGHTS.md)。第三方组件仍受各自许可证约束。
