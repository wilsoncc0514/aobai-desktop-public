# 鳌拜·桌面宠物

轻量、默认离线、无养成数值的桌面宠物，基于 Tauri 2、Vue 和 TypeScript。

当前快照包含可选 Jev ambient 决策和 Codex 本地任务通知。程序版本元数据仍为 `0.4.1`，不是新的正式版本号。

Windows PowerShell 5.1 打包已在中文且含空格的路径中实机验证，包含原生命令失败注入；当前公开提交仍需在 Windows 重新执行完整构建和桌面 GUI 验收。CI 和打包通过不代表透明窗口、托盘、拖动、缩放等行为已经验收。

## 功能

- 透明无边框的208×272窗口，猫画布仍为208×208，头顶为通知气泡留白，支持置顶、普通和置底层级。
- 常态正面蹲坐，尾巴以左侧为固定支点、右侧整片尾段做更大幅度的抬落；按下翻肚皮撒娇，按住可拖动，松手收势回坐，悬停不触发。
- 内置可变帧动作覆盖静坐、翻肚皮、舔爪、踩奶、猫式伸展，以及入睡、睡眠呼吸与苏醒；伸展与踩奶加入过渡，动作完整收势后回待机。
- 保留连续小盹与自然苏醒；用户交互可取消，任务忙碌时减少新增自主入睡。
- Retina画布及1×/2×图集；标准Codex v2皮肤兼容保留，内置皮肤ID为`AllBuy`。
- 外观、动作、窗口与行为集中在状态栏/托盘；右键只保留任务通知和隐藏。支持位置记忆、默认关闭的可选开机启动。
- 任务完成、待处理和中断使用漫画气泡：显示4秒，再以0.3秒渐隐。自动消失不清除未读；同一提醒不反复弹出，新提醒重新计时。
- 默认关闭的 Codex 本地任务跟随；不显示额度，也不自动查询额度。
- 默认使用本地规则；可在“动作 → Jev”粘贴并验证 API Key，启用 Jev 决策，测试连接或删除凭据。请求失败时回退本地规则。
- 不含养成、联网对话、自动更新或全局键盘监听。

Jev 只选择已有的 ambient 动作，不参与动画帧、拖动或用户点击。API Key 保存在 macOS Keychain 或 Windows Credential Manager；设置文件只记录是否启用，界面状态查询只返回是否配置和是否启用。只有用户主动粘贴密钥时才读取剪贴板。验证、测试连接或启用 Jev 时会向 `https://api.typesafe.ai/v1/systemone` 发送活动模式、小时、最多五条近期动作、两项相对时间和可用动作；不发送图片、文件内容或用户文本。开发测试仍可用临时 `TYPESAFE_API_KEY` 和 `AOBAI_BEHAVIOR_PROVIDER=jev` 环境变量；不要把密钥写入仓库或设置文件。

## 构建和运行

安装 Node.js 22 和 Rust stable，以及对应平台的 Tauri 构建依赖后：

```sh
git clone https://github.com/wilsoncc0514/aobai-desktop-public.git
cd aobai-desktop-public/aobai-desktop
npm ci
npm test
npm run build
npm run tauri dev
```

macOS 生成带双击command的目录：

```sh
npm run bundle:candidate
```

输出在 `aobai-desktop/release/鳌拜·桌面宠物-本地候选/`。完整保留启动器、隐藏的`.runtime`与`skin`目录；不要单独搬走command。退出和重新显示使用顶部菜单栏猫头图标。

Windows构建入口（PowerShell 5.1 打包已实机验收，GUI 仍需复验）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-release-windows.ps1
```

Rust检查：

```sh
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## 外部皮肤

在启动器同级的`skin/<目录>/`放置`pet.json`及图集，使用状态栏/托盘菜单“外观 → 重新扫描 skin”。

```json
{
  "id": "my-pet",
  "displayName": "我的桌宠",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

标准图集为1536×2288、8列×11行，单帧192×208。可选`spritesheet2xPath`指向3072×4576副本。无效高清图回退标准图；无效外部皮肤不能取代内置回退。可变帧motion格式目前仅用于内置鳌拜，不是外部皮肤公开契约。

## 测试范围与限制

- 当前Mac测试包为Apple Silicon arm64，最低目标macOS 12，不适用Intel Mac。
- 用户已在主要Mac上确认按住拖动、动作衔接及最新尾巴方向；其他Mac、混合DPI和Windows桌面GUI仍需测试。
- 并非所有保留旧动作都有新过渡帧；2×图集不代表每帧均具有原生416像素毛发细节。
- 程序未做Apple Developer ID签名或公证，可能被系统安全检查阻止。请勿关闭系统安全功能。

当前通知读取有界的本机 Codex rollout 日志，最多32个近期会话；首次回看每文件最多4 MiB，增量每轮128 KiB。不能覆盖全部审批、归档或跨设备任务，信息不足时显示未知，绝不自动批准或回复。仅保留项目末级目录名、任务/轮次标识和提醒状态，不保存提问/回复正文；未读最长保留24小时。打开会话使用 Codex 桌面深链，目标页面显示仍取决于本机 Codex 版本。

见[测试说明](docs/TESTING.md)、[安全说明](SECURITY.md)和[权利状态](RIGHTS.md)。

## 公开范围

本仓库从经过筛选的快照独立建立，只包含应用源码、锁定依赖、测试、构建脚本和成品皮肤。无原始参考照片、长期记忆、制作过程文件或旧开发历史。公开可见不代表已选择开源许可证。
