import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { VisibleChatBlock } from '@/chat/toolGroups'
import type { OlderHistoryLoadResult } from '@/components/AssistantChat/context'
import type { useMessages } from '@/hooks/queries/useMessages'
import { getConversationMessageAnchorId } from '@/chat/outline'
import { captureScrollAnchor, restoreScrollAnchor } from '@/components/AssistantChat/HappyThread'
import { setMessageViewMode } from '@/lib/message-window-store'

export function useTranscriptNavigation(props: {
  sessionId: string
  initialScrollTop: number
  blocks: readonly VisibleChatBlock[]
  messages: ReturnType<typeof useMessages>
  onPosition: (position: number) => void
}) {
  const prefix = useId()
  const viewport = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(props.initialScrollTop < 0)
  const lastScrollTop = useRef(0)
  const scrollIntent = useRef({ direction: 0, until: 0, pointerDown: false })
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

  function pauseFollowing() {
    following.current = false
    setAway(true)
    setMessageViewMode(props.sessionId, 'history')
    if (viewport.current) props.onPosition(viewport.current.scrollTop)
  }

  useLayoutEffect(() => {
    active.current = true
    const el = viewport.current
    // A scroll event alone cannot distinguish reading from browser anchoring,
    // content shrinkage, or a focused element being brought into view.
    const nestedScrollerConsumes = (target: EventTarget | null, direction: number) => {
      for (
        let node = target instanceof Element ? target : null;
        node && node !== el;
        node = node.parentElement
      ) {
        if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue
        if (direction < 0 ? node.scrollTop > 0 : node.scrollHeight - node.scrollTop - node.clientHeight > 1)
          return true
      }
      return false
    }
    const noteIntent = (direction: number) => {
      scrollIntent.current.direction = direction
      scrollIntent.current.until = Date.now() + 750
      // Stop before the next render/resize can snap an upward gesture back.
      if (direction < 0 && el && el.scrollTop > 0 && following.current) pauseFollowing()
    }
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.deltaY === 0) return
      const direction = Math.sign(event.deltaY)
      if (!nestedScrollerConsumes(event.target, direction)) noteIntent(direction)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const direction = ['ArrowUp', 'PageUp', 'Home'].includes(event.key)
        ? -1
        : ['ArrowDown', 'PageDown', 'End'].includes(event.key)
          ? 1
          : event.key === ' ' && !target?.closest('button, a')
            ? event.shiftKey
              ? -1
              : 1
            : 0
      if (direction && !nestedScrollerConsumes(event.target, direction)) noteIntent(direction)
    }
    const onPointerDown = (event: PointerEvent) => {
      // Mouse clicks on message/tool content are not scrollbar gestures.
      if (!el || event.target !== el || event.pointerType === 'touch') return
      const gutter = Math.max(12, el.offsetWidth - el.clientWidth)
      if (event.clientX < el.getBoundingClientRect().right - gutter) return
      scrollIntent.current = { direction: 0, until: Date.now() + 750, pointerDown: true }
    }
    const onPointerUp = () => {
      if (!scrollIntent.current.pointerDown) return
      scrollIntent.current.pointerDown = false
      scrollIntent.current.until = Date.now() + 750
    }
    let touchY: number | null = null
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches.length === 1 ? event.touches[0].clientY : null
    }
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches.length === 1 ? event.touches[0].clientY : null
      if (touchY !== null && nextY !== null) {
        const direction = Math.sign(touchY - nextY)
        if (direction && !nestedScrollerConsumes(event.target, direction)) noteIntent(direction)
      }
      touchY = nextY
    }
    el?.addEventListener('wheel', onWheel, { passive: true })
    el?.addEventListener('keydown', onKeyDown)
    el?.addEventListener('pointerdown', onPointerDown, { passive: true })
    el?.addEventListener('touchstart', onTouchStart, { passive: true })
    el?.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    const observer = new ResizeObserver(() => {
      const el = viewport.current
      if (!el || !restored.current || !following.current) return
      // Images, expanded tools, font changes and the composer can resize after render.
      el.scrollTop = el.scrollHeight
      lastScrollTop.current = el.scrollTop
    })
    if (viewport.current) observer.observe(viewport.current)
    if (content.current) observer.observe(content.current)
    return () => {
      active.current = false
      navigation.current++
      pendingHistory.current = null
      observer.disconnect()
      el?.removeEventListener('wheel', onWheel)
      el?.removeEventListener('keydown', onKeyDown)
      el?.removeEventListener('pointerdown', onPointerDown)
      el?.removeEventListener('touchstart', onTouchStart)
      el?.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
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
    lastScrollTop.current = el.scrollTop
    props.onPosition(following.current ? -1 : el.scrollTop)
  }, [props.blocks, props.messages.messages, props.messages.historyVersion])

  function anchorId(messageId: string) {
    return `${prefix}-${getConversationMessageAnchorId(messageId)}`
  }

  function onScroll() {
    const el = viewport.current
    if (!el || !restored.current || el.clientHeight === 0) return
    const movedUp = el.scrollTop < lastScrollTop.current - 1
    const movedDown = el.scrollTop > lastScrollTop.current + 1
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    const intent = scrollIntent.current
    const manual = intent.pointerDown || intent.until >= Date.now()
    lastScrollTop.current = el.scrollTop
    if (manual && movedUp && intent.direction <= 0 && gap > 1) {
      pauseFollowing()
    } else if (!following.current && manual && movedDown && intent.direction >= 0 && gap <= 1) {
      // Reaching the bottom by wheel, keyboard or scrollbar resumes streaming,
      // including reloading the tail if older pages evicted newer messages.
      followLatest()
      void props.messages.refetch()
    }
    setAway(!following.current)
    props.onPosition(following.current ? -1 : el.scrollTop)
  }

  function followLatest() {
    navigation.current++
    pendingHistory.current = null
    scrollIntent.current.until = 0
    props.messages.cancelLoadMore()
    following.current = true
    setAway(false)
    setLocated('')
    // Set the store directly so the caller controls the single tail refresh.
    setMessageViewMode(props.sessionId, 'tail')
    if (viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight
      lastScrollTop.current = viewport.current.scrollTop
    }
    props.onPosition(-1)
  }

  function jumpToMessage(messageId: string): boolean {
    const el = viewport.current
    const target = document.getElementById(anchorId(messageId))
    if (!el || !target || !el.contains(target)) return false
    navigation.current++
    pendingHistory.current = null
    scrollIntent.current.until = 0
    props.messages.cancelLoadMore()
    following.current = false
    setAway(true)
    setLocated(messageId)
    setMessageViewMode(props.sessionId, 'history')
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12
    lastScrollTop.current = el.scrollTop
    target.focus({ preventScroll: true })
    props.onPosition(el.scrollTop)
    return true
  }

  async function loadEarlier(): Promise<OlderHistoryLoadResult> {
    if (!props.messages.hasMore) return 'terminal-stop'
    if (props.messages.isLoadingMore || props.messages.isSyncingTail) return 'transient-stop'
    const run = ++navigation.current
    scrollIntent.current.until = 0
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
    if (outcome.kind === 'applied') return 'loaded'
    if (outcome.kind === 'stopped' && (outcome.reason === 'busy' || outcome.reason === 'epoch-reset'))
      return 'transient-stop'
    return 'terminal-stop'
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
