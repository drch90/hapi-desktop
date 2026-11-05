import type { Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { test, expect } from './fixtures/desktop'
import { fixtureMessage, type FixtureHub } from './fake-server'

function seedHistory(server: FixtureHub, sessionId = 'design', count = 100) {
  server.messagePageSize = 20
  server.messages.set(
    sessionId,
    Array.from({ length: count }, (_, index) =>
      fixtureMessage(`${sessionId}-${index + 1}`, index + 1, `${sessionId} 历史消息 ${index + 1}`, true),
    ),
  )
}

function olderRequests(server: FixtureHub, sessionId = 'design') {
  return server.messagePageRequests.filter(
    (request) => request.sessionId === sessionId && request.beforeSeq !== null,
  )
}

async function visibleAnchor(transcript: Locator) {
  return transcript.evaluate((element) => {
    const viewport = element.getBoundingClientRect()
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('.message-anchor')).find((node) => {
      const rect = node.getBoundingClientRect()
      return rect.top >= viewport.top && rect.top < viewport.bottom
    })
    if (!anchor) throw new Error('No visible message anchor')
    return { id: anchor.id, offset: anchor.getBoundingClientRect().top - viewport.top }
  })
}

async function expectAnchor(transcript: Locator, anchor: { id: string; offset: number }) {
  await expect
    .poll(() =>
      transcript.evaluate((element, id) => {
        const message = document.getElementById(id)
        if (!message || !element.contains(message)) return null
        return message.getBoundingClientRect().top - element.getBoundingClientRect().top
      }, anchor.id),
    )
    .toBeCloseTo(anchor.offset, 0)
}

test('scrolling near the top loads one older page and preserves the position read while it was pending', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  seedHistory(server)
  const gate = Promise.withResolvers<void>()
  server.historyGate = gate.promise
  try {
    await page.getByTestId('session-design').click()
    const transcript = page.getByTestId('chat-design').locator('.transcript')
    await expect(transcript.getByText('design 历史消息 100', { exact: true })).toBeInViewport()
    expect(olderRequests(server)).toHaveLength(0)
    const start = await transcript.evaluate((element) => element.scrollTop)
    expect(start).toBeGreaterThan(700)
    await transcript.hover()
    await page.mouse.wheel(0, 350 - start)
    await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeCloseTo(350, 0)
    expect(olderRequests(server)).toHaveLength(0)

    await page.mouse.wheel(0, -200)
    await expect.poll(() => olderRequests(server).length).toBe(1)
    expect(olderRequests(server)[0]?.beforeSeq).toBe(81)
    await expect(transcript.locator('.load-history')).toBeDisabled()
    await page.mouse.wheel(0, -50)
    await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeCloseTo(100, 0)
    const anchor = await visibleAnchor(transcript)
    expect(olderRequests(server)).toHaveLength(1)
    gate.resolve()
    await expect(transcript.getByText('design 历史消息 61', { exact: true })).toHaveCount(1)
    await expectAnchor(transcript, anchor)
    expect(olderRequests(server)).toHaveLength(1)

    // Keyboard input is a fresh approach and does not require clicking the load button.
    await transcript.focus()
    await expect(transcript).toBeFocused()
    await page.keyboard.press('Home')
    await expect(transcript.getByText('design 历史消息 41', { exact: true })).toHaveCount(1)
    expect(olderRequests(server)).toHaveLength(2)
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
    server.historyGate = null
  }
})

test('a short first page loads once, keeps failed history retryable and stops when history is exhausted', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  seedHistory(server, 'design', 5)
  server.messagePageSize = 1
  await page.getByTestId('session-design').click()
  const transcript = page.getByTestId('chat-design').locator('.transcript')
  await expect(transcript.getByText('design 历史消息 4', { exact: true })).toHaveCount(1)
  expect(olderRequests(server)).toHaveLength(1)
  expect(await transcript.evaluate((element) => element.scrollTop)).toBe(0)

  server.failHistory = true
  await transcript.focus()
  await page.keyboard.press('Home')
  await expect(transcript.getByRole('alert')).toBeVisible()
  expect(olderRequests(server)).toHaveLength(2)
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'large' }))
  await expect(transcript.locator('.load-history')).toBeEnabled()
  expect(olderRequests(server)).toHaveLength(2)
  server.failHistory = false
  await transcript.getByRole('button', { name: '加载更早的消息', exact: true }).click()
  await expect(transcript.getByRole('alert')).toHaveCount(0)
  await expect(transcript.getByText('design 历史消息 3', { exact: true })).toHaveCount(1)
  for (const first of [2, 1]) {
    await transcript.focus()
    await page.keyboard.press('Home')
    await expect(transcript.getByText(`design 历史消息 ${first}`, { exact: true })).toHaveCount(1)
  }
  await expect(transcript.locator('.load-history')).toHaveCount(0)
  await transcript.focus()
  await page.keyboard.press('Home')
  expect(olderRequests(server)).toHaveLength(5)
  expect(errors).toEqual([])
})

test('dragging the native scrollbar to the top can request another older page', async ({ desktop }) => {
  const { page, server, errors } = desktop
  seedHistory(server)
  await page.getByTestId('session-design').click()
  const transcript = page.getByTestId('chat-design').locator('.transcript')
  await expect(transcript.getByText('design 历史消息 100', { exact: true })).toBeInViewport()
  await transcript.focus()
  await page.keyboard.press('Home')
  await expect(transcript.getByText('design 历史消息 61', { exact: true })).toHaveCount(1)
  const scrollbar = await transcript.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error('Transcript is not an HTML element')
    const rect = element.getBoundingClientRect()
    const thumbHeight = element.clientHeight ** 2 / element.scrollHeight
    return {
      x: rect.right - (element.offsetWidth - element.clientWidth) / 2,
      from: rect.top + (element.scrollTop * element.clientHeight) / element.scrollHeight + thumbHeight / 2,
      to: rect.top + thumbHeight / 2,
    }
  })
  await page.mouse.move(scrollbar.x, scrollbar.from)
  await page.mouse.down()
  await page.mouse.move(scrollbar.x, scrollbar.to, { steps: 8 })
  await page.mouse.up()
  await expect(transcript.getByText('design 历史消息 41', { exact: true })).toHaveCount(1)
  expect(olderRequests(server)).toHaveLength(2)
  expect(errors).toEqual([])
})

test('short first-page history fill keeps following the latest across session switches and streaming', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  seedHistory(server, 'design', 5)
  seedHistory(server, 'review', 5)
  server.messagePageSize = 1
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const transcript = chat.locator('.transcript')
  const gap = () =>
    transcript.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)
  await expect(transcript.getByText('design 历史消息 4', { exact: true })).toHaveCount(1)
  expect(olderRequests(server)).toHaveLength(1)
  await expect(chat.getByRole('button', { name: '回到最新消息' })).toHaveCount(0)
  // Version 1.0.15 could persist a numeric bottom position after passive fill.
  await chat.locator('.composer textarea').fill('升级后保留的草稿')
  await page.getByTestId('session-review').click()
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(
      (key) => key.startsWith('desktop:draft:') && key.endsWith(':design'),
    )
    if (!key) throw new Error('Saved draft missing')
    const draft: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('Invalid saved draft')
    localStorage.setItem(key, JSON.stringify({ ...draft, scrollTop: 0 }))
  })
  await page.reload()
  await page.getByTestId('session-design').click()
  await expect(transcript.getByText('design 历史消息 4', { exact: true })).toHaveCount(1)
  await expect(chat.locator('.composer textarea')).toHaveValue('升级后保留的草稿')
  await expect(chat.getByRole('button', { name: '回到最新消息' })).toHaveCount(0)
  const streamed = fixtureMessage(
    'long-latest',
    6,
    Array.from({ length: 55 }, (_, index) => `新回复第 ${index + 1} 行`).join('\n'),
    true,
  )
  server.messages.get('design')?.push(streamed)
  server.emit({ type: 'message-received', sessionId: 'design', message: streamed })
  await expect(transcript.getByText(/新回复第 55 行/)).toHaveCount(1)
  await expect.poll(gap).toBeLessThan(3)
  await chat.locator('.composer textarea').fill('首屏补载后保留草稿')
  await page.getByTestId('session-review').click()
  await expect(page.getByTestId('chat-review').getByText('review 历史消息 4', { exact: true })).toHaveCount(1)
  await page.getByTestId('session-design').click()
  await expect(chat.locator('.composer textarea')).toHaveValue('首屏补载后保留草稿')
  await expect.poll(gap).toBeLessThan(3)
  await expect(chat.getByRole('button', { name: '回到最新消息' })).toHaveCount(0)
  expect(olderRequests(server)).toHaveLength(2)
  expect(errors).toEqual([])
})

test('leaving the preload area cancels a slow page and returning to the latest resumes live following', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  seedHistory(server)
  const gate = Promise.withResolvers<void>()
  server.historyGate = gate.promise
  try {
    await page.getByTestId('session-design').click()
    const chat = page.getByTestId('chat-design')
    const transcript = chat.locator('.transcript')
    await expect(transcript.getByText('design 历史消息 100', { exact: true })).toBeInViewport()
    await transcript.focus()
    await page.keyboard.press('Home')
    await expect.poll(() => olderRequests(server).length).toBe(1)
    // PageDown animates natively. Sample the reading anchor after the gesture ends.
    await Promise.all([
      transcript.evaluate(
        (element) =>
          new Promise<void>((resolve) =>
            element.addEventListener('scrollend', () => resolve(), { once: true }),
          ),
      ),
      page.keyboard.press('PageDown'),
    ])
    await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBeGreaterThan(300)
    await expect(transcript.locator('.load-history')).toBeEnabled()
    const anchor = await visibleAnchor(transcript)
    gate.resolve()
    const next = fixtureMessage('live-after-cancel', 101, '取消补载后的新回复')
    server.messages.get('design')?.push(next)
    server.emit({ type: 'message-received', sessionId: 'design', message: next })
    await expect(transcript.getByText('取消补载后的新回复', { exact: true })).toHaveCount(1)
    await expect(transcript.getByText('design 历史消息 61', { exact: true })).toHaveCount(0)
    await expectAnchor(transcript, anchor)
    await chat.getByRole('button', { name: '回到最新消息' }).click()
    await expect(transcript.getByText('取消补载后的新回复', { exact: true })).toBeInViewport()
    await expect(chat.getByRole('button', { name: '回到最新消息' })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
    server.historyGate = null
  }
})

test('switching sessions ignores a pending older page and keeps the draft in its session', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  seedHistory(server)
  seedHistory(server, 'review')
  const gate = Promise.withResolvers<void>()
  const returnGate = Promise.withResolvers<void>()
  server.historyGate = gate.promise
  try {
    await page.getByTestId('session-design').click()
    const chat = page.getByTestId('chat-design')
    await chat.locator('.composer textarea').fill('切换期间保留的草稿')
    await chat.locator('.transcript').focus()
    await page.keyboard.press('Home')
    await expect.poll(() => olderRequests(server).length).toBe(1)
    await page.getByTestId('session-review').click()
    await expect(
      page.getByTestId('chat-review').getByText('review 历史消息 100', { exact: true }),
    ).toBeInViewport()
    server.historyGate = returnGate.promise
    await page.getByTestId('session-design').click()
    await expect(chat.locator('.composer textarea')).toHaveValue('切换期间保留的草稿')
    await chat.locator('.transcript').focus()
    await page.keyboard.press('Home')
    await expect.poll(() => olderRequests(server).length).toBe(2)
    gate.resolve()
    await expect(chat.locator('.load-history')).toBeDisabled()
    await expect(chat.getByText('design 历史消息 61', { exact: true })).toHaveCount(0)
    returnGate.resolve()
    await expect(chat.getByText('design 历史消息 61', { exact: true })).toHaveCount(1)
    expect(olderRequests(server, 'review')).toHaveLength(0)
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
    returnGate.resolve()
    server.historyGate = null
  }
})

test('history loading stays within its pane at maximum font size in narrow light and dark layouts', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  seedHistory(server)
  seedHistory(server, 'review')
  await page.getByTestId('session-design').click()
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'light' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(920, 640))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(
    page.getByTestId('chat-design').getByText('design 历史消息 100', { exact: true }),
  ).toBeInViewport()
  await mkdir('build/transcript-history', { recursive: true })
  await page.screenshot({ path: 'build/transcript-history/light-single.png' })
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  const left = page.getByTestId('chat-design').locator('.transcript')
  const right = page.getByTestId('chat-review').locator('.transcript')
  await expect(right.getByText('review 历史消息 100', { exact: true })).toBeInViewport()
  const rightAnchor = await visibleAnchor(right)
  await left.focus()
  await page.keyboard.press('Home')
  await expect(left.getByText('design 历史消息 61', { exact: true })).toHaveCount(1)
  await expectAnchor(right, rightAnchor)
  expect(olderRequests(server, 'review')).toHaveLength(0)

  // A restored position cannot silently load another page; the button remains usable.
  await left.evaluate((element) => {
    element.scrollTop = 0
  })
  const button = left.locator('.load-history')
  await expect(button).toBeInViewport({ ratio: 1 })
  await button.focus()
  await expect(button).toBeFocused()
  await page.screenshot({ path: 'build/transcript-history/light-split.png' })
  await page.evaluate(() => window.desktop.updateSettings({ locale: 'fr', theme: 'dark' }))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(button).toBeInViewport({ ratio: 1 })
  expect(await left.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: 'build/transcript-history/dark-split.png' })
  await button.click()
  await expect(left.getByText('design 历史消息 41', { exact: true })).toHaveCount(1)
  expect(olderRequests(server)).toHaveLength(2)
  expect(olderRequests(server, 'review')).toHaveLength(0)
  expect(errors).toEqual([])
})
