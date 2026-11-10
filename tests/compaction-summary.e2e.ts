import { mkdir } from 'node:fs/promises'
import { test, expect } from './fixtures/desktop'
import { fixtureCodexEvent, fixtureMessage } from './fake-server'

test('compaction reports start collapsed, retain live updates and reset when revisiting a session', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const messages = [
    fixtureCodexEvent('boundary', 1, { type: 'context_compacted', id: 'compact-1', pre_tokens: 8000 }),
    fixtureMessage('reply', 2, '## 下一步\n\n继续执行当前任务。'),
  ]
  server.messages.set('design', messages)
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const reports = chat.locator('.event-message')
  await expect(reports).toHaveCount(1)
  await expect(reports).toContainText('8,000 tokens before')
  await expect(reports.getByRole('button')).toHaveCount(0)
  await expect(chat.getByRole('heading', { name: '下一步' })).toBeVisible()

  const summary = fixtureCodexEvent('summary', 3, {
    type: 'compact-summary',
    compactionId: 'compact-1',
    summary: '## 保留的上下文\n\n- 完整保留任务要求。\n\n报告最后一段。',
    estimatedTokensAfter: 1300,
  })
  messages.push(summary)
  server.emit({ type: 'message-received', sessionId: 'design', message: summary })
  const toggle = reports.first().getByRole('button', { name: 'Context compacted' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(chat.getByRole('heading', { name: '保留的上下文' })).toHaveCount(0)
  await expect(reports).toContainText('8,000 → ~1,300 tokens (estimated after)')
  await toggle.click()
  await expect(chat.getByRole('heading', { name: '保留的上下文' })).toBeVisible()
  await expect(chat.getByText('报告最后一段。', { exact: true })).toBeVisible()

  const facts = fixtureCodexEvent('facts', 4, {
    type: 'compact-summary',
    compactionId: 'compact-1',
    summary: '',
    tokensAfter: 1200,
  })
  messages.push(facts)
  server.emit({ type: 'message-received', sessionId: 'design', message: facts })
  await expect(reports).toHaveCount(1)
  await expect(reports).toContainText('8,000 → 1,200 tokens')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(chat.getByText('报告最后一段。', { exact: true })).toBeVisible()

  const next = fixtureCodexEvent('next-summary', 5, {
    type: 'compact-summary',
    compactionId: 'compact-2',
    summary: '另一份压缩报告。',
  })
  messages.push(next)
  server.emit({ type: 'message-received', sessionId: 'design', message: next })
  await expect(reports).toHaveCount(2)
  await expect(reports.last().getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  await expect(chat.getByText('另一份压缩报告。', { exact: true })).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  await chat.locator('.composer textarea').fill('保留会话草稿')
  await page.getByTestId('session-review').click()
  await expect(page.getByTestId('chat-review')).toBeVisible()
  await page.getByTestId('session-design').click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(chat.getByText('报告最后一段。', { exact: true })).toHaveCount(0)
  await toggle.click()
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(chat.locator('.composer textarea')).toHaveValue('保留会话草稿')
  await expect(chat.getByRole('heading', { name: '下一步' })).toBeVisible()
  expect(errors).toEqual([])
})

test('historical compaction reports and disclosures work in narrow single and split panes', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  server.messagePageSize = 20
  server.messages.set('design', [
    fixtureCodexEvent('older-summary', 1, {
      type: 'compact-summary',
      summary: '## 早期压缩报告\n\n早期任务要求。',
      tokensBefore: 9000,
      tokensAfter: 1000,
    }),
    ...Array.from({ length: 24 }, (_, index) =>
      fixtureMessage(`history-${index}`, index + 2, `历史问题 ${index + 1}`, true),
    ),
    fixtureCodexEvent('latest-summary', 26, {
      type: 'compact-summary',
      summary: '## Contexte conservé\n\n- Garder toutes les exigences.\n- Reprendre la vérification.',
      tokensBefore: 8000,
      estimatedTokensAfter: 1200,
    }),
    fixtureMessage('latest-reply', 27, '最新回复保持可见。'),
  ])
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const reports = chat.locator('.event-message')
  const transcript = chat.locator('.transcript')
  await expect(chat.getByText('最新回复保持可见。', { exact: true })).toBeInViewport()
  await expect(reports).toHaveCount(1)
  const latestToggle = reports.last().getByRole('button', { name: 'Context compacted' })
  await expect(latestToggle).toHaveAttribute('aria-expanded', 'false')

  await transcript.getByRole('button', { name: '加载更早的消息', exact: true }).click()
  await expect(reports).toHaveCount(2)
  const olderToggle = reports.first().getByRole('button', { name: 'Context compacted' })
  await expect(olderToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(chat.getByRole('heading', { name: '早期压缩报告' })).toHaveCount(0)
  await olderToggle.focus()
  await olderToggle.press('Enter')
  await expect(chat.getByRole('heading', { name: '早期压缩报告' })).toBeVisible()
  await expect(olderToggle).toBeInViewport({ ratio: 1 })
  await olderToggle.press('Space')
  await expect(olderToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(olderToggle).toBeFocused()
  await chat.getByRole('button', { name: '回到最新消息', exact: true }).click()
  await expect(chat.getByText('最新回复保持可见。', { exact: true })).toBeInViewport()
  await expect(latestToggle).toHaveAttribute('aria-expanded', 'false')

  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'light' }))
  await expect(latestToggle).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() => reports.last().evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true)
  await mkdir('build/compaction-summary', { recursive: true })
  await page.screenshot({ path: 'build/compaction-summary/collapsed-light.png', animations: 'disabled' })

  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await page.evaluate(() => window.desktop.updateSettings({ theme: 'dark' }))
  await latestToggle.click()
  await expect(latestToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(latestToggle).toBeInViewport({ ratio: 1 })
  await expect(chat.getByRole('heading', { name: 'Contexte conservé' })).toBeVisible()
  await expect
    .poll(() => reports.last().evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
    .toBe(true)
  const lastSummaryItem = chat.getByText('Reprendre la vérification.', { exact: true })
  await lastSummaryItem.scrollIntoViewIfNeeded()
  await expect(lastSummaryItem).toBeInViewport({ ratio: 1 })
  await latestToggle.click()
  await expect(latestToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(latestToggle).toBeInViewport({ ratio: 1 })
  await latestToggle.press('Enter')

  // Keep the 640px interaction checks above; use more height to show the entire report in the capture.
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 960))
  await reports.last().scrollIntoViewIfNeeded()
  await expect(chat.getByRole('heading', { name: 'Contexte conservé' })).toBeInViewport({ ratio: 1 })
  await expect(lastSummaryItem).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: 'build/compaction-summary/expanded-dark.png', animations: 'disabled' })
  await latestToggle.press('Space')
  await expect(latestToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(latestToggle).toBeFocused()
  expect(errors).toEqual([])
})
