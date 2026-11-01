# 测试组织与验证规范

继承[根规范](../AGENTS.md)，特别是整个进程树最多使用 2 个逻辑 CPU、重型任务串行执行的要求。测试用于保护真实行为，不能通过降低断言、跳过用例或伪造成功让结果变绿。

## 按职责组织

- 新测试放入对应功能的 `*.test.ts`、`*.test.tsx` 或 `*.e2e.ts`，按业务概念命名；不要继续把所有新功能追加进大型 `desktop.e2e.ts`。
- 修改现有行为时可以更新原用例；新建独立测试文件时，只在确有重复的启动/清理逻辑后提取共享 fixture。禁止复制整套巨型测试文件或新造一个万能测试框架。
- 一个用例保护一组相关行为，名称写出触发条件和结果。测试数据从最小有效 fixture 开始，不依赖测试顺序、真实 Hub、用户账户或真实会话导出。
- 纯规则用 Vitest，组件交互用 Testing Library，需要真实布局、跨进程或浏览器能力的行为用 Playwright/Electron。不要用 jsdom 尺寸断言证明实际布局。

## 有效断言

- bug 修复优先保存旧代码可失败的最小复现；若无法自动复现，记录触发条件、观察证据及检查方法。低影响可逆样式/文案修改不为数量机械新建测试。
- 断言用户可见结果、稳定 API、数据保留或失败恢复，而不是私有函数次数、完整 class 字符串或大段 DOM 快照；不要复制被测算法计算“期望值”。
- 按改动风险覆盖成功、关键边界和失败路径。发送/恢复/迁移重点检查结果不明、重复回执、新草稿、会话切换和重连；不是每个小测试都要枚举全部场景。
- 外部网络、时钟、平台 API 等边界可以 mock，被测模块自身不应被 mock 掉。协议 fixture 使用真实字段结构，尤其保留原始 ID 的编码和转义，不能简化到绕过实际错误。
- 异步等待明确的状态、回调或请求结果；不靠固定 sleep 和反复重跑制造通过。需要验证超时/去抖时使用可控时钟或有意义的时间边界。

## Electron 与资源清理

- 复用 `fake-server.ts` 的 `FixtureHub` 和相关 fixture，使用临时用户目录；通过 `electron-cleanup.ts` 关闭本用例启动的 Electron，并关闭 Hub、释放文件和测试状态。
- 不连接实际部署的 Hub，不结束用户或其他任务的进程。测试需要的文件仅写入自己的临时目录或被忽略的 `build/` / `test-results/`。
- 角色、可访问名称、稳定的测试标记优先于脆弱 DOM 层级；布局按实际容器测量并允许合理的亚像素误差。
- Portal、滚动和遮挡检查真实按钮的可见范围、点击命中和焦点恢复。截图用于人工核对，不能单独证明点击与键盘行为正确。
- 用例结束清理计时器、监听、mock、存储和服务器阻塞开关，确保能单独执行且不会拖住后续用例。

## 运行与覆盖范围

命令从仓库根目录执行，例如：

```sh
bun run test --project desktop tests/storage.test.ts
bun run test --project hapi-contract
bun run build
xvfb-run -a bun run test:e2e tests/alignment.e2e.ts
node scripts/limit-cpu.mjs bun run --cwd vendor/hapi/shared test
```

- `vitest.config.ts` 的 `hapi-contract` 使用明确文件清单，不会自动运行 vendor 下所有测试；新增共享回归时检查是否确实被发现。保留 `tests/upstream-cwd.ts` 与隔离 worker 的 fixture 路径约定。
- 用 `--grep` 筛选 Electron 用例时注意匹配的是完整测试标题，可先用 `--list` 核对；“No tests found”不是测试通过。
- Electron 执行的是 `out/`，应用源码改变后先构建。按影响范围选择用例；CI 的全量检查不能替代本地对本次改动的定向验证。
- 记录命令、实际通过/失败数、CPU 限制和环境；源码未变化的结果可复用并注明。测试失败时先判断产品缺陷、测试缺陷还是环境问题，不扩大无关改动。
