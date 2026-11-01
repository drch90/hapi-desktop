import { type Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { test, expect, type DesktopFixture } from './fixtures/desktop'
import { fixtureSession } from './fake-server'

const originalText = '# 保留原文与缩进\n\tHermes 恢复后继续检查\n' + '    不重复发送草稿和附件。\n'.repeat(20)

async function uncertainHermes(desktop: DesktopFixture, accepted = false) {
  const { page, server } = desktop
  const session = fixtureSession('hermes', 'Hermes 恢复验证', 'hermes')
  if (!session.metadata) throw new Error('Missing Hermes fixture metadata')
  session.metadata.hermesSessionId = 'native-hermes'
  server.sessions.set(session.id, session)
  server.messages.set(session.id, [])
  server.emit({ type: 'session-added', sessionId: session.id, data: session })
  server.failSend = accepted ? 'accepted' : 'absent'
  server.holdMessages = true
  await page.getByTestId('session-hermes').click()
  const chat = page.getByTestId('chat-hermes')
  const input = chat.locator('.composer textarea')
  await input.fill(originalText)
  await expect(chat.getByRole('button', { name: '上传文件', exact: true })).toBeEnabled()
  await chat.locator('input[type=file]').setInputFiles({
    name: 'hermes-draft.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Keep the original attachment bytes.'),
  })
  await expect(chat.getByTestId('attachment-draft')).toContainText('待发送')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '检查送达状态', exact: true })).toBeEnabled()
  await expect(input).not.toBeEditable()
  const sent = server.requests.find((r) => r.path === '/api/sessions/hermes/messages' && r.method === 'POST')
  if (typeof sent?.body.localId !== 'string') throw new Error('Missing send identity')
  return { chat, input, localId: sent.body.localId }
}

async function archiveHermes({ page }: DesktopFixture, chat: Locator) {
  await chat.getByRole('button', { name: '归档', exact: true }).click()
  await page
    .getByRole('dialog', { name: '归档此会话？', exact: true })
    .getByRole('button', { name: '归档', exact: true })
    .click()
  await expect(chat).toHaveCount(0)
  await page.getByLabel('搜索会话', { exact: true }).fill('Hermes 恢复验证')
  await page.getByTestId('session-hermes').click()
  await expect(chat.getByRole('button', { name: '恢复会话', exact: true })).toBeVisible()
}

async function reopenHermes({ page }: DesktopFixture) {
  await page.getByLabel('搜索会话', { exact: true }).fill('Hermes 恢复验证')
  await page.getByTestId('session-hermes').click()
}

function holdAsIndeterminate({ server }: DesktopFixture) {
  const message = server.messages.get('hermes')?.at(-1)
  if (!message?.localId) throw new Error('Missing queued message')
  message.deliveryState = 'indeterminate'
  server.emit({ type: 'messages-indeterminate', sessionId: 'hermes', localIds: [message.localId] })
  return message
}

test('archived Hermes can resume with an uncertain send and cancel without losing its draft', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const { chat, input, localId } = await uncertainHermes(desktop)
  await archiveHermes(desktop, chat)
  await page.reload()
  await reopenHermes(desktop)
  await expect(input).toHaveValue(originalText)
  await expect(chat.getByTestId('attachment-draft')).toContainText('hermes-draft.txt')
  const resume = chat.getByRole('button', { name: '恢复会话', exact: true })
  await expect(resume).toBeEnabled()
  await resume.click()
  await expect(chat.getByRole('button', { name: '中断', exact: true })).toBeVisible()
  await expect(input).not.toBeEditable()
  await chat.getByRole('button', { name: '检查送达状态', exact: true }).click()
  await expect(chat.getByRole('button', { name: '重试发送', exact: true })).toBeVisible()
  await chat.getByRole('button', { name: '取消发送', exact: true }).click()
  await expect(input).toBeEditable()
  await expect(input).toHaveValue(originalText)
  await expect(chat.getByTestId('attachment-draft')).toContainText('hermes-draft.txt')
  await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
  expect(server.requests.filter((r) => r.path.endsWith('/resume'))).toHaveLength(1)
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(1)
  expect(server.requests.some((r) => r.method === 'DELETE' && r.path.endsWith(`/messages/${localId}`))).toBe(
    true,
  )
  expect(server.uploadDeletes).toEqual([])
  await page.reload()
  await reopenHermes(desktop)
  await expect(input).toHaveValue(originalText)
  await expect(input).toBeEditable()
  await expect(chat.getByTestId('attachment-draft')).toContainText('hermes-draft.txt')
  expect(errors).toEqual([])
})

test('archived Hermes cancels an indeterminate server row by local ID even without queue events', async ({
  desktop,
}) => {
  const { page, electron, server, errors } = desktop
  const { chat, input, localId } = await uncertainHermes(desktop, true)
  const message = holdAsIndeterminate(desktop)
  expect(message.id).not.toBe(localId)
  await archiveHermes(desktop, chat)
  const queue = chat.getByRole('region', { name: '排队消息', exact: true })
  await expect(queue).toBeVisible()
  await chat.getByRole('button', { name: '检查送达状态', exact: true }).click()
  await expect(
    chat.locator('.send-alert').getByRole('button', { name: '重试发送', exact: true }),
  ).toHaveCount(0)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await expect(chat.getByRole('button', { name: '取消发送', exact: true })).toBeInViewport({ ratio: 1 })
  await expect(chat.getByRole('button', { name: '恢复会话', exact: true })).toBeInViewport({ ratio: 1 })
  server.emitQueueEvents = false
  await chat.getByRole('button', { name: '取消发送', exact: true }).click()
  await expect(queue).toHaveCount(0)
  await expect(input).toBeEditable()
  await expect(input).toHaveValue(originalText)
  await expect(chat.getByTestId('attachment-draft')).toContainText('hermes-draft.txt')
  await expect(chat.getByRole('button', { name: '恢复会话', exact: true })).toBeEnabled()
  expect(server.messages.get('hermes')).toEqual([])
  expect(server.requests.filter((r) => r.path.endsWith('/resume'))).toHaveLength(0)
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(1)
  expect(server.uploadDeletes).toEqual([])
  await page.reload()
  await reopenHermes(desktop)
  await expect(input).toBeEditable()
  await expect(input).toHaveValue(originalText)
  await expect(chat.getByTestId('attachment-draft')).toContainText('hermes-draft.txt')
  expect(errors).toEqual([])
})

test('busy and failed cancellation preserve the receipt and attachments until the Hub confirms cancellation', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const { chat, input } = await uncertainHermes(desktop, true)
  holdAsIndeterminate(desktop)
  const cancel = chat.getByRole('button', { name: '取消发送', exact: true })
  await cancel.click()
  await expect(chat.locator('.send-alert')).toContainText('暂时无法确认取消结果')
  await expect(input).not.toBeEditable()
  await expect(
    chat.locator('.send-alert').getByRole('button', { name: '重试发送', exact: true }),
  ).toHaveCount(0)
  await archiveHermes(desktop, chat)
  server.failCancel = true
  await cancel.click()
  await expect(cancel).toBeEnabled()
  await expect(input).not.toBeEditable()
  await expect(chat.getByRole('button', { name: '恢复会话', exact: true })).toBeEnabled()
  await expect(chat.getByTestId('attachment-draft')).toContainText('hermes-draft.txt')
  await page.reload()
  await reopenHermes(desktop)
  await expect(input).not.toBeEditable()
  await expect(input).toHaveValue(originalText)
  server.failCancel = false
  await cancel.click()
  await expect(input).toBeEditable()
  await expect(chat.getByRole('region', { name: '排队消息', exact: true })).toHaveCount(0)
  expect(server.requests.filter((r) => r.method === 'DELETE' && r.path.includes('/messages/'))).toHaveLength(
    3,
  )
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(1)
  expect(server.uploadDeletes).toEqual([])
  expect(errors).toEqual([])
})

test('a late cancellation receipt does not change another tab and preserves already received history', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const { chat, input } = await uncertainHermes(desktop, true)
  const message = holdAsIndeterminate(desktop)
  let releaseCancel = () => {}
  server.cancelGate = new Promise<void>((resolve) => {
    releaseCancel = resolve
  })
  try {
    await chat.getByRole('button', { name: '取消发送', exact: true }).click()
    await expect
      .poll(() => server.requests.some((r) => r.method === 'DELETE' && r.path.includes('/messages/')))
      .toBe(true)
    await page.getByTestId('session-review').click()
    const other = page.getByTestId('chat-review').locator('.composer textarea')
    await other.fill('保留另一会话的新草稿')
    message.invokedAt = Date.now()
    server.emitQueueEvents = false
    releaseCancel()
    await expect(other).toHaveValue('保留另一会话的新草稿')
    await reopenHermes(desktop)
    await expect(input).not.toBeEditable()
    await chat.getByRole('button', { name: '取消发送', exact: true }).click()
    await expect(chat.locator('.send-alert')).toContainText('Agent 已收到此消息，历史记录已保留。')
    await expect(input).toBeEditable()
    await expect(input).toHaveValue('')
    await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
    await expect(chat.locator('.transcript .user-message')).toHaveCount(1)
    await expect(chat.locator('.transcript')).toContainText('Hermes 恢复后继续检查')
    await expect(chat.getByRole('region', { name: '排队消息', exact: true })).toHaveCount(0)
    await page.reload()
    await reopenHermes(desktop)
    await expect(input).toHaveValue('')
    await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
    expect(server.messages.get('hermes')).toHaveLength(1)
    expect(server.uploadDeletes).toEqual([])
    expect(errors).toEqual([])
  } finally {
    releaseCancel()
    server.cancelGate = null
  }
})

test('received-message recovery keeps newer drafts and resolves multiple receipts separately', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const { chat, input } = await uncertainHermes(desktop, true)
  const message = holdAsIndeterminate(desktop)
  message.invokedAt = Date.now()
  await page.getByTestId('session-review').click()
  // This is the persisted shape after resuming into a session with its own
  // newer draft and receipt. Seed it while the source composer is unmounted.
  await page.evaluate(() => {
    const keys = Object.keys(localStorage)
    const draftKey = keys.find((key) => key.startsWith('desktop:draft:') && key.endsWith(':hermes'))
    const receiptKey = keys.find((key) => key.startsWith('desktop:outbox:') && key.endsWith(':hermes'))
    if (!draftKey || !receiptKey) throw new Error('Missing persisted send state')
    const draft = JSON.parse(localStorage.getItem(draftKey) || 'null')
    const receipt = JSON.parse(localStorage.getItem(receiptKey) || 'null')
    localStorage.setItem(
      draftKey,
      JSON.stringify({ ...draft, text: '下一份草稿保持可编辑', revision: 'newer-draft' }),
    )
    localStorage.setItem(
      receiptKey,
      JSON.stringify([
        receipt,
        { localId: 'second-receipt', text: '另一条未确认的发送', createdAt: 2, status: 'unconfirmed' },
      ]),
    )
  })
  await reopenHermes(desktop)
  await expect(input).toHaveValue('下一份草稿保持可编辑')
  await chat.getByRole('button', { name: '取消发送', exact: true }).click()
  await expect(chat.locator('.send-alert')).toContainText('另一条未确认的发送')
  await expect(chat.locator('.send-alert')).not.toContainText('Agent 已收到此消息')
  await expect(input).not.toBeEditable()
  await expect(chat.getByTestId('attachment-draft')).toHaveCount(0)
  await chat.getByRole('button', { name: '取消发送', exact: true }).click()
  await expect(input).toBeEditable()
  await expect(input).toHaveValue('下一份草稿保持可编辑')
  await expect(chat.locator('.transcript .user-message')).toHaveCount(1)
  await page.reload()
  await reopenHermes(desktop)
  await expect(input).toHaveValue('下一份草稿保持可编辑')
  await expect(input).toBeEditable()
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(1)
  expect(errors).toEqual([])
})

test('a changed resume ID carries the receipt and merges drafts without resending', async ({ desktop }) => {
  const { page, server, errors } = desktop
  const { chat, localId } = await uncertainHermes(desktop)
  await page.getByTestId('session-review').click()
  await page.getByTestId('chat-review').locator('.composer textarea').fill('目标会话自己的草稿')
  await reopenHermes(desktop)
  await archiveHermes(desktop, chat)
  // Most agents may return an existing session ID. Hermes's usual same-ID
  // result is covered separately; this exercises the generic resume contract.
  server.resumeTarget = 'review'
  await chat.getByRole('button', { name: '恢复会话', exact: true }).click()
  const target = page.getByTestId('chat-review')
  const input = target.locator('.composer textarea')
  await expect(input).toHaveValue(`目标会话自己的草稿\n${originalText}`)
  await expect(input).not.toBeEditable()
  await expect(target.getByTestId('attachment-draft')).toContainText('hermes-draft.txt')
  await target.getByRole('button', { name: '取消发送', exact: true }).click()
  await expect(input).toBeEditable()
  await expect(input).toHaveValue(`目标会话自己的草稿\n${originalText}`)
  expect(
    server.requests.some(
      (r) => r.method === 'DELETE' && r.path === `/api/sessions/review/messages/${localId}`,
    ),
  ).toBe(true)
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(1)
  await page.reload()
  await expect(input).toHaveValue(`目标会话自己的草稿\n${originalText}`)
  await expect(target.getByTestId('attachment-draft')).toContainText('hermes-draft.txt')
  expect(errors).toEqual([])
})

test('recovery controls remain reachable in a small window with long text and large fonts', async ({
  desktop,
}) => {
  const { page, electron, errors } = desktop
  const { chat } = await uncertainHermes(desktop)
  await archiveHermes(desktop, chat)
  await chat.getByRole('button', { name: '检查送达状态', exact: true }).click()
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  const check = chat.getByRole('button', { name: '检查送达状态', exact: true })
  const cancel = chat.getByRole('button', { name: '取消发送', exact: true })
  const resume = chat.getByRole('button', { name: '恢复会话', exact: true })
  for (const control of [check, cancel, resume]) {
    await expect(control).toBeInViewport({ ratio: 1 })
    await control.click({ trial: true })
  }
  expect(
    await chat.locator('.send-alert').evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true)
  await mkdir('build/send-recovery-fix', { recursive: true })
  await page.screenshot({ path: 'build/send-recovery-fix/recovery-dark.png', animations: 'disabled' })
  await page.getByLabel('搜索会话', { exact: true }).fill('')
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await page.evaluate(() => window.desktop.updateSettings({ locale: 'fr', theme: 'light' }))
  const cancelFrench = chat.getByRole('button', { name: 'Annuler l’envoi', exact: true })
  await expect(cancelFrench).toBeInViewport({ ratio: 1 })
  await cancelFrench.focus()
  await expect(cancelFrench).toBeFocused()
  expect(
    await chat.locator('.send-alert').evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true)
  await page.screenshot({ path: 'build/send-recovery-fix/recovery-split-light.png', animations: 'disabled' })
  await cancelFrench.press('Enter')
  await expect(chat.locator('.composer textarea')).toBeEditable()
  await expect(chat.locator('.composer textarea')).toHaveValue(originalText)
  expect(errors).toEqual([])
})
