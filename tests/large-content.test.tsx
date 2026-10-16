import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createHighlighterCore } from 'shiki/core'
import { diffLines } from 'diff'
import ReactMarkdown from 'react-markdown'
import { CodeBlock } from '@/components/CodeBlock'
import { DiffView } from '@/components/DiffView'
import { DiffDisplay, isBinaryContent } from '@/routes/sessions/file'
import { decodeBase64 } from '@/lib/utils'
import {
  canHighlightText,
  isLargeText,
  paginateText,
  TEXT_PAGE_CHARS,
  TEXT_PAGE_LINES,
} from '@/lib/text-rendering'
import { MarkdownRenderer } from '../src/renderer/components/Markdown'

const { copy } = vi.hoisted(() => ({ copy: vi.fn() }))
vi.mock('@/lib/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useCopyToClipboard', () => ({ useCopyToClipboard: () => ({ copied: false, copy }) }))
vi.mock('shiki/core', () => ({ createHighlighterCore: vi.fn() }))
vi.mock('diff', () => ({ diffLines: vi.fn() }))
vi.mock('react-markdown', () => ({ default: vi.fn(() => null) }))

afterEach(() => cleanup())

describe('bounded text rendering', () => {
  it.each([
    '',
    'ordinary text\n',
    '\n'.repeat(10_000),
    'const value = "中文😀";\r\n'.repeat(10_000),
    'x'.repeat(TEXT_PAGE_CHARS - 1) + '😀' + 'z'.repeat(TEXT_PAGE_CHARS),
    'x'.repeat(TEXT_PAGE_CHARS - 1) + '\r\n' + 'z'.repeat(TEXT_PAGE_CHARS),
    'long-line-'.repeat(100_000),
  ])('preserves the complete source across bounded pages (%#)', (text) => {
    const pages = paginateText(text)
    expect(pages.map((page) => text.slice(page.start, page.end)).join('')).toBe(text)
    for (const page of pages) {
      const content = text.slice(page.start, page.end)
      expect(content.length).toBeLessThanOrEqual(TEXT_PAGE_CHARS)
      expect(content.replace(/\n$/, '').split('\n').length).toBeLessThanOrEqual(TEXT_PAGE_LINES)
      expect(content.isWellFormed()).toBe(true)
      expect(page.startLine).toBe(text.slice(0, page.start).split('\n').length)
      if (page.end < text.length) expect(content.endsWith('\r')).toBe(false)
    }
  })

  it('bounds line count and long lines independently of total text length', () => {
    expect(isLargeText('x\n'.repeat(TEXT_PAGE_LINES))).toBe(false)
    expect(isLargeText('x\n'.repeat(TEXT_PAGE_LINES + 1))).toBe(true)
    expect(canHighlightText('const small = 1')).toBe(true)
    expect(canHighlightText('x'.repeat(2_000))).toBe(false)
    expect(canHighlightText('x\n'.repeat(1_000))).toBe(false)
  })

  it('renders a bounded number of rows, reaches the last line and copies the entire output', () => {
    const code = Array.from({ length: 10_000 }, (_, index) => `const row${index + 1} = ${index};`).join('\n')
    const { container, getByRole } = render(
      <CodeBlock code={code} language="typescript" startLineNumber={51} />,
    )
    expect(container.querySelectorAll('[data-code-cell]').length).toBeLessThanOrEqual(TEXT_PAGE_LINES)
    expect(container.querySelector('[data-line-number]')?.textContent).toBe('51')
    fireEvent.click(getByRole('button', { name: 'text.preview.last' }))
    expect(container.textContent).toContain('const row10000 = 9999;')
    expect(
      container.querySelectorAll('[data-line-number]')[
        container.querySelectorAll('[data-line-number]').length - 1
      ].textContent,
    ).toBe('10050')
    fireEvent.click(getByRole('button', { name: 'code.copy' }))
    expect(copy).toHaveBeenCalledWith(code)
    expect(createHighlighterCore).not.toHaveBeenCalled()
  })

  it('follows new output after choosing the last section and clamps after replacement', () => {
    const code = 'line\n'.repeat(1_000)
    const { container, getByRole, rerender } = render(<CodeBlock code={code} />)
    fireEvent.click(getByRole('button', { name: 'text.preview.last' }))
    rerender(<CodeBlock code={code + 'more\n'.repeat(1_000) + 'FINAL'} />)
    expect(container.textContent).toContain('FINAL')
    rerender(<CodeBlock code="replacement" />)
    expect(container.querySelector('[data-code-cell]')?.textContent).toBe('replacement')
    expect(container.querySelector('[data-text-pager]')).toBeNull()
  })

  it('keeps large collapsed previews free of nested buttons', () => {
    const { container } = render(
      <button>
        <CodeBlock
          code={'line\n'.repeat(10_000)}
          collapseLongContent
          showCopyButton={false}
          showWrapToggle={false}
        />
      </button>,
    )
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(container.querySelectorAll('[data-code-cell]').length).toBeLessThanOrEqual(TEXT_PAGE_LINES)
  })

  it('bypasses synchronous Markdown parsing for large output and keeps its tail accessible', () => {
    const { container, getByRole } = render(
      <MarkdownRenderer
        content={'| a | b |\n|---|---|\n' + '| **row** | value |\n'.repeat(20_000) + 'END OF OUTPUT'}
      />,
    )
    expect(ReactMarkdown).not.toHaveBeenCalled()
    expect(container.querySelectorAll('*').length).toBeLessThan(1_000)
    fireEvent.click(getByRole('button', { name: 'text.preview.last' }))
    expect(container.textContent).toContain('END OF OUTPUT')
  })

  it('bounds unified diff rows and avoids computing a quadratic diff for large replacements', () => {
    const { container, getByRole, unmount } = render(
      <DiffDisplay diffContent={'+new line\n'.repeat(20_000) + '+LAST CHANGE'} />,
    )
    expect(container.querySelectorAll('*').length).toBeLessThan(400)
    fireEvent.click(getByRole('button', { name: 'text.preview.last' }))
    expect(container.textContent).toContain('+LAST CHANGE')
    unmount()
    const { container: replacement } = render(
      <DiffView oldString={'old\n'.repeat(20_000)} newString={'new\n'.repeat(20_000)} />,
    )
    expect(replacement.querySelector('[data-large-diff]')).not.toBeNull()
    expect(diffLines).not.toHaveBeenCalled()
  })

  it('decodes megabytes of Unicode text and detects binary content without character arrays', () => {
    const content = '中文😀 preview\r\n'.repeat(150_000)
    const decoded = decodeBase64(Buffer.from(content).toString('base64'))
    expect(decoded).toEqual({ ok: true, text: content })
    expect(isBinaryContent(decoded.text)).toBe(false)
    expect(isBinaryContent(content + '\0')).toBe(true)
    expect(isBinaryContent('\x01'.repeat(11) + 'x'.repeat(89))).toBe(true)
    expect(isBinaryContent('\x01'.repeat(10) + 'x'.repeat(90))).toBe(false)
    expect(decodeBase64('!not base64!').ok).toBe(false)
  })
})
