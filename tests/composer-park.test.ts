import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import { parkComposerDraft, type ComposerParkReceipt } from '../src/renderer/lib/composerPark'
import { forgetQueueEdit, resetQueueEdits } from '../src/renderer/lib/queueEdit'

const scope = 'hub:alice'
const sessionId = 'session'
const storageKey = `desktop:composer-park:${scope}:${sessionId}`
const snapshot = () => Promise.resolve({ text: 'Unsent draft', draftRevision: 'revision-1', attachments: [] })

beforeEach(() => {
  localStorage.clear()
  resetQueueEdits()
})

describe('composer parking', () => {
  it('retries a lost response with the original entry ID and snapshot', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('Connection lost'))
    create.mockImplementationOnce(async (_id, entry) => ({ entry }))
    const source = vi.fn(snapshot)
    const onSaved = vi.fn(async (_receipt: ComposerParkReceipt) => true)
    const options = {
      scope,
      sessionId,
      api: { createScratchlistEntry: create } as unknown as ApiClient,
      snapshot: source,
      onSaved,
    }
    await expect(parkComposerDraft(options)).rejects.toThrow('Connection lost')
    expect(onSaved).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).not.toBeNull()
    await expect(
      parkComposerDraft({
        ...options,
        snapshot: vi.fn().mockRejectedValue(new Error('New draft must not be read')),
      }),
    ).resolves.toBe(true)
    expect(source).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][1]).toEqual(create.mock.calls[1][1])
    expect(onSaved.mock.calls[0][0]).toMatchObject({
      text: 'Unsent draft',
      draftRevision: 'revision-1',
      accepted: true,
    })
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('finishes local cleanup after remount without recreating an accepted entry', async () => {
    const create = vi.fn(async (_id, entry) => ({ entry }))
    const options = {
      scope,
      sessionId,
      api: { createScratchlistEntry: create } as unknown as ApiClient,
      snapshot,
    }
    expect(await parkComposerDraft({ ...options, onSaved: async () => false })).toBe(false)
    expect(JSON.parse(localStorage.getItem(storageKey)!).accepted).toBe(true)
    expect(await parkComposerDraft({ ...options, onSaved: async () => true })).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('coalesces repeated clicks while allowing independent accounts to save', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const create = vi.fn(async (_id, entry) => {
      await gate
      return { entry }
    })
    const source = vi.fn(snapshot)
    const options = {
      scope,
      sessionId,
      api: { createScratchlistEntry: create } as unknown as ApiClient,
      snapshot: source,
      onSaved: async () => true,
    }
    const first = parkComposerDraft(options)
    expect(await parkComposerDraft(options)).toBe(false)
    const other = parkComposerDraft({ ...options, scope: 'hub:bob' })
    release()
    expect(await first).toBe(true)
    expect(await other).toBe(true)
    expect(source).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledTimes(2)
    expect(create.mock.calls[0][1].entryId).not.toBe(create.mock.calls[1][1].entryId)
  })

  it.each(['logout', 'deleted'] as const)(
    'does not clear a draft or restore local receipts after %s',
    async (change) => {
      const onSaved = vi.fn(async () => true)
      const create = vi.fn(async (_id, entry) => {
        if (change === 'logout') resetQueueEdits()
        else forgetQueueEdit(scope, sessionId)
        localStorage.removeItem(storageKey)
        return { entry }
      })
      await expect(
        parkComposerDraft({
          scope,
          sessionId,
          api: { createScratchlistEntry: create } as unknown as ApiClient,
          snapshot,
          onSaved,
        }),
      ).rejects.toThrow('CONNECTION_CHANGED')
      expect(onSaved).not.toHaveBeenCalled()
      expect(localStorage.getItem(storageKey)).toBeNull()
    },
  )

  it('rejects oversized drafts before creating an entry instead of truncating them', async () => {
    const create = vi.fn()
    const onSaved = vi.fn(async () => true)
    await expect(
      parkComposerDraft({
        scope,
        sessionId,
        api: { createScratchlistEntry: create } as unknown as ApiClient,
        snapshot: async () => ({ text: '字'.repeat(10001), draftRevision: 'long', attachments: [] }),
        onSaved,
      }),
    ).rejects.toThrow('SCRATCH_TEXT_TOO_LONG')
    expect(create).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })
})
