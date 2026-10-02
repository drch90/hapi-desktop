import { SessionSchema, SessionPatchSchema, type SyncEvent } from '@hapi/protocol/schemas'
import { z } from 'zod'
import {
  extractMessageEventType,
  extractTaskNotification,
} from '../../vendor/hapi/hub/src/notifications/eventParsing'

export type Notice = {
  sessionId: string
  title: string
  kind: 'Approval needed' | 'Reply needed' | 'Agent ready' | 'Task completed' | 'Task failed'
}

export class NotificationTracker {
  private readonly seen = new Set<string>()
  private readonly sessions = new Map<
    string,
    {
      title: string
      requests: Set<string>
      count: number
      version: number
      metadataVersion: number
      updatedAt: number
    }
  >()
  private startedAt = Date.now()

  reset() {
    this.seen.clear()
    this.sessions.clear()
    this.startedAt = Date.now()
  }
  get pendingCount() {
    return [...this.sessions.values()].reduce((n, s) => n + s.count, 0)
  }

  prime(value: unknown) {
    const result = z
      .object({
        sessions: z.array(
          z.object({
            id: z.string(),
            updatedAt: z.number(),
            metadataVersion: z.number(),
            agentStateVersion: z.number(),
            pendingRequestsCount: z.number().min(0),
            pendingRequests: z.array(z.object({ id: z.string() })),
            metadata: z
              .object({
                name: z.string().optional(),
                path: z.string(),
                summary: z.object({ text: z.string() }).optional(),
              })
              .nullable(),
          }),
        ),
      })
      .safeParse(value)
    if (!result.success) return
    for (const row of result.data.sessions) {
      const current = this.sessions.get(row.id)
      if (current && (current.version > row.agentStateVersion || current.updatedAt > row.updatedAt)) continue
      const requests = new Set(row.pendingRequests.map((r) => r.id))
      this.sessions.set(row.id, {
        title:
          row.metadata?.name ||
          row.metadata?.summary?.text ||
          row.metadata?.path.split('/').pop() ||
          row.id.slice(0, 8),
        requests,
        count: row.pendingRequestsCount,
        version: row.agentStateVersion,
        metadataVersion: row.metadataVersion,
        updatedAt: row.updatedAt,
      })
      for (const id of requests) this.seen.add(`${row.id}:request:${id}`)
    }
  }

  handle(event: SyncEvent, replay: boolean): Notice[] {
    if (!('sessionId' in event)) return []
    const sessionId = event.sessionId
    if (event.type === 'session-removed') {
      this.sessions.delete(sessionId)
      return []
    }
    const session = this.sessions.get(sessionId) ?? {
      title: sessionId.slice(0, 8),
      requests: new Set<string>(),
      count: 0,
      version: -1,
      metadataVersion: -1,
      updatedAt: 0,
    }
    this.sessions.set(sessionId, session)
    const notices: Notice[] = []
    if (event.type === 'session-added' || event.type === 'session-updated') {
      const full = SessionSchema.safeParse(event.data)
      const patch = SessionPatchSchema.safeParse(event.data)
      const metadata = full.success ? full.data.metadata : patch.success ? patch.data.metadata?.value : null
      const metadataVersion = full.success
        ? full.data.metadataVersion
        : patch.success
          ? patch.data.metadata?.version
          : undefined
      if (metadata && metadataVersion !== undefined && metadataVersion > session.metadataVersion) {
        session.title =
          metadata.name || metadata.summary?.text || metadata.path?.split('/').pop() || session.title
        session.metadataVersion = metadataVersion
      }
      const version = full.success
        ? full.data.agentStateVersion
        : patch.success
          ? patch.data.agentState?.version
          : undefined
      const agentState = full.success
        ? full.data.agentState
        : patch.success
          ? patch.data.agentState?.value
          : undefined
      session.updatedAt = Math.max(
        session.updatedAt,
        full.success ? full.data.updatedAt : patch.success ? (patch.data.updatedAt ?? 0) : 0,
      )
      if (version !== undefined && version > session.version && agentState !== undefined) {
        const firstSnapshot = session.version < 0
        const hadBaseline = session.version >= 0 && session.requests.size >= session.count
        session.version = version
        const requests = agentState?.requests ?? {}
        session.requests = new Set(Object.keys(requests))
        session.count = session.requests.size
        for (const [id, request] of Object.entries(requests)) {
          const fresh =
            request.createdAt == null
              ? hadBaseline || (firstSnapshot && session.updatedAt >= this.startedAt)
              : request.createdAt >= this.startedAt
          const key = `${sessionId}:request:${id}`
          if (!replay && fresh && !this.seen.has(key)) {
            notices.push({
              sessionId,
              title: session.title,
              kind: /AskUserQuestion|request_user_input|ask_question/i.test(request.tool)
                ? 'Reply needed'
                : 'Approval needed',
            })
          }
          this.seen.add(key)
        }
      }
    }
    if (event.type === 'message-received') {
      const key = `${sessionId}:message:${event.message.id}`
      if (!this.seen.has(key) && !replay) {
        if (extractMessageEventType(event) === 'ready')
          notices.push({ sessionId, title: session.title, kind: 'Agent ready' })
        const task = extractTaskNotification(event)
        if (task?.status === 'failed' || task?.status === 'completed')
          notices.push({
            sessionId,
            title: session.title,
            kind: task.status === 'failed' ? 'Task failed' : 'Task completed',
          })
      }
      this.seen.add(key)
    }
    if (event.type === 'session-ended') {
      session.requests.clear()
      session.count = 0
      const key = `${sessionId}:ended:${session.updatedAt}:${event.reason}`
      if (!replay && !this.seen.has(key) && (event.reason === 'completed' || event.reason === 'error')) {
        notices.push({
          sessionId,
          title: session.title,
          kind: event.reason === 'error' ? 'Task failed' : 'Task completed',
        })
      }
      this.seen.add(key)
    }
    while (this.seen.size > 8000) this.seen.delete(this.seen.values().next().value!)
    return notices
  }
}
