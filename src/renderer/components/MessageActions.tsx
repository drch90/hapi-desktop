import { lazy, Suspense, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, Share2 } from 'lucide-react'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { unwrap } from '../lib/api'

const ShareTurnDialog = lazy(() =>
  import('@/components/AssistantChat/ShareTurnDialog').then((module) => ({
    default: module.ShareTurnDialog,
  })),
)

async function renderShareImage(element: HTMLElement, width: number): Promise<Blob> {
  const { toBlob } = await import('html-to-image')
  const clone = element.cloneNode(true) as HTMLElement
  clone.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;max-width:none;overflow:visible;pointer-events:none;padding:28px;background:var(--app-bg);color:var(--app-fg)`
  for (const control of clone.querySelectorAll(
    '[data-hapi-share-export-exclude="true"], [data-hapi-share-action="true"], button',
  ))
    control.remove()
  for (const body of clone.querySelectorAll<HTMLElement>('[data-hapi-code-body="true"]')) {
    body.style.maxHeight = 'none'
    body.style.overflow = 'visible'
  }
  for (const table of clone.querySelectorAll<HTMLElement>('.aui-md-table-wrapper')) {
    table.style.overflow = 'visible'
  }
  document.body.appendChild(clone)
  try {
    await document.fonts.ready
    // Include every table column even when the live message scrolls horizontally.
    width = Math.max(width, Math.ceil(clone.scrollWidth))
    clone.style.width = `${width}px`
    const height = Math.ceil(clone.scrollHeight)
    const pixelRatio = Math.min(2, Math.sqrt(24_000_000 / Math.max(1, width * height)))
    const blob = await toBlob(clone, {
      width,
      height,
      pixelRatio,
      skipFonts: true,
      backgroundColor: getComputedStyle(clone).backgroundColor,
      style: { position: 'static', left: '0', top: '0' },
    })
    if (!blob) throw new Error('IMAGE_EXPORT_FAILED')
    return blob
  } finally {
    clone.remove()
  }
}

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
          onClick={() => setSnapshot([{ html: source.current?.outerHTML ?? '', text, role }])}
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
