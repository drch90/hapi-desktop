import { useEffect, useState } from 'react'
import { z } from 'zod'
import { ScratchlistAttachmentMetadataSchema } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import { SCRATCHLIST_MAX_TEXT_LENGTH } from '@/lib/scratchlist'
import {
  prepareScratchlistParkAttachments,
  type PendingParkAttachment,
} from '@/lib/scratchlistAttachmentFlow'
import { editSessionExists, queueEditEpoch } from './queueEdit'

const receiptSchema = z.object({
  entryId: z.string(),
  text: z.string(),
  draftRevision: z.string(),
  attachmentIds: z.array(z.string()),
  attachments: z.array(
    ScratchlistAttachmentMetadataSchema.extend({ migratedFromPath: z.string().optional() }),
  ),
  accepted: z.boolean().default(false),
})
export type ComposerParkReceipt = z.infer<typeof receiptSchema>
const operations = new Set<string>()
const eventName = 'desktop:composer-park'
const key = (scope: string, id: string) => `desktop:composer-park:${scope}:${id}`
const operationKey = (scope: string, id: string) => `${queueEditEpoch()}:${scope}:${id}`

function loadReceipt(scope: string, id: string): ComposerParkReceipt | null {
  try {
    return receiptSchema.parse(JSON.parse(localStorage.getItem(key(scope, id)) ?? 'null'))
  } catch {
    return null
  }
}

export function useComposerPark(scope: string, id: string) {
  const read = () => ({ pending: loadReceipt(scope, id), working: operations.has(operationKey(scope, id)) })
  const [state, setState] = useState(read)
  useEffect(() => {
    const update = () => setState(read())
    update()
    window.addEventListener(eventName, update)
    return () => window.removeEventListener(eventName, update)
  }, [scope, id])
  return state
}

/** Keep the original snapshot and entry ID until both the Hub save and local cleanup finish. */
export async function parkComposerDraft(options: {
  scope: string
  sessionId: string
  api: ApiClient
  snapshot: () => Promise<{ text: string; draftRevision: string; attachments: PendingParkAttachment[] }>
  onSaved: (receipt: ComposerParkReceipt) => Promise<boolean>
}): Promise<boolean> {
  const { scope, sessionId, api } = options
  const operation = operationKey(scope, sessionId)
  if (operations.has(operation)) return false
  const generation = queueEditEpoch()
  const current = () => generation === queueEditEpoch() && editSessionExists(scope, sessionId)
  const checkCurrent = () => {
    if (!current()) throw new Error('CONNECTION_CHANGED')
  }
  const notify = () => window.dispatchEvent(new Event(eventName))
  const persist = (receipt: ComposerParkReceipt) => {
    checkCurrent()
    localStorage.setItem(key(scope, sessionId), JSON.stringify(receipt))
    notify()
  }
  checkCurrent()
  operations.add(operation)
  notify()
  try {
    let receipt = loadReceipt(scope, sessionId)
    if (!receipt) {
      const snapshot = await options.snapshot()
      checkCurrent()
      if (!snapshot.text.trim() && !snapshot.attachments.length) return false
      if (snapshot.text.length > SCRATCHLIST_MAX_TEXT_LENGTH) throw new Error('SCRATCH_TEXT_TOO_LONG')
      const attachments = await prepareScratchlistParkAttachments(api, sessionId, snapshot.attachments)
      checkCurrent()
      receipt = {
        entryId: crypto.randomUUID(),
        text: snapshot.text,
        draftRevision: snapshot.draftRevision,
        attachmentIds: snapshot.attachments.map((attachment) => attachment.id),
        attachments: attachments.map(({ previewUrl: _preview, ...attachment }) => attachment),
        accepted: false,
      }
      // Persist before POST so a lost response/reload retries the same entry.
      persist(receipt)
    }
    if (!receipt.accepted) {
      const result = await api.createScratchlistEntry(sessionId, {
        entryId: receipt.entryId,
        text: receipt.text,
        attachments: receipt.attachments.map(({ migratedFromPath: _source, ...attachment }) => attachment),
      })
      checkCurrent()
      if (result.entry?.entryId !== receipt.entryId) throw new Error('INVALID_RESPONSE')
      receipt = { ...receipt, accepted: true }
      persist(receipt)
    }
    const cleared = await options.onSaved(receipt)
    checkCurrent()
    if (cleared) localStorage.removeItem(key(scope, sessionId))
    return cleared
  } finally {
    operations.delete(operation)
    notify()
  }
}
