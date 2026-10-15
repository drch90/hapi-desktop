import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Machine, SessionSummary, SlashCommand } from '@/types/api'
import { toSessionSummary } from '@hapi/protocol'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { useComposerSuggestions } from '../src/renderer/lib/useComposerSuggestions'
import { fixtureSession } from './fake-server'

const commands: SlashCommand[] = ['help', 'model', 'status'].map((name) => ({ name, source: 'builtin' }))
const machines: Machine[] = []
function peer(id: string, updatedAt: number): SessionSummary {
  return toSessionSummary({ ...fixtureSession(id, id, 'claude'), updatedAt, hasConversationContent: true })
}
const peers = [peer('alpha', 2000), peer('beta', 1000)]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('composer suggestions during live updates', () => {
  it('keeps command results and keyboard selection through unrelated session updates', () => {
    const { result, rerender } = renderHook(
      ({ sessions }) => useComposerSuggestions('/', commands, sessions, machines, 'self'),
      { initialProps: { sessions: peers } },
    )
    act(() => result.current[3]())
    expect(result.current[0][result.current[1]].key).toBe('/model')
    rerender({
      sessions: peers.map((item) => ({ ...item, thinking: true, updatedAt: item.updatedAt + 100 })),
    })
    expect(result.current[0].map((item) => item.key)).toEqual(['/help', '/model', '/status'])
    expect(result.current[0][result.current[1]].key).toBe('/model')
  })

  it('keeps mention rows under the pointer in place while updating labels and removing deleted targets', () => {
    const { result, rerender } = renderHook(
      ({ sessions }) => useComposerSuggestions('@', commands, sessions, machines, 'self'),
      { initialProps: { sessions: peers } },
    )
    act(() => result.current[3]())
    rerender({
      sessions: [
        peers[0],
        { ...peers[1], updatedAt: 5000, metadata: { ...peers[1].metadata!, name: 'Renamed' } },
      ],
    })
    expect(result.current[0].map((item) => item.key)).toEqual(['session:alpha', 'session:beta'])
    expect(result.current[0][result.current[1]].label).toBe('@Renamed')
    rerender({ sessions: [peers[0]] })
    expect(result.current[0].map((item) => item.key)).toEqual(['session:alpha'])
    expect(result.current[1]).toBe(0)
    rerender({ sessions: [] })
    expect(result.current[0]).toEqual([])
    expect(result.current[1]).toBe(-1)
  })

  it('re-ranks and resets selection for a new search, a reopened menu and a different session', () => {
    const { result, rerender } = renderHook(
      ({ query, sessionId }) => useComposerSuggestions(query, commands, peers, machines, sessionId),
      { initialProps: { query: '@' as string | null, sessionId: 'self' } },
    )
    act(() => result.current[3]())
    rerender({ query: '@alpha', sessionId: 'self' })
    expect(result.current[0].map((item) => item.key)).toEqual(['session:alpha'])
    rerender({ query: null, sessionId: 'self' })
    expect(result.current[0]).toEqual([])
    rerender({ query: '@', sessionId: 'self' })
    expect(result.current[1]).toBe(0)
    rerender({ query: '@', sessionId: 'alpha' })
    expect(result.current[0].map((item) => item.key)).toEqual(['session:beta'])
  })

  it('does not evict a visible mention when activity moves another session into the top 20', () => {
    const sessions = Array.from({ length: 22 }, (_, index) => peer(`peer-${index}`, 1000 - index))
    const { result, rerender } = renderHook(
      ({ sessions }) => useComposerSuggestions('@', commands, sessions, machines, 'self'),
      { initialProps: { sessions } },
    )
    const visible = result.current[0].map((item) => item.key)
    expect(visible).toHaveLength(20)
    rerender({ sessions: sessions.map((row) => (row.id === 'peer-21' ? { ...row, updatedAt: 5000 } : row)) })
    expect(result.current[0].map((item) => item.key)).toEqual(visible)
  })

  it('keeps the mounted menu and manual scroll position when the catalog grows', () => {
    const scrollIntoView = vi.fn()
    const original = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    try {
      function Menu({ catalog }: { catalog: SlashCommand[] }) {
        const [suggestions, selected] = useComposerSuggestions('/', catalog, peers, machines, 'self')
        return (
          <div data-testid="menu">
            <Autocomplete suggestions={suggestions} selectedIndex={selected} onSelect={() => {}} />
          </div>
        )
      }
      const { getByTestId, rerender } = render(<Menu catalog={commands} />)
      const menu = getByTestId('menu')
      const first = menu.querySelector('button')
      menu.scrollTop = 180
      scrollIntoView.mockClear()
      rerender(<Menu catalog={[...commands, { name: 'project-check', source: 'project' }]} />)
      expect(menu.querySelector('button')).toBe(first)
      expect(menu.scrollTop).toBe(180)
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      if (original) HTMLElement.prototype.scrollIntoView = original
      else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView
    }
  })
})
