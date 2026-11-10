import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AgentEvent } from '@/chat/types'
import { CompactSummary } from '../src/renderer/components/CompactSummary'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

afterEach(() => cleanup())

describe('compaction summary disclosure', () => {
  it('keeps the title and token facts visible while revealing the complete Markdown only on request', () => {
    render(
      <CompactSummary
        event={{
          type: 'compact-summary',
          summary: '## Retained context\n\n- Preserve **all requirements**.\n\nLast paragraph of the report.',
          tokensBefore: 8000,
          tokensAfter: 1200,
        }}
      />,
    )
    const toggle = screen.getByRole('button', { name: 'Context compacted', expanded: false })
    expect(screen.getByText('8,000 → 1,200 tokens')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Retained context' })).not.toBeInTheDocument()
    expect(screen.queryByText('Last paragraph of the report.')).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('heading', { name: 'Retained context' })).toBeVisible()
    expect(screen.getByRole('listitem')).toHaveTextContent('Preserve all requirements.')
    expect(screen.getByText('Last paragraph of the report.')).toBeVisible()
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toContainElement(
      screen.getByRole('heading', { name: 'Retained context' }),
    )

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Last paragraph of the report.')).not.toBeInTheDocument()
    expect(screen.getByText('8,000 → 1,200 tokens')).toBeVisible()
  })

  it('starts a late summary collapsed and preserves the choice when token facts arrive later', () => {
    const event: Extract<AgentEvent, { type: 'compact-summary' }> = {
      type: 'compact-summary',
      summary: '',
      tokensBefore: 8000,
    }
    const { rerender } = render(<CompactSummary event={event} />)
    expect(screen.getByText('Context compacted')).toBeVisible()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    const withSummary = { ...event, summary: 'Retained instructions', estimatedTokensAfter: 1300 }
    rerender(<CompactSummary event={withSummary} />)
    const toggle = screen.getByRole('button', { name: 'Context compacted', expanded: false })
    expect(screen.queryByText('Retained instructions')).not.toBeInTheDocument()
    expect(screen.getByText('8,000 → ~1,300 tokens (estimated after)')).toBeVisible()
    fireEvent.click(toggle)

    rerender(<CompactSummary event={{ ...withSummary, tokensAfter: 1200 }} />)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Retained instructions')).toBeVisible()
    expect(screen.getByText('8,000 → 1,200 tokens')).toBeVisible()
  })

  it.each(['', ' \n\t ', undefined])(
    'omits the disclosure for an empty or missing summary (%j)',
    (summary) => {
      const { rerender } = render(<CompactSummary event={{ type: 'compact-summary', summary }} />)
      expect(screen.getByText('Context compacted')).toBeVisible()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()

      rerender(<CompactSummary event={{ type: 'compact-summary', summary, estimatedTokensAfter: 1200 }} />)
      expect(screen.getByText('~1,200 tokens after (estimated)')).toBeVisible()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    },
  )
})
