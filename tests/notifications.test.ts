import { describe, expect, it } from 'vitest'
import { NotificationTracker } from '../src/main/notifications'
import type { SyncEvent } from '@hapi/protocol/schemas'

const summary = (id: string, count = 1) => ({
  id,
  updatedAt: 1,
  metadataVersion: 1,
  agentStateVersion: 1,
  pendingRequestsCount: count,
  pendingRequests: Array.from({ length: count }, (_, index) => ({ id: `request-${index}` })),
  metadata: { path: '/project', name: id },
})

describe('notification state', () => {
  it('removes sessions missing from a complete resync snapshot without notifying', () => {
    const tracker = new NotificationTracker()
    tracker.prime({ sessions: [summary('removed'), summary('kept', 2)] })
    tracker.prime({ sessions: [summary('kept', 2)] })
    expect(tracker.pendingCount).toBe(2)
    tracker.prime({ sessions: [] })
    expect(tracker.pendingCount).toBe(0)
  })

  it('preserves live changes during resync and does not resurrect removed or ended sessions', () => {
    const tracker = new NotificationTracker()
    tracker.prime({ sessions: [summary('old'), summary('updated'), summary('removed'), summary('ended')] })
    const snapshot = tracker.beginSnapshot()
    for (const sessionId of ['updated', 'added']) {
      tracker.handle(
        {
          type: 'session-updated',
          sessionId,
          data: {
            agentState: {
              version: 2,
              value: {
                requests: {
                  first: { tool: 'Bash', arguments: {} },
                  second: { tool: 'Bash', arguments: {} },
                },
              },
            },
          },
        },
        false,
      )
    }
    tracker.handle({ type: 'session-removed', sessionId: 'removed' }, false)
    tracker.handle({ type: 'session-removed', sessionId: 'removed-before-baseline' }, false)
    tracker.handle({ type: 'session-ended', sessionId: 'ended', reason: 'completed' }, false)
    tracker.prime(
      { sessions: [summary('removed'), summary('removed-before-baseline'), summary('ended')] },
      snapshot,
    )
    expect(tracker.pendingCount).toBe(4)
    // The next full snapshot can remove previously protected entries normally.
    tracker.prime({ sessions: [] })
    expect(tracker.pendingCount).toBe(0)
  })

  it('ignores malformed snapshots and snapshots from a previous connection or cancelled request', () => {
    const tracker = new NotificationTracker()
    tracker.prime({ sessions: [summary('existing')] })
    tracker.prime({ sessions: [{}] })
    expect(tracker.pendingCount).toBe(1)
    const obsolete = tracker.beginSnapshot()
    tracker.reset()
    tracker.prime({ sessions: [summary('obsolete')] }, obsolete)
    expect(tracker.pendingCount).toBe(0)
    const cancelled = tracker.beginSnapshot()
    tracker.cancelSnapshot(cancelled)
    tracker.prime({ sessions: [summary('cancelled')] }, cancelled)
    expect(tracker.pendingCount).toBe(0)
  })

  it('fills request counts from REST when only metadata changed during the snapshot', () => {
    const tracker = new NotificationTracker()
    const snapshot = tracker.beginSnapshot()
    tracker.handle(
      {
        type: 'session-updated',
        sessionId: 'renamed',
        data: {
          updatedAt: 2,
          metadata: { version: 2, value: { path: '/project', host: 'runner', name: 'Live title' } },
        },
      },
      false,
    )
    tracker.prime({ sessions: [summary('renamed')] }, snapshot)
    expect(tracker.pendingCount).toBe(1)
    expect(
      tracker.handle(
        {
          type: 'session-updated',
          sessionId: 'renamed',
          data: {
            agentState: { version: 2, value: { requests: { new: { tool: 'Bash', arguments: {} } } } },
          },
        },
        false,
      ),
    ).toEqual([{ sessionId: 'renamed', title: 'Live title', kind: 'Approval needed' }])
  })

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
