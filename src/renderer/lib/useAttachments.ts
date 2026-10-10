import { useEffect, useMemo, useState } from 'react'
import type { PendingAttachment } from '@assistant-ui/react'
import { AttachmentMetadataSchema, type AttachmentMetadata } from '@hapi/protocol/schemas'
import { createAttachmentAdapter, MAX_UPLOAD_BYTES } from '@/lib/attachmentAdapter'
import {
  clearDraftAttachments,
  getDraftAttachments,
  getRestoredUploadMetadata,
  moveDraftAttachments,
  saveDraftAttachments,
} from '@/lib/composer-attachment-drafts'
import { createApi } from './api'
import { moveAttachmentId } from '@/lib/attachmentOrder'

type UploadedAttachment = PendingAttachment & { path?: string; previewUrl?: string; uploadSessionId?: string }
export type UploadItem = {
  id: string
  file: File
  status: 'waiting' | 'uploading' | 'ready' | 'error'
  value?: UploadedAttachment
  error?: string
  removed?: boolean
  job?: Promise<void>
  sending?: boolean
  restoring?: boolean
  adapter?: ReturnType<typeof createAttachmentAdapter>
}
type UploadLifetime = { alive: boolean; epoch: number; items: UploadItem[]; reload?: () => Promise<void> }
let runtimeEpoch = 0
const lifetimes = new Map<string, UploadLifetime>()
const knownDrafts = new Set<string>()

export function forgetAttachmentDraft(scope: string, id: string) {
  const key = `${scope}:${id}`
  const lifetime = lifetimes.get(key)
  if (lifetime) lifetime.alive = false
  clearDraftAttachments(key)
}

export function resetAttachmentRuntime(eraseDrafts: boolean) {
  runtimeEpoch++
  for (const lifetime of lifetimes.values()) lifetime.alive = false
  lifetimes.clear()
  if (eraseDrafts) {
    for (const key of knownDrafts) clearDraftAttachments(key)
    knownDrafts.clear()
  }
}

export function useAttachments(scope: string, sessionId: string, active: boolean) {
  const key = `${scope}:${sessionId}`
  const state = useMemo<UploadLifetime>(() => ({ alive: true, epoch: runtimeEpoch, items: [] }), [key])
  const [items, setItems] = useState<UploadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const client = useMemo(() => createApi(scope), [scope])

  const draftFiles = () =>
    state.items.map((item) => ({
      id: item.value?.id ?? item.id,
      file: item.file,
      path: item.value?.path,
      previewUrl: item.value?.previewUrl,
      uploadSessionId: item.value?.uploadSessionId,
    }))
  function publish() {
    if (state.epoch !== runtimeEpoch || !state.alive) return
    setItems([...state.items])
    saveDraftAttachments(key, draftFiles())
  }

  async function upload(item: UploadItem, target = sessionId, sending = false): Promise<void> {
    if (state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
    if (sending) item.sending = true
    if (item.job) await item.job
    if (
      (!state.alive && !sending) ||
      item.removed ||
      (item.status === 'ready' && item.value?.uploadSessionId === target)
    )
      return
    if (item.file.size === 0 || item.file.size > MAX_UPLOAD_BYTES) {
      item.status = 'error'
      item.error =
        item.file.size === 0 ? 'Empty files cannot be uploaded.' : 'Files must be 50 MB or smaller.'
      publish()
      return
    }
    const adapter = createAttachmentAdapter(client, target)
    item.adapter = adapter
    item.status = 'uploading'
    item.error = undefined
    // Strip restored paths when a runner resumed into a new session or after a retry.
    const file = new File([item.file], item.file.name, {
      type: item.file.type,
      lastModified: item.file.lastModified,
    })
    publish()
    item.job = (async () => {
      try {
        const updates = adapter.add({ file }) as AsyncIterable<PendingAttachment>
        for await (const value of updates) {
          if ((!state.alive && !item.sending) || state.epoch !== runtimeEpoch) {
            await adapter.remove(value)
            break
          }
          item.value = value as UploadedAttachment
          if (item.removed) {
            await adapter.remove(value)
            break
          }
          item.status =
            value.status.type === 'requires-action'
              ? 'ready'
              : value.status.type === 'incomplete'
                ? 'error'
                : 'uploading'
          if (item.status === 'error') item.error = 'Upload failed. Retry or remove the attachment.'
          publish()
        }
      } catch {
        item.status = 'error'
        item.error = 'Upload failed. Retry or remove the attachment.'
        publish()
      } finally {
        item.job = undefined
      }
    })()
    await item.job
  }

  useEffect(() => {
    state.alive = true
    setLoading(true)
    lifetimes.set(key, state)
    knownDrafts.add(key)
    let mounted = true
    const restoreDraft = async () => {
      setLoading(true)
      await getDraftAttachments(key, { throwOnError: true })
        .then((files) => {
          if (!mounted || !state.alive) return
          state.items = files.map((file) => {
            const restored = getRestoredUploadMetadata(file)
            const id = restored?.id ?? crypto.randomUUID()
            const reusable = restored?.path && restored.uploadSessionId === sessionId
            return {
              id,
              file,
              status: reusable ? 'ready' : 'waiting',
              ...(reusable
                ? {
                    value: {
                      file,
                      type: 'file' as const,
                      name: file.name,
                      contentType: file.type || 'application/octet-stream',
                      status: { type: 'requires-action' as const, reason: 'composer-send' as const },
                      ...restored,
                    },
                  }
                : {}),
            }
          })
          setItems([...state.items])
          setError('')
          setLoading(false)
        })
        .catch(() => {
          if (mounted) {
            setError('Could not restore attachments. Reopen this session to retry.')
            setLoading(false)
          }
        })
    }
    state.reload = restoreDraft
    void restoreDraft()
    const unsubscribe = window.desktop.onEvent((event) => {
      if (
        event.type === 'connection' &&
        ['disconnected', 'connecting', 'authentication-required'].includes(event.state.status)
      )
        state.alive = false
      if (
        event.type === 'sync' &&
        event.event.type === 'session-removed' &&
        event.event.sessionId === sessionId
      )
        state.alive = false
    })
    return () => {
      mounted = false
      state.alive = false
      unsubscribe()
      for (const item of state.items) {
        if (item.status === 'uploading' && !item.sending && item.value) void item.adapter?.remove(item.value)
      }
      if (lifetimes.get(key) === state) lifetimes.delete(key)
    }
  }, [key, state, sessionId])

  useEffect(() => {
    if (loading || !active || !state.alive) return
    void (async () => {
      for (const item of state.items) {
        if (!state.alive || state.epoch !== runtimeEpoch) return
        if (item.status === 'waiting' && !item.restoring) await upload(item)
      }
    })()
  }, [loading, active, items])

  async function add(files: File[]) {
    if (loading || error || !state.alive) return
    state.items.push(...files.map((file) => ({ id: crypto.randomUUID(), file, status: 'waiting' as const })))
    publish()
  }

  async function restore(files: { id: string; file: File }[]) {
    if (!files.length) return
    if (loading || error || !state.alive || state.epoch !== runtimeEpoch)
      throw new Error('ATTACHMENTS_NOT_READY')
    const added: UploadItem[] = files
      .filter(({ id }) => !state.items.some((item) => item.id === id || item.value?.id === id))
      .map(({ id, file }) => ({ id, file, status: 'waiting', restoring: true }))
    state.items.push(...added)
    publish()
    try {
      // The same-target move drains queued IndexedDB writes and propagates
      // failures. Keep the queue recovery receipt until these bytes are durable.
      await moveDraftAttachments(key, key, () => {
        if (!state.alive || state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
        return draftFiles()
      })
      if (!state.alive || state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
      for (const item of added) item.restoring = false
      publish()
    } catch (error) {
      state.items = state.items.filter((item) => !added.includes(item))
      publish()
      throw error
    }
  }

  async function prepare(target: string): Promise<AttachmentMetadata[]> {
    if (state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
    if (loading || error) throw new Error('ATTACHMENTS_NOT_READY')
    const selected = [...state.items]
    const metadata: AttachmentMetadata[] = []
    for (const item of selected) {
      await upload(item, target, true)
      if (item.status !== 'ready' || !item.value?.path || item.removed) throw new Error('UPLOAD_FAILED')
      const complete = await createAttachmentAdapter(client, target).send(item.value)
      const text = complete.content.find((part) => part.type === 'text')
      if (!text || text.type !== 'text') throw new Error('UPLOAD_FAILED')
      metadata.push(AttachmentMetadataSchema.parse(JSON.parse(text.text).__attachmentMetadata))
    }
    return metadata
  }

  async function transfer(target: string) {
    if (state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
    if (target === sessionId) return
    const targetKey = `${scope}:${target}`
    knownDrafts.add(targetKey)
    // Settle source uploads before tombstoning its draft so late progress
    // cannot recreate the old-session cache after the atomic handoff.
    await Promise.all(state.items.map((item) => item.job))
    const existing = await getDraftAttachments(targetKey, { throwOnError: true })
    const carried = state.items
      .filter((item) => !item.removed)
      .map((item) => ({
        id: item.value?.id ?? item.id,
        file: item.file,
        ...(item.value?.uploadSessionId === target
          ? { path: item.value.path, previewUrl: item.value.previewUrl, uploadSessionId: target }
          : {}),
      }))
    const ids = new Set(carried.map((item) => item.id))
    const other = existing.flatMap((file) => {
      const restored = getRestoredUploadMetadata(file)
      return restored && !ids.has(restored.id) ? [{ ...restored, file }] : []
    })
    await moveDraftAttachments(key, targetKey, () => {
      if (state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
      return [...other, ...carried]
    })
    state.alive = false
    await lifetimes.get(targetKey)?.reload?.()
  }

  async function clearSent(ids: string[]) {
    if (!ids.length) return
    if (state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
    state.items = state.items.filter((item) => !ids.includes(item.value?.id ?? item.id))
    try {
      // Drain earlier progress writes and persist the removal before the tray
      // clears. A fast reload must not restore a partially saved upload batch.
      // This also applies when a tab closed while waiting for the send receipt.
      await moveDraftAttachments(key, key, () => {
        if (state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
        return draftFiles()
      })
      if (state.epoch !== runtimeEpoch) throw new Error('CONNECTION_CHANGED')
    } finally {
      if (state.alive && state.epoch === runtimeEpoch) setItems([...state.items])
    }
  }

  return {
    items,
    loading,
    error,
    add,
    restore,
    prepare,
    transfer,
    clearSent,
    isCurrent: () => state.epoch === runtimeEpoch,
    move: (id: string, target: string) => {
      const order = moveAttachmentId(
        state.items.map((item) => item.id),
        id,
        target,
        'before',
      )
      state.items = order.map((key) => state.items.find((item) => item.id === key)!)
      publish()
    },
    release: () => {
      for (const item of state.items) item.sending = false
    },
    ready: !loading && !error && items.every((item) => item.status === 'ready'),
    retry: (id: string) => {
      const item = state.items.find((entry) => entry.id === id)
      if (item) return upload(item)
    },
    remove: async (id: string) => {
      const item = state.items.find((entry) => entry.id === id)
      if (!item) return
      item.removed = true
      state.items = state.items.filter((entry) => entry !== item)
      publish()
      if (item.value) await (item.adapter ?? createAttachmentAdapter(client, sessionId)).remove(item.value)
    },
  }
}
