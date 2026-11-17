# 开发、验证与打包

所有命令均在仓库根目录执行。安装与日常操作见[使用指南](usage.md)。

维护项目或交给 AI 修改前，先读 [AGENTS.md](../AGENTS.md)；功能入口、模块拆分方法和交付验收见 [维护导航](maintenance.md)。前端、主进程、测试和上游共享代码分别有目录规范。

需要 Node.js 22.12+、Bun 和 Git，构建与验证脚本支持 Linux、Windows。首次安装依赖会下载 Electron。

```sh
bun install --frozen-lockfile
bun run dev
```

类型检查、单元/协议测试、生产构建和来源校验：

```sh
bun run typecheck
bun run test
bun run build
node scripts/limit-cpu.mjs node scripts/verify-upstream.mjs
bun run i18n:sync
```

Electron 界面测试使用构建后的应用和临时模拟 Hub。在 Linux 安装 Xvfb 后运行；Windows 可直接运行 `bun run test:e2e`。

```sh
xvfb-run -a bun run test:e2e
```

界面测试不会连接实际部署的 Hub；测试中的 `--no-sandbox` 仅用于 root 运行的 Linux 测试环境，生产窗口启用 Chromium sandbox。Windows 系统通知、系统凭据存储、托盘和开机启动仍需在目标系统验证。

## CPU 资源限制

**所有测试及其子进程最多使用 2 个可用逻辑 CPU**，包括单元、协议、集成、Electron 和真实 CLI 验证。构建、打包、类型检查也遵守相同上限，重型任务按组串行执行。

上面的 `typecheck`、`test`、`build`、`test:e2e` 和 `package:win` 已调用 [CPU 限制脚本](../scripts/limit-cpu.mjs)。Linux 使用 `taskset`，Windows 使用进程 affinity，将整个进程树限制在允许使用的前两个 CPU；不足两个时使用已有核心，并设置 `GOMAXPROCS=2`。Vitest 最多两个 worker，Playwright 一个 worker；worker 数不能替代进程 CPU 限制。

单独执行工具或验证同级 HAPI 源码时也需经过限制脚本，例如在桌面仓库根目录执行：

```sh
node scripts/limit-cpu.mjs node --test scripts/release.test.mjs
node scripts/limit-cpu.mjs bun run --cwd ../hapi test:cli
node scripts/limit-cpu.mjs bun run --cwd ../hapi build:single-exe
```

## 本地安装包

生成 Windows x64 NSIS 安装包：

```sh
bun run package:win
```

打包后的暂存路径为 `build/HAPI-Desktop-1.0.24-win-x64-setup.exe`，完成下方校验后保留归档路径 `build/v1.0.24/HAPI-Desktop-1.0.24-win-x64-setup.exe` 并自动清理暂存副本。版本取自 `package.json`。Linux 打包使用 electron-builder 26.15.3 的跨平台 NSIS uninstaller reader；升级 builder 时需重新验证该适配。可用 `HAPI_ELECTRON_DIST` 指向经过校验的 Electron Windows zip。当前未配置代码签名或自动更新。

需要归档并验证安装包时，安装 7-Zip 并保证 `7z` 在 PATH 中；使用 [安装包校验脚本](../scripts/verify-package.mjs) 按以下顺序执行。版本取自 `package.json`，记录摘要时若文件已存在会停止，避免覆盖旧证据。

```sh
node scripts/limit-cpu.mjs node scripts/verify-package.mjs record-inputs
bun run package:win
node scripts/limit-cpu.mjs node scripts/verify-package.mjs record-output
# 运行本次改动所需的 Electron 验证；下方命令核对安装包并在成功后自动清理。
node scripts/limit-cpu.mjs node scripts/verify-package.mjs verify
```

校验会检查 NSIS 与内层压缩包、包内版本和每个构建文件，并将安装包及 SHA-256 归档到 `build/v<版本>/`。界面验证使用的 `out/` 必须与记录时一致；归档校验不等于 Windows 实机安装测试。每次本机版本交付都以此校验命令结束，成功后自动执行下方清理规则；普通构建或打包失败不会触发清理。

## 轻量覆盖升级

能兼容已有安装的新版本默认同时交付轻量 ZIP，包含应用资源、版本与摘要、升级／恢复脚本和说明。完整安装包验证通过后生成，例如本次从 1.0.23 升至 1.0.24：

```sh
bun run package:overlay --from 1.0.23
```

[生成脚本](../scripts/overlay/package.mjs) 从两份已验证安装包提取文件，要求 Electron 版本、可执行代码与 `app.asar` 之外的文件完全兼容，并检查 ASAR 校验策略。仅 PE 版本和 ASAR 摘要等资源可不同；脚本不会关闭校验。条件不满足时使用完整安装包。新资源逐项与已测试的 `out/` 核对；连续使用轻量包时，保留并验证原始可执行程序的兼容身份。

产物归档到 `build/v<目标版本>/HAPI-Desktop-<基础版本>-to-<目标版本>-win-x64-overlay.zip`，校验文件为同目录的 `OVERLAY-SHA256SUMS.txt`，证据为 `overlay-manifest.json`、`overlay-verification.json` 与日志。安装包和覆盖包均不进入 Git。

升级与回退操作见[使用指南](usage.md#轻量覆盖升级)。

覆盖脚本回归使用真实 PowerShell 引擎（Windows 自带 Windows PowerShell；Linux 需 PowerShell 7，可通过 `HAPI_TEST_PWSH` 指定路径）：

```sh
node scripts/limit-cpu.mjs node --test scripts/overlay/*.test.mjs scripts/cleanup-builds.test.mjs
```

## 本地产物保留与清理

安装包只保存在被 Git 忽略的 `build/` 下。[清理脚本](../scripts/cleanup-builds.mjs) 在安装包校验、归档成功后自动执行：保留本次与上一份已验证安装包，删除更早版本的安装包及对应 blockmap、已归档的暂存副本、与校验记录一致的历史 `verification/` 解包目录和本次 `win-unpacked/`。清理前重新核对保留安装包的 SHA-256；本次归档不完整或存在更新的已归档版本时停止清理。

轻量包验证成功后也自动运行同一清理流程，独立保留最新两份已验证轻量 ZIP，清理更早的轻量 ZIP。即使相应完整安装包已被清理，轻量包仍按自身校验记录识别；当前轻量包损坏时停止清理，未知或损坏的历史轻量包保留并报告原因。

所有版本的说明、SHA-256、源码摘要、补丁、日志、覆盖基础关系和验证记录继续保留；删除清单与执行结果写入 `build/cleanup-reports/`。更早版本说明中的本机产物路径属于历史记录，其二进制可能已按保留规则清理。本次产物位置与摘要见 [1.0.24 安装包记录](release-notes/v1.0.24.md#本机安装包)。

补做清理可以先预览，再执行：

```sh
bun run cleanup:build
bun run cleanup:build --apply
```

脚本仅清理能确认来源的 `build/` 产物，不跟随目录或文件链接。校验失败或未知的构建、失败诊断目录、`out/`、`node_modules/`、`build/tool-cache/`、`release/` 发布准备文件、源码及 Agent 工作树均保留。已有安装包的输入摘要不随工程脚本修改而重写；补做清理按归档自身的校验记录核对，不要求重新打包。

## 自动构建与公开发布

[Desktop Build and Release](https://github.com/drch90/hapi-desktop/actions/workflows/desktop.yml) 仅在手动运行或推送 `v*` 标签时执行版本信息检查与 Windows x64 打包。普通分支推送和 PR 不触发 Actions；工作流已移除自动测试步骤，本地仍须按改动范围完成类型、单元和 Electron 验证。Actions 构建产物保留 14 天，下载需要 GitHub 登录；正式发布文件在 Releases 公开下载。

当前源码使用 1.0.24 版本号，对齐 HAPI v0.36.4 的必要兼容行为，沿用可验证、可回退的轻量覆盖交付与历史包清理流程。本次本机安装包与覆盖包的位置、校验及 SHA-256 见版本说明。获取 Actions 构建时仍需核对对应提交；公开发布状态以 Releases 为准。更新客户端后生效。

本地 Electron 界面测试失败时，`test-results/` 保留 Playwright trace 和失败页面上下文。旧自动测试工作流的失败原因、复现方法及修复说明见 [CI 排错记录](ci-troubleshooting.md)。

维护者发布新版本的步骤：

1. 更新 `package.json` 的版本、相关文档中的版本示例，并添加 `docs/release-notes/v<版本>.md` 更新说明。
2. 完成适用的本地验证，提交并推送到 `main`；需要先检查 Windows 构建时，手动运行上述工作流。
3. 创建与 `package.json` 一致的标签并推送，例如当前版本：

```sh
git tag -a v1.0.24 -m "HAPI Desktop 1.0.24"
git push origin v1.0.24
```

推送 `v*` 标签会检查版本信息并构建，校验标签、版本及更新说明后，将安装包和 SHA-256 文件上传到 Release 草稿；文件上传成功才公开发布。`v1.0.24-rc.1` 这样的版本自动标为预发布。工作流使用 GitHub 提供的 `GITHUB_TOKEN`，只有发布任务拥有仓库写权限，无需添加个人访问令牌。

标签与版本不一致、缺少更新说明或打包失败时不会公开发布；测试需在发布前本地完成。上传失败时可重跑工作流完成草稿；已公开 Release 的文件不会被重跑覆盖，修改发布内容应使用新版本号和新标签。安装包对应的源码由 GitHub 按标签提供。

可在本地检查发布信息和准备文件：

```sh
node scripts/limit-cpu.mjs node --test scripts/release.test.mjs scripts/cleanup-builds.test.mjs
node scripts/release.mjs check
bun run package:win
node scripts/release.mjs prepare
```

准备后的安装包、校验文件和更新说明位于被 Git 忽略的 `release/` 目录。若暂存安装包已自动清理，`release.mjs prepare` 会从当前版本归档读取并核对 SHA-256，继续生成发布文件。

## 仓库内容与敏感信息

版本控制保留源码、自动测试、协议 fixtures、必要的图标资源、构建配置、依赖锁文件和许可证文档。fixtures 是用于回归验证的协议输入与预期输出。依赖目录、编译产物、安装包、截图、测试报告、日志、审计报告和本地运行数据均由 `.gitignore` 排除；本地生成文件不应强制加入 Git。

文档中的连接示例使用保留示例域名或回环地址。测试中的令牌占位值、用户名、主机名、路径和私网地址用于模拟数据及边界验证；上游许可证中的署名和联系方式保留原文。真实访问令牌、私钥、账户配置、会话导出和包含个人数据的诊断文件不应写入仓库。

可使用 [Gitleaks](https://github.com/gitleaks/gitleaks) 8.25+ 检查所有可达分支和标签的提交历史：

```sh
gitleaks git --log-opts="--all --full-history" --redact
```

`.gitleaks.toml` 启用默认规则，仅对 `UPSTREAM.json` 中特定源码文件的 SHA-256 字段设置误报例外。扫描报告应保持脱敏并保存到仓库外。Git 忽略规则不影响已提交的历史，因此公开前应同时检查当前文件和历史记录。

## 源码结构与上游

| 路径            | 内容                                             |
| --------------- | ------------------------------------------------ |
| `src/main/`     | 凭据、HTTP、SSE、重连、通知、托盘与 IPC 校验     |
| `src/preload/`  | 受限的 contextBridge 接口                        |
| `src/renderer/` | 桌面工作区、会话、草稿、文件预览和本地化         |
| `src/shared/`   | 主进程与 renderer 的接口和校验规则               |
| `tests/`        | 模拟 Hub、单元测试及 Electron 界面测试           |
| `vendor/hapi/`  | 固定来源的 HAPI 协议、fixtures、hooks 和展示组件 |
| `patches/`      | 对共享源码的可重放适配补丁                       |
| `scripts/`      | 构建、测试资源限制、本地化和来源校验脚本         |
| `resources/`    | 应用所需的图标资源                               |

桌面端组合 Web 的独立组件和协议行为，使用自己的双栏、草稿与 IPC 适配。聊天归一化、工具分组、问答、模型发现、队列操作、暂存抽屉、上下文统计和用量页面尽量复用共享实现。

上游基线、Hermes 与 Claude steer 来源快照及文件校验值记录在 [UPSTREAM.json](../UPSTREAM.json)；逐文件来源记录在 [UPSTREAM-FILES.json](../UPSTREAM-FILES.json)，修改记录在 [patches/hapi-desktop.patch](../patches/hapi-desktop.patch)。来源快照包含当时尚未提交的实现，记录的基线提交不代表已包含这些更改。`node scripts/limit-cpu.mjs node scripts/verify-upstream.mjs` 校验文件哈希，并反向/正向应用补丁，确保可恢复基线和桌面适配结果。更新共享源码时需同步来源记录和补丁，再运行相关测试。

修改桌面文案时，通过 `scripts/add-missing-keys.mjs` 更新全部七种语言，并运行 `bun run i18n:sync` 检查缺失键。
