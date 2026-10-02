import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ScratchlistAttachmentMetadataSchema } from '@hapi/protocol'
import { ScratchlistDrawer } from '@/components/AssistantChat/ScratchlistPanel'
import {
  SCRATCHLIST_MAX_ENTRIES,
  SCRATCHLIST_MAX_TEXT_LENGTH,
  moveScratchlistEntry,
  type ScratchlistEntry,
} from '@/lib/scratchlist'
import {
  prepareScratchlistParkAttachments,
  stageScratchlistAttachmentsForComposeSend,
} from '@/lib/scratchlistAttachmentFlow'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/api/client'
import { createApi, errorKey } from '../lib/api'
import { queries } from '../lib/sync'
import { attemptSchema, checkDelivery, uncertainDelivery, type SendAttempt } from '../lib/outbox'
import { editSessionExists, queueEditEpoch } from '../lib/queueEdit'

const entrySchema = z.object({
  entryId: z.string(),
  text: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  attachments: z.array(ScratchlistAttachmentMetadataSchema).default([]),
})
const listSchema = z.object({ entries: z.array(entrySchema) })
type HubEntry = z.infer<typeof entrySchema>
type PendingSave = {
  entryId: string
  text: string
  attachments: z.infer<typeof ScratchlistAttachmentMetadataSchema>[]
}
type Receipt = SendAttempt & { accepted?: boolean }
const receiptSchema = attemptSchema.extend({ accepted: z.boolean().optional() })
const operations = new Set<string>()
const operationEvent = 'desktop:scratchlist-operation'

export function Scratchlist(props: {
  scope: string
  sessionId: string
  connected: boolean
  active: boolean
  onCompose: (text: string, files: File[]) => Promise<void>
}) {
  const { t } = useTranslation()
  const { scope, sessionId } = props
  const client = useMemo(() => createApi(scope), [scope])
  const queryKey = useMemo(() => ['desktop-scratchlist', scope, sessionId] as const, [scope, sessionId])
  const draftKey = `desktop:scratch-draft:${scope}:${sessionId}`
  const pendingKey = `desktop:scratch-save:${scope}:${sessionId}`
  const query = useQuery({
    queryKey,
    queryFn: async () => listSchema.parse(await client.getScratchlist(sessionId)),
    enabled: props.connected,
    retry: false,
  })
  const [text, setText] = useState(() => localStorage.getItem(draftKey) ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const mounted = useRef(true)
  const generation = useRef(queueEditEpoch())
  const [error, setError] = useState('')
  const [edit, setEdit] = useState<ScratchlistEntry | null>(null)
  const [editText, setEditText] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const entries = useMemo(
    () => (query.data?.entries ?? []).map(({ entryId, ...entry }) => ({ ...entry, id: entryId })),
    [query.data],
  )
  const pending = () => {
    try {
      return entrySchema
        .omit({ createdAt: true, updatedAt: true })
        .parse(JSON.parse(localStorage.getItem(pendingKey) ?? 'null'))
    } catch {
      return null
    }
  }
  const [hasPending, setHasPending] = useState(() => Boolean(pending()))
  useEffect(() => {
    localStorage.setItem(draftKey, text)
  }, [draftKey, text])
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )
  const operationKey = `${generation.current}:${scope}:${sessionId}`
  useEffect(() => {
    const update = () => {
      setBusy(operations.has(operationKey))
      setHasPending(Boolean(pending()))
      setText(localStorage.getItem(draftKey) ?? '')
    }
    update()
    window.addEventListener(operationEvent, update)
    return () => window.removeEventListener(operationEvent, update)
  }, [operationKey, draftKey, pendingKey])
  const current = () => generation.current === queueEditEpoch() && editSessionExists(scope, sessionId)
  function report(error: unknown) {
    if (!mounted.current || !current()) return
    setError(
      error instanceof ApiError && [404, 405, 501].includes(error.status)
        ? 'This Hub does not support this operation, or the item is unavailable.'
        : error instanceof Error && error.message === 'SCRATCH_RESTORE_FIRST'
          ? 'Restore this session before sending a stored message.'
          : error instanceof Error && error.message === 'SCRATCH_RETRY_SEND'
            ? 'Delivery checked. Send again to retry.'
            : error instanceof Error && error.message === 'SCRATCH_SEND_UNKNOWN'
              ? 'Delivery is unconfirmed. Check before sending again.'
              : errorKey(error),
    )
  }
  async function run(work: () => Promise<void>) {
    if (locked.current || operations.has(operationKey) || !props.connected || !current()) return
    locked.current = true
    operations.add(operationKey)
    window.dispatchEvent(new Event(operationEvent))
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (error) {
      report(error)
    } finally {
      locked.current = false
      operations.delete(operationKey)
      if (current()) window.dispatchEvent(new Event(operationEvent))
      if (mounted.current && current()) setBusy(false)
    }
  }
  async function refresh() {
    await queries.invalidateQueries({ queryKey })
  }
  async function add() {
    await run(async () => {
      let value: PendingSave | null = pending()
      if (!value) {
        if ((!text.trim() && !files.length) || entries.length >= SCRATCHLIST_MAX_ENTRIES) return
        const attachments = await prepareScratchlistParkAttachments(
          client,
          sessionId,
          files.map((file) => ({ id: crypto.randomUUID(), name: file.name, contentType: file.type, file })),
        )
        if (!current()) return
        value = {
          entryId: crypto.randomUUID(),
          text,
          attachments: attachments.map(({ previewUrl: _preview, ...attachment }) => attachment),
        }
        localStorage.setItem(pendingKey, JSON.stringify(value))
        if (mounted.current) setHasPending(true)
      }
      const result = await client.createScratchlistEntry(sessionId, value)
      entrySchema.parse(result.entry)
      if (!current()) return
      localStorage.removeItem(pendingKey)
      // The stable entry ID makes a retry after a lost response idempotent.
      if (localStorage.getItem(draftKey) === value.text) localStorage.removeItem(draftKey)
      if (mounted.current) {
        setHasPending(false)
        setText((previous) => (previous === value!.text ? '' : previous))
        setFiles([])
      }
      await refresh()
    })
  }
  const receiptKey = (id: string) => `desktop:scratch-send:${scope}:${sessionId}:${id}`
  function readReceipt(id: string): Receipt | null {
    try {
      return receiptSchema.parse(JSON.parse(localStorage.getItem(receiptKey(id)) ?? 'null'))
    } catch {
      return null
    }
  }
  function writeReceipt(id: string, receipt: Receipt) {
    if (current())
      localStorage.setItem(
        receiptKey(id),
        JSON.stringify({
          ...receipt,
          attachments: receipt.attachments?.map(({ previewUrl: _preview, ...attachment }) => attachment),
        }),
      )
  }
  async function remove(id: string) {
    await run(async () => {
      await client.deleteScratchlistEntry(sessionId, id)
      if (!current()) return
      localStorage.removeItem(receiptKey(id))
      await refresh()
    })
  }
  async function send(entry: ScratchlistEntry): Promise<boolean> {
    if (locked.current || !props.connected) return false
    let accepted = false
    await run(async () => {
      let receipt = readReceipt(entry.id)
      if (receipt?.accepted) {
        accepted = true
        return
      }
      if (!props.active) throw new Error('SCRATCH_RESTORE_FIRST')
      if (receipt && receipt.status !== 'absent') {
        const status = await checkDelivery(client, sessionId, receipt)
        if (!current()) return
        if (status === 'accepted') {
          writeReceipt(entry.id, { ...receipt, accepted: true })
          accepted = true
          return
        }
        writeReceipt(entry.id, { ...receipt, status })
        throw new Error(status === 'absent' ? 'SCRATCH_RETRY_SEND' : 'SCRATCH_SEND_UNKNOWN')
      }
      if (!receipt) {
        const attachments = await stageScratchlistAttachmentsForComposeSend(
          client,
          sessionId,
          entry.attachments ?? [],
        )
        receipt = {
          localId: crypto.randomUUID(),
          text: entry.text,
          attachments,
          createdAt: Date.now(),
          status: 'unconfirmed',
          deliveryMode: 'queue',
        }
      }
      writeReceipt(entry.id, { ...receipt, status: 'unconfirmed' })
      try {
        await client.sendMessage(
          sessionId,
          receipt.text,
          receipt.localId,
          receipt.attachments,
          undefined,
          'queue',
        )
        if (!current()) return
        writeReceipt(entry.id, { ...receipt, accepted: true })
        accepted = true
      } catch (error) {
        if (!uncertainDelivery(error)) writeReceipt(entry.id, { ...receipt, status: 'absent' })
        else throw new Error('SCRATCH_SEND_UNKNOWN')
        throw error
      }
    })
    return accepted
  }
  async function compose(entry: ScratchlistEntry) {
    await run(async () => {
      const restored: File[] = []
      for (const attachment of entry.attachments ?? []) {
        const blob = await client.fetchScratchlistAttachmentBlob(sessionId, attachment.id)
        restored.push(new File([blob], attachment.filename, { type: attachment.mimeType }))
      }
      if (!mounted.current || !current()) return
      await props.onCompose(editText, restored)
      setEdit(null)
    })
  }
  return (
    <section className="scratchlist-panel" aria-label={t('Scratchlist')}>
      <div className="scratchlist-add">
        <textarea
          aria-label={t('New stored message')}
          placeholder={t('Store an idea for later')}
          rows={2}
          maxLength={SCRATCHLIST_MAX_TEXT_LENGTH}
          value={text}
          disabled={busy || hasPending}
          onChange={(event) => setText(event.target.value)}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            setFiles([...(event.target.files ?? [])])
            event.target.value = ''
          }}
        />
        <div className="scratchlist-controls">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || hasPending || !props.connected}
            onClick={() => fileInput.current?.click()}
          >
            {t('Attach files')}
          </Button>
          <Button
            size="sm"
            disabled={
              busy ||
              !props.connected ||
              query.isError ||
              (!hasPending && ((!text.trim() && !files.length) || entries.length >= SCRATCHLIST_MAX_ENTRIES))
            }
            onClick={() => void add()}
          >
            {t(hasPending ? 'Retry saving' : 'Save to scratchlist')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !props.connected}
            onClick={() => void query.refetch()}
          >
            {t('Refresh')}
          </Button>
        </div>
        {files.length > 0 && (
          <p className="small muted">
            {files.map((file) => file.name).join(', ')}
            <button disabled={busy || hasPending} onClick={() => setFiles([])}>
              {t('Remove attachments')}
            </button>
          </p>
        )}
        <p className="small muted">
          {entries.length}/{SCRATCHLIST_MAX_ENTRIES} · {t('Stored on the Hub. Sent only when you choose.')}
        </p>
      </div>
      {query.isPending && <p className="small muted">{t('Loading…')}</p>}
      {(error || query.isError) && (
        <p role="alert" className="error small">
          {t(error || 'This Hub does not support this operation, or the item is unavailable.')}
        </p>
      )}
      <ScratchlistDrawer
        sessionId={sessionId}
        api={client}
        entries={entries}
        disabled={busy || !props.connected}
        onDelete={(id) => void remove(id)}
        onMove={(id, direction) => {
          const reordered = moveScratchlistEntry(entries, id, direction)
          queries.setQueryData(queryKey, {
            entries: reordered.map(({ id, ...entry }) => ({ ...entry, entryId: id })),
          })
        }}
        onPromoteToComposer={(entry) => {
          setEdit(entry)
          setEditText(entry.text)
        }}
        onPromoteToQueue={send}
      />
      {edit && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setEdit(null)
          }}
        >
          <DialogContent className="desktop-dialog">
            <DialogHeader>
              <DialogTitle>{t('Edit stored message')}</DialogTitle>
            </DialogHeader>
            <textarea
              aria-label={t('Edit stored message')}
              rows={6}
              maxLength={SCRATCHLIST_MAX_TEXT_LENGTH}
              value={editText}
              onChange={(event) => setEditText(event.target.value)}
              disabled={busy}
            />
            {error && (
              <p role="alert" className="error">
                {t(error)}
              </p>
            )}
            <Button
              disabled={busy || !props.connected || !editText.trim()}
              onClick={() =>
                void run(async () => {
                  await client.updateScratchlistEntry(sessionId, edit.id, editText)
                  if (mounted.current) setEdit(null)
                  await refresh()
                })
              }
            >
              {t('Save changes')}
            </Button>
            <Button variant="outline" disabled={busy || !props.connected} onClick={() => void compose(edit)}>
              {t('Add to composer')}
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
