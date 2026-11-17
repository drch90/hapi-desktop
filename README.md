# HAPI Desktop

[HAPI](https://github.com/tiann/hapi) 的 Windows 桌面客户端，在一个工作区中管理远端 Agent 会话。

[下载](https://github.com/drch90/hapi-desktop/releases) · [使用指南](docs/usage.md) · [更新记录](docs/release-notes/unreleased.md) · [反馈问题](https://github.com/drch90/hapi-desktop/issues)

## 功能

- **多会话工作台**：标签页、双栏分屏、会话搜索、状态与未读提醒。
- **多种 Agent**：支持 Claude、Codex、OpenCode、Antigravity、Cursor 等 CLI，按远端能力选择模型和权限。
- **消息管理**：草稿、排队与定时发送、暂存消息、审批和交互问答。
- **内容阅读**：用户原文、Markdown、代码高亮、数学公式、Mermaid 图表，以及复制和图片分享。
- **项目文件**：远端目录树、Git 差异、文件预览和附件上传下载。
- **桌面体验**：系统托盘、桌面通知、深浅主题和七种界面语言。

各 CLI 的可用性取决于远端机器的安装情况及 Hub/runner 版本，详见[会话设置与能力](docs/usage.md#通知上下文与会话设置)。

## 安装与使用

支持 **Windows 10/11 x64**。使用前需部署可访问的 HAPI Hub，以及远端 runner 和 CLI。

1. 从 [Releases](https://github.com/drch90/hapi-desktop/releases) 下载并安装 `HAPI-Desktop-<版本>-win-x64-setup.exe`，使用随包的 `SHA256SUMS.txt` 核对摘要。
2. 打开客户端，输入 Hub 地址和访问令牌，例如 `https://hapi.example.com`。地址不包含 `/api`、子路径或查询参数。
3. 打开已有会话，或选择在线机器、工作目录和 CLI 创建会话。

关闭窗口后应用驻留托盘，远端任务继续运行。详细操作、快捷键和升级方式见[使用指南](docs/usage.md)。

当前安装包未配置代码签名或自动更新。已有兼容版本可使用[轻量覆盖包](docs/usage.md#轻量覆盖升级)，其他情况使用完整安装包。开发版本可从成功的 [Actions 构建](https://github.com/drch90/hapi-desktop/actions/workflows/desktop.yml) 获取，或从源码构建。

## 开发

技术栈为 Electron、React、TypeScript 和 electron-vite。需要 **Node.js 22.12+、Bun 和 Git**。

```sh
git clone https://github.com/drch90/hapi-desktop.git
cd hapi-desktop
bun install --frozen-lockfile
bun run dev
```

| 命令                  | 用途                |
| --------------------- | ------------------- |
| `bun run typecheck`   | TypeScript 类型检查 |
| `bun run test`        | 单元与协议测试      |
| `bun run build`       | 生产构建            |
| `bun run package:win` | Windows x64 安装包  |

构建、测试和打包统一限制为 **2 个逻辑 CPU**，重型任务串行执行。Electron 验证、安装包校验与发布流程见[开发指南](docs/development.md)。

## 文档

| 文档                                         | 内容                                   |
| -------------------------------------------- | -------------------------------------- |
| [使用指南](docs/usage.md)                    | 会话、消息、文件、设置、升级及功能限制 |
| [Markdown 说明](docs/markdown.md)            | 代码、公式、图表和长内容阅读           |
| [开发指南](docs/development.md)              | 环境、验证、打包、发布及产物清理       |
| [维护导航](docs/maintenance.md)              | 模块入口与维护方式                     |
| [上游对齐记录](docs/upstream-alignment.md)   | 同步来源、兼容范围和桌面差异           |
| [更新记录](docs/release-notes/unreleased.md) | 版本变化与本机交付记录                 |

## 贡献

欢迎通过 [Issues](https://github.com/drch90/hapi-desktop/issues) 反馈问题或提交 Pull Request。修改前请阅读 [AGENTS.md](AGENTS.md)，并按改动范围完成验证。

## 许可证

本项目使用 **AGPL-3.0-only**，保留 HAPI 与 Happy 的来源和版权信息，详见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。分发修改版本时须提供对应源码。本项目不是官方 HAPI 发行版。
