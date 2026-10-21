import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownToLine, Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation as useHapiTranslation } from '@/lib/use-translation'
import type { MarkdownOptions } from '../lib/markdown-plugins'
import { useMarkdownPreview } from '../lib/useMarkdownPreview'
import type { MarkdownSection } from '../lib/markdown-sections'
import { MarkdownAnchorContext, MarkdownTree } from './Markdown'
import { VirtualTextContent } from './VirtualTextContent'

type Props = MarkdownOptions & {
  content: string
  mode?: 'source' | 'preview'
  fillHeight?: boolean
  scrollKey?: string
  canCopy: boolean
  initialMode?: 'source' | 'preview'
}

type ReadingPosition = { index: number; offset: number; atEnd: boolean }

function RenderedMarkdown({
  sections,
  scrollKey,
  jumpRef,
}: {
  sections: MarkdownSection[]
  scrollKey: string
  jumpRef: React.RefObject<(() => void) | null>
}) {
  const { t } = useTranslation()
  const viewport = useRef<HTMLDivElement>(null)
  const pendingAnchor = useRef<string | null>(null)
  const pendingPosition = useRef<ReadingPosition | null>(null)
  const restored = useRef(false)
  const atEnd = useRef(false)
  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) => sections[index].estimate,
    overscan: 2,
  })
  const items = virtualizer.getVirtualItems()
  const anchors = useMemo(() => {
    const index = new Map<string, number>()
    sections.forEach((section, at) =>
      section.ids.forEach((id) => {
        if (!index.has(id)) index.set(id, at)
      }),
    )
    return index
  }, [sections])
  const save = () => {
    const element = viewport.current
    if (!element || !restored.current) return
    const item = virtualizer.getVirtualItemForOffset(element.scrollTop)
    if (!item) return
    sessionStorage.setItem(
      scrollKey,
      JSON.stringify({
        index: item.index,
        offset: element.scrollTop - item.start,
        atEnd: atEnd.current,
      } satisfies ReadingPosition),
    )
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useLayoutEffect(() => {
    jumpRef.current = () => {
      atEnd.current = true
      virtualizer.scrollToIndex(sections.length - 1, { align: 'end' })
    }
    if (!sections.length) return
    if (!restored.current) {
      try {
        const position = JSON.parse(sessionStorage.getItem(scrollKey) ?? 'null') as ReadingPosition | null
        if (
          position &&
          Number.isInteger(position.index) &&
          position.index >= 0 &&
          Number.isFinite(position.offset) &&
          typeof position.atEnd === 'boolean'
        ) {
          atEnd.current = position.atEnd
          if (!position.atEnd)
            pendingPosition.current = { ...position, index: Math.min(position.index, sections.length - 1) }
          virtualizer.scrollToIndex(Math.min(position.index, sections.length - 1), {
            align: position.atEnd ? 'end' : 'start',
          })
        }
      } catch {
        /* Ignore an incomplete saved reading position. */
      }
      restored.current = true
    } else if (atEnd.current) jumpRef.current()
  }, [sections, scrollKey, jumpRef, virtualizer])
  useEffect(() => () => saveRef.current(), [scrollKey])
  useLayoutEffect(() => {
    const position = pendingPosition.current
    if (position) {
      const item = items.find((item) => item.index === position.index)
      if (item) {
        pendingPosition.current = null
        virtualizer.scrollToOffset(item.start + Math.max(0, Math.min(position.offset, item.size)))
      }
    }
    const id = pendingAnchor.current
    if (!id) return
    const target = [...(viewport.current?.querySelectorAll<HTMLElement>('[id]') ?? [])].find(
      (node) => node.id === id,
    )
    if (!target) return
    pendingAnchor.current = null
    target.scrollIntoView({ block: 'nearest' })
    if (target.tabIndex < 0) target.tabIndex = -1
    target.focus({ preventScroll: true })
  }, [items])
  return (
    <MarkdownAnchorContext.Provider
      value={(id) => {
        const index = anchors.get(id)
        if (index === undefined) return
        pendingAnchor.current = id
        atEnd.current = false
        virtualizer.scrollToIndex(index, { align: 'start' })
      }}
    >
      <div
        className="markdown virtual-markdown-scroll"
        data-virtual-markdown-content
        data-hapi-share-excerpt-label={t('Visible excerpt')}
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label={t('Rendered Markdown')}
        onScroll={() => {
          const element = viewport.current!
          atEnd.current = element.scrollHeight - element.clientHeight - element.scrollTop < 8
          save()
        }}
      >
        <div className="virtual-markdown-size" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => (
            <div
              className="virtual-markdown-section"
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <MarkdownTree tree={sections[item.index].tree} />
            </div>
          ))}
        </div>
      </div>
    </MarkdownAnchorContext.Provider>
  )
}

export default function LongMarkdown(props: Props) {
  const { t } = useTranslation()
  const { t: web } = useHapiTranslation()
  const { copied, copy } = useCopyToClipboard()
  const [selection, setSelection] = useState<'source' | 'preview'>(props.initialMode ?? 'source')
  const mode = props.mode ?? selection
  const [retry, setRetry] = useState(0)
  const result = useMarkdownPreview(props, mode === 'preview', retry)
  const jump = useRef<(() => void) | null>(null)
  const id = useId()
  const scrollKey = props.scrollKey ?? `desktop:markdown:${id}`
  const modes = props.mode === undefined && (
    <span className="content-mode-buttons" data-hapi-share-export-exclude="true">
      {(['preview', 'source'] as const).map((value) => (
        <button key={value} type="button" aria-pressed={mode === value} onClick={() => setSelection(value)}>
          {web(`file.page.tab.${value}`)}
        </button>
      ))}
    </span>
  )
  return (
    <div className={`long-markdown ${props.fillHeight ? 'long-markdown-fill' : ''}`}>
      {mode === 'source' ? (
        <VirtualTextContent
          code={props.content}
          language="Markdown"
          canCopy={props.canCopy}
          scrollKey={`${scrollKey}:source`}
          toolbarStart={modes}
        />
      ) : (
        <div className="virtual-markdown-content">
          <div className="virtual-text-toolbar">
            {modes}
            <span className="virtual-text-label">Markdown</span>
            <span className="virtual-text-actions" data-hapi-share-export-exclude="true">
              <button
                type="button"
                title={t('Jump to end')}
                aria-label={t('Jump to end')}
                disabled={!result.sections.length}
                onClick={() => jump.current?.()}
              >
                <ArrowDownToLine size={14} />
              </button>
              {props.canCopy && (
                <button
                  type="button"
                  data-hapi-code-copy
                  title={t(copied ? 'Copied' : 'Copy')}
                  aria-label={t(copied ? 'Copied' : 'Copy')}
                  onClick={() => void copy(props.content)}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              )}
            </span>
          </div>
          {result.error ? (
            <div className="markdown-preview-status" role="alert">
              <p>{t('Could not render this preview. You can still read the source.')}</p>
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                {t('Retry')}
              </button>
            </div>
          ) : result.sections.length ? (
            <RenderedMarkdown sections={result.sections} scrollKey={`${scrollKey}:preview`} jumpRef={jump} />
          ) : result.ready ? (
            <p className="markdown-preview-status muted">{web('file.page.empty')}</p>
          ) : (
            <p className="markdown-preview-status muted" role="status">
              {t('Rendering preview…')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
