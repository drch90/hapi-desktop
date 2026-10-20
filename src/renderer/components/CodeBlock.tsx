import { lazy, memo, Suspense, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { CodeBlock as SharedCodeBlock } from '../../../vendor/hapi/web/src/components/CodeBlock'
import { isLargeText, paginateText, TEXT_PAGE_CHARS } from '@/lib/text-rendering'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

export const VirtualTextContent = lazy(() =>
  import('./VirtualTextContent').then((module) => ({ default: module.VirtualTextContent })),
)
type CodeBlockProps = ComponentProps<typeof SharedCodeBlock>

function LargeCodePreview(props: CodeBlockProps) {
  const { t } = useTranslation()
  const { copy, copied } = useCopyToClipboard()
  // Inline tool/CLI previews may be inside a button. Keep a static, bounded
  // excerpt there; their full detail surface uses the continuous viewer.
  const prefix = props.code.slice(0, TEXT_PAGE_CHARS + 2)
  const page = paginateText(prefix)[0]
  return (
    <div className="large-code-preview">
      <SharedCodeBlock
        {...props}
        code={prefix.slice(page.start, page.end)}
        language="text"
        showCopyButton={false}
        showWrapToggle={false}
      />
      {props.showCopyButton !== false && (
        <button
          type="button"
          className="large-code-preview-copy"
          data-hapi-code-copy
          data-hapi-share-export-exclude="true"
          aria-label={t(copied ? 'Copied' : 'Copy')}
          title={t(copied ? 'Copied' : 'Copy')}
          onClick={(event) => {
            event.stopPropagation()
            void copy(props.code)
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  )
}

export const CodeBlock = memo(function CodeBlock(props: CodeBlockProps) {
  const { t } = useTranslation()
  if (!isLargeText(props.code)) return <SharedCodeBlock {...props} />
  if (props.showWrapToggle === false && (props.collapseLongContent || props.showCopyButton === false))
    return <LargeCodePreview {...props} />
  return (
    <div
      className="virtual-text-block"
      data-hapi-code-block="true"
      style={{
        height: props.collapseLongContent ? (props.collapsedHeight ?? 260) : (props.maxHeight ?? 420),
      }}
    >
      <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>
        <VirtualTextContent
          code={props.code}
          language={props.language}
          title={props.title}
          diff={props.language === 'diff'}
          canCopy={props.showCopyButton !== false}
          showWrapToggle={props.showWrapToggle}
          startLineNumber={props.startLineNumber}
        />
      </Suspense>
    </div>
  )
})
