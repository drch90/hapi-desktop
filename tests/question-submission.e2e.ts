import type { Locator } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { test, expect } from './fixtures/desktop'
import {
  asyncQuestionId,
  asyncQuestionRequestId,
  publishAsyncQuestion,
  resolveAsyncQuestion,
} from './fixtures/async-question'

async function expectWithinPane(pane: Locator, target: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 })
  expect(
    await target.evaluate((element) => {
      const container = element.closest('.chat-pane')
      if (!container) return false
      const parent = container.getBoundingClientRect()
      const rect = element.getBoundingClientRect()
      return rect.left >= parent.left && rect.right <= parent.right + 1
    }),
  ).toBe(true)
  expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}

test('Codex answer feedback stays visible and repeated clicks cannot resubmit before native confirmation', async ({
  desktop,
}) => {
  const { page, server, errors } = desktop
  const gate = Promise.withResolvers<void>()
  server.permissionGate = gate.promise
  server.holdPermissionResolution = true
  const route = `/api/sessions/design/permissions/${encodeURIComponent(asyncQuestionRequestId)}/approve`
  const submissions = () => server.requests.filter((request) => request.path === route)
  try {
    await page.getByTestId('session-design').click()
    const chat = page.getByTestId('chat-design')
    await chat.locator('.composer textarea').fill('等待问答确认期间保留的草稿')
    publishAsyncQuestion(server)
    const card = chat.locator('.pending-question')
    await card.getByRole('button', { name: /按原文显示/ }).click()
    await card.getByRole('textbox').fill('包含补充说明')
    const submit = card.getByRole('button', { name: '提交', exact: true })
    await submit.focus()
    await expect(submit).toBeFocused()
    await page.keyboard.press('Enter')
    const submitting = card.getByRole('button', { name: '提交中…', exact: true })
    await expect(submitting).toBeDisabled()
    await expect(submitting).toHaveAttribute('aria-busy', 'true')
    await expect.poll(() => submissions().length).toBe(1)
    const box = await submitting.boundingBox()
    if (!box) throw new Error('Submit button missing')
    for (let click = 0; click < 3; click++)
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    expect(submissions()).toHaveLength(1)
    expect(submissions()[0]?.body).toEqual({
      answers: { [asyncQuestionId]: { answers: ['按原文显示', 'user_note: 包含补充说明'] } },
    })

    gate.resolve()
    const submitted = card.getByRole('button', { name: '已提交', exact: true })
    await expect(submitted).toBeDisabled()
    await expect(card.getByRole('status')).toHaveText('答案已提交，正在等待 Agent 确认…')
    await expect(card.getByRole('textbox')).toHaveValue('包含补充说明')
    await expect(card.getByRole('textbox')).toBeDisabled()
    const acceptedBox = await submitted.boundingBox()
    if (!acceptedBox) throw new Error('Submitted button missing')
    for (let click = 0; click < 3; click++) {
      await page.mouse.click(acceptedBox.x + acceptedBox.width / 2, acceptedBox.y + acceptedBox.height / 2)
    }
    await chat.getByRole('button', { name: '刷新', exact: true }).click()
    await expect(submitted).toBeDisabled()
    expect(submissions()).toHaveLength(1)
    resolveAsyncQuestion(server)
    await expect(card).toHaveCount(0)
    await expect(chat.locator('.composer textarea')).toHaveValue('等待问答确认期间保留的草稿')
    expect(errors).toEqual([])
  } finally {
    gate.resolve()
    server.permissionGate = null
    server.holdPermissionResolution = false
  }
})

test('Codex rejected answers keep choices and notes for an explicit retry', async ({ desktop }) => {
  const { page, server, errors } = desktop
  server.failPermission = true
  await page.getByTestId('session-design').click()
  publishAsyncQuestion(server)
  const card = page.getByTestId('chat-design').locator('.pending-question')
  await card.getByRole('button', { name: /按原文显示/ }).click()
  await card.getByRole('textbox').fill('重试时仍保留的内容')
  await card.getByRole('button', { name: '提交', exact: true }).click()
  await expect(card.getByRole('alert')).toBeVisible()
  await expect(card.getByRole('button', { name: '提交', exact: true })).toBeEnabled()
  await expect(card.getByRole('textbox')).toHaveValue('重试时仍保留的内容')
  await expect(card.getByRole('button', { name: /按原文显示/ })).toHaveAttribute('aria-pressed', 'true')
  server.failPermission = false
  await card.getByRole('button', { name: '提交', exact: true }).click()
  await expect(card).toHaveCount(0)
  const requests = server.requests.filter((request) => request.path.endsWith('/approve'))
  expect(requests).toHaveLength(2)
  expect(requests[1]?.body).toEqual(requests[0]?.body)
  expect(errors).toEqual([])
})

test('Codex submission status and controls fit small single and split panes with large translated text', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  server.holdPermissionResolution = true
  await page.getByTestId('session-design').click()
  publishAsyncQuestion(server)
  const chat = page.getByTestId('chat-design')
  const card = chat.locator('.pending-question')
  await card.getByRole('button', { name: /按原文显示/ }).click()
  await card.getByRole('button', { name: '提交', exact: true }).click()
  await expect(card.getByRole('status')).toBeVisible()
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'light' }))
  await expectWithinPane(chat, card.getByRole('status'))
  await expectWithinPane(chat, card.getByRole('button', { name: '已提交', exact: true }))
  await mkdir('build/session-interaction-fixes', { recursive: true })
  await page.screenshot({ path: 'build/session-interaction-fixes/question-submitted.png' })
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await page.evaluate(() => window.desktop.updateSettings({ locale: 'fr', theme: 'dark' }))
  await expect(card.getByRole('status')).toHaveText('Réponse envoyée. En attente de confirmation de l’agent…')
  await expectWithinPane(chat, card.getByRole('status'))
  await expectWithinPane(chat, card.getByRole('button', { name: 'Envoyé', exact: true }))
  await page.screenshot({ path: 'build/session-interaction-fixes/question-submitted-split-fr.png' })
  expect(errors).toEqual([])
})
