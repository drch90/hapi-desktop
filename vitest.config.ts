import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const alias = {
  '@/components/MarkdownRenderer': resolve('src/renderer/components/Markdown.tsx'),
  '@': resolve('vendor/hapi/web/src'),
}
export default defineConfig({
  test: {
    maxWorkers: 2,
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'desktop',
          include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
          environment: 'jsdom',
          clearMocks: true,
        },
      },
      {
        root: resolve('vendor/hapi/web'),
        resolve: { alias },
        test: {
          name: 'hapi-contract',
          environment: 'jsdom',
          pool: 'forks',
          env: { HAPI_UPSTREAM_TEST_CWD: resolve('vendor/hapi/web') },
          setupFiles: [resolve('tests/upstream-cwd.ts')],
          include: [
            'src/chat/fixtures.test.ts',
            'src/lib/sessionPatch.fixtures.test.ts',
            'src/lib/message-window-store.fixtures.test.ts',
            'src/lib/messages.test.ts',
            'src/chat/toolGroups.test.ts',
            'src/chat/codexCommandPresentation.test.ts',
            'src/components/ToolCard/ToolGroupCard.test.tsx',
            'src/components/HermesModelPicker.test.tsx',
          ],
        },
      },
    ],
  },
})
