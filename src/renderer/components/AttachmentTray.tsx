import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileIcon } from '@/components/FileIcon'
import { ImagePreview } from '@/components/ImagePreview'
import { Spinner } from '@/components/Spinner'
import { formatFileMetadata } from '@/lib/file-metadata'
import { useTranslation as useHapiTranslation } from '@/lib/use-translation'
import type { UploadItem } from '../lib/useAttachments'

export function AttachmentTray(props: {
  items: UploadItem[]
  disabled: boolean
  remove: (id: string) => Promise<void>
  retry: (id: string) => Promise<void> | undefined
  move: (id: string, target: string) => void
}) {
  const { t } = useTranslation()
  const { locale } = useHapiTranslation()
  return (
    <div className="attachment-tray" aria-label={t('Attachments')}>
      {props.items.map((item, index) => (
        <div
          key={item.id}
          className="attachment-draft"
          data-testid="attachment-draft"
          draggable={!props.disabled}
          onDragStart={(event) => event.dataTransfer.setData('application/x-hapi-attachment', item.id)}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-hapi-attachment')) event.preventDefault()
          }}
          onDrop={(event) => {
            const source = event.dataTransfer.getData('application/x-hapi-attachment')
            if (!source || props.disabled) return
            event.preventDefault()
            event.stopPropagation()
            props.move(source, item.id)
          }}
        >
          {item.value?.previewUrl ? (
            <ImagePreview
              src={item.value.previewUrl}
              fileName={item.file.name}
              label={item.file.name}
              buttonClassName="attachment-thumbnail"
              imageClassName="h-full w-full object-cover"
            />
          ) : (
            <FileIcon fileName={item.file.name} size={24} />
          )}
          <div className="attachment-info">
            <strong title={item.file.name}>{item.file.name}</strong>
            <span className="muted">{formatFileMetadata(item.file.size, undefined, locale)}</span>
            <span role="status">
              {item.status === 'uploading' && <Spinner size="sm" label={null} />}
              {t(
                item.status === 'ready'
                  ? 'Ready to send'
                  : item.status === 'uploading'
                    ? 'Uploading…'
                    : item.status === 'waiting'
                      ? 'Waiting to upload'
                      : 'Upload failed',
              )}
            </span>
            {item.error && (
              <span className="error" role="alert">
                {t(item.error)}
              </span>
            )}
          </div>
          <div className="attachment-actions">
            {item.status === 'error' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.disabled}
                onClick={() => void props.retry(item.id)}
              >
                {t('Retry')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.disabled || index === 0}
              aria-label={t('Move attachment left')}
              onClick={() => props.move(item.id, props.items[index - 1].id)}
            >
              <ArrowLeft size={12} />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.disabled || index === props.items.length - 1}
              aria-label={t('Move attachment right')}
              onClick={() => props.move(props.items[index + 1].id, item.id)}
            >
              <ArrowRight size={12} />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.disabled}
              aria-label={t('Remove attachment')}
              onClick={() => void props.remove(item.id)}
            >
              <X size={13} />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
