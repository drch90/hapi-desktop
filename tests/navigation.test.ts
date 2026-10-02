import { beforeEach, describe, expect, it } from 'vitest'
import { emptyWorkspace, loadWorkspace, reduceWorkspace, type Workspace } from '../src/renderer/lib/workspace'
import { selectSessionList } from '../src/renderer/lib/sessionList'
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

beforeEach(() => localStorage.clear())
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
    status: 'All',
    machine: '',
    unreadOnly: false,
    lastSeen: {},
    scope: 'alice',
    byStatus: true,
  }
  it('separates global and project pins without duplicate rows', () => {
    const sections = selectSessionList(options)
    expect(sections.map((section) => section.key)).toEqual(['global-pinned', 'project-pinned', 'history'])
    expect(sections.flatMap((section) => section.groups.flatMap(([, group]) => group.sessions))).toHaveLength(
      3,
    )
  })
  it('matches multiple words across fields and combines machine/status/unread lenses', () => {
    const sections = selectSessionList({
      ...options,
      search: 'API server',
      unreadOnly: true,
      lastSeen: { 'alice:a': 100 },
      machine: 'linux-1',
      status: 'History',
    })
    expect(
      sections.flatMap((section) =>
        section.groups.flatMap(([, group]) => group.sessions.map((row) => row.id)),
      ),
    ).toEqual(['c'])
    expect(selectSessionList({ ...options, machine: 'missing' })).toEqual([])
  })
  it('matches session IDs and worktree paths while preserving pinned grouping during search', () => {
    expect(selectSessionList({ ...options, search: 'a', byStatus: false })[0].key).toBe('global-pinned')
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
