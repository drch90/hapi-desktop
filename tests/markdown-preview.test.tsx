import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Element, Root, RootContent } from 'hast'
import { renderMarkdownSections } from '../src/renderer/lib/markdown-preview'
import { MarkdownTree } from '../src/renderer/components/Markdown'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}))
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))
afterEach(cleanup)

function elements(tree: Root | RootContent, tag?: string): Element[] {
  const found = tree.type === 'element' && (!tag || tree.tagName === tag) ? [tree] : []
  return 'children' in tree ? [...found, ...tree.children.flatMap((node) => elements(node, tag))] : found
}

function text(tree: Root | RootContent): string {
  return tree.type === 'text' ? tree.value : 'children' in tree ? tree.children.map(text).join('') : ''
}

describe('rendered long Markdown', () => {
  it('bounds a long table while retaining all rows, alignment and repeated column headings', () => {
    const rows = Array.from({ length: 2_000 }, (_, index) => `| **Row ${index}** | ${index} |`)
    const sections = renderMarkdownSections('| Item | Count |\n| :--- | ---: |\n' + rows.join('\n'))
    expect(sections.length).toBeGreaterThan(10)
    const renderedRows = sections.flatMap(({ tree }) =>
      elements(tree, 'tbody').flatMap((body) => elements(body, 'tr')),
    )
    expect(renderedRows.map((row) => elements(row, 'td').map(text))).toEqual(
      rows.map((_, index) => [`Row ${index}`, String(index)]),
    )
    for (const { tree } of sections) {
      expect(elements(tree).length).toBeLessThan(600)
      expect(elements(tree, 'th').map(text)).toEqual(['Item', 'Count'])
      expect(elements(tree, 'th').map((cell) => cell.properties.align)).toEqual(['left', 'right'])
    }
  })

  it('continues ordered lists without restarting their numbering or losing nested Markdown', () => {
    const sections = renderMarkdownSections(
      Array.from({ length: 200 }, (_, index) => `${index + 7}. **Item ${index}**`).join('\n'),
    )
    const lists = sections.flatMap(({ tree }) => elements(tree, 'ol'))
    let next = 7
    for (const list of lists) {
      expect(list.properties.start).toBe(next)
      next += elements(list, 'li').length
    }
    expect(next).toBe(207)
    expect(sections.flatMap(({ tree }) => elements(tree, 'strong')).map(text)).toEqual(
      Array.from({ length: 200 }, (_, index) => `Item ${index}`),
    )
  })

  it('preserves a complete large code fence and Unicode paragraphs across rendering boundaries', () => {
    const code = 'const value = "中文😀";\r\n'.repeat(4_000)
    const content = '# Output\n\n```typescript\n' + code + '```\n\n## End'
    const sections = renderMarkdownSections(content)
    const blocks = sections.flatMap(({ tree }) => elements(tree, 'pre'))
    expect(blocks).toHaveLength(1)
    expect(text(blocks[0]).replaceAll('\r\n', '\n')).toBe(code.replaceAll('\r\n', '\n'))
    expect(sections.flatMap(({ tree }) => elements(tree, 'h2')).map(text)).toEqual(['End'])
    const paragraph = '中文😀'.repeat(20_000)
    const pieces = renderMarkdownSections(paragraph)
    expect(pieces.map(({ tree }) => text(tree)).join('')).toBe(paragraph)
    for (const { tree } of pieces) {
      expect(text(tree).length).toBeLessThanOrEqual(8_000)
      expect(text(tree).isWellFormed()).toBe(true)
    }
  })

  it('keeps list numbering after an individual item spans multiple sections', () => {
    const content = '7. First\n\n' + '   A paragraph in the first item.\n\n'.repeat(100) + '8. Second'
    const sections = renderMarkdownSections(content)
    const items = sections.flatMap(({ tree }) => elements(tree, 'li'))
    expect(items.length).toBeGreaterThan(2)
    expect(items.slice(0, -1).map((item) => Number(item.properties.value))).toEqual(
      items.slice(0, -1).map(() => 7),
    )
    expect(Number(items.at(-1)?.properties.value)).toBe(8)
    expect(text(items.at(-1)!)).toContain('Second')
  })

  it('resolves distant references and footnotes, and renders the same math, tasks and safe links', () => {
    const content = [
      '## A long document',
      '[See file][file]. Note[^note].',
      '- [x] Done\n- [ ] Pending',
      String.raw`\[\frac{1}{2}\]`,
      'Paragraph.\n\n'.repeat(400),
      '[file]: docs/result.md',
      '[^note]: The footnote.',
      '<script>alert(1)</script>',
      '![Remote](https://example.com/image.png)',
      '[Unsafe](javascript:alert%281%29)',
    ].join('\n\n')
    const sections = renderMarkdownSections(content)
    const { container } = render(
      <>
        {sections.map(({ tree }, index) => (
          <MarkdownTree key={index} tree={tree} />
        ))}
      </>,
    )
    expect(container.querySelector('h2')?.textContent).toBe('A long document')
    expect(container.querySelector('a')?.getAttribute('href')).toBe('docs/result.md')
    expect(container.querySelectorAll('.katex')).toHaveLength(1)
    expect(container.querySelector('input')?.checked).toBe(true)
    expect(container.querySelector('img, script, iframe')).toBeNull()
    expect(container.textContent).toContain('[Remote]')
    expect(
      [...container.querySelectorAll('a')].some((link) =>
        link.getAttribute('href')?.startsWith('javascript:'),
      ),
    ).toBe(false)
    const noteId = container.querySelector('[data-footnote-ref]')!.getAttribute('href')!.slice(1)
    const refId = container.querySelector('[data-footnote-ref]')!.id
    expect(sections.findIndex((section) => section.ids.includes(noteId))).toBeGreaterThan(0)
    expect(sections[0].ids).toContain(refId)
    expect(container.querySelector(`[id="${noteId}"]`)?.textContent).toContain('The footnote.')
  })

  it('retains literal indentation for long user messages', () => {
    const sections = renderMarkdownSections(
      '    # literal comment\n    **not bold**\n\n' + 'More text.\n\n'.repeat(400),
      { userMessage: true },
    )
    const { container } = render(<MarkdownTree tree={sections[0].tree} />)
    expect(container.querySelector('.user-text-literal')?.textContent).toBe(
      '    # literal comment\n    **not bold**',
    )
    expect(container.querySelector('strong, h1')).toBeNull()
  })
})
