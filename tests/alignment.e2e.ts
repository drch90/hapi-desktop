import { test, expect, _electron, type ElectronApplication, type Page, type Locator } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FixtureHub, fixtureMessage, fixtureCodexEvent } from './fake-server'
import { closeTestElectron } from './electron-cleanup'
import { asyncQuestionId, asyncQuestionRequestId } from './fixtures/async-question'

let electron: ElectronApplication
let page: Page
let server: FixtureHub
let directory: string
let errors: string[]

test.beforeEach(async () => {
  server = new FixtureHub()
  const url = await server.start()
  directory = await mkdtemp(join(tmpdir(), 'hapi-alignment-'))
  electron = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${directory}`, resolve('out/main/index.js')],
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
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 960))
})

test.afterEach(async () => {
  try {
    await closeTestElectron(electron)
  } finally {
    await server?.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  }
})

function publishQuestion(id = asyncQuestionRequestId) {
  const session = server.sessions.get('design')!
  session.agentState = {
    ...session.agentState,
    requests: {
      [id]: {
        tool: 'request_user_input',
        toolCallId: id,
        createdAt: Date.now(),
        arguments: {
          isBlocking: false,
          questions: [
            {
              id: asyncQuestionId,
              question: '用户消息默认采用哪种显示方式？',
              isOther: true,
              options: [{ label: '按原文显示', description: '保留空格、Tab、换行及 # 等符号' }],
            },
          ],
        },
      },
    },
  }
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
}

async function expectColumnWidth(chat: Locator, target: Locator) {
  await expect(target).toBeVisible()
  await expect
    .poll(async () => {
      const pane = await chat.boundingBox()
      const box = await target.boundingBox()
      return Boolean(
        pane &&
        box &&
        box.width <= 824.5 &&
        box.x >= pane.x &&
        box.x + box.width <= pane.x + pane.width + 0.5,
      )
    })
    .toBe(true)
  expect(await target.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}

test('user text stays verbatim in chat, copying, expanded reading and reloads', async () => {
  const source =
    '# Python 注释保持原样\n  # 两个空格\n\tif enabled:\n\t    print("# literal")\n\n\n' +
    '**不是加粗**\n- 不是列表\n> 不是引用\n```python\n    # 围栏也保留原文\n```\n' +
    '[参考会话](/sessions/review)\n  trailing spaces  \n'
  server.messages.set('design', [
    fixtureMessage('literal-user', 1, source, true),
    fixtureMessage('markdown-agent', 2, '# Agent 标题\n\n**Agent 仍使用 Markdown**'),
  ])
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const message = chat.locator('.user-message')
  const literal = message.locator('.user-text-literal')
  await expect.poll(() => literal.innerText()).toBe(source)
  await expect(message.locator('h1, strong, ul, blockquote, [data-hapi-code-block]')).toHaveCount(0)
  await expect(chat.locator('.agent-message h1')).toHaveText('Agent 标题')
  await message.getByRole('button', { name: '复制', exact: true }).click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(source)
  await message.getByRole('button', { name: '放大阅读', exact: true }).click()
  await expect.poll(() => page.getByRole('dialog').locator('.user-text-literal').innerText()).toBe(source)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect.poll(() => literal.innerText()).toBe(source)
  await mkdir(resolve('build/upstream-alignment'), { recursive: true })
  await chat.screenshot({ path: 'build/upstream-alignment/user-text.png', animations: 'disabled' })
  await message.getByRole('link', { name: '[参考会话](/sessions/review)', exact: true }).click()
  await expect(page.getByTestId('chat-review')).toBeVisible()
  expect(errors).toEqual([])
})

test('queued messages, questions and scratchlist follow the article width in wide and split panes', async () => {
  const pending = {
    ...fixtureMessage('wide-queued', 2, '# 暂未发送\n  configs/' + 'long_path_'.repeat(30), true),
    localId: 'wide-queued-local',
    invokedAt: null,
  }
  server.messages.set('design', [fixtureMessage('article', 1, '会话正文'), pending])
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const queue = chat.locator('.queue-item')
  await expectColumnWidth(chat, queue)
  const articleWidth = (await chat.locator('.message-anchor').first().boundingBox())!.width
  expect((await queue.boundingBox())!.width).toBeLessThanOrEqual(articleWidth + 1)

  await chat.getByRole('button', { name: '查看暂存列表', exact: true }).click()
  const stored = chat.getByRole('region', { name: '暂存消息', exact: true })
  await expectColumnWidth(chat, stored.locator('.scratchlist-add'))
  await stored.getByRole('textbox', { name: '新增暂存消息' }).fill('暂存内容\n  # 缩进也保留')
  await stored.getByRole('button', { name: '保存到暂存列表' }).click()
  await expect(stored).toContainText('暂存内容')
  await expectColumnWidth(chat, stored.getByTestId('scratchlist-drawer'))
  await mkdir(resolve('build/upstream-alignment'), { recursive: true })
  await chat.screenshot({ path: 'build/upstream-alignment/queue-scratchlist.png', animations: 'disabled' })
  await chat.getByRole('button', { name: '关闭暂存列表', exact: true }).click()

  publishQuestion()
  await expectColumnWidth(chat, chat.locator('.pending-question'))
  expect((await chat.locator('.pending-question').boundingBox())!.width).toBeLessThanOrEqual(articleWidth + 1)
  await chat.screenshot({ path: 'build/upstream-alignment/question.png', animations: 'disabled' })
  await chat.getByRole('button', { name: '收起问答', exact: true }).click()
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 700))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await expectColumnWidth(chat, queue)
  await chat.getByRole('button', { name: '展开问答', exact: true }).click()
  await expectColumnWidth(chat, chat.locator('.pending-question'))
  await chat
    .locator('.pending-question')
    .getByRole('button', { name: /按原文显示/ })
    .click()
  await chat.locator('.pending-question').getByRole('button', { name: '提交', exact: true }).click()
  await expect(chat.locator('.pending-question')).toHaveCount(0)
  await queue.getByRole('button', { name: '取消排队消息', exact: true }).click()
  await expect(queue).toHaveCount(0)
  await chat.getByRole('button', { name: '查看暂存列表', exact: true }).click()
  await expectColumnWidth(chat, stored.locator('.scratchlist-add'))
  await expectColumnWidth(chat, stored.getByTestId('scratchlist-drawer'))
  await stored.getByRole('button', { name: '复制到输入框', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑暂存消息', exact: true })
  await expectColumnWidth(chat, editor)
  await expect(editor.getByRole('textbox')).toHaveValue('暂存内容\n  # 缩进也保留')
  await page.screenshot({ path: 'build/upstream-alignment/scratchlist-editor.png', animations: 'disabled' })
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 960))
  await expectColumnWidth(chat, editor)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('Codex async questions submit through IPC with their nested JSON IDs', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await chat.locator('.composer textarea').fill('回答后继续保留的草稿')
  publishQuestion()
  const card = chat.locator('.pending-question')
  await card.getByRole('button', { name: /按原文显示/ }).click()
  await card.getByRole('button', { name: '提交', exact: true }).click()
  const route = `/api/sessions/design/permissions/${encodeURIComponent(asyncQuestionRequestId)}`
  await expect
    .poll(() => server.requests.find((request) => request.path === `${route}/approve`)?.body)
    .toEqual({ answers: { [asyncQuestionId]: { answers: ['按原文显示'] } } })
  await expect(card).toHaveCount(0)
  await expect(chat.locator('.composer textarea')).toHaveValue('回答后继续保留的草稿')
  publishQuestion(asyncQuestionRequestId + '-dismiss')
  await expect(card).toBeVisible()
  // The existing question UI has no dismiss button; verify the companion
  // permission route directly through the same preload boundary.
  expect(
    await page.evaluate(
      (path) => window.desktop.request({ path, method: 'POST', body: {} }),
      `${route}-dismiss/deny`,
    ),
  ).toMatchObject({ ok: true })
  await expect
    .poll(() => server.requests.some((request) => request.path.endsWith('-dismiss/deny')))
    .toBe(true)
  await expect(card).toHaveCount(0)
  expect(server.requests.some((request) => request.path.endsWith('/abort'))).toBe(false)
  await expect(chat).not.toContainText('ACTION_FAILED')
  expect(errors).toEqual([])
})

test('compaction receipts wait without retry and compaction facts merge without duplication', async () => {
  const session = server.sessions.get('design')!
  session.metadata = { ...session.metadata!, name: undefined, promptTitle: '首条输入的临时标题' }
  session.agentState = { requests: {}, codexCompactionPendingMessageIds: ['compacting-local'] }
  session.thinking = true
  server.messages.set('design', [
    fixtureCodexEvent('compact-boundary', 1, {
      type: 'context_compacted',
      id: 'compact-1',
      pre_tokens: 8000,
    }),
    fixtureCodexEvent('compact-summary', 2, {
      type: 'compact-summary',
      compactionId: 'compact-1',
      summary: '保留原来的任务要求',
      tokensAfter: 1200,
    }),
    {
      ...fixtureMessage('compacting-message', 3, '压缩后继续处理', true),
      localId: 'compacting-local',
      invokedAt: null,
      deliveryState: 'indeterminate',
    },
  ])
  await page.reload()
  await expect(page.getByTestId('session-design')).toContainText('首条输入的临时标题')
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const queue = chat.getByRole('region', { name: '排队消息', exact: true })
  await expect(queue).toContainText('正在压缩上下文，等待消息接收确认。')
  await expect(queue.getByRole('button', { name: '重试发送', exact: true })).toHaveCount(0)
  await expect(chat.locator('.event-message')).toHaveCount(1)
  await expect(chat.locator('.event-message')).toContainText('8,000 → 1,200 tokens')
  await expect(chat.locator('.event-message')).toContainText('保留原来的任务要求')
  session.agentState!.codexCompactionPendingMessageIds = []
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
  await expect(queue.getByRole('button', { name: '重试发送', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

test('Claude discovery and effort changes match the runner catalog, with current fallback presets', async () => {
  server.claudeModels = [
    { value: 'default', effortLevels: ['medium'] },
    { value: 'claude-opus-4-8', displayName: 'Opus Current', effortLevels: ['high', 'max'] },
    { value: 'claude-opus-4-7', displayName: 'Opus Earlier', effortLevels: ['high'] },
    { value: 'haiku', displayName: 'Haiku Live', effortLevels: ['low'] },
  ]
  const review = server.sessions.get('review')!
  review.model = 'claude-opus-4-8'
  review.effort = 'max'
  await page.getByTestId('session-review').click()
  await page.getByTestId('chat-review').getByRole('button', { name: '会话设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '会话设置', exact: true })
  const models = settings.getByRole('combobox', { name: '模型', exact: true })
  await expect(models.locator('option[value="haiku"]')).toHaveText('Haiku Live')
  await expect(models.locator('optgroup[label="其他模型"] option')).toHaveText(['Opus Earlier'])
  await models.selectOption('haiku')
  await expect
    .poll(
      () => server.requests.filter((request) => request.path === '/api/sessions/review/model').at(-1)?.body,
    )
    .toEqual({ model: 'haiku', effort: null })
  const effort = settings.getByRole('combobox', { name: '思考强度', exact: true })
  await expect(effort).toHaveValue('')
  await expect(effort.locator('option')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  const launch = page.getByRole('dialog', { name: '新建会话', exact: true })
  await launch.getByLabel('Agent', { exact: true }).selectOption('claude')
  const launchModels = launch.getByRole('group', { name: '模型', exact: true }).getByRole('combobox')
  await expect(launchModels.locator('option[value="haiku"]')).toHaveText('Haiku Live')
  await launchModels.selectOption('claude-opus-4-8')
  const launchEffort = launch.getByRole('group', { name: '思考强度', exact: true }).getByRole('combobox')
  await launchEffort.selectOption('max')
  await launchModels.selectOption('haiku')
  await expect(launchEffort).toHaveValue('auto')
  await page.keyboard.press('Escape')
  server.failClaudeModels = true
  await page.reload()
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  await launch.getByLabel('Agent', { exact: true }).selectOption('claude')
  await expect
    .poll(() =>
      launchModels
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    )
    .toEqual(['auto', 'opus', 'fable', 'sonnet', 'haiku'])
  expect(errors).toEqual([])
})

test('shared Codex settings use live session models and the native Auto permission', async () => {
  const session = server.sessions.get('design')!
  session.metadata = { ...session.metadata!, capabilities: { concurrentClients: true } }
  await page.getByTestId('session-design').click()
  await page.getByTestId('chat-design').getByRole('button', { name: '会话设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '会话设置', exact: true })
  await expect
    .poll(() => server.requests.some((request) => request.path === '/api/sessions/design/codex-models'))
    .toBe(true)
  const permissions = settings.getByRole('combobox', { name: '权限模式', exact: true })
  await expect
    .poll(() =>
      permissions
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    )
    .toEqual(['default', 'read-only', 'autoReview', 'yolo'])
  await permissions.selectOption('autoReview')
  await expect
    .poll(() => server.requests.find((request) => request.path.endsWith('/permission-mode'))?.body)
    .toEqual({ mode: 'autoReview' })
  expect(errors).toEqual([])
})
