import { describe, expect, it } from 'vitest'
import { NotificationTracker } from '../src/main/notifications'
import type { SyncEvent } from '@hapi/protocol/schemas'

describe('notification state', () => {
  it('counts capped summary requests and emits only new request IDs, with monotonic versions', () => {
    const tracker = new NotificationTracker()
    tracker.prime({
      sessions: [
        {
          id: 's',
          updatedAt: 1,
          metadataVersion: 1,
          agentStateVersion: 1,
          pendingRequestsCount: 8,
          pendingRequests: [{ id: 'old' }],
          metadata: { path: '/project', name: 'Project' },
        },
      ],
    })
    expect(tracker.pendingCount).toBe(8)
    const event: SyncEvent = {
      type: 'session-updated',
      sessionId: 's',
      data: {
        updatedAt: Date.now(),
        agentState: {
          version: 2,
          value: {
            requests: {
              'request-map-key': {
                tool: 'request_user_input',
                toolCallId: 'different-tool-id',
                arguments: {},
                createdAt: Date.now() + 1,
              },
            },
          },
        },
      },
    }
    expect(tracker.handle(event, false)).toEqual([{ sessionId: 's', title: 'Project', kind: 'Reply needed' }])
    expect(tracker.handle(event, false)).toEqual([])
    expect(tracker.pendingCount).toBe(1)
    tracker.handle(
      {
        type: 'session-updated',
        sessionId: 's',
        data: { agentState: { version: 1, value: { requests: {} } } },
      },
      false,
    )
    expect(tracker.pendingCount).toBe(1)
    tracker.handle(
      {
        type: 'session-updated',
        sessionId: 's',
        data: { agentState: { version: 3, value: { requests: {} } } },
      },
      false,
    )
    expect(tracker.pendingCount).toBe(0)
  })
  it('does not toast historical requests on launch or repeated completed events', () => {
    const tracker = new NotificationTracker()
    expect(
      tracker.handle(
        {
          type: 'session-updated',
          sessionId: 's',
          data: {
            agentState: {
              version: 1,
              value: { requests: { old: { tool: 'Bash', arguments: {}, createdAt: 1 } } },
            },
          },
        },
        false,
      ),
    ).toEqual([])
    expect(tracker.pendingCount).toBe(1)
    expect(
      tracker.handle({ type: 'session-ended', sessionId: 's', reason: 'completed' }, false),
    ).toHaveLength(1)
    expect(tracker.handle({ type: 'session-ended', sessionId: 's', reason: 'completed' }, false)).toEqual([])
    expect(tracker.pendingCount).toBe(0)
    tracker.reset()
    expect(tracker.handle({ type: 'session-ended', sessionId: 's', reason: 'error' }, true)).toEqual([])
  })
})

describe('attention notifications without request timestamps', () => {
  it('establishes a silent baseline then detects new requests once and ignores replay', () => {
    const tracker = new NotificationTracker()
    const update = (version: number, ids: string[]): SyncEvent => ({
      type: 'session-updated',
      sessionId: 's',
      data: {
        agentState: {
          version,
          value: {
            requests: Object.fromEntries(
              ids.map((id) => [id, { tool: 'request_user_input', arguments: {} }]),
            ),
          },
        },
      },
    })
    expect(tracker.handle(update(1, ['old']), false)).toEqual([])
    expect(tracker.handle(update(2, ['old', 'new']), false)).toEqual([
      { sessionId: 's', title: 's', kind: 'Reply needed' },
    ])
    expect(tracker.handle(update(3, ['old', 'new']), false)).toEqual([])
    expect(tracker.handle(update(4, ['old', 'new', 'replay']), true)).toEqual([])
    expect(tracker.pendingCount).toBe(3)
    tracker.handle({ type: 'session-removed', sessionId: 's' }, false)
    expect(tracker.pendingCount).toBe(0)
  })
})
