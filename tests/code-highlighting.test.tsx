import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { CodeBlock } from '@/components/CodeBlock'
import { resolveFileLanguage, useShikiHighlighter } from '@/lib/shiki'

vi.mock('@/lib/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}))
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))

afterEach(() => cleanup())

const examples = [
  ['C++', 'src/main.hpp', '#include <vector>\nint main() { return 0; }'],
  ['C#', 'src/App.cs', 'public class App { public int Count = 1; }'],
  ['rb', 'src/main.rb', 'def greet(name)\n  puts "Hello #{name}"\nend'],
  ['vue', 'src/App.vue', '<template><p>{{ count }}</p></template>\n<script setup>const count = 1</script>'],
  ['svelte', 'src/App.svelte', '<script>let count = 0;</script>\n<button>{count}</button>'],
  ['jsonc', 'tsconfig.json', '{\n  // comments are supported\n  "strict": true,\n}'],
  ['json5', 'config.json5', "{ enabled: true, label: 'test', }"],
  ['batch', 'scripts/build.cmd', '@echo off\necho %PATH%'],
  ['dart', 'lib/main.dart', "void main() { print('hello'); }"],
  ['lua', 'scripts/main.lua', 'local value = 1\nprint(value)'],
  ['R', 'analysis.R', 'values <- c(1, 2, 3)\nmean(values)'],
  ['objc', 'src/App.m', '@interface App : NSObject\n@end'],
  ['cmake', 'CMakeLists.txt', 'cmake_minimum_required(VERSION 3.20)\nproject(example)'],
  ['nginx', 'deploy/nginx.conf', 'server { listen 8080; }'],
  ['protobuf', 'messages.proto', 'syntax = "proto3";\nmessage Item { string name = 1; }'],
  ['http', 'requests.http', 'GET /api/items HTTP/1.1\nAccept: application/json'],
  ['dotenv', '.env.example', 'PORT=8080\nENABLED=true'],
  ['tex', 'paper.tex', '\\frac{1}{2}'],
  ['mmd', 'diagram.mmd', 'flowchart LR\n  A --> B'],
  ['pwsh', 'scripts/setup.psm1', '$value = Get-Date\nWrite-Output $value'],
  ['docker', 'deploy/Dockerfile.dev', 'FROM node:22\nWORKDIR /app'],
  ['makefile', 'Makefile', 'all:\n\tcc main.c -o main'],
  ['sh', '.bashrc', 'export PATH="$PATH:/opt/bin"'],
] as const

describe('code highlighting', () => {
  it.each(examples)(
    'highlights %s fences and matching files without changing source',
    async (language, path, code) => {
      const { container } = render(
        <>
          <CodeBlock code={code} language={language} />
          <CodeBlock code={code} language={resolveFileLanguage(path)} />
        </>,
      )
      const blocks = [...container.querySelectorAll('[data-hapi-code-block]')]
      await waitFor(
        () => {
          for (const block of blocks) {
            expect(block.querySelector('[data-code-cell] span[style*="--shiki-light"]')).not.toBeNull()
            expect(
              [...block.querySelectorAll('[data-code-cell]')].map((cell) => cell.textContent).join('\n'),
            ).toBe(code)
          }
        },
        { timeout: 10_000 },
      )
    },
  )

  it('keeps streaming updates and unsupported languages visible before highlighting completes', async () => {
    function Example({ code, language }: { code: string; language: string }) {
      const highlighted = useShikiHighlighter(code, language)
      return (
        <>
          <pre data-inline>{highlighted ?? code}</pre>
          <CodeBlock code={code} language={language} />
        </>
      )
    }
    const { container, rerender } = render(<Example code="const old = 1" language="language-JS" />)
    await waitFor(() => expect(container.querySelector('[data-inline] span[style]')).not.toBeNull())
    const code = 'const current = 2\n\n  // keep indentation'
    rerender(<Example code={code} language="js" />)
    expect(container.querySelector('[data-inline]')?.textContent).toBe(code)
    expect([...container.querySelectorAll('[data-code-cell]')].map((cell) => cell.textContent)).toEqual(
      code.split('\n'),
    )
    await waitFor(() => expect(container.querySelector('[data-inline] span[style]')).not.toBeNull())
    rerender(<Example code="plain <source>" language="unsupported-language" />)
    expect(container.querySelector('[data-inline]')?.textContent).toBe('plain <source>')
    expect(container.querySelector('[data-inline] span')).toBeNull()
    expect(container.querySelector('[data-code-cell]')?.textContent).toBe('plain <source>')
  })

  it('resolves Windows paths by basename and leaves extensionless unknown files unclassified', () => {
    expect(resolveFileLanguage('C:\\project.with.dots\\Dockerfile')).toBe('dockerfile')
    expect(resolveFileLanguage('C:\\project.with.dots\\src\\main.CXX')).toBe('cpp')
    expect(resolveFileLanguage('/project.with.dots/LICENSE')).toBeUndefined()
    expect(resolveFileLanguage('file.')).toBeUndefined()
  })
})
