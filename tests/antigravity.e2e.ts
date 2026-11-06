import { mkdir } from 'node:fs/promises'
import { AgentStateSchema, DecryptedMessageSchema, type DecryptedMessage } from '@hapi/protocol/schemas'
import approvalFixture from '../vendor/hapi/shared/fixtures/chat/agy-native-permission-reply-id.json'
import streamFixture from '../vendor/hapi/shared/fixtures/chat/agy-native-streamed-prose.json'
import { fixtureSession } from './fake-server'
import { test, expect, type DesktopFixture } from './fixtures/desktop'

async function openAntigravity({ page, server }: DesktopFixture, messages: DecryptedMessage[]) {
  const session = fixtureSession('agy', 'Antigravity · 原生会话', 'agy')
  session.permissionMode = 'request-review'
  session.thinking = true
  server.sessions.set(session.id, session)
  server.messages.set(session.id, messages)
  const publish = () => {
    session.agentStateVersion++
    server.emit({ type: 'session-updated', sessionId: session.id, data: session })
  }
  server.emit({ type: 'session-added', sessionId: session.id, data: session })
  await page.getByTestId('session-agy').click()
  return { session, publish, chat: page.getByTestId('chat-agy') }
}

for (const mode of ['auto', 'plan'] as const) {
  test(`Antigravity creates and remembers ${mode}, while rejected runtime changes retain the confirmed mode`, async ({
    desktop,
  }) => {
    const { page, server, electron, errors } = desktop
    const open = page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true })
    await open.click()
    const dialog = page.getByRole('dialog', { name: '新建会话', exact: true })
    await dialog.getByLabel('Agent', { exact: true }).selectOption('agy')
    const permission = dialog.getByRole('group', { name: '权限模式', exact: true }).getByRole('combobox')
    await expect(permission).toHaveValue('request-review')
    expect(
      await permission
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual(['request-review', 'auto', 'plan', 'always-proceed'])
    await permission.selectOption(mode)
    await dialog.getByRole('button', { name: '创建会话', exact: true }).click()
    const chat = page.getByTestId('chat-created')
    await expect(chat).toBeVisible()
    expect(server.requests.find((request) => request.path.endsWith('/spawn'))?.body).toMatchObject({
      agent: 'agy',
      permissionMode: mode,
    })
    await chat.getByRole('button', { name: '会话设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '会话设置', exact: true })
    const livePermission = settings.getByRole('combobox', { name: '权限模式', exact: true })
    await expect(livePermission).toHaveValue(mode)
    server.failSetting = true
    await livePermission.selectOption('always-proceed')
    await expect(settings.getByRole('alert')).toBeVisible()
    await expect(livePermission).toHaveValue(mode)
    server.failSetting = false
    const next = mode === 'auto' ? 'plan' : 'auto'
    await livePermission.selectOption(next)
    await expect(livePermission).toHaveValue(next)
    expect(
      server.requests.filter((request) => request.path.endsWith('/permission-mode')).at(-1)?.body,
    ).toEqual({ mode: next })
    await settings.locator('footer').getByRole('button', { name: '关闭', exact: true }).click()
    await page.reload()
    await open.click()
    await expect(dialog.getByLabel('Agent', { exact: true })).toHaveValue('agy')
    await expect(permission).toHaveValue(mode)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()

    // Check the native-mode list in a narrow pane with a long translation.
    await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
    await page.locator('.chat-pane').nth(1).click()
    await page.getByTestId('session-review').click()
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
    await page.evaluate(
      (mode) =>
        window.desktop.updateSettings({ fontSize: 'extra-large', theme: mode === 'auto' ? 'light' : 'dark' }),
      mode,
    )
    await chat.getByRole('button', { name: '会话设置', exact: true }).click()
    await page.evaluate(() => window.desktop.updateSettings({ locale: 'fr' }))
    const panel = page.locator('.session-configuration')
    const nativeModes = panel
      .locator('select')
      .filter({ has: page.locator('option[value="request-review"]') })
    await expect(nativeModes).toHaveValue(next)
    await expect(nativeModes).toBeInViewport({ ratio: 1 })
    await nativeModes.focus()
    await expect(nativeModes).toBeFocused()
    const close = panel.locator('footer button')
    await expect(close).toBeInViewport({ ratio: 1 })
    await mkdir('build/antigravity-alignment', { recursive: true })
    await page.screenshot({
      path: `build/antigravity-alignment/settings-${mode}.png`,
      animations: 'disabled',
    })
    await close.click()
    await expect(panel).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

test('Antigravity stream snapshots update one reply and one thinking block without losing the final text', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  const messages = DecryptedMessageSchema.array().parse(streamFixture.input.messages)
  const { session, publish, chat } = await openAntigravity(desktop, messages.slice(0, 2))
  const reply = chat.locator('.transcript .agent-message')
  await expect(reply).toHaveCount(1)
  await expect(reply).toContainText('First')
  for (const message of messages.slice(2)) {
    server.messages.get(session.id)?.push(message)
    server.emit({ type: 'message-received', sessionId: session.id, message })
  }
  const finalText = 'First, prepare the plan. Second, request review.'
  await expect(reply).toHaveCount(1)
  await expect(reply.locator('.agent-prose')).toHaveText(finalText)
  const thinking = chat.locator('.reasoning')
  await expect(thinking).toHaveCount(1)
  await thinking.getByRole('button', { name: '思考中', exact: true }).click()
  await expect(thinking).toContainText('Consider the plan and request review.')
  session.thinking = false
  publish()
  await reply.hover()
  await reply.getByRole('button', { name: '复制', exact: true }).click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(finalText)
  await page.reload()
  await expect(reply).toHaveCount(1)
  await expect(reply.locator('.agent-prose')).toHaveText(finalText)
  expect(errors).toEqual([])
})

for (const decision of [
  { label: '允许', action: 'approve', body: {} },
  { label: '本会话允许', action: 'approve', body: { decision: 'approved_for_session' } },
  { label: '拒绝', action: 'deny', body: {} },
]) {
  test(`Antigravity ${decision.label} answers the current native reply ID and preserves a failed approval`, async ({
    desktop,
  }) => {
    const { server, errors } = desktop
    const messages = DecryptedMessageSchema.array().parse(approvalFixture.input.messages)
    const { session, publish, chat } = await openAntigravity(desktop, messages)
    session.agentState = AgentStateSchema.parse(approvalFixture.input.agentState)
    publish()
    const approval = chat.locator('.approval-area')
    await expect(approval).toContainText('python3 script.py')
    const action = approval.getByRole('button', { name: decision.label, exact: true })
    await expect(action).toHaveCount(1)
    server.failPermission = true
    await action.click()
    await expect(approval).toContainText('HTTP_409')
    await expect(action).toBeEnabled()
    expect(session.agentState.requests).toHaveProperty('agy-permission-new')
    server.failPermission = false
    await action.click()
    await expect(approval).toBeEmpty()
    const replies = server.requests.filter((request) => request.path.includes('/permissions/'))
    expect(replies).toHaveLength(2)
    for (const reply of replies) {
      expect(reply.path).toBe(`/api/sessions/agy/permissions/agy-permission-new/${decision.action}`)
      expect(reply.body).toEqual(decision.body)
    }
    expect(errors).toEqual([])
  })
}
