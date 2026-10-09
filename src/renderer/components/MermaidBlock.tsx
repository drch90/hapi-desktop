import { useState, type ComponentPropsWithoutRef } from 'react'
import { CodeXml, Eye } from 'lucide-react'
import { MermaidDiagram } from '@/components/assistant-ui/mermaid-diagram'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import { CheckIcon, CopyIcon, WrapIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useCodeWrap } from '@/hooks/useCodeWrap'
import { useTranslation } from '@/lib/use-translation'

const codeComponents = {
  Pre: (props: ComponentPropsWithoutRef<'pre'>) => <pre {...props} />,
  Code: (props: ComponentPropsWithoutRef<'code'>) => <code {...props} />,
}
const buttonClass =
  'rounded-md p-1 text-[var(--app-code-header-fg)] hover:bg-[var(--app-code-copy-hover-bg)] hover:text-[var(--app-fg)]'

export function MermaidBlock({ code }: { code: string }) {
  const { t } = useTranslation()
  const { copied, copy } = useCopyToClipboard()
  const { codeWrap, setCodeWrap } = useCodeWrap()
  const [showSource, setShowSource] = useState(false)

  return (
    <div
      data-hapi-code-block="true"
      className="markdown-mermaid aui-code-surface min-w-0 max-w-full overflow-hidden rounded-xl bg-[var(--app-code-bg)]"
    >
      <div className="aui-code-surface-header flex items-center justify-between gap-3 bg-[var(--app-code-header-bg)] px-3 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--app-code-header-fg)]">
          mermaid
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className={buttonClass}
            title={t(showSource ? 'file.page.tab.preview' : 'file.page.tab.source')}
            aria-pressed={showSource}
            data-hapi-share-export-exclude="true"
            data-hapi-share-action="true"
            onClick={() => setShowSource(!showSource)}
          >
            {showSource ? <Eye size={14} /> : <CodeXml size={14} />}
          </button>
          {showSource && (
            <button
              type="button"
              className={buttonClass}
              title={t(codeWrap ? 'code.wrap.disable' : 'code.wrap.enable')}
              aria-pressed={codeWrap}
              data-hapi-code-wrap-toggle="true"
              data-hapi-wrap-enable-label={t('code.wrap.enable')}
              data-hapi-wrap-disable-label={t('code.wrap.disable')}
              data-hapi-share-export-exclude="true"
              onClick={() => setCodeWrap(!codeWrap)}
            >
              <WrapIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            className={buttonClass}
            title={t('code.copy')}
            data-hapi-code-copy="true"
            data-hapi-copy-label={t('code.copy')}
            data-hapi-copied-label={t('message.copied')}
            data-hapi-share-export-exclude="true"
            onClick={() => void copy(code)}
          >
            <span data-hapi-copy-default="true" className={copied ? 'hidden' : ''}>
              <CopyIcon className="h-3.5 w-3.5" />
            </span>
            <span data-hapi-copy-success="true" className={copied ? '' : 'hidden'}>
              <CheckIcon className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      </div>
      {showSource ? (
        <SyntaxHighlighter code={code} language="mermaid" components={codeComponents} />
      ) : (
        <MermaidDiagram code={code} language="mermaid" components={codeComponents} />
      )}
    </div>
  )
}
