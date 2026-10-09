import { lazy, Suspense, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Share2 } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { unwrap } from '../lib/api'
import { createShareSnapshot, renderShareImage } from '../lib/share-image'

const ShareTurnDialog = lazy(() =>
  import('@/components/AssistantChat/ShareTurnDialog').then((module) => ({
    default: module.ShareTurnDialog,
  })),
)

async function exportImage(blob: Blob, action: 'copy' | 'save', fileName = 'HAPI-message.png') {
  const png = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  await unwrap(window.desktop.exportImage({ png, action, fileName }))
}

export function MessageActions({
  text,
  source,
  title,
  role,
}: {
  text: string
  source: RefObject<HTMLElement | null>
  title: string
  role: 'user' | 'assistant'
}) {
  const { t } = useTranslation()
  const { copied, copy } = useCopyToClipboard()
  const [failed, setFailed] = useState(false)
  const [snapshot, setSnapshot] = useState<
    { html: string; text: string; role: 'user' | 'assistant' }[] | null
  >(null)
  return (
    <>
      <div className="message-actions" data-hapi-share-action="true" data-hapi-share-export-exclude="true">
        <button
          className="icon-button"
          title={t(copied ? 'Copied' : 'Copy')}
          aria-label={t(copied ? 'Copied' : 'Copy')}
          onClick={async () => setFailed(!(await copy(text)))}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button
          className="icon-button"
          title={t('Share')}
          aria-label={t('Share')}
          onClick={() => setSnapshot([{ html: createShareSnapshot(source.current), text, role }])}
        >
          <Share2 size={13} />
        </button>
        {failed && (
          <span className="error" role="alert">
            {t('Copy failed')}
          </span>
        )}
      </div>
      {snapshot && (
        <Suspense fallback={<span className="muted">{t('Loading…')}</span>}>
          <ShareTurnDialog
            isOpen
            title={title}
            metadataItems={[]}
            sourceSnapshots={snapshot}
            sourceContentWidth={640}
            nativeShare={false}
            renderImage={renderShareImage}
            copyImage={(blob) => exportImage(blob, 'copy')}
            saveImage={(blob, fileName) => exportImage(blob, 'save', fileName)}
            onClose={() => setSnapshot(null)}
          />
        </Suspense>
      )}
    </>
  )
}
