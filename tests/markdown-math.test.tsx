import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MarkdownRenderer, MarkdownTree } from '../src/renderer/components/Markdown'
import { renderMarkdownSections } from '../src/renderer/lib/markdown-preview'
import { mathCalculation } from './fixtures/math-markdown'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}))
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))
afterEach(cleanup)

function formulas(container: HTMLElement) {
  return [...container.querySelectorAll('annotation[encoding="application/x-tex"]')].map(
    (formula) => formula.textContent,
  )
}

describe.each(['message', 'background preview'] as const)('math in %s', (surface) => {
  function renderMath(content: string, userMessage = false) {
    return render(
      surface === 'message' ? (
        <MarkdownRenderer content={content} userMessage={userMessage} />
      ) : (
        <>
          {renderMarkdownSections(content, { userMessage }).map(({ tree }, index) => (
            <MarkdownTree key={index} tree={tree} />
          ))}
        </>
      ),
    )
  }

  it('renders the fraction calculation with inline values and display equations inside the steps', () => {
    const { container } = renderMath(mathCalculation)
    expect(formulas(container)).toEqual([
      String.raw`(-\frac{1}{2}) \times 3`,
      String.raw`(-) \times (+) = (-)`,
      '3',
      '1',
      String.raw`\frac{3}{1}`,
      String.raw`-\left(\frac{1}{2} \times \frac{3}{1}\right)`,
      String.raw`1 \times 3 = 3`,
      String.raw`2 \times 1 = 2`,
      String.raw`-\frac{1 \times 3}{2 \times 1} = -\frac{3}{2}`,
      String.raw`-\frac{3}{2}`,
      String.raw`-1\frac{1}{2}`,
      '-1.5',
    ])
    expect(container.querySelectorAll('.katex-display')).toHaveLength(3)
    expect(container.querySelectorAll('ol > li .katex-display')).toHaveLength(3)
    expect(container.querySelectorAll('ol > li')).toHaveLength(3)
    expect(container.querySelector('.katex-error')).toBeNull()
  })

  it('keeps currency, escaped dollars and code literal while rendering nearby math', () => {
    const content = [
      String.raw`价格 $200/mo 和 $80；区间 $5–$10。行内 $x^2$，整数 $3$。`,
      String.raw`$5 and $10; then $x_1$ and $y_2$.`,
      String.raw`价格$5和$10，公式$x$。`,
      String.raw`转义 \$x\$，以及 $ x $。`,
      '`$code$ $$code$$`',
      '```latex\n$source$\n$$source$$\n```',
      '    $indented$',
    ].join('\n\n')
    const { container } = renderMath(content)
    expect(formulas(container)).toEqual(['x^2', '3', 'x_1', 'y_2', 'x'])
    expect(container.textContent).toContain('价格 $200/mo 和 $80；区间 $5–$10。')
    expect(container.textContent).toContain('$5 and $10; then')
    expect(container.textContent).toContain('价格$5和$10，公式')
    expect(container.textContent).toContain('转义 $x$，以及 $ x $。')
    expect(container.querySelector('p code')?.textContent).toBe('$code$ $$code$$')
    expect([...container.querySelectorAll('[data-code-cell]')].map((cell) => cell.textContent)).toEqual([
      '$source$',
      '$$source$$',
      '$indented$',
    ])
  })

  it('combines dollar, bracket and fenced math without breaking Markdown containers or link destinations', () => {
    const { container } = renderMath(
      [
        String.raw`**$a^2$** and \(b^2\); $$c^2$$ then $d^2$.`,
        String.raw`> $$\begin{aligned}x &= 1 \\ y &= 2\end{aligned}$$`,
        String.raw`\[
e^2

+ f^2
\]

$g^2$`,
        '$$\nh^2\n$$',
        '```math\ni^2\n```',
        '| Value | Result |\n| --- | --- |\n| $x_1$ | $x_2$ |',
        '[$z$](docs/$source$.md)',
      ].join('\n\n'),
    )
    expect(formulas(container)).toEqual([
      'a^2',
      'b^2',
      'c^2',
      'd^2',
      String.raw`\begin{aligned}x &= 1 \\ y &= 2\end{aligned}`,
      'e^2\n\n+ f^2',
      'g^2',
      'h^2',
      'i^2\n',
      'x_1',
      'x_2',
      'z',
    ])
    expect(container.querySelectorAll('.katex-display')).toHaveLength(5)
    expect(container.querySelector('strong .katex')).not.toBeNull()
    expect(container.querySelector('blockquote .katex-display')).not.toBeNull()
    expect(container.querySelectorAll('td .katex')).toHaveLength(2)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('docs/$source$.md')
    expect(container.querySelector('.katex-error')).toBeNull()
  })

  it('preserves every character of a user message containing math', () => {
    const { container } = renderMath(mathCalculation, true)
    expect(container.textContent).toBe(mathCalculation)
    expect(container.querySelector('.katex, h3, ol')).toBeNull()
  })
})

it('renders a streamed formula when its delimiter closes and preserves invalid TeX with following prose', () => {
  const { container, rerender } = render(<MarkdownRenderer content={String.raw`结果：$-\frac{3}{2}`} />)
  expect(container.querySelector('.katex')).toBeNull()
  expect(container.textContent).toContain('$')
  rerender(<MarkdownRenderer content={String.raw`结果：$-\frac{3}{2}$`} />)
  expect(formulas(container)).toEqual([String.raw`-\frac{3}{2}`])
  rerender(<MarkdownRenderer content={String.raw`$\frac{1$ 后续文字仍可读。`} />)
  expect(container.querySelector('.katex-error')?.textContent).toBe(String.raw`\frac{1`)
  expect(container.textContent).toContain('后续文字仍可读。')
})
