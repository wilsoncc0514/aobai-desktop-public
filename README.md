# 鳌拜·桌面宠物

轻量、离线、无养成数值的桌面宠物，基于 Tauri 2、Vue 和 TypeScript。

当前快照：`tested-tail-20260920`。程序版本元数据仍为 `0.4.1`，不是新的正式版本号。

Windows PowerShell 5.1 打包已在中文且含空格的路径中实机验证，包含原生命令失败注入；当前公开提交仍需在 Windows 重新执行完整构建和桌面 GUI 验收。CI 和打包通过不代表透明窗口、托盘、拖动、缩放等行为已经验收。

## 功能

- 透明无边框的208×208窗口，支持置顶、普通和置底层级。
- 常态正面蹲坐，尾巴以左侧为固定支点、右侧整片尾段做更大幅度的抬落；按下翻肚皮撒娇，按住可拖动，松手收势回坐，悬停不触发。
- 内置可变帧动作：静坐12帧、翻肚皮20帧、舔爪16帧、踩奶19帧、猫式伸展16帧。
- Retina画布及1×/2×图集；标准Codex v2皮肤兼容保留，内置皮肤ID为`AllBuy`。
- 原生菜单栏/托盘菜单、活动模式、位置记忆、默认关闭的可选开机启动。
- 不含养成、联网对话、自动更新或全局键盘监听。

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

在启动器同级的`skin/<目录>/`放置`pet.json`及图集，使用右键菜单“外观 → 重新扫描 skin”。

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

见[测试说明](docs/TESTING.md)、[安全说明](SECURITY.md)和[权利状态](RIGHTS.md)。

## 公开范围

本仓库从经过筛选的快照独立建立，只包含应用源码、锁定依赖、测试、构建脚本和成品皮肤。无原始参考照片、长期记忆、制作过程文件或旧开发历史。公开可见不代表已选择开源许可证。
