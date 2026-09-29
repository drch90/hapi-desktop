import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GeneratedImageBlock } from '@/chat/types'
import { ImagePreview } from '@/components/ImagePreview'
import { FileIcon } from '@/components/FileIcon'
import { Button } from '@/components/ui/button'
import {
  isInlineAudioMimeType,
  isInlineImageMimeType,
  isInlineVideoMimeType,
} from '@/lib/generatedInlineMedia'
import { fileErrorKey, unwrap } from '../lib/api'
import { SaveFileButton } from './SaveFileButton'

// HAPI uses generated-image blocks for display_image, display_video and display_media.
// This card composes the shared preview; its network and save operations use desktop IPC.
export function GeneratedMediaCard(props: { sessionId: string; block: GeneratedImageBlock }) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [requested, setRequested] = useState(false)
  const [retry, setRetry] = useState(0)
  const [previewFailed, setPreviewFailed] = useState(false)
  const image = isInlineImageMimeType(props.block.mimeType)
  const video = isInlineVideoMimeType(props.block.mimeType)
  const audio = isInlineAudioMimeType(props.block.mimeType)
  const shouldLoad = image || requested
  const source = { kind: 'generated' as const, sessionId: props.sessionId, imageId: props.block.imageId }

  useEffect(() => {
    if (!shouldLoad) return
    let disposed = false
    let objectUrl = ''
    setUrl('')
    setError('')
    setPreviewFailed(false)
    void unwrap(
      window.desktop.readFile({
        kind: 'generated',
        sessionId: props.sessionId,
        imageId: props.block.imageId,
      }),
    )
      .then((file) => {
        if (disposed) return
        objectUrl = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }))
        setUrl(objectUrl)
      })
      .catch((error: unknown) => {
        if (!disposed) setError(fileErrorKey(error))
      })
    return () => {
      disposed = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [props.sessionId, props.block.imageId, shouldLoad, retry])

  let preview = null
  if (previewFailed) {
    preview = (
      <p className="muted" role="status">
        {t(
          image
            ? 'Unable to preview this image. Download it to open locally.'
            : 'Unable to play this media. Download it to open locally.',
        )}
      </p>
    )
  } else if (error) {
    preview = (
      <div className="media-error">
        <p className="error" role="alert">
          {t(error)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
          {t('Retry')}
        </Button>
      </div>
    )
  } else if (url) {
    if (image)
      preview = (
        <ImagePreview
          src={url}
          fileName={props.block.fileName}
          label={props.block.fileName}
          galleryId={`generated-${props.sessionId}`}
          buttonClassName="media-image-preview"
          imageClassName="media-image"
        />
      )
    else if (video)
      preview = <video src={url} controls playsInline preload="metadata" aria-label={props.block.fileName} />
    else if (audio)
      preview = <audio src={url} controls preload="metadata" aria-label={props.block.fileName} />
  } else if (shouldLoad) {
    preview = (
      <p className="muted" role="status">
        {t('Loading…')}
      </p>
    )
  } else if (video || audio) {
    preview = (
      <Button type="button" variant="outline" size="sm" onClick={() => setRequested(true)}>
        {t(video ? 'Load video' : 'Load audio')}
      </Button>
    )
  }

  return (
    <article className="media-card" aria-label={props.block.fileName}>
      <header>
        <span aria-hidden="true">
          <FileIcon fileName={props.block.fileName} size={18} />
        </span>
        <strong title={props.block.fileName}>{props.block.fileName}</strong>
        <time
          dateTime={new Date(props.block.createdAt).toISOString()}
          title={new Date(props.block.createdAt).toLocaleString()}
        >
          {new Date(props.block.createdAt).toLocaleTimeString(undefined, { hour12: false })}
        </time>
      </header>
      <div className="media-content" onErrorCapture={() => setPreviewFailed(true)}>
        {preview}
      </div>
      <SaveFileButton source={source} fileName={props.block.fileName} />
    </article>
  )
}
