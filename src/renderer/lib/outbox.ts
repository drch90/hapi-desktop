import { z } from 'zod'
import type { ApiClient } from '@/api/client'
import { ApiError } from '@/api/client'
import { AttachmentMetadataSchema } from '@hapi/protocol/schemas'

export const attemptSchema = z.object({
  localId: z.string(),
  text: z.string(),
  createdAt: z.number(),
  status: z.enum(['unconfirmed', 'absent', 'indeterminate']),
  attachments: z.array(AttachmentMetadataSchema).optional(),
  scheduledAt: z.number().optional(),
  deliveryMode: z.enum(['queue', 'steer']).optional(),
})
export type SendAttempt = z.infer<typeof attemptSchema>

export function loadAttempt(scope: string, id: string): SendAttempt | null {
  try {
    const value = attemptSchema.parse(
      JSON.parse(localStorage.getItem(`desktop:outbox:${scope}:${id}`) ?? 'null'),
    )
    // A prior absence check does not authorize a retry after restarting.
    return { ...value, status: 'unconfirmed' }
  } catch {
    return null
  }
}

export function storeAttempt(scope: string, id: string, attempt: SendAttempt | null) {
  const key = `desktop:outbox:${scope}:${id}`
  if (attempt)
    localStorage.setItem(
      key,
      JSON.stringify({
        ...attempt,
        // Binary drafts and image previews live in IndexedDB. The send receipt only
        // needs the remote attachment identity, keeping localStorage small.
        attachments: attempt.attachments?.map(({ previewUrl: _preview, ...metadata }) => metadata),
      }),
    )
  else localStorage.removeItem(key)
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
