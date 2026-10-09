import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { toBlob } from 'html-to-image'
import { MarkdownRenderer } from '../src/renderer/components/Markdown'
import { createShareSnapshot, renderShareImage } from '../src/renderer/lib/share-image'

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/lib/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}))
vi.mock('@/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }),
}))
vi.mock('@/components/assistant-ui/mermaid-diagram', () => ({
  MermaidDiagram: () => (
    <button data-mermaid-diagram>
      <svg>
        <text>Diagram content</text>
      </svg>
    </button>
  ),
}))

beforeEach(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
  vi.mocked(toBlob)
    .mockReset()
    .mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
})
afterEach(() => cleanup())

describe('Markdown image sharing', () => {
  it('retains diagrams and task states while turning a live message into a static snapshot', () => {
    const { container } = render(
      <MarkdownRenderer content={'- [x] Done\n- [ ] Pending\n\n```mermaid\nflowchart LR\n A --> B\n```'} />,
    )
    const snapshot = document.createElement('div')
    snapshot.innerHTML = createShareSnapshot(container)
    expect(snapshot.querySelector('[data-mermaid-diagram] svg')?.textContent).toBe('Diagram content')
    expect(snapshot.querySelector('.markdown-mermaid button')).toBeNull()
    expect(
      [...snapshot.querySelectorAll('.markdown-task-checkbox')].map((marker) => marker.textContent),
    ).toEqual(['☑', '☐'])
    expect(snapshot.querySelector('input')).toBeNull()
    expect(container.querySelectorAll('input')).toHaveLength(2)
    expect(container.querySelector('button[data-mermaid-diagram]')).not.toBeNull()
  })

  it('captures diagrams and unclips math with embedded local fonts', async () => {
    const { container } = render(
      <MarkdownRenderer content={'\\[\\frac{1}{2}\\]\n\n```mermaid\nflowchart LR\n A --> B\n```'} />,
    )
    const snapshot = document.createElement('div')
    snapshot.innerHTML = createShareSnapshot(container)
    const png = await renderShareImage(snapshot, 640)
    expect(png.type).toBe('image/png')
    const [capture, options] = vi.mocked(toBlob).mock.calls[0]
    expect(capture.querySelector('[data-mermaid-diagram] svg')?.textContent).toBe('Diagram content')
    expect(capture.querySelector<HTMLElement>('.katex-display')?.style.overflow).toBe('visible')
    expect(options?.fontEmbedCSS).toContain('font-family:KaTeX_Main')
    expect(options?.fontEmbedCSS).toMatch(/url\("data:font\/woff2;base64,/)
    expect(options?.skipFonts).toBe(false)
    expect(capture.isConnected).toBe(false)
  })

  it('removes the temporary capture if image generation fails', async () => {
    vi.mocked(toBlob).mockRejectedValue(new Error('capture failed'))
    const source = document.createElement('div')
    source.textContent = 'Original message'
    await expect(renderShareImage(source, 640)).rejects.toThrow('capture failed')
    expect(vi.mocked(toBlob).mock.calls[0][0].isConnected).toBe(false)
    expect(source.textContent).toBe('Original message')
  })
})
