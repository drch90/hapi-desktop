# Claude steer 适配

HAPI Desktop 1.0.3 配合远端补丁，支持把补充指令送入正在执行的远端 Claude Code 会话。当前工具会继续执行，引导在工具结束后的下一次模型调用中生效。普通发送仍在当前轮完成后按队列处理。

补丁应用于 HAPI CLI/Hub，使用 Claude Code 现有的 stream-json 接口。

## 使用条件与入口

- 远端 HAPI CLI 和 Hub 均需应用[配套补丁](../patches/hapi-claude-steer.patch)，桌面需安装 1.0.3 或之后包含该适配的版本。桌面安装包不包含远端服务更新。
- Claude 必须处于远端活动轮，runner 发布 `steeringActive: true` 后，桌面/Web 才显示入口。旧 runner、本地 TUI 控制及空闲时，桌面/Web 不提供 steer。
- 桌面支持输入框的“优先插入”和排队消息的“优先插入”；Web 的普通发送继续排队，再使用消息上的 Steer。
- 只投递普通引导文本。`/clear`、`/compact`、`/model`、`/plan` 和技能命令保留原有命令路径；配置不匹配的消息等待后续轮次。

## 各端升级要求

| 组件 | 需要的更新 |
| --- | --- |
| 远端 Hub / HAPI CLI | 应用模型保留补丁和 steer 增量，重新构建并按现有流程部署；旧 Claude 会话进程需重新启动 |
| Desktop | 重新编译、打包并覆盖安装 1.0.3；Claude 支持名单随桌面资源打包，仅更新 Hub 无法改变旧安装包 |
| Web / 手机浏览器 | 补丁已更新共享能力列表，复用排队消息上的 Steer；需要重新构建并部署 Web 资源 |
| 原生 Android APK | 当前源码已有长按发送的 Send & steer、队列 Steer 和对应接口；包含这些功能的 APK 预计可复用更新后的 Hub/CLI，尚未做 APK 实机验证 |

Android 的现有能力判断仅对 Hermes 检查 `steeringActive`，Claude 仍可能在无法接收时显示按钮。若要与桌面/Web 的可用状态一致，需要在 `ChatViewModel.kt` 补齐判断、验证并重新打包。本次桌面更新未修改 Android，也未生成新的 APK。

桌面升级时，从托盘退出旧程序，再运行 `HAPI-Desktop-1.0.3-win-x64-setup.exe` 并选择原安装目录。应用没有自动更新；已有连接设置、普通标签和草稿按原有用户数据保留。

## 送达与故障处理

适配直接向同一个 Claude Code 进程写入带稳定 UUID 的 `user` 消息，不发送 `interrupt`。Hub 先保存投递状态，收到匹配的原生 `isReplay` 回显后，CLI 才确认消费并从排队区移除该条消息。回显不会再生成一条聊天消息。

长工具可能让回显晚于 RPC 的 30 秒超时，因此 RPC 在写入后返回，接收确认继续等待。等待中的消息仍留在排队区；重载或核对状态时可能显示“尚未确认消息是否送达”。重复点击、重载和重连不会自动重发。仍在投递的消息由 runner 拒绝取消或重试，直到投递状态明确或进程退出。

如果投递前活动轮或设置已变化，消息恢复到普通队列原位置；写入后遇到中断或进程故障，未确认消息保持待核对状态，不自动放回普通队列。明确重试可能再次执行已经发生的操作，应先检查会话结果。已确认接收不等于任务执行完成。

写入与原生 `result` 同时发生时，引导可能落到紧随其后的原生轮次。适配继续等待该输入的回显及结果，期间不提前宣布空闲、不继续投递普通队列。生效时点不能保证早于已经结束的模型调用。

## 应用补丁

本次 steer 补丁基于 `drch90/hapi` 的 `b99102b4650cc499b56c854498f8c07a30b9791f`，在已应用[模型保留修复](claude-model-persistence.md)的源码上生成。补丁仅包含 steer 的增量，不重复打包模型修复。

远端补丁共 20 个文件：CLI 7 个实现文件及 6 个测试文件、Hub 2 个实现文件及 2 个测试文件、共享能力 1 个实现文件及 1 个测试文件、1 份用户文档。Web 复用现有队列入口。桌面同步 2 个共享文件，补充 2 个测试文件，并更新补丁、来源记录及文档。

在目标 HAPI 源码根目录执行；已应用模型补丁时跳过前两行：

```sh
git apply --check /path/to/hapi-desktop/patches/hapi-claude-model-persistence.patch
git apply /path/to/hapi-desktop/patches/hapi-claude-model-persistence.patch
git apply --check /path/to/hapi-desktop/patches/hapi-claude-steer.patch
git apply /path/to/hapi-desktop/patches/hapi-claude-steer.patch
bun typecheck
bun run test
```

验证后按现有流程构建、更新远端 Hub/runner。已运行的旧 Claude CLI 会话仍使用旧代码，需在合适时机重新启动。此源码变更未自动重启、部署或发布任何运行中的服务。

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
