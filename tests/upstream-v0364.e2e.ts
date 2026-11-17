import { mkdir } from 'node:fs/promises'
import type { DecryptedMessage } from '@hapi/protocol/schemas'
import { fixtureMessage } from './fake-server'
import { test, expect } from './fixtures/desktop'

function modelEvent(id: string, seq: number, data: Record<string, unknown>): DecryptedMessage {
  return {
    ...fixtureMessage(id, seq, ''),
    content: { role: 'agent', content: { type: 'event', data } },
  }
}

test('Hub system notices retain original text and Cursor model errors survive reopening after reload', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  const noticeText = '[job] 构建已完成\n  保留缩进、# 标记与 **原文**。\n下一步等待检查结果。'
  const rawError = 'WritableIterable is closed\nThe remote model transport stopped.'
  const notice: DecryptedMessage = {
    ...fixtureMessage('system-notice', 2, noticeText, true),
    content: {
      role: 'user',
      content: { type: 'text', text: noticeText },
      meta: { sentFrom: 'hapi-system' },
    },
  }
  const failure = modelEvent('model-error', 3, {
    type: 'modelError',
    kind: 'transport_closed',
    transient: true,
    rawSnippet: rawError,
  })
  server.messages.set('history', [
    fixtureMessage('operator-message', 1, '检查构建结果', true),
    notice,
    failure,
  ])
  await page.getByRole('button', { name: '展开工作区: /home/dev/hapi-desktop', exact: true }).click()
  await page.getByTestId('session-history').click()
  const chat = page.getByTestId('chat-history')
  const system = chat.getByRole('article', { name: '系统消息', exact: true })
  await expect(system).toBeVisible()
  await expect(system).not.toHaveClass(/user-message/)
  await expect(system.locator('.markdown')).toHaveText(noticeText)
  await expect(chat.getByRole('article', { name: '你', exact: true })).toHaveCount(1)
  await expect(chat.locator('.model-error-event')).toContainText('模型暂时出错：transport_closed')
  const details = chat.getByText('错误详情', { exact: true })
  await details.focus()
  await page.keyboard.press('Enter')
  await expect(chat.locator('.model-error-event details')).toHaveAttribute('open', '')
  await expect(chat.locator('.model-error-event')).toContainText('WritableIterable is closed')
  await system.hover()
  await system.getByRole('button', { name: '复制', exact: true }).click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(noticeText)

  await chat.locator('.composer textarea').fill('错误提示不能覆盖这份草稿')
  const recovered = modelEvent('model-recovered', 4, {
    type: 'modelErrorBridged',
    kind: 'transport_closed',
    auto: true,
  })
  server.messages.get('history')?.push(recovered)
  server.emit({ type: 'message-received', sessionId: 'history', message: recovered })
  await expect(chat).toContainText('HAPI 已重新发送上一条消息')
  await page.reload()
  // History opens in a preview tab, which is intentionally not restored on reload.
  await page.getByTestId('session-history').click()
  await expect(system).toBeVisible()
  await expect(chat.locator('.composer textarea')).toHaveValue('错误提示不能覆盖这份草稿')
  await expect(chat.locator('.model-error-event')).toHaveCount(2)
  expect(
    server.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/messages')),
  ).toHaveLength(0)

  await mkdir('build/upstream-v0364', { recursive: true })
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'light' }))
  await system.scrollIntoViewIfNeeded()
  await system.hover()
  const narrowCopy = system.getByRole('button', { name: '复制', exact: true })
  await narrowCopy.scrollIntoViewIfNeeded()
  await narrowCopy.hover()
  await expect(narrowCopy).toBeInViewport({ ratio: 1 })
  await narrowCopy.click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(noticeText)
  await page.screenshot({ path: 'build/upstream-v0364/notices-single-light.png' })
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await page.evaluate(() => window.desktop.updateSettings({ locale: 'fr', theme: 'dark' }))
  const translated = chat.getByRole('article', { name: 'Message système', exact: true })
  await translated.scrollIntoViewIfNeeded()
  await translated.hover()
  const copy = translated.getByRole('button', { name: 'Copier', exact: true })
  await copy.scrollIntoViewIfNeeded()
  await copy.hover()
  await expect(copy).toBeInViewport({ ratio: 1 })
  await copy.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(noticeText)
  await expect(chat).toContainText('Erreur temporaire du modèle : transport_closed')
  await page.screenshot({ path: 'build/upstream-v0364/notices-split-fr-dark.png' })
  expect(errors).toEqual([])
})

for (const flavor of ['dsh', 'opencode'] as const) {
  test(`${flavor} reasoning choices send one native Default and retain the confirmed value on failure`, async ({
    desktop,
  }) => {
    const { page, server, errors } = desktop
    const session = server.sessions.get('history')
    if (!session?.metadata) throw new Error('Fixture session missing')
    session.active = true
    session.metadata.flavor = flavor
    session.modelReasoningEffort = 'high'
    session.metadataVersion++
    server.agentConfig.catalogs.set('opencode-reasoning-effort-options', {
      success: true,
      options: [
        { value: 'high', name: 'High' },
        { value: 'default', name: 'Default' },
      ],
    })
    server.emit({ type: 'session-updated', sessionId: session.id, data: session })
    await page.getByTestId('session-history').click()
    await page.getByTestId('chat-history').getByRole('button', { name: '会话设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '会话设置', exact: true })
    const effort = dialog.getByRole('combobox', { name: '思考强度', exact: true })
    await expect(effort).toBeEnabled()
    await expect(effort).toHaveValue('high')
    expect(
      await effort
        .locator('option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual(flavor === 'dsh' ? ['', 'off', 'low', 'high', 'max'] : ['', 'high'])
    server.failSetting = true
    await effort.selectOption('')
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(effort).toHaveValue('high')
    server.failSetting = false
    await effort.selectOption('')
    await expect(effort).toHaveValue('')
    const chosen = flavor === 'dsh' ? 'off' : 'high'
    await effort.selectOption(chosen)
    await expect(effort).toHaveValue(chosen)
    expect(
      server.requests
        .filter((request) => request.path.endsWith('/model-reasoning-effort'))
        .map((request) => request.body),
    ).toEqual([
      { modelReasoningEffort: null },
      { modelReasoningEffort: null },
      { modelReasoningEffort: chosen },
    ])
    expect(errors).toEqual([])
  })
}
