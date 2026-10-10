import { beforeEach, describe, expect, it } from 'vitest'
import {
  emptyWorkspace,
  isHistoryGroupCollapsed,
  loadDraft,
  loadWorkspace,
  reduceWorkspace,
  saveDraft,
  saveWorkspace,
  type Workspace,
} from '../src/renderer/lib/workspace'
import { selectSessionList } from '../src/renderer/lib/sessionList'
import { markSessionArchived, queries, sessionKey, sessionsKey } from '../src/renderer/lib/sync'
import { fixtureSession, fixtureMessage } from './fake-server'
import { toSessionSummary } from '@hapi/protocol'
import { hubRequestSchema, remoteFileSchema } from '../src/shared/policy'
import {
  beginQueueEdit,
  loadQueueEdit,
  queueEditEpoch,
  resetQueueEdits,
  saveQueueEdit,
} from '../src/renderer/lib/queueEdit'

beforeEach(() => {
  localStorage.clear()
  queries.clear()
})
function workspace(): Workspace {
  let state = structuredClone(emptyWorkspace)
  for (const id of ['a', 'b', 'c', 'd']) state = reduceWorkspace(state, { type: 'open', id })
  return reduceWorkspace(state, { type: 'open', id: 'other', pane: 1 })
}
describe('tab management', () => {
  it('closes relative to an inactive target and only within its pane', () => {
    const state = workspace()
    const next = reduceWorkspace(state, { type: 'close-tabs', pane: 0, id: 'b', range: 'right' })
    expect(next.panes.map((pane) => pane.tabs)).toEqual([['a', 'b'], ['other']])
    expect(next.panes[0].active).toBe('b')
    expect(next.panes[1].active).toBe('other')
    expect(state.panes[0].tabs).toEqual(['a', 'b', 'c', 'd'])
    expect(next.closedTabs.map((item) => [item.id, item.index])).toEqual([
      ['d', 3],
      ['c', 2],
    ])
  })
  it('restores bulk closes in their original order and position', () => {
    let state = reduceWorkspace(workspace(), { type: 'close-tabs', pane: 0, id: 'c', range: 'all' })
    for (let i = 0; i < 4; i++)
      state = reduceWorkspace(state, { type: 'restore', available: ['a', 'b', 'c', 'd'] })
    expect(state.panes[0].tabs).toEqual(['a', 'b', 'c', 'd'])
    expect(state.closedTabs).toEqual([])
  })
  it('keeps the target when closing other tabs and restores both sides in order', () => {
    const original = workspace()
    let state = reduceWorkspace(original, { type: 'close-tabs', pane: 0, id: 'b', range: 'others' })
    expect(state.panes[0]).toEqual({ tabs: ['b'], active: 'b' })
    expect(state.panes[1]).toEqual(original.panes[1])
    expect(state.focused).toBe(1)
    expect(state.closedTabs.map((item) => [item.id, item.index])).toEqual([
      ['d', 3],
      ['c', 2],
      ['a', 0],
    ])
    expect(reduceWorkspace(state, { type: 'close-tabs', pane: 0, id: 'b', range: 'others' })).toEqual(state)
    expect(reduceWorkspace(state, { type: 'close-tabs', pane: 0, id: 'missing', range: 'others' })).toBe(
      state,
    )
    for (let i = 0; i < 3; i++)
      state = reduceWorkspace(state, { type: 'restore', available: ['a', 'b', 'c', 'd'] })
    expect(state.panes[0].tabs).toEqual(original.panes[0].tabs)
    expect(state.closedTabs).toEqual([])
    const activeTarget = reduceWorkspace(original, { type: 'close-tabs', pane: 0, id: 'd', range: 'others' })
    expect(activeTarget.panes[0]).toEqual({ tabs: ['d'], active: 'd' })
    expect(activeTarget.panes[1]).toEqual(original.panes[1])
  })
  it('keeps same-pane active identity while reordering and activates cross-pane drops', () => {
    let state = reduceWorkspace(workspace(), { type: 'place', id: 'a', pane: 0, index: 2 })
    expect(state.panes[0]).toEqual({ tabs: ['b', 'c', 'a', 'd'], active: 'd' })
    state = reduceWorkspace(state, { type: 'place', id: 'd', pane: 1, index: 0 })
    expect(state.panes[1]).toEqual({ tabs: ['d', 'other'], active: 'd' })
    expect(state.panes[0].active).toBe('a')
    expect(state.focused).toBe(1)
  })
  it('does not resurrect deleted sessions or duplicate already opened tabs', () => {
    let state = reduceWorkspace(workspace(), { type: 'close', id: 'a' })
    state = reduceWorkspace(state, { type: 'remove', id: 'a' })
    expect(state.closedTabs).toEqual([])
    state = reduceWorkspace(state, { type: 'close', id: 'b' })
    state = reduceWorkspace(state, { type: 'open', id: 'b', pane: 1 })
    state = reduceWorkspace(state, { type: 'restore', available: ['b'] })
    expect(state.panes.flatMap((pane) => pane.tabs).filter((id) => id === 'b')).toHaveLength(1)
    expect(state.panes[1].active).toBe('b')
  })
  it('restores into the focused single pane after merging, skips missing IDs, and bounds history', () => {
    let state = reduceWorkspace(workspace(), { type: 'close', id: 'other' })
    state = reduceWorkspace(state, { type: 'split' })
    state = reduceWorkspace(state, { type: 'restore', available: ['other'] })
    expect(state.split).toBe(false)
    expect(state.panes[0].tabs).toContain('other')
    for (let i = 0; i < 40; i++) {
      state = reduceWorkspace(state, { type: 'open', id: `closed-${i}` })
      state = reduceWorkspace(state, { type: 'close', id: `closed-${i}` })
    }
    expect(state.closedTabs).toHaveLength(30)
    state = reduceWorkspace(state, { type: 'restore', available: [] })
    expect(state.closedTabs).toEqual([])
  })
  it('upgrades old layout state and isolates sidebar preferences by account', () => {
    const { sidebarWidth: _width, sidebarCollapsed: _collapsed, closedTabs: _history, ...old } = workspace()
    localStorage.setItem('desktop:workspace:alice', JSON.stringify(old))
    expect(loadWorkspace('alice').sidebarWidth).toBe(272)
    let state = reduceWorkspace(loadWorkspace('alice'), { type: 'sidebar-width', width: 800 })
    state = reduceWorkspace(state, { type: 'sidebar' })
    localStorage.setItem('desktop:workspace:alice', JSON.stringify(state))
    expect(loadWorkspace('alice')).toMatchObject({ sidebarWidth: 480, sidebarCollapsed: true })
    expect(loadWorkspace('bob').sidebarCollapsed).toBe(false)
  })
})

describe('historical tab previews', () => {
  it('applies a confirmed archive before a delayed list response can reopen it as active', async () => {
    const session = fixtureSession('archiving', 'Archive now', 'codex')
    const other = fixtureSession('other', 'Keep open', 'claude')
    const rows = [session, other].map(toSessionSummary)
    queries.setQueryData(sessionsKey, rows)
    queries.setQueryData(sessionKey(session.id), session)
    saveDraft('alice', session.id, { text: 'keep this draft', scrollTop: 10, expanded: [] })
    let finish!: (value: typeof rows) => void
    const refresh = queries
      .fetchQuery({
        queryKey: sessionsKey,
        staleTime: 0,
        queryFn: () =>
          new Promise<typeof rows>((resolve) => {
            finish = resolve
          }),
      })
      .catch(() => undefined)
    await markSessionArchived(session.id)
    finish(rows)
    await refresh
    expect(queries.getQueryData<typeof rows>(sessionsKey)?.[0]).toMatchObject({
      active: false,
      thinking: false,
      metadata: { lifecycleState: 'archived' },
    })
    expect(queries.getQueryData<typeof rows>(sessionsKey)?.[1]).toEqual(rows[1])
    expect(queries.getQueryData<typeof session>(sessionKey(session.id))?.active).toBe(false)
    expect(loadDraft('alice', session.id).text).toBe('keep this draft')
    expect(session.active).toBe(true)
  })

  it('replaces only the same-pane preview while retaining saved tabs and drafts', () => {
    const initial = reduceWorkspace(workspace(), { type: 'open', id: 'first', pane: 0, preview: true })
    saveDraft('alice', 'first', { text: 'unfinished thought', scrollTop: 23, expanded: [] })
    const next = reduceWorkspace(initial, { type: 'open', id: 'second', pane: 0, preview: true })
    expect(next.panes[0]).toMatchObject({ tabs: ['a', 'b', 'c', 'd', 'second'], preview: 'second' })
    expect(next.panes[1]).toEqual(initial.panes[1])
    expect(initial.panes[0].preview).toBe('first')
    expect(next.closedTabs).toEqual([])
    expect(loadDraft('alice', 'first').text).toBe('unfinished thought')
    const other = reduceWorkspace(next, { type: 'open', id: 'third', pane: 1, preview: true })
    expect(other.panes.map((pane) => pane.preview)).toEqual(['second', 'third'])
  })

  it('focuses an existing tab across panes without duplicating or demoting it', () => {
    let state = reduceWorkspace(workspace(), { type: 'open', id: 'past', pane: 0, preview: true })
    state = reduceWorkspace(state, { type: 'open', id: 'past', pane: 1, preview: true })
    expect(state.focused).toBe(0)
    expect(state.panes[0].preview).toBe('past')
    state = reduceWorkspace(state, { type: 'open', id: 'a' })
    state = reduceWorkspace(state, { type: 'open', id: 'past' })
    expect(state.panes[0].preview).toBe('past')
    state = reduceWorkspace(state, { type: 'open', id: 'other', pane: 0, preview: true })
    expect(state.focused).toBe(1)
    expect(state.panes[1]).toEqual({ tabs: ['other'], active: 'other' })
    expect(state.panes.flatMap((pane) => pane.tabs).filter((id) => id === 'past')).toHaveLength(1)
  })

  it('keeps a preview explicitly without changing focus and saves it across reloads', () => {
    let state = reduceWorkspace(workspace(), { type: 'open', id: 'past', pane: 0, preview: true })
    state = reduceWorkspace(state, { type: 'focus', pane: 1 })
    state = reduceWorkspace(state, { type: 'keep-tab', id: 'past' })
    expect(state.focused).toBe(1)
    expect(state.panes[0].preview).toBeUndefined()
    saveWorkspace('alice', state)
    expect(loadWorkspace('alice').panes[0].tabs).toContain('past')
    expect(reduceWorkspace(state, { type: 'keep-tab', id: 'missing' })).toBe(state)
    state = reduceWorkspace(state, { type: 'open', id: 'next', preview: true })
    state = reduceWorkspace(state, { type: 'open', id: 'next', preview: false })
    expect(state.panes[1].preview).toBeUndefined()
  })

  it('does not persist previews or their active selection, including old serialized preview state', () => {
    let state = reduceWorkspace(workspace(), { type: 'open', id: 'a' })
    state = reduceWorkspace(state, { type: 'open', id: 'preview-left', preview: true })
    state = reduceWorkspace(state, { type: 'open', id: 'preview-right', pane: 1, preview: true })
    saveWorkspace('alice', state)
    expect(localStorage.getItem('desktop:workspace:alice')).not.toContain('preview-')
    expect(loadWorkspace('alice').panes).toEqual([
      { tabs: ['a', 'b', 'c', 'd'], active: 'a' },
      { tabs: ['other'], active: 'other' },
    ])
    expect(state.panes[0].preview).toBe('preview-left')
    expect(loadWorkspace('bob')).toEqual(emptyWorkspace)
    localStorage.setItem('desktop:workspace:old', JSON.stringify(state))
    expect(loadWorkspace('old').panes).toEqual(loadWorkspace('alice').panes)
    const onlyPreview = reduceWorkspace(emptyWorkspace, { type: 'open', id: 'only', preview: true })
    saveWorkspace('preview-only', onlyPreview)
    expect(loadWorkspace('preview-only').panes[0]).toEqual({ tabs: [], active: null })
  })

  it('excludes replaced and closed previews from recently closed tabs', () => {
    let state = reduceWorkspace(workspace(), { type: 'open', id: 'past', pane: 0, preview: true })
    const closed = reduceWorkspace(state, { type: 'close', id: 'past' })
    expect(closed.panes[0]).toEqual(workspace().panes[0])
    expect(closed.closedTabs).toEqual([])
    expect(reduceWorkspace(state, { type: 'remove', id: 'past' }).panes[0].preview).toBeUndefined()
    state = reduceWorkspace(state, { type: 'close-tabs', pane: 0, id: 'b', range: 'others' })
    expect(state.panes[0]).toEqual({ tabs: ['b'], active: 'b' })
    expect(state.closedTabs.map((record) => record.id)).toEqual(['d', 'c', 'a'])
    state = reduceWorkspace(state, { type: 'restore', available: ['a', 'past'] })
    expect(state.panes[0].active).toBe('a')
  })

  it('keeps previews when explicitly moved or reordered without displacing the destination preview', () => {
    let state = reduceWorkspace(workspace(), { type: 'open', id: 'left', pane: 0, preview: true })
    state = reduceWorkspace(state, { type: 'open', id: 'right', pane: 1, preview: true })
    const placed = reduceWorkspace(state, { type: 'place', id: 'left', pane: 1, index: 0 })
    expect(placed.panes[0].preview).toBeUndefined()
    expect(placed.panes[1]).toEqual({ tabs: ['left', 'other', 'right'], active: 'left', preview: 'right' })
    const moved = reduceWorkspace(state, { type: 'move', id: 'left', pane: 1 })
    expect(moved.panes[0].preview).toBeUndefined()
    expect(moved.panes[1].preview).toBe('right')
    expect(moved.panes[1].active).toBe('left')
    const reordered = reduceWorkspace(state, { type: 'place', id: 'left', pane: 0, index: 0 })
    expect(reordered.panes[0].preview).toBeUndefined()
  })

  it('retains at most one preview when merging panes and preserves all saved tabs', () => {
    let state = reduceWorkspace(workspace(), { type: 'open', id: 'left', pane: 0, preview: true })
    state = reduceWorkspace(state, { type: 'open', id: 'right', pane: 1, preview: true })
    const merged = reduceWorkspace(state, { type: 'split' })
    expect(merged.panes[0]).toEqual({
      tabs: ['a', 'b', 'c', 'd', 'other', 'right'],
      active: 'right',
      preview: 'right',
    })
    expect(merged.panes[1]).toEqual({ tabs: [], active: null })
    expect(merged.closedTabs).toEqual([])
    state = reduceWorkspace(state, { type: 'focus', pane: 0 })
    expect(reduceWorkspace(state, { type: 'split' }).panes[0].preview).toBe('left')
  })

  it('shows the remaining preview when merging from an empty focused pane', () => {
    let state = reduceWorkspace(emptyWorkspace, { type: 'open', id: 'past', pane: 1, preview: true })
    state = reduceWorkspace(state, { type: 'focus', pane: 0 })
    state = reduceWorkspace(state, { type: 'split' })
    expect(state.panes[0]).toEqual({ tabs: ['past'], active: 'past', preview: 'past' })
    expect(state.focused).toBe(0)
    saveWorkspace('alice', state)
    expect(loadWorkspace('alice').panes[0]).toEqual({ tabs: [], active: null })
  })

  it('promotes resumed IDs and clears preview markers when removing duplicate destinations', () => {
    let state = reduceWorkspace(emptyWorkspace, { type: 'open', id: 'old', preview: true })
    const sameId = reduceWorkspace(state, { type: 'replace', from: 'old', to: 'old' })
    expect(sameId.panes[0]).toEqual({ tabs: ['old'], active: 'old' })
    state = reduceWorkspace(state, { type: 'open', id: 'new', pane: 1, preview: true })
    state = reduceWorkspace(state, { type: 'replace', from: 'old', to: 'new' })
    expect(state.panes).toEqual([
      { tabs: ['new'], active: 'new' },
      { tabs: [], active: null },
    ])
  })
})

describe('bulk workspace expansion', () => {
  it('overrides defaults for selected groups, deduplicates keys and preserves hidden-group choices', () => {
    let state = reduceWorkspace(emptyWorkspace, { type: 'toggle-history-group', key: 'hidden' })
    state = reduceWorkspace(state, {
      type: 'set-history-groups',
      keys: ['live', 'past', 'live'],
      collapsed: false,
    })
    expect(isHistoryGroupCollapsed(state, 'live', false)).toBe(false)
    expect(isHistoryGroupCollapsed(state, 'past', true)).toBe(false)
    expect(isHistoryGroupCollapsed(state, 'hidden', false)).toBe(true)
    expect(state.expandedHistoryGroups).toEqual(['live', 'past'])
    state = reduceWorkspace(state, { type: 'set-history-groups', keys: ['live', 'past'], collapsed: true })
    expect(isHistoryGroupCollapsed(state, 'live', false)).toBe(true)
    expect(isHistoryGroupCollapsed(state, 'past', true)).toBe(true)
    expect(state.expandedHistoryGroups).toEqual([])
    saveWorkspace('alice', state)
    expect(loadWorkspace('alice').collapsedHistoryGroups).toEqual(['hidden', 'live', 'past'])
    expect(isHistoryGroupCollapsed(loadWorkspace('bob'), 'live', false)).toBe(false)
  })
})

describe('session lenses', () => {
  const a = {
    ...toSessionSummary(fixtureSession('a', 'API review', 'codex')),
    updatedAt: 100,
    globalPinned: true,
  }
  const b = { ...toSessionSummary(fixtureSession('b', 'Tests', 'claude')), updatedAt: 200, pinned: true }
  const c = { ...toSessionSummary(fixtureSession('c', 'API migration', 'codex', false)), updatedAt: 300 }
  const options = {
    sessions: [a, b, c],
    machines: [{ id: 'linux-1', metadata: { host: 'server' } }],
    search: '',
    machine: '',
    unreadOnly: false,
    lastSeen: {},
    scope: 'alice',
  }
  it('separates global and project pins without duplicate rows', () => {
    const sections = selectSessionList(options)
    expect(sections.map((section) => section.key)).toEqual(['global-pinned', 'active', 'history'])
    expect(sections[1].groups[0][1].sessions).toEqual([b])
    expect(sections[2].groups[0][1].sessions).toEqual([c])
    expect(sections.flatMap((section) => section.groups.flatMap(([, group]) => group.sessions))).toHaveLength(
      3,
    )
  })
  it('floats individual live sessions into status sections while only history keeps workspace groups', () => {
    const running = { ...a, globalPinned: false, thinking: true }
    const idle = { ...b, pinned: false }
    const background = { ...idle, id: 'background', backgroundTaskCount: 2 }
    const pending = { ...idle, id: 'pending', pendingRequestsCount: 1 }
    const sessions = [running, idle, background, pending, c]
    const sections = selectSessionList({ ...options, sessions })
    expect(sections.map((section) => section.key)).toEqual(['thinking', 'active', 'history'])
    expect(sections[0].groups[0][1]).toMatchObject({
      path: '',
      hasDirectory: false,
      sessions: [background, pending, running],
    })
    expect(sections[1].groups[0][1]).toMatchObject({ hasDirectory: false, sessions: [idle] })
    expect(sections[2].groups[0][1]).toMatchObject({
      machineId: 'linux-1',
      path: running.metadata!.path,
      hasDirectory: true,
      sessions: [c],
    })
    const updated = selectSessionList({ ...options, sessions: [{ ...running, active: false }, idle, c] })
    expect(updated.map((section) => section.key)).toEqual(['active', 'history'])
    expect(updated[0].groups[0][1].sessions).toEqual([idle])
    expect(updated[1].groups[0][0]).toBe(sections[2].groups[0][0])
    expect(updated[1].groups[0][1].sessions.map((row) => row.id)).toEqual(['c', 'a'])
    expect(selectSessionList({ ...options, sessions: [a] }).map((section) => section.key)).toEqual([
      'global-pinned',
    ])
  })
  it('keeps historical paths on separate machines and applies search and unread filters', () => {
    const running = { ...a, globalPinned: false, active: false }
    const other = { ...b, active: false, pinned: false, metadata: { ...b.metadata!, machineId: 'linux-2' } }
    const base = { ...options, sessions: [running, other] }
    const headers = (overrides: Partial<typeof options> = {}) =>
      selectSessionList({ ...base, ...overrides }).flatMap((section) =>
        section.groups.map(([, group]) => group.machineId),
      )
    expect(headers()).toEqual(['linux-2', 'linux-1'])
    expect(headers({ machine: 'linux-1' })).toEqual(['linux-1'])
    expect(headers({ search: 'API review' })).toEqual(['linux-1'])
    expect(headers({ unreadOnly: true, lastSeen: { 'alice:a': running.updatedAt } })).toEqual(['linux-2'])
    expect(headers({ search: 'missing-workspace' })).toEqual([])
  })
  it('keeps live sections ahead of newer history and promotes project pins within their section', () => {
    const running = { ...a, globalPinned: false }
    const history = { ...c, metadata: { ...c.metadata!, path: '/home/dev/archived-project' } }
    const base = { ...options, sessions: [history, running] }
    expect(selectSessionList(base).map((section) => section.key)).toEqual(['active', 'history'])
    expect(selectSessionList({ ...base, search: 'API' }).map((section) => section.key)).toEqual([
      'active',
      'history',
    ])
    const pinned = { ...b, updatedAt: 1 }
    const sections = selectSessionList({ ...options, sessions: [running, pinned, history] })
    expect(sections[0].groups[0][1].sessions).toEqual([pinned, running])
    expect(sections[1].groups[0][1].path).toBe(history.metadata.path)
  })
  it('matches multiple words across fields and combines machine and unread lenses', () => {
    const sections = selectSessionList({
      ...options,
      search: 'API server',
      unreadOnly: true,
      lastSeen: { 'alice:a': 100 },
      machine: 'linux-1',
    })
    expect(
      sections.flatMap((section) =>
        section.groups.flatMap(([, group]) => group.sessions.map((row) => row.id)),
      ),
    ).toEqual(['b', 'c'])
    expect(selectSessionList({ ...options, machine: 'missing' })).toEqual([])
  })
  it('matches session IDs and worktree paths while preserving pinned grouping during search', () => {
    expect(selectSessionList({ ...options, search: 'a' })[0].key).toBe('global-pinned')
    const worktree = {
      ...c,
      metadata: {
        ...c.metadata!,
        worktree: {
          basePath: '/base',
          worktreePath: '/branch/feature-unique',
          branch: 'feature',
          name: 'work',
        },
      },
    }
    expect(selectSessionList({ ...options, sessions: [worktree], search: 'feature-unique' })).toHaveLength(1)
  })
})

describe('new API boundaries and edit recovery', () => {
  it('allows only the selected PUT routes and validates their payloads', () => {
    expect(
      hubRequestSchema.safeParse({ path: '/api/sessions/a/pin', method: 'PUT', body: { mode: 'global' } })
        .success,
    ).toBe(true)
    for (const body of [{ mode: 'invalid' }, { mode: 'none', path: '/tmp' }, {}])
      expect(hubRequestSchema.safeParse({ path: '/api/sessions/a/pin', method: 'PUT', body }).success).toBe(
        false,
      )
    expect(
      hubRequestSchema.safeParse({
        path: '/api/sessions/a/scratchlist/note',
        method: 'PUT',
        body: { text: 'updated' },
      }).success,
    ).toBe(true)
    expect(hubRequestSchema.safeParse({ path: '/api/hub-settings', method: 'PUT', body: {} }).success).toBe(
      false,
    )
    expect(
      hubRequestSchema.safeParse({ path: '/api/usage/summary?range=7d&timeZone=UTC', method: 'GET' }).success,
    ).toBe(true)
    expect(
      remoteFileSchema.safeParse({ kind: 'scratchlist', sessionId: 'a', attachmentId: '../private' }).success,
    ).toBe(false)
  })
  it('keeps a cancellation receipt across remounts and ignores writes from logged-out operations', () => {
    const message = {
      ...fixtureMessage('queued', 1, 'change the plan', true),
      localId: 'local',
      scheduledAt: Date.now() + 10000,
    }
    const record = beginQueueEdit('alice', 'a', message, 'existing draft')
    expect(loadQueueEdit('alice', 'a')).toMatchObject({ text: 'change the plan', state: 'checking' })
    expect(loadQueueEdit('bob', 'a')).toBeNull()
    const generation = queueEditEpoch()
    resetQueueEdits()
    localStorage.clear()
    saveQueueEdit('alice', 'a', { ...record, state: 'ready' }, generation)
    expect(loadQueueEdit('alice', 'a')).toBeNull()
  })
})
