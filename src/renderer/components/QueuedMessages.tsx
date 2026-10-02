import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DecryptedMessage } from '@/types/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import {
  computeCanCancel,
  getQueuedMessagePreview,
  sortQueuedMessages,
} from '@/components/AssistantChat/QueuedMessagesBar'
import { useCancelQueuedMessage } from '@/hooks/mutations/useCancelQueuedMessage'
import { useSteerQueuedMessage } from '@/hooks/mutations/useSteerQueuedMessage'
import { useRetryIndeterminateMessage } from '@/hooks/mutations/useRetryIndeterminateMessage'
import { isQueuedForInvocation } from '@/lib/messages'
import { reconcileQueuedStateAfterConnect } from '@/lib/queued-state-reconciliation'
import { createApi, errorKey } from '../lib/api'
import { beginQueueEdit, saveQueueEdit, queueEditEpoch } from '../lib/queueEdit'

// Reuse HAPI's previews, ordering and mutation contracts without binding the
// desktop composer to assistant-ui's draft/schedule runtime.
export function QueuedMessages({
  sessionId,
  messages,
  canSteer,
  disabled,
  scope,
  draftText,
  editPending,
}: {
  sessionId: string
  messages: DecryptedMessage[]
  canSteer: boolean
  disabled: boolean
  scope: string
  draftText: string
  editPending: boolean
}) {
  const { t } = useTranslation()
  const api = useMemo(() => createApi(scope), [scope])
  const [error, setError] = useState('')
  const cancel = useCancelQueuedMessage(api)
  const steer = useSteerQueuedMessage(api)
  const retry = useRetryIndeterminateMessage(api)
  const [retryId, setRetryId] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const locked = useRef(false)
  const queued = useMemo(
    () =>
      sortQueuedMessages(
        messages.filter((message) => isQueuedForInvocation(message) && !message.queueDismissed),
      ),
    [messages],
  )

  async function runQueueOperation(work: () => Promise<unknown>) {
    if (disabled || locked.current) return
    locked.current = true
    setWorking(true)
    setError('')
    try {
      await work()
    } catch (error) {
      setError(errorKey(error))
    } finally {
      // Also recover a missed consumed/cancelled SSE acknowledgement. This
      // only reads state; an uncertain steer is never automatically repeated.
      await reconcileQueuedStateAfterConnect(api, sessionId).catch(() => {})
      locked.current = false
      setWorking(false)
    }
  }

  return (
    <>
      {error && (
        <p role="alert" className="error small">
          {t(error)}
        </p>
      )}
      {queued.length > 0 && (
        <section className="queue-area" aria-label={t('Queued messages')}>
          <div className="queue-heading">{t('Queued messages ({{count}})', { count: queued.length })}</div>
          <ul className="queue-list">
            {queued.map((message) => {
              const preview = getQueuedMessagePreview(message)
              const canOperate =
                !disabled &&
                computeCanCancel({ id: message.id, localId: message.localId, isPending: working })
              const uncertain = message.deliveryState === 'indeterminate'
              return (
                <li className="queue-item" key={message.localId ?? message.id}>
                  <div className="queue-preview">
                    <div className="queue-text">{preview.text || preview.attachmentNames.join(', ')}</div>
                    {preview.text && preview.attachmentNames.length > 0 && (
                      <div className="small muted">{preview.attachmentNames.join(', ')}</div>
                    )}
                    <time className="small muted" dateTime={new Date(message.createdAt).toISOString()}>
                      {new Date(message.createdAt).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      })}
                    </time>
                    {message.scheduledAt != null && (
                      <div className="small muted">
                        {t('Scheduled for {{time}}', {
                          time: new Date(message.scheduledAt).toLocaleString(),
                        })}
                      </div>
                    )}
                    {uncertain && (
                      <div className="small muted">
                        {t('Delivery is unconfirmed. Check before sending again.')}
                      </div>
                    )}
                  </div>
                  <div className="queue-actions">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canOperate || editPending}
                      onClick={() =>
                        void runQueueOperation(async () => {
                          const generation = queueEditEpoch()
                          const recovery = beginQueueEdit(scope, sessionId, message, draftText)
                          const result = await cancel.mutateAsync({
                            sessionId,
                            messageId: message.id,
                            localId: message.localId ?? message.id,
                            snapshot: message,
                          })
                          if (result.status === 'cancelled')
                            saveQueueEdit(scope, sessionId, { ...recovery, state: 'ready' }, generation)
                          else {
                            saveQueueEdit(scope, sessionId, null, generation)
                            setError(
                              result.status === 'invoked'
                                ? 'This message was already received by the agent.'
                                : 'This message is still being delivered. Check its status before editing.',
                            )
                          }
                        })
                      }
                    >
                      {t('Edit queued message')}
                    </Button>
                    {canSteer && !uncertain && message.scheduledAt == null && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canOperate}
                        onClick={() =>
                          void runQueueOperation(() =>
                            steer.mutateAsync({ sessionId, messageId: message.id }),
                          )
                        }
                      >
                        {t('Insert into current turn')}
                      </Button>
                    )}
                    {uncertain && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canOperate}
                        onClick={() => setRetryId(message.id)}
                      >
                        {t('Retry sending')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canOperate}
                      onClick={() =>
                        void runQueueOperation(() =>
                          cancel.mutateAsync({
                            sessionId,
                            messageId: message.id,
                            localId: message.localId ?? message.id,
                            snapshot: message,
                          }),
                        )
                      }
                    >
                      {t('Cancel queued message')}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <ConfirmDialog
        isOpen={Boolean(retryId)}
        onClose={() => setRetryId(null)}
        title={t('Retry sending')}
        description={t('The agent may already have received this message. Retrying can run it twice.')}
        confirmLabel={t('Retry sending')}
        confirmingLabel={t('Working…')}
        isPending={working}
        onConfirm={() => runQueueOperation(() => retry.mutateAsync({ sessionId, messageId: retryId! }))}
      />
    </>
  )
}
