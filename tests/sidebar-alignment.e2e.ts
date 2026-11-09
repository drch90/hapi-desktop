import { mkdir } from 'node:fs/promises'
import { fixtureSession } from './fake-server'
import { test, expect } from './fixtures/desktop'

test('workspace create buttons share a column and align with titles at every sidebar size', async ({
  desktop,
}) => {
  const { page, server, electron, errors } = desktop
  const projects = [
    { path: '/home/dev/a-short', count: 1 },
    { path: '/home/dev/b-long-project-name-for-sidebar-alignment', count: 12 },
    { path: '/home/dev/c-中文目录与较长的项目名称', count: 100 },
  ]
  for (const [projectIndex, project] of projects.entries()) {
    for (let index = 0; index < project.count; index++) {
      const session = fixtureSession(
        `alignment-${projectIndex}-${index}`,
        `历史会话 ${index + 1}`,
        'codex',
        false,
      )
      session.metadata = {
        name: `历史会话 ${index + 1}`,
        path: project.path,
        host: 'linux-dev-01',
        machineId: 'linux-1',
        flavor: 'codex',
      }
      server.sessions.set(session.id, session)
    }
  }
  await page.evaluate(() => window.desktop.updateSettings({ collapseHistoryByDefault: true }))
  await page.reload()
  await page.getByTestId('session-design').click()
  await mkdir('build/sidebar-alignment', { recursive: true })
  const headings = page.getByTestId('sessions-history').locator('.workspace-group-heading')
  await expect(headings).toHaveCount(4)
  const sidebar = page.locator('.sidebar')
  const resize = page.locator('.sidebar-resizer').getByRole('separator')
  for (const [theme, fontSize, locale, width, height] of [
    ['light', 'normal', 'zh', 1180, 900],
    ['dark', 'extra-large', 'fr', 920, 640],
  ] as const) {
    await electron.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
      { width, height },
    )
    await page.evaluate((settings) => window.desktop.updateSettings(settings), { theme, fontSize, locale })
    if (theme === 'dark') {
      await page.getByRole('button', { name: 'Vue partagée', exact: true }).click()
      await resize.focus()
      await resize.press('Home')
      await expect(sidebar).toHaveCSS('width', '220px')
    }
    await headings.last().scrollIntoViewIfNeeded()
    await page.screenshot({ path: `build/sidebar-alignment/${theme}.png`, animations: 'disabled' })
    const positions = await headings.evaluateAll((elements) =>
      elements.map((element) => {
        const name = element.querySelector('.group-name')
        const plus = element.querySelector('.workspace-group-actions button')
        const count = element.querySelector('.workspace-group-count')
        const chevron = element.querySelector('.workspace-group-toggle svg')
        if (!name || !plus || !count || !chevron)
          throw new Error('Workspace title, count and create button must be present')
        const nameBox = name.getBoundingClientRect()
        const plusBox = plus.getBoundingClientRect()
        const countBox = count.getBoundingClientRect()
        const chevronBox = chevron.getBoundingClientRect()
        return {
          nameY: nameBox.y + nameBox.height / 2,
          plusY: plusBox.y + plusBox.height / 2,
          countY: countBox.y + countBox.height / 2,
          chevronY: chevronBox.y + chevronBox.height / 2,
          plusX: plusBox.x + plusBox.width / 2,
        }
      }),
    )
    const plusXs = positions.map((position) => position.plusX)
    expect(
      Math.max(...plusXs) - Math.min(...plusXs),
      'All create buttons must share one column',
    ).toBeLessThanOrEqual(1)
    for (const position of positions) {
      expect(
        Math.abs(position.plusY - position.nameY),
        'Create button must align with the project title',
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(position.countY - position.nameY),
        'Count must align with the project title',
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(position.chevronY - position.nameY),
        'Collapse arrow must align with the project title',
      ).toBeLessThanOrEqual(1)
    }
  }
  const create = headings
    .filter({ hasText: projects[1].path })
    .getByRole('button', { name: /Nouvelle session dans ce dossier/ })
  await create.scrollIntoViewIfNeeded()
  await expect(create).toBeInViewport({ ratio: 1 })
  await create.click()
  const dialog = page.getByRole('dialog', { name: 'Nouvelle session', exact: true })
  await expect(dialog.getByLabel('Dossier', { exact: true })).toHaveValue(projects[1].path)
  expect(errors).toEqual([])
})
