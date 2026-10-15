# Claude 模型补丁与 steer 支持说明

模型保留补丁修复 `/model` 选择在停止或切换权限后丢失的问题。Claude steer 已有[单独的适配补丁](claude-steer.md)，本页的模型补丁本身不增加中途引导能力。

Claude 的 `/model <模型 ID>` 原先由当前 Claude 子进程处理，HAPI 没有同步保存这次选择。点击停止会结束该子进程，计划模式等权限变化也可能重新启动进程；下一次启动采用 HAPI 保存的旧模型，因此会恢复默认值。

[配套补丁](../patches/hapi-claude-model-persistence.patch) 修复 HAPI CLI 的 Claude runner，基于 `drch90/hapi` 提交 `33cc30947350d414ae50b4fa5b84452e41a52dd0`。补丁包含两个实现文件和三个回归测试文件，不属于桌面安装包内的 runner。

## 修复后的行为

- 单独发送 `/model provider/custom-model` 时，runner 保存完整模型 ID、同步会话配置并确认命令已处理。任意自定义 ID 沿用 HAPI 模型设置接口的语义，实际模型可用性仍由 Claude 和供应商决定。
- 停止后开始下一轮、切换权限或设置思考强度时，继续使用已选模型。
- `/model default` 和 `/model auto` 明确恢复默认模型。
- 无参数的 `/model`、包含其他正文或附件的输入沿用原生命令处理，不会丢弃正文或附件。

## 应用与验证

以下命令从 HAPI 源码根目录执行，假定 `hapi` 与 `hapi-desktop` 位于同一个父目录。例如当前目录为 `/root/workspace/hapi` 时，补丁实际位于 `/root/workspace/hapi-desktop/patches`，可直接使用 `../hapi-desktop/patches`；其他布局需改成实际存在的目录。

已有模型修复的源码不需重复应用，可用 `git apply --reverse --check ../hapi-desktop/patches/hapi-claude-model-persistence.patch` 做只读检查。若已叠加 steer，因部分文件继续发生修改，应按 [steer 说明](claude-steer.md#应用补丁)检查并跳过重复应用。

仅对尚未包含模型修复的源码运行以下命令；任一步失败会停止本组命令：

```sh
(
    set -e
    git apply --check ../hapi-desktop/patches/hapi-claude-model-persistence.patch
    git apply ../hapi-desktop/patches/hapi-claude-model-persistence.patch
    bun run typecheck:cli
    bun run --cwd cli test src/claude/model.test.ts src/claude/runClaude.model.test.ts src/claude/claudeRemoteLauncher.modeGate.test.ts
)
```

已在隔离源码副本上通过 CLI 类型检查和 22 项回归，覆盖自定义模型、显式恢复默认、权限变化、思考强度保留和中断后的重新启动。测试使用模拟 Claude 进程，不会连接模型服务。

修复需随远端 HAPI CLI 更新后生效；已运行的旧 CLI 会话进程需在合适时机重新启动。仅更新桌面客户端无法改变旧 runner 的进程状态。

## steer 支持情况

steer 指在当前轮仍在执行时投递补充指令，无需停止当前工具或等待整轮结束。1.0.3 配套补丁已接通 Claude Code 的 stream-json 输入通道，并更新共享能力判断；补充指令以 UUID 回显确认接收，普通发送仍排队。

启用需要更新远端 HAPI CLI、Hub，并覆盖安装 1.0.3 桌面版；Web 则需重新构建部署。桌面可从输入框或排队消息点击“优先插入”，Web 可从排队消息点击 Steer。旧 runner 未发布活动轮能力时，桌面/Web 仍隐藏该入口。

详见 [Claude steer 适配说明](claude-steer.md)。只应用本页的模型补丁或重新打包桌面端不能更新远端投递逻辑；源码适配完成也不会自动部署到已运行的 Hub/runner。
