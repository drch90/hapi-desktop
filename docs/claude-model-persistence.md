# Claude 模型补丁与 steer 支持说明

模型保留补丁修复 `/model` 选择在停止或切换权限后丢失的问题。当前这版 HAPI 的 Web 与桌面端均不支持 Claude steer，该补丁不增加中途引导能力。

Claude 的 `/model <模型 ID>` 原先由当前 Claude 子进程处理，HAPI 没有同步保存这次选择。点击停止会结束该子进程，计划模式等权限变化也可能重新启动进程；下一次启动采用 HAPI 保存的旧模型，因此会恢复默认值。

[配套补丁](../patches/hapi-claude-model-persistence.patch) 修复 HAPI CLI 的 Claude runner，基于 `drch90/hapi` 提交 `33cc30947350d414ae50b4fa5b84452e41a52dd0`。补丁包含两个实现文件和三个回归测试文件，不属于桌面安装包内的 runner。

## 修复后的行为

- 单独发送 `/model provider/custom-model` 时，runner 保存完整模型 ID、同步会话配置并确认命令已处理。任意自定义 ID 沿用 HAPI 模型设置接口的语义，实际模型可用性仍由 Claude 和供应商决定。
- 停止后开始下一轮、切换权限或设置思考强度时，继续使用已选模型。
- `/model default` 和 `/model auto` 明确恢复默认模型。
- 无参数的 `/model`、包含其他正文或附件的输入沿用原生命令处理，不会丢弃正文或附件。

## 应用与验证

在 HAPI 源码根目录执行（将补丁路径替换为本机实际位置）：

```sh
git apply --check /path/to/hapi-desktop/patches/hapi-claude-model-persistence.patch
git apply /path/to/hapi-desktop/patches/hapi-claude-model-persistence.patch
bun run typecheck:cli
bun run --cwd cli test src/claude/model.test.ts src/claude/runClaude.model.test.ts src/claude/claudeRemoteLauncher.modeGate.test.ts
```

已在隔离源码副本上通过 CLI 类型检查和 22 项回归，覆盖自定义模型、显式恢复默认、权限变化、思考强度保留和中断后的重新启动。测试使用模拟 Claude 进程，不会连接模型服务。

修复需随远端 HAPI CLI 更新后生效；已运行的旧 CLI 会话进程需在合适时机重新启动。仅更新桌面客户端无法改变旧 runner 的进程状态。

## steer 支持情况

steer 指在当前轮仍在执行时投递补充指令，无需停止当前轮或等待整轮结束。当前 HAPI 的 [`isSteeringSupportedForSession`](../vendor/hapi/shared/src/modes.ts) 不将 Claude 列为支持中途引导的会话，Hub 也按该能力拒绝相应操作。Web 和桌面端沿用同一判断，因此都不提供 Claude steer。

Claude 运行中普通发送的消息会排队，等当前轮结束后处理。需要立即改变方向时，可以先点击停止，再发送新指令；这一操作会中断当前执行。

新增 Claude steer 需要先在远端 HAPI CLI 的 Claude 适配中实现中途消息投递，再同步共享能力判断、Hub 与客户端入口，并验证消息确实在当前轮被接收。只放开前端按钮、应用本页的模型保留补丁或重新打包桌面端，都不能启用 steer。这是当前 HAPI 接入方式的支持范围，不代表 Claude Code 本身永久无法支持类似能力。
