import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SessionSummary } from '@hapi/protocol'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { getSessionTitle } from '@/lib/sessionTitle'
import { api, errorKey } from '../lib/api'
import { queries, sessionsKey, sessionKey } from '../lib/sync'

export function SessionListActions(props: {
  session: SessionSummary
  point: { x: number; y: number }
  connected: boolean
  onDismiss: () => void
  onDeleted: (id: string) => void
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(true)
  const [action, setAction] = useState<'rename' | 'archive' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const title = getSessionTitle(props.session)
  useEffect(() => {
    if (!menuOpen && !action) props.onDismiss()
  }, [menuOpen, action, props.onDismiss])
  async function perform(operation: () => Promise<unknown>) {
    if (busy || !props.connected) return
    setBusy(true)
    try {
      await operation()
      await Promise.all([
        queries.invalidateQueries({ queryKey: sessionsKey }),
        queries.invalidateQueries({ queryKey: sessionKey(props.session.id) }),
      ])
    } catch (error) {
      throw new Error(t(errorKey(error)))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SessionActionMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        sessionId={props.session.id}
        sessionTitle={title}
        referenceBaseUrl="/"
        sessionActive={props.session.active}
        anchorPoint={props.point}
        onRename={() => setAction('rename')}
        onArchive={() => setAction('archive')}
        onDelete={() => setAction('delete')}
      />
      <RenameSessionDialog
        isOpen={action === 'rename'}
        onClose={() => setAction(null)}
        currentName={title}
        isPending={busy || !props.connected}
        onRename={(name) => perform(() => api.renameSession(props.session.id, name))}
      />
      <ConfirmDialog
        isOpen={action === 'archive'}
        onClose={() => setAction(null)}
        title={t('Archive this session?')}
        description={`${title}\n${t('This stops the active session and keeps its history.')}`}
        confirmLabel={t('Archive')}
        confirmingLabel={t('Working…')}
        isPending={busy || !props.connected || !props.session.active}
        onConfirm={() => perform(() => api.archiveSession(props.session.id))}
      />
      <ConfirmDialog
        isOpen={action === 'delete'}
        onClose={() => setAction(null)}
        title={t('Delete this session?')}
        description={t(
          'Permanently delete “{{name}}” and its messages, scratchlist and attachments? This cannot be undone.',
          { name: title },
        )}
        confirmLabel={t('Delete session')}
        confirmingLabel={t('Working…')}
        destructive
        isPending={busy || !props.connected || props.session.active}
        onConfirm={() =>
          perform(async () => {
            await api.deleteSession(props.session.id)
            props.onDeleted(props.session.id)
          })
        }
      />
    </>
  )
}
