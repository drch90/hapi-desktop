import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RemoteFile } from '../../shared/bridge'
import { fileErrorKey, unwrap } from '../lib/api'

export function SaveFileButton(props: { source: RemoteFile; fileName: string; compact?: boolean }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className={`file-download ${props.compact ? 'compact' : ''}`} data-hapi-share-export-exclude="true">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        aria-label={props.compact ? `${t('Download file')}: ${props.fileName}` : undefined}
        title={props.compact ? `${t('Download file')}: ${props.fileName}` : undefined}
        onClick={async () => {
          setBusy(true)
          setSaved(false)
          setError('')
          try {
            const result = await unwrap(
              window.desktop.saveFile({ source: props.source, fileName: props.fileName }),
            )
            setSaved(result.saved)
          } catch (error) {
            setError(fileErrorKey(error))
          } finally {
            setBusy(false)
          }
        }}
      >
        <Download size={14} aria-hidden="true" />
        {!props.compact && t(busy ? 'Saving…' : 'Download file')}
      </Button>
      {saved && (
        <span className="muted" role="status">
          {t('File saved')}
        </span>
      )}
      {error && (
        <span className="error" role="alert">
          {t(error)}
        </span>
      )}
    </div>
  )
}
