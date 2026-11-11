import { mkdir, writeFile } from 'node:fs/promises'
import { test, expect } from './fixtures/desktop'
import { fixtureMessage } from './fake-server'
import { mathCalculation } from './fixtures/math-markdown'

test('dollar math renders in replies, expanded reading, image sharing and file previews', async ({
  desktop,
}) => {
  const { electron, page, server, errors } = desktop
  const content = mathCalculation + '\n\n[公式文件](docs/fractions.md)'
  server.messages.set('design', [fixtureMessage('fraction-calculation', 1, content)])
  server.fileContents.set('docs/fractions.md', Buffer.from(mathCalculation))
  server.fileDiffs.set('docs/fractions.md', '')
  await page.getByTestId('session-design').click()
  const message = page.getByTestId('chat-design').locator('.agent-message')
  await expect(message.locator('.katex')).toHaveCount(12)
  await expect(message.locator('ol > li .katex-display')).toHaveCount(3)
  await expect(message.locator('.katex-error')).toHaveCount(0)
  await page.evaluate(async () => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('16px KaTeX_Main'))).toBe(true)

  await message.getByRole('button', { name: '复制', exact: true }).click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(content)
  const expand = message.getByRole('button', { name: '放大阅读', exact: true })
  await expand.click()
  const reader = page.getByRole('dialog')
  await expect(reader.locator('.katex')).toHaveCount(12)
  await expect(reader.locator('.katex-display')).toHaveCount(3)
  await expect(reader.getByRole('button', { name: '关闭', exact: true })).toBeInViewport()
  await page.keyboard.press('Escape')
  await expect(expand).toBeFocused()

  await message.getByRole('button', { name: '分享', exact: true }).click()
  const share = page.getByRole('dialog')
  await expect(share.locator('.katex')).toHaveCount(12)
  await expect(share.locator('.katex-display')).toHaveCount(3)
  await share.getByRole('button', { name: '复制', exact: true }).last().click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readImage().getSize().height), {
      timeout: 20_000,
    })
    .toBeGreaterThan(700)
  await mkdir('build/markdown-math', { recursive: true })
  await writeFile(
    'build/markdown-math/fraction-share.png',
    Buffer.from(
      await electron.evaluate(({ clipboard }) => clipboard.readImage().toPNG().toString('base64')),
      'base64',
    ),
  )
  await page.keyboard.press('Escape')

  await message.getByRole('link', { name: '公式文件', exact: true }).click()
  const file = page.locator('.file-preview')
  await expect(file.locator('.katex')).toHaveCount(12)
  await expect(file.locator('.katex-display')).toHaveCount(3)
  await file.getByRole('button', { name: '源码', exact: true }).click()
  await expect(file.locator('.katex')).toHaveCount(0)
  await file.locator('[data-hapi-code-copy]').click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(mathCalculation)
  await file.getByRole('button', { name: '预览', exact: true }).click()
  await expect(file.locator('.katex')).toHaveCount(12)
  expect(errors).toEqual([])
})

test('same-line display equations scroll within narrow single and split panes at the largest font', async ({
  desktop,
}) => {
  const { electron, page, server, errors } = desktop
  const wide = Array.from({ length: 30 }, (_, index) => `x_{${index}}`).join(' + ')
  server.messages.set('design', [fixtureMessage('wide-dollar-math', 1, mathCalculation + `\n\n$$${wide}$$`)])
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await expect(chat.locator('.katex')).toHaveCount(13)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'light' }))
  await mkdir('build/markdown-math', { recursive: true })

  for (const layout of ['single-light', 'split-dark']) {
    if (layout === 'split-dark') {
      await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
      await page.evaluate(() => window.desktop.updateSettings({ theme: 'dark' }))
    }
    const formula = chat.locator('.katex-display').last()
    await formula.scrollIntoViewIfNeeded()
    await expect(formula).toHaveCSS('overflow-x', 'auto')
    expect(await formula.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    expect(
      await chat.locator('.transcript').evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1)
    await formula.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    expect(await formula.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
    await formula.evaluate((element) => {
      element.scrollLeft = 0
    })
    await page.screenshot({ path: `build/markdown-math/${layout}.png`, animations: 'disabled' })
  }
  expect(errors).toEqual([])
})

test('the production preview worker renders dollar math and updates a long streamed reply', async ({
  desktop,
}) => {
  const { electron, page, server, errors } = desktop
  const intro = String.raw`# 后台公式

行内 $x^2$，金额 $5 和 $10。

$$-\frac{3}{2}$$

`
  const content = intro + '后续段落。\n\n'.repeat(400)
  const original = fixtureMessage('long-dollar-math', 1, content)
  server.messages.set('review', [original])
  await page.getByTestId('session-review').click()
  const message = page.getByTestId('chat-review').locator('.agent-message')
  await message.locator('.content-mode-buttons').getByRole('button', { name: '预览', exact: true }).click()
  const preview = message.getByRole('region', { name: 'Markdown 渲染预览' })
  await expect(preview.locator('.katex')).toHaveCount(2)
  await expect(preview.locator('.katex-display')).toHaveCount(1)
  await expect(preview).toContainText('金额 $5 和 $10。')

  const updated = content + '\n\n## 新公式\n\n$y^2$ 和 $$z^2$$'
  server.emit({
    type: 'message-received',
    sessionId: 'review',
    message: { ...fixtureMessage(original.id, original.seq ?? 1, updated), createdAt: original.createdAt },
  })
  await message.getByRole('button', { name: '跳到末尾', exact: true }).click()
  await expect(preview.getByRole('heading', { name: '新公式', exact: true })).toBeInViewport()
  await expect(preview.locator('annotation[encoding="application/x-tex"]')).toHaveText(['y^2', 'z^2'])
  await expect(preview.locator('.katex-display')).toHaveCount(1)
  await message.locator('.long-markdown [data-hapi-code-copy]').click()
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(updated)
  expect(errors).toEqual([])
})
