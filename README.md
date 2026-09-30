# HAPI Desktop

通过现有 HAPI Hub API 管理 Linux 服务器上的 Codex、Claude Code、OpenCode 和 Hermes。独立 Electron 桌面客户端，面向 Windows 10/11 x64。新建会话提供这四类 CLI，是否可创建由远端 runner 的可用性检测决定；新增其他 CLI 仍需桌面适配。

## 使用

运行 `HAPI-Desktop-0.1.11-win-x64-setup.exe`，输入 Hub 地址和访问令牌。地址填写 origin，例如 `https://hapi.example.com` 或 `http://192.168.1.5:3006`；不含 `/api` 或子路径。远端 CLI 与 runner 由已有 HAPI 部署负责。

内网 HTTP 支持 IPv4 `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`，共享/VPN 网段 `100.64.0.0/10`，IPv6 ULA `fc00::/7`，以及 localhost、IPv4/IPv6 回环地址。使用内网域名时请填写对应内网 IP，或使用 HTTPS；公网地址仍要求 HTTPS。HTTP 连接不会加密传输的令牌与消息，此选项按内网部署需求提供。

左侧默认分为“进行中”“活跃会话”“历史会话”：只有 active 且 thinking 的会话进入“进行中”，停止思考即移入“活跃会话”；仅有后台任务的会话留在活跃区。归档/离线会话在底部按机器和工作区分组，名称灰显。历史工作区标题仅显示文件夹图标与路径，支持点击或键盘折叠，并显示会话数量；默认折叠，可在设置中关闭。手动展开/折叠的选择优先于默认设置，按 Hub/账户保存；搜索时临时展开匹配结果，清除搜索后恢复。设置中的“按状态分区显示会话”可关闭分区，恢复统一的机器/项目列表。搜索和筛选在各分区一致生效。可打开、创建或恢复会话。顶部切换双栏，在标签栏将会话移到另一栏，中间分隔线可拖动，也支持方向键调整。右侧文件和 Git diff 均为只读。

0.1.11 在会话列表的工作区路径旁增加复制和加号按钮。复制完整路径并显示成功或失败反馈；加号打开原有新建表单，预填该工作区的机器与目录，再选择 CLI、模型和权限。两项操作与工作区折叠独立，搜索展开时仍可使用；取消后不会把该目录带入普通新建入口。历史工作区与关闭状态分区后的工作区均提供操作。路径较长时省略显示，复制保留完整内容；小窗口和大字号下操作按钮保持可见。

加号只在 Hub 已连接、工作区具有真实路径且对应机器在线时启用。缺少路径的分组不提供路径操作；机器未知或离线时仍可复制已有路径。打开表单后机器离线会禁用创建并提示选择在线机器，不会自动改用其他服务器；手动换机器会清除旧目录。

新建会话组合 HAPI Web 的模型、思考强度、权限、协作模式、快速模式与会话类型组件。Codex 模型与思考档位由远端返回，只有模型支持时显示快速模式；Claude 使用 Web 同源模型与 effort 选项；OpenCode 按机器和目录查询模型与变体，切换目录或模型会清除不适用的旧选择。支持直接使用目录或创建 Git 工作树。远端目录浏览复用 WorkspaceBrowser，支持子目录导航与隐藏文件夹；选择目录后返回表单并保留配置。浏览范围由 runner 的 `--workspace-root` 决定，未配置时显示 Web 同样的设置指引。

0.1.10 对齐 HAPI Web 的 Hermes 创建与设置。选择 Hermes 后可沿用远端配置，也可搜索供应商分组的模型目录、手动填写完整模型 ID，并刷新目录；如 `custom:office:qwen:32b` 会保留供应商前缀。目录发现失败或为空时仍可使用默认配置或手动 ID 创建；换机器或工作目录会重置模型选择。需要支持 Hermes 的 Hub/runner，以及该 runner 能检测到的 Hermes CLI；远端配置和 `HERMES_HOME` 沿用现有部署。只提供原生“默认 / 允许编辑”权限，不提供 YOLO、计划模式、思考强度或快速模式。当前轮结束后可切换模型和权限，失败保留服务端原值并允许刷新重试。

Hermes 原生命令包含 `/help`、`/model`、`/tools`、`/context`、`/reset`、`/compress`、`/version`、`/steer`，按原文提交给 CLI。支持活动轮优先插入、中断、原生审批与同一 HAPI 会话 ID 的恢复；模型响应仍取决于远端供应商配置。

0.1.10 修复宽 Markdown 表格挤压列宽或令整个聊天区横向溢出的问题：表格独立横向滚动，聚焦后可用方向键滚动；表头、对齐、链接、行内代码和转义竖线保持正常。复用 Web 的分隔行补齐逻辑，分隔行少列的表格也能显示，代码围栏内的示例保持原样。复制仍保留原 Markdown，分享图片会展开表格以包含所有列。

会话右上角的“会话大纲”列出已加载的用户消息，支持搜索，点击条目跳转并突出显示对应消息；可继续加载更早记录。翻阅历史时新回复不会打断阅读，点击“回到最新消息”取回最新记录并恢复自动跟随；两个会话的导航互不影响。

文件栏左边和两个会话之间的分隔线均可拖动，聚焦后支持方向键与 Home/End，双击恢复默认宽度。文件栏宽度和会话分栏比例按 Hub/账户保存；窗口变小时暂时限制文件栏宽度，放大后恢复原偏好。

0.1.8 文件栏复用 Web 的目录树、文件搜索、名称/修改时间/大小排序、文件元信息、Git 分支与暂存/未暂存列表。目录展开状态按 Hub/账户/会话保存，排序和最近使用的标签按账户保存。文件右键可复制相对/绝对路径或添加引用到当前会话草稿；双栏草稿独立，添加引用不会自动发送。预览提供 Markdown 渲染/源码切换、代码高亮、行号、换行开关、内容复制、图片放大和系统保存窗口；空文件也能下载。Git 行数统计失败时仍显示可用的变更列表，当前文件被删除或无法读取时仍可查看已取得的 diff。

0.1.8 修复聊天正文链接首次点击无反应：聊天栏焦点更新曾导致链接元素在点击完成前被重新创建，现改为稳定组件。HTTP(S) 链接调用系统默认浏览器，支持普通点击、中键和键盘打开；系统拒绝打开时可重试或复制地址。远端文件链接如 `[使用说明](/path/to/guide.md:257)` 打开右侧预览，读取前去掉行号后缀；连续点击同一链接也会重新定位到该文件。文件内容通过当前会话的 HAPI 文件接口读取，访问范围由 runner 决定，工作区外路径可能被拒绝；此版本不跳转到指定行。

会话列表右键菜单与 Web 一致，支持复制会话引用、重命名，以及活动会话归档和历史会话删除；也可聚焦会话后按 Shift+F10。复制的是包含 `/sessions/<id>` 与 HAPI 会话读取提示的引用文本，可粘贴到另一会话；它不是公开分享链接。右键操作无需切换当前聊天，归档与删除均需确认，删除失败可重试；成功后即使没有 SSE 删除事件也会更新列表并清理本地对应会话状态。

0.1.7 修复计划模式的正文和步骤被普通工具折叠层隐藏的问题。计划提案、`update_plan` 进度和 `TodoWrite` 清单直接展示共享 HAPI 卡片，恢复会话后仍可查看；普通工具继续按原设置折叠，待确认计划仍使用原生审批。

0.1.9 接入 Web 的工具分组。Codex 上报为读取、列目录、搜索的连续操作合并成“正在探索 / 已探索”；展开后按操作类型和文件/搜索目标列出记录，点击单条查看命令、输入和结果。普通连续操作使用 Web 的操作摘要与统计，修改、执行、读取及搜索各有标识，运行中和错误状态会更新。单独工具显示 Web 的图标、名称和目标摘要。探索分组默认收起，可在设置中关闭“探索记录默认收起”；设置在两栏同步，重启后保留。展开较早历史边界的分组时自动补读前面的记录并保持阅读位置；计划、子代理和待审批/问答使用 Web 的分组边界。分组显示整体开始、结束和耗时，单条详情显示该操作时间；普通独立工具保留原来的三项时间栏。分类依赖 CLI 上报的结构化信息，缺少分类的命令按 Web 普通工具规则显示。

0.1.9 补齐聊天附件上传：点击输入框的回形针选择多个文件，也可拖入文件或粘贴剪贴板图片。附件卡显示文件名、大小、预览和上传状态，支持移除、失败重试、拖动排序及左右按钮排序；可以仅发送附件。沿用 Web 的单文件 50 MiB 上限，空文件会提示错误；图片不超过 5 MiB 时生成内联预览，其他图片仍作为文件上传。附件通过现有 Hub 上传接口进入远端会话，由该会话的 CLI 使用。修复图片加载时延迟到达的滚动事件误判为向上翻阅，保持正在跟随最新消息的视图随图片展开。

未发送附件按 Hub、账户、会话存入本机 IndexedDB，切换标签、双栏或重载后恢复。归档会话先恢复，返回新会话 ID 时重新匹配上传路径并迁移草稿；目标已在另一栏打开时同步更新附件。发送结果未知时保留附件和原消息 ID，先检查送达状态再明确重试，保留原排队/优先插入方式；成功后只清除本机草稿，不删除 CLI 尚需读取的远端文件。移除上传中的附件会清理迟到的上传结果，删除会话和注销会清理相应本机草稿。

设置中可选择“回车换行”或“回车发送”，默认保持回车换行；`Ctrl+Enter` 始终可发送，`Shift+Enter` 换行，输入法选词的回车不会发送。界面字号提供小、标准、大、特大四档，两栏同步生效。设置保存到本机，重启后保持。0.1.3 修正全局字体重置覆盖按钮字号与字重的问题；按钮采用更紧凑的比例，工具与问答文字同步缩小，聊天正文保持原有字号与行距。

排队消息在输入框上方显示内容、时间、数量和附件名称，不重复放入已执行的聊天记录。支持取消、明确重试结果不明的消息，以及把已有队列消息或新输入内容“优先插入”当前轮。插入能力遵循 HAPI：Codex、Cursor ACP、Pi、Hermes 需有可插入的活动轮且受远程控制；Claude、OpenCode 等未提供此能力的会话仍可正常排队。网络恢复或插入失败不会自动重发。

输入 `/` 或点击“原生命令”打开命令列表，复用 HAPI 内置命令与远端 CLI 返回的项目、自定义命令；方向键选择，Tab/Enter 补全，Escape 关闭菜单。补全只修改草稿，命令和参数按原文提交给 CLI，例如 `/model ...`、`/plan`、`/compact`、`/goal ...`。共享 Codex 的 `/clear` 和 `/new` 走 HAPI 新会话接口，并切换到返回的会话 ID。实际可执行命令以对应 HAPI CLI 的支持范围为准。

配色采用简洁黑白灰；设置里可选浅色、深色或跟随系统。新建会话使用低对比度文字加号入口。消息显示日期和时分秒，悬停可看完整日期；支持复制 Markdown 原文和预览、复制、保存 PNG 分享图片。图片只在本地生成，不会上传。工具卡固定显示开始时间、结束时间和耗时，运行中每秒更新；优先使用 Hub 记录的执行时间，缺失值显示“—”。

会话顶部显示当前模式、权限、思考强度、创建时间与更新时间；时间使用本机时区，悬停可查看包含秒的完整时间，HAPI 推送更新后同步刷新。点击右上角的会话设置图标或顶部设置摘要可修改当前远程会话。Codex 支持独立的默认/计划模式、权限模式、动态模型与思考档位；Claude 支持权限（含计划模式）、Web 同源模型选项与 effort；OpenCode 支持权限（含计划模式）、远端模型和当前模型提供的思考档位。设置通过 HAPI 原生 API 提交，成功后读取服务端状态；失败保留原值并显示错误。归档会话需先恢复，终端独占控制或断线时禁用设置。

会话可重命名、归档、中断，并处理工具审批与交互式问题。归档会话右上角提供删除入口，复用确认对话框展示会话名称和不可撤销的删除范围。仅在用户确认后调用 HAPI 删除接口；失败保留会话和草稿，成功后清理列表、标签页、消息缓存及对应本地草稿/待发送状态，也同步处理其他客户端发来的删除事件。侧栏和设置页统一显示当前应用版本，开发运行也不会误显示 Electron 版本。窗口关闭后驻留托盘；托盘的退出操作关闭客户端，远端任务继续运行。系统通知点击后定位对应会话。开机启动默认关闭。

交互问答直接复用 HAPI 网页组件：Codex `request_user_input` 与 Claude `AskUserQuestion` 支持各自的单选、多选、自由填写和分步提交，答案使用原请求映射 ID 回传。待回答时默认展开问答区，标题和翻页/提交按钮固定，长题目与选项在卡内滚动，修复整张卡片被外层限高裁切的问题。可收起问答继续查看聊天，展开/收起不会丢失已填答案或聊天草稿。会话列表状态文字加深，并与前方圆点同色：活动/思考为绿色，待处理为棕黄色，历史为灰色，浅色和深色主题分别适配。

就绪会话使用绿色勾选标记。未读更新以蓝色底纹、左边线和“新动态”徽标提示；首次连接不会把所有旧会话标成未读，之后的阅读进度按 Hub/账户保存，当前窗口中可见的会话在获得焦点后标记已读。沿用 HAPI 的 updatedAt 水位语义，“新动态”可能包含消息、审批或其他会话更新，“就绪”表示代理当前空闲，不表示整个项目已完成。

如果发送响应丢失，输入内容和 localId 会保留。先使用“检查送达状态”；Hub 确认已接收后清除本地待确认状态。查不到时显示显式重试按钮，沿用原 localId。Hub 报告 indeterminate 的消息需要在排队消息栏显式处理。客户端不会在网络恢复时自动重发。

0.1.6 接入 HAPI `display_image`、`display_video`、`display_media` 的原生文件消息。图片自动加载，可点击放大；音视频点击加载后使用播放器；所有文件卡片与右侧文件预览面板均支持下载，通过系统保存对话框选择位置。文件过期或远程会话离线时显示错误，图片加载失败可重试；浏览器无法解码的媒体可下载后使用本机程序打开。预览仅保存在内存，关闭卡片后释放，不自动写入下载目录。二进制媒体沿用 Hub 的 25 MiB 单文件上限和 runner 可用性限制。

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

0.1.11 验证：`bun run typecheck`、`bun run build`、`bun run test`（431 项）、`xvfb-run -a bun run test:e2e`（43 项）通过，全部编译/测试进程限制在 CPU 0,1。新增覆盖同路径不同机器的准确创建、完整 Unicode 长路径复制、复制失败与重试、折叠/搜索/键盘操作、取消后的默认新建入口、缺少元数据、机器离线禁用及恢复、表单打开后机器离线时禁止自动切换，以及深色特大字号和 920×640 窗口布局。`node scripts/limit-cpu.mjs bun run verify:upstream` 验证 935 个来源文件、31 个累计补丁文件可恢复重放；`node scripts/limit-cpu.mjs bun run i18n:sync` 确认七种语言各 218 个键齐全。`node scripts/limit-cpu.mjs node scripts/package-win.mjs` 构建完整 Windows NSIS 安装包，内外层归档、版本、98 个编译文件、图标、许可证、来源信息和更新清单已核验。以上为 Linux Electron、模拟 Hub 与 Windows 交叉构建验证，未操作已部署服务；Windows 实机仍需验收。

0.1.10 验证：`bun run typecheck`、`bun run build`、`bun run test`（431 项）、`xvfb-run -a bun run test:e2e`（41 项）通过，编译与测试进程均限制在 CPU 0,1。新增覆盖 Hermes 可用性检测、完整供应商模型 ID、原生权限、空目录与发现失败时的默认/手动回退、切换工作目录重置选择、目录刷新、设置失败保留原值、思考时禁用修改、命令、优先插入、审批和同 ID 恢复；覆盖窄双栏特大字号下表格滚动、对齐、转义、Markdown 原文复制、宽表格图片导出、少列分隔行及代码围栏。`node scripts/limit-cpu.mjs bun run verify:upstream` 验证 935 个来源文件与 30 个累计补丁文件能恢复重放；`node scripts/limit-cpu.mjs bun run i18n:sync` 确认七种语言各 216 个键齐全。`node scripts/limit-cpu.mjs node scripts/package-win.mjs` 构建完整 NSIS 包，已校验内外层归档、包内版本、98 个编译文件、图标、许可证与来源信息。验证环境为 Linux Electron、模拟 Hub 与 Windows 交叉构建，未操作已部署的 HAPI 或真实 Hermes 会话；Windows 实机仍需验收。

0.1.9 验证：`bun run typecheck`、`bun run build`、`bun run test`（428 项）、`xvfb-run -a bun run test:e2e`（36 项）通过，全部编译与测试进程限制在 CPU 0,1。新增覆盖探索分组分类/时间/历史补读/折叠设置，以及多文件选择、拖放、粘贴图片、排序、附件单独发送、双栏隔离、持久化草稿与取消迟到上传；验证未知送达后的原 ID 与优先插入重试、发送期间切换标签、归档恢复 ID 迁移、目标已打开时合并、会话删除/注销清理及小窗口特大字号。实际通过 7 MiB 二进制上传及四张各 5 MiB 的图片上传、SSE 接收和历史重载，主进程协议测试覆盖 50 MiB 边界、超限、非法文件名/MIME/Base64 与账户切换。`node scripts/limit-cpu.mjs bun run verify:upstream` 验证 932 个来源文件、12 个补丁文件可恢复重放；`node scripts/limit-cpu.mjs bun run i18n:sync` 确认七种语言各 209 个键齐全。NSIS 内外层归档、包内版本/编译文件/图标/许可证、源码 ZIP 内容及校验和逐项校验。以上为 Linux Electron、模拟 Hub 与 Windows 交叉构建验证，0.1.9 尚待 Windows 实机验收。

0.1.8 验证：`bun run typecheck`、`bun run build`、`bun run test`（386 项）与 `xvfb-run -a bun run test:e2e`（28 项）通过，测试与编译均限制为 CPU 0,1。新增用例在 0.1.7 构建上复现正文链接点击后未调用浏览器；修复后覆盖首次点击、双栏焦点切换、中键/键盘打开、失败重试/复制链接、带行号的远端文件链接、重复文件链接及会话引用跳转。文件栏验证涵盖目录/排序持久化、搜索失败、路径/内容复制、Markdown/源码、图片放大、空文件保存、部分 Git 结果、缺失文件的 diff 与读取重试、插入引用后刷新、双栏草稿隔离，以及 920×640 深色特大字号下操作按钮完整可见。会话菜单验证复制引用、键盘打开、归档取消/确认、删除失败/重试和无 SSE 时更新列表。`node scripts/limit-cpu.mjs bun run verify:upstream` 验证 932 个来源文件、12 个补丁文件的恢复与重放；`node scripts/limit-cpu.mjs bun run i18n:sync` 确认七种语言各 195 个键无缺失。以上为 Linux Electron 与模拟 Hub 验证；浏览器测试验证主进程收到准确 URL，Windows 默认浏览器实际启动仍待实机验收。

0.1.7 验证：`bun run typecheck`、`bun run build`、`bun run test`（386 项）与 `xvfb-run -a bun run test:e2e`（25 项）通过，测试与编译均限制为 CPU 0,1。新增回归覆盖大纲搜索/跳转、历史加载的阅读位置保持、取消后的迟到响应、历史窗口淘汰最新消息后的重新获取、双栏同名消息隔离、阅读时接收新消息及图片加载后的自动跟随；另覆盖文件栏/会话栏拖动和键盘调整、重载保持、缩小窗口后恢复偏好、旧工作区升级，以及 Codex 计划正文/进度、恢复后的计划和 Claude 计划审批。既有小窗口长问答、媒体、队列与命令用例全部通过。`node scripts/limit-cpu.mjs bun run verify:upstream` 验证 932 个来源文件、7 个补丁文件的恢复与重放；`bun run i18n:sync` 确认七种语言各 188 个键无缺失。以上为 Linux Electron 与模拟 Hub 验证，新增功能尚待 Windows 实机验收。

0.1.6 验证：`bun run typecheck`、`bun run build`、`bun run test`（385 项）、`xvfb-run -a bun run test:e2e`（19 项）通过，测试和编译均限制为 CPU 0,1。新增桌面用例实际解码并放大 PNG、播放 VP8 WebM 和 PCM WAV、下载图片/二进制文件/文件面板文本并逐字节比较；覆盖文件失效后的重试、取消、写入失败、失败时保留已有文件、保存窗口期间断线，以及小窗口深色主题下的可见性。`node scripts/limit-cpu.mjs bun run verify:upstream` 仍验证 932 个来源文件和 7 个修改文件的补丁恢复与重放。以上为 Linux Electron 与模拟 Hub 验证；0.1.6 新增功能尚待 Windows 实机验收。

0.1.5 验证：`bun run typecheck`、`bun run build` 通过；`bun run test` 的 368 项单元与协议测试、`xvfb-run -a bun run test:e2e` 的 16 项 Electron 端到端测试全部通过，均限制为 CPU 0,1。新增测试覆盖旧设置升级、回车与输入法行为、字号与双栏同步、队列恢复/取消/插入/失败处理、Codex/Claude/OpenCode 命令发现与原文参数传递、命令结果显示、共享会话清理后的 ID 切换，以及 920×640 双栏特大字号下的长题目、末尾选项、固定导航、多题答案与草稿保留；另覆盖按钮/问答字号、正文比例、状态三分区、后台任务归属、未读持久化与已读清除、历史灰显及分区设置重启保留。新增覆盖工作区折叠/搜索/键盘展开/重载、旧工作区升级与账户隔离、会话时间和思考强度推送、三类代理设置的原生请求与空值重置、Codex 计划模式、模型目录失败刷新、设置失败保留原值、OpenCode 模型切换后刷新思考档位以及归档/终端控制状态禁用；另验证 920×640、特大字号、深色主题下四项会话设置及关闭按钮完整可见。0.1.5 回归覆盖默认折叠设置重载与手动选择优先、历史标题隐藏主机名、界面版本一致、归档删除的取消/失败/无 SSE 成功/外部删除与草稿清理，以及目录浏览返回、三类代理启动配置、Codex 计划/快速/工作树参数、OpenCode 模型变体切换和小窗口下创建按钮可见。`bun run verify:upstream` 验证 932 个来源文件及 7 个修改文件的补丁逆向恢复与重放。

`build/desktop-preview.png`、`build/desktop-dark-preview.png`、`build/preferences-preview.png`、`build/queue-preview.png`、`build/questions-preview.png`、`build/questions-small-preview.png`、`build/buttons-large-preview.png`、`build/session-status-preview.png`、`build/session-settings-preview.png`、`build/session-metadata-preview.png`、`build/new-session-codex-preview.png`、`build/new-session-claude-preview.png`、`build/new-session-opencode-preview.png` 为模拟 Hub 截图。用户已在 Windows 实机验证 0.1.1 的安装、内网 HTTP 和基本对话。0.1.5 由 Linux 交叉构建，新增功能尚待 Windows 实机验收；DPAPI、托盘气泡、开机启动及 Windows CPU 限制脚本未单独实机验证。安装包未进行代码签名。自动更新不在此版本范围内。

## 结构与边界

- `src/main/`：凭据、HTTP、唯一全局 SSE、重连、通知、托盘和 IPC 校验。
- `src/preload/`：窄接口 contextBridge。JWT 不进入 renderer。
- `src/renderer/`：React 工作区、双栏状态、会话视图、只读文件预览。
- `vendor/hapi/`：固定版本的 HAPI 协议、聊天归一化、分页、审批和展示组件。来源和修改详见 `UPSTREAM.json` 与 `patches/hapi-desktop.patch`。

历史工作区复用 Button 组合可访问的折叠标题，复制和加号使用独立按钮；上游 SessionList 的分组折叠依赖 Web 路由和列表状态，桌面工作区独立持久化。会话设置组合共享 Dialog、SelectControl、模型发现 hooks、模式/模型/思考档位 helpers 和 API 客户端；PermissionField 是新建会话的启动权限表单，不适合运行时设置，SessionChat/HappyComposer 则绑定 Web 路由与 composer。

新建会话复用 Web 的独立字段组件、模型查询 hooks、useSpawnSession 和 WorkspaceBrowser。完整 NewSession 表单包含其他代理、历史导入及桌面重启等操作，超出当前四类 CLI 的创建范围，因此采用组件组合并保留桌面双栏/对话框布局。

API 客户端通过注入 transport 复用上游请求结构。桌面布局不使用上游 SessionChat：该组件绑定 Web 路由、语音及单会话状态；本项目组合上游 ToolCard、CodeBlock、MachineSelector、PermissionField、RenameSessionDialog、ConfirmDialog 等可独立复用的组件。待回答问题直接组合上游 RequestUserInputFooter/AskUserQuestionFooter，省去 ToolCard 重复的题目摘要；两个 footer 通过可选 scrollable 属性适配受限高度，保持上游答案协议与默认 Web 布局。Markdown 展示适配桌面 IPC 链接，禁用原始 HTML 与自动远程图片请求。

分享复用 ShareTurnDialog，并通过兼容扩展替换导出方式：浏览器版的 iframe、下载链接与原生 Web Share API 不适合受限的 Electron renderer，因此采用本地 SVG 栅格化与主进程剪贴板/保存对话框，保持 CSP 禁止子框架和直接网络请求。

文件展示复用 HAPI 的消息归一化、`ImagePreview`、`FileIcon` 与 MIME 分类函数。上游 `GeneratedImageCard` 依赖 Web 聊天上下文、直接 `fetch` 和浏览器下载链接，故桌面卡片组合上述组件，以受校验的 IPC 获取文件和调用系统保存窗口。远端文件仅按会话与文件 ID（或文件面板路径）读取；不接受任意网络地址。先写入目标目录内的临时文件，完整成功后再替换目标，失败清理临时文件。

文件侧栏组合共享 `DirectoryTree`、排序菜单、Git/搜索结果行、`FileActionMenu`、查询 hooks、`DiffDisplay`、`CodeBlock` 和 `ImagePreview`。完整 Web 文件页绑定路由导航，不适合桌面双栏中的常驻侧栏；通过导出现有组件/辅助函数、为目录树增加可选原生下载插槽和存储作用域进行复用，保持 Web 默认行为。会话列表菜单直接组合共享 `SessionActionMenu`、重命名和确认对话框；可选引用 base 参数解决 Electron 相对资源路径导致引用误带 `./` 的问题。

大纲复用 HAPI 的 `buildConversationOutline`、`ConversationOutlinePanel` 和滚动锚点保存/恢复函数。桌面导航适配双栏独立滚动容器与本地草稿；共享 HappyThread 整体绑定 assistant-ui 运行时，不能直接替换桌面聊天视图。宽度调整从原有分栏分隔线抽取共享 `ResizeHandle`，统一指针与键盘行为；计划直接使用现有 `ToolCard` 与计划/清单视图。

附件上传复用 Web 的 `createAttachmentAdapter`、IndexedDB 草稿存储与原子迁移、`moveAttachmentId` 和 `MessageAttachments`。附件条组合共享 `ImagePreview`、`FileIcon`、`Spinner`、`Button`；完整 `AttachmentItem` / `SortableComposerAttachments` 依赖 assistant-ui composer 运行时，无法直接用于桌面的独立输入框。桌面 hook 负责账户作用域、异步上传生命周期、恢复 ID 迁移及未确认发送记录的衔接。

工具分组直接复用 `buildVisibleChatBlocks`、`ToolGroupCard` 与 `getToolPresentation`，不另写分类器或分组卡片。通过 `HappyChatProvider` 接入桌面的会话数据和保留滚动位置的历史加载函数；沿用 Web 的稳定分组 ID，使追加消息和补齐历史时保持展开状态。0.1.9 的工具分组接入无需修改 vendored 组件或升级 HAPI 源码快照。

队列复用 QueuedMessagesBar 导出的排序、预览和可操作性判断，以及 HAPI 的取消、插入、重试 mutation hooks 和状态恢复逻辑。原队列组件依赖 assistant-ui composer 与定时草稿恢复，桌面采用独立草稿，故使用桌面视图组合这些共享行为。提示复用 ToastProvider/Toast，以桌面标签激活替代 ToastContainer 的 Web 路由跳转。会话未读状态复用 sessionLastSeen 的水位存储和 classifySessionAttention，存储 ID 增加 Hub/账户作用域，避免同名会话交叉影响。命令菜单复用 useSlashCommands、useActiveSuggestions、Autocomplete 和 applySuggestion，命令状态反馈复用 getEventPresentation；不另行维护命令清单或在前端模拟执行。

工作区复制复用 `useCopyToClipboard`（含剪贴板失败回退），按钮组合已有 `Button`；Web `CopyPathButton` 内置在完整 SessionList 中，缺少桌面所需的本地化与失败反馈，因此未整体导入。工作区创建复用 `NewSessionDialog`，只增加初始机器/目录参数；共享 `MachineSelector` 增加可选占位项，表示预选机器已不可用，原有调用行为保持一致。工作区携带明确的机器 ID，不从主机名或显示路径推断机器。

Hermes 创建与会话设置复用 Web 的 `HermesModelPicker`、`useHermesModels` 和原生权限组件，适配桌面的双栏与对话框；创建时保留默认配置/手动模型输入，运行中沿用 Web 的模型目录选择。Markdown 表格复用 Web 导出的 `Table` 及 `remarkRepairTables`，桌面补充列宽、键盘滚动和本地图片导出适配。

中文默认，主题跟随系统。桌面新增文案包含七种语言；上游工具卡当前随 HAPI 提供中文或英文，其他界面语言使用英文工具卡。完整 transcript 只保存在 Hub 和客户端内存；本地保留工作区、文字与文件附件草稿、滚动/折叠状态与未确认发送记录。注销会删除凭据并清理本地浏览器存储。请把含本地草稿的 Windows 用户目录视为个人数据。

## 认证设计与验证范围

参考 OWASP ASVS **5.0.0**、[Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)、[Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) 和 [HTML5 Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html)。这些参考不构成全面 ASVS 合规声明。

公网地址必须 HTTPS；按用户明确要求，0.1.1 起对上述内网 IP 和回环地址允许 HTTP。这是 OWASP 认证与会话指南中传输加密要求的已知例外，不构成 ASVS 合规声明，也不代表内网 HTTP 提供传输保护。地址分类在主进程连接前执行；拒绝 URL 内凭据、路径、查询参数和重定向。令牌由主进程调用系统 safeStorage 加密，系统安全存储不可用时仅允许本次运行登录。JWT 到期前刷新，并对并发 401 合并刷新；失败后要求重新认证。客户端不记录令牌或透传可能含秘密的服务端报错。注销及账户切换使旧请求失效。认证授权、令牌签名/撤销和所有远程操作权限仍由 Hub 执行。

Renderer 使用本地 `app://desktop` 协议、sandbox、context isolation、禁用 Node，CSP 禁止直接网络访问及子框架。IPC 校验主窗口主 frame，只放行明确列出的 API 路由，禁止任意 URL、auth、终端或服务器管理接口。外部链接只接受 http(s)，由主进程打开系统浏览器。

自动测试覆盖：到期刷新、并发 401、撤销、注销时旧请求失效、加密存储调用和无明文回退、IPC 路由校验、SSE 游标/缺口、未知事件、版本单调性、发送响应丢失、双栏隔离、审批请求 ID 与恢复 ID 迁移。Windows 的系统安全存储和通知实际呈现需在目标系统验收。

0.1.6 的文件读取复用上述主进程认证与刷新流程，令牌不进入 URL 或 renderer，不跟随重定向。文件内容按流累计检查大小，不信任 `Content-Length`；连接切换会使读取和未完成保存失效。CSP 仅为音视频增加 `media-src blob:`，仍禁止 renderer 直接访问网络、加载子框架或嵌入对象。回归覆盖二进制与空文件、401 刷新和再次拒绝、非法资源 ID、响应大小限制、注销后的迟到响应、原生保存窗口期间断线、取消保存及失败时保留原文件。

0.1.9 上传沿用主进程认证，并增加请求发起时的 Hub/账户作用域校验，拒绝旧账户的迟到上传、发送与清理请求；已有连接代际校验继续丢弃断开后的结果。主进程校验文件名、MIME、Base64 格式及解码后 50 MiB 大小上限，单独放宽上传请求容量，其他接口保持原限制；消息请求、SSE 单条消息和历史页为多图预览分别保留 80 / 81 / 96 MiB 的有界容量。参照 [File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)，客户端不执行上传内容、不提供任意本机路径读取能力，文件内容与凭据不写日志。服务器仍负责会话授权、上传目录和文件处理策略。

## 许可证与上游更新

AGPL-3.0-only，保留 HAPI 与 Happy 的来源和版权信息，见 `LICENSE`、`THIRD_PARTY_NOTICES.md`。分发修改版本时一并提供对应源码。此项目不是官方 HAPI 发行版。

`bun run verify:upstream` 校验全部 vendored 文件哈希，并在临时目录反向/正向应用补丁，验证能恢复上游源码和桌面修改。升级 HAPI 时先更新 pinned commit、补丁与哈希，再运行 golden fixture 和桌面回归测试。修改本地化文件通过 `scripts/add-missing-keys.mjs` 与 `bun run i18n:sync` 同步全部语言。

0.1.10 保持基线 `0239edf38e2da653d662f31039e24ccea04c7837`，选择性移入 `drch90/hapi` 工作树中的 Hermes 实现；该来源基于 `0b70cac04c7492eb08f0c04466a576d5f157d67e`，Hermes 改动尚未提交，并非该提交本身已包含 Hermes。`UPSTREAM.json` 的 `backports` 保存实际读取源文件的 SHA256，累计补丁保存桌面适配结果。`UPSTREAM-FILES.json` 中新增文件的 `upstream: null` 表示其不在原基线中；验证器要求反向补丁删除它们，重放后逐字节恢复。不会读取或打包远端 Hermes 配置与凭据。
