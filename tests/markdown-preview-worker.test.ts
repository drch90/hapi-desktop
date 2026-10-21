import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMarkdownPreview } from '../src/renderer/lib/useMarkdownPreview'
import type { MarkdownRequest, MarkdownResult } from '../src/renderer/lib/markdown-worker'
import type { MarkdownSection } from '../src/renderer/lib/markdown-sections'

const workers: PreviewWorker[] = []
class PreviewWorker {
  requests: MarkdownRequest[] = []
  onmessage: ((event: { data: MarkdownResult }) => void) | null = null
  onerror: ((event: { preventDefault: () => void }) => void) | null = null
  terminated = false
  constructor() {
    workers.push(this)
  }
  postMessage(request: MarkdownRequest) {
    this.requests.push(request)
  }
  terminate() {
    this.terminated = true
  }
  finish(index: number, sections: MarkdownSection[]) {
    this.onmessage?.({ data: { id: this.requests[index].id, sections } })
  }
}
const section = (value: string): MarkdownSection[] => [
  { tree: { type: 'root', children: [{ type: 'text', value }] }, ids: [], estimate: 48 },
]

beforeEach(() => {
  workers.length = 0
  vi.useFakeTimers()
  vi.stubGlobal('Worker', PreviewWorker)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('background Markdown preview', () => {
  it('starts on demand, coalesces streaming requests and displays completed prefixes', () => {
    const { result, rerender, unmount } = renderHook(
      ({ content, enabled }) => useMarkdownPreview({ content }, enabled, 0),
      { initialProps: { content: 'First', enabled: false } },
    )
    expect(workers).toHaveLength(0)
    rerender({ content: 'First', enabled: true })
    act(() => vi.advanceTimersByTime(100))
    rerender({ content: 'First second', enabled: true })
    act(() => vi.advanceTimersByTime(60))
    expect(workers[0].requests.map((request) => request.content)).toEqual(['First second'])
    rerender({ content: 'First second third', enabled: true })
    rerender({ content: 'First second third fourth', enabled: true })
    act(() => vi.advanceTimersByTime(160))
    expect(workers[0].requests).toHaveLength(1)
    act(() => workers[0].finish(0, section('First second')))
    expect(result.current.sections).toEqual(section('First second'))
    expect(workers[0].requests[1].content).toBe('First second third fourth')
    act(() => workers[0].finish(1, section('Latest preview')))
    expect(result.current.sections).toEqual(section('Latest preview'))
    unmount()
    expect(workers[0].terminated).toBe(true)
  })

  it('discards stale responses after a replacement and releases the worker on source mode', () => {
    const { result, rerender } = renderHook(
      ({ content, enabled }) => useMarkdownPreview({ content }, enabled, 0),
      { initialProps: { content: 'Old document', enabled: true } },
    )
    act(() => vi.advanceTimersByTime(160))
    rerender({ content: 'Replacement', enabled: true })
    act(() => workers[0].finish(0, section('Old document')))
    expect(result.current.ready).toBe(false)
    expect(workers[0].requests[1].content).toBe('Replacement')
    act(() => workers[0].finish(1, section('Replacement')))
    expect(result.current.sections).toEqual(section('Replacement'))
    rerender({ content: 'Replacement', enabled: false })
    expect(workers[0].terminated).toBe(true)
    expect(workers[0].onmessage).toBeNull()
    expect(result.current.sections).toEqual([])
  })

  it('supports retry after a worker failure and completes an empty rendered document', () => {
    const { result, rerender } = renderHook(
      ({ retry }) => useMarkdownPreview({ content: '<!-- hidden -->' }, true, retry),
      { initialProps: { retry: 0 } },
    )
    act(() => workers[0].onerror?.({ preventDefault: () => {} }))
    expect(result.current.error).toBe(true)
    rerender({ retry: 1 })
    expect(workers[0].terminated).toBe(true)
    act(() => vi.advanceTimersByTime(160))
    act(() => workers[1].finish(0, []))
    expect(result.current).toEqual({ sections: [], error: false, ready: true })
  })
})
