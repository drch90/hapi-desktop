# GitHub Actions 排错记录

## 2026-10-16：连续推送失败

修复前的五次 main 推送均在 `Run Electron interface tests` 失败。发布信息检查、依赖安装、类型检查、上游来源校验、本地化检查、单元测试和生产构建都通过；Windows 打包依赖验证任务，因此被跳过。

| 推送提交                                   | 失败用例                                                                                            | 原因及处理                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `83722dd`、`d054360`、`118f4c2`、`c48731b` | `HAPI interactive questions preserve each provider answer contract`                                 | 对“文件预览”选项外框要求 100% 可见，实际比例为 `0.9981916546821594`；改为检查完整内容，并实际点击、核对提交答案。 |
| `098cbe6`                                  | `composer status and queue icons fit narrow panes and reflect disconnection instead of cached work` | 窄双栏下会话头部横向溢出；`c48731b` 已按聊天栏宽度调整头部布局，后续四次 CI 中此用例通过。                        |

最新一次旧失败见 [运行 38737586413](https://github.com/drch90/hapi-desktop/actions/runs/38737586413/job/116430720765)，最早的窄栏失败见 [运行 38502751321](https://github.com/drch90/hapi-desktop/actions/runs/38502751321)。

### 问答测试为何只在部分环境失败

测试使用 920×640 窗口、双栏和特大字号，滚动到 Claude 多选题的最后一个普通选项。中文字体回退会改变题目布局；Chromium 滚动到选项后，滚动位置的像素取整可能让透明外框略微越过滚动区边界。

在只提供 DejaVu 和 Liberation 字体的本地环境中，复现了与 CI 完全相同的比例：选项高度为 `86.40625px`，可见高度为 `86.25px`，底部相差 `0.15625px`。原断言把透明边框的这点差异判为失败，即使选项正文完整可见。

修复后仍要求选项实际内容 100% 可见，再点击“文件预览”，检查选中状态，并核对提交给 Hub 的多选答案包含该项。其他卡片和底部按钮的完整可见性断言保持有效。

### 本地复现与验证

先安装锁定依赖并构建，界面测试运行的是 `out/` 中的应用：

```sh
bun install --frozen-lockfile
bun run build
xvfb-run -a bun run test:e2e --grep 'HAPI interactive questions|composer status and queue icons' --repeat-each=3
```

复现字体差异时，可在 Linux 临时创建 Fontconfig 配置，仅影响带有该环境变量的测试进程，无需修改系统字体：

```sh
cat > /tmp/hapi-ci-fonts.conf <<'EOF'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <dir>/usr/share/fonts/truetype/dejavu</dir>
  <dir>/usr/share/fonts/truetype/liberation</dir>
  <cachedir>/tmp/hapi-ci-font-cache</cachedir>
</fontconfig>
EOF
FONTCONFIG_FILE=/tmp/hapi-ci-fonts.conf xvfb-run -a bun run test:e2e --grep 'HAPI interactive questions' --repeat-each=3
```

字体目录需在本机存在。旧断言在此环境中失败；修复后的测试仍检查实际内容与答案契约。完整检查命令见 [README](../README.md#开发验证与打包)，最终结果以对应提交的 Actions 为准。

### 同次本地回归发现的目录查询竞态

`Hermes creation uses provider model IDs and native permissions, with manual/default fallback` 还暴露了一个独立问题：清空目录后立即切换 Agent，模型发现有时仍请求旧目录 `/home/dev`。输入已经清空，但 `useDeferredValue` 保留的查询目录尚未更新。

Hermes 和 OpenCode 现在只在查询目录与当前输入一致、非空且已通过路径检查时发起模型发现。测试继续检查空目录不发起请求，并验证后续的供应商模型选择、手动模型和默认配置。

### 本地回归发现的消息回执顺序问题

快速发送并对排队消息执行“优先插入”时，较早收到的 SSE 用户消息可能还在等待批量刷新。REST 已确认消息进入“送达未确认”状态后，旧快照才被写入，覆盖了新状态，使 Claude 引导回归测试失败。

批量刷新现在只延迟 Agent 输出，用户消息回执立即写入。单元测试固定复现“未确认、重新排队、取消”三种 REST 结果随后遇到旧快照的情况，保证这些结果不会被回滚；Agent 连续输出仍合并更新。

### 本次本地验证结果

Node.js 24.15.0、Bun 1.4.2 环境下，542 项单元/协议测试和 112 项 Electron 界面测试全部通过；完整界面回归使用上述 Fontconfig 配置。发布准备测试、锁定依赖安装、类型检查、本地化检查、生产构建和上游来源校验也通过。

## 查阅后续失败

先检查第一个失败步骤及其断言。日志中的 Node.js 20 弃用提示只是 action 运行时警告，未导致本次失败；项目检查使用 Node.js 24。

Electron 测试失败后，在该次 Actions 运行的 Artifacts 下载 `electron-test-failure`，保留期为 7 天。解压后查看 `error-context.md`，或在已安装依赖的仓库中打开对应的 trace：

```sh
bun x playwright show-trace /path/to/failed-test/trace.zip
```

测试只使用临时模拟 Hub。诊断产物用于检查当时的 DOM、操作和断言，不包含生产 Hub 的会话。
