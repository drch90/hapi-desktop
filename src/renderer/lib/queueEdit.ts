import { z } from 'zod'
import { useEffect, useState } from 'react'
import { AttachmentMetadataSchema } from '@hapi/protocol/schemas'
import type { DecryptedMessage } from '@/types/api'
import { normalizeDecryptedMessage } from '@/chat/normalize'
const schema = z.object({
  messageId: z.string(),
  localId: z.string(),
  text: z.string(),
  draftText: z.string(),
  scheduledAt: z.number().nullable(),
  attachments: z.array(AttachmentMetadataSchema),
  state: z.enum(['checking', 'ready']),
})
export type QueueEdit = z.infer<typeof schema>
const eventName = 'desktop:queue-edit'
let epoch = 0
const removed = new Set<string>()
export function editSessionExists(scope: string, id: string) {
  return !removed.has(`${scope}:${id}`)
}
export function forgetQueueEdit(scope: string, id: string) {
  removed.add(`${scope}:${id}`)
  localStorage.removeItem(key(scope, id))
  window.dispatchEvent(new Event(eventName))
}
export const queueEditEpoch = () => epoch
export function resetQueueEdits() {
  epoch++
  removed.clear()
}
function key(scope: string, id: string) {
  return `desktop:queue-edit:${scope}:${id}`
}
export function loadQueueEdit(scope: string, id: string): QueueEdit | null {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key(scope, id)) ?? 'null'))
  } catch {
    return null
  }
}
export function saveQueueEdit(scope: string, id: string, value: QueueEdit | null, generation = epoch) {
  if (generation !== epoch || !editSessionExists(scope, id)) return
  if (value) localStorage.setItem(key(scope, id), JSON.stringify(value))
  else localStorage.removeItem(key(scope, id))
  window.dispatchEvent(new Event(eventName))
}
export function beginQueueEdit(
  scope: string,
  id: string,
  message: DecryptedMessage,
  draftText: string,
): QueueEdit {
  const normalized = normalizeDecryptedMessage(message)
  const content = normalized?.role === 'user' ? normalized.content : null
  const value: QueueEdit = {
    messageId: message.id,
    localId: message.localId ?? message.id,
    text: content?.text ?? '',
    draftText,
    attachments: (content?.attachments ?? []).map(({ previewUrl: _preview, ...item }) => item),
    scheduledAt: message.scheduledAt ?? null,
    state: 'checking',
  }
  saveQueueEdit(scope, id, value)
  return value
}
export function useQueueEdit(scope: string, id: string) {
  const [value, setValue] = useState(() => loadQueueEdit(scope, id))
  useEffect(() => {
    const update = () => setValue(loadQueueEdit(scope, id))
    update()
    window.addEventListener(eventName, update)
    return () => window.removeEventListener(eventName, update)
  }, [scope, id])
  return value
}
