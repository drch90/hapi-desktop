import { test as base, expect, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FixtureHub } from '../fake-server'
import { closeTestElectron } from '../electron-cleanup'

export type DesktopFixture = {
  electron: ElectronApplication
  page: Page
  server: FixtureHub
  errors: string[]
}

export const test = base.extend<{ desktop: DesktopFixture }>({
  desktop: async ({}, use) => {
    const server = new FixtureHub()
    const directory = await mkdtemp(join(tmpdir(), 'hapi-desktop-test-'))
    let electron: ElectronApplication | undefined
    try {
      const url = await server.start()
      // Only the root-owned Linux test harness disables Chromium's sandbox.
      electron = await _electron.launch({
        args: ['--no-sandbox', `--user-data-dir=${directory}`, resolve('out/main/index.js')],
        cwd: process.cwd(),
        env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      })
      const page = await electron.firstWindow()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.getByLabel('Hub 地址', { exact: true }).fill(url)
      await page.getByLabel('访问令牌', { exact: true }).fill('fixture-secret-do-not-persist')
      await page.getByRole('button', { name: '连接', exact: true }).click()
      await expect(page.getByTestId('session-design')).toBeVisible()
      await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 960))
      await use({ electron, page, server, errors })
    } finally {
      try {
        await closeTestElectron(electron)
      } finally {
        await server.close()
        await rm(directory, { recursive: true, force: true })
      }
    }
  },
})

export { expect } from '@playwright/test'
