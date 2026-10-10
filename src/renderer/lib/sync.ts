import { QueryClient } from '@tanstack/react-query'
import type { SessionSummary } from '@hapi/protocol'
import { SessionSchema, SessionPatchSchema, type Session } from '@hapi/protocol/schemas'
import {
  computePendingRequests,
  computePendingRequestsCount,
  computePendingRequestKinds,
  toSessionSummary,
  toSessionSummaryMetadata,
} from '@hapi/protocol'
import { applySessionDetailPatch } from '@/lib/sessionPatch'
import {
  clearMessageWindow,
  ingestIncomingMessages,
  invalidateMessageWindow,
  markMessagesConsumed,
  markMessagesIndeterminate,
  markMessagesRequeued,
  removeOptimisticMessage,
} from '@/lib/message-window-store'
import { reconcileQueuedStateAfterConnect } from '@/lib/queued-state-reconciliation'
import type { DesktopEvent } from '../../shared/bridge'
import { api } from './api'
import { resetQueueEdits } from './queueEdit'
import { resetAttachmentRuntime } from './useAttachments'

export const queries = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 20_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
})
export const sessionsKey = ['sessions'] as const
export const sessionKey = (id: string) => ['session', id] as const
export const machinesKey = ['machines'] as const
const opened = new Map<string, number>()
let refreshTimer: ReturnType<typeof setTimeout> | undefined

export function watchSession(id: string) {
  opened.set(id, (opened.get(id) ?? 0) + 1)
  return () => {
    const count = (opened.get(id) ?? 1) - 1
    if (count) opened.set(id, count)
    else opened.delete(id)
  }
}

export function refreshSessions() {
  if (refreshTimer) return
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    void queries.invalidateQueries({ queryKey: sessionsKey })
  }, 250)
}

export function resetCaches(eraseDrafts = false) {
  resetAttachmentRuntime(eraseDrafts)
  resetQueueEdits()
  clearTimeout(refreshTimer)
  refreshTimer = undefined
  for (const query of queries.getQueryCache().findAll({ queryKey: ['session'] }))
    clearMessageWindow(String(query.queryKey[1]))
  queries.clear()
}

export function forgetSession(id: string) {
  void queries.cancelQueries({ queryKey: sessionsKey })
  void queries.cancelQueries({ queryKey: sessionKey(id) })
  queries.removeQueries({ queryKey: sessionKey(id) })
  queries.setQueryData<SessionSummary[]>(sessionsKey, (rows) => rows?.filter((row) => row.id !== id))
  clearMessageWindow(id)
}

export async function markSessionArchived(id: string) {
  // Apply the confirmed result before the next list refresh, so reopening
  // immediately uses a preview even when the Hub does not send an SSE event.
  await Promise.all([
    queries.cancelQueries({ queryKey: sessionsKey }),
    queries.cancelQueries({ queryKey: sessionKey(id) }),
  ])
  queries.setQueryData<SessionSummary[]>(sessionsKey, (rows) =>
    rows?.map((row) =>
      row.id === id
        ? {
            ...row,
            active: false,
            thinking: false,
            metadata: row.metadata ? { ...row.metadata, lifecycleState: 'archived' } : null,
          }
        : row,
    ),
  )
  queries.setQueryData<Session>(sessionKey(id), (session) =>
    session ? { ...session, active: false, thinking: false } : session,
  )
}

// Exactly one bridge subscription feeds every pane. Per-session hooks only
// subscribe to the already normalized in-memory message window.
export function applyDesktopEvent(event: DesktopEvent) {
  if (event.type === 'resync' || (event.type === 'connection' && event.state.status === 'connected')) {
    refreshSessions()
    void queries.invalidateQueries({ queryKey: ['desktop-scratchlist'] })
    void queries.invalidateQueries({ queryKey: ['usage-summary'] })
    void queries.invalidateQueries({ queryKey: machinesKey })
    for (const id of opened.keys()) {
      void queries.invalidateQueries({ queryKey: sessionKey(id) })
      void reconcileQueuedStateAfterConnect(api, id).catch(() => {})
    }
    return
  }
  if (event.type !== 'sync') return
  const data = event.event
  if (data.type === 'machine-updated') {
    void queries.invalidateQueries({ queryKey: machinesKey })
    return
  }
  if (!('sessionId' in data)) return
  const id = data.sessionId
  switch (data.type) {
    case 'message-received':
      if (opened.has(id)) ingestIncomingMessages(id, [data.message])
      break
    case 'messages-consumed':
      markMessagesConsumed(id, data.localIds, data.invokedAt, data.steered)
      break
    case 'messages-indeterminate':
      markMessagesIndeterminate(id, data.localIds)
      break
    case 'messages-requeued':
      markMessagesRequeued(id, data.localIds)
      break
    case 'message-cancelled':
      if (data.localId) removeOptimisticMessage(id, data.localId)
      break
    case 'messages-invalidated':
      invalidateMessageWindow(id)
      if (opened.has(id)) void reconcileQueuedStateAfterConnect(api, id).catch(() => {})
      break
    case 'session-added':
      refreshSessions()
      break
    case 'session-updated': {
      void queries.invalidateQueries({
        predicate: (query) => query.queryKey[0] === 'desktop-scratchlist' && query.queryKey[2] === id,
      })
      const full = SessionSchema.safeParse(data.data)
      const patch = SessionPatchSchema.safeParse(data.data)
      if (full.success) {
        queries.setQueryData<Session>(sessionKey(id), (previous) => {
          if (!previous) return full.data
          const { metadata, agentState, todos, teamState, ...scalars } = full.data
          return (
            applySessionDetailPatch(previous, {
              ...scalars,
              metadata: { version: full.data.metadataVersion, value: metadata },
              agentState: { version: full.data.agentStateVersion, value: agentState },
              ...(todos ? { todos: { version: full.data.todosUpdatedAt ?? 0, value: todos } } : {}),
              ...(teamState
                ? { teamState: { version: full.data.teamStateUpdatedAt ?? 0, value: teamState } }
                : {}),
            }) ?? previous
          )
        })
        queries.setQueryData<SessionSummary[]>(sessionsKey, (previous) =>
          previous?.map((row) =>
            row.id === id &&
            full.data.updatedAt >= row.updatedAt &&
            full.data.metadataVersion >= row.metadataVersion &&
            full.data.agentStateVersion >= row.agentStateVersion
              ? toSessionSummary(full.data)
              : row,
          ),
        )
      } else if (patch.success) {
        refreshSessions()
        const p = patch.data
        queries.setQueryData<Session>(sessionKey(id), (previous) =>
          previous ? (applySessionDetailPatch(previous, p) ?? previous) : previous,
        )
        queries.setQueryData<SessionSummary[]>(sessionsKey, (previous) =>
          previous?.map((row) => {
            if (row.id !== id) return row
            const next = { ...row }
            if (p.active !== undefined) next.active = p.active
            if (p.thinking !== undefined) next.thinking = p.thinking
            if (p.backgroundTaskCount !== undefined) next.backgroundTaskCount = p.backgroundTaskCount
            if (p.model !== undefined) next.model = p.model
            if (p.updatedAt !== undefined) next.updatedAt = Math.max(row.updatedAt, p.updatedAt)
            if (p.metadata && p.metadata.version > row.metadataVersion) {
              next.metadataVersion = p.metadata.version
              next.metadata = toSessionSummaryMetadata(p.metadata.value)
            }
            if (p.agentState && p.agentState.version > row.agentStateVersion) {
              next.agentStateVersion = p.agentState.version
              next.pendingRequests = computePendingRequests(p.agentState.value, next.updatedAt)
              next.pendingRequestsCount = computePendingRequestsCount(p.agentState.value)
              next.pendingRequestKinds = computePendingRequestKinds(p.agentState.value)
            }
            return next
          }),
        )
      } else {
        refreshSessions()
        void queries.invalidateQueries({ queryKey: sessionKey(id) })
      }
      break
    }
    case 'session-ended':
      refreshSessions()
      void queries.invalidateQueries({ queryKey: sessionKey(id) })
      break
    case 'session-removed':
      forgetSession(id)
  }
}
