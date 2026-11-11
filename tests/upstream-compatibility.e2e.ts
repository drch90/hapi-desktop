import { mkdir } from 'node:fs/promises'
import type { Locator } from '@playwright/test'
import type { DecryptedMessage } from '@hapi/protocol'
import { test, expect } from './fixtures/desktop'
import { fixtureCodexEvent, fixtureMessage } from './fake-server'
import { asyncQuestionRequestId, publishAsyncQuestion, resolveAsyncQuestion } from './fixtures/async-question'

async function expectInPane(target: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 })
  expect(
    await target.evaluate((element) => {
      const pane = element.closest('.chat-pane')
      if (!pane) return false
      const rect = element.getBoundingClientRect()
      const bounds = pane.getBoundingClientRect()
      return rect.left >= bounds.left && rect.right <= bounds.right + 1
    }),
  ).toBe(true)
}

test('new pending delivery receipts keep queue actions locked through reload and preserve the draft', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const session = server.sessions.get('history')
  if (!session) throw new Error('Fixture session missing')
  session.active = true
  session.thinking = true
  session.agentState = { steeringActive: true }
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
  const message: DecryptedMessage = {
    ...fixtureMessage('pending-row', 1, '等待原生接收的追加', true),
    localId: 'pending-local',
    invokedAt: null,
    deliveryState: 'indeterminate',
    deliveryPending: true,
  }
  server.messages.set(session.id, [message])
  await page.getByTestId('session-history').click()
  const chat = page.getByTestId('chat-history')
  const input = chat.locator('.composer textarea')
  const queue = chat.getByRole('region', { name: '排队消息', exact: true })
  server.emit({
    type: 'messages-indeterminate',
    sessionId: session.id,
    localIds: ['pending-local'],
    dispatching: true,
  })
  await expect(queue).toContainText('正在插入，等待助手确认接收…')
  await input.fill('回执等待期间的草稿')
  await page.reload()
  await expect(input).toHaveValue('回执等待期间的草稿')
  await expect(queue.getByRole('button', { name: '编辑排队消息', exact: true })).toBeDisabled()
  await expect(queue.getByRole('button', { name: '取消排队消息', exact: true })).toBeDisabled()
  await expect(queue.getByRole('button', { name: '重试发送', exact: true })).toHaveCount(0)
  const invokedAt = Date.now()
  server.messages.set(session.id, [
    { ...message, invokedAt, deliveryState: undefined, deliveryPending: undefined, steered: true },
  ])
  server.emit({
    type: 'messages-consumed',
    sessionId: session.id,
    localIds: ['pending-local'],
    invokedAt,
    steered: true,
  })
  await expect(queue).toHaveCount(0)
  await expect(input).toHaveValue('回执等待期间的草稿')
  expect(
    server.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/messages')),
  ).toHaveLength(0)
  expect(errors).toEqual([])
})

test('async dismissal preserves answers on failure and stays locked pending cancellation in narrow translated panes', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  server.failPermission = true
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const card = chat.locator('.pending-question')
  await chat.locator('.composer textarea').fill('忽略问题也保留聊天草稿')
  publishAsyncQuestion(server)
  await card.getByRole('button', { name: /按原文显示/ }).click()
  await card.getByRole('textbox').fill('忽略失败时保留的备注')
  await card.getByRole('button', { name: '忽略', exact: true }).click()
  await expect(card.getByRole('alert')).toBeVisible()
  await expect(card.getByRole('textbox')).toHaveValue('忽略失败时保留的备注')
  server.failPermission = false
  server.holdPermissionResolution = true
  const dismiss = card.getByRole('button', { name: '忽略', exact: true })
  await dismiss.focus()
  await expect(dismiss).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(card.getByRole('status')).toHaveText('已请求忽略，正在等待 Agent 确认…')
  await expect(card.getByRole('button', { name: '已请求忽略', exact: true })).toBeDisabled()
  await expect(card.getByRole('button', { name: '提交', exact: true })).toBeDisabled()
  const path = `/api/sessions/design/permissions/${encodeURIComponent(asyncQuestionRequestId)}/deny`
  expect(server.requests.filter((request) => request.path === path)).toHaveLength(2)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'light' }))
  await expectInPane(card.getByRole('status'))
  await expectInPane(card.getByRole('button', { name: '已请求忽略', exact: true }))
  await mkdir('build/upstream-v0346', { recursive: true })
  await page.screenshot({ path: 'build/upstream-v0346/dismiss-single-light.png' })
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await page.evaluate(() => window.desktop.updateSettings({ locale: 'fr', theme: 'dark' }))
  await expect(card.getByRole('status')).toContainText('Annulation demandée')
  await expectInPane(card.getByRole('status'))
  await expectInPane(card.getByRole('button', { name: 'Annulation demandée', exact: true }))
  await page.screenshot({ path: 'build/upstream-v0346/dismiss-split-fr-dark.png' })
  resolveAsyncQuestion(server)
  await expect(card).toHaveCount(0)
  await expect(chat.locator('.composer textarea')).toHaveValue('忽略问题也保留聊天草稿')
  expect(errors).toEqual([])
})

test('restricted questions hide free text and support keyboard skip with server confirmation', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  const session = server.sessions.get('design')
  if (!session) throw new Error('Fixture session missing')
  const requestId = 'restricted-question'
  session.agentState = {
    requests: {
      [requestId]: {
        tool: 'AskUserQuestion',
        toolCallId: requestId,
        createdAt: Date.now(),
        arguments: {
          questions: [
            {
              question: '只能从给定选项选择',
              allowFreeText: false,
              options: [{ label: 'Alpha' }, { label: 'Beta' }],
            },
          ],
        },
      },
    },
  }
  session.agentStateVersion++
  server.holdPermissionResolution = true
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const card = chat.locator('.pending-question')
  await expect(card.getByRole('radio')).toHaveCount(2)
  await expect(card.getByRole('textbox')).toHaveCount(0)
  const option = card.getByRole('radio', { name: 'Alpha', exact: true })
  await option.focus()
  await expect(option).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card.getByRole('status')).toHaveText('已请求忽略，正在等待 Agent 确认…')
  expect(
    server.requests.filter(
      (request) => request.path === `/api/sessions/design/permissions/${requestId}/deny`,
    ),
  ).toHaveLength(1)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() =>
    window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'light', locale: 'fr' }),
  )
  await expectInPane(card.getByRole('button', { name: 'Annulation demandée', exact: true }))
  await page.getByRole('button', { name: 'Vue partagée', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await page.evaluate(() => window.desktop.updateSettings({ theme: 'dark' }))
  await expectInPane(card.getByRole('button', { name: 'Annulation demandée', exact: true }))
  await expectInPane(card.getByRole('button', { name: 'Submit', exact: true }))
  await mkdir('build/upstream-v0346', { recursive: true })
  await page.screenshot({ path: 'build/upstream-v0346/restricted-split-fr-dark.png' })
  resolveAsyncQuestion(server, requestId)
  await expect(card).toHaveCount(0)
  expect(errors).toEqual([])
})

test('gap recovery refreshes an older in-place OpenCode tool result through the context IPC route', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  const stale = fixtureCodexEvent(
    'tool-row',
    2,
    {
      type: 'tool-call',
      callId: 'shell-1',
      name: 'ls',
      nativeKind: 'execute',
      status: 'in_progress',
      input: { command: 'ls -la /tmp', description: '等待工具完成' },
    },
    200,
  )
  const intro = { ...fixtureMessage('intro', 1, '查看工具结果', true), createdAt: 100, invokedAt: 100 }
  server.messagePageSize = 20
  server.messages.set('history', [intro, stale])
  await page.getByRole('button', { name: '展开工作区: /home/dev/hapi-desktop', exact: true }).click()
  await page.getByTestId('session-history').click()
  const chat = page.getByTestId('chat-history')
  await expect(chat.getByText('等待工具完成', { exact: true })).toBeVisible()
  const completed = fixtureCodexEvent(
    'tool-row',
    2,
    {
      type: 'tool-call',
      callId: 'shell-1',
      name: 'ls',
      nativeKind: 'execute',
      status: 'completed',
      input: { command: 'ls -la /tmp', description: '读取已完成' },
    },
    200,
  )
  const result = fixtureCodexEvent(
    'tool-result',
    3,
    { type: 'tool-call-result', callId: 'shell-1', output: { output: 'README.md\npackage.json\nsrc\n' } },
    300,
  )
  const missed = Array.from({ length: 18 }, (_, index) => ({
    ...fixtureMessage(`missed-${index}`, index + 4, `断线期间消息 ${index + 1}`, true),
    createdAt: (index + 4) * 100,
    invokedAt: (index + 4) * 100,
  }))
  server.messages.set('history', [intro, completed, result, ...missed])
  server.messagePageSize = 2
  server.emit({ type: 'connection-changed', data: { status: 'connected', resume: 'gap' } })
  await expect
    .poll(
      () =>
        server.requests.filter(
          (request) => request.path === '/api/sessions/history/messages/tool-row/context',
        ).length,
    )
    .toBe(1)
  const title = chat.getByText('读取已完成', { exact: true })
  await title.scrollIntoViewIfNeeded()
  await expect(title).toBeVisible()
  await title.click()
  const details = chat
    .locator('.message-tool')
    .filter({ hasText: '读取已完成' })
    .locator('.tool-expanded-details')
  await expect(details).toBeVisible()
  await expect(details).toContainText('ls -la /tmp')
  const output = details.locator('[data-hapi-code-block]').filter({ hasText: 'README.md' })
  await expect(output.locator('[data-code-cell]')).toHaveText(['README.md', 'package.json', 'src'])
  await expect(details.locator('a').filter({ hasText: 'README.md' })).toHaveCount(0)
  await output.locator('[data-hapi-code-copy]').click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('README.md\npackage.json\nsrc\n')
  await mkdir('build/upstream-v0346', { recursive: true })
  await page.screenshot({ path: 'build/upstream-v0346/opencode-tool-result.png' })
  expect(errors).toEqual([])
})

for (const flavor of ['copilot', 'kimi'] as const) {
  test(`${flavor} exposes only the active model's discovered effort choices through IPC`, async ({
    desktop,
  }) => {
    const { page, server, errors } = desktop
    const session = server.sessions.get('history')
    if (!session?.metadata) throw new Error('Fixture session missing')
    session.active = true
    session.metadata.flavor = flavor
    session.model = 'first'
    session.metadataVersion++
    server.emit({ type: 'session-updated', sessionId: session.id, data: session })
    server.agentConfig.catalogs.set(`${flavor}-models`, {
      success: true,
      availableModels: [{ modelId: 'first' }, { modelId: 'second' }],
    })
    server.agentConfig.catalogs.set(`${flavor}-reasoning-effort-options`, {
      success: true,
      options: [{ value: 'high', name: 'High' }],
    })
    await page.getByTestId('session-history').click()
    await page.getByTestId('chat-history').getByRole('button', { name: '会话设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '会话设置', exact: true })
    const model = dialog.getByRole('combobox', { name: '模型', exact: true })
    const effort = dialog.getByRole('combobox', { name: '思考强度', exact: true })
    await expect(effort).toBeEnabled()
    await effort.selectOption('high')
    await expect(effort).toHaveValue('high')
    server.agentConfig.catalogs.set(`${flavor}-reasoning-effort-options`, {
      success: true,
      options: [{ value: 'low', name: 'Low' }],
    })
    await model.selectOption('second')
    await expect(effort.locator('option[value="high"]')).toHaveCount(0)
    await effort.selectOption('low')
    await expect(effort).toHaveValue('low')
    expect(
      server.requests.filter((request) => request.path.endsWith('/effort')).map((request) => request.body),
    ).toEqual([{ effort: 'high' }, { effort: 'low' }])
    expect(errors).toEqual([])
  })
}
