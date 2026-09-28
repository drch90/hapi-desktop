import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hubRequestSchema, normalizeHubUrl } from '../src/shared/policy'
import { SseDecoder } from '../src/main/sse'
import {
  emptyWorkspace,
  loadWorkspace,
  reduceWorkspace,
  loadDraft,
  saveDraft,
  migrateSessionLocalState,
  isHistoryGroupCollapsed,
} from '../src/renderer/lib/workspace'
import { checkDelivery, loadAttempt, storeAttempt, uncertainDelivery } from '../src/renderer/lib/outbox'
import { ApiError, type ApiClient } from '@/api/client'
import { toIntlLocale } from '../src/shared/i18n'

beforeEach(() => localStorage.clear())

describe('desktop trust boundary', () => {
  it('permits only the session effort POST route', () => {
    expect(
      hubRequestSchema.safeParse({ path: '/api/sessions/a/effort', method: 'POST', body: { effort: 'high' } })
        .success,
    ).toBe(true)
    expect(hubRequestSchema.safeParse({ path: '/api/sessions/a/effort', method: 'GET' }).success).toBe(false)
  })
  it.each([
    'http://remote.example',
    'http://8.8.8.8:3006',
    'http://10.0.0.1.example.com:3006',
    'http://172.15.255.255:3006',
    'http://172.32.0.1:3006',
    'http://192.169.1.1:3006',
    'http://100.63.255.255:3006',
    'http://100.128.0.1:3006',
    'http://[2001:4860:4860::8888]:3006',
    'http://[::ffff:8.8.8.8]:3006',
    'http://name:secret@192.168.1.5:3006',
    'http://192.168.1.5:3006/api',
    'http://192.168.1.5:3006?token=secret',
    'http://192.168.1.5:3006#fragment',
    'file:///tmp/x',
    'https://name:secret@hub.example',
    'https://hub.example/api',
    'https://hub.example?token=x',
  ])('rejects an unsafe Hub origin %s', (origin) => expect(() => normalizeHubUrl(origin)).toThrow())
  it.each([
    'http://localhost:3006',
    'http://127.0.0.1:3006',
    'http://127.0.0.2:3006',
    'http://[::1]:3006',
    'http://10.0.0.1:3006',
    'http://10.255.255.254:3006',
    'http://172.16.0.1:3006',
    'http://172.31.255.254:3006',
    'http://192.168.1.5:3006',
    'http://100.64.0.1:3006',
    'http://100.127.255.254:3006',
    'http://[fc00::1]:3006',
    'http://[fd12:3456::1]:3006',
    'https://hub.example',
  ])('accepts a supported origin %s', (origin) => expect(normalizeHubUrl(origin + '/')).toBe(origin))
  it.each([
    'https://evil.example/api/sessions',
    '//evil.example/api/sessions',
    '/api/auth',
    '/api/sessions/a/terminal',
    '/api/sessions/a/../../machines',
    '/api/sessions/%2e%2e/machines',
    '/api/sessions/%252e%252e',
    '/api/sessions/a%2fb',
    '/api/sessions/a?token=x',
    '/api/sessions/a#x',
  ])('blocks arbitrary destinations, traversal and disallowed APIs %s', (path) =>
    expect(hubRequestSchema.safeParse({ path, method: 'GET' }).success).toBe(false),
  )
  it('allows read-only remote paths as query data and exact approval actions', () => {
    expect(
      hubRequestSchema.safeParse({
        path: '/api/sessions/a/file?path=%2Fhome%2Fu%2Fproject%2Fmain.ts',
        method: 'GET',
      }).success,
    ).toBe(true)
    expect(
      hubRequestSchema.safeParse({
        path: '/api/sessions/a/permissions/request-1/approve',
        method: 'POST',
        body: { decision: 'approved' },
      }).success,
    ).toBe(true)
    expect(hubRequestSchema.safeParse({ path: '/api/sessions/a', method: 'DELETE' }).success).toBe(true)
    expect(hubRequestSchema.safeParse({ path: '/api/machines/a', method: 'DELETE' }).success).toBe(false)
  })
})

describe('SSE wire framing', () => {
  it('preserves multiline data and sticky-id semantics across arbitrary chunks', () => {
    const decoder = new SseDecoder()
    expect(decoder.push(': heartbeat\r\nid: cursor-1\r\ndata: {"type":\r')).toEqual([])
    expect(decoder.push('\ndata: "heartbeat"}\r\n\r')).toEqual([])
    expect(decoder.push('\ndata: {"type":"heartbeat"}\n\n')).toEqual([
      { id: 'cursor-1', data: '{"type":\n"heartbeat"}' },
      { data: '{"type":"heartbeat"}' },
    ])
    expect(decoder.push('id: \ndata: reset\n\n')).toEqual([{ id: '', data: 'reset' }])
    expect(decoder.push('id: invalid\0id\ndata: safe\n\n')).toEqual([{ data: 'safe' }])
  })
  it('bounds oversized frames', () =>
    expect(() => new SseDecoder().push('data: ' + 'x'.repeat(8 * 1024 * 1024))).toThrow(
      'SSE_FRAME_TOO_LARGE',
    ))
})

describe('session workspace and drafts', () => {
  it('enforces one tab per session while moving and merging panes', () => {
    let state = reduceWorkspace(emptyWorkspace, { type: 'open', id: 'a' })
    state = reduceWorkspace(state, { type: 'open', id: 'b', pane: 1 })
    state = reduceWorkspace(state, { type: 'open', id: 'a', pane: 1 })
    expect(state.panes.map((p) => p.tabs)).toEqual([['a'], ['b']])
    state = reduceWorkspace(state, { type: 'move', id: 'a', pane: 1 })
    expect(state.panes.map((p) => p.tabs)).toEqual([[], ['b', 'a']])
    state = reduceWorkspace(state, { type: 'split' })
    expect(state.panes).toEqual([
      { tabs: ['b', 'a'], active: 'a' },
      { tabs: [], active: null },
    ])
    expect(state.focused).toBe(0)
  })
  it('migrates a resumed session without duplicates, including a destination already open', () => {
    let state = reduceWorkspace(emptyWorkspace, { type: 'open', id: 'old' })
    state = reduceWorkspace(state, { type: 'open', id: 'new', pane: 1 })
    state = reduceWorkspace(state, { type: 'replace', from: 'old', to: 'new' })
    expect(state.panes).toEqual([
      { tabs: ['new'], active: 'new' },
      { tabs: [], active: null },
    ])
    expect(reduceWorkspace(state, { type: 'replace', from: 'missing', to: 'new' })).toEqual(state)
    expect(reduceWorkspace(state, { type: 'replace', from: 'new', to: 'new' })).toEqual(state)
    saveDraft('hub', 'old', { text: 'hello', scrollTop: 42, expanded: ['tool-1'] })
    saveDraft('hub', 'other', { text: 'separate', scrollTop: 100, expanded: [] })
    storeAttempt('hub', 'old', { localId: 'local-1', text: 'hello', createdAt: 1, status: 'absent' })
    migrateSessionLocalState('hub', 'old', 'new')
    expect(loadDraft('hub', 'new')).toEqual({ text: 'hello', scrollTop: 42, expanded: ['tool-1'] })
    expect(loadDraft('hub', 'other').text).toBe('separate')
    expect(loadDraft('another-hub', 'new').text).toBe('')
    expect(loadAttempt('hub', 'new')?.status).toBe('unconfirmed')
  })
  it('repairs invalid restored tab selections', () => {
    localStorage.setItem(
      'desktop:workspace:hub',
      JSON.stringify({
        ...emptyWorkspace,
        focused: 1,
        panes: [
          { tabs: ['a', 'a'], active: 'deleted' },
          { tabs: ['a', 'b'], active: 'a' },
        ],
      }),
    )
    expect(loadWorkspace('hub').panes).toEqual([
      { tabs: ['a', 'b'], active: 'a' },
      { tabs: [], active: null },
    ])
  })
  it('upgrades old workspaces and saves independent history collapse choices per account', () => {
    const { collapsedHistoryGroups: _, ...oldWorkspace } = emptyWorkspace
    localStorage.setItem('desktop:workspace:hub:alice', JSON.stringify(oldWorkspace))
    let state = loadWorkspace('hub:alice')
    expect(state.collapsedHistoryGroups).toEqual([])
    state = reduceWorkspace(state, { type: 'toggle-history-group', key: 'machine-a:/project' })
    state = reduceWorkspace(state, { type: 'toggle-history-group', key: 'machine-b:/project' })
    state = reduceWorkspace(state, { type: 'toggle-history-group', key: 'machine-a:/project' })
    localStorage.setItem('desktop:workspace:hub:alice', JSON.stringify(state))
    expect(loadWorkspace('hub:alice').collapsedHistoryGroups).toEqual(['machine-b:/project'])
    expect(loadWorkspace('hub:bob').collapsedHistoryGroups).toEqual([])
    expect(isHistoryGroupCollapsed(loadWorkspace('hub:bob'), 'machine-a:/project', true)).toBe(true)
    expect(isHistoryGroupCollapsed(state, 'machine-a:/project', true)).toBe(false)
    expect(isHistoryGroupCollapsed(state, 'machine-b:/project', false)).toBe(true)
    const expanded = reduceWorkspace(emptyWorkspace, {
      type: 'toggle-history-group',
      key: 'new:/project',
      defaultCollapsed: true,
    })
    localStorage.setItem('desktop:workspace:new', JSON.stringify(expanded))
    expect(isHistoryGroupCollapsed(loadWorkspace('new'), 'new:/project', true)).toBe(false)
  })
})

it('normalizes interface language tags for session dates', () => {
  for (const locale of ['zh', 'zhCN', 'zhTW', 'zh-TW', 'en', 'fr', 'ja', 'ru', 'vi', 'invalid_locale']) {
    expect(() => new Intl.DateTimeFormat(toIntlLocale(locale)).format(new Date(0))).not.toThrow()
  }
  expect(toIntlLocale('zhCN')).toBe('zh-CN')
  expect(toIntlLocale('zhTW')).toBe('zh-TW')
})

describe('uncertain sends', () => {
  it.each([
    [{ queuedLocalIds: ['local-1'], invokedLocalMessages: [] }, 'accepted'],
    [{ queuedLocalIds: [], invokedLocalMessages: [{ localId: 'local-1', invokedAt: 8 }] }, 'accepted'],
    [{ queuedLocalIds: [], indeterminateLocalIds: ['local-1'], invokedLocalMessages: [] }, 'indeterminate'],
    [{ queuedLocalIds: [], invokedLocalMessages: [] }, 'absent'],
  ])('checks persisted delivery without sending again', async (response, expected) => {
    const sendMessage = vi.fn()
    const getQueuedState = vi.fn().mockResolvedValue(response)
    const client = { getQueuedState, sendMessage } as unknown as ApiClient
    const attempt = { localId: 'local-1', text: 'do something', createdAt: 1, status: 'unconfirmed' as const }
    expect(await checkDelivery(client, 's', attempt)).toBe(expected)
    expect(getQueuedState).toHaveBeenCalledWith('s', ['local-1'])
    expect(sendMessage).not.toHaveBeenCalled()
  })
  it('keeps transport errors uncertain and explicit rejections retryable', () => {
    expect(uncertainDelivery(new ApiError('DELIVERY_UNKNOWN', 0, 'DELIVERY_UNKNOWN'))).toBe(true)
    expect(uncertainDelivery(new Error('bridge closed'))).toBe(true)
    expect(uncertainDelivery(new ApiError('HTTP_400', 400, 'HTTP_400'))).toBe(false)
  })
})
