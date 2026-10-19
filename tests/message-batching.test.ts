import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearMessageWindow,
  getMessageWindowState,
  ingestIncomingMessages,
  markMessagesIndeterminate,
  markMessagesRequeued,
  removeOptimisticMessage,
} from '@/lib/message-window-store'
import { applyDesktopEvent, forgetSession, resetCaches, watchSession } from '../src/renderer/lib/sync'
import { fixtureMessage } from './fake-server'
import type { DecryptedMessage } from '@/types/api'

const sessionId = 'batching-test'
let unwatch: () => void
const receive = (message: DecryptedMessage) =>
  applyDesktopEvent({ type: 'sync', replay: false, event: { type: 'message-received', sessionId, message } })

beforeEach(() => {
  vi.useFakeTimers()
  clearMessageWindow(sessionId)
  unwatch = watchSession(sessionId)
})
afterEach(() => {
  unwatch()
  resetCaches()
  clearMessageWindow(sessionId)
  vi.useRealTimers()
})

describe('streaming message batches', () => {
  it('coalesces a burst into the latest snapshot while preserving other messages', () => {
    const before = getMessageWindowState(sessionId).messagesVersion
    for (let index = 0; index < 500; index++) receive(fixtureMessage('live', 1, `snapshot ${index}`))
    receive(fixtureMessage('other', 2, 'Independent message'))
    vi.advanceTimersByTime(60)
    const state = getMessageWindowState(sessionId)
    expect(state.messages).toHaveLength(2)
    expect(JSON.stringify(state.messages[0].content)).toContain('snapshot 499')
    expect(state.messages[1].id).toBe('other')
    expect(state.messagesVersion - before).toBe(1)
  })

  it('applies consumption and cancellation after preceding queued messages', () => {
    receive({
      ...fixtureMessage('queued', 1, 'Queued', true),
      localId: 'queued',
      invokedAt: null,
      status: 'queued',
    })
    applyDesktopEvent({
      type: 'sync',
      replay: false,
      event: { type: 'messages-consumed', sessionId, localIds: ['queued'], invokedAt: 42, steered: true },
    })
    expect(getMessageWindowState(sessionId).messages[0]).toMatchObject({ invokedAt: 42, steered: true })
    receive({
      ...fixtureMessage('cancelled', 2, 'Cancel', true),
      localId: 'cancelled',
      invokedAt: null,
      status: 'queued',
    })
    applyDesktopEvent({
      type: 'sync',
      replay: false,
      event: { type: 'message-cancelled', sessionId, messageId: 'cancelled', localId: 'cancelled' },
    })
    vi.advanceTimersByTime(60)
    expect(getMessageWindowState(sessionId).messages.map((message) => message.id)).toEqual(['queued'])
  })

  it('shows dispatching separately and never replaces a confirmed receipt with a late pending event', () => {
    receive({ ...fixtureMessage('stored', 1, 'guidance', true), localId: 'guidance', invokedAt: null })
    const dispatching = { type: 'messages-dispatching' as const, sessionId, localIds: ['guidance'] }
    applyDesktopEvent({ type: 'sync', replay: false, event: dispatching })
    expect(getMessageWindowState(sessionId).messages[0].deliveryState).toBe('dispatching')
    applyDesktopEvent({
      type: 'sync',
      replay: false,
      event: { type: 'messages-consumed', sessionId, localIds: ['guidance'], invokedAt: 42, steered: true },
    })
    applyDesktopEvent({ type: 'sync', replay: false, event: dispatching })
    applyDesktopEvent({
      type: 'sync',
      replay: false,
      event: { type: 'messages-indeterminate', sessionId, localIds: ['guidance'] },
    })
    expect(getMessageWindowState(sessionId).messages[0]).toMatchObject({ invokedAt: 42, steered: true })
    expect(getMessageWindowState(sessionId).messages[0].deliveryState).toBeUndefined()
  })

  it.each(['indeterminate', 'requeued', 'cancelled'] as const)(
    'keeps REST %s reconciliation newer than an earlier user-message snapshot',
    (outcome) => {
      const message: DecryptedMessage = {
        ...fixtureMessage('stored-queued', 1, 'Queued', true),
        localId: 'queued-local',
        invokedAt: null,
        ...(outcome === 'requeued' ? { deliveryState: 'indeterminate' } : {}),
      }
      // A send response can load the row before its buffered SSE snapshot is
      // rendered. A subsequent queue operation then receives newer REST state.
      ingestIncomingMessages(sessionId, [message])
      receive({ ...message })
      if (outcome === 'indeterminate') markMessagesIndeterminate(sessionId, ['queued-local'])
      else if (outcome === 'requeued') markMessagesRequeued(sessionId, ['queued-local'])
      else removeOptimisticMessage(sessionId, 'queued-local')
      vi.advanceTimersByTime(60)
      const messages = getMessageWindowState(sessionId).messages
      if (outcome === 'cancelled') expect(messages).toEqual([])
      else {
        expect(messages).toHaveLength(1)
        expect(messages[0].deliveryState).toBe(outcome === 'indeterminate' ? 'indeterminate' : undefined)
      }
    },
  )

  it('does not resurrect pending data after forgetting a session or resetting accounts', () => {
    receive(fixtureMessage('removed', 1, 'Removed'))
    forgetSession(sessionId)
    vi.advanceTimersByTime(60)
    expect(getMessageWindowState(sessionId).messages).toEqual([])
    receive(fixtureMessage('old-account', 2, 'Old account'))
    resetCaches()
    vi.advanceTimersByTime(60)
    expect(getMessageWindowState(sessionId).messages).toEqual([])
  })
})
