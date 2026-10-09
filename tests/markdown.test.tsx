import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { LinkContext, MarkdownRenderer } from '../src/renderer/components/Markdown'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}))
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))

afterEach(() => cleanup())

function codeLines(container: HTMLElement) {
  return [...container.querySelectorAll('[data-code-cell]')].map((cell) => cell.textContent)
}

describe('desktop Markdown', () => {
  it('keeps multiline inline code inline and single-line indented code in a code block', () => {
    const { container } = render(
      <MarkdownRenderer content={'Inline `first\nsecond` stays in a paragraph.\n\n    one indented line'} />,
    )
    expect(container.querySelector('p code')?.textContent).toBe('first second')
    expect(container.querySelector('p [data-hapi-code-block]')).toBeNull()
    expect(container.querySelectorAll('[data-hapi-code-block]')).toHaveLength(1)
    expect(codeLines(container)).toEqual(['one indented line'])
  })

  it('preserves code indentation and blank lines in fences nested in lists and quotes', () => {
    const { container } = render(
      <MarkdownRenderer
        preserveSingleLineBreaks
        content={[
          '- Example',
          '',
          '  ```C++ title="example.cpp"',
          '  int main() {',
          '  \treturn 0;',
          '',
          '  }',
          '  ```',
          '',
          '> ~~~',
          '> plain',
          '>   indented',
          '> ~~~',
        ].join('\n')}
      />,
    )
    expect(container.querySelector('li [data-hapi-code-block]')).not.toBeNull()
    expect(container.querySelector('blockquote [data-hapi-code-block]')).not.toBeNull()
    expect(codeLines(container)).toEqual(['int main() {', '\treturn 0;', '', '}', 'plain', '  indented'])
    expect(container.querySelector('[data-hapi-code-block]')?.textContent).toContain('c++')
  })

  it('renders Web math delimiters without interpreting currency or code as math', () => {
    const { container } = render(
      <MarkdownRenderer
        preserveSingleLineBreaks
        content={
          String.raw`Inline \(x^2 + y^2\).

\[
\frac{1}{2}
\]

$$
\sum_{n=1}^{3} n
$$

$200/mo and $80 stay literal; ~home~ and ~~removed~~.

Literal: ` +
          '`\\(code\\)`' +
          '\n\n```latex\n\\[not math\\]\n```'
        }
      />,
    )
    expect(container.querySelectorAll('.katex')).toHaveLength(3)
    expect(container.querySelectorAll('.katex-display')).toHaveLength(2)
    expect(container.querySelector('.katex-error')).toBeNull()
    expect(container.textContent).toContain('$200/mo and $80 stay literal; ~home~')
    expect(container.querySelectorAll('del')).toHaveLength(1)
    expect(container.querySelector('p code')?.textContent).toBe('\\(code\\)')
    expect(codeLines(container)).toEqual(['\\[not math\\]'])
  })

  it('retains user line breaks without changing ordinary Markdown paragraphs', () => {
    const content = 'first\nsecond\n\nthird'
    const { container, rerender } = render(<MarkdownRenderer content={content} />)
    expect(container.querySelectorAll('br')).toHaveLength(0)
    rerender(<MarkdownRenderer content={content} preserveSingleLineBreaks />)
    expect(container.querySelectorAll('br')).toHaveLength(1)
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  it('renders math fences and keeps invalid TeX readable without losing surrounding content', () => {
    const { container } = render(
      <MarkdownRenderer content={'```math\nx^2\n```\n\n\\(\\frac{1\\)\n\nStill readable.'} />,
    )
    expect(container.querySelector('.katex-display')).not.toBeNull()
    expect(container.querySelector('.katex-error')?.textContent).toBe('\\frac{1')
    expect(container.textContent).toContain('Still readable.')
  })

  it('keeps raw HTML and remote images inert', () => {
    const { container } = render(
      <MarkdownRenderer
        content={
          '<img src="https://example.com/tracker" onerror="alert(1)">\n\n![alt](https://example.com/image.png)\n\n[bad](javascript:alert%281%29)'
        }
      />,
    )
    expect(container.querySelector('img, script, iframe')).toBeNull()
    expect(container.textContent).toContain('[alt]')
    expect(container.querySelector('a')?.getAttribute('href')).not.toContain('javascript:')
  })

  it('follows footnotes within the clicked message without navigating or opening a file', () => {
    const openFile = vi.fn()
    const openSession = vi.fn()
    const { container } = render(
      <LinkContext.Provider value={{ openFile, openSession }}>
        <MarkdownRenderer content={'First[^1].\n\n[^1]: First note.'} />
        <MarkdownRenderer content={'Second[^1].\n\n[^1]: Second note.'} />
      </LinkContext.Provider>,
    )
    const messages = container.querySelectorAll('.markdown')
    const target = messages[1].querySelector('li')!
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    fireEvent.click(messages[1].querySelector('sup a')!)
    expect(scrollIntoView).toHaveBeenCalled()
    expect(document.activeElement).toBe(target)
    const reference = messages[1].querySelector<HTMLAnchorElement>('sup a')!
    reference.scrollIntoView = vi.fn()
    fireEvent.click(messages[1].querySelector('[data-footnote-backref]')!)
    expect(document.activeElement).toBe(reference)
    expect(reference.tabIndex).toBe(0)
    expect(openFile).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
  })
})
