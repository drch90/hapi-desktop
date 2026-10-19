# 仓库工作指引

## 测试资源限制

- 测试进程及其全部子进程最多使用 **2 个可用逻辑 CPU**。单元、协议、集成、Electron 和真实 CLI 验证均遵守此限制；构建、打包及类型检查也使用相同上限。
- 优先使用 `package.json` 中已接入 `scripts/limit-cpu.mjs` 的 `build`、`typecheck`、`test`、`test:e2e` 和 `package:win`。单独调用测试工具或验证同级 HAPI 仓库时，也必须经过该脚本，不能只设置 worker 数。
- 重型构建和测试按组串行执行。Linux 使用 CPU affinity，Windows 使用进程 affinity；子进程继承限制。脚本同时设置 `GOMAXPROCS=2`。
- 具体命令见 [README 的 CPU 资源限制](README.md#cpu-资源限制)。代码未变化时复用已有验证结果；仅修改文档时检查内容、链接和 diff。

## 安装包交付

安装包保存在被 Git 忽略的 `build/` 下，记录路径和校验值。用户未要求发送时，不通过显示或附件工具推送安装包。
