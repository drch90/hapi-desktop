import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { createHighlighterCore } from 'shiki/core'
import { useShikiHighlighter } from '@/lib/shiki'

vi.mock('shiki/core', () => ({
  createHighlighterCore: vi.fn().mockRejectedValue(new Error('Unable to load a syntax chunk')),
}))
afterEach(() => cleanup())

it('skips highlighting plain text and recovers from a failed import without losing source', async () => {
  function Example({ code, language }: { code: string; language: string }) {
    return <pre>{useShikiHighlighter(code, language) ?? code}</pre>
  }
  const { container, rerender } = render(<Example code="plain" language="text" />)
  expect(createHighlighterCore).not.toHaveBeenCalled()
  rerender(<Example code="unknown" language="constructor" />)
  expect(createHighlighterCore).not.toHaveBeenCalled()
  rerender(<Example code="const first = 1" language="js" />)
  await waitFor(() => expect(createHighlighterCore).toHaveBeenCalledTimes(1))
  expect(container.textContent).toBe('const first = 1')
  rerender(<Example code="const second = 2" language="js" />)
  expect(container.textContent).toBe('const second = 2')
  await waitFor(() => expect(createHighlighterCore).toHaveBeenCalledTimes(2))
  expect(container.textContent).toBe('const second = 2')
})
