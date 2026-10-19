import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionSearch, type SessionSearchHandle } from '../src/renderer/components/SessionSearch'
import {
  addRecentSearch,
  loadSessionSearchHistory,
  MAX_RECENT_SEARCHES,
  saveSessionSearchHistory,
} from '../src/renderer/lib/sessionSearchHistory'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const scope = 'https://hub.example:alice'

function SearchField({ collapsed = false }: { collapsed?: boolean }) {
  const [query, setQuery] = useState('')
  const search = useRef<SessionSearchHandle>(null)
  return (
    <>
      <SessionSearch ref={search} scope={scope} value={query} onChange={setQuery} collapsed={collapsed} />
      <button onClick={() => search.current?.focus()}>Focus search</button>
      <button>Outside</button>
    </>
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('recent session searches', () => {
  it('keeps ten unique terms in use order, trims whitespace and ignores case', () => {
    let history: string[] = []
    for (let index = 0; index < 12; index++) history = addRecentSearch(history, `Project ${index}`)
    history = addRecentSearch(history, '  PROJECT 4  ')
    expect(history).toHaveLength(MAX_RECENT_SEARCHES)
    expect(history.slice(0, 3)).toEqual(['PROJECT 4', 'Project 11', 'Project 10'])
    expect(history.filter((query) => query.toLowerCase() === 'project 4')).toEqual(['PROJECT 4'])
    expect(addRecentSearch(history, '  ')).toEqual(history)
    expect(addRecentSearch(history, 'x'.repeat(1025))).toEqual(history)
  })

  it('persists and clears history independently for each Hub and account', () => {
    const otherAccount = 'https://hub.example:bob'
    const otherHub = 'https://other.example:alice'
    saveSessionSearchHistory(scope, ['first'])
    saveSessionSearchHistory(otherAccount, ['second'])
    saveSessionSearchHistory(otherHub, ['third'])
    expect(loadSessionSearchHistory(scope)).toEqual(['first'])
    expect(loadSessionSearchHistory(otherAccount)).toEqual(['second'])
    expect(loadSessionSearchHistory(otherHub)).toEqual(['third'])
    saveSessionSearchHistory(scope, [])
    expect(loadSessionSearchHistory(scope)).toEqual([])
    expect(loadSessionSearchHistory(otherAccount)).toEqual(['second'])
  })

  it('recovers from malformed history and retains valid entries from a damaged list', () => {
    const key = `desktop:session-search:${scope}`
    for (const stored of ['{', 'null', '{}', '42']) {
      localStorage.setItem(key, stored)
      expect(loadSessionSearchHistory(scope)).toEqual([])
    }
    localStorage.setItem(key, JSON.stringify([null, 42, '', '  项目  ', {}, '项目', 'Review']))
    expect(loadSessionSearchHistory(scope)).toEqual(['项目', 'Review'])
  })
})

describe('session search interaction', () => {
  it('opens history on click, filters immediately and records completed terms instead of each keystroke', () => {
    const view = render(<SearchField />)
    const input = view.getByRole('textbox', { name: 'Search sessions' }) as HTMLInputElement
    expect(view.queryByRole('region', { name: 'Recent searches' })).toBeNull()
    fireEvent.click(input)
    expect(view.getByText('No recent searches')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'rev' } })
    fireEvent.change(input, { target: { value: 'review' } })
    expect(input.value).toBe('review')
    expect(view.queryByRole('region')).toBeNull()
    expect(loadSessionSearchHistory(scope)).toEqual([])
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loadSessionSearchHistory(scope)).toEqual(['review'])
    fireEvent.click(view.getByRole('button', { name: 'Cancel search' }))
    expect(input.value).toBe('')
    expect(view.queryByRole('region')).toBeNull()
    fireEvent.click(input)
    fireEvent.click(view.getByRole('button', { name: 'review' }))
    expect(input.value).toBe('review')
    expect(document.activeElement).toBe(input)
    expect(view.queryByRole('region')).toBeNull()
    fireEvent.click(input)
    fireEvent.change(input, { target: { value: '' } })
    expect(view.queryByRole('region')).toBeNull()
  })

  it('records on outside clicks and keyboard blur, and promotes a reused query', () => {
    const view = render(<SearchField />)
    const input = view.getByRole('textbox')
    act(() => input.focus())
    fireEvent.change(input, { target: { value: 'design' } })
    fireEvent.pointerDown(view.getByRole('button', { name: 'Outside' }))
    expect(loadSessionSearchHistory(scope)).toEqual(['design'])
    fireEvent.change(input, { target: { value: 'review' } })
    act(() => view.getByRole('button', { name: 'Outside' }).focus())
    expect(loadSessionSearchHistory(scope)).toEqual(['review', 'design'])
    fireEvent.click(input)
    fireEvent.click(view.getByRole('button', { name: 'design' }))
    expect(loadSessionSearchHistory(scope)).toEqual(['design', 'review'])
  })

  it('keeps deleted or cleared queries removed when the active search is cancelled', () => {
    saveSessionSearchHistory(scope, ['review', 'design'])
    const view = render(<SearchField />)
    const input = view.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: ' REVIEW ' } })
    fireEvent.click(input)
    fireEvent.click(view.getByRole('button', { name: 'Remove recent search: review' }))
    expect(input.value).toBe(' REVIEW ')
    expect(view.getByRole('region')).toBeTruthy()
    expect(loadSessionSearchHistory(scope)).toEqual(['design'])
    fireEvent.click(view.getByRole('button', { name: 'Cancel search' }))
    expect(loadSessionSearchHistory(scope)).toEqual(['design'])
    fireEvent.change(input, { target: { value: 'design' } })
    fireEvent.click(input)
    fireEvent.click(view.getByRole('button', { name: 'Clear search history' }))
    expect(input.value).toBe('design')
    expect(view.getByText('No recent searches')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    expect(view.queryByRole('region')).toBeNull()
    expect(loadSessionSearchHistory(scope)).toEqual([])
  })

  it('supports keyboard history navigation and reopens from the search shortcut', async () => {
    saveSessionSearchHistory(scope, ['review', 'design'])
    const view = render(<SearchField />)
    const input = view.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'current query' } })
    fireEvent.click(view.getByRole('button', { name: 'Focus search' }))
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)
    fireEvent.keyDown(view.getByRole('button', { name: 'Clear search history' }), { key: 'ArrowUp' })
    expect(document.activeElement?.textContent).toBe('design')
    act(() => input.focus())
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement?.textContent).toBe('review'))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement?.textContent).toBe('design')
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(document.activeElement?.textContent).toBe('review')
    fireEvent.click(document.activeElement!)
    expect(input.value).toBe('review')
    expect(loadSessionSearchHistory(scope)).toEqual(['review', 'current query', 'design'])
    fireEvent.click(view.getByRole('button', { name: 'Focus search' }))
    expect(view.getByRole('region')).toBeTruthy()
  })

  it('leaves IME composition intact until Enter or Escape is pressed outside composition', () => {
    const view = render(<SearchField />)
    const input = view.getByRole('textbox') as HTMLInputElement
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '搜索' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('搜索')
    expect(loadSessionSearchHistory(scope)).toEqual([])
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(input.value).toBe('搜索')
    expect(loadSessionSearchHistory(scope)).toEqual([])
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loadSessionSearchHistory(scope)).toEqual(['搜索'])
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
  })

  it('saves the active query and dismisses history when the sidebar collapses', () => {
    const view = render(<SearchField />)
    const input = view.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'review' } })
    fireEvent.click(input)
    view.rerender(<SearchField collapsed />)
    expect(view.queryByRole('region')).toBeNull()
    expect(loadSessionSearchHistory(scope)).toEqual(['review'])
    view.rerender(<SearchField />)
    expect(view.queryByRole('region')).toBeNull()
  })

  it('keeps search and in-memory history usable when local storage fails', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const)
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('Storage unavailable')
      })
    const view = render(<SearchField />)
    const input = view.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'review' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    fireEvent.click(input)
    expect(view.getByRole('button', { name: 'review' })).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Clear search history' }))
    expect(view.getByText('No recent searches')).toBeTruthy()
  })
})
