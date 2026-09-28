# HAPI Desktop

通过现有 HAPI Hub API 管理 Linux 服务器上的 Codex、Claude Code 和 OpenCode。独立 Electron 桌面客户端，面向 Windows 10/11 x64。Hermes 留待 HAPI 提供相应协议后接入。

## 使用

运行 `HAPI-Desktop-0.1.5-win-x64-setup.exe`，输入 Hub 地址和访问令牌。地址填写 origin，例如 `https://hapi.example.com` 或 `http://192.168.1.5:3006`；不含 `/api` 或子路径。远端 CLI 与 runner 由已有 HAPI 部署负责。

内网 HTTP 支持 IPv4 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`，共享/VPN 网段 `100.64.0.0/10`，IPv6 ULA `fc00::/7`，以及 localhost、IPv4/IPv6 回环地址。使用内网域名时请填写对应内网 IP，或使用 HTTPS；公网地址仍要求 HTTPS。HTTP 连接不会加密传输的令牌与消息，此选项按内网部署需求提供。

左侧默认分为“进行中”“活跃会话”“历史会话”：只有 active 且 thinking 的会话进入“进行中”，停止思考即移入“活跃会话”；仅有后台任务的会话留在活跃区。归档/离线会话在底部按机器和工作区分组，名称灰显。历史工作区标题仅显示文件夹图标与路径，支持点击或键盘折叠，并显示会话数量；默认折叠，可在设置中关闭。手动展开/折叠的选择优先于默认设置，按 Hub/账户保存；搜索时临时展开匹配结果，清除搜索后恢复。设置中的“按状态分区显示会话”可关闭分区，恢复统一的机器/项目列表。搜索和筛选在各分区一致生效。可打开、创建或恢复会话。顶部切换双栏，在标签栏将会话移到另一栏，中间分隔线可拖动，也支持方向键调整。右侧文件和 Git diff 均为只读。

新建会话组合 HAPI Web 的模型、思考强度、权限、协作模式、快速模式与会话类型组件。Codex 模型与思考档位由远端返回，只有模型支持时显示快速模式；Claude 使用 Web 同源模型与 effort 选项；OpenCode 按机器和目录查询模型与变体，切换目录或模型会清除不适用的旧选择。支持直接使用目录或创建 Git 工作树。远端目录浏览复用 WorkspaceBrowser，支持子目录导航与隐藏文件夹；选择目录后返回表单并保留配置。浏览范围由 runner 的 `--workspace-root` 决定，未配置时显示 Web 同样的设置指引。

设置中可选择“回车换行”或“回车发送”，默认保持回车换行；`Ctrl+Enter` 始终可发送，`Shift+Enter` 换行，输入法选词的回车不会发送。界面字号提供小、标准、大、特大四档，两栏同步生效。设置保存到本机，重启后保持。0.1.3 修正全局字体重置覆盖按钮字号与字重的问题；按钮采用更紧凑的比例，工具与问答文字同步缩小，聊天正文保持原有字号与行距。

排队消息在输入框上方显示内容、时间、数量和附件名称，不重复放入已执行的聊天记录。支持取消、明确重试结果不明的消息，以及把已有队列消息或新输入内容“优先插入”当前轮。插入能力遵循 HAPI：Codex、Cursor ACP、Pi 需有可插入的活动轮且受远程控制；Claude、OpenCode 等未提供此能力的会话仍可正常排队。网络恢复或插入失败不会自动重发。

输入 `/` 或点击“原生命令”打开命令列表，复用 HAPI 内置命令与远端 CLI 返回的项目、自定义命令；方向键选择，Tab/Enter 补全，Escape 关闭菜单。补全只修改草稿，命令和参数按原文提交给 CLI，例如 `/model ...`、`/plan`、`/compact`、`/goal ...`。共享 Codex 的 `/clear` 和 `/new` 走 HAPI 新会话接口，并切换到返回的会话 ID。实际可执行命令以对应 HAPI CLI 的支持范围为准。

配色采用简洁黑白灰；设置里可选浅色、深色或跟随系统。新建会话使用低对比度文字加号入口。消息显示日期和时分秒，悬停可看完整日期；支持复制 Markdown 原文和预览、复制、保存 PNG 分享图片。图片只在本地生成，不会上传。工具卡固定显示开始时间、结束时间和耗时，运行中每秒更新；优先使用 Hub 记录的执行时间，缺失值显示“—”。

会话顶部显示当前模式、权限、思考强度、创建时间与更新时间；时间使用本机时区，悬停可查看包含秒的完整时间，HAPI 推送更新后同步刷新。点击右上角的会话设置图标或顶部设置摘要可修改当前远程会话。Codex 支持独立的默认/计划模式、权限模式、动态模型与思考档位；Claude 支持权限（含计划模式）、Web 同源模型选项与 effort；OpenCode 支持权限（含计划模式）、远端模型和当前模型提供的思考档位。设置通过 HAPI 原生 API 提交，成功后读取服务端状态；失败保留原值并显示错误。归档会话需先恢复，终端独占控制或断线时禁用设置。

会话可重命名、归档、中断，并处理工具审批与交互式问题。归档会话右上角提供删除入口，复用确认对话框展示会话名称和不可撤销的删除范围。仅在用户确认后调用 HAPI 删除接口；失败保留会话和草稿，成功后清理列表、标签页、消息缓存及对应本地草稿/待发送状态，也同步处理其他客户端发来的删除事件。侧栏和设置页统一显示当前应用版本，开发运行也不会误显示 Electron 版本。窗口关闭后驻留托盘；托盘的退出操作关闭客户端，远端任务继续运行。系统通知点击后定位对应会话。开机启动默认关闭。

交互问答直接复用 HAPI 网页组件：Codex `request_user_input` 与 Claude `AskUserQuestion` 支持各自的单选、多选、自由填写和分步提交，答案使用原请求映射 ID 回传。待回答时默认展开问答区，标题和翻页/提交按钮固定，长题目与选项在卡内滚动，修复整张卡片被外层限高裁切的问题。可收起问答继续查看聊天，展开/收起不会丢失已填答案或聊天草稿。会话列表状态文字加深，并与前方圆点同色：活动/思考为绿色，待处理为棕黄色，历史为灰色，浅色和深色主题分别适配。

就绪会话使用绿色勾选标记。未读更新以蓝色底纹、左边线和“新动态”徽标提示；首次连接不会把所有旧会话标成未读，之后的阅读进度按 Hub/账户保存，当前窗口中可见的会话在获得焦点后标记已读。沿用 HAPI 的 updatedAt 水位语义，“新动态”可能包含消息、审批或其他会话更新，“就绪”表示代理当前空闲，不表示整个项目已完成。

如果发送响应丢失，输入内容和 localId 会保留。先使用“检查送达状态”；Hub 确认已接收后清除本地待确认状态。查不到时显示显式重试按钮，沿用原 localId。Hub 报告 indeterminate 的消息需要在排队消息栏显式处理。客户端不会在网络恢复时自动重发。

## 开发与验证

需要 Node.js 22.12+、Bun、Git。首次安装会下载 Electron。

```sh
bun install --frozen-lockfile
bun run dev
bun run typecheck
bun run test
bun run build
# Linux 下运行真实 Electron 界面测试，需要 Xvfb
xvfb-run -a bun run test:e2e
bun run verify:upstream
bun run package:win
```

测试脚本在 Linux 自动使用 `taskset` 将整个进程树限制在允许的前两个逻辑 CPU。Vitest 最多两个 worker，Playwright 一个 worker。各测试使用同一 CPU 集；本次验证为 CPU 0,1。界面测试只连接临时模拟 Hub，不访问已部署服务或操作其会话。测试中的 `--no-sandbox` 仅用于以 root 运行的 Linux 测试环境；生产窗口启用 Chromium sandbox。

Windows 测试脚本通过 `start /affinity` 限制进程树到两个 CPU。Linux 打包使用 electron-builder 26.15.3 内置的跨平台 NSIS uninstaller reader，避免 Wine 与宿主 glibc 版本不匹配；该适配仅处理生成的安装器 stub，升级 builder 时需重新验证。可用 `HAPI_ELECTRON_DIST` 指向经过校验的 Electron Windows zip，减少重复下载。

0.1.5 验证：`bun run typecheck`、`bun run build` 通过；`bun run test` 的 368 项单元与协议测试、`xvfb-run -a bun run test:e2e` 的 16 项 Electron 端到端测试全部通过，均限制为 CPU 0,1。新增测试覆盖旧设置升级、回车与输入法行为、字号与双栏同步、队列恢复/取消/插入/失败处理、Codex/Claude/OpenCode 命令发现与原文参数传递、命令结果显示、共享会话清理后的 ID 切换，以及 920×640 双栏特大字号下的长题目、末尾选项、固定导航、多题答案与草稿保留；另覆盖按钮/问答字号、正文比例、状态三分区、后台任务归属、未读持久化与已读清除、历史灰显及分区设置重启保留。新增覆盖工作区折叠/搜索/键盘展开/重载、旧工作区升级与账户隔离、会话时间和思考强度推送、三类代理设置的原生请求与空值重置、Codex 计划模式、模型目录失败刷新、设置失败保留原值、OpenCode 模型切换后刷新思考档位以及归档/终端控制状态禁用；另验证 920×640、特大字号、深色主题下四项会话设置及关闭按钮完整可见。0.1.5 回归覆盖默认折叠设置重载与手动选择优先、历史标题隐藏主机名、界面版本一致、归档删除的取消/失败/无 SSE 成功/外部删除与草稿清理，以及目录浏览返回、三类代理启动配置、Codex 计划/快速/工作树参数、OpenCode 模型变体切换和小窗口下创建按钮可见。`bun run verify:upstream` 验证 932 个来源文件及 7 个修改文件的补丁逆向恢复与重放。

`build/desktop-preview.png`、`build/desktop-dark-preview.png`、`build/preferences-preview.png`、`build/queue-preview.png`、`build/questions-preview.png`、`build/questions-small-preview.png`、`build/buttons-large-preview.png`、`build/session-status-preview.png`、`build/session-settings-preview.png`、`build/session-metadata-preview.png`、`build/new-session-codex-preview.png`、`build/new-session-claude-preview.png`、`build/new-session-opencode-preview.png` 为模拟 Hub 截图。用户已在 Windows 实机验证 0.1.1 的安装、内网 HTTP 和基本对话。0.1.5 由 Linux 交叉构建，新增功能尚待 Windows 实机验收；DPAPI、托盘气泡、开机启动及 Windows CPU 限制脚本未单独实机验证。安装包未进行代码签名。自动更新不在此版本范围内。

## 结构与边界

- `src/main/`：凭据、HTTP、唯一全局 SSE、重连、通知、托盘和 IPC 校验。
- `src/preload/`：窄接口 contextBridge。JWT 不进入 renderer。
- `src/renderer/`：React 工作区、双栏状态、会话视图、只读文件预览。
- `vendor/hapi/`：固定版本的 HAPI 协议、聊天归一化、分页、审批和展示组件。来源和修改详见 `UPSTREAM.json` 与 `patches/hapi-desktop.patch`。

历史工作区复用 Button 组合可访问的折叠标题；上游 SessionList 的分组折叠依赖 Web 路由和列表状态，桌面工作区独立持久化。会话设置组合共享 Dialog、SelectControl、模型发现 hooks、模式/模型/思考档位 helpers 和 API 客户端；PermissionField 是新建会话的启动权限表单，不适合运行时设置，SessionChat/HappyComposer 则绑定 Web 路由与 composer。

新建会话复用 Web 的独立字段组件、模型查询 hooks、useSpawnSession 和 WorkspaceBrowser。完整 NewSession 表单包含其他代理、历史导入及桌面重启等操作，超出当前三类 CLI 的创建范围，因此采用组件组合并保留桌面双栏/对话框布局。

API 客户端通过注入 transport 复用上游请求结构。桌面布局不使用上游 SessionChat：该组件绑定 Web 路由、语音及单会话状态；本项目组合上游 ToolCard、CodeBlock、MachineSelector、PermissionField、RenameSessionDialog、ConfirmDialog 等可独立复用的组件。待回答问题直接组合上游 RequestUserInputFooter/AskUserQuestionFooter，省去 ToolCard 重复的题目摘要；两个 footer 通过可选 scrollable 属性适配受限高度，保持上游答案协议与默认 Web 布局。Markdown 展示适配桌面 IPC 链接，禁用原始 HTML 与自动远程图片请求。

分享复用 ShareTurnDialog，并通过兼容扩展替换导出方式：浏览器版的 iframe、下载链接与原生 Web Share API 不适合受限的 Electron renderer，因此采用本地 SVG 栅格化与主进程剪贴板/保存对话框，保持 CSP 禁止子框架和直接网络请求。

队列复用 QueuedMessagesBar 导出的排序、预览和可操作性判断，以及 HAPI 的取消、插入、重试 mutation hooks 和状态恢复逻辑。原队列组件依赖 assistant-ui composer 与定时草稿恢复，桌面采用独立草稿，故使用桌面视图组合这些共享行为。提示复用 ToastProvider/Toast，以桌面标签激活替代 ToastContainer 的 Web 路由跳转。会话未读状态复用 sessionLastSeen 的水位存储和 classifySessionAttention，存储 ID 增加 Hub/账户作用域，避免同名会话交叉影响。命令菜单复用 useSlashCommands、useActiveSuggestions、Autocomplete 和 applySuggestion，命令状态反馈复用 getEventPresentation；不另行维护命令清单或在前端模拟执行。

中文默认，主题跟随系统。桌面新增文案包含七种语言；上游工具卡当前随 HAPI 提供中文或英文，其他界面语言使用英文工具卡。完整 transcript 只保存在 Hub 和客户端内存；本地保留工作区、草稿、滚动/折叠状态与未确认发送记录。注销会删除凭据并清理本地浏览器存储。请把含本地草稿的 Windows 用户目录视为个人数据。

## 认证设计与验证范围

参考 OWASP ASVS **5.0.0**、[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 和 [HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)。这些参考不构成全面 ASVS 合规声明。

公网地址必须 HTTPS；按用户明确要求，0.1.1 起对上述内网 IP 和回环地址允许 HTTP。这是 OWASP 认证与会话指南中传输加密要求的已知例外，不构成 ASVS 合规声明，也不代表内网 HTTP 提供传输保护。地址分类在主进程连接前执行；拒绝 URL 内凭据、路径、查询参数和重定向。令牌由主进程调用系统 safeStorage 加密，系统安全存储不可用时仅允许本次运行登录。JWT 到期前刷新，并对并发 401 合并刷新；失败后要求重新认证。客户端不记录令牌或透传可能含秘密的服务端报错。注销及账户切换使旧请求失效。认证授权、令牌签名/撤销和所有远程操作权限仍由 Hub 执行。

Renderer 使用本地 `app://desktop` 协议、sandbox、context isolation、禁用 Node，CSP 禁止直接网络访问及子框架。IPC 校验主窗口主 frame，只放行明确列出的 API 路由，禁止任意 URL、auth、终端或服务器管理接口。外部链接只接受 http(s)，由主进程打开系统浏览器。

自动测试覆盖：到期刷新、并发 401、撤销、注销时旧请求失效、加密存储调用和无明文回退、IPC 路由校验、SSE 游标/缺口、未知事件、版本单调性、发送响应丢失、双栏隔离、审批请求 ID 与恢复 ID 迁移。Windows 的系统安全存储和通知实际呈现需在目标系统验收。

## 许可证与上游更新

AGPL-3.0-only，保留 HAPI 与 Happy 的来源和版权信息，见 `LICENSE`、`THIRD_PARTY_NOTICES.md`。分发修改版本时一并提供对应源码。此项目不是官方 HAPI 发行版。

`bun run verify:upstream` 校验全部 vendored 文件哈希，并在临时目录反向/正向应用补丁，验证能恢复上游源码和桌面修改。升级 HAPI 时先更新 pinned commit、补丁与哈希，再运行 golden fixture 和桌面回归测试。修改本地化文件通过 `scripts/add-missing-keys.mjs` 与 `bun run i18n:sync` 同步全部语言。
