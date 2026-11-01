# 项目维护导航

这份导航帮助维护者和 AI 找到修改位置、控制改动范围并检查交付。执行规范从[根 AGENTS.md](../AGENTS.md)开始，按需要读取目录细则；下面列的是现有入口，不表示所有文件都已经完成模块化。

## 项目如何连接

桌面由三个部分协作：React 界面描述用户意图，preload 提供有限的方法桥接，Electron 主进程负责认证、网络和系统操作。Hub 与 runner/CLI 独立部署，桌面更新不会自动升级它们。

```text
界面组件 / 桌面状态
    ↓ renderer/lib/api.ts 或 window.desktop
preload 的明确 IPC 方法
    ↓ shared/bridge.ts 的类型 + shared/policy.ts 的校验
main 的 Hub 连接、存储与系统能力
    ↓
Hub → runner / CLI
```

`vendor/hapi/` 是有来源记录的共享代码，参与桌面构建；`@/` 多数指向这里。遇到同名组件，先核对别名和调用链，再确定修改的是桌面覆盖还是共享实现。

## 按问题找入口

| 需求或现象 | 首先阅读 | 相关验证 |
| --- | --- | --- |
| 连接、认证、重连、事件重复 | [hub.ts](../src/main/hub.ts)、[sse.ts](../src/main/sse.ts)、[sync.ts](../src/renderer/lib/sync.ts) | `hub.test.ts`、`state.test.ts` |
| 设置、登录信息、旧设置丢失 | [storage.ts](../src/main/storage.ts)、[policy.ts](../src/shared/policy.ts) | `storage.test.ts`、`state.test.ts` |
| 标签、分栏、草稿归属 | [Tabs.tsx](../src/renderer/components/Tabs.tsx)、[workspace.ts](../src/renderer/lib/workspace.ts) | `state.test.ts`、标签 Electron 用例 |
| 会话列表、搜索、目录分组 | [sessionList.ts](../src/renderer/lib/sessionList.ts)、[SessionSearch.tsx](../src/renderer/components/SessionSearch.tsx)、[SessionWorkspaceGroup.tsx](../src/renderer/components/SessionWorkspaceGroup.tsx) | `session-search.test.tsx`、列表 Electron 用例 |
| 发送、重复发送、送达不明 | [outbox.ts](../src/renderer/lib/outbox.ts)、[recovery.ts](../src/renderer/lib/recovery.ts)、[Chat.tsx](../src/renderer/components/Chat.tsx) | `state.test.ts`、发送/重连 Electron 用例 |
| 排队、编辑、暂存与附件 | [queueEdit.ts](../src/renderer/lib/queueEdit.ts)、[composerPark.ts](../src/renderer/lib/composerPark.ts)、[useAttachments.ts](../src/renderer/lib/useAttachments.ts)、对应具名组件 | `composer-park.test.ts`、`alignment.e2e.ts`、队列/附件 Electron 用例 |
| 历史短、滚动跳动、执行记录折叠 | [useTranscriptNavigation.ts](../src/renderer/lib/useTranscriptNavigation.ts)、[article-transcript.ts](../src/renderer/lib/article-transcript.ts)、[message-window-store.ts](../vendor/hapi/web/src/lib/message-window-store.ts) | `navigation.test.ts`、`article-transcript.test.ts`、共享历史测试 |
| 原文、Markdown、代码、长文 | [Markdown.tsx](../src/renderer/components/Markdown.tsx)、[remark-user-text.ts](../src/renderer/lib/remark-user-text.ts)、[LongMarkdown.tsx](../src/renderer/components/LongMarkdown.tsx)、[VirtualTextContent.tsx](../src/renderer/components/VirtualTextContent.tsx) | `markdown*.test.tsx`、`large-content.test.tsx`、相关 Electron 用例 |
| 模型、权限、问答 | [SessionConfiguration.tsx](../src/renderer/components/SessionConfiguration.tsx)、[NewSessionDialog.tsx](../src/renderer/components/NewSessionDialog.tsx)、共享协议与问答组件 | `alignment.e2e.ts`、共享模型/权限测试 |
| 文件、图片与导出 | [FilePreview.tsx](../src/renderer/components/FilePreview.tsx)、[SaveFileButton.tsx](../src/renderer/components/SaveFileButton.tsx)、[image-export.ts](../src/main/image-export.ts) | `file-preview.test.tsx`、`media.test.tsx`、`markdown-share.test.tsx` |
| 上游升级、接口不兼容 | [vendor 规范](../vendor/AGENTS.md)、[对齐记录](upstream-alignment.md) | 来源重放、共享契约、受影响 Electron 用例 |
| 打包或 CI 失败 | [package.json](../package.json)、[package-win.mjs](../scripts/package-win.mjs)、[CI 排查](ci-troubleshooting.md) | 构建、版本与包校验；系统行为另做 Windows 验证 |

测试文件名在 `tests/` 下查找，共享测试另按配置定位。表中是起点，不能据此跳过实际调用方和适用目录规范。

## 怎样逐步模块化

现有 `App.tsx`、`Chat.tsx`、`styles.css` 和 `desktop.e2e.ts` 包含较多历史功能。维护时采用小步拆分，不同时重写所有入口：

1. 先用可复现的行为和测试确定旧模块的输入、输出、副作用与数据归属。
2. 选择一个独立职责，例如标签列表菜单、暂存编辑或送达检查；先分离纯规则，再分离 hook/展示，按实际需要拆，不为了层数而拆。
3. 原入口继续组合新模块，避免修改无关调用方式、状态范围和持久化 key。
4. 拆分前后行为保持一致，验证后再单独实现新行为；在同一任务内也应让这两步的差异可审阅。
5. 删除已替代的重复实现与无用导出，更新本导航受影响的入口。

一个新功能只有少量代码时，放一个具名文件即可；文件增多后再建功能目录。抽象的理由应是共同业务规则或清楚的边界，而不是“以后也许会用”。

## 非全栈维护者如何验收

提出需求时，给出“在什么情况下发生、现在怎样、希望怎样”即可。模型应自己查技术入口，并在交付时给出能判断的结果：

- **行为**：实际改变了什么，原有数据、偏好与失败恢复是否仍可用。
- **位置**：主要修改属于哪个模块，新模块承担什么职责。
- **证据**：执行了哪些适用检查、结果如何；界面问题提供实际布局和交互验证。
- **交付状态**：源码、安装包、部署分别到了哪一步，有什么尚未验证或需要配套升级。

“能编译”“已经加了测试”和“截图看起来正常”各自只证明一部分。规范约束修改过程，可靠性仍要靠与改动匹配的验证；不要接受隐瞒失败、清空数据、放宽权限或关闭检查来换取表面成功。

## 规范如何保持有效

- 根文件保留共同约束，目录文件只记录该模块的特有规则，避免复制出互相矛盾的版本。
- 调整目录、公共 API、构建或验证方式时，同一次交付同步维护文档；命令以受版本控制的配置为准。
- 不同模型都按同样的模块边界、数据契约和验证要求执行。能力或环境不足时明确具体缺口，不能通过扩大改动范围或降低检查要求补偿。
- 本仓库已有 [CI 验证流程](../.github/workflows/desktop.yml)，会检查类型、来源、本地化、单元/协议、构建和 Electron。`AGENTS.md` 是工作规范，不会自行开启分支保护或替代 CI、人工审阅与目标平台验证。
