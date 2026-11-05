import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { shouldLoadOlderForViewport } from '@/components/AssistantChat/HappyThread'
import type { OlderHistoryLoadResult } from '@/components/AssistantChat/context'
import type { useMessages } from '@/hooks/queries/useMessages'

type HistoryLoaderOptions = {
  viewport: RefObject<HTMLDivElement | null>
  content: RefObject<HTMLDivElement | null>
  isReady: () => boolean
  messages: Pick<
    ReturnType<typeof useMessages>,
    'hasMore' | 'isLoadingMore' | 'isSyncingTail' | 'historyVersion' | 'cancelLoadMore'
  >
  loadEarlier: (canApply: () => boolean) => Promise<OlderHistoryLoadResult>
}

export function useTranscriptHistoryLoader(options: HistoryLoaderOptions) {
  const latest = useRef(options)
  const active = useRef(false)
  const paused = useRef(false)
  const loading = useRef(false)
  const generation = useRef(0)
  const historyVersion = useRef(options.messages.historyVersion)
  const intent = useRef({ available: false, lastWheelAt: 0 })
  const checkFrame = useRef(0)

  const needsHistory = useCallback(() => {
    const { viewport, content, isReady } = latest.current
    const el = viewport.current
    const start = content.current
    if (!isReady() || !el || !start || el.clientHeight === 0) return false
    // The content's top is the desktop equivalent of Web's history sentinel.
    const top = start.getBoundingClientRect().top
    return shouldLoadOlderForViewport({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      viewportTop: el.getBoundingClientRect().top,
      sentinelTop: top,
      sentinelBottom: top,
    })
  }, [])

  const pause = useCallback(() => {
    paused.current = true
    intent.current.available = false
    generation.current++
    cancelAnimationFrame(checkFrame.current)
    if (loading.current) {
      loading.current = false
      latest.current.messages.cancelLoadMore()
    }
  }, [])

  const check = useCallback(
    (scrolledUp = false) => {
      if (!active.current) return
      if (!needsHistory()) {
        // Older pages can evict the newest rows. Do not apply a slow response
        // after the reader has left the preload area for newer messages.
        if (loading.current) pause()
        return
      }
      const { messages, loadEarlier } = latest.current
      if (loading.current || messages.isLoadingMore || messages.isSyncingTail || !messages.hasMore) return
      if (scrolledUp && intent.current.available) {
        paused.current = false
        intent.current.available = false
      }
      if (paused.current) return
      paused.current = true
      loading.current = true
      const run = ++generation.current
      void loadEarlier(() => active.current && run === generation.current && needsHistory()).then(
        (result) => {
          if (run !== generation.current) return
          loading.current = false
          if (result === 'transient-stop') {
            paused.current = false
            checkFrame.current = requestAnimationFrame(() => check())
          }
        },
      )
    },
    [needsHistory, pause],
  )

  const noteIntent = useCallback(
    (source: 'wheel' | 'keyboard' | 'pointer' | 'touch') => {
      const now = Date.now()
      // A trackpad swipe produces many events, but consumes only one page.
      if (source !== 'wheel' || now - intent.current.lastWheelAt > 250) intent.current.available = true
      if (source === 'wheel') intent.current.lastWheelAt = now
      // At scrollTop=0, wheel/keyboard input cannot produce another scroll event.
      if (source === 'wheel' || source === 'keyboard') check(true)
    },
    [check],
  )

  useLayoutEffect(() => {
    latest.current = options
    if (historyVersion.current !== options.messages.historyVersion) {
      historyVersion.current = options.messages.historyVersion
      // Includes pages loaded by the outline, tools or the fallback button.
      // Render/resize/anchor restoration must not chain the next page.
      paused.current = true
      intent.current.available = false
    }
  })

  useEffect(() => {
    active.current = true
    paused.current = false
    const observer = new ResizeObserver(() => check())
    if (latest.current.viewport.current) observer.observe(latest.current.viewport.current)
    if (latest.current.content.current) observer.observe(latest.current.content.current)
    check()
    return () => {
      active.current = false
      pause()
      observer.disconnect()
    }
  }, [check, pause])

  useEffect(() => {
    check()
  }, [check, options.messages.hasMore, options.messages.isLoadingMore, options.messages.isSyncingTail])

  return { onScroll: check, noteIntent, pause }
}
