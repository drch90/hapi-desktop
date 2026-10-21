# Claude steer 适配

HAPI Desktop 1.0.3 配合远端补丁，支持把补充指令送入正在执行的远端 Claude Code 会话。当前工具会继续执行，引导在工具结束后的下一次模型调用中生效。普通发送仍在当前轮完成后按队列处理。

补丁应用于 HAPI CLI/Hub，使用 Claude Code 现有的 stream-json 接口。

后续的[模型与队列修复](model-queue-fixes.md)补齐了等待回执状态、连续插入与普通队列逐轮发送。已有初版 steer 的环境需要同时应用该增量。

## 使用条件与入口

- 远端 HAPI CLI 和 Hub 均需包含[初版适配](../patches/hapi-claude-steer.patch)和[模型与队列增量](model-queue-fixes.md)，桌面需安装包含这些改动的构建。桌面安装包不包含远端服务更新。
- Claude 必须处于远端活动轮，runner 发布 `steeringActive: true` 后，桌面/Web 才显示入口。旧 runner、本地 TUI 控制及空闲时，桌面/Web 不提供 steer。
- 桌面支持输入框的“优先插入”和排队消息的“优先插入”；Web 的普通发送继续排队，再使用消息上的 Steer。
- 只投递普通引导文本。`/clear`、`/compact`、`/model`、`/plan` 和技能命令保留原有命令路径。引导沿用当前轮的模型与上下文，排队时保存的旧设置不会阻止普通文字插入。

## 各端升级要求

| 组件 | 需要的更新 |
| --- | --- |
| 远端 Hub / HAPI CLI | 应用模型保留、steer 和模型与队列增量，重新构建并按现有流程部署；旧 Claude/Codex 会话进程需重新启动 |
| Desktop | 覆盖安装 1.0.5，包含 Claude 能力判断及模型与队列修复；仅更新 Hub 无法改变旧安装包 |
| Web / 手机浏览器 | 补丁已更新共享能力列表，复用排队消息上的 Steer；需要重新构建并部署 Web 资源 |
| 原生 iOS / Android | 模型与队列增量包含新的等待回执分组恢复逻辑；需重新构建对应客户端，尚未完成原生工具链和实机验证 |

Android 的现有能力判断仅对 Hermes 检查 `steeringActive`，Claude 仍可能在无法接收时显示按钮。若要与桌面/Web 的可用状态一致，需要在 `ChatViewModel.kt` 补齐判断、验证并重新打包。本次增量仅同步原生客户端的队列恢复协议，未调整上述入口，也未生成新的 APK。

桌面升级时，从托盘退出旧程序，再运行 `HAPI-Desktop-1.0.5-win-x64-setup.exe` 并选择原安装目录。应用没有自动更新；已有连接设置、普通标签和草稿按原有用户数据保留。

## 送达与故障处理

适配直接向同一个 Claude Code 进程写入带稳定 UUID 的 `user` 消息，不发送 `interrupt`。Hub 先保存投递状态，收到匹配的原生 `isReplay` 回显后，CLI 才确认消费并从排队区移除该条消息。回显不会再生成一条聊天消息。

长工具可能让回显晚于 RPC 的 30 秒超时，因此 RPC 在写入后返回，接收确认继续等待。等待中的消息仍留在排队区，显示“正在插入，等待助手确认接收…”，并保留禁用的插入、编辑和取消按钮。重载和重连不会自动重发；收到回显后移入聊天记录并显示“↳ 已介入”。

如果投递前活动轮已被替换或结束，消息恢复到普通队列原位置。后续轮次的设置变化不阻止向当前轮插入普通文字。写入后遇到中断或进程故障、心跳过期或 Hub 重启时，未确认消息显示结果未知，不自动放回普通队列。明确重试可能再次执行已经发生的操作，应先检查会话结果。已确认接收不等于任务执行完成。

写入与原生 `result` 同时发生时，引导可能落到紧随其后的原生轮次。适配继续等待该输入的回显及结果，期间保持连续插入入口，不提前宣布空闲、不继续投递普通队列。生效时点不能保证早于已经结束的模型调用。

## 应用补丁

本次 steer 补丁基于 `drch90/hapi` 的 `b99102b4650cc499b56c854498f8c07a30b9791f`，在已应用[模型保留修复](claude-model-persistence.md)的源码上生成。补丁仅包含 steer 的增量，不重复打包模型修复。

本节保留初版 steer 的应用步骤。已叠加后续修复的源码应使用[模型与队列增量的检查命令](model-queue-fixes.md#远端增量补丁)，避免重复应用旧补丁。

远端补丁共 20 个文件：CLI 7 个实现文件及 6 个测试文件、Hub 2 个实现文件及 2 个测试文件、共享能力 1 个实现文件及 1 个测试文件、1 份用户文档。Web 复用现有队列入口。桌面同步 2 个共享文件，补充 2 个测试文件，并更新补丁、来源记录及文档。

以下命令假定 `hapi` 与 `hapi-desktop` 位于同一个父目录，并从 HAPI 源码根目录执行。例如当前目录为 `/root/workspace/hapi` 时，补丁实际位于 `/root/workspace/hapi-desktop/patches`，可直接使用下面的 `../hapi-desktop/patches`。仓库位于其他位置时，先将这个目录改为实际存在的补丁目录。

已使用本次开发源码时，先做只读检查：

```sh
git apply --reverse --check ../hapi-desktop/patches/hapi-claude-steer.patch
```

成功退出且没有报错，表示 steer 改动已存在，跳过下面的补丁应用步骤，继续构建和部署。这里的 `--reverse --check` 只检查，不会撤销修改。

仅对尚未包含适配的目标源码执行以下命令；已应用模型补丁时跳过对应的两条 `git apply`。括号中的任一步失败会停止本组命令：

```sh
(
    set -e
    git apply --check ../hapi-desktop/patches/hapi-claude-model-persistence.patch
    git apply ../hapi-desktop/patches/hapi-claude-model-persistence.patch
    git apply --check ../hapi-desktop/patches/hapi-claude-steer.patch
    git apply ../hapi-desktop/patches/hapi-claude-steer.patch
    node ../hapi-desktop/scripts/limit-cpu.mjs bun typecheck
    node ../hapi-desktop/scripts/limit-cpu.mjs bun run test
)
```

## 构建与启用

`bun typecheck` 和 `bun run test` 只验证源码，不会生成或部署新版 HAPI。验证后按现有安装方式构建。

使用包含 Web 的 HAPI 单文件可执行程序时，在 HAPI 源码根目录执行：

```sh
node ../hapi-desktop/scripts/limit-cpu.mjs bun run build:single-exe
```

使用 `cli/dist-exe` 中对应平台的构建产物更新实际运行的 HAPI 可执行文件。若分别部署 CLI、Hub 和 Web，则执行：

```sh
(
    set -e
    node ../hapi-desktop/scripts/limit-cpu.mjs bun run --cwd cli build:exe
    node ../hapi-desktop/scripts/limit-cpu.mjs bun run build:web
    node ../hapi-desktop/scripts/limit-cpu.mjs bun run build:hub
)
```

分别部署 CLI 可执行文件、`hub/dist/index.js` 和 `web/dist`。根目录的 `bun run build:cli` 只做 CLI 类型检查，不生成可执行文件。

构建与测试均限制为 2 个 CPU 核心，子进程继承限制，具体要求见 [CPU 资源限制](../README.md#cpu-资源限制)。按现有服务管理流程更新并重启 Hub/runner；已运行的旧 Claude/Codex CLI 会话仍使用旧代码，需在合适时机重新启动。只应用源码不会部署服务；本机已完成的更新见[部署记录](model-queue-fixes.md#本机部署与打包记录)。

### PM2 服务更新

PM2 负责启动进程，构建源码后仍需更新它实际调用的程序。以下示例对应已核对的 Linux x64、npm 全局安装布局：

| PM2 服务 | 启动入口 | 参数 |
| --- | --- | --- |
| `hapi-hub` | `/usr/bin/hapi` | `hub --no-relay` |
| `hapi-runner` | `/root/workspace/codex-header-sync/bin/hapi-auto` | `runner start-sync --workspace-root /root` |

两个入口最终都调用 `/usr/lib/node_modules/@twsxtd/hapi/node_modules/@twsxtd/hapi-linux-x64/bin/hapi`。其中 `/usr/bin/hapi` 是 npm 提供的 Node 启动脚本，`hapi-auto` 保留自定义 Codex 启动环境；应将新二进制部署到平台包目录，继续使用现有启动入口和 PM2 配置。

先在 `/root/workspace/hapi` 使用上面的 2 核命令完成单文件构建。以下流程已确认 `hapi-runner` 的 PM2 `autorestart` 为 `true`，使用 runner 正常退出后自动拉起的方式保留现有会话。确认服务名和目录与上表一致后，以能够写入 npm 安装目录的用户执行；其他部署布局需先调整路径和服务名：

```bash
(
    set -e
    hapi_new=/root/workspace/hapi/cli/dist-exe/bun-linux-x64-baseline/hapi
    hapi_live=/usr/lib/node_modules/@twsxtd/hapi/node_modules/@twsxtd/hapi-linux-x64/bin/hapi

    cp -a "$hapi_live" "$hapi_live.bak-$(date +%Y%m%d-%H%M%S)"
    install -m 0755 "$hapi_new" "$hapi_live.new"
    mv -f "$hapi_live.new" "$hapi_live"

    /root/workspace/codex-header-sync/bin/hapi-auto runner stop
    pm2 restart hapi-hub
    pm2 status
)
```

备份保存在原二进制旁，文件名带有时间。新文件先写入 `.new`，再重命名替换，避免直接覆写正在执行的文件；命令组在任一步失败时停止。

当前 PM2 启用了 `treekill`，直接 `pm2 restart hapi-runner` 会终止其子会话；上面的正常退出流程由 PM2 使用原入口重新拉起 runner。等待 `hapi-hub` 和 `hapi-runner` 均为 `online`，并检查 Hub 的 `/health` 返回 `status: ok`。

Hub 重启会短暂断开客户端连接。新建一个 Claude 会话验证“优先插入”。保留下来的旧 HAPI CLI 会话进程不会自动加载新代码，需要重新启动该进程后生效。

## 验证与边界

2026-10-15，独立实验与接入后的隔离实测均使用真实 Claude Code 2.1.300。接入实测运行此次修改后的 HAPI `Query` 和 `ClaudeSteering`，Hub 状态确认使用内存适配器：

| 检查 | 接入实测结果 |
| --- | --- |
| 当前工具运行期间提交相同引导两次 | stdin 只写入 1 次 |
| 12 秒前台工具 | 同一 PID 正常结束，24 次心跳完整，无中断 |
| 改变后续动作 | 新动作执行 1 次，旧动作 0 次 |
| 接收确认 | 匹配 UUID 后确认消费 1 次 |
| 轮次结果 | 1 个成功 `result` |

独立实验还验证了绕过 HAPI 去重、向同一 Claude 进程重复写入相同 UUID 时，原生运行时会跳过重复消息。不能把同进程去重推断为跨进程的恰好一次保证；本适配通过持久化等待状态和禁止自动重发处理不确定结果。

**模型后端限制：** 实测请求 `claude-sonnet-5-5[1m]`，当前中转返回的 assistant 模型标识为 `gemini-3.8-flash`。这些结果验证 Claude Code 客户端运行时和 HAPI 投递逻辑，不是官方 Anthropic Claude 后端实测。文本／思考流中途注入尚无真实后端实测；权限等待、长工具、重连、进程故障及轮次边界由自动回归覆盖。

完整检查记录见 [1.0.3 版本说明](release-notes/v1.0.3.md#验证记录)。
