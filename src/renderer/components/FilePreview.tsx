import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Copy, Maximize2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/CodeBlock'
import { ImagePreview } from '@/components/ImagePreview'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation as useHapiTranslation } from '@/lib/use-translation'
import { formatFileMetadata } from '@/lib/file-metadata'
import { decodeBase64 } from '@/lib/utils'
import { DiffDisplay, isBinaryContent, resolveImageMimeType, resolveLanguage } from '@/routes/sessions/file'
import {
  getInitialMarkdownPreviewMode,
  isMarkdownFile,
  persistMarkdownPreviewMode,
} from '@/lib/file-markdown-preview'
import { api, fileErrorKey } from '../lib/api'
import { MarkdownRenderer, LinkContext } from './Markdown'
import { SaveFileButton } from './SaveFileButton'
import { ContentDialog } from './ContentDialog'
import { isLargeText } from '@/lib/text-rendering'

import { VirtualTextContent } from './CodeBlock'

export function FilePreview(props: {
  sessionId: string
  scope: string
  path: string
  staged?: boolean
  onBack: () => void
  onOpenFile: (path: string) => void
  onAddToComposer: (path: string) => void
  onOpenSession: (id: string) => void
}) {
  const { t } = useTranslation()
  const { t: web, locale } = useHapiTranslation()
  const { copied, copy } = useCopyToClipboard()
  const [mode, setMode] = useState<'diff' | 'file'>(props.staged === undefined ? 'file' : 'diff')
  const [markdownMode, setMarkdownMode] = useState(getInitialMarkdownPreviewMode)
  const [imageFailed, setImageFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const readerViewport = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const scrollKey = `desktop:file-scroll:${props.scope}:${props.sessionId}:${props.path}:${props.staged}`
  const fileName = props.path.split('/').pop() || props.path
  const imageMime = resolveImageMimeType(props.path)
  const file = useQuery({
    queryKey: ['desktop-file', props.sessionId, props.path],
    // File content can be tens of megabytes. Release it when the preview
    // closes rather than accumulating it in the default five-minute cache.
    gcTime: 0,
    queryFn: async () => {
      const result = await api.readSessionFile(props.sessionId, props.path)
      if (!result.success || result.content === undefined) throw new Error('FILE_UNAVAILABLE')
      return result
    },
  })
  const diff = useQuery({
    queryKey: ['desktop-file-diff', props.sessionId, props.path, props.staged],
    gcTime: 0,
    queryFn: async () => {
      const result = await api.getGitDiffFile(props.sessionId, props.path, props.staged)
      if (!result.success) throw new Error('DIFF_UNAVAILABLE')
      return result.stdout ?? ''
    },
    enabled: !imageMime,
  })
  const decoded = useMemo(
    () => decodeBase64(imageMime ? '' : (file.data?.content ?? '')),
    [file.data?.content, imageMime],
  )
  const binary = useMemo(() => !decoded.ok || isBinaryContent(decoded.text), [decoded])
  const canCopy = useMemo(
    () =>
      file.isSuccess &&
      !binary &&
      decoded.text.length <= 1_000_000 &&
      new TextEncoder().encode(decoded.text).length <= 1_000_000,
    [file.isSuccess, binary, decoded.text],
  )
  const showDiff = mode === 'diff' && Boolean(diff.data) && !imageMime
  const largeFile = useMemo(() => isLargeText(decoded.text), [decoded.text])
  const largeDiff = useMemo(() => isLargeText(diff.data ?? ''), [diff.data])
  const virtualized = showDiff ? largeDiff : !imageMime && !binary && largeFile
  const metadata = formatFileMetadata(file.data?.size, file.data?.modified, locale)
  useLayoutEffect(() => {
    if (restored.current || file.isPending || (mode === 'diff' && diff.isPending && !imageMime)) return
    if (viewport.current) viewport.current.scrollTop = Number(sessionStorage.getItem(scrollKey)) || 0
    restored.current = true
  }, [file.isPending, diff.isPending, mode, imageMime, scrollKey])
  useLayoutEffect(() => {
    if (!file.isSuccess || virtualized) return
    const element = expanded ? readerViewport.current : viewport.current
    if (element) element.scrollTop = Number(sessionStorage.getItem(scrollKey)) || 0
  }, [expanded, virtualized, file.isSuccess, scrollKey])
  useEffect(() => {
    setImageFailed(false)
  }, [file.data])
  const previewModes = (
    <div className="file-preview-modes">
      {diff.data && !imageMime && (
        <>
          <Button
            size="sm"
            variant={showDiff ? 'secondary' : 'outline'}
            aria-pressed={showDiff}
            onClick={() => setMode('diff')}
          >
            {web('file.page.tab.diff')}
          </Button>
          <Button
            size="sm"
            variant={!showDiff ? 'secondary' : 'outline'}
            aria-pressed={!showDiff}
            onClick={() => setMode('file')}
          >
            {web('file.page.tab.file')}
          </Button>
        </>
      )}
      {!showDiff && isMarkdownFile(props.path) && (
        <>
          {(['source', 'preview'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={markdownMode === value ? 'secondary' : 'outline'}
              aria-pressed={markdownMode === value}
              onClick={() => {
                setMarkdownMode(value)
                persistMarkdownPreviewMode(value)
              }}
            >
              {web(`file.page.tab.${value}`)}
            </Button>
          ))}
        </>
      )}
    </div>
  )
  const previewBody = (
    <>
      {diff.isError && (
        <p className="muted" role="status">
          {web('file.error.diffUnavailable')}
        </p>
      )}
      <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>
        {showDiff && largeDiff ? (
          <VirtualTextContent
            code={diff.data!}
            language="diff"
            diff
            ariaLabel={t('Read-only file content')}
            searchLabel={t('Find in file')}
            canCopy={diff.data!.length <= 1_000_000}
            scrollKey={`${scrollKey}:diff`}
          />
        ) : showDiff ? (
          <div className="unified-diff">
            <DiffDisplay diffContent={diff.data!} />
          </div>
        ) : file.isPending ? (
          <p className="muted">{t('Loading…')}</p>
        ) : file.isError ? (
          <p className="error" role="alert">
            {t(fileErrorKey(file.error))}
          </p>
        ) : imageMime && file.data?.content ? (
          <div onErrorCapture={() => setImageFailed(true)}>
            {imageFailed ? (
              <p role="alert">{t('Unable to preview this image. Download it to open locally.')}</p>
            ) : (
              <ImagePreview
                src={`data:${imageMime};base64,${file.data.content}`}
                fileName={fileName}
                label={fileName}
              />
            )}
          </div>
        ) : binary ? (
          <p className="muted">{t('Binary file cannot be previewed')}</p>
        ) : decoded.text.length === 0 ? (
          <p className="muted">{web('file.page.empty')}</p>
        ) : isMarkdownFile(props.path) && markdownMode === 'preview' ? (
          <>
            {canCopy && !largeFile && (
              <Button size="sm" variant="outline" onClick={() => void copy(decoded.text)}>
                {web('file.page.copyContent')}
              </Button>
            )}
            <LinkContext.Provider
              value={{
                openSession: props.onOpenSession,
                openFile: (path) =>
                  props.onOpenFile(
                    path.startsWith('/') ? path : props.path.slice(0, props.path.lastIndexOf('/') + 1) + path,
                  ),
              }}
            >
              <MarkdownRenderer
                content={decoded.text}
                largeMode="preview"
                fillHeight={largeFile}
                canCopy={canCopy}
                scrollKey={scrollKey}
              />
            </LinkContext.Provider>
          </>
        ) : largeFile ? (
          <VirtualTextContent
            code={decoded.text}
            language={resolveLanguage(props.path)}
            ariaLabel={t('Read-only file content')}
            searchLabel={t('Find in file')}
            canCopy={canCopy}
            scrollKey={`${scrollKey}:source`}
          />
        ) : (
          <CodeBlock code={decoded.text} language={resolveLanguage(props.path)} showCopyButton={canCopy} />
        )}
      </Suspense>
    </>
  )
  return (
    <section className="file-preview" aria-label={t('File preview')}>
      <div className="file-preview-toolbar">
        <Button size="sm" variant="outline" aria-label={t('Back to files')} onClick={props.onBack}>
          <ArrowLeft size={15} />
        </Button>
        <strong title={props.path}>{fileName}</strong>
        <ContentDialog
          title={props.path}
          onOpenChange={setExpanded}
          trigger={
            <Button size="sm" variant="outline" title={t('Expand view')} aria-label={t('Expand view')}>
              <Maximize2 size={14} />
            </Button>
          }
        >
          <div className="file-reader">
            {previewModes}
            <div
              className={`file-preview-body ${virtualized ? 'file-preview-virtual' : ''}`}
              ref={readerViewport}
              onScroll={(event) => sessionStorage.setItem(scrollKey, String(event.currentTarget.scrollTop))}
            >
              {previewBody}
            </div>
          </div>
        </ContentDialog>
        <Button
          size="sm"
          variant="outline"
          aria-label={t('Refresh')}
          onClick={() => {
            void file.refetch()
            if (!imageMime) void diff.refetch()
          }}
        >
          <RefreshCw size={14} />
        </Button>
      </div>
      <div className="file-preview-path" title={props.path}>
        {props.path}
      </div>
      {metadata && <div className="file-preview-metadata">{metadata}</div>}
      <div className="file-preview-actions">
        <Button size="sm" variant="outline" onClick={() => void copy(props.path)}>
          <Copy size={13} />
          {t(copied ? 'Copied' : 'Copy path')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => props.onAddToComposer(props.path)}>
          {t('Add to message')}
        </Button>
        {file.isSuccess && (
          <SaveFileButton
            source={{ kind: 'file', sessionId: props.sessionId, path: props.path }}
            fileName={fileName}
          />
        )}
      </div>
      {previewModes}
      <div
        className={`file-preview-body ${virtualized ? 'file-preview-virtual' : ''}`}
        ref={viewport}
        onScroll={() => {
          if (!expanded && restored.current && viewport.current)
            sessionStorage.setItem(scrollKey, String(viewport.current.scrollTop))
        }}
      >
        {!expanded && previewBody}
      </div>
    </section>
  )
}
