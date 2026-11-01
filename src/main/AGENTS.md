# 主进程与跨进程边界

继承[根规范](../../AGENTS.md)。本文件约束 `src/main/`；修改 IPC、preload、共享桥接或系统能力时，也应按以下调用链核对。

## 责任分配

| 入口 | 责任 |
| --- | --- |
| `index.ts` | 应用/窗口/托盘生命周期与 IPC 注册；新增独立服务不继续堆入此入口 |
| `hub.ts`、`sse.ts` | 认证、HTTP、连接与重连、SSE 解码 |
| `storage.ts` | 设置读写、迁移和系统安全存储 |
| `notifications.ts`、`image-export.ts` | 系统通知、图片导出等专门能力 |
| `../shared/bridge.ts`、`../shared/policy.ts` | 请求/结果类型、运行时校验与允许的操作 |
| `../preload/index.ts` | 明确方法到 IPC channel 的窄桥接 |

## 修改 IPC 的核对顺序

1. 找到 renderer 调用、`DesktopBridge` 类型、preload 方法、主进程 handler 和校验规则。
2. 明确合法输入、大小/数量限制、作用域、返回值与失败码。TypeScript 类型不能替代运行时校验。
3. 只暴露任务需要的具体能力；不得暴露任意 IPC channel、任意本地路径读写或通用命令执行能力。
4. 同步更新所有层，验证成功、无效输入和受影响的拒绝/失败路径；保留旧客户端或旧数据所需的兼容行为。

## 安全与生命周期

- 生产窗口保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`，校验 IPC 的调用来源。测试环境中的 `--no-sandbox` 不能进入生产启动代码。
- 访问令牌、JWT 和刷新状态留在主进程；renderer、localStorage、日志和错误提示中不得保存或泄漏凭据。系统安全存储不可用时不回退为明文记住密码/令牌。
- 请求、文件和外链使用既有 URL/来源/路径/方法校验。服务端提供的请求 ID 视为协议标识，只按具体路由编码与校验，不能把 ID 内容当本地路径或代码执行。
- 账户切换、注销、断线和窗口生命周期变化时，使旧请求、订阅、通知与重试失效；清理自己创建的资源。认证成功与 SSE 真正连通是不同状态，不混为一谈。
- 避免并发重复刷新认证或无限重试。请求超时/网络中断后，写操作可能已被服务端接收，不能在传输层盲目重放。
- 保存设置保留既有原子写入方式和旧字段兼容；改变 schema 或默认值时验证旧设置不会整份丢失。读写用户文件必须走已有选择/保存流程，不能覆盖无关数据。
- 子进程调用优先参数数组，外部文字不能拼接进 shell。日志仅包含定位问题需要的安全上下文，不能直接打印完整请求、响应、文件正文或错误对象中的凭据。

## 验证入口

按影响范围选择 `tests/hub.test.ts`、`tests/state.test.ts`、`tests/storage.test.ts`、`tests/notifications.test.ts`、媒体测试及 Electron 回归。模拟 API 校验不能替代必要的跨进程验证；涉及系统凭据、托盘、通知、启动或安装行为时说明目标平台实际验证情况，不能把 Linux 测试写成 Windows 验证。
