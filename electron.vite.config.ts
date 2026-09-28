import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import manifest from './package.json'

const alias = {
  '@/components/MarkdownRenderer': resolve('src/renderer/components/Markdown.tsx'),
  '@': resolve('vendor/hapi/web/src'),
  '@desktop': resolve('src'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: { externalizeDeps: false, rollupOptions: { input: 'src/main/index.ts' } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: 'src/preload/index.ts',
        output: { format: 'cjs', entryFileNames: 'index.cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias, dedupe: ['react', 'react-dom'] },
    define: { __APP_VERSION__: JSON.stringify(manifest.version) },
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
