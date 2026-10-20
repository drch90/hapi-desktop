# 模型切换、插入回执与逐轮队列修复

本次增量修复 Claude 普通文字插入被旧设置拦截、插入状态不明确及连续插入入口消失的问题，并让 Claude 和旧 Codex 执行路径每轮只处理一条普通排队消息。

## 修复行为

- **模型与轮次**：旧 Codex 执行路径现在等待活动轮结束后才取下一条普通消息，按下一轮的已选模型启动请求。此前可能在上一轮仍执行时取走后续消息，或将同设置的多条消息合成一个请求。`/clear`、`/compact` 和目标命令仍能唤醒处理循环。
- **Claude 插入**：普通文字以当前活动轮的上下文投递；排队时保存的模型、权限等设置与当前选择不同，也可以插入。空文本、原生命令和隔离命令仍走原来的队列路径。
- **回执**：投递后显示“正在插入，等待助手确认接收…”，保留禁用的插入按钮，并禁用该条消息的编辑和取消。收到原生 UUID 回显后，消息离开排队区，桌面聊天中显示“↳ 已介入”。确认接收与任务执行完成是两个不同阶段。
- **连续插入**：第一条引导跨过原生 `result` 边界、尚待回显时，继续保留有效的插入目标。普通队列等待这些引导处理完成后再继续。
- **故障恢复**：重载、重连不会重复发送等待回执的消息。会话结束、心跳过期或 Hub 重启后，未确认的投递转为结果未知；迟到的接收回执仍可确认送达。
- **普通排队**：Claude 和旧 Codex runner 每轮消费一条，分别确认；当前 Codex 共享运行时继续使用原生队列，已验证两条后续消息产生两次独立请求。

界面和 `/status` 显示会话所选模型。已经开始的轮次保持该轮启动时的模型；切换影响下一条普通消息。“优先插入”补充当前轮，也沿用当前轮的模型。

## 远端增量补丁

[hapi-model-queue-fixes.patch](../patches/hapi-model-queue-fixes.patch) 基于 `drch90/hapi` 的 `eb010ee51251c51e50c5a6182e615b3b0031bbe5`，叠加在已有的[模型保留](claude-model-persistence.md)和 [Claude steer](claude-steer.md)修改之上。补丁只记录本次增量，保留此前已有的源码修改。

从 HAPI 源码根目录执行，假定两个仓库位于同一个父目录。已有本次改动时，用以下只读检查确认并跳过重复应用：

```sh
git apply --reverse --check ../hapi-desktop/patches/hapi-model-queue-fixes.patch
```

对满足前置条件、尚未包含本次增量的源码执行：

```sh
(
    set -e
    git apply --check ../hapi-desktop/patches/hapi-model-queue-fixes.patch
    git apply ../hapi-desktop/patches/hapi-model-queue-fixes.patch
    node ../hapi-desktop/scripts/limit-cpu.mjs bun typecheck
    node ../hapi-desktop/scripts/limit-cpu.mjs bun run test
)
```

其他源码版本先核对补丁上下文；检查失败时按实际差异移植。验证命令将进程及子进程限制为 2 个 CPU 核心。

## 升级范围

Desktop 包含界面与共享 Web 源码，远端 CLI/Hub 的修复需要单独构建和部署。更新 Hub、runner 及 Web 资源后，旧的 Claude/Codex CLI 会话进程也需重新启动才会加载代码。构建与 PM2 部署步骤见 [Claude steer 说明](claude-steer.md#构建与启用)。本机已按下方记录完成部署。

协议新增 `deliveryState: 'dispatching'`、`messages-dispatching` 事件和 `dispatchingLocalIds` 核对分组。补丁同步了 iOS/Android 对该分组的保留逻辑，避免重连时将等待回执的消息误判为已删除；原生界面的专用等待提示不包含在本次桌面适配中。原生客户端需随源码更新，未生成新的 APK 或 iOS 安装包。

## 本机部署与打包记录

2026-10-19 01:26 UTC，已将含 Web 资源的 HAPI 0.30.7 补丁构建原子替换到 `/usr/lib/node_modules/@twsxtd/hapi/node_modules/@twsxtd/hapi-linux-x64/bin/hapi`。

- Hub 已重启；runner 正常退出后由 PM2 使用原入口自动拉起。两个服务均为 `online`，`/health` 返回正常，线上 Web 文件与本次构建一致。
- 原有两个会话进程保持运行；它们仍加载旧 CLI 代码，需在合适时机重新启动会话后使用新修复。原配置与 `hapi-auto` 包装脚本保持不变。
- 原二进制、SQLite 一致性备份和服务配置保存在 `/root/.hapi/backups/model-queue-20261019T012442Z/`；数据库备份通过 `quick_check`。备份含本机数据，不加入源码仓库。
- 新二进制 SHA-256：`811556a004ab5b7d0b37a5d72f582e2670f2b0babb7b053e0a4524f1925b42c2`。

模型与队列修复曾生成 Windows x64 安装包，版本为 **1.0.3**，大小为 97,535,490 字节。SHA-256：`f2d7d830f58f01eb1a9f2ded516abcaee89a9cfb87cd08dd1ba617060a9f0c5d`。原打包位置为 `build/model-queue-20261019/`；该中间产物已在后续磁盘清理时删除，校验与验证记录保留用于追溯。

后续在此基础上新增了历史目录分组按完整路径字母排序及排序规则设置（`workspaceGroupSort`），更新后的 Windows 安装包保存在 `build/workspace-order-20261019/HAPI-Desktop-1.0.3-win-x64-setup.exe`，大小为 97,535,663 字节，SHA-256：`c1a5ffb4c2ddcc76dd1d0f3eefc4e24372c030f3694e5a7ff6f031523f9751bd`。同目录包含校验文件与验证记录。

上述 1.0.3 构建为历史记录；随后搜索与暂存构建的验证记录已归档到 [1.0.4 版本说明](release-notes/v1.0.4.md#搜索与暂存优化验证)。当前 1.0.4 还包含消息缩进、长文本编辑及连续浏览优化，位置和 SHA-256 见 [最新安装包记录](release-notes/v1.0.4.md#本机安装包)。安装包保留规则见 [本地产物保留与清理](../README.md#本地产物保留与清理)。

已校验安装包中 177 个构建文件与当前输出逐字节一致，NSIS 和内层压缩包完整性通过，内层 `app.asar` 与已验证文件一致。远端程序通过独立临时数据目录的启动、健康检查及嵌入 Web 资源检查。构建、打包及验证全程限制为 2 个 CPU 核心；后续测试须继续遵守 [CPU 资源限制](../README.md#cpu-资源限制)。

## 验证记录

- Desktop：构建、类型检查及全部 546 项测试通过；Electron 回归覆盖模型设置、排队、连续插入、重载、确认回执、编辑恢复以及目录分组排序规则切换与持久化。
- HAPI：CLI、Hub、Web、Relay 类型检查通过；Hub 1342 项、Web 3228 项、共享协议 324 项、Relay 118 项测试通过。fixture 重新生成后无变化。
- 真实 Codex CLI 0.163.0 配合隔离的本地 Responses 模拟服务，验证设置接口、`/model`、计划模式及忙碌时切换后的实际 HTTP 请求模型，并检查两条排队消息分别发起请求。未使用付费模型服务。
- 全量 CLI：2923 项通过，6 项失败。已在修改前的独立源码副本、2 核限制下复现同样失败：1 项受 `HAPI_CODEX_APP_SERVER_BIN` 启动环境影响，4 项因 difftastic 所需 GLIBC 版本高于系统版本，1 项为仓库外技能目录发现测试。相关文件未在本次修改。
- iOS/Android 新增了等待回执条目的重连保留测试；当前环境缺少 Swift 和 JDK，未能执行原生测试。
