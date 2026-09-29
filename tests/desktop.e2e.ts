import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, stat, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { FixtureHub, fixtureSession, fixtureMessage, fixtureCodexEvent } from './fake-server'
import { version as appVersion } from '../package.json'

let electron: ElectronApplication
let page: Page
let server: FixtureHub
let dataDirectory: string
let errors: string[]

test.beforeEach(async () => {
  server = new FixtureHub()
  const url = await server.start()
  dataDirectory = await mkdtemp(join(tmpdir(), 'hapi-desktop-test-'))
  // Only the root-owned Linux test harness disables the Chromium sandbox.
  // Production BrowserWindow always has sandbox:true and never adds this flag.
  electron = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${dataDirectory}`, resolve('out/main/index.js')],
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  })
  page = await electron.firstWindow()
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByLabel('Hub 地址', { exact: true }).fill(url)
  await page.getByLabel('访问令牌', { exact: true }).fill('fixture-secret-do-not-persist')
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await expect(page.getByTestId('session-design')).toBeVisible()
  // Existing cases start with history expanded; the default and its setting
  // are verified separately below and in the storage migration test.
  await page.evaluate(() => window.desktop.updateSettings({ collapseHistoryByDefault: false }))
})

test.afterEach(async () => {
  await electron?.close()
  await server?.close()
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true })
})

test('body links open the browser and remote file preview on the first click, including pane focus changes', async () => {
  const url = 'https://github.com/example/project/actions/runs/123456'
  server.messages.set('design', [
    fixtureMessage(
      'links',
      1,
      `[下载新版 APK](${url})\n\n[使用说明](/home/dev/hapi-desktop/docs/agents.md:257)\n\n[相关会话](/sessions/review)`,
    ),
  ])
  await electron.evaluate(({ shell }) => {
    const state = globalThis as unknown as { openedUrls: string[]; failBrowser: boolean }
    state.openedUrls = []
    state.failBrowser = false
    shell.openExternal = async (url: string) => {
      if (state.failBrowser) throw new Error('No default browser')
      state.openedUrls.push(url)
    }
  })
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await chat.getByRole('link', { name: '下载新版 APK' }).click()
  await expect
    .poll(() => electron.evaluate(() => (globalThis as unknown as { openedUrls: string[] }).openedUrls))
    .toEqual([url])
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await chat.getByRole('link', { name: '下载新版 APK' }).click()
  await expect
    .poll(() => electron.evaluate(() => (globalThis as unknown as { openedUrls: string[] }).openedUrls))
    .toEqual([url, url])
  await chat.getByRole('link', { name: '使用说明' }).click()
  await expect(page.locator('.file-preview')).toContainText('/home/dev/hapi-desktop/docs/agents.md')
  await expect(page.locator('.file-preview')).toContainText('A workspace for remote agents.')
  expect(server.fileReadPaths).toContain('/home/dev/hapi-desktop/docs/agents.md')
  expect(server.fileReadPaths.some((path) => path.endsWith(':257'))).toBe(false)
  await page.locator('.file-tabs').getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('button', { name: 'README.md', exact: true }).click()
  await chat.getByRole('link', { name: '使用说明' }).click()
  await expect(page.locator('.file-preview-path')).toHaveText('/home/dev/hapi-desktop/docs/agents.md')
  await electron.evaluate(() => {
    ;(globalThis as unknown as { failBrowser: boolean }).failBrowser = true
  })
  await chat.getByRole('link', { name: '下载新版 APK' }).click()
  await expect(chat.getByRole('alert')).toContainText('无法打开链接')
  await chat.getByRole('button', { name: '复制链接' }).click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(url)
  await electron.evaluate(() => {
    ;(globalThis as unknown as { failBrowser: boolean }).failBrowser = false
  })
  await chat.getByRole('button', { name: '重试', exact: true }).click()
  await expect(chat.getByRole('alert')).toHaveCount(0)
  await chat.getByRole('link', { name: '下载新版 APK' }).click({ button: 'middle' })
  await chat.getByRole('link', { name: '下载新版 APK' }).focus()
  await page.keyboard.press('Enter')
  await expect
    .poll(() => electron.evaluate(() => (globalThis as unknown as { openedUrls: string[] }).openedUrls))
    .toEqual([url, url, url, url, url])
  await chat.getByRole('link', { name: '相关会话' }).click()
  await expect(page.getByTestId('chat-review')).toBeVisible()
  expect(errors).toEqual([])
})

test('file sidebar shares web search, tree, sorting, menus, previews and partial Git results', async () => {
  server.directoryEntries.set('', [
    { name: 'docs', type: 'directory' },
    { name: 'preview.png', type: 'file' },
    { name: 'empty.txt', type: 'file' },
  ])
  server.directoryEntries.set('docs', [
    { name: 'guide.md', type: 'file', size: 40, modified: Date.UTC(2026, 8, 1) },
    { name: 'larger.md', type: 'file', size: 400 },
  ])
  server.fileContents.set('docs/guide.md', Buffer.from('# 使用手册\n\n文件栏预览内容'))
  server.fileContents.set('docs/larger.md', Buffer.from('# 较大的文档'))
  server.fileContents.set('preview.png', await readFile('resources/icon.png'))
  server.fileContents.set('empty.txt', Buffer.alloc(0))
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await chat.getByRole('textbox', { name: '发送消息…' }).fill('原有草稿')
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const panel = page.locator('.file-panel')
  await panel.getByRole('button', { name: 'docs', exact: true }).click()
  const guide = panel.getByRole('button', { name: /^guide.md/ })
  await expect(guide).toContainText('40 B')
  await guide.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '复制绝对路径' }).click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('/home/dev/hapi-desktop/docs/guide.md')
  await guide.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '添加到对话框' }).click()
  await expect(chat.getByRole('textbox', { name: '发送消息…' })).toHaveValue('原有草稿\n`docs/guide.md`')
  await panel.getByRole('button', { name: '文件排序' }).click()
  await page.getByRole('button', { name: '文件大小', exact: true }).click()
  await page.getByRole('button', { name: '最大优先', exact: true }).click()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(guide).toBeVisible()
  await expect(chat.getByRole('textbox', { name: '发送消息…' })).toHaveValue('原有草稿\n`docs/guide.md`')
  await expect(panel.getByRole('button', { name: /^(larger|guide).md/ }).first()).toContainText('larger.md')
  await guide.click()
  await expect(panel.getByRole('heading', { name: '使用手册', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '复制文件内容', exact: true }).click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('# 使用手册\n\n文件栏预览内容')
  await panel.getByRole('button', { name: '源码', exact: true }).click()
  await expect(panel.locator('[data-hapi-code-block]')).toContainText('# 使用手册')
  await panel.getByRole('button', { name: '返回文件列表' }).click()
  await panel.getByRole('searchbox', { name: '搜索文件' }).fill('guide')
  await panel.getByRole('button', { name: /^docs\/guide.md/ }).click()
  await expect(panel.getByRole('button', { name: '源码', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await panel.getByRole('button', { name: '返回文件列表' }).click()
  await expect(panel.getByRole('searchbox', { name: '搜索文件' })).toHaveValue('guide')
  server.failFileSearch = true
  await panel.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(panel.getByRole('alert')).toBeVisible()
  server.failFileSearch = false
  await panel.getByRole('searchbox', { name: '搜索文件' }).fill('')
  await panel.getByRole('button', { name: 'preview.png', exact: true }).click()
  await expect
    .poll(() =>
      panel.getByRole('img', { name: 'preview.png' }).evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await panel.getByRole('img', { name: 'preview.png' }).click()
  await expect(page.getByRole('dialog', { name: 'preview.png' })).toBeVisible()
  await page.keyboard.press('Escape')
  await panel.getByRole('button', { name: '返回文件列表' }).click()
  const output = join(dataDirectory, 'empty.txt')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, output)
  await panel.getByRole('button', { name: '下载文件: empty.txt', exact: true }).click()
  await expect.poll(async () => (await readFile(output).catch(() => null))?.length).toBe(0)
  server.failGitNumstat = true
  server.fileContents.set('src/main.ts', null)
  await panel.getByRole('button', { name: '变更', exact: true }).click()
  await panel.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('Diff')
  await panel.locator('.file-row[data-path="src/main.ts"]').click()
  await expect(panel.locator('.unified-diff')).toContainText('+const hub = connectHub()')
  await panel.locator('.file-preview-modes').getByRole('button', { name: '文件', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('文件不可用')
  server.fileContents.set('src/main.ts', Buffer.from('const hub = connectHub()'))
  await panel.locator('.file-preview-toolbar').getByRole('button', { name: '刷新' }).click()
  await expect(panel.locator('[data-hapi-code-block]')).toContainText('const hub = connectHub()')
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  const reviewDraft = page.getByTestId('chat-review').getByRole('textbox', { name: '发送消息…' })
  await reviewDraft.fill('另一栏草稿')
  await panel.locator('.file-tabs').getByRole('button', { name: '文件', exact: true }).click()
  await panel.getByRole('button', { name: 'docs', exact: true }).click()
  await guide.click()
  await panel.getByRole('button', { name: '添加到输入框' }).click()
  await expect(reviewDraft).toHaveValue('另一栏草稿\n`docs/guide.md`')
  await expect(chat.getByRole('textbox', { name: '发送消息…' })).toHaveValue('原有草稿\n`docs/guide.md`')
  expect(
    server.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/messages')),
  ).toHaveLength(0)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await expect(panel.getByRole('button', { name: '下载文件', exact: true })).toBeInViewport()
  await expect(panel.getByRole('button', { name: '添加到输入框' })).toBeInViewport()
  await expect(panel.getByRole('button', { name: '返回文件列表' })).toBeInViewport()
  expect((await panel.locator('.file-preview-body').boundingBox())!.height).toBeGreaterThan(50)
  expect(errors).toEqual([])
})

test('session context menu copies web references and confirms archive and deletion without opening the target', async () => {
  await page.getByTestId('session-design').click()
  await page.getByTestId('session-review').click({ button: 'right' })
  await expect(page.getByTestId('chat-design')).toBeVisible()
  await page.getByRole('menuitem', { name: '复制引用' }).click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('/sessions/review')
  const reference = await electron.evaluate(({ clipboard }) => clipboard.readText())
  expect(reference).toContain('See session "审查连接与恢复流程" (/sessions/review) for context.')
  expect(reference).toContain('call inspect_peer')
  await page.getByTestId('session-review').focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menuitem', { name: '归档', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('审查连接与恢复流程')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(server.requests.filter((request) => request.path.endsWith('/archive'))).toHaveLength(0)
  await page.getByTestId('session-review').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '归档', exact: true }).click()
  await dialog.getByRole('button', { name: '归档', exact: true }).click()
  await expect(page.getByTestId('session-review')).toHaveAttribute('data-status', 'history')
  server.failDelete = true
  await page.getByTestId('session-review').click({ button: 'right' })
  await page.getByRole('menuitem', { name: /删除/ }).click()
  await dialog.getByRole('button', { name: '删除会话', exact: true }).click()
  await expect(dialog).toContainText('请求失败')
  expect(server.sessions.has('review')).toBe(true)
  server.failDelete = false
  server.emitDeleteEvents = false
  await dialog.getByRole('button', { name: '删除会话', exact: true }).click()
  await expect(page.getByTestId('session-review')).toHaveCount(0)
  await expect(page.getByTestId('chat-design')).toBeVisible()
  expect(errors).toEqual([])
})

test('conversation outline locates a prompt and returns to the latest messages', async () => {
  server.messages.set(
    'design',
    Array.from({ length: 36 }, (_, index) =>
      fixtureMessage(
        `outline-${index}`,
        index + 1,
        index % 2 === 0 ? `问题 ${index / 2 + 1}` : `回复 ${index}\n\n${'具体说明。'.repeat(60)}`,
        index % 2 === 0,
      ),
    ),
  )
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await chat.getByRole('button', { name: '会话大纲', exact: true }).click()
  const outline = chat.getByRole('complementary', { name: '大纲', exact: true })
  await outline.getByRole('searchbox').fill('问题 9')
  await outline.getByRole('button').filter({ hasText: '问题 9' }).click()
  await expect(outline).toHaveCount(0)
  await expect(chat.locator('.message-anchor.is-located')).toContainText('问题 9')
  await expect(chat.getByRole('button', { name: '回到最新消息' })).toBeVisible()
  await chat.getByRole('button', { name: '回到最新消息' }).click()
  await expect
    .poll(() =>
      chat.locator('.transcript').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(3)
  expect(errors).toEqual([])
})

test('file panel can be resized with pointer and keyboard and keeps its preferred width', async () => {
  await page.getByTestId('session-design').click()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const divider = page.getByRole('separator', { name: '调整文件栏宽度' })
  const panel = page.locator('.file-panel')
  const before = (await panel.boundingBox())!.width
  const handle = (await divider.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 100)
  await page.mouse.down()
  await page.mouse.move(handle.x - 100, handle.y + 100, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeGreaterThan(before + 90)
  await divider.focus()
  const dragged = Number(await divider.getAttribute('aria-valuenow'))
  await page.keyboard.press('ArrowRight')
  await expect(divider).toHaveAttribute('aria-valuenow', String(dragged - 20))
  const saved = (await panel.boundingBox())!.width
  await page.reload()
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(saved, 0)
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  const split = page.getByRole('separator', { name: '双栏分屏', exact: true })
  const panes = (await page.locator('.panes').boundingBox())!
  const splitBox = (await split.boundingBox())!
  await page.mouse.move(splitBox.x + 3, splitBox.y + 50)
  await page.mouse.down()
  await page.mouse.move(panes.x + panes.width * 0.6, splitBox.y + 50, { steps: 8 })
  await page.mouse.up()
  await expect(split).toHaveAttribute('aria-valuenow', '60')
  await split.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(split).toHaveAttribute('aria-valuenow', '58')
  await page.reload()
  await expect(split).toHaveAttribute('aria-valuenow', '58')
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(saved, 0)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await expect.poll(async () => Number(await divider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(280)
  expect(await page.locator('.content-area').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 940))
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(saved, 0)
  await split.dblclick()
  await expect(split).toHaveAttribute('aria-valuenow', '50')
  expect(errors).toEqual([])
})

test('outline loads earlier pages, preserves the reading anchor and ignores a canceled history response', async () => {
  server.messagePageSize = 20
  server.messages.set(
    'design',
    Array.from({ length: 60 }, (_, index) =>
      fixtureMessage(
        `paged-${index}`,
        index + 1,
        index % 2 === 0 ? `历史问题 ${index / 2 + 1}` : `历史回复 ${index}`,
        index % 2 === 0,
      ),
    ),
  )
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const transcript = chat.locator('.transcript')
  await chat.getByRole('button', { name: '会话大纲', exact: true }).click()
  const outline = chat.getByRole('complementary', { name: '大纲', exact: true })
  await outline.getByRole('searchbox').fill('历史问题 21')
  await outline.getByRole('button').filter({ hasText: '历史问题 21' }).click()
  const anchor = chat.locator('.message-anchor.is-located')
  const before = await anchor.evaluate(
    (el) => el.getBoundingClientRect().top - el.closest('.transcript')!.getBoundingClientRect().top,
  )
  await chat.getByRole('button', { name: '会话大纲', exact: true }).click()
  await outline.getByRole('button', { name: '加载更早', exact: true }).click()
  await expect(outline.getByRole('button').filter({ hasText: '历史问题 11' })).toBeVisible()
  expect(
    await anchor.evaluate(
      (el) => el.getBoundingClientRect().top - el.closest('.transcript')!.getBoundingClientRect().top,
    ),
  ).toBeCloseTo(before, 0)
  server.failHistory = true
  await outline.getByRole('button', { name: '加载更早', exact: true }).click()
  await expect(transcript.getByRole('alert')).toBeVisible()
  server.failHistory = false
  let release!: () => void
  server.historyGate = new Promise((resolve) => {
    release = resolve
  })
  const requests = server.messagePageRequests.length
  await outline.getByRole('button', { name: '加载更早', exact: true }).click()
  await expect.poll(() => server.messagePageRequests.length).toBeGreaterThan(requests)
  await page.keyboard.press('Escape')
  await chat.getByRole('button', { name: '回到最新消息' }).click()
  release()
  await expect
    .poll(() => transcript.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThan(3)
  await expect(chat.locator('.is-located')).toHaveCount(0)
  await expect(chat.getByRole('button', { name: '回到最新消息' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('return to latest reloads the tail after older history evicts recent messages', async () => {
  server.messagePageSize = 200
  server.messages.set(
    'design',
    Array.from({ length: 900 }, (_, index) =>
      fixtureMessage(`window-${index}`, index + 1, `窗口消息 ${index + 1}`, true),
    ),
  )
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await chat.getByRole('button', { name: '会话大纲', exact: true }).click()
  const outline = chat.getByRole('complementary', { name: '大纲', exact: true })
  for (const first of [681, 481, 281, 81]) {
    await outline.getByRole('button', { name: '加载更早', exact: true }).click()
    await expect(
      outline
        .getByRole('button')
        .filter({ hasText: `窗口消息 ${first}` })
        .first(),
    ).toBeVisible()
  }
  await expect(chat.locator('.transcript').getByText('窗口消息 900', { exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await chat.getByRole('button', { name: '回到最新消息' }).click()
  await expect(chat.locator('.transcript').getByText('窗口消息 900', { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      chat.locator('.transcript').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(3)
  expect(errors).toEqual([])
})

test('web exploration groups distinguish reads, searches and mutations, update live and follow the collapse setting', async () => {
  const start = Date.now() - 5000
  const messages: ReturnType<typeof fixtureMessage>[] = [
    {
      ...fixtureMessage('explore-request', 1, '检查项目文件', true),
      createdAt: start - 1000,
      invokedAt: start - 1000,
    },
  ]
  const read = { type: 'read', command: 'cat package.json', name: 'package.json', path: '/repo/package.json' }
  const list = { type: 'listFiles', command: 'ls src', path: 'src' }
  for (const [index, action] of [read, list].entries()) {
    messages.push(
      fixtureCodexEvent(
        `explore-${index}`,
        index + 2,
        {
          type: 'tool-call',
          callId: `explore-${index}`,
          name: 'CodexBash',
          input: { command: action.command, command_actions: [action], command_source: 'agent' },
        },
        start + index * 1000,
      ),
    )
  }
  server.messages.set('design', messages)
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const exploration = chat.locator('[data-presentation="codex-exploration"]')
  const toggle = exploration.getByRole('button', { name: /^正在探索|^已探索/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toContainText('开始')
  await expect(toggle).toContainText('耗时')
  await toggle.click()
  await exploration.getByRole('button', { name: /读取 package.json/ }).click()
  await expect(page.getByRole('dialog')).toContainText('cat package.json')
  await page.keyboard.press('Escape')
  await expect(exploration.getByRole('button', { name: /列出 src/ })).toBeVisible()
  for (let index = 0; index < 2; index++) {
    const message = fixtureCodexEvent(
      `explore-result-${index}`,
      messages.length + 1,
      {
        type: 'tool-call-result',
        callId: `explore-${index}`,
        output: { stdout: `文件内容 ${index}`, exit_code: 0 },
      },
      start + 3000 + index * 1000,
    )
    messages.push(message)
    server.emit({ type: 'message-received', sessionId: 'design', message })
  }
  await expect(toggle).toContainText('已探索')
  await expect(toggle).toContainText('结束')
  await expect(toggle).toContainText('4.0s')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const moreEvents = [
    {
      type: 'tool-call',
      callId: 'search',
      name: 'CodexBash',
      input: {
        command: 'rg cursor src',
        command_actions: [{ type: 'search', command: 'rg cursor src', query: 'cursor', path: 'src' }],
      },
    },
    {
      type: 'tool-call-result',
      callId: 'search',
      output: { stdout: 'src/pagination.ts:cursor', exit_code: 0 },
    },
    {
      type: 'tool-call',
      callId: 'edit',
      name: 'Edit',
      input: { file_path: '/repo/src/pagination.ts', old_string: 'before', new_string: 'after' },
    },
    { type: 'tool-call-result', callId: 'edit', output: 'Updated' },
    { type: 'tool-call', callId: 'build', name: 'Bash', input: { command: 'bun run build' } },
    { type: 'tool-call-result', callId: 'build', output: 'Build failed', is_error: true },
  ]
  for (const data of moreEvents) {
    const message = fixtureCodexEvent(`more-${messages.length}`, messages.length + 1, data)
    messages.push(message)
    server.emit({ type: 'message-received', sessionId: 'design', message })
  }
  await expect(exploration).toHaveCount(1)
  await expect(exploration.getByRole('button', { name: /搜索.*cursor/ })).toBeVisible()
  const operations = chat.locator('[data-presentation="default"]')
  await expect(operations).toHaveCount(1)
  await expect(operations).toContainText('编辑 1')
  await expect(operations).toContainText('执行 1')
  await expect(operations).toContainText('错误 1')
  await operations.getByRole('button', { expanded: false }).click()
  await operations.getByRole('button', { name: /bun run build/ }).click()
  await expect(page.getByRole('dialog')).toContainText('Build failed')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('checkbox', { name: '探索记录默认收起' }).click()
  await expect(page.getByRole('checkbox', { name: '探索记录默认收起' })).not.toBeChecked()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  server.messages.set('review', messages)
  await page.getByTestId('session-review').click()
  const otherToggle = page.getByTestId('chat-review').getByRole('button', { name: /^已探索/ })
  await expect(otherToggle).toHaveAttribute('aria-expanded', 'true')
  await toggle.click()
  await expect(otherToggle).toHaveAttribute('aria-expanded', 'true')
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await otherToggle.scrollIntoViewIfNeeded()
  await expect(otherToggle).toBeInViewport()
  await expect(
    page.getByTestId('chat-review').getByRole('button', { name: /读取 package.json/ }),
  ).toBeInViewport()
  expect(errors).toEqual([])
})

test('opening a partial exploration group loads older tools without losing the open group or scroll anchor', async () => {
  const messages = [fixtureMessage('older-question', 1, '搜索前的问题', true)]
  for (let index = 0; index < 6; index++) {
    messages.push(
      fixtureCodexEvent(`history-read-${index}`, messages.length + 1, {
        type: 'tool-call',
        callId: `read-${index}`,
        name: 'CodexBash',
        input: {
          command: `cat file-${index}.ts`,
          command_actions: [
            {
              type: 'read',
              command: `cat file-${index}.ts`,
              name: `file-${index}.ts`,
              path: `/repo/file-${index}.ts`,
            },
          ],
        },
      }),
    )
    messages.push(
      fixtureCodexEvent(`history-result-${index}`, messages.length + 1, {
        type: 'tool-call-result',
        callId: `read-${index}`,
        output: `文件 ${index}`,
      }),
    )
  }
  server.messages.set('design', messages)
  server.messagePageSize = 4
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const group = chat.locator('[data-presentation="codex-exploration"]')
  await group.getByRole('button', { name: /^已探索/ }).click()
  await expect(group.getByRole('button', { name: /读取 file-0.ts/ })).toBeVisible()
  await expect(group.getByRole('button', { name: /读取 file-5.ts/ })).toBeVisible()
  await expect(group).toHaveCount(1)
  await expect(group.getByRole('button', { name: /^已探索/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(chat.getByText('搜索前的问题', { exact: true })).toBeVisible()
  expect(server.messagePageRequests.filter((request) => request.beforeSeq !== null).length).toBeGreaterThan(1)
  await group.getByRole('button', { name: /读取 file-0.ts/ }).click()
  await expect(page.getByRole('dialog')).toContainText('文件 0')
  await page.keyboard.press('Escape')
  await chat.getByRole('button', { name: '回到最新消息' }).click()
  await expect
    .poll(() =>
      chat.locator('.transcript').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(3)
  expect(errors).toEqual([])
})

test('plans show their proposal and progress without opening a tool disclosure, including restored history', async () => {
  const codex = server.sessions.get('design')!
  codex.collaborationMode = 'plan'
  codex.agentState!.codexPlanProposalId = 'codex-proposed-plan:proposal'
  const events = [
    {
      type: 'plan_update',
      plan: [
        { step: '检查工作区结构', status: 'completed' },
        { step: '实现计划展示', status: 'in_progress' },
      ],
    },
    {
      type: 'tool-call',
      name: 'ExitPlanMode',
      callId: 'codex-proposed-plan:proposal',
      input: { plan: '# 可实施的计划\n\n1. 复用现有消息组件\n2. 验证恢复后的完整计划' },
    },
    { type: 'tool-call-result', callId: 'codex-proposed-plan:proposal', output: null },
  ]
  server.messages.set(
    'design',
    events.map((data, index) => ({
      ...fixtureMessage(`plan-${index}`, index + 1, ''),
      content: { role: 'agent', content: { type: 'codex', data: { ...data, id: `plan-${index}` } } },
    })),
  )
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await expect(chat.getByRole('heading', { name: '可实施的计划' })).toBeVisible()
  await expect(chat.getByText('检查工作区结构', { exact: false })).toBeVisible()
  await expect(chat.getByText('实现计划展示', { exact: false })).toBeVisible()
  await expect(chat.getByText('验证恢复后的完整计划', { exact: true })).toBeVisible()
  await chat.getByRole('button', { name: '继续讨论计划', exact: true }).click()
  await expect(chat.getByRole('textbox', { name: '发送消息…' })).toBeFocused()
  await expect(chat.getByRole('heading', { name: '可实施的计划' })).toBeVisible()
  await page.reload()
  await expect(chat.getByRole('heading', { name: '可实施的计划' })).toBeVisible()
  const claude = server.sessions.get('review')!
  claude.agentState!.requests = {
    'approve-plan': {
      tool: 'ExitPlanMode',
      toolCallId: 'claude-plan',
      createdAt: Date.now(),
      arguments: { plan: '# 待确认的 Claude 计划\n\n确认后执行步骤' },
    },
  }
  await page.getByTestId('session-review').click()
  const review = page.getByTestId('chat-review')
  await expect(
    review.locator('.approval-area').getByRole('heading', { name: '待确认的 Claude 计划' }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test('outline navigation and live message following stay independent between panes', async () => {
  for (const id of ['design', 'review']) {
    server.messages.set(
      id,
      Array.from({ length: 30 }, (_, index) =>
        fixtureMessage(`same-${index}`, index + 1, `${id} 问题 ${index + 1}`, true),
      ),
    )
  }
  await page.getByTestId('session-design').click()
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  const left = page.getByTestId('chat-design')
  const right = page.getByTestId('chat-review')
  const rightTop = await right.locator('.transcript').evaluate((el) => el.scrollTop)
  await left.getByRole('button', { name: '会话大纲', exact: true }).click()
  const outline = left.getByRole('complementary', { name: '大纲', exact: true })
  await outline.getByRole('searchbox').fill('design 问题 8')
  await outline.getByRole('button').filter({ hasText: 'design 问题 8' }).click()
  await expect(left.locator('.is-located')).toContainText('design 问题 8')
  expect(await right.locator('.transcript').evaluate((el) => el.scrollTop)).toBeCloseTo(rightTop, 0)
  const readingTop = await left.locator('.transcript').evaluate((el) => el.scrollTop)
  for (const id of ['design', 'review']) {
    const message = fixtureMessage('live-31', 31, `${id} 新回复`)
    server.messages.get(id)!.push(message)
    server.emit({ type: 'message-received', sessionId: id, message })
  }
  await expect(right.getByText('review 新回复', { exact: true })).toBeInViewport()
  await expect(left.getByText('design 新回复', { exact: true })).toHaveCount(1)
  expect(await left.locator('.transcript').evaluate((el) => el.scrollTop)).toBeCloseTo(readingTop, 0)
  await left.getByRole('button', { name: '回到最新消息' }).click()
  await expect(left.getByText('design 新回复', { exact: true })).toBeInViewport()
  // A queued scroll event can arrive after asynchronous content growth, before
  // ResizeObserver. It must not be mistaken for the reader scrolling upward.
  await left.locator('.transcript').evaluate((el) => {
    const spacer = document.createElement('div')
    spacer.style.height = '180px'
    el.firstElementChild!.append(spacer)
    el.dispatchEvent(new Event('scroll'))
  })
  await expect
    .poll(() =>
      left.locator('.transcript').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(3)
  // Content growth after a render also follows the latest message in this pane.
  server.displayMedia(
    'design',
    'follow-image',
    'follow.png',
    'image/png',
    await readFile('resources/icon.png'),
  )
  await expect
    .poll(() =>
      left.getByRole('img', { name: 'follow.png' }).evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      left.locator('.transcript').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    )
    .toBeLessThan(3)
  expect(errors).toEqual([])
})

test('HAPI display tools preview images, play media and save exact file bytes', async () => {
  await page.getByTestId('session-design').click()
  const png = await readFile('resources/icon.png')
  // A synthetic one-second 16x16 VP8 video; no external media or runtime encoder needed.
  const video = Buffer.from(
    'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIxEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEfTbuMU6uEHFO7a1OsggIb7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNTguNDUuMTAwV0GNTGF2ZjU4LjQ1LjEwMESJiECPQAAAAAAAFlSua8KuAQAAAAAAADnXgQFzxYhkHXKudPvW+pyBACK1nIN1bmSGhVZfVlA4g4EBI+ODhB3NZQDgAQAAAAAAAAawgRC6gRASVMNnQJlzcwEAAAAAAAAnY8CAZ8gBAAAAAAAAGkWjh0VOQ09ERVJEh41MYXZmNTguNDUuMTAwc3MBAAAAAAAAXmPAi2PFiGQdcq50+9b6Z8gBAAAAAAAAIUWjh0VOQ09ERVJEh5RMYXZjNTguOTEuMTAwIGxpYnZweGfIokWjiERVUkFUSU9ORIeUMDA6MDA6MDEuMDAwMDAwMDAwAAAfQ7Z12OeBAKO8gQAAgLACAJ0BKhAAEAAARwiFhYiFhIgCAgJ1qgP4Agz9KAD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5WBAfQAsQEABRCsABgAGFgv9AAIAAAcU7trkbuPs4EAt4r3gQHxggG+8IED',
    'base64',
  )
  const audio = Buffer.alloc(8044, 128)
  audio.write('RIFF', 0)
  audio.writeUInt32LE(8036, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(8000, 24)
  audio.writeUInt32LE(8000, 28)
  audio.writeUInt16LE(1, 32)
  audio.writeUInt16LE(8, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(8000, 40)
  const binary = Buffer.from([0, 255, 128, 10, 13, 65, 66])
  server.displayMedia('design', 'inline-png', 'preview.png', 'image/png', png)
  const imageCard = page.getByRole('article', { name: 'preview.png', exact: true })
  await expect
    .poll(() =>
      imageCard
        .getByRole('img', { name: 'preview.png' })
        .evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await imageCard.getByRole('img', { name: 'preview.png' }).click()
  await expect(page.getByRole('dialog', { name: 'preview.png' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'preview.png' })).toHaveCount(0)
  server.displayMedia('design', 'inline-video', 'clip.webm', 'video/webm', video)
  server.displayMedia('design', 'inline-audio', 'sound.wav', 'audio/wav', audio)
  server.displayMedia('design', 'inline-file', 'report.bin', 'application/octet-stream', binary)
  const videoCard = page.getByRole('article', { name: 'clip.webm', exact: true })
  const audioCard = page.getByRole('article', { name: 'sound.wav', exact: true })
  const fileCard = page.getByRole('article', { name: 'report.bin', exact: true })
  await expect(fileCard).toBeVisible()
  expect(
    server.requests.filter((r) => /generated-images\/inline-(video|audio|file)$/.test(r.path)),
  ).toHaveLength(0)
  await videoCard.getByRole('button', { name: '加载视频' }).click()
  await audioCard.getByRole('button', { name: '加载音频' }).click()
  for (const media of [videoCard.locator('video'), audioCard.locator('audio')]) {
    await expect
      .poll(() => media.evaluate((el) => (el as HTMLMediaElement).readyState))
      .toBeGreaterThanOrEqual(2)
    await media.evaluate(async (el) => {
      const m = el as HTMLMediaElement
      m.muted = true
      await m.play()
      m.pause()
    })
  }
  const output = join(dataDirectory, 'report.bin')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, output)
  await fileCard.getByRole('button', { name: '下载文件' }).click()
  await expect(fileCard.getByRole('status')).toHaveText('文件已保存')
  expect(await readFile(output)).toEqual(binary)
  const imageOutput = join(dataDirectory, 'preview.png')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, imageOutput)
  await imageCard.getByRole('button', { name: '下载文件' }).click()
  await expect(imageCard.getByRole('status')).toHaveText('文件已保存')
  expect(await readFile(imageOutput)).toEqual(png)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('button', { name: 'README.md', exact: true }).click()
  const textOutput = join(dataDirectory, 'README.md')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, textOutput)
  await page.locator('.file-preview').getByRole('button', { name: '下载文件' }).click()
  await expect(page.locator('.file-preview').getByRole('status')).toHaveText('文件已保存')
  expect(await readFile(textOutput, 'utf8')).toBe('# HAPI Desktop\n\nA workspace for remote agents.\n')
  expect((await readdir(dataDirectory)).some((name) => name.startsWith('.hapi-download-'))).toBe(false)
  expect(errors).toEqual([])
})

test('HAPI media errors can be retried; cancellation and write failure leave no saved file', async () => {
  await page.getByTestId('session-design').click()
  server.displayMedia('design', 'missing-png', 'later.png', 'image/png')
  const card = page.getByRole('article', { name: 'later.png' })
  await expect(card.getByRole('alert')).toContainText('文件不可用')
  server.generatedMedia.set('missing-png', {
    mimeType: 'image/png',
    content: await readFile('resources/icon.png'),
  })
  await card.getByRole('button', { name: '重试', exact: true }).click()
  await expect
    .poll(() =>
      card.getByRole('img', { name: 'later.png' }).evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await electron.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
  const before = server.requests.filter((r) => r.path.includes('/generated-images/')).length
  await card.getByRole('button', { name: '下载文件' }).click()
  await expect(card.getByRole('button', { name: '下载文件' })).toBeEnabled()
  expect(server.requests.filter((r) => r.path.includes('/generated-images/'))).toHaveLength(before)
  await expect(card.getByText('文件已保存')).toHaveCount(0)
  const existing = join(dataDirectory, 'keep-original.png')
  await writeFile(existing, 'original-file')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, existing)
  server.generatedMedia.delete('missing-png')
  await card.getByRole('button', { name: '下载文件' }).click()
  await expect(card.getByRole('alert')).toContainText('文件不可用')
  expect(await readFile(existing, 'utf8')).toBe('original-file')
  server.generatedMedia.set('missing-png', {
    mimeType: 'image/png',
    content: await readFile('resources/icon.png'),
  })
  await electron.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    },
    join(dataDirectory, 'missing', 'file.png'),
  )
  await card.getByRole('button', { name: '下载文件' }).click()
  await expect(card.getByRole('alert')).toContainText('无法保存文件')
  expect((await readdir(dataDirectory)).some((name) => name.startsWith('.hapi-download-'))).toBe(false)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await expect(card.getByRole('button', { name: '下载文件' })).toBeVisible()
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('HAPI downloads cannot cross a disconnect while the native save dialog is open', async () => {
  const output = join(dataDirectory, 'must-not-save.bin')
  server.generatedMedia.set('private-file', {
    content: Buffer.from('fixture-private-file'),
    mimeType: 'application/octet-stream',
  })
  await electron.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () =>
      new Promise((resolve) => {
        ;(globalThis as unknown as { finishSaveDialog: typeof resolve }).finishSaveDialog = resolve
      })
  })
  const pending = page.evaluate(() =>
    window.desktop.saveFile({
      source: { kind: 'generated', sessionId: 'design', imageId: 'private-file' },
      fileName: '../../private.bin',
    }),
  )
  await expect
    .poll(() =>
      electron.evaluate(
        () => typeof (globalThis as unknown as { finishSaveDialog?: unknown }).finishSaveDialog,
      ),
    )
    .toBe('function')
  await page.evaluate(() => window.desktop.disconnect())
  await electron.evaluate((_electron, filePath) => {
    ;(
      globalThis as unknown as { finishSaveDialog: (result: { canceled: boolean; filePath: string }) => void }
    ).finishSaveDialog({ canceled: false, filePath })
  }, output)
  expect(await pending).toMatchObject({ ok: false, error: { code: 'CONNECTION_CHANGED' } })
  expect(server.requests.some((r) => r.path.includes('/generated-images/private-file'))).toBe(false)
  await expect(stat(output)).rejects.toThrow()
})

test('two panes, isolated drafts, read-only files, approvals, rename and secure bridge', async () => {
  await page.getByTestId('session-design').click()
  const first = page.getByTestId('chat-design')
  await expect(first.getByText('会话始终在手边', { exact: true })).toBeVisible()
  await first.getByRole('textbox', { name: '发送消息…' }).fill('左侧的独立草稿')
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  const second = page.getByTestId('chat-review')
  await second.getByRole('textbox', { name: '发送消息…' }).fill('右侧的独立草稿')
  await expect(first.getByRole('textbox')).toHaveValue('左侧的独立草稿')
  await expect(second.getByRole('textbox')).toHaveValue('右侧的独立草稿')
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('button', { name: 'README.md', exact: true }).click()
  await expect(page.locator('.file-preview')).toContainText('A workspace for remote agents.')
  await page.getByRole('button', { name: '变更', exact: true }).click()
  await page.locator('.file-row[data-path="src/main.ts"]').first().click()
  await expect(page.locator('.unified-diff')).toContainText('+const hub = connectHub()')
  const review = server.sessions.get('review')!
  review.agentState = {
    requests: {
      'request-map-key': {
        tool: 'Bash',
        toolCallId: 'unrelated-tool-call',
        arguments: { command: 'bun test', description: '运行测试' },
        createdAt: Date.now(),
      },
    },
  }
  review.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await expect(second.locator('.approval-area')).toContainText('bun test')
  await second.getByRole('button', { name: '允许', exact: true }).click()
  await expect
    .poll(() => server.requests.filter((r) => r.path.includes('/permissions/')).map((r) => r.path))
    .toContain('/api/sessions/review/permissions/request-map-key/approve')
  await expect(second.locator('.approval-area')).toBeEmpty()
  await second.getByRole('button', { name: '重命名', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('连接与恢复 · 审查完成')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(second.locator('h1')).toHaveText('连接与恢复 · 审查完成')
  expect(
    await page.evaluate(() => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      token: (window.desktop as unknown as { token?: string }).token,
      storage: JSON.stringify({ ...localStorage, ...sessionStorage }),
    })),
  ).toEqual({ node: 'undefined', token: undefined, storage: expect.not.stringContaining('fixture-secret') })
  const blocked = await page.evaluate(() =>
    window.desktop.request({ path: 'https://evil.example/api/sessions', method: 'GET' }),
  )
  expect(blocked.ok).toBe(false)
  expect(
    await electron.evaluate(({ BrowserWindow }) => {
      const p = (
        BrowserWindow.getAllWindows()[0].webContents as unknown as {
          getLastWebPreferences: () => Electron.WebPreferences
        }
      ).getLastWebPreferences()
      return [p.contextIsolation, p.sandbox, p.nodeIntegration]
    }),
  ).toEqual([true, true, false])
  await first.getByRole('textbox').fill('')
  await second.getByRole('textbox').fill('')
  await page.getByRole('button', { name: '变更', exact: true }).click()
  await page.locator('.file-row[data-path="src/main.ts"]').first().click()
  await expect(page.locator('.unified-diff')).toContainText('+const hub = connectHub()')
  const startedAt = Date.now() - 5200
  const completedAt = Date.now() - 200
  for (const message of [
    {
      id: 'tool-start',
      seq: 3,
      localId: null,
      createdAt: startedAt,
      content: {
        role: 'agent',
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            uuid: 'tool-start',
            timestamp: new Date(startedAt).toISOString(),
            message: {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: 'test-command', name: 'Bash', input: { command: 'bun test' } },
              ],
            },
          },
        },
      },
    },
    {
      id: 'tool-end',
      seq: 4,
      localId: null,
      createdAt: completedAt,
      content: {
        role: 'agent',
        content: {
          type: 'output',
          data: {
            type: 'user',
            uuid: 'tool-end',
            timestamp: new Date(completedAt).toISOString(),
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'test-command', content: 'All checks passed' }],
            },
          },
        },
      },
    },
  ]) {
    server.messages.get('review')!.push(message)
    server.emit({ type: 'message-received', sessionId: 'review', message })
  }
  await expect(second.getByTestId('tool-execution-times')).toContainText('5.0s')
  await page.screenshot({ path: 'build/desktop-preview.png', animations: 'disabled' })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: '主题', exact: true }).selectOption('dark')
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'build/desktop-dark-preview.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('uncertain delivery stays local until checked; resumed IDs migrate; closing hides without aborting', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  server.failSend = 'accepted'
  await chat.getByRole('textbox').fill('确认只发送一次')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '检查送达状态' })).toBeVisible()
  await page.reload()
  await expect(chat.getByRole('button', { name: '检查送达状态' })).toBeVisible()
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/design/messages' && r.method === 'POST'),
  ).toHaveLength(1)
  await chat.getByRole('button', { name: '检查送达状态' }).click()
  await expect(chat.getByRole('textbox')).toHaveValue('')
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/design/messages' && r.method === 'POST'),
  ).toHaveLength(1)
  server.failSend = 'absent'
  await chat.getByRole('textbox').fill('明确重试这条消息')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '检查送达状态' })).toBeVisible()
  await chat.getByRole('button', { name: '检查送达状态' }).click()
  server.failSend = 'none'
  await chat.getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(chat.getByRole('textbox')).toHaveValue('')
  const attempts = server.requests.filter(
    (r) => r.path === '/api/sessions/design/messages' && r.method === 'POST',
  )
  expect(attempts).toHaveLength(3)
  expect(attempts[1].body.localId).toBe(attempts[2].body.localId)
  await page.getByTestId('session-history').click()
  await page.getByTestId('chat-history').getByRole('textbox').fill('恢复并继续')
  await page.getByTestId('chat-history').getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByTestId('chat-resumed')).toBeVisible()
  expect(
    server.requests.some(
      (r) =>
        r.path === '/api/sessions/resumed/messages' && r.method === 'POST' && r.body.text === '恢复并继续',
    ),
  ).toBe(true)
  const aborts = server.requests.filter((r) => /\/(abort|archive)$/.test(r.path)).length
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  expect(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(
    false,
  )
  expect(server.streams.size).toBe(1)
  expect(server.requests.filter((r) => /\/(abort|archive)$/.test(r.path))).toHaveLength(aborts)
  // This is the same bridge event delivered by a native notification click.
  await electron.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.show()
    window.webContents.send('desktop:event', { type: 'open-session', sessionId: 'review' })
  })
  await expect(page.getByTestId('chat-review')).toBeVisible()
  expect(errors).toEqual([])
})

test('HAPI interactive questions preserve each provider answer contract', async () => {
  await page.getByTestId('session-design').click()
  await page.getByTestId('chat-design').getByRole('textbox').fill('回答后继续发送的草稿')
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '界面字号', exact: true }).selectOption('extra-large')
  await page.keyboard.press('Escape')
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  const codex = server.sessions.get('design')!
  codex.agentState = {
    requests: {
      'codex-question-request': {
        tool: 'request_user_input',
        toolCallId: 'codex-tool',
        createdAt: Date.now(),
        arguments: {
          questions: [
            {
              id: 'layout',
              question:
                '选择工作区布局\n\n需要同时处理多个远程 Linux 项目，并在不同会话之间检查工具调用、审批状态和执行结果。请根据窗口大小选择合适的布局。',
              options: [
                { label: '双栏', description: '同时查看两个会话' },
                { label: '单栏', description: '专注一个会话' },
                { label: '自动布局', description: '根据窗口大小调整布局，保留每个项目的草稿与滚动位置。' },
                {
                  label: '最后一个选项',
                  description: '完整说明：在窄窗口中也能阅读这段内容，滚动后可以选择。',
                },
              ],
            },
            { id: 'notes', question: '补充布局要求', options: [] },
          ],
        },
      },
    },
  }
  codex.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'design', data: codex })
  const first = page.getByTestId('chat-design')
  await expect(first.locator('.approval-area')).toContainText('选择工作区布局')
  const firstCard = first.locator('.pending-question')
  await expect(firstCard.locator('.markdown').first()).toHaveCSS('font-size', '15px')
  await expect(firstCard).toBeInViewport({ ratio: 1 })
  await expect(firstCard.getByRole('button', { name: '下一个 →', exact: true })).toBeInViewport({ ratio: 1 })
  await firstCard.getByRole('button', { name: /最后一个选项/ }).scrollIntoViewIfNeeded()
  await expect(firstCard.getByRole('button', { name: /最后一个选项/ })).toBeInViewport({ ratio: 1 })
  expect(await firstCard.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await firstCard.getByRole('button', { name: /最后一个选项/ }).click()
  await first.getByRole('button', { name: '收起问答', exact: true }).click()
  await expect(first.getByRole('textbox', { name: '发送消息…' })).toHaveValue('回答后继续发送的草稿')
  await first.getByRole('button', { name: '展开问答', exact: true }).click()
  await expect(firstCard.getByRole('button', { name: /最后一个选项/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await first.locator('.approval-area').getByRole('button', { name: /双栏/ }).click()
  await firstCard.getByRole('button', { name: '下一个 →', exact: true }).click()
  await expect(firstCard.getByText('补充布局要求')).toBeInViewport({ ratio: 1 })
  await firstCard.getByRole('textbox').fill('完整保留多题答案')
  await firstCard.getByRole('button', { name: '← 上一个', exact: true }).click()
  await expect(firstCard.getByRole('button', { name: /双栏/ })).toHaveAttribute('aria-pressed', 'true')
  await firstCard.getByRole('button', { name: '下一个 →', exact: true }).click()
  await expect(firstCard.getByRole('textbox')).toHaveValue('完整保留多题答案')
  await expect(firstCard.getByRole('button', { name: '提交', exact: true })).toBeInViewport({ ratio: 1 })
  await first.locator('.approval-area').getByRole('button', { name: '提交', exact: true }).click()
  await expect
    .poll(() => server.requests.find((r) => r.path.endsWith('/codex-question-request/approve'))?.body)
    .toEqual({
      answers: { layout: { answers: ['双栏'] }, notes: { answers: ['user_note: 完整保留多题答案'] } },
    })
  await expect(first.locator('.approval-area')).toBeEmpty()
  await expect(first.getByRole('textbox', { name: '发送消息…' })).toHaveValue('回答后继续发送的草稿')
  await page.getByTestId('session-review').click()
  const claude = server.sessions.get('review')!
  claude.agentState = {
    requests: {
      'claude-question-request': {
        tool: 'AskUserQuestion',
        toolCallId: 'claude-tool',
        createdAt: Date.now(),
        arguments: {
          questions: [
            {
              header: '验证',
              question:
                '需要验证哪些内容？\n\n请检查双栏、小窗口与特大字号的组合，确保可以阅读完整题目、滚动到最后一个选项，以及操作底部按钮。',
              multiSelect: true,
              options: [
                { label: '消息发送', description: '检查可靠送达' },
                { label: '交互问答', description: '检查答案格式' },
                { label: '文件预览', description: '确认完整内容不会被外层容器裁切，长路径也能阅读。' },
              ],
            },
            { header: '补充', question: '其他验证要求', options: [] },
          ],
        },
      },
    },
  }
  claude.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'review', data: claude })
  const second = page.getByTestId('chat-review')
  const secondCard = second.locator('.pending-question')
  await expect(
    secondCard
      .getByRole('checkbox', { name: /消息发送/ })
      .locator('span')
      .filter({ hasText: /^消息发送$/ })
      .last(),
  ).toHaveCSS('font-size', '15px')
  await expect(secondCard).toBeInViewport({ ratio: 1 })
  await expect(secondCard.getByRole('button', { name: '下一个 →', exact: true })).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: 'build/questions-small-preview.png', animations: 'disabled' })
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 850))
  await page.screenshot({ path: 'build/questions-preview.png', animations: 'disabled' })
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await second
    .locator('.approval-area')
    .getByRole('checkbox', { name: /消息发送/ })
    .click()
  await second
    .locator('.approval-area')
    .getByRole('checkbox', { name: /交互问答/ })
    .click()
  await secondCard.getByRole('checkbox', { name: /文件预览/ }).scrollIntoViewIfNeeded()
  await expect(secondCard.getByRole('checkbox', { name: /文件预览/ })).toBeInViewport({ ratio: 1 })
  await secondCard.getByRole('button', { name: '下一个 →', exact: true }).click()
  await secondCard.getByRole('radio', { name: /其他/ }).click()
  await secondCard.getByRole('textbox').fill('验证按钮始终可见')
  await expect(secondCard.getByRole('button', { name: '提交', exact: true })).toBeInViewport({ ratio: 1 })
  await second.locator('.approval-area').getByRole('button', { name: '提交', exact: true }).click()
  await expect
    .poll(() => server.requests.find((r) => r.path.endsWith('/claude-question-request/approve'))?.body)
    .toEqual({ answers: { '0': ['消息发送', '交互问答'], '1': ['验证按钮始终可见'] } })
  await expect(second.locator('.approval-area')).toBeEmpty()
  expect(errors).toEqual([])
})

test('message timestamps, copy and local share image export', async () => {
  await page.getByTestId('session-design').click()
  const message = page.getByTestId('chat-design').locator('.agent-message').first()
  await expect(message.locator('time')).toHaveAttribute('datetime', /T/)
  await expect(message.locator('time')).toContainText(/\d{2}:\d{2}:\d{2}/)
  await message.locator('.message-actions').getByRole('button', { name: '复制', exact: true }).click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('### 会话始终在手边')
  await message.getByRole('button', { name: '分享', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('会话始终在手边', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '复制', exact: true }).last().click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readImage().isEmpty()), { timeout: 20_000 })
    .toBe(false)
  const size = await electron.evaluate(({ clipboard }) => clipboard.readImage().getSize())
  expect(size.width).toBeGreaterThan(500)
  expect(size.height).toBeGreaterThan(300)
  const exportPath = resolve('build/message-share-preview.png')
  await rm(exportPath, { force: true })
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await dialog.getByRole('button', { name: '下载', exact: true }).click()
  await expect.poll(async () => (await stat(exportPath).catch(() => null))?.size ?? 0).toBeGreaterThan(1000)
  expect(errors).toEqual([])
})

test('Enter preference persists and respects newline, Shift+Enter, shortcuts and IME composition', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const input = chat.getByRole('textbox')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const setting = page.getByRole('combobox', { name: '回车键行为', exact: true })
  await expect(setting).toHaveValue('newline')
  await page.keyboard.press('Escape')
  await input.fill('第一行')
  await input.press('Enter')
  await input.press('a')
  await expect(input).toHaveValue('第一行\na')
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(0)
  await input.press('Control+Enter')
  await expect(input).toHaveValue('')
  expect(server.requests.find((r) => r.method === 'POST' && r.path.endsWith('/messages'))?.body.text).toBe(
    '第一行\na',
  )
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await setting.selectOption('send')
  await page.keyboard.press('Escape')
  await expect(chat.locator('.composer-toolbar')).toContainText('Shift+Enter 换行')
  await page.reload()
  await expect(chat.locator('.composer-toolbar')).toContainText('Shift+Enter 换行')
  await input.fill('输入法候选')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 })
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true })
  await input.press('Shift+Enter')
  await input.press('b')
  await expect(input).toHaveValue('输入法候选\nb')
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(1)
  await input.press('Enter')
  await expect(input).toHaveValue('')
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(2)
  expect(errors).toEqual([])
})

test('font size updates both panes and settings remain usable at the minimum window size', async () => {
  await page.getByTestId('session-design').click()
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  const message = page.getByTestId('chat-design').locator('.markdown p').first()
  const before = await message.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const commandButtons = page.locator('.composer').getByRole('button', { name: '原生命令', exact: true })
  for (const button of await commandButtons.all()) await expect(button).toHaveCSS('font-size', '12px')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  for (const [size, scale] of [
    ['small', 0.875],
    ['large', 1.125],
    ['extra-large', 1.25],
  ] as const) {
    await page.getByRole('combobox', { name: '界面字号', exact: true }).selectOption(size)
    await page.keyboard.press('Escape')
    for (const button of await commandButtons.all()) {
      await expect(button).toHaveCSS('font-size', `${12 * scale}px`)
      await expect(button).toHaveCSS('font-weight', '500')
      expect(
        await button.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight),
      ).toBe(true)
    }
    await expect(message).toHaveCSS('font-size', `${before * scale}px`)
    if (size === 'extra-large')
      await page.screenshot({ path: 'build/buttons-large-preview.png', animations: 'disabled' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
  }
  await expect
    .poll(() => message.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThan(before)
  await page.getByRole('combobox', { name: '回车键行为', exact: true }).selectOption('send')
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: '回车键行为', exact: true }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('combobox', { name: '回车键行为', exact: true })).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.height).toBeLessThanOrEqual(640)
  await page.keyboard.press('Escape')
  await expect(page.locator('.composer-toolbar').filter({ hasText: 'Shift+Enter 换行' })).toHaveCount(2)
  await page.reload()
  await expect
    .poll(() => message.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThan(before)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '界面字号', exact: true })).toHaveValue('extra-large')
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 850))
  await page.screenshot({ path: 'build/preferences-preview.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('thinking section excludes idle and background sessions, unread updates persist and history is muted', async () => {
  const design = server.sessions.get('design')!
  const review = server.sessions.get('review')!
  await page.getByTestId('session-review').click()
  const designRow = page.getByTestId('session-design')
  await expect(designRow).toHaveAttribute('data-status', 'ready')
  await expect(designRow.locator('.session-ready-icon')).toBeVisible()
  await expect(page.locator('.session-unread-badge')).toHaveCount(0)
  const historyRow = page.getByTestId('session-history')
  await expect(page.getByTestId('sessions-history')).not.toContainText('LINUX-DEV-01', { ignoreCase: true })
  await expect(page.getByTestId('sessions-history').locator('.group-machine')).toHaveCount(0)
  await expect(page.locator('.brand .version')).toHaveText(appVersion)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const defaultCollapse = page.getByRole('checkbox', { name: '默认折叠历史工作区' })
  await expect(page.getByRole('dialog')).toContainText(`HAPI Desktop ${appVersion}`)
  await defaultCollapse.click()
  await expect(defaultCollapse).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(historyRow).toBeHidden()
  await page.reload()
  await expect(historyRow).toBeHidden()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(defaultCollapse).toBeChecked()
  await defaultCollapse.click()
  await expect(defaultCollapse).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(historyRow).toBeVisible()
  await expect(historyRow).toHaveAttribute('data-status', 'history')
  expect(await historyRow.locator('.session-copy').evaluate((el) => getComputedStyle(el).color)).not.toBe(
    await designRow.locator('.session-copy').evaluate((el) => getComputedStyle(el).color),
  )
  const historyGroup = page.getByTestId('sessions-history').getByRole('button', { name: /折叠工作区/ })
  await expect(historyGroup).toHaveAttribute('aria-expanded', 'true')
  await historyGroup.click()
  await expect(historyRow).toBeHidden()
  await expect(
    page.getByTestId('sessions-history').getByRole('button', { name: /展开工作区/ }),
  ).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(historyRow).toBeHidden()
  await page.getByRole('textbox', { name: '搜索会话' }).fill('OpenCode')
  await expect(historyRow).toBeVisible()
  await page.getByRole('textbox', { name: '搜索会话' }).fill('')
  await expect(historyRow).toBeHidden()
  await page
    .getByTestId('sessions-history')
    .getByRole('button', { name: /展开工作区/ })
    .focus()
  await page.keyboard.press('Enter')
  await expect(historyRow).toBeVisible()
  design.thinking = true
  design.updatedAt += 10
  server.emit({ type: 'session-updated', sessionId: 'design', data: design })
  const thinking = page.getByTestId('sessions-thinking')
  await expect(thinking.getByTestId('session-design')).toBeVisible()
  await expect(thinking.getByTestId('session-review')).toHaveCount(0)
  await expect(thinking.getByTestId('session-history')).toHaveCount(0)
  await expect(page.getByTestId('sessions-active').getByTestId('session-review')).toBeVisible()
  await expect(page.getByTestId('sessions-history').getByTestId('session-history')).toBeVisible()
  await expect(page.getByTestId('sessions-history')).toContainText('/home/dev/hapi-desktop')
  design.thinking = false
  design.updatedAt += 10
  server.emit({
    type: 'session-updated',
    sessionId: 'design',
    data: { thinking: false, updatedAt: design.updatedAt },
  })
  await expect(thinking).toHaveCount(0)
  await expect(designRow).toHaveAttribute('data-status', 'ready')
  await expect(designRow.locator('.session-unread-badge')).toHaveText('新动态')
  await page.reload()
  await expect(designRow.locator('.session-unread-badge')).toHaveText('新动态')
  await designRow.click()
  await expect(designRow.locator('.session-unread-badge')).toHaveCount(0)
  review.backgroundTaskCount = 1
  review.updatedAt += 10
  server.emit({
    type: 'session-updated',
    sessionId: 'review',
    data: { backgroundTaskCount: 1, updatedAt: review.updatedAt },
  })
  await expect(page.getByTestId('session-review')).toHaveAttribute('data-status', 'background')
  await expect(thinking).toHaveCount(0)
  design.thinking = true
  design.updatedAt += 10
  server.emit({ type: 'session-updated', sessionId: 'design', data: design })
  await expect(thinking.getByTestId('session-design')).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const grouping = page.getByRole('checkbox', { name: '按状态分区显示会话' })
  await expect(grouping).toBeChecked()
  await grouping.click()
  await expect(grouping).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(thinking).toHaveCount(0)
  await expect(page.getByTestId('sessions-all').locator('.session-row')).toHaveCount(3)
  await page.reload()
  await expect(page.getByTestId('sessions-all').locator('.session-row')).toHaveCount(3)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(grouping).not.toBeChecked()
  await grouping.click()
  await expect(grouping).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(thinking.getByTestId('session-design')).toBeVisible()
  review.backgroundTaskCount = 0
  review.updatedAt += 10
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await expect(page.getByTestId('session-review').locator('.session-unread-badge')).toHaveText('新动态')
  await page.screenshot({ path: 'build/session-status-preview.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('session metadata and server-backed settings follow Codex, Claude and OpenCode capabilities', async () => {
  const design = server.sessions.get('design')!
  design.model = 'fixture-codex'
  design.modelReasoningEffort = 'high'
  design.createdAt = new Date('2026-09-20T08:10:00Z').getTime()
  design.updatedAt = new Date('2026-09-21T09:20:00Z').getTime()
  server.failModelDiscovery = true
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await expect(chat.getByTestId('createdAt')).toHaveAttribute('datetime', '2026-09-20T08:10:00.000Z')
  await expect(chat.getByTestId('updatedAt')).toHaveAttribute('datetime', '2026-09-21T09:20:00.000Z')
  await expect(chat.locator('.session-mode-summary')).toContainText('思考强度: high')
  await chat.getByRole('button', { name: '会话设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '会话设置' })
  const model = dialog.getByRole('combobox', { name: '模型', exact: true })
  const permission = dialog.getByRole('combobox', { name: '权限模式' })
  const effort = dialog.getByRole('combobox', { name: '思考强度' })
  const mode = dialog.getByRole('combobox', { name: '模式', exact: true })
  await mode.selectOption('plan')
  await expect(mode).toHaveValue('plan')
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/design/collaboration-mode').at(-1)?.body,
  ).toEqual({ mode: 'plan' })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(model).toBeDisabled()
  await expect(model.locator('option')).not.toContainText(['Sonnet'])
  server.failModelDiscovery = false
  await dialog.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(model).toBeEnabled()
  await expect(effort.locator('option')).toHaveText(['默认', '低', '高', '超高'])
  await model.selectOption('fixture-fast')
  await expect(model).toHaveValue('fixture-fast')
  await expect(effort.locator('option')).toContainText(['中'])
  await effort.selectOption('medium')
  await expect(effort).toHaveValue('medium')
  await permission.selectOption('read-only')
  await expect(permission).toHaveValue('read-only')
  expect(server.requests.filter((r) => r.path === '/api/sessions/design/model').at(-1)?.body).toEqual({
    model: 'fixture-fast',
  })
  expect(server.requests.filter((r) => r.path.endsWith('/model-reasoning-effort')).at(-1)?.body).toEqual({
    modelReasoningEffort: 'medium',
  })
  expect(server.requests.filter((r) => r.path.endsWith('/permission-mode')).at(-1)?.body).toEqual({
    mode: 'read-only',
  })
  server.failSetting = true
  await permission.selectOption('yolo')
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(permission).toHaveValue('read-only')
  server.failSetting = false
  await page.keyboard.press('Escape')
  design.modelReasoningEffort = 'low'
  design.updatedAt += 60_000
  server.emit({
    type: 'session-updated',
    sessionId: 'design',
    data: { modelReasoningEffort: 'low', updatedAt: design.updatedAt },
  })
  await expect(chat.locator('.session-mode-summary')).toContainText('思考强度: low')
  await expect(chat.getByTestId('updatedAt')).toHaveAttribute(
    'datetime',
    new Date(design.updatedAt).toISOString(),
  )
  await page.reload()
  await expect(chat.locator('.session-mode-summary')).toContainText('权限模式: 只读')
  await expect(chat.locator('.session-mode-summary')).toContainText('模式: 计划')
  await chat.getByRole('button', { name: '会话设置', exact: true }).click()
  await expect(effort).toHaveValue('low')
  await page.screenshot({ path: 'build/session-settings-preview.png', animations: 'disabled' })
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await expect(dialog).toBeInViewport({ ratio: 1 })
  await expect(effort).toBeInViewport({ ratio: 1 })
  await expect(dialog.locator('footer button')).toBeInViewport({ ratio: 1 })
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'normal', theme: 'light' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 940))
  await page.keyboard.press('Escape')

  await page.getByTestId('session-review').click()
  await page.getByTestId('chat-review').getByRole('button', { name: '会话设置', exact: true }).click()
  await expect(mode).toHaveCount(0)
  await model.selectOption('sonnet')
  await expect(model).toHaveValue('sonnet')
  await effort.selectOption('high')
  await expect(effort).toHaveValue('high')
  await permission.selectOption('acceptEdits')
  await expect(permission).toHaveValue('acceptEdits')
  expect(server.requests.filter((r) => r.path === '/api/sessions/review/effort').at(-1)?.body).toEqual({
    effort: 'high',
  })
  await effort.selectOption('')
  await expect(effort).toHaveValue('')
  expect(server.requests.filter((r) => r.path === '/api/sessions/review/effort').at(-1)?.body).toEqual({
    effort: null,
  })
  await page.keyboard.press('Escape')

  await page.getByTestId('session-history').click()
  const history = page.getByTestId('chat-history')
  await history.getByRole('button', { name: '会话设置', exact: true }).click()
  await expect(model).toBeDisabled()
  await expect(permission).toBeDisabled()
  await expect(dialog).toContainText('恢复会话后可修改设置。')
  const open = server.sessions.get('history')!
  open.active = true
  open.model = 'fixture/opencode'
  server.emit({ type: 'session-updated', sessionId: 'history', data: open })
  await expect(model).toBeEnabled()
  await expect(effort.locator('option')).toHaveText(['默认', 'Balanced', 'Deep'])
  await effort.selectOption('deep')
  await expect(effort).toHaveValue('deep')
  await model.selectOption('fixture/other')
  await expect(model).toHaveValue('fixture/other')
  await expect(effort.locator('option')).toContainText(['Minimal'])
  await expect(effort.locator('option[value="balanced"]')).toHaveCount(0)
  await permission.selectOption('plan')
  await expect(permission).toHaveValue('plan')
  expect(server.requests.filter((r) => r.path === '/api/sessions/history/model').at(-1)?.body).toEqual({
    model: 'fixture/other',
  })
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/history/model-reasoning-effort').at(-1)?.body,
  ).toEqual({ modelReasoningEffort: 'deep' })
  open.agentState = { ...open.agentState, controlledByUser: true }
  open.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'history', data: open })
  await expect(model).toBeDisabled()
  await expect(effort).toBeDisabled()
  await expect(dialog).toContainText('此会话由终端控制。')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'build/session-metadata-preview.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('queued messages show content, survive reload, steer without SSE and cancel by server message ID', async () => {
  server.holdMessages = true
  const session = server.sessions.get('design')!
  session.thinking = true
  session.agentState!.steeringActive = true
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'design', data: session })
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  for (const text of ['先检查状态', '优先处理这一条']) {
    await chat.getByRole('textbox').fill(text)
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect(chat.getByRole('textbox')).toHaveValue('')
  }
  const queue = chat.getByRole('region', { name: '排队消息', exact: true })
  await expect(queue).toContainText('排队消息（2）')
  await expect(queue.locator('.queue-text')).toHaveText(['先检查状态', '优先处理这一条'])
  await expect(chat.locator('.transcript')).not.toContainText('先检查状态')
  await page.reload()
  await expect(queue.locator('.queue-text')).toHaveText(['先检查状态', '优先处理这一条'])
  await page.screenshot({ path: 'build/queue-preview.png', animations: 'disabled' })
  server.emitQueueEvents = false
  const secondId = server.messages
    .get('design')!
    .find((m) => (m.content as { content?: { text?: string } }).content?.text === '优先处理这一条')!.id
  await queue
    .getByRole('listitem')
    .filter({ hasText: '优先处理这一条' })
    .getByRole('button', { name: '优先插入', exact: true })
    .click()
  await expect(queue.locator('.queue-text')).toHaveText(['先检查状态'])
  await expect(chat.locator('.transcript')).toContainText('优先处理这一条')
  expect(server.requests.some((r) => r.path === `/api/sessions/design/messages/${secondId}/steer`)).toBe(true)
  await queue.getByRole('button', { name: '取消排队消息', exact: true }).click()
  await expect(queue).toHaveCount(0)
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(2)
  expect(server.requests.filter((r) => r.path.endsWith('/abort'))).toHaveLength(0)
  expect(errors).toEqual([])
})

test('priority insertion respects provider capability, retains failed messages and explicitly retries unknown outcomes', async () => {
  server.holdMessages = true
  const session = server.sessions.get('design')!
  session.thinking = true
  session.agentState!.steeringActive = true
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'design', data: session })
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await chat.getByRole('textbox').fill('直接插入当前轮')
  await chat.locator('.composer').getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(chat.getByRole('textbox')).toHaveValue('')
  expect(
    server.requests.find((r) => r.method === 'POST' && r.path.endsWith('/messages'))?.body.deliveryMode,
  ).toBe('steer')
  await chat.getByRole('textbox').fill('需要保留的排队消息')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  const queue = chat.getByRole('region', { name: '排队消息', exact: true })
  server.steerOutcome = 'failed'
  await queue.getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(page.getByText('Turn already ended', { exact: true })).toBeVisible()
  await expect(queue).toContainText('需要保留的排队消息')
  server.steerOutcome = 'indeterminate'
  await queue.getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(queue.getByRole('button', { name: '重试发送', exact: true })).toBeVisible()
  await expect(queue.getByRole('button', { name: '优先插入', exact: true })).toHaveCount(0)
  await queue.getByRole('button', { name: '重试发送', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(queue.getByRole('button', { name: '优先插入', exact: true })).toBeEnabled()
  server.steerOutcome = 'invoked'
  server.emitQueueEvents = false
  await queue.getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(queue).toHaveCount(0)
  await page.getByTestId('session-review').click()
  const claude = page.getByTestId('chat-review')
  await claude.getByRole('textbox').fill('Claude 排队')
  await claude.getByRole('button', { name: '发送', exact: true }).click()
  await expect(claude.getByRole('region', { name: '排队消息', exact: true })).toContainText('Claude 排队')
  await expect(claude.getByRole('button', { name: '优先插入', exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('native commands discover project commands, autocomplete without sending and migrate shared clear results', async () => {
  server.commandEvents = true
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const input = chat.getByRole('textbox')
  const menu = chat.getByRole('region', { name: '原生命令', exact: true })
  await input.fill('/comp')
  await expect(menu.getByRole('button', { name: /\/compact/ })).toBeVisible()
  await input.press('Tab')
  await expect(input).toHaveValue('/compact ')
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(0)
  await input.press('Control+Enter')
  await expect(chat.locator('.event-message')).toContainText('Conversation compacted')
  expect(server.requests.find((r) => r.method === 'POST' && r.path.endsWith('/messages'))?.body.text).toBe(
    '/compact',
  )
  await input.fill('/project')
  await menu.getByRole('button', { name: /\/project-check/ }).click()
  await input.press('End')
  await input.press('a')
  await input.press('Control+Enter')
  await expect(input).toHaveValue('')
  expect(
    server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))[1].body.text,
  ).toBe('/project-check a')
  await expect(chat.locator('.event-message').last()).toContainText('Command result')
  await input.fill('gpt-example')
  await chat.locator('.composer').getByRole('button', { name: '原生命令', exact: true }).click()
  await menu.getByRole('button', { name: /^\/model / }).click()
  await expect(input).toHaveValue('/model gpt-example')
  await input.press('Control+Enter')
  await expect(input).toHaveValue('')
  expect(
    server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))[2].body.text,
  ).toBe('/model gpt-example')
  await input.fill('/')
  await expect(menu).toBeVisible()
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(input).toHaveValue(/^\/\S+ $/)
  const session = server.sessions.get('design')!
  session.metadata!.capabilities = { concurrentClients: true }
  session.metadataVersion++
  server.emit({ type: 'session-updated', sessionId: 'design', data: session })
  await input.fill('/clear')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByTestId('chat-cleared')).toBeVisible()
  expect(server.requests.filter((r) => r.path === '/api/sessions/design/clear')).toHaveLength(1)
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(3)
  expect(errors).toEqual([])
})

for (const [sessionId, flavor, command] of [
  ['review', 'Claude', '/compact'],
  ['history', 'OpenCode', '/init'],
]) {
  test(`${flavor} native commands use their own menu and survive session resume`, async () => {
    server.commandEvents = true
    await page.getByTestId(`session-${sessionId}`).click()
    const chat = page.getByTestId(`chat-${sessionId}`)
    await chat.getByRole('textbox').fill('/')
    const menu = chat.getByRole('region', { name: '原生命令', exact: true })
    await menu.getByRole('button', { name: new RegExp(`^${command} `) }).click()
    await expect(chat.getByRole('textbox')).toHaveValue(command + ' ')
    await chat.getByRole('textbox').press('Control+Enter')
    const target = sessionId === 'history' ? 'resumed' : sessionId
    const targetChat = page.getByTestId(`chat-${target}`)
    await expect(targetChat).toBeVisible()
    await expect(targetChat.locator('.event-message')).toContainText(
      command === '/compact' ? 'Conversation compacted' : 'Command result',
    )
    expect(
      server.requests.find((r) => r.method === 'POST' && r.path === `/api/sessions/${target}/messages`)?.body,
    ).toMatchObject({ text: command, deliveryMode: 'queue' })
    expect(errors).toEqual([])
  })
}

test('new sessions use the selected remote runner and safe default permissions', async () => {
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('目录', { exact: true }).fill('/home/dev/project')
  await dialog.getByRole('button', { name: '创建会话', exact: true }).click()
  await expect(page.getByTestId('chat-created')).toBeVisible()
  expect(server.requests.find((r) => r.path.endsWith('/spawn'))?.body).toMatchObject({
    directory: '/home/dev/project',
    agent: 'codex',
    permissionMode: 'default',
    yolo: false,
    startingMode: 'remote',
  })
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  const launch = page.getByRole('dialog', { name: '新建会话', exact: true })
  await launch
    .getByRole('group', { name: '模型', exact: true })
    .getByRole('combobox')
    .selectOption('fixture-codex')
  await launch.getByRole('group', { name: '模式', exact: true }).getByRole('combobox').selectOption('plan')
  await launch
    .getByRole('group', { name: '思考强度', exact: true })
    .getByRole('combobox')
    .selectOption('xhigh')
  await launch
    .getByRole('group', { name: '权限模式', exact: true })
    .getByRole('combobox')
    .selectOption('read-only')
  await launch
    .getByRole('group', { name: '快速模式', exact: true })
    .getByRole('combobox')
    .selectOption('fast')
  await launch.getByRole('button', { name: '浏览', exact: true }).click()
  const browser = page.getByRole('dialog', { name: '浏览文件夹', exact: true })
  await browser.getByRole('button', { name: /^project/ }).click()
  await expect(browser.getByRole('button', { name: 'notes.txt' })).toHaveCount(0)
  await browser.getByRole('button', { name: '选择此文件夹', exact: true }).click()
  await expect(launch.getByLabel('目录', { exact: true })).toHaveValue('/home/dev/project')
  await expect(launch.getByRole('group', { name: '模式', exact: true }).getByRole('combobox')).toHaveValue(
    'plan',
  )
  await launch.locator('#session-type-worktree').check()
  await launch
    .getByRole('group', { name: '会话类型', exact: true })
    .getByRole('textbox')
    .fill('desktop-feature')
  await page.screenshot({ path: 'build/new-session-codex-preview.png', animations: 'disabled' })
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large' }))
  await expect(launch.getByRole('button', { name: '创建会话', exact: true })).toBeInViewport({ ratio: 1 })
  await launch.getByRole('button', { name: '创建会话', exact: true }).click()
  await expect(page.getByTestId('chat-created-2')).toBeVisible()
  expect(server.requests.filter((r) => r.path.endsWith('/spawn')).at(-1)?.body).toMatchObject({
    directory: '/home/dev/project',
    agent: 'codex',
    model: 'fixture-codex',
    modelReasoningEffort: 'xhigh',
    permissionMode: 'read-only',
    collaborationMode: 'plan',
    serviceTier: 'fast',
    sessionType: 'worktree',
    worktreeName: 'desktop-feature',
  })
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'normal' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 850))
  for (const agent of ['claude', 'opencode']) {
    await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
    await launch.getByLabel('Agent', { exact: true }).selectOption(agent)
    await launch.getByLabel('目录', { exact: true }).fill('/home/dev/project')
    const model = launch.getByRole('group', { name: '模型', exact: true }).getByRole('combobox')
    const reasoning = launch.getByRole('group', { name: '思考强度', exact: true }).getByRole('combobox')
    await model.selectOption(agent === 'claude' ? 'sonnet' : 'fixture/opencode')
    await reasoning.selectOption(agent === 'claude' ? 'high' : 'deep')
    await expect(launch.getByRole('group', { name: '模式', exact: true })).toHaveCount(0)
    if (agent === 'opencode') {
      await model.selectOption('fixture/other')
      await expect(reasoning).toHaveCount(0)
      await model.selectOption('fixture/opencode')
      await reasoning.selectOption('deep')
    }
    await launch
      .getByRole('group', { name: '权限模式', exact: true })
      .getByRole('combobox')
      .selectOption('plan')
    await page.screenshot({ path: `build/new-session-${agent}-preview.png`, animations: 'disabled' })
    await launch.getByRole('button', { name: '创建会话', exact: true }).click()
    await expect(launch).toHaveCount(0)
    const sent = server.requests.filter((r) => r.path.endsWith('/spawn')).at(-1)!.body
    expect(sent).toMatchObject({
      agent,
      permissionMode: 'plan',
      model: agent === 'claude' ? 'sonnet' : 'fixture/opencode',
    })
    expect(sent[agent === 'claude' ? 'effort' : 'modelReasoningEffort']).toBe(
      agent === 'claude' ? 'high' : 'deep',
    )
    expect(sent.collaborationMode).toBeUndefined()
  }
  expect(errors).toEqual([])
})

test('archived session deletion confirms, preserves failed requests and cleans tabs and drafts', async () => {
  await page.getByTestId('session-design').click()
  await expect(
    page.getByTestId('chat-design').getByRole('button', { name: '删除会话', exact: true }),
  ).toHaveCount(0)
  await page.getByTestId('chat-design').getByRole('textbox').fill('保留其他会话草稿')
  await page.getByTestId('session-history').click()
  const history = page.getByTestId('chat-history')
  await history.getByRole('textbox').fill('删除时清理这条草稿')
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(localStorage).some((value) => String(value).includes('删除时清理这条草稿')),
      ),
    )
    .toBe(true)
  await history.getByRole('button', { name: '删除会话', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '删除此会话？' })
  await expect(confirm).toContainText('OpenCode · 历史会话')
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  expect(server.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0)
  await history.getByRole('button', { name: '删除会话', exact: true }).click()
  server.failDelete = true
  await confirm.getByRole('button', { name: '删除会话', exact: true }).click()
  await expect(confirm).toContainText('请求失败')
  await expect(history).toBeVisible()
  await expect(page.getByTestId('session-history')).toBeVisible()
  server.failDelete = false
  server.emitDeleteEvents = false
  await confirm.getByRole('button', { name: '删除会话', exact: true }).click()
  await expect(history).toHaveCount(0)
  await expect(page.getByTestId('session-history')).toHaveCount(0)
  await expect(page.getByTestId('chat-design')).toBeVisible()
  await expect(page.getByTestId('chat-design').getByRole('textbox')).toHaveValue('保留其他会话草稿')
  await page.reload()
  await expect(page.getByTestId('session-history')).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) => String(value).includes('删除时清理这条草稿')),
    ),
  ).toBe(false)
  const design = page.getByTestId('chat-design')
  await design.getByRole('button', { name: '归档', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '归档', exact: true }).click()
  await expect(design.getByRole('button', { name: '删除会话', exact: true })).toBeVisible()
  server.sessions.delete('design')
  server.emit({ type: 'session-removed', sessionId: 'design' })
  await expect(design).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) => String(value).includes('保留其他会话草稿')),
    ),
  ).toBe(false)
  expect(errors).toEqual([])
})

test('background notifications deduplicate and activate their session', async () => {
  await electron.evaluate(({ Notification }) => {
    Notification.isSupported = () => true
    const state = globalThis as unknown as { notices: Electron.Notification[] }
    state.notices = []
    Notification.prototype.show = function () {
      state.notices.push(this)
    }
  })
  await page.getByTestId('session-review').click()
  const review = server.sessions.get('review')!
  review.agentState = { requests: { visible: { tool: 'Bash', arguments: {}, createdAt: Date.now() } } }
  review.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await expect(page.getByTestId('chat-review').locator('.approval-area')).not.toBeEmpty()
  expect(
    await electron.evaluate(() => (globalThis as unknown as { notices: unknown[] }).notices.length),
  ).toBe(0)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  review.agentState.requests!.hidden = { tool: 'Bash', arguments: { command: 'test' }, createdAt: Date.now() }
  review.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await expect
    .poll(() => electron.evaluate(() => (globalThis as unknown as { notices: unknown[] }).notices.length))
    .toBe(1)
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await electron.evaluate(() =>
    (globalThis as unknown as { notices: Electron.Notification[] }).notices[0].emit('click'),
  )
  await expect(page.getByTestId('chat-review')).toBeVisible()
  expect(
    await electron.evaluate(() => (globalThis as unknown as { notices: unknown[] }).notices.length),
  ).toBe(1)
  expect(errors).toEqual([])
})

test('attachments support selection, file drop, image paste, ordering, drafts and attachment-only sends', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const binary = Buffer.alloc(7 * 1024 * 1024, 0xe7) // Base64 exceeds the former 8 MiB IPC limit.
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat
    .locator('input[type=file]')
    .setInputFiles({ name: 'binary.bin', mimeType: 'application/octet-stream', buffer: binary })
  await expect(chat.getByTestId('attachment-draft')).toContainText('待发送')
  expect([...server.uploads.values()][0].bytes.equals(binary)).toBe(true)
  await chat.locator('form').evaluate((form) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['文件拖入内容'], 'notes.txt', { type: 'text/plain' }))
    form.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  const png = await readFile('resources/icon.png')
  await chat.getByRole('textbox').evaluate(
    (input, bytes) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' }))
      input.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
      )
    },
    [...png],
  )
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(3)
  await expect(chat.getByTestId('attachment-draft').filter({ hasText: 'pasted.png' })).toContainText('待发送')
  await chat
    .getByTestId('attachment-draft')
    .filter({ hasText: 'pasted.png' })
    .getByRole('button', { name: '附件左移' })
    .click()
  await expect(chat.getByTestId('attachment-draft').nth(1)).toContainText('pasted.png')
  await expect(chat.getByTestId('attachment-draft').getByRole('status')).toHaveText([
    '待发送',
    '待发送',
    '待发送',
  ])
  await page.getByTestId('session-review').click()
  await expect(page.getByTestId('attachment-draft')).toHaveCount(0)
  await page.getByTestId('session-design').click()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(3)
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.getByTestId('session-review').click()
  await page.locator('.chat-pane').nth(0).getByRole('button', { name: '移动到另一栏' }).click()
  await page.getByTestId('session-design').click()
  const review = page.getByTestId('chat-review')
  await expect(review.getByRole('button', { name: '上传文件' })).toBeEnabled()
  await review
    .locator('input[type=file]')
    .setInputFiles({ name: 'other-pane.txt', mimeType: 'text/plain', buffer: Buffer.from('independent') })
  await expect(review.getByTestId('attachment-draft')).toContainText('待发送')
  // The Web draft store writes asynchronously; verify the durable snapshot
  // before asserting that reload reuses its remote paths without another upload.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('hapi-composer-drafts')
            open.onsuccess = () => {
              const request = open.result.transaction('attachments').objectStore('attachments').getAll()
              request.onsuccess = () => {
                open.result.close()
                resolve(request.result.flatMap((row) => row.files).filter((file) => file.path).length)
              }
              request.onerror = () => reject(request.error)
            }
            open.onerror = () => reject(open.error)
          }),
      ),
    )
    .toBe(4)
  await page.reload()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(3)
  await expect(chat.getByTestId('attachment-draft').nth(1)).toContainText('pasted.png')
  await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  expect(server.uploads.size).toBe(4)
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
  const sent = server.requests.filter(
    (r) => r.path === '/api/sessions/design/messages' && r.method === 'POST',
  )
  expect(sent).toHaveLength(1)
  expect(sent[0].body.text).toBe('')
  expect((sent[0].body.attachments as { filename: string }[]).map((a) => a.filename)).toEqual([
    'binary.bin',
    'pasted.png',
    'notes.txt',
  ])
  await expect(chat.locator('.transcript')).toContainText('binary.bin')
  await expect(chat.locator('.transcript').getByRole('img', { name: 'pasted.png' })).toBeVisible()
  await chat.locator('.transcript').getByRole('img', { name: 'pasted.png', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  expect(server.uploadDeletes).toEqual([]) // Sent files must remain available to the CLI.
  await expect(review.getByTestId('attachment-draft')).toContainText('other-pane.txt')
  await page.reload()
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('attachment errors can be retried or removed; late uploads are cleaned and compact controls fit', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  server.failUpload = true
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat
    .locator('input[type=file]')
    .setInputFiles({ name: 'retry.txt', mimeType: 'text/plain', buffer: Buffer.from('retry') })
  const draft = chat.getByTestId('attachment-draft')
  await expect(draft).toContainText('上传失败')
  await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeDisabled()
  server.failUpload = false
  await draft.getByRole('button', { name: '重试', exact: true }).click()
  await expect(draft).toContainText('待发送')
  const uploadedPath = [...server.uploads.keys()][0]
  await draft.getByRole('button', { name: '移除附件' }).click()
  await expect.poll(() => server.uploadDeletes).toContain(uploadedPath)
  let finish!: () => void
  server.uploadGate = new Promise((resolve) => {
    finish = resolve
  })
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat.locator('input[type=file]').setInputFiles({
    name: 'late.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from([0, 255, 7]),
  })
  await expect
    .poll(
      () =>
        server.requests.filter((r) => r.path.endsWith('/upload') && r.body.filename === 'late.bin').length,
    )
    .toBe(1)
  await draft.getByRole('button', { name: '移除附件' }).click()
  finish()
  server.uploadGate = null
  await expect.poll(() => server.uploadDeletes.length).toBe(2)
  await expect(draft).toHaveCount(0)
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat
    .locator('input[type=file]')
    .setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) })
  await expect(draft).toContainText('不能上传空文件')
  await draft.getByRole('button', { name: '移除附件' }).click()
  await chat.locator('form').evaluate((form) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'too-large.bin'))
    form.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(draft).toContainText('单个文件不能超过 50 MB')
  expect(server.requests.some((r) => r.body.filename === 'too-large.bin')).toBe(false)
  await draft.getByRole('button', { name: '移除附件' }).click()
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat.locator('input[type=file]').setInputFiles({
    name: 'long-filename-for-preview-and-layout-check.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('visible'),
  })
  await expect(draft).toContainText('待发送')
  await expect(draft.getByRole('button', { name: '移除附件' })).toBeInViewport()
  await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
  await expect(chat.getByRole('button', { name: '上传文件' })).toBeInViewport()
  expect(errors).toEqual([])
})

test('uncertain sends preserve attachments and priority mode across reload and receipt checks', async () => {
  const session = server.sessions.get('design')!
  session.thinking = true
  session.agentState!.steeringActive = true
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  server.failSend = 'absent'
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat
    .locator('input[type=file]')
    .setInputFiles({ name: 'priority.txt', mimeType: 'text/plain', buffer: Buffer.from('priority') })
  await expect(chat.getByTestId('attachment-draft')).toContainText('待发送')
  await chat.getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(chat.getByRole('button', { name: '检查送达状态' })).toBeVisible()
  await page.reload()
  await expect(chat.getByTestId('attachment-draft')).toContainText('priority.txt')
  await chat.getByRole('button', { name: '检查送达状态' }).click()
  server.failSend = 'none'
  await chat.getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
  const sends = server.requests.filter(
    (r) => r.path === '/api/sessions/design/messages' && r.method === 'POST',
  )
  expect(sends).toHaveLength(2)
  expect(sends[1].body).toEqual(sends[0].body)
  expect(sends[1].body.deliveryMode).toBe('steer')
  expect(server.uploads.size).toBe(1)
  server.failSend = 'accepted'
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat
    .locator('input[type=file]')
    .setInputFiles({ name: 'accepted.txt', mimeType: 'text/plain', buffer: Buffer.from('accepted') })
  await expect(chat.getByTestId('attachment-draft')).toContainText('待发送')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '检查送达状态' })).toBeVisible()
  await page.reload()
  await chat.getByRole('button', { name: '检查送达状态' }).click()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/design/messages' && r.method === 'POST'),
  ).toHaveLength(3)
  expect(server.uploadDeletes).toEqual([])
  expect(errors).toEqual([])
})

test('attachments follow resumed session IDs, remain separate in panes and are erased on logout', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat
    .locator('input[type=file]')
    .setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from('resume') })
  await expect(chat.getByTestId('attachment-draft')).toContainText('待发送')
  server.sessions.get('design')!.active = false
  server.emit({ type: 'session-updated', sessionId: 'design', data: server.sessions.get('design')! })
  await expect(chat.getByRole('button', { name: '恢复会话', exact: true })).toBeVisible()
  server.resumeRemovesSource = true
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  const resumed = page.getByTestId('chat-resumed')
  await expect(resumed).toBeVisible()
  await expect(resumed.locator('.transcript')).toContainText('resume.txt')
  const sent = server.requests.find(
    (r) => r.path === '/api/sessions/resumed/messages' && r.method === 'POST',
  )!
  expect(sent.body.attachments).toEqual([
    expect.objectContaining({ filename: 'resume.txt', path: expect.stringContaining('/resumed/') }),
  ])
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-history').click()
  // Selecting on an archived session resumes before upload, including a source-removed SSE event.
  server.sessions.get('resumed')!.active = true
  await expect(
    page.getByTestId('chat-history').getByRole('button', { name: '上传文件', exact: true }),
  ).toBeEnabled()
  await page
    .getByTestId('chat-history')
    .locator('input[type=file]')
    .setInputFiles({ name: 'archived.txt', mimeType: 'text/plain', buffer: Buffer.from('archived') })
  await expect(page.getByTestId('chat-resumed').getByTestId('attachment-draft')).toContainText('待发送')
  await expect(
    page.getByTestId('chat-resumed').getByRole('button', { name: '上传文件', exact: true }),
  ).toBeEnabled()
  await page
    .getByTestId('chat-resumed')
    .locator('input[type=file]')
    .setInputFiles({ name: 'private.txt', mimeType: 'text/plain', buffer: Buffer.from('logout draft') })
  await expect(page.getByTestId('chat-resumed').getByTestId('attachment-draft')).toHaveCount(2)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '断开并清除本机凭据', exact: true }).click()
  await expect(page.getByLabel('Hub 地址', { exact: true })).toBeVisible()
  expect(
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases()
      if (!dbs.some((db) => db.name === 'hapi-composer-drafts')) return 0
      return new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('hapi-composer-drafts')
        open.onsuccess = () => {
          const request = open.result.transaction('attachments').objectStore('attachments').count()
          request.onsuccess = () => {
            open.result.close()
            resolve(request.result)
          }
          request.onerror = () => reject(request.error)
        }
        open.onerror = () => reject(open.error)
      })
    }),
  ).toBe(0)
  expect(errors).toEqual([])
})

test('switching tabs during a send clears accepted attachments and pending uploads restore safely', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await expect(chat.getByRole('button', { name: '上传文件' })).toBeEnabled()
  await chat.locator('input[type=file]').setInputFiles({
    name: 'sent-in-background.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('background'),
  })
  await expect(chat.getByTestId('attachment-draft')).toContainText('待发送')
  let acknowledge!: () => void
  server.sendGate = new Promise((resolve) => {
    acknowledge = resolve
  })
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect
    .poll(
      () =>
        server.requests.filter((r) => r.path === '/api/sessions/design/messages' && r.method === 'POST')
          .length,
    )
    .toBe(1)
  await page.getByTestId('session-review').click()
  acknowledge()
  server.sendGate = null
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('desktop:outbox:'))),
    )
    .toEqual([])
  await page.getByTestId('session-design').click()
  await expect(chat.getByRole('button', { name: '上传文件' })).toBeEnabled()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
  expect(server.uploadDeletes).toEqual([])
  let finish!: () => void
  server.uploadGate = new Promise((resolve) => {
    finish = resolve
  })
  await chat.locator('input[type=file]').setInputFiles([
    { name: 'pending.txt', mimeType: 'text/plain', buffer: Buffer.from('pending') },
    { name: 'waiting.txt', mimeType: 'text/plain', buffer: Buffer.from('waiting') },
  ])
  await expect
    .poll(
      () =>
        server.requests.filter((r) => r.path.endsWith('/upload') && r.body.filename === 'pending.txt').length,
    )
    .toBe(1)
  await page.getByTestId('session-review').click()
  finish()
  server.uploadGate = null
  await expect.poll(() => server.uploadDeletes.length).toBeGreaterThan(0)
  await page.getByTestId('session-design').click()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(2)
  await expect(chat.getByTestId('attachment-draft').nth(0)).toContainText('待发送')
  await expect(chat.getByTestId('attachment-draft').nth(1)).toContainText('待发送')
  server.sessions.get('design')!.active = false
  await page.evaluate(() => window.desktop.request({ path: '/api/sessions/design', method: 'DELETE' }))
  await expect(chat).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        return new Promise<number>((resolve, reject) => {
          const open = indexedDB.open('hapi-composer-drafts')
          open.onsuccess = () => {
            const request = open.result.transaction('attachments').objectStore('attachments').getAllKeys()
            request.onsuccess = () => {
              open.result.close()
              resolve(request.result.filter((key) => String(key).endsWith(':design')).length)
            }
            request.onerror = () => reject(request.error)
          }
          open.onerror = () => reject(open.error)
        })
      }),
    )
    .toBe(0)
  expect(errors).toEqual([])
})

test('multiple large image attachments survive SSE and history reload without disconnecting', async () => {
  const png = await readFile('resources/icon.png')
  const image = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024 - png.length)])
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await expect(chat.getByRole('button', { name: '上传文件' })).toBeEnabled()
  await chat.locator('input[type=file]').setInputFiles(
    Array.from({ length: 4 }, (_, index) => ({
      name: `large-${index}.png`,
      mimeType: 'image/png',
      buffer: image,
    })),
  )
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(4)
  await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
  await expect(chat.locator('.transcript').getByRole('img', { name: /^large-/ })).toHaveCount(4)
  // A following event must also arrive on the same SSE connection.
  server.emit({
    type: 'message-received',
    sessionId: 'design',
    message: fixtureMessage('after-images', 4, '图片消息后的实时回复'),
  })
  await expect(chat.locator('.transcript')).toContainText('图片消息后的实时回复')
  expect(server.requests.filter((r) => r.path === '/api/events')).toHaveLength(1)
  await page.reload()
  await expect(chat.locator('.transcript').getByRole('img', { name: /^large-/ })).toHaveCount(4)
  expect(server.uploads.size).toBe(4)
  expect(server.uploadDeletes).toEqual([])
  expect(errors).toEqual([])
})

test('Hermes creation uses provider model IDs and native permissions, with manual/default fallback', async () => {
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  const launch = page.getByRole('dialog', { name: '新建会话', exact: true })
  await launch.getByLabel('Agent', { exact: true }).selectOption('hermes')
  await expect(launch.getByRole('group', { name: '思考强度', exact: true })).toHaveCount(0)
  await expect(launch.getByRole('group', { name: '模式', exact: true })).toHaveCount(0)
  await expect(launch.getByRole('group', { name: '快速模式', exact: true })).toHaveCount(0)
  const permissions = launch.getByRole('group', { name: '权限模式', exact: true }).getByRole('combobox')
  expect(
    await permissions
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value)),
  ).toEqual(['default', 'acceptEdits'])
  expect(server.hermesModelRequests).toEqual([])
  await launch.getByLabel('目录', { exact: true }).fill('/home/dev/project')
  const model = launch.getByRole('group', { name: '模型', exact: true })
  await expect(model.getByRole('button', { name: /custom:office:qwen:32b/ })).toBeEnabled()
  await model.getByRole('textbox', { name: '搜索供应商或模型' }).fill('home')
  await expect(model.getByRole('button', { name: /custom:office:qwen:32b/ })).toHaveCount(0)
  await model.getByRole('button', { name: /custom:home:qwen:32b/ }).click()
  await permissions.selectOption('acceptEdits')
  await model.getByRole('button', { name: '刷新模型' }).click()
  await expect
    .poll(() => server.hermesModelRequests.some((r) => r.cwd === '/home/dev/project' && r.refresh))
    .toBe(true)
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await expect(launch.getByRole('button', { name: '创建会话', exact: true })).toBeInViewport()
  await launch.getByRole('button', { name: '创建会话', exact: true }).click()
  await expect(page.getByTestId('chat-created')).toBeVisible()
  expect(server.requests.find((r) => r.path.endsWith('/spawn'))?.body).toEqual({
    directory: '/home/dev/project',
    agent: 'hermes',
    model: 'custom:home:qwen:32b',
    permissionMode: 'acceptEdits',
    sessionType: 'simple',
    startingMode: 'remote',
  })
  server.failHermesModels = true
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  await launch.getByLabel('Agent', { exact: true }).selectOption('hermes')
  await launch.getByLabel('目录', { exact: true }).fill('/home/dev/other')
  await expect(model.getByRole('alert')).toContainText('无法加载会话选项')
  await model.getByRole('textbox', { name: '模型', exact: true }).fill('custom:manual:my:model')
  await launch.getByRole('button', { name: '创建会话', exact: true }).click()
  await expect(page.getByTestId('chat-created-2')).toBeVisible()
  expect(server.requests.filter((r) => r.path.endsWith('/spawn')).at(-1)?.body).toEqual({
    directory: '/home/dev/other',
    agent: 'hermes',
    model: 'custom:manual:my:model',
    permissionMode: 'default',
    sessionType: 'simple',
    startingMode: 'remote',
  })
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  await launch.getByLabel('Agent', { exact: true }).selectOption('hermes')
  await launch.getByLabel('目录', { exact: true }).fill('/home/dev/third')
  await model.getByRole('textbox', { name: '模型', exact: true }).fill('custom:manual:model')
  await model.getByRole('button', { name: '使用 Hermes 默认配置' }).click()
  await launch.getByRole('button', { name: '创建会话', exact: true }).click()
  await expect(page.getByTestId('chat-created-3')).toBeVisible()
  expect(server.requests.filter((r) => r.path.endsWith('/spawn')).at(-1)?.body).toEqual({
    directory: '/home/dev/third',
    agent: 'hermes',
    permissionMode: 'default',
    sessionType: 'simple',
    startingMode: 'remote',
  })
  expect(errors).toEqual([])
})

test('Hermes settings refresh provider models, preserve failures and disable changes during a turn', async () => {
  const session = fixtureSession('hermes', 'Hermes 会话', 'hermes')
  session.model = 'custom:office:qwen:32b'
  session.metadata!.hermesSessionId = 'native-hermes'
  server.sessions.set(session.id, session)
  server.messages.set(session.id, [])
  server.emit({ type: 'session-added', sessionId: session.id, data: session })
  await page.getByTestId('session-hermes').click()
  const chat = page.getByTestId('chat-hermes')
  await chat.getByRole('button', { name: '会话设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '会话设置', exact: true })
  const homeModel = settings.getByRole('button', { name: /custom:home:qwen:32b/ })
  const officeModel = settings.getByRole('button', { name: /custom:office:qwen:32b/ })
  await expect(officeModel).toHaveAttribute('aria-pressed', 'true')
  await homeModel.click()
  await expect(homeModel).toHaveAttribute('aria-pressed', 'true')
  expect(server.requests.find((r) => r.path === '/api/sessions/hermes/model')?.body).toEqual({
    model: 'custom:home:qwen:32b',
  })
  await expect(settings.getByLabel('思考强度', { exact: true })).toHaveCount(0)
  server.failSetting = true
  await officeModel.click()
  await expect(settings.getByRole('alert')).toBeVisible()
  await expect(homeModel).toHaveAttribute('aria-pressed', 'true')
  await expect(officeModel).toBeDisabled()
  server.failSetting = false
  await settings.getByRole('button', { name: '刷新模型' }).click()
  await expect(officeModel).toBeEnabled()
  await expect
    .poll(() =>
      server.hermesModelRequests.some((r) => r.path === '/api/sessions/hermes/hermes-models' && r.refresh),
    )
    .toBe(true)
  await officeModel.click()
  await expect(officeModel).toHaveAttribute('aria-pressed', 'true')
  await settings.getByRole('combobox', { name: '权限模式', exact: true }).selectOption('acceptEdits')
  await expect(settings.getByRole('combobox', { name: '权限模式', exact: true })).toHaveValue('acceptEdits')
  session.thinking = true
  session.updatedAt += 1000
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
  await expect(settings).toContainText('请等待当前轮次结束后再修改设置')
  await expect(homeModel).toBeDisabled()
  await expect(settings.getByRole('combobox', { name: '权限模式', exact: true })).toBeDisabled()
  session.thinking = false
  session.updatedAt += 1000
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
  await expect(homeModel).toBeEnabled()
  server.failHermesModels = true
  await settings.getByRole('button', { name: '刷新模型' }).click()
  await expect(settings.getByRole('alert')).toContainText('无法加载会话选项')
  await expect(settings).not.toContainText('fixture internal details')
  await expect(homeModel).toHaveCount(0)
  await expect(settings).toContainText('custom:office:qwen:32b')
  server.failHermesModels = false
  await settings.getByRole('button', { name: '刷新模型' }).click()
  await expect(homeModel).toBeEnabled()
  await settings.locator('footer').getByRole('button', { name: '关闭', exact: true }).click()
  await page.reload()
  await expect(chat).toBeVisible()
  await chat.getByRole('button', { name: '会话设置', exact: true }).click()
  await expect(officeModel).toHaveAttribute('aria-pressed', 'true')
  await expect(settings.getByRole('combobox', { name: '权限模式', exact: true })).toHaveValue('acceptEdits')
  expect(errors).toEqual([])
})

test('Hermes supports commands, steering, native approval decisions and same-ID resume', async () => {
  const session = fixtureSession('hermes', 'Hermes 对话', 'hermes')
  session.metadata!.hermesSessionId = 'native-hermes'
  session.thinking = true
  session.agentState!.steeringActive = true
  server.sessions.set(session.id, session)
  server.messages.set(session.id, [])
  server.emit({ type: 'session-added', sessionId: session.id, data: session })
  await page.getByTestId('session-hermes').click()
  const chat = page.getByTestId('chat-hermes')
  await chat.getByRole('textbox', { name: '发送消息…' }).fill('/compress')
  await expect(chat.getByRole('region', { name: '原生命令' })).toContainText('/compress')
  await page.keyboard.press('Escape')
  await chat.getByRole('textbox', { name: '发送消息…' }).fill('/model custom:home:qwen:32b')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect
    .poll(() =>
      server.requests.some(
        (r) => r.path === '/api/sessions/hermes/messages' && r.body.text === '/model custom:home:qwen:32b',
      ),
    )
    .toBe(true)
  await chat.getByRole('textbox', { name: '发送消息…' }).fill('请优先检查日志')
  await chat.locator('.composer').getByRole('button', { name: '优先插入', exact: true }).click()
  await expect
    .poll(
      () =>
        server.requests
          .filter((r) => r.path === '/api/sessions/hermes/messages' && r.method === 'POST')
          .at(-1)?.body.deliveryMode,
    )
    .toBe('steer')
  session.agentState!.requests = {
    'hermes-approval': {
      tool: 'Edit',
      arguments: { file_path: '/home/dev/project/main.ts', old_string: 'old', new_string: 'new' },
      createdAt: Date.now(),
    },
  }
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
  const approval = chat.locator('.approval-area')
  await expect(approval.getByRole('button', { name: '是', exact: true })).toBeVisible()
  await approval.getByRole('button', { name: '是', exact: true }).click()
  expect(
    server.requests.find((r) => r.path === '/api/sessions/hermes/permissions/hermes-approval/approve')?.body,
  ).toEqual({ decision: 'approved' })
  session.active = false
  session.thinking = false
  session.updatedAt += 1000
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
  await expect(chat.getByRole('button', { name: '恢复会话', exact: true })).toBeVisible()
  await chat.getByRole('button', { name: '恢复会话', exact: true }).click()
  await expect(chat.getByRole('button', { name: '中断', exact: true })).toBeVisible()
  await chat.getByRole('textbox', { name: '发送消息…' }).fill('继续原 Hermes 对话')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.locator('.transcript')).toContainText('继续原 Hermes 对话')
  expect(server.requests.some((r) => r.path === '/api/sessions/hermes/resume')).toBe(true)
  expect(errors).toEqual([])
})

test('Hermes availability blocks unsupported machines and empty catalogs retain default creation', async () => {
  server.hermesAvailable = false
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  const launch = page.getByRole('dialog', { name: '新建会话', exact: true })
  await launch.getByLabel('Agent', { exact: true }).selectOption('hermes')
  await launch.getByLabel('目录', { exact: true }).fill('/home/dev/project')
  await expect(launch).toContainText('此机器上 Agent 不可用')
  await expect(launch.getByRole('button', { name: '创建会话', exact: true })).toBeDisabled()
  expect(server.hermesModelRequests).toEqual([])
  await page.keyboard.press('Escape')
  server.hermesAvailable = true
  server.emptyHermesModels = true
  await page.reload()
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  await launch.getByLabel('Agent', { exact: true }).selectOption('hermes')
  await launch.getByLabel('目录', { exact: true }).fill('/home/dev/project')
  const model = launch.getByRole('group', { name: '模型', exact: true })
  await expect(model).toContainText('没有匹配的模型')
  await model.getByRole('textbox', { name: '模型', exact: true }).fill('custom:office:qwen:32b')
  await launch.getByLabel('目录', { exact: true }).fill('/home/dev/other')
  await expect(model.getByRole('textbox', { name: '模型', exact: true })).toHaveValue('')
  await launch.getByRole('button', { name: '创建会话', exact: true }).click()
  await expect(page.getByTestId('chat-created')).toBeVisible()
  expect(server.requests.find((r) => r.path.endsWith('/spawn'))?.body).toEqual({
    directory: '/home/dev/other',
    agent: 'hermes',
    permissionMode: 'default',
    sessionType: 'simple',
    startingMode: 'remote',
  })
  expect(errors).toEqual([])
})

test('Markdown tables preserve alignment and scroll within a narrow chat pane', async () => {
  const markdown = [
    '| 左对齐 | 居中 | 右对齐 | 文件 | 说明 | 状态 | 最后一列 |',
    '| :--- | :---: | ---: | --- | --- | --- | --- |',
    '| a \\| b | **加粗** | 123.45 | `custom:office:qwen:32b` | [文档](https://example.com/guide) | 已完成 | 表格末尾 |',
  ].join('\n')
  server.messages.set('design', [fixtureMessage('table', 1, markdown)])
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const table = chat.getByRole('table')
  await expect(table.getByRole('cell')).toHaveCount(7)
  await expect(table.getByRole('cell').first()).toHaveText('a | b')
  await expect(table.getByRole('columnheader').nth(1)).toHaveCSS('text-align', 'center')
  await expect(table.getByRole('cell').nth(2)).toHaveCSS('text-align', 'right')
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  const wrapper = table.locator('..')
  await expect(wrapper).toHaveCSS('overflow-x', 'auto')
  await wrapper.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => wrapper.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  expect(await wrapper.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await wrapper.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  expect(await wrapper.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  expect(
    await chat.locator('.transcript').evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1)
  await chat.locator('.message-actions').getByRole('button', { name: '复制', exact: true }).click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(markdown)
  const tableWidth = await wrapper.evaluate((element) => element.scrollWidth)
  await chat.getByRole('button', { name: '分享', exact: true }).click()
  const share = page.getByRole('dialog')
  await share.getByRole('button', { name: '复制', exact: true }).last().click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readImage().getSize().width), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(tableWidth)
  await page.keyboard.press('Escape')
  // Web repairs short delimiter rows, but fenced examples must remain code.
  const malformed = '| A | B | C |\n| :--- | ---: |\n| x | y | z |'
  const followup = `${malformed}\n\n\`\`\`text\n${malformed}\n\`\`\``
  server.emit({
    type: 'message-received',
    sessionId: 'design',
    message: fixtureMessage('repaired-table', 2, followup),
  })
  await expect(chat.getByRole('table')).toHaveCount(2)
  await expect(chat.getByRole('table').last().getByRole('cell')).toHaveCount(3)
  await expect(chat.getByRole('table').last().getByRole('cell').last()).toHaveText('z')
  expect(errors).toEqual([])
})
