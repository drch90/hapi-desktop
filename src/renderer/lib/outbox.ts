import { z } from 'zod'
import { useEffect, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { ApiError } from '@/api/client'
import { AttachmentMetadataSchema } from '@hapi/protocol/schemas'
import { mergeRecoveryQueues, readRecoveryQueue, updateRecoveryQueue, writeRecoveryQueue } from './recovery'

export const attemptSchema = z.object({
  localId: z.string(),
  text: z.string(),
  createdAt: z.number(),
  status: z.enum(['unconfirmed', 'absent', 'indeterminate']),
  attachments: z.array(AttachmentMetadataSchema).optional(),
  scheduledAt: z.number().optional(),
  deliveryMode: z.enum(['queue', 'steer']).optional(),
  draftRevision: z.string().optional(),
})
export type SendAttempt = z.infer<typeof attemptSchema>
const eventName = 'desktop:outbox'
const key = (scope: string, id: string) => `desktop:outbox:${scope}:${id}`

export function loadAttempt(scope: string, id: string): SendAttempt | null {
  const value = readRecoveryQueue(key(scope, id), attemptSchema)[0]
  // A prior absence check does not authorize a retry after restarting.
  return value ? { ...value, status: 'unconfirmed' } : null
}

function persist(scope: string, id: string, records: SendAttempt[]) {
  writeRecoveryQueue(
    key(scope, id),
    records.map((attempt) => ({
      ...attempt,
      // Binary drafts and image previews live in IndexedDB, not the send receipt.
      attachments: attempt.attachments?.map(({ previewUrl: _preview, ...metadata }) => metadata),
    })),
  )
  window.dispatchEvent(new CustomEvent(eventName, { detail: { scope, id, attempt: records[0] ?? null } }))
}

export function storeAttempt(scope: string, id: string, attempt: SendAttempt | null, localId?: string) {
  const previous = readRecoveryQueue(key(scope, id), attemptSchema)
  const next = updateRecoveryQueue(previous, attempt, localId)
  if (next[0] && next[0].localId !== previous[0]?.localId) next[0] = { ...next[0], status: 'unconfirmed' }
  persist(scope, id, next)
}

export function migrateAttempts(scope: string, from: string, to: string) {
  const source = readRecoveryQueue(key(scope, from), attemptSchema)
  if (!source.length) return
  const merged = mergeRecoveryQueues(readRecoveryQueue(key(scope, to), attemptSchema), source)
  persist(
    scope,
    to,
    merged.map((attempt) => ({ ...attempt, status: 'unconfirmed' })),
  )
  localStorage.removeItem(key(scope, from))
}

export function useAttempt(scope: string, id: string) {
  const [attempt, setAttempt] = useState(() => loadAttempt(scope, id))
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; id: string; attempt: SendAttempt | null }>).detail
      if (detail.scope === scope && detail.id === id) setAttempt(detail.attempt)
    }
    window.addEventListener(eventName, update)
    return () => window.removeEventListener(eventName, update)
  }, [scope, id])
  return attempt
}

export async function checkDelivery(
  client: ApiClient,
  id: string,
  attempt: SendAttempt,
): Promise<'accepted' | 'absent' | 'indeterminate'> {
  const result = await client.getQueuedState(id, [attempt.localId])
  if (!Array.isArray(result.queuedLocalIds) || !Array.isArray(result.invokedLocalMessages))
    throw new Error('INVALID_RESPONSE')
  if (
    result.queuedLocalIds.includes(attempt.localId) ||
    result.dispatchingLocalIds?.includes(attempt.localId) ||
    result.invokedLocalMessages.some((m) => m.localId === attempt.localId)
  )
    return 'accepted'
  if (result.indeterminateLocalIds?.includes(attempt.localId)) return 'indeterminate'
  return 'absent'
}

export function uncertainDelivery(error: unknown) {
  return (
    !(error instanceof ApiError) ||
    error.code === 'DELIVERY_UNKNOWN' ||
    error.code === 'CONNECTION_CHANGED' ||
    error.status >= 500
  )
}
