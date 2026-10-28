# 公开快照Windows测试｜2026-10-28

目标：在Windows 11 x64真实桌面上复核本轮代码和成品动作。程序元数据为0.4.1，不按旧v0.4.0/v0.4.1标签取代当前分支。**当前Windows GUI未验收**；Mac结果、CI及旧PowerShell打包实测都不能替代本轮证据。

## 取正确的源码

仓库 `https://github.com/wilsoncc0514/aobai-desktop-public.git`，分支 `main`，最低功能基线 `87a99acf1d4e22762f365a813afcb20355e40d51`。本次文档提交之后仍需记录实际HEAD；两仓SHA不同，不交叉使用。

新目录克隆（仓库根操作）：

```powershell
$ErrorActionPreference = 'Stop'
git clone --branch main --single-branch https://github.com/wilsoncc0514/aobai-desktop-public.git
if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
cd aobai-desktop-public
git status --short
if ($LASTEXITCODE -ne 0) { throw 'git status failed' }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'git rev-parse failed' }
git merge-base --is-ancestor 87a99acf1d4e22762f365a813afcb20355e40d51 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Wrong test baseline' }
cd aobai-desktop
```

上段git命令任何一步失败就停，不执行后续步骤。已有检出先fetch并查看本地改动，只在确认可保留后切分支与 `git pull --ff-only`，不reset/clean/强推。此后所有构建命令都在应用目录执行。

## 环境与构建

准备Node.js 22（CI基线）、npm、Rust stable的MSVC工具链、Visual Studio C++ Build Tools（Desktop development with C++与Windows SDK）和WebView2 Runtime。按[Tauri官方前置依赖](https://v2.tauri.app/start/prerequisites/#windows)与[微软WebView2说明](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)检查；缺少依赖就记录，不把尚未执行写为通过。

先从托盘正常退出鳌拜，避免exe占用和单实例继续显示旧版。保留现有发布目录/自定义skin与配置的备份；不要将重要文件放进脚本预留的 `.windows-package-staging`。下列检查逐步失败即停：

```powershell
$ErrorActionPreference = 'Stop'
function Invoke-AobaiCheck([scriptblock] $Command, [string] $Name) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Name failed: $LASTEXITCODE" }
}

Invoke-AobaiCheck { node --version } 'node'
Invoke-AobaiCheck { npm --version } 'npm'
Invoke-AobaiCheck { rustc --version } 'rustc'
Invoke-AobaiCheck { rustc -vV } 'rustc host'
Invoke-AobaiCheck { cargo --version } 'cargo'
Invoke-AobaiCheck { npm ci } 'npm ci'
Invoke-AobaiCheck { npm test } 'frontend tests'
Invoke-AobaiCheck { npm run build } 'frontend build'
Invoke-AobaiCheck { cargo fmt --manifest-path src-tauri/Cargo.toml --check } 'rustfmt'
Invoke-AobaiCheck { cargo test --manifest-path src-tauri/Cargo.toml } 'rust tests'
Invoke-AobaiCheck { cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings } 'clippy'
Invoke-AobaiCheck { powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release-windows.ps1 } 'Windows package'
Get-FileHash -LiteralPath '.\release\鳌拜·桌面宠物-windows\.runtime\aobai-desktop.exe' -Algorithm SHA256
```

核对 `rustc -vV` 的 host 为 `x86_64-pc-windows-msvc`；本交接目标是x64，其他架构另行记录，不冒充本轮通过。

Windows不把 `npm run check` / `npm run check:rust` 当作必通用命令，因为它们调用POSIX `sh`；以上直接Cargo命令才是本交接基准。PowerShell的 `$ErrorActionPreference` 本身不能保证所有原生命令失败即停，所以包装退出码检查。`-ExecutionPolicy Bypass` 只用于这次脚本进程，不修改系统全局策略；组织策略拦截时按组织流程处理。

如果把本文片段保存为PowerShell 5.1的.ps1文件，使用UTF-8 BOM编码，避免中文路径被ANSI误解；项目现有打包脚本已用ASCII/Unicode转义处理路径。

输出必须包含：

```text
release/鳌拜·桌面宠物-windows/
  双击启动鳌拜.bat
  .runtime/aobai-desktop.exe
  skin/aobai/pet.json
  skin/aobai/spritesheet.webp
  skin/aobai/spritesheet@2x.webp
```

完整保留目录并双击bat。裸exe不能绕过缺失WebView2、签名或SmartScreen；不关闭系统安全保护。打包脚本成功不等于已经验证以下桌面交互。

## 真机验收清单

所有项目分别填写 Pass / Fail / 未验证；跳过须写原因，不用总的“通过”代替逐项证据。

| ID | 操作 | 预期 |
| --- | --- | --- |
| W01 | 完整解压/打包后双击bat；再启动一次 | 新版可见，无常驻黑色控制台；不出现重复猫/托盘，记录实际进程路径 |
| W02 | 看窗口与点击头顶留白 | 透明、无边框、无任务栏入口；208×272逻辑窗口，猫仍208×208；留白的矩形点击占用作为已知限制记录 |
| W03 | 点托盘、隐藏、显示、切层级 | 外观/动作/窗口/行为完整可达；右键猫没有四组设置，仅任务和隐藏；置顶/普通/置底分别核验 |
| W04 | 悬停、按下、长按拖动、松手 | 悬停不触发跑动；互动与拖动不冲突；松手收势，不突然换体型 |
| W05 | 播放伸展、舔爪、踩奶、翻肚皮、小盹 | 起势/主体/收势完整；重点重心、爪支撑、尾根及尾巴延迟、边缘，动作排队不被120ms强制加速 |
| W06 | 改模式、睡眠中交互、隐藏或换肤 | 休息间隔合理；已有身体动作有序收势；睡眠能取消/苏醒，无旧定时器突然触发 |
| W07 | 100%/150%等两档DPI、外接屏间拖动和重开 | 尺寸清晰、拖动不漂移；能找回窗口，记录各屏缩放与边界情况 |
| W08 | 更换合法外部v2皮肤，缺失/损坏2x图，损坏清单 | 合法可切换，2x无效退标准；加载失败保留当前画面，内置AllBuy始终可用 |
| W09 | 修改模式/层级/位置后退出重开；用备份副本测旧/损坏设置 | 配置能保存和恢复；旧版本迁移/无效备份按代码执行，不覆盖用户原件；配置保存失败要记Fail |
| W10 | Codex跟随关闭后查看进程与界面 | 无任务扫描或自动额度辅助进程；菜单、状态栏不显示额度、配速或刷新额度 |
| W11 | 经用户同意，用一条无副作用短任务测试完成/待处理/中断 | 气泡指向猫、脸不被遮；显示4秒后约300ms渐隐，未读仍留菜单；同一快照不反复弹出，新提醒重置计时 |
| W12 | 区分主/子任务，查看列表和未读，点正文/× | 子任务结束不代表主任务完成；正文打开实际对应页，×标已读；实际页面不可见时记未验证，不用opener退出码代替 |
| W13 | 无Codex/缺日志/超长会话、关闭再开启跟随 | 显示缺失/未知而非完成；旧结果不复活开关，不自动回复、审批或创建任务 |
| W14 | 已有用户自己的Jev凭据；启用/关闭、测试、退出重开、断网 | 凭据由系统保管；读取不冻住窗口；失败回本地规则；不输出密钥，不在无人批准时操作真实凭据 |
| W15 | 退出并核对进程；再重开 | 鳌拜与其自行启动的辅助进程清理，未读与开关保留；不要终止用户其他Codex进程 |
| W16 | 比较含中文/空格目录、打包失败路径 | 启动器路径可用；npm/cargo失败即停，不运行陈旧包；本轮未重做失败注入则标未验证 |

没有Codex、测试凭据、外接屏或指定旧设置副本时，只记录相关项未验证，不能后台制造任务、读他人凭据或复制真实认证文件来补覆盖。系统减少动态效果已开启时，气泡可直接隐藏，定时与未读语义应保留。

## 结果与回退

填写结果模板，至少给出源码完整SHA、构建日期、exe SHA-256、Windows版本、CPU/GPU、WebView2版本、Node/Rust版本、屏幕/DPI、每项实际结果和最小复现。截图只保留必要裁剪；公开报告不含个人桌面、路径、密钥、日志正文或认证文件。

失败时先保留证据和用户配置备份。常规可恢复小修按当次授权完成并重跑相关检查；素材/动作问题先记录动作与时刻，不自行裁切、重画或用旧图替换新图。回退要退出新版后运行完整旧包，不混合exe与skin，不改写旧标签。提交、推送、PR或Release按当次明确授权执行。

使用[Windows结果模板](WINDOWS_TEST_RESULT_TEMPLATE.md)填写报告；测试与安全范围见[文档索引](README.md)。
