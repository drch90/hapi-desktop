import { mkdir } from 'node:fs/promises'
import { fixtureSession } from './fake-server'
import { test, expect } from './fixtures/desktop'

test('compact sidebar keeps workspace actions and named CLI logos usable', async ({ desktop }) => {
  const { page, server, electron, errors } = desktop
  for (const [id, name, flavor, active] of [
    ['agy-sidebar', '对齐 Antigravity 原生命令', 'agy', true],
    ['claude-sidebar', '梳理桌面交互与可访问性', 'claude', false],
    ['pi-sidebar', '检查消息送达与草稿恢复', 'pi', false],
    ['hermes-sidebar', '整理项目说明', 'hermes', false],
  ] as const) {
    const session = fixtureSession(id, name, flavor, active)
    session.thinking = active
    server.sessions.set(id, session)
    server.messages.set(id, [])
  }
  await page.evaluate(() => window.desktop.updateSettings({ collapseHistoryByDefault: false }))
  await page.reload()
  await page.getByTestId('session-design').click()
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 800))
  const sidebar = page.locator('.sidebar')
  const tree = sidebar.locator('.session-tree')
  const group = tree.locator('.session-group').filter({ has: page.getByTestId('session-history') })
  const heading = group.locator('.workspace-group-heading')
  const toggle = group.locator('.workspace-group-toggle')
  const menu = page.getByRole('menu', { name: '工作区分组', exact: true })
  await expect(tree).not.toContainText('linux-dev-01')
  await expect(heading.locator('.group-name')).toHaveText('hapi-desktop')
  await expect(heading.getByRole('button')).toHaveCount(2)
  for (const [id, label] of [
    ['design', 'Codex'],
    ['review', 'Claude'],
    ['history', 'OpenCode'],
    ['agy-sidebar', 'Antigravity'],
    ['pi-sidebar', 'Pi'],
    ['hermes-sidebar', 'Hermes'],
  ]) {
    const icon = page.getByTestId(`session-${id}`).getByRole('img', { name: label, exact: true })
    await icon.scrollIntoViewIfNeeded()
    await expect(icon).toBeVisible()
    await expect(icon).toHaveAttribute('title', label)
  }
  await tree.evaluate((element) => {
    element.scrollTop = 0
  })
  const brand = sidebar.locator('.brand')
  expect((await brand.boundingBox())?.height).toBeLessThanOrEqual(52)
  await mkdir('build/sidebar-preview', { recursive: true })
  await page.screenshot({ path: 'build/sidebar-preview/light.png', animations: 'disabled' })
  await heading.click({ button: 'right' })
  const copy = menu.getByRole('menuitem', { name: '复制路径', exact: true })
  await expect(copy).toBeFocused()
  await expect(copy).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: 'build/sidebar-preview/context-menu.png', animations: 'disabled' })
  await copy.click()
  await expect
    .poll(() => electron.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe('/home/dev/hapi-desktop')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  await page.getByRole('button', { name: '双栏分屏', exact: true }).click()
  await page.locator('.chat-pane').nth(1).click()
  await page.getByTestId('session-review').click()
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(920, 640))
  await page.evaluate(() =>
    window.desktop.updateSettings({ theme: 'dark', fontSize: 'extra-large', locale: 'fr' }),
  )
  const resize = page.locator('.sidebar-resizer').getByRole('separator')
  await resize.focus()
  await resize.press('Home')
  await expect(sidebar).toHaveCSS('width', '220px')
  await expect(brand.locator('.version')).toBeInViewport({ ratio: 1 })
  const collapse = sidebar.locator('.sidebar-rail > button').first()
  await expect(collapse).toBeInViewport({ ratio: 1 })
  expect(await brand.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await collapse.click()
  await expect(sidebar).toHaveClass(/collapsed/)
  await collapse.click()
  await expect(sidebar).not.toHaveClass(/collapsed/)
  await resize.dblclick()
  await page.screenshot({ path: 'build/sidebar-preview/dark-narrow.png', animations: 'disabled' })
  expect(errors).toEqual([])
})

test('workspace copy stays keyboard accessible while filtering an offline machine or missing a path', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  const path = '/home/dev/离线项目/full path'
  server.machines.push({ ...server.machines[0], id: 'sidebar-offline', active: false })
  const offline = fixtureSession('sidebar-copy', '离线项目', 'codex', false)
  offline.metadata = {
    name: '离线项目',
    host: 'linux-offline',
    machineId: 'sidebar-offline',
    flavor: 'codex',
    path,
  }
  const noPath = fixtureSession('sidebar-no-path', '缺少路径', 'codex', false)
  noPath.metadata = null
  server.sessions.set(offline.id, offline)
  server.sessions.set(noPath.id, noPath)
  await page.reload()

  const search = page.getByRole('textbox', { name: '搜索会话', exact: true })
  const group = page.locator('.session-group').filter({ has: page.getByTestId('session-sidebar-copy') })
  const heading = group.locator('.workspace-group-heading')
  const toggle = group.locator('.workspace-group-toggle')
  const menu = page.getByRole('menu', { name: '工作区分组', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await search.fill('sidebar-copy')
  await expect(toggle).toBeDisabled()
  await expect(group.getByRole('button', { name: /在此目录新建会话/ })).toBeDisabled()
  await heading.focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu.getByRole('menuitem', { name: '复制路径', exact: true })).toBeFocused()
  await expect(menu.getByRole('menuitem', { name: '全部展开', exact: true })).toBeDisabled()
  await expect(menu.getByRole('menuitem', { name: '全部折叠', exact: true })).toBeDisabled()
  await page.keyboard.press('Enter')
  await expect.poll(() => electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(path)
  await expect(menu.getByRole('menuitem', { name: '已复制', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(heading).toBeFocused()
  await expect(search).toHaveValue('sidebar-copy')

  await search.fill('sidebar-no-path')
  const unknownHeading = page
    .locator('.session-group')
    .filter({ has: page.getByTestId('session-sidebar-no-path') })
    .locator('.workspace-group-heading')
  await unknownHeading.focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu).toBeFocused()
  await expect(menu.getByRole('menuitem', { name: '复制路径', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(unknownHeading).toBeFocused()
  await search.fill('')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(errors).toEqual([])
})
