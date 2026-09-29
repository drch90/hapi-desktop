import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { ChatBlock } from '@/chat/types'
import type { useMessages } from '@/hooks/queries/useMessages'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { captureScrollAnchor, restoreScrollAnchor } from '@/components/AssistantChat/HappyThread'
import { setMessageViewMode } from '@/lib/message-window-store'

export function useTranscriptNavigation(props: {
  sessionId: string
  initialScrollTop: number
  blocks: readonly ChatBlock[]
  messages: ReturnType<typeof useMessages>
  onPosition: (position: number) => void
}) {
  const prefix = useId()
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(props.initialScrollTop < 0)
  const restored = useRef(false)
  const active = useRef(false)
  const navigation = useRef(0)
  const pendingHistory = useRef<{
    version: number
    anchor: ReturnType<typeof captureScrollAnchor>
    top: number
    height: number
  } | null>(null)
  const [away, setAway] = useState(!following.current)
  const [located, setLocated] = useState('')

  useLayoutEffect(() => {
    active.current = true
    const observer = new ResizeObserver(() => {
      const el = viewport.current
      if (!el || !restored.current || !following.current) return
      // Images, expanded tools, font changes and the composer can resize after render.
      el.scrollTop = el.scrollHeight
    })
    if (viewport.current) observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    return () => {
      active.current = false
      navigation.current++
      pendingHistory.current = null
      observer.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el || props.messages.messages.length === 0) return
    const pending = pendingHistory.current
    if (pending && props.messages.historyVersion >= pending.version) {
      if (!pending.anchor || !restoreScrollAnchor(el, pending.anchor))
        el.scrollTop = pending.top + el.scrollHeight - pending.height
      pendingHistory.current = null
    } else if (!restored.current) {
      el.scrollTop = props.initialScrollTop < 0 ? el.scrollHeight : props.initialScrollTop
      restored.current = true
      if (!following.current) setMessageViewMode(props.sessionId, 'history')
    } else if (following.current) el.scrollTop = el.scrollHeight
    props.onPosition(following.current ? -1 : el.scrollTop)
  }, [props.blocks, props.messages.messages, props.messages.historyVersion])

  function anchorId(messageId: string) {
    return `${prefix}-${getConversationMessageAnchorId(messageId)}`
  }

  function onScroll() {
    const el = viewport.current
    if (!el || !restored.current) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 80) {
      following.current = false
      setMessageViewMode(props.sessionId, 'history')
    }
    setAway(!following.current)
    props.onPosition(following.current ? -1 : el.scrollTop)
  }

  function followLatest() {
    navigation.current++
    pendingHistory.current = null
    props.messages.cancelLoadMore()
    following.current = true
    setAway(false)
    setLocated('')
    // Set the store directly so the caller controls the single tail refresh.
    setMessageViewMode(props.sessionId, 'tail')
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
    props.onPosition(-1)
  }

  function jumpToMessage(messageId: string): boolean {
    const el = viewport.current
    const target = document.getElementById(anchorId(messageId))
    if (!el || !target || !el.contains(target)) return false
    navigation.current++
    pendingHistory.current = null
    props.messages.cancelLoadMore()
    following.current = false
    setAway(true)
    setLocated(messageId)
    setMessageViewMode(props.sessionId, 'history')
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12
    target.focus({ preventScroll: true })
    props.onPosition(el.scrollTop)
    return true
  }

  async function loadEarlier() {
    if (!props.messages.hasMore || props.messages.isLoadingMore || props.messages.isSyncingTail) return
    const run = ++navigation.current
    following.current = false
    setAway(true)
    setMessageViewMode(props.sessionId, 'history')
    const outcome = await props.messages.loadMore((version) => {
      const el = viewport.current
      if (!active.current || run !== navigation.current || !el) return false
      // Capture immediately before applying the page: the reader may have scrolled while waiting.
      pendingHistory.current = {
        version,
        anchor: captureScrollAnchor(el),
        top: el.scrollTop,
        height: el.scrollHeight,
      }
      return true
    })
    if (run === navigation.current && outcome.kind !== 'applied') pendingHistory.current = null
  }

  return {
    viewport,
    content,
    anchorId,
    onScroll,
    followLatest,
    jumpToMessage,
    loadEarlier,
    located,
    showLatest: away || props.messages.viewMode === 'history' || Boolean(props.messages.warning),
  }
}
