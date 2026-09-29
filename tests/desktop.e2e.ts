import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, stat, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { FixtureHub } from './fake-server'
import { version as appVersion } from '../package.json'

let electron: ElectronApplication
let page: Page
let server: FixtureHub
let dataDirectory: string
let errors: string[]

test.beforeEach(async () => {
  server = new FixtureHub()
  const url = await server.start()
  dataDirectory = await mkdtemp(join(tmpdir(), 'hapi-desktop-test-'))
  // Only the root-owned Linux test harness disables the Chromium sandbox.
  // Production BrowserWindow always has sandbox:true and never adds this flag.
  electron = await _electron.launch({
    args: ['--no-sandbox', `--user-data-dir=${dataDirectory}`, resolve('out/main/index.js')],
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
  // Existing cases start with history expanded; the default and its setting
  // are verified separately below and in the storage migration test.
  await page.evaluate(() => window.desktop.updateSettings({ collapseHistoryByDefault: false }))
})

test.afterEach(async () => {
  await electron?.close()
  await server?.close()
  if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true })
})

test('HAPI display tools preview images, play media and save exact file bytes', async () => {
  await page.getByTestId('session-design').click()
  const png = await readFile('resources/icon.png')
  // A synthetic one-second 16x16 VP8 video; no external media or runtime encoder needed.
  const video = Buffer.from(
    'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIxEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEfTbuMU6uEHFO7a1OsggIb7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNTguNDUuMTAwV0GNTGF2ZjU4LjQ1LjEwMESJiECPQAAAAAAAFlSua8KuAQAAAAAAADnXgQFzxYhkHXKudPvW+pyBACK1nIN1bmSGhVZfVlA4g4EBI+ODhB3NZQDgAQAAAAAAAAawgRC6gRASVMNnQJlzcwEAAAAAAAAnY8CAZ8gBAAAAAAAAGkWjh0VOQ09ERVJEh41MYXZmNTguNDUuMTAwc3MBAAAAAAAAXmPAi2PFiGQdcq50+9b6Z8gBAAAAAAAAIUWjh0VOQ09ERVJEh5RMYXZjNTguOTEuMTAwIGxpYnZweGfIokWjiERVUkFUSU9ORIeUMDA6MDA6MDEuMDAwMDAwMDAwAAAfQ7Z12OeBAKO8gQAAgLACAJ0BKhAAEAAARwiFhYiFhIgCAgJ1qgP4Agz9KAD+/00S//xYV/FhX8WFf/FhX/z8zu3F/OYAo5WBAfQAsQEABRCsABgAGFgv9AAIAAAcU7trkbuPs4EAt4r3gQHxggG+8IED',
    'base64',
  )
  const audio = Buffer.alloc(8044, 128)
  audio.write('RIFF', 0)
  audio.writeUInt32LE(8036, 4)
  audio.write('WAVEfmt ', 8)
  audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20)
  audio.writeUInt16LE(1, 22)
  audio.writeUInt32LE(8000, 24)
  audio.writeUInt32LE(8000, 28)
  audio.writeUInt16LE(1, 32)
  audio.writeUInt16LE(8, 34)
  audio.write('data', 36)
  audio.writeUInt32LE(8000, 40)
  const binary = Buffer.from([0, 255, 128, 10, 13, 65, 66])
  server.displayMedia('design', 'inline-png', 'preview.png', 'image/png', png)
  const imageCard = page.getByRole('article', { name: 'preview.png', exact: true })
  await expect
    .poll(() =>
      imageCard
        .getByRole('img', { name: 'preview.png' })
        .evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await imageCard.getByRole('img', { name: 'preview.png' }).click()
  await expect(page.getByRole('dialog', { name: 'preview.png' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'preview.png' })).toHaveCount(0)
  server.displayMedia('design', 'inline-video', 'clip.webm', 'video/webm', video)
  server.displayMedia('design', 'inline-audio', 'sound.wav', 'audio/wav', audio)
  server.displayMedia('design', 'inline-file', 'report.bin', 'application/octet-stream', binary)
  const videoCard = page.getByRole('article', { name: 'clip.webm', exact: true })
  const audioCard = page.getByRole('article', { name: 'sound.wav', exact: true })
  const fileCard = page.getByRole('article', { name: 'report.bin', exact: true })
  await expect(fileCard).toBeVisible()
  expect(
    server.requests.filter((r) => /generated-images\/inline-(video|audio|file)$/.test(r.path)),
  ).toHaveLength(0)
  await videoCard.getByRole('button', { name: '加载视频' }).click()
  await audioCard.getByRole('button', { name: '加载音频' }).click()
  for (const media of [videoCard.locator('video'), audioCard.locator('audio')]) {
    await expect
      .poll(() => media.evaluate((el) => (el as HTMLMediaElement).readyState))
      .toBeGreaterThanOrEqual(2)
    await media.evaluate(async (el) => {
      const m = el as HTMLMediaElement
      m.muted = true
      await m.play()
      m.pause()
    })
  }
  const output = join(dataDirectory, 'report.bin')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, output)
  await fileCard.getByRole('button', { name: '下载文件' }).click()
  await expect(fileCard.getByRole('status')).toHaveText('文件已保存')
  expect(await readFile(output)).toEqual(binary)
  const imageOutput = join(dataDirectory, 'preview.png')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, imageOutput)
  await imageCard.getByRole('button', { name: '下载文件' }).click()
  await expect(imageCard.getByRole('status')).toHaveText('文件已保存')
  expect(await readFile(imageOutput)).toEqual(png)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('button', { name: 'README.md', exact: true }).click()
  const textOutput = join(dataDirectory, 'README.md')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, textOutput)
  await page.locator('.file-preview').getByRole('button', { name: '下载文件' }).click()
  await expect(page.locator('.file-preview').getByRole('status')).toHaveText('文件已保存')
  expect(await readFile(textOutput, 'utf8')).toBe('# HAPI Desktop\n\nA workspace for remote agents.\n')
  expect((await readdir(dataDirectory)).some((name) => name.startsWith('.hapi-download-'))).toBe(false)
  expect(errors).toEqual([])
})

test('HAPI media errors can be retried; cancellation and write failure leave no saved file', async () => {
  await page.getByTestId('session-design').click()
  server.displayMedia('design', 'missing-png', 'later.png', 'image/png')
  const card = page.getByRole('article', { name: 'later.png' })
  await expect(card.getByRole('alert')).toContainText('文件不可用')
  server.generatedMedia.set('missing-png', {
    mimeType: 'image/png',
    content: await readFile('resources/icon.png'),
  })
  await card.getByRole('button', { name: '重试', exact: true }).click()
  await expect
    .poll(() =>
      card.getByRole('img', { name: 'later.png' }).evaluate((el) => (el as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0)
  await electron.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
  const before = server.requests.filter((r) => r.path.includes('/generated-images/')).length
  await card.getByRole('button', { name: '下载文件' }).click()
  await expect(card.getByRole('button', { name: '下载文件' })).toBeEnabled()
  expect(server.requests.filter((r) => r.path.includes('/generated-images/'))).toHaveLength(before)
  await expect(card.getByText('文件已保存')).toHaveCount(0)
  const existing = join(dataDirectory, 'keep-original.png')
  await writeFile(existing, 'original-file')
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, existing)
  server.generatedMedia.delete('missing-png')
  await card.getByRole('button', { name: '下载文件' }).click()
  await expect(card.getByRole('alert')).toContainText('文件不可用')
  expect(await readFile(existing, 'utf8')).toBe('original-file')
  server.generatedMedia.set('missing-png', {
    mimeType: 'image/png',
    content: await readFile('resources/icon.png'),
  })
  await electron.evaluate(
    ({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    },
    join(dataDirectory, 'missing', 'file.png'),
  )
  await card.getByRole('button', { name: '下载文件' }).click()
  await expect(card.getByRole('alert')).toContainText('无法保存文件')
  expect((await readdir(dataDirectory)).some((name) => name.startsWith('.hapi-download-'))).toBe(false)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await expect(card.getByRole('button', { name: '下载文件' })).toBeVisible()
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('HAPI downloads cannot cross a disconnect while the native save dialog is open', async () => {
  const output = join(dataDirectory, 'must-not-save.bin')
  server.generatedMedia.set('private-file', {
    content: Buffer.from('fixture-private-file'),
    mimeType: 'application/octet-stream',
  })
  await electron.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () =>
      new Promise((resolve) => {
        ;(globalThis as unknown as { finishSaveDialog: typeof resolve }).finishSaveDialog = resolve
      })
  })
  const pending = page.evaluate(() =>
    window.desktop.saveFile({
      source: { kind: 'generated', sessionId: 'design', imageId: 'private-file' },
      fileName: '../../private.bin',
    }),
  )
  await expect
    .poll(() =>
      electron.evaluate(
        () => typeof (globalThis as unknown as { finishSaveDialog?: unknown }).finishSaveDialog,
      ),
    )
    .toBe('function')
  await page.evaluate(() => window.desktop.disconnect())
  await electron.evaluate((_electron, filePath) => {
    ;(
      globalThis as unknown as { finishSaveDialog: (result: { canceled: boolean; filePath: string }) => void }
    ).finishSaveDialog({ canceled: false, filePath })
  }, output)
  expect(await pending).toMatchObject({ ok: false, error: { code: 'CONNECTION_CHANGED' } })
  expect(server.requests.some((r) => r.path.includes('/generated-images/private-file'))).toBe(false)
  await expect(stat(output)).rejects.toThrow()
})

test('two panes, isolated drafts, read-only files, approvals, rename and secure bridge', async () => {
  await page.getByTestId('session-design').click()
  const first = page.getByTestId('chat-design')
  await expect(first.getByText('会话始终在手边', { exact: true })).toBeVisible()
  await first.getByRole('textbox', { name: '发送消息…' }).fill('左侧的独立草稿')
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  const second = page.getByTestId('chat-review')
  await second.getByRole('textbox', { name: '发送消息…' }).fill('右侧的独立草稿')
  await expect(first.getByRole('textbox')).toHaveValue('左侧的独立草稿')
  await expect(second.getByRole('textbox')).toHaveValue('右侧的独立草稿')
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('button', { name: 'README.md', exact: true }).click()
  await expect(page.locator('.file-preview')).toContainText('A workspace for remote agents.')
  await page.getByRole('button', { name: '变更', exact: true }).click()
  await page.locator('.file-row').filter({ hasText: 'src/main.ts' }).first().click()
  await expect(page.locator('.unified-diff')).toContainText('+const hub = connectHub()')
  const review = server.sessions.get('review')!
  review.agentState = {
    requests: {
      'request-map-key': {
        tool: 'Bash',
        toolCallId: 'unrelated-tool-call',
        arguments: { command: 'bun test', description: '运行测试' },
        createdAt: Date.now(),
      },
    },
  }
  review.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await expect(second.locator('.approval-area')).toContainText('bun test')
  await second.getByRole('button', { name: '允许', exact: true }).click()
  await expect
    .poll(() => server.requests.filter((r) => r.path.includes('/permissions/')).map((r) => r.path))
    .toContain('/api/sessions/review/permissions/request-map-key/approve')
  await expect(second.locator('.approval-area')).toBeEmpty()
  await second.getByRole('button', { name: '重命名', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('连接与恢复 · 审查完成')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(second.locator('h1')).toHaveText('连接与恢复 · 审查完成')
  expect(
    await page.evaluate(() => ({
      node: typeof (window as unknown as { require?: unknown }).require,
      token: (window.desktop as unknown as { token?: string }).token,
      storage: JSON.stringify({ ...localStorage, ...sessionStorage }),
    })),
  ).toEqual({ node: 'undefined', token: undefined, storage: expect.not.stringContaining('fixture-secret') })
  const blocked = await page.evaluate(() =>
    window.desktop.request({ path: 'https://evil.example/api/sessions', method: 'GET' }),
  )
  expect(blocked.ok).toBe(false)
  expect(
    await electron.evaluate(({ BrowserWindow }) => {
      const p = (
        BrowserWindow.getAllWindows()[0].webContents as unknown as {
          getLastWebPreferences: () => Electron.WebPreferences
        }
      ).getLastWebPreferences()
      return [p.contextIsolation, p.sandbox, p.nodeIntegration]
    }),
  ).toEqual([true, true, false])
  await first.getByRole('textbox').fill('')
  await second.getByRole('textbox').fill('')
  await page.getByRole('button', { name: '变更', exact: true }).click()
  await page.locator('.file-row').filter({ hasText: 'src/main.ts' }).first().click()
  await expect(page.locator('.unified-diff')).toContainText('+const hub = connectHub()')
  const startedAt = Date.now() - 5200
  const completedAt = Date.now() - 200
  for (const message of [
    {
      id: 'tool-start',
      seq: 3,
      localId: null,
      createdAt: startedAt,
      content: {
        role: 'agent',
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            uuid: 'tool-start',
            timestamp: new Date(startedAt).toISOString(),
            message: {
              role: 'assistant',
              content: [
                { type: 'tool_use', id: 'test-command', name: 'Bash', input: { command: 'bun test' } },
              ],
            },
          },
        },
      },
    },
    {
      id: 'tool-end',
      seq: 4,
      localId: null,
      createdAt: completedAt,
      content: {
        role: 'agent',
        content: {
          type: 'output',
          data: {
            type: 'user',
            uuid: 'tool-end',
            timestamp: new Date(completedAt).toISOString(),
            message: {
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: 'test-command', content: 'All checks passed' }],
            },
          },
        },
      },
    },
  ]) {
    server.messages.get('review')!.push(message)
    server.emit({ type: 'message-received', sessionId: 'review', message })
  }
  await expect(second.getByTestId('tool-execution-times')).toContainText('5.0s')
  await page.screenshot({ path: 'build/desktop-preview.png', animations: 'disabled' })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: '主题', exact: true }).selectOption('dark')
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.screenshot({ path: 'build/desktop-dark-preview.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('uncertain delivery stays local until checked; resumed IDs migrate; closing hides without aborting', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  server.failSend = 'accepted'
  await chat.getByRole('textbox').fill('确认只发送一次')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '检查送达状态' })).toBeVisible()
  await page.reload()
  await expect(chat.getByRole('button', { name: '检查送达状态' })).toBeVisible()
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/design/messages' && r.method === 'POST'),
  ).toHaveLength(1)
  await chat.getByRole('button', { name: '检查送达状态' }).click()
  await expect(chat.getByRole('textbox')).toHaveValue('')
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/design/messages' && r.method === 'POST'),
  ).toHaveLength(1)
  server.failSend = 'absent'
  await chat.getByRole('textbox').fill('明确重试这条消息')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(chat.getByRole('button', { name: '检查送达状态' })).toBeVisible()
  await chat.getByRole('button', { name: '检查送达状态' }).click()
  server.failSend = 'none'
  await chat.getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(chat.getByRole('textbox')).toHaveValue('')
  const attempts = server.requests.filter(
    (r) => r.path === '/api/sessions/design/messages' && r.method === 'POST',
  )
  expect(attempts).toHaveLength(3)
  expect(attempts[1].body.localId).toBe(attempts[2].body.localId)
  await page.getByTestId('session-history').click()
  await page.getByTestId('chat-history').getByRole('textbox').fill('恢复并继续')
  await page.getByTestId('chat-history').getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByTestId('chat-resumed')).toBeVisible()
  expect(
    server.requests.some(
      (r) =>
        r.path === '/api/sessions/resumed/messages' && r.method === 'POST' && r.body.text === '恢复并继续',
    ),
  ).toBe(true)
  const aborts = server.requests.filter((r) => /\/(abort|archive)$/.test(r.path)).length
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  expect(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(
    false,
  )
  expect(server.streams.size).toBe(1)
  expect(server.requests.filter((r) => /\/(abort|archive)$/.test(r.path))).toHaveLength(aborts)
  // This is the same bridge event delivered by a native notification click.
  await electron.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.show()
    window.webContents.send('desktop:event', { type: 'open-session', sessionId: 'review' })
  })
  await expect(page.getByTestId('chat-review')).toBeVisible()
  expect(errors).toEqual([])
})

test('HAPI interactive questions preserve each provider answer contract', async () => {
  await page.getByTestId('session-design').click()
  await page.getByTestId('chat-design').getByRole('textbox').fill('回答后继续发送的草稿')
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('combobox', { name: '界面字号', exact: true }).selectOption('extra-large')
  await page.keyboard.press('Escape')
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  const codex = server.sessions.get('design')!
  codex.agentState = {
    requests: {
      'codex-question-request': {
        tool: 'request_user_input',
        toolCallId: 'codex-tool',
        createdAt: Date.now(),
        arguments: {
          questions: [
            {
              id: 'layout',
              question:
                '选择工作区布局\n\n需要同时处理多个远程 Linux 项目，并在不同会话之间检查工具调用、审批状态和执行结果。请根据窗口大小选择合适的布局。',
              options: [
                { label: '双栏', description: '同时查看两个会话' },
                { label: '单栏', description: '专注一个会话' },
                { label: '自动布局', description: '根据窗口大小调整布局，保留每个项目的草稿与滚动位置。' },
                {
                  label: '最后一个选项',
                  description: '完整说明：在窄窗口中也能阅读这段内容，滚动后可以选择。',
                },
              ],
            },
            { id: 'notes', question: '补充布局要求', options: [] },
          ],
        },
      },
    },
  }
  codex.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'design', data: codex })
  const first = page.getByTestId('chat-design')
  await expect(first.locator('.approval-area')).toContainText('选择工作区布局')
  const firstCard = first.locator('.pending-question')
  await expect(firstCard.locator('.markdown').first()).toHaveCSS('font-size', '15px')
  await expect(firstCard).toBeInViewport({ ratio: 1 })
  await expect(firstCard.getByRole('button', { name: '下一个 →', exact: true })).toBeInViewport({ ratio: 1 })
  await firstCard.getByRole('button', { name: /最后一个选项/ }).scrollIntoViewIfNeeded()
  await expect(firstCard.getByRole('button', { name: /最后一个选项/ })).toBeInViewport({ ratio: 1 })
  expect(await firstCard.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await firstCard.getByRole('button', { name: /最后一个选项/ }).click()
  await first.getByRole('button', { name: '收起问答', exact: true }).click()
  await expect(first.getByRole('textbox', { name: '发送消息…' })).toHaveValue('回答后继续发送的草稿')
  await first.getByRole('button', { name: '展开问答', exact: true }).click()
  await expect(firstCard.getByRole('button', { name: /最后一个选项/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await first.locator('.approval-area').getByRole('button', { name: /双栏/ }).click()
  await firstCard.getByRole('button', { name: '下一个 →', exact: true }).click()
  await expect(firstCard.getByText('补充布局要求')).toBeInViewport({ ratio: 1 })
  await firstCard.getByRole('textbox').fill('完整保留多题答案')
  await firstCard.getByRole('button', { name: '← 上一个', exact: true }).click()
  await expect(firstCard.getByRole('button', { name: /双栏/ })).toHaveAttribute('aria-pressed', 'true')
  await firstCard.getByRole('button', { name: '下一个 →', exact: true }).click()
  await expect(firstCard.getByRole('textbox')).toHaveValue('完整保留多题答案')
  await expect(firstCard.getByRole('button', { name: '提交', exact: true })).toBeInViewport({ ratio: 1 })
  await first.locator('.approval-area').getByRole('button', { name: '提交', exact: true }).click()
  await expect
    .poll(() => server.requests.find((r) => r.path.endsWith('/codex-question-request/approve'))?.body)
    .toEqual({
      answers: { layout: { answers: ['双栏'] }, notes: { answers: ['user_note: 完整保留多题答案'] } },
    })
  await expect(first.locator('.approval-area')).toBeEmpty()
  await expect(first.getByRole('textbox', { name: '发送消息…' })).toHaveValue('回答后继续发送的草稿')
  await page.getByTestId('session-review').click()
  const claude = server.sessions.get('review')!
  claude.agentState = {
    requests: {
      'claude-question-request': {
        tool: 'AskUserQuestion',
        toolCallId: 'claude-tool',
        createdAt: Date.now(),
        arguments: {
          questions: [
            {
              header: '验证',
              question:
                '需要验证哪些内容？\n\n请检查双栏、小窗口与特大字号的组合，确保可以阅读完整题目、滚动到最后一个选项，以及操作底部按钮。',
              multiSelect: true,
              options: [
                { label: '消息发送', description: '检查可靠送达' },
                { label: '交互问答', description: '检查答案格式' },
                { label: '文件预览', description: '确认完整内容不会被外层容器裁切，长路径也能阅读。' },
              ],
            },
            { header: '补充', question: '其他验证要求', options: [] },
          ],
        },
      },
    },
  }
  claude.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'review', data: claude })
  const second = page.getByTestId('chat-review')
  const secondCard = second.locator('.pending-question')
  await expect(
    secondCard
      .getByRole('checkbox', { name: /消息发送/ })
      .locator('span')
      .filter({ hasText: /^消息发送$/ })
      .last(),
  ).toHaveCSS('font-size', '15px')
  await expect(secondCard).toBeInViewport({ ratio: 1 })
  await expect(secondCard.getByRole('button', { name: '下一个 →', exact: true })).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: 'build/questions-small-preview.png', animations: 'disabled' })
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 850))
  await page.screenshot({ path: 'build/questions-preview.png', animations: 'disabled' })
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await second
    .locator('.approval-area')
    .getByRole('checkbox', { name: /消息发送/ })
    .click()
  await second
    .locator('.approval-area')
    .getByRole('checkbox', { name: /交互问答/ })
    .click()
  await secondCard.getByRole('checkbox', { name: /文件预览/ }).scrollIntoViewIfNeeded()
  await expect(secondCard.getByRole('checkbox', { name: /文件预览/ })).toBeInViewport({ ratio: 1 })
  await secondCard.getByRole('button', { name: '下一个 →', exact: true }).click()
  await secondCard.getByRole('radio', { name: /其他/ }).click()
  await secondCard.getByRole('textbox').fill('验证按钮始终可见')
  await expect(secondCard.getByRole('button', { name: '提交', exact: true })).toBeInViewport({ ratio: 1 })
  await second.locator('.approval-area').getByRole('button', { name: '提交', exact: true }).click()
  await expect
    .poll(() => server.requests.find((r) => r.path.endsWith('/claude-question-request/approve'))?.body)
    .toEqual({ answers: { '0': ['消息发送', '交互问答'], '1': ['验证按钮始终可见'] } })
  await expect(second.locator('.approval-area')).toBeEmpty()
  expect(errors).toEqual([])
})

test('message timestamps, copy and local share image export', async () => {
  await page.getByTestId('session-design').click()
  const message = page.getByTestId('chat-design').locator('.agent-message').first()
  await expect(message.locator('time')).toHaveAttribute('datetime', /T/)
  await expect(message.locator('time')).toContainText(/\d{2}:\d{2}:\d{2}/)
  await message.locator('.message-actions').getByRole('button', { name: '复制', exact: true }).click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('### 会话始终在手边')
  await message.getByRole('button', { name: '分享', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('会话始终在手边', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '复制', exact: true }).last().click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readImage().isEmpty()), { timeout: 20_000 })
    .toBe(false)
  const size = await electron.evaluate(({ clipboard }) => clipboard.readImage().getSize())
  expect(size.width).toBeGreaterThan(500)
  expect(size.height).toBeGreaterThan(300)
  const exportPath = resolve('build/message-share-preview.png')
  await rm(exportPath, { force: true })
  await electron.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await dialog.getByRole('button', { name: '下载', exact: true }).click()
  await expect.poll(async () => (await stat(exportPath).catch(() => null))?.size ?? 0).toBeGreaterThan(1000)
  expect(errors).toEqual([])
})

test('Enter preference persists and respects newline, Shift+Enter, shortcuts and IME composition', async () => {
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const input = chat.getByRole('textbox')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const setting = page.getByRole('combobox', { name: '回车键行为', exact: true })
  await expect(setting).toHaveValue('newline')
  await page.keyboard.press('Escape')
  await input.fill('第一行')
  await input.press('Enter')
  await input.press('a')
  await expect(input).toHaveValue('第一行\na')
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(0)
  await input.press('Control+Enter')
  await expect(input).toHaveValue('')
  expect(server.requests.find((r) => r.method === 'POST' && r.path.endsWith('/messages'))?.body.text).toBe(
    '第一行\na',
  )
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await setting.selectOption('send')
  await page.keyboard.press('Escape')
  await expect(chat.locator('.composer-toolbar')).toContainText('Shift+Enter 换行')
  await page.reload()
  await expect(chat.locator('.composer-toolbar')).toContainText('Shift+Enter 换行')
  await input.fill('输入法候选')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 })
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true })
  await input.press('Shift+Enter')
  await input.press('b')
  await expect(input).toHaveValue('输入法候选\nb')
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(1)
  await input.press('Enter')
  await expect(input).toHaveValue('')
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(2)
  expect(errors).toEqual([])
})

test('font size updates both panes and settings remain usable at the minimum window size', async () => {
  await page.getByTestId('session-design').click()
  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  const message = page.getByTestId('chat-design').locator('.markdown p').first()
  const before = await message.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  const commandButtons = page.locator('.composer').getByRole('button', { name: '原生命令', exact: true })
  for (const button of await commandButtons.all()) await expect(button).toHaveCSS('font-size', '12px')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  for (const [size, scale] of [
    ['small', 0.875],
    ['large', 1.125],
    ['extra-large', 1.25],
  ] as const) {
    await page.getByRole('combobox', { name: '界面字号', exact: true }).selectOption(size)
    await page.keyboard.press('Escape')
    for (const button of await commandButtons.all()) {
      await expect(button).toHaveCSS('font-size', `${12 * scale}px`)
      await expect(button).toHaveCSS('font-weight', '500')
      expect(
        await button.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight),
      ).toBe(true)
    }
    await expect(message).toHaveCSS('font-size', `${before * scale}px`)
    if (size === 'extra-large')
      await page.screenshot({ path: 'build/buttons-large-preview.png', animations: 'disabled' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
  }
  await expect
    .poll(() => message.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThan(before)
  await page.getByRole('combobox', { name: '回车键行为', exact: true }).selectOption('send')
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('combobox', { name: '回车键行为', exact: true }).scrollIntoViewIfNeeded()
  await expect(dialog.getByRole('combobox', { name: '回车键行为', exact: true })).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.height).toBeLessThanOrEqual(640)
  await page.keyboard.press('Escape')
  await expect(page.locator('.composer-toolbar').filter({ hasText: 'Shift+Enter 换行' })).toHaveCount(2)
  await page.reload()
  await expect
    .poll(() => message.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)))
    .toBeGreaterThan(before)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '界面字号', exact: true })).toHaveValue('extra-large')
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 850))
  await page.screenshot({ path: 'build/preferences-preview.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('thinking section excludes idle and background sessions, unread updates persist and history is muted', async () => {
  const design = server.sessions.get('design')!
  const review = server.sessions.get('review')!
  await page.getByTestId('session-review').click()
  const designRow = page.getByTestId('session-design')
  await expect(designRow).toHaveAttribute('data-status', 'ready')
  await expect(designRow.locator('.session-ready-icon')).toBeVisible()
  await expect(page.locator('.session-unread-badge')).toHaveCount(0)
  const historyRow = page.getByTestId('session-history')
  await expect(page.getByTestId('sessions-history')).not.toContainText('LINUX-DEV-01', { ignoreCase: true })
  await expect(page.getByTestId('sessions-history').locator('.group-machine')).toHaveCount(0)
  await expect(page.locator('.brand .version')).toHaveText(appVersion)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const defaultCollapse = page.getByRole('checkbox', { name: '默认折叠历史工作区' })
  await expect(page.getByRole('dialog')).toContainText(`HAPI Desktop ${appVersion}`)
  await defaultCollapse.click()
  await expect(defaultCollapse).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(historyRow).toBeHidden()
  await page.reload()
  await expect(historyRow).toBeHidden()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(defaultCollapse).toBeChecked()
  await defaultCollapse.click()
  await expect(defaultCollapse).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(historyRow).toBeVisible()
  await expect(historyRow).toHaveAttribute('data-status', 'history')
  expect(await historyRow.locator('.session-copy').evaluate((el) => getComputedStyle(el).color)).not.toBe(
    await designRow.locator('.session-copy').evaluate((el) => getComputedStyle(el).color),
  )
  const historyGroup = page.getByTestId('sessions-history').getByRole('button', { name: /折叠工作区/ })
  await expect(historyGroup).toHaveAttribute('aria-expanded', 'true')
  await historyGroup.click()
  await expect(historyRow).toBeHidden()
  await expect(
    page.getByTestId('sessions-history').getByRole('button', { name: /展开工作区/ }),
  ).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await expect(historyRow).toBeHidden()
  await page.getByRole('textbox', { name: '搜索会话' }).fill('OpenCode')
  await expect(historyRow).toBeVisible()
  await page.getByRole('textbox', { name: '搜索会话' }).fill('')
  await expect(historyRow).toBeHidden()
  await page
    .getByTestId('sessions-history')
    .getByRole('button', { name: /展开工作区/ })
    .focus()
  await page.keyboard.press('Enter')
  await expect(historyRow).toBeVisible()
  design.thinking = true
  design.updatedAt += 10
  server.emit({ type: 'session-updated', sessionId: 'design', data: design })
  const thinking = page.getByTestId('sessions-thinking')
  await expect(thinking.getByTestId('session-design')).toBeVisible()
  await expect(thinking.getByTestId('session-review')).toHaveCount(0)
  await expect(thinking.getByTestId('session-history')).toHaveCount(0)
  await expect(page.getByTestId('sessions-active').getByTestId('session-review')).toBeVisible()
  await expect(page.getByTestId('sessions-history').getByTestId('session-history')).toBeVisible()
  await expect(page.getByTestId('sessions-history')).toContainText('/home/dev/hapi-desktop')
  design.thinking = false
  design.updatedAt += 10
  server.emit({
    type: 'session-updated',
    sessionId: 'design',
    data: { thinking: false, updatedAt: design.updatedAt },
  })
  await expect(thinking).toHaveCount(0)
  await expect(designRow).toHaveAttribute('data-status', 'ready')
  await expect(designRow.locator('.session-unread-badge')).toHaveText('新动态')
  await page.reload()
  await expect(designRow.locator('.session-unread-badge')).toHaveText('新动态')
  await designRow.click()
  await expect(designRow.locator('.session-unread-badge')).toHaveCount(0)
  review.backgroundTaskCount = 1
  review.updatedAt += 10
  server.emit({
    type: 'session-updated',
    sessionId: 'review',
    data: { backgroundTaskCount: 1, updatedAt: review.updatedAt },
  })
  await expect(page.getByTestId('session-review')).toHaveAttribute('data-status', 'background')
  await expect(thinking).toHaveCount(0)
  design.thinking = true
  design.updatedAt += 10
  server.emit({ type: 'session-updated', sessionId: 'design', data: design })
  await expect(thinking.getByTestId('session-design')).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const grouping = page.getByRole('checkbox', { name: '按状态分区显示会话' })
  await expect(grouping).toBeChecked()
  await grouping.click()
  await expect(grouping).not.toBeChecked()
  await page.keyboard.press('Escape')
  await expect(thinking).toHaveCount(0)
  await expect(page.getByTestId('sessions-all').locator('.session-row')).toHaveCount(3)
  await page.reload()
  await expect(page.getByTestId('sessions-all').locator('.session-row')).toHaveCount(3)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(grouping).not.toBeChecked()
  await grouping.click()
  await expect(grouping).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(thinking.getByTestId('session-design')).toBeVisible()
  review.backgroundTaskCount = 0
  review.updatedAt += 10
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await expect(page.getByTestId('session-review').locator('.session-unread-badge')).toHaveText('新动态')
  await page.screenshot({ path: 'build/session-status-preview.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('session metadata and server-backed settings follow Codex, Claude and OpenCode capabilities', async () => {
  const design = server.sessions.get('design')!
  design.model = 'fixture-codex'
  design.modelReasoningEffort = 'high'
  design.createdAt = new Date('2026-09-20T08:10:00Z').getTime()
  design.updatedAt = new Date('2026-09-21T09:20:00Z').getTime()
  server.failModelDiscovery = true
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await expect(chat.getByTestId('createdAt')).toHaveAttribute('datetime', '2026-09-20T08:10:00.000Z')
  await expect(chat.getByTestId('updatedAt')).toHaveAttribute('datetime', '2026-09-21T09:20:00.000Z')
  await expect(chat.locator('.session-mode-summary')).toContainText('思考强度: high')
  await chat.getByRole('button', { name: '会话设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '会话设置' })
  const model = dialog.getByRole('combobox', { name: '模型', exact: true })
  const permission = dialog.getByRole('combobox', { name: '权限模式' })
  const effort = dialog.getByRole('combobox', { name: '思考强度' })
  const mode = dialog.getByRole('combobox', { name: '模式', exact: true })
  await mode.selectOption('plan')
  await expect(mode).toHaveValue('plan')
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/design/collaboration-mode').at(-1)?.body,
  ).toEqual({ mode: 'plan' })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(model).toBeDisabled()
  await expect(model.locator('option')).not.toContainText(['Sonnet'])
  server.failModelDiscovery = false
  await dialog.getByRole('button', { name: '刷新', exact: true }).click()
  await expect(model).toBeEnabled()
  await expect(effort.locator('option')).toHaveText(['默认', '低', '高', '超高'])
  await model.selectOption('fixture-fast')
  await expect(model).toHaveValue('fixture-fast')
  await expect(effort.locator('option')).toContainText(['中'])
  await effort.selectOption('medium')
  await expect(effort).toHaveValue('medium')
  await permission.selectOption('read-only')
  await expect(permission).toHaveValue('read-only')
  expect(server.requests.filter((r) => r.path === '/api/sessions/design/model').at(-1)?.body).toEqual({
    model: 'fixture-fast',
  })
  expect(server.requests.filter((r) => r.path.endsWith('/model-reasoning-effort')).at(-1)?.body).toEqual({
    modelReasoningEffort: 'medium',
  })
  expect(server.requests.filter((r) => r.path.endsWith('/permission-mode')).at(-1)?.body).toEqual({
    mode: 'read-only',
  })
  server.failSetting = true
  await permission.selectOption('yolo')
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(permission).toHaveValue('read-only')
  server.failSetting = false
  await page.keyboard.press('Escape')
  design.modelReasoningEffort = 'low'
  design.updatedAt += 60_000
  server.emit({
    type: 'session-updated',
    sessionId: 'design',
    data: { modelReasoningEffort: 'low', updatedAt: design.updatedAt },
  })
  await expect(chat.locator('.session-mode-summary')).toContainText('思考强度: low')
  await expect(chat.getByTestId('updatedAt')).toHaveAttribute(
    'datetime',
    new Date(design.updatedAt).toISOString(),
  )
  await page.reload()
  await expect(chat.locator('.session-mode-summary')).toContainText('权限模式: 只读')
  await expect(chat.locator('.session-mode-summary')).toContainText('模式: 计划')
  await chat.getByRole('button', { name: '会话设置', exact: true }).click()
  await expect(effort).toHaveValue('low')
  await page.screenshot({ path: 'build/session-settings-preview.png', animations: 'disabled' })
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large', theme: 'dark' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await expect(dialog).toBeInViewport({ ratio: 1 })
  await expect(effort).toBeInViewport({ ratio: 1 })
  await expect(dialog.locator('footer button')).toBeInViewport({ ratio: 1 })
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'normal', theme: 'light' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 940))
  await page.keyboard.press('Escape')

  await page.getByTestId('session-review').click()
  await page.getByTestId('chat-review').getByRole('button', { name: '会话设置', exact: true }).click()
  await expect(mode).toHaveCount(0)
  await model.selectOption('sonnet')
  await expect(model).toHaveValue('sonnet')
  await effort.selectOption('high')
  await expect(effort).toHaveValue('high')
  await permission.selectOption('acceptEdits')
  await expect(permission).toHaveValue('acceptEdits')
  expect(server.requests.filter((r) => r.path === '/api/sessions/review/effort').at(-1)?.body).toEqual({
    effort: 'high',
  })
  await effort.selectOption('')
  await expect(effort).toHaveValue('')
  expect(server.requests.filter((r) => r.path === '/api/sessions/review/effort').at(-1)?.body).toEqual({
    effort: null,
  })
  await page.keyboard.press('Escape')

  await page.getByTestId('session-history').click()
  const history = page.getByTestId('chat-history')
  await history.getByRole('button', { name: '会话设置', exact: true }).click()
  await expect(model).toBeDisabled()
  await expect(permission).toBeDisabled()
  await expect(dialog).toContainText('恢复会话后可修改设置。')
  const open = server.sessions.get('history')!
  open.active = true
  open.model = 'fixture/opencode'
  server.emit({ type: 'session-updated', sessionId: 'history', data: open })
  await expect(model).toBeEnabled()
  await expect(effort.locator('option')).toHaveText(['默认', 'Balanced', 'Deep'])
  await effort.selectOption('deep')
  await expect(effort).toHaveValue('deep')
  await model.selectOption('fixture/other')
  await expect(model).toHaveValue('fixture/other')
  await expect(effort.locator('option')).toContainText(['Minimal'])
  await expect(effort.locator('option[value="balanced"]')).toHaveCount(0)
  await permission.selectOption('plan')
  await expect(permission).toHaveValue('plan')
  expect(server.requests.filter((r) => r.path === '/api/sessions/history/model').at(-1)?.body).toEqual({
    model: 'fixture/other',
  })
  expect(
    server.requests.filter((r) => r.path === '/api/sessions/history/model-reasoning-effort').at(-1)?.body,
  ).toEqual({ modelReasoningEffort: 'deep' })
  open.agentState = { ...open.agentState, controlledByUser: true }
  open.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'history', data: open })
  await expect(model).toBeDisabled()
  await expect(effort).toBeDisabled()
  await expect(dialog).toContainText('此会话由终端控制。')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'build/session-metadata-preview.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('queued messages show content, survive reload, steer without SSE and cancel by server message ID', async () => {
  server.holdMessages = true
  const session = server.sessions.get('design')!
  session.thinking = true
  session.agentState!.steeringActive = true
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'design', data: session })
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  for (const text of ['先检查状态', '优先处理这一条']) {
    await chat.getByRole('textbox').fill(text)
    await chat.getByRole('button', { name: '发送', exact: true }).click()
    await expect(chat.getByRole('textbox')).toHaveValue('')
  }
  const queue = chat.getByRole('region', { name: '排队消息', exact: true })
  await expect(queue).toContainText('排队消息（2）')
  await expect(queue.locator('.queue-text')).toHaveText(['先检查状态', '优先处理这一条'])
  await expect(chat.locator('.transcript')).not.toContainText('先检查状态')
  await page.reload()
  await expect(queue.locator('.queue-text')).toHaveText(['先检查状态', '优先处理这一条'])
  await page.screenshot({ path: 'build/queue-preview.png', animations: 'disabled' })
  server.emitQueueEvents = false
  const secondId = server.messages
    .get('design')!
    .find((m) => (m.content as { content?: { text?: string } }).content?.text === '优先处理这一条')!.id
  await queue
    .getByRole('listitem')
    .filter({ hasText: '优先处理这一条' })
    .getByRole('button', { name: '优先插入', exact: true })
    .click()
  await expect(queue.locator('.queue-text')).toHaveText(['先检查状态'])
  await expect(chat.locator('.transcript')).toContainText('优先处理这一条')
  expect(server.requests.some((r) => r.path === `/api/sessions/design/messages/${secondId}/steer`)).toBe(true)
  await queue.getByRole('button', { name: '取消排队消息', exact: true }).click()
  await expect(queue).toHaveCount(0)
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(2)
  expect(server.requests.filter((r) => r.path.endsWith('/abort'))).toHaveLength(0)
  expect(errors).toEqual([])
})

test('priority insertion respects provider capability, retains failed messages and explicitly retries unknown outcomes', async () => {
  server.holdMessages = true
  const session = server.sessions.get('design')!
  session.thinking = true
  session.agentState!.steeringActive = true
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'design', data: session })
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  await chat.getByRole('textbox').fill('直接插入当前轮')
  await chat.locator('.composer').getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(chat.getByRole('textbox')).toHaveValue('')
  expect(
    server.requests.find((r) => r.method === 'POST' && r.path.endsWith('/messages'))?.body.deliveryMode,
  ).toBe('steer')
  await chat.getByRole('textbox').fill('需要保留的排队消息')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  const queue = chat.getByRole('region', { name: '排队消息', exact: true })
  server.steerOutcome = 'failed'
  await queue.getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(page.getByText('Turn already ended', { exact: true })).toBeVisible()
  await expect(queue).toContainText('需要保留的排队消息')
  server.steerOutcome = 'indeterminate'
  await queue.getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(queue.getByRole('button', { name: '重试发送', exact: true })).toBeVisible()
  await expect(queue.getByRole('button', { name: '优先插入', exact: true })).toHaveCount(0)
  await queue.getByRole('button', { name: '重试发送', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '重试发送', exact: true }).click()
  await expect(queue.getByRole('button', { name: '优先插入', exact: true })).toBeEnabled()
  server.steerOutcome = 'invoked'
  server.emitQueueEvents = false
  await queue.getByRole('button', { name: '优先插入', exact: true }).click()
  await expect(queue).toHaveCount(0)
  await page.getByTestId('session-review').click()
  const claude = page.getByTestId('chat-review')
  await claude.getByRole('textbox').fill('Claude 排队')
  await claude.getByRole('button', { name: '发送', exact: true }).click()
  await expect(claude.getByRole('region', { name: '排队消息', exact: true })).toContainText('Claude 排队')
  await expect(claude.getByRole('button', { name: '优先插入', exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('native commands discover project commands, autocomplete without sending and migrate shared clear results', async () => {
  server.commandEvents = true
  await page.getByTestId('session-design').click()
  const chat = page.getByTestId('chat-design')
  const input = chat.getByRole('textbox')
  const menu = chat.getByRole('region', { name: '原生命令', exact: true })
  await input.fill('/comp')
  await expect(menu.getByRole('button', { name: /\/compact/ })).toBeVisible()
  await input.press('Tab')
  await expect(input).toHaveValue('/compact ')
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(0)
  await input.press('Control+Enter')
  await expect(chat.locator('.event-message')).toContainText('Conversation compacted')
  expect(server.requests.find((r) => r.method === 'POST' && r.path.endsWith('/messages'))?.body.text).toBe(
    '/compact',
  )
  await input.fill('/project')
  await menu.getByRole('button', { name: /\/project-check/ }).click()
  await input.press('End')
  await input.press('a')
  await input.press('Control+Enter')
  await expect(input).toHaveValue('')
  expect(
    server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))[1].body.text,
  ).toBe('/project-check a')
  await expect(chat.locator('.event-message').last()).toContainText('Command result')
  await input.fill('gpt-example')
  await chat.locator('.composer').getByRole('button', { name: '原生命令', exact: true }).click()
  await menu.getByRole('button', { name: /^\/model / }).click()
  await expect(input).toHaveValue('/model gpt-example')
  await input.press('Control+Enter')
  await expect(input).toHaveValue('')
  expect(
    server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))[2].body.text,
  ).toBe('/model gpt-example')
  await input.fill('/')
  await expect(menu).toBeVisible()
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(input).toHaveValue(/^\/\S+ $/)
  const session = server.sessions.get('design')!
  session.metadata!.capabilities = { concurrentClients: true }
  session.metadataVersion++
  server.emit({ type: 'session-updated', sessionId: 'design', data: session })
  await input.fill('/clear')
  await chat.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByTestId('chat-cleared')).toBeVisible()
  expect(server.requests.filter((r) => r.path === '/api/sessions/design/clear')).toHaveLength(1)
  expect(server.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/messages'))).toHaveLength(3)
  expect(errors).toEqual([])
})

for (const [sessionId, flavor, command] of [
  ['review', 'Claude', '/compact'],
  ['history', 'OpenCode', '/init'],
]) {
  test(`${flavor} native commands use their own menu and survive session resume`, async () => {
    server.commandEvents = true
    await page.getByTestId(`session-${sessionId}`).click()
    const chat = page.getByTestId(`chat-${sessionId}`)
    await chat.getByRole('textbox').fill('/')
    const menu = chat.getByRole('region', { name: '原生命令', exact: true })
    await menu.getByRole('button', { name: new RegExp(`^${command} `) }).click()
    await expect(chat.getByRole('textbox')).toHaveValue(command + ' ')
    await chat.getByRole('textbox').press('Control+Enter')
    const target = sessionId === 'history' ? 'resumed' : sessionId
    const targetChat = page.getByTestId(`chat-${target}`)
    await expect(targetChat).toBeVisible()
    await expect(targetChat.locator('.event-message')).toContainText(
      command === '/compact' ? 'Conversation compacted' : 'Command result',
    )
    expect(
      server.requests.find((r) => r.method === 'POST' && r.path === `/api/sessions/${target}/messages`)?.body,
    ).toMatchObject({ text: command, deliveryMode: 'queue' })
    expect(errors).toEqual([])
  })
}

test('new sessions use the selected remote runner and safe default permissions', async () => {
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('目录', { exact: true }).fill('/home/dev/project')
  await dialog.getByRole('button', { name: '创建会话', exact: true }).click()
  await expect(page.getByTestId('chat-created')).toBeVisible()
  expect(server.requests.find((r) => r.path.endsWith('/spawn'))?.body).toMatchObject({
    directory: '/home/dev/project',
    agent: 'codex',
    permissionMode: 'default',
    yolo: false,
    startingMode: 'remote',
  })
  await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
  const launch = page.getByRole('dialog', { name: '新建会话', exact: true })
  await launch
    .getByRole('group', { name: '模型', exact: true })
    .getByRole('combobox')
    .selectOption('fixture-codex')
  await launch.getByRole('group', { name: '模式', exact: true }).getByRole('combobox').selectOption('plan')
  await launch
    .getByRole('group', { name: '思考强度', exact: true })
    .getByRole('combobox')
    .selectOption('xhigh')
  await launch
    .getByRole('group', { name: '权限模式', exact: true })
    .getByRole('combobox')
    .selectOption('read-only')
  await launch
    .getByRole('group', { name: '快速模式', exact: true })
    .getByRole('combobox')
    .selectOption('fast')
  await launch.getByRole('button', { name: '浏览', exact: true }).click()
  const browser = page.getByRole('dialog', { name: '浏览文件夹', exact: true })
  await browser.getByRole('button', { name: /^project/ }).click()
  await expect(browser.getByRole('button', { name: 'notes.txt' })).toHaveCount(0)
  await browser.getByRole('button', { name: '选择此文件夹', exact: true }).click()
  await expect(launch.getByLabel('目录', { exact: true })).toHaveValue('/home/dev/project')
  await expect(launch.getByRole('group', { name: '模式', exact: true }).getByRole('combobox')).toHaveValue(
    'plan',
  )
  await launch.locator('#session-type-worktree').check()
  await launch
    .getByRole('group', { name: '会话类型', exact: true })
    .getByRole('textbox')
    .fill('desktop-feature')
  await page.screenshot({ path: 'build/new-session-codex-preview.png', animations: 'disabled' })
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'extra-large' }))
  await expect(launch.getByRole('button', { name: '创建会话', exact: true })).toBeInViewport({ ratio: 1 })
  await launch.getByRole('button', { name: '创建会话', exact: true }).click()
  await expect(page.getByTestId('chat-created-2')).toBeVisible()
  expect(server.requests.filter((r) => r.path.endsWith('/spawn')).at(-1)?.body).toMatchObject({
    directory: '/home/dev/project',
    agent: 'codex',
    model: 'fixture-codex',
    modelReasoningEffort: 'xhigh',
    permissionMode: 'read-only',
    collaborationMode: 'plan',
    serviceTier: 'fast',
    sessionType: 'worktree',
    worktreeName: 'desktop-feature',
  })
  await page.evaluate(() => window.desktop.updateSettings({ fontSize: 'normal' }))
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 850))
  for (const agent of ['claude', 'opencode']) {
    await page.locator('.sidebar').getByRole('button', { name: '新建会话', exact: true }).click()
    await launch.getByLabel('Agent', { exact: true }).selectOption(agent)
    await launch.getByLabel('目录', { exact: true }).fill('/home/dev/project')
    const model = launch.getByRole('group', { name: '模型', exact: true }).getByRole('combobox')
    const reasoning = launch.getByRole('group', { name: '思考强度', exact: true }).getByRole('combobox')
    await model.selectOption(agent === 'claude' ? 'sonnet' : 'fixture/opencode')
    await reasoning.selectOption(agent === 'claude' ? 'high' : 'deep')
    await expect(launch.getByRole('group', { name: '模式', exact: true })).toHaveCount(0)
    if (agent === 'opencode') {
      await model.selectOption('fixture/other')
      await expect(reasoning).toHaveCount(0)
      await model.selectOption('fixture/opencode')
      await reasoning.selectOption('deep')
    }
    await launch
      .getByRole('group', { name: '权限模式', exact: true })
      .getByRole('combobox')
      .selectOption('plan')
    await page.screenshot({ path: `build/new-session-${agent}-preview.png`, animations: 'disabled' })
    await launch.getByRole('button', { name: '创建会话', exact: true }).click()
    await expect(launch).toHaveCount(0)
    const sent = server.requests.filter((r) => r.path.endsWith('/spawn')).at(-1)!.body
    expect(sent).toMatchObject({
      agent,
      permissionMode: 'plan',
      model: agent === 'claude' ? 'sonnet' : 'fixture/opencode',
    })
    expect(sent[agent === 'claude' ? 'effort' : 'modelReasoningEffort']).toBe(
      agent === 'claude' ? 'high' : 'deep',
    )
    expect(sent.collaborationMode).toBeUndefined()
  }
  expect(errors).toEqual([])
})

test('archived session deletion confirms, preserves failed requests and cleans tabs and drafts', async () => {
  await page.getByTestId('session-design').click()
  await expect(
    page.getByTestId('chat-design').getByRole('button', { name: '删除会话', exact: true }),
  ).toHaveCount(0)
  await page.getByTestId('chat-design').getByRole('textbox').fill('保留其他会话草稿')
  await page.getByTestId('session-history').click()
  const history = page.getByTestId('chat-history')
  await history.getByRole('textbox').fill('删除时清理这条草稿')
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.values(localStorage).some((value) => String(value).includes('删除时清理这条草稿')),
      ),
    )
    .toBe(true)
  await history.getByRole('button', { name: '删除会话', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '删除此会话？' })
  await expect(confirm).toContainText('OpenCode · 历史会话')
  await confirm.getByRole('button', { name: '取消', exact: true }).click()
  expect(server.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0)
  await history.getByRole('button', { name: '删除会话', exact: true }).click()
  server.failDelete = true
  await confirm.getByRole('button', { name: '删除会话', exact: true }).click()
  await expect(confirm).toContainText('请求失败')
  await expect(history).toBeVisible()
  await expect(page.getByTestId('session-history')).toBeVisible()
  server.failDelete = false
  server.emitDeleteEvents = false
  await confirm.getByRole('button', { name: '删除会话', exact: true }).click()
  await expect(history).toHaveCount(0)
  await expect(page.getByTestId('session-history')).toHaveCount(0)
  await expect(page.getByTestId('chat-design')).toBeVisible()
  await expect(page.getByTestId('chat-design').getByRole('textbox')).toHaveValue('保留其他会话草稿')
  await page.reload()
  await expect(page.getByTestId('session-history')).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) => String(value).includes('删除时清理这条草稿')),
    ),
  ).toBe(false)
  const design = page.getByTestId('chat-design')
  await design.getByRole('button', { name: '归档', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '归档', exact: true }).click()
  await expect(design.getByRole('button', { name: '删除会话', exact: true })).toBeVisible()
  server.sessions.delete('design')
  server.emit({ type: 'session-removed', sessionId: 'design' })
  await expect(design).toHaveCount(0)
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) => String(value).includes('保留其他会话草稿')),
    ),
  ).toBe(false)
  expect(errors).toEqual([])
})

test('background notifications deduplicate and activate their session', async () => {
  await electron.evaluate(({ Notification }) => {
    Notification.isSupported = () => true
    const state = globalThis as unknown as { notices: Electron.Notification[] }
    state.notices = []
    Notification.prototype.show = function () {
      state.notices.push(this)
    }
  })
  await page.getByTestId('session-review').click()
  const review = server.sessions.get('review')!
  review.agentState = { requests: { visible: { tool: 'Bash', arguments: {}, createdAt: Date.now() } } }
  review.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await expect(page.getByTestId('chat-review').locator('.approval-area')).not.toBeEmpty()
  expect(
    await electron.evaluate(() => (globalThis as unknown as { notices: unknown[] }).notices.length),
  ).toBe(0)
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  review.agentState.requests!.hidden = { tool: 'Bash', arguments: { command: 'test' }, createdAt: Date.now() }
  review.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await expect
    .poll(() => electron.evaluate(() => (globalThis as unknown as { notices: unknown[] }).notices.length))
    .toBe(1)
  server.emit({ type: 'session-updated', sessionId: 'review', data: review })
  await electron.evaluate(() =>
    (globalThis as unknown as { notices: Electron.Notification[] }).notices[0].emit('click'),
  )
  await expect(page.getByTestId('chat-review')).toBeVisible()
  expect(
    await electron.evaluate(() => (globalThis as unknown as { notices: unknown[] }).notices.length),
  ).toBe(1)
  expect(errors).toEqual([])
})
