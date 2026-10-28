# 鳌拜·桌面宠物｜应用说明

更新日期：2026-10-28；程序版本 `0.4.1`，设置版本 `5`。当前运行行为以本文件及 [文档索引](README.md) 的现行指南为准；带日期的旧交接只记录当时状态。

## 功能和交互

- 猫画布为 208×208；透明窗口为 208×272，头顶 64px 留给通知，不缩小猫。
- 正面蹲坐、尾段拍地、翻肚皮、舔爪、踩奶、伸展与小盹；保留起势和收势，悬停不触发跑动，不自动巡航。
- 按下互动、按住拖动，松手自然回坐；任务通知不强切身体动作。
- 外观、动作（含 Jev）、窗口和行为集中在状态栏/系统托盘；右键鳌拜仅有 Codex 任务通知与暂时隐藏。
- 通知气泡完整显示 4 秒，再以 0.3 秒渐隐；不自动标已读。新提醒重新计时，同一提醒不会因状态刷新反复弹出。
- 可选 Codex 本地任务跟随默认关闭，区分主任务与子任务、进行中/待处理/完成/中断/未知；不显示或自动查询额度。
- 默认本地规则；Jev 仅在用户明确启用后联网，选择已有行为，不生成动画帧。
- 可选开机启动默认关闭；保留位置、活动模式、窗口层级及外部 v2 皮肤选择。

| 操作 | 入口与预期 |
| --- | --- |
| 显示、退出、外观、动作、层级、模式 | macOS 状态栏猫图标 / Windows 系统托盘猫图标 |
| 任务跟随 | Codex → 任务通知；默认关闭，已有选择会保留 |
| 右键鳌拜 | 任务通知和暂时隐藏，没有四组完整设置 |
| 气泡正文 | 打开对应会话；× 为标记已读，自动渐隐不清除未读 |
| 外部皮肤 | 托盘 → 外观 → 重新扫描 skin；加载失败保留当前猫 |
| Jev | 托盘 → 动作 → Jev；验证并保存凭据、启用、测试、删除 |

Codex 跟随只读取有上限的本机 rollout 元数据，不保证覆盖全部审批、归档和跨设备状态；信息不足显示未知，不自动批准、回复或发送任务。目标会话深链依赖本机 Codex 版本。详细数据范围见 [配置说明](CONFIGURATION.md)。

## 开发与运行

以下命令均在应用目录 `aobai-desktop/` 执行。使用 Node.js 22（与 CI 一致）、npm、Rust stable，以及平台所需的 [Tauri 前置依赖](https://v2.tauri.app/start/prerequisites/)。Windows 的 MSVC/C++ Build Tools 和 WebView2 步骤见 [Windows 当前交接](WINDOWS_TESTING.md)。

```sh
npm ci
npm test
npm run build
npm run tauri dev
```

开发模式需要本机编译器；只运行已经构建的便携包无需 Node/Rust。浏览器 `npm run dev` 只能预览 Web 界面，不能证明原生托盘、透明窗口、凭据、拖动或深链通过。

### macOS 本地候选

```sh
npm run bundle:candidate
```

本公开仓输出 `release/鳌拜·桌面宠物-本地候选/`。保留 `双击启动鳌拜.command`、隐藏的 `.runtime/` 和 `skin/` 在同一层。源码中的 `scripts/启动鳌拜-发布模板.command` 不是用户入口；`npm run bundle` 会写默认发布目录，不用它覆盖测试候选。

当前包为 Apple Silicon arm64 的本地构建；配置最低目标 macOS 12 不等于所有 macOS 12 机器均已实测。构建脚本默认不生成签名、公证的 `.app/.dmg`，没有自动更新器。

### Windows 当前测试

请直接执行 [Windows 当前交接](WINDOWS_TESTING.md)。输出固定为 `release/鳌拜·桌面宠物-windows/双击启动鳌拜.bat`，不是旧名称的启动器。PowerShell 中用逐条 Cargo 检查代替依赖 `sh` 的 `npm run check:rust`；CI 和打包成功均不替代 Windows 桌面验收。

## 外部皮肤

布局为 `skin/<目录>/pet.json` 与对应图集；启动器设置 `AOBAI_SKIN_DIR` 指向同级 skin。开发模式默认用应用目录 skin；绕过启动器运行裸二进制时搜索根可能不同。

```json
{
  "id": "my-pet",
  "displayName": "我的桌宠",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

标准 v2 图集为 1536×2288、8×11，单帧 192×208；可选 `spritesheet2xPath` 为 3072×4576 副本。ID 是 1–48 位 ASCII 字母、数字或连字符；内置固定 ID 为 `AllBuy`。清单和图集受目录、大小和尺寸校验；可变帧 motion 仅为内置实现，不扩展外部 v2 契约。

## 验证、限制与维护

最近本地实现检查记录为 177 项前端、38 项 macOS Rust 测试通过；测试数受平台 cfg 和后续代码变化影响，以实际结果为准。Windows/Intel Mac/混合 DPI 本轮原生未验；毛色/毛量差异、透明矩形点击区域、深链版本差异等见 [测试说明](TESTING.md) 与 [故障排查](TROUBLESHOOTING.md)。

- [Windows 交接](WINDOWS_TESTING.md) / [结果模板](WINDOWS_TEST_RESULT_TEMPLATE.md)
- [配置与数据](CONFIGURATION.md) / [安全边界](../SECURITY.md)
- [交付与回退](RELEASE.md) / [变更记录](../CHANGELOG.md)
- [文档索引](README.md) / [权利状态](../RIGHTS.md)
