import { act, cleanup, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTranscriptHistoryLoader } from '../src/renderer/lib/useTranscriptHistoryLoader'
import type { OlderHistoryLoadResult } from '@/components/AssistantChat/context'

const observers = new Set<HistoryResizeObserver>()
class HistoryResizeObserver implements ResizeObserver {
  constructor(private callback: ResizeObserverCallback) {
    observers.add(this)
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observers.delete(this)
  }
  resize() {
    this.callback([], this)
  }
}

function historyFixture() {
  const viewport = document.createElement('div')
  const content = document.createElement('div')
  const geometry = { top: 1000, height: 2000, viewportHeight: 500 }
  Object.defineProperties(viewport, {
    scrollHeight: { get: () => geometry.height },
    clientHeight: { get: () => geometry.viewportHeight },
  })
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 100, 600, 500))
  vi.spyOn(content, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 100 - geometry.top, 600, geometry.height),
  )
  const page = Promise.withResolvers<OlderHistoryLoadResult>()
  const options = {
    viewport: { current: viewport },
    content: { current: content },
    isReady: () => true,
    messages: {
      hasMore: true,
      isLoadingMore: false,
      isSyncingTail: false,
      historyVersion: 0,
      cancelLoadMore: vi.fn(),
    },
    loadEarlier: vi.fn<(canApply: () => boolean) => Promise<OlderHistoryLoadResult>>(() => page.promise),
  }
  const resize = () => act(() => observers.forEach((observer) => observer.resize()))
  return { options, geometry, page, resize }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', HistoryResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('transcript history loading', () => {
  it('loads on reaching the top margin and waits for renewed input after each page', async () => {
    const { options, geometry, page, resize } = historyFixture()
    const { result, rerender } = renderHook(useTranscriptHistoryLoader, { initialProps: options })
    expect(options.loadEarlier).not.toHaveBeenCalled()
    act(() => result.current.noteIntent('wheel'))
    geometry.top = 180
    act(() => result.current.onScroll(true))
    expect(options.loadEarlier).toHaveBeenCalledTimes(1)
    resize()
    act(() => result.current.onScroll(true))
    expect(options.loadEarlier).toHaveBeenCalledTimes(1)

    await act(async () => page.resolve('loaded'))
    rerender({ ...options, messages: { ...options.messages, historyVersion: 1 } })
    resize()
    act(() => result.current.onScroll())
    // The rest of the same trackpad swipe cannot load a second page.
    act(() => result.current.noteIntent('wheel'))
    expect(options.loadEarlier).toHaveBeenCalledTimes(1)
    act(() => vi.advanceTimersByTime(251))
    act(() => result.current.noteIntent('wheel'))
    expect(options.loadEarlier).toHaveBeenCalledTimes(2)
  })

  it('fills a short first page once and can load again with the keyboard at scrollTop zero', async () => {
    const { options, geometry, page, resize } = historyFixture()
    geometry.top = 0
    geometry.height = 200
    const { result, rerender } = renderHook(useTranscriptHistoryLoader, { initialProps: options })
    expect(options.loadEarlier).toHaveBeenCalledTimes(1)
    await act(async () => page.resolve('loaded'))
    rerender({ ...options, messages: { ...options.messages, historyVersion: 1 } })
    resize()
    expect(options.loadEarlier).toHaveBeenCalledTimes(1)
    act(() => result.current.noteIntent('keyboard'))
    expect(options.loadEarlier).toHaveBeenCalledTimes(2)
  })

  it('waits for tail synchronization, preserves failures and retries only after another gesture', async () => {
    const { options, geometry, page, resize } = historyFixture()
    geometry.top = 0
    const { result, rerender } = renderHook(useTranscriptHistoryLoader, {
      initialProps: { ...options, messages: { ...options.messages, isSyncingTail: true } },
    })
    resize()
    expect(options.loadEarlier).not.toHaveBeenCalled()
    rerender(options)
    expect(options.loadEarlier).toHaveBeenCalledTimes(1)
    await act(async () => page.resolve('terminal-stop'))
    resize()
    act(() => result.current.onScroll())
    expect(options.loadEarlier).toHaveBeenCalledTimes(1)
    act(() => result.current.noteIntent('keyboard'))
    expect(options.loadEarlier).toHaveBeenCalledTimes(2)
  })

  it('cancels a pending automatic page when the reader leaves the top area', async () => {
    const { options, geometry, page } = historyFixture()
    geometry.top = 100
    const { result } = renderHook(useTranscriptHistoryLoader, { initialProps: options })
    const canApply = options.loadEarlier.mock.calls[0]?.[0]
    expect(canApply?.()).toBe(true)
    geometry.top = 700
    // Also checks position immediately before application, even without a scroll event.
    expect(canApply?.()).toBe(false)
    act(() => result.current.onScroll())
    expect(options.messages.cancelLoadMore).toHaveBeenCalledTimes(1)
    await act(async () => page.resolve('terminal-stop'))
    geometry.top = 100
    act(() => result.current.noteIntent('keyboard'))
    expect(options.loadEarlier).toHaveBeenCalledTimes(2)
    expect(canApply?.()).toBe(false)
  })

  it('ignores late responses after navigation or unmount and disconnects observers', async () => {
    const { options, geometry, page, resize } = historyFixture()
    geometry.top = 0
    const { result, unmount } = renderHook(useTranscriptHistoryLoader, { initialProps: options })
    const canApply = options.loadEarlier.mock.calls[0]?.[0]
    act(() => result.current.pause())
    expect(canApply?.()).toBe(false)
    await act(async () => page.resolve('loaded'))
    resize()
    act(() => result.current.onScroll())
    expect(options.loadEarlier).toHaveBeenCalledTimes(1)
    act(() => result.current.noteIntent('keyboard'))
    const nextCanApply = options.loadEarlier.mock.calls[1]?.[0]
    unmount()
    expect(nextCanApply?.()).toBe(false)
    expect(observers.size).toBe(0)
  })

  it('does not use stale loading callbacks or stop initial coverage after a StrictMode remount', () => {
    const { options, geometry } = historyFixture()
    const { result, rerender } = renderHook(useTranscriptHistoryLoader, {
      initialProps: options,
      wrapper: StrictMode,
    })
    const loadEarlier = vi.fn(options.loadEarlier)
    rerender({ ...options, loadEarlier })
    geometry.top = 100
    act(() => result.current.onScroll())
    expect(loadEarlier).toHaveBeenCalledTimes(1)
  })

  it('does not request history for an unrestored, hidden or exhausted viewport', () => {
    const { options, geometry, resize } = historyFixture()
    geometry.top = 0
    const { result, rerender } = renderHook(useTranscriptHistoryLoader, {
      initialProps: { ...options, isReady: (): boolean => false },
    })
    act(() => result.current.noteIntent('keyboard'))
    expect(options.loadEarlier).not.toHaveBeenCalled()
    geometry.viewportHeight = 0
    rerender(options)
    resize()
    expect(options.loadEarlier).not.toHaveBeenCalled()
    geometry.viewportHeight = 500
    rerender({ ...options, messages: { ...options.messages, hasMore: false } })
    act(() => result.current.noteIntent('keyboard'))
    expect(options.loadEarlier).not.toHaveBeenCalled()
  })
})
