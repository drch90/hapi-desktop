# HAPI 共享源码与同步规范

继承[根规范](../AGENTS.md)。本文件放在 `vendor/`，避免把仓库维护文档混入 `vendor/hapi/` 的来源清单。

## 先确认要改哪一端

- `vendor/hapi/shared/` 提供协议和共享规则；`vendor/hapi/web/` 提供桌面实际复用的客户端、消息管线、hooks 和展示组件。这里不是一套独立部署的完整 Web 应用。
- 桌面布局/IPC 适配优先放桌面模块；共享协议或确需多端一致的行为改在共享层。不能复制一份共享 reducer、模型目录或请求解析来绕开来源校验。
- 查清所有调用方，包括桌面和已有共享测试。文案或外观不同通常应组合/兼容扩展，不能给共享组件直接引入 Electron、桌面专用存储或硬编码路径。

## 来源与补丁是交付的一部分

修改前阅读 [UPSTREAM.json](../UPSTREAM.json)、[UPSTREAM-FILES.json](../UPSTREAM-FILES.json)、[对齐记录](../docs/upstream-alignment.md) 和相关补丁。版本号、原始基线、后续 backport 来源是不同信息，不能用最新提交覆盖原始来源。

1. 记录实际源提交；来源含未提交修改时同时记录文件摘要，不能把源码工作树等同于提交内容。
2. 对照本地差异说明行为保留、被上游等效替代或需要调整的部分；保留桌面桥接、草稿、送达恢复、原文显示、文章布局、国际化及安全边界。
3. 以完整功能依赖为单位同步：类型、schema、调用方、归一化、状态转换、展示与 fixture 一并核对，不能只复制报错文件。
4. 更新 `UPSTREAM-FILES.json` 的准确来源/当前摘要及 `patches/hapi-desktop.patch`，新增/删除文件同样登记；来源变化同步更新 `UPSTREAM.json` 与对齐说明。
5. 在临时目录验证补丁能还原原始基线，再正向重放得到当前文件；完成受影响行为测试。只让哈希一致或没有合并冲突，不代表功能兼容。

`scripts/verify-upstream.mjs --record` 要求源仓库 HEAD 等于记录的原始基线，不是任意最新 checkout 的通用导入命令。先读脚本与当前来源结构，不能为了通过检查改写基线、伪造摘要或删除差异记录。新的通用同步工具应放入受版本控制的 `scripts/`，不要依赖某次构建目录里的临时脚本。

已审阅并导入新增/修改文件、登记 `UPSTREAM.json` 的 backport 来源后，可执行 `node scripts/limit-cpu.mjs node scripts/refresh-upstream-patch.mjs <HAPI 源仓库路径>`，再运行下方来源校验。刷新脚本始终从原始基线提交读取文件，核对已有来源摘要，并在临时目录反向还原/正向重放后更新清单与补丁；不会把源仓库当前工作树当作原始基线，也不会自动导入文件或代填 backport 来源。删除 vendor 文件需要另行处理来源结构，脚本会拒绝。

## 必查的用户行为

- 消息字段新增/缺省、事件乱序、乐观消息与服务端回执合并、排队/取消/压缩期间的送达状态。
- 首次进入、切回会话、历史补载、窗口裁剪、子代理父调用保留、默认折叠；加载量和显示条数变化应明确记录。
- 模型目录、权限与能力发现的旧 runner 回退；不能把“未提供能力”当作允许执行，也不能无依据把协议 ID 当可读路径解析。
- 桌面、Hub、runner/CLI 的升级范围分别说明；需要远端配套时，桌面构建成功不代表远端已支持或已部署。

## 验证

```sh
node scripts/limit-cpu.mjs node scripts/verify-upstream.mjs
bun run test --project hapi-contract
node scripts/limit-cpu.mjs bun run --cwd vendor/hapi/shared test
```

按影响范围运行相应用例及桌面集成验证；项目配置没有包含的共享测试要显式选入，不能声称已覆盖。补丁文件的上下文空白可能触发普通 diff 检查，补丁正确性以还原/重放为准；普通文件仍做 `git diff --check`，不要忽略真实错误。

`vendor/hapi/` 中不要写 `AGENTS.md`、临时日志、依赖或生成文件来满足本地流程。保留原有版权、许可证和来源声明；不要为了目录整齐格式化全部上游文件。
