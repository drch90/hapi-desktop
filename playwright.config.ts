import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.GITHUB_ACTIONS === 'true' ? [['list'], ['github']] : 'list',
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' },
})
