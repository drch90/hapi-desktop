import type { Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { test, expect, type DesktopFixture } from './fixtures/desktop'

async function openSession({ page, server }: DesktopFixture, agent: 'agy' | 'opencode') {
  const session = server.sessions.get('history')
  if (!session?.metadata) throw new Error('Steering fixture session missing')
  session.metadata = {
    ...session.metadata,
    flavor: agent,
    name: `${agent === 'agy' ? 'Antigravity' : 'OpenCode'} · 运行中追加`,
  }
  session.metadataVersion++
  session.permissionMode = agent === 'agy' ? 'request-review' : 'default'
  session.active = true
  session.thinking = true
  server.holdMessages = true
  const publish = () => {
    session.agentStateVersion++
    server.emit({ type: 'session-updated', sessionId: session.id, data: session })
  }
  publish()
  await page.getByTestId('session-history').click()
  const chat = page.getByTestId('chat-history')
  const composer = chat.locator('.composer')
  return {
    session,
    publish,
    chat,
    input: composer.getByRole('textbox'),
    send: composer.getByRole('button', { name: '发送', exact: true }),
    insert: composer.getByRole('button', { name: '优先插入', exact: true }),
    queue: chat.getByRole('region', { name: '排队消息', exact: true }),
  }
}

async function expectUsableInPane(target: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 })
  expect(
    await target.evaluate((element) => {
      const pane = element.closest('.chat-pane')
      if (!pane) return false
      const rect = element.getBoundingClientRect()
      const bounds = pane.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return rect.left >= bounds.left && rect.right <= bounds.right + 1 && element.contains(hit)
    }),
  ).toBe(true)
}

for (const agent of ['opencode', 'agy'] as const) {
  test.describe(agent, () => {
    test('steering requires a live remote capability and ordinary sends stay queued', async ({ desktop }) => {
      const { server, errors } = desktop
      const { session, publish, input, send, insert, queue } = await openSession(desktop, agent)
      const queuedInsert = queue.getByRole('button', { name: '优先插入', exact: true })
      await input.fill(`${agent} 普通消息先排队`)
      await expect(insert).toHaveCount(0)
      await send.click()
      await expect(queue).toContainText(`${agent} 普通消息先排队`)
      await expect(queuedInsert).toHaveCount(0)
      await input.fill('给当前轮补充方向')

      session.agentState = { ...session.agentState, steeringActive: true }
      publish()
      await expect(insert).toBeEnabled()
      await expect(queuedInsert).toBeEnabled()
      session.agentState.controlledByUser = true
      publish()
      await expect(insert).toHaveCount(0)
      await expect(queuedInsert).toHaveCount(0)
      session.agentState.controlledByUser = false
      session.agentState.steeringActive = false
      publish()
      await expect(insert).toHaveCount(0)
      await expect(queuedInsert).toHaveCount(0)
      session.agentState.steeringActive = true
      session.active = false
      publish()
      await expect(insert).toHaveCount(0)
      await expect(queuedInsert).toHaveCount(0)
      session.active = true
      publish()
      await expect(insert).toBeEnabled()
      await expect(queuedInsert).toBeEnabled()
      await input.fill('/plan')
      await expect(insert).toHaveCount(0)
      await expect(send).toBeEnabled()
      const sends = server.requests.filter(
        (request) => request.method === 'POST' && request.path.endsWith('/messages'),
      )
      expect(sends).toHaveLength(1)
      expect(sends[0]?.body).toMatchObject({ deliveryMode: 'queue' })
      expect(errors).toEqual([])
    })

    test('direct and queued steering preserve receipt state, drafts and pane controls across reload', async ({
      desktop,
    }) => {
      const { page, server, electron, errors } = desktop
      const { session, publish, chat, input, send, insert, queue } = await openSession(desktop, agent)
      session.agentState = { ...session.agentState, steeringActive: true }
      publish()
      server.steerOutcome = 'pending'
      await input.fill(`${agent} 队列中的补充要求`)
      await send.click()
      await expect(queue).toContainText(`${agent} 队列中的补充要求`)
      const queuedInsert = queue.getByRole('button', { name: '优先插入', exact: true })
      await queuedInsert.click()
      await expect(queue).toContainText('正在插入，等待助手确认接收…')
      await expect(queuedInsert).toBeDisabled()
      await expect(queue.getByRole('button', { name: '编辑排队消息', exact: true })).toBeDisabled()
      await expect(queue.getByRole('button', { name: '取消排队消息', exact: true })).toBeDisabled()
      const box = await queuedInsert.boundingBox()
      if (!box) throw new Error('Queued steer button missing')
      for (let click = 0; click < 3; click++)
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

      const guidance = '先检查已有实现\n\t保留当前任务，再核对 /src/main.ts。'
      await input.fill(guidance)
      await insert.focus()
      await expect(insert).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(input).toHaveValue('')
      await expect(queue).toContainText('先检查已有实现')
      await input.fill('等待追加确认期间继续编辑的草稿')
      const sends = () =>
        server.requests.filter(
          (request) => request.method === 'POST' && request.path === '/api/sessions/history/messages',
        )
      const steers = () => server.requests.filter((request) => request.path.endsWith('/steer'))
      expect(sends().map((request) => request.body.deliveryMode)).toEqual(['queue', 'steer'])
      expect(sends()[1]?.body.text).toBe(guidance)
      expect(steers()).toHaveLength(1)

      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
      await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'light' }))
      await expectUsableInPane(insert)
      await expectUsableInPane(send)
      await mkdir(`build/${agent}-steering`, { recursive: true })
      await page.screenshot({ path: `build/${agent}-steering/single-light.png`, animations: 'disabled' })
      await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
      await page.locator('.chat-pane').nth(1).click()
      await page.getByTestId('session-review').click()
      await page.evaluate(() => window.desktop.updateSettings({ theme: 'dark' }))
      await expectUsableInPane(insert)
      await expectUsableInPane(send)
      await expectUsableInPane(chat.locator('.composer').getByRole('button', { name: '中断', exact: true }))
      await expect(
        page.getByTestId('chat-review').getByRole('button', { name: '优先插入', exact: true }),
      ).toHaveCount(0)
      await page.screenshot({ path: `build/${agent}-steering/split-dark.png`, animations: 'disabled' })

      await page.reload()
      await expect(input).toHaveValue('等待追加确认期间继续编辑的草稿')
      await expect(queue.getByText('正在插入，等待助手确认接收…', { exact: true })).toHaveCount(2)
      await expect(queuedInsert).toHaveCount(2)
      for (const button of await queuedInsert.all()) await expect(button).toBeDisabled()
      await expect(queue.getByRole('button', { name: '重试发送', exact: true })).toHaveCount(0)
      expect(sends()).toHaveLength(2)
      expect(steers()).toHaveLength(1)
      const pending = server.messages.get(session.id)?.filter((message) => message.invokedAt === null) ?? []
      expect(pending).toHaveLength(2)
      for (const message of pending) {
        if (!message.localId) throw new Error('Queued message identity missing')
        message.invokedAt = Date.now()
        delete message.deliveryState
        server.emit({
          type: 'messages-consumed',
          sessionId: session.id,
          localIds: [message.localId],
          invokedAt: message.invokedAt,
          steered: true,
        })
      }
      await expect(queue).toHaveCount(0)
      await expect(chat.getByText('↳ 已介入', { exact: true })).toHaveCount(2)
      await expect(input).toHaveValue('等待追加确认期间继续编辑的草稿')
      expect(sends()).toHaveLength(2)
      expect(steers()).toHaveLength(1)
      expect(errors).toEqual([])
    })

    test('failed and unconfirmed steering retains the original message for explicit retry', async ({
      desktop,
    }) => {
      const { page, server, errors } = desktop
      await page.clock.install()
      const { session, publish, input, send, queue } = await openSession(desktop, agent)
      session.agentState = { ...session.agentState, steeringActive: true }
      publish()
      await input.fill('追加失败也必须保留的消息')
      await send.click()
      await expect(queue).toContainText('追加失败也必须保留的消息')
      await input.fill('追加操作期间的新草稿')
      const queuedInsert = queue.getByRole('button', { name: '优先插入', exact: true })
      server.steerOutcome = 'failed'
      await queuedInsert.click()
      await expect(page.getByText('Turn already ended', { exact: true })).toBeVisible()
      await expect(queue).toContainText('追加失败也必须保留的消息')
      await expect(queuedInsert).toBeEnabled()
      await expect(input).toHaveValue('追加操作期间的新草稿')
      server.steerOutcome = 'indeterminate'
      await queuedInsert.click()
      const retry = queue.getByRole('button', { name: '重试发送', exact: true })
      await expect(retry).toBeVisible()
      await expect(queuedInsert).toHaveCount(0)
      const original = server.messages.get(session.id)?.find((message) => message.invokedAt === null)
      if (!original?.localId) throw new Error('Original message identity missing')
      const steers = () => server.requests.filter((request) => request.path.endsWith('/steer'))
      expect(steers()).toHaveLength(2)
      // Freeze autosave so reload must preserve the last keystroke through pagehide.
      await page.clock.pauseAt(new Date(Date.now() + 1_000))
      await input.fill('刷新前刚修改的草稿')
      await page.reload()
      await page.clock.resume()
      await expect(retry).toBeVisible()
      await expect(queuedInsert).toHaveCount(0)
      await expect(input).toHaveValue('刷新前刚修改的草稿')
      expect(steers()).toHaveLength(2)
      await retry.click()
      await page.getByRole('dialog').getByRole('button', { name: '重试发送', exact: true }).click()
      await expect(queuedInsert).toBeEnabled()
      expect(server.requests.filter((request) => request.path.endsWith('/retry'))).toHaveLength(1)
      server.steerOutcome = 'steered'
      await queuedInsert.click()
      await expect(queue).toHaveCount(0)
      expect(steers()).toHaveLength(3)
      expect(new Set(steers().map((request) => request.path))).toEqual(
        new Set([`/api/sessions/history/messages/${original.id}/steer`]),
      )
      expect(
        server.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/messages')),
      ).toHaveLength(1)
      expect(server.messages.get(session.id)?.find((message) => message.id === original.id)?.localId).toBe(
        original.localId,
      )
      await expect(input).toHaveValue('刷新前刚修改的草稿')
      expect(errors).toEqual([])
    })
  })
}
