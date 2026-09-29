import { memo, createContext, useContext, useState, type ComponentPropsWithoutRef } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from '@/components/CodeBlock'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { unwrap } from '../lib/api'
import { parseSessionPathHref } from '@/lib/sessionReference'

export const LinkContext = createContext<{
  openSession: (id: string) => void
  openFile: (path: string) => void
}>({ openSession: () => {}, openFile: () => {} })

function DesktopLink({ href, children }: ComponentPropsWithoutRef<'a'>) {
  const links = useContext(LinkContext)
  const { t } = useTranslation()
  const { copied, copy } = useCopyToClipboard()
  const [failed, setFailed] = useState(false)
  const external = href?.startsWith('//') ? `https:${href}` : href
  async function open() {
    setFailed(false)
    if (!external) return
    try {
      if (/^https?:\/\//i.test(external)) {
        await unwrap(window.desktop.openExternal(external))
        return
      }
      const session = parseSessionPathHref(external)
      if (session) links.openSession(session)
      else if (!/^[a-z][a-z\d+.-]*:/i.test(external) && !external.startsWith('#'))
        links.openFile(decodeURIComponent(external).replace(/(?::\d+(?::\d+)?|#L\d+(?:-L\d+)?)$/, ''))
    } catch {
      setFailed(true)
    }
  }
  return (
    <>
      <a
        href={external}
        title={external}
        onClick={(event) => {
          event.preventDefault()
          void open()
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault()
            void open()
          }
        }}
      >
        {children}
      </a>
      {failed && (
        <span className="link-error" role="alert">
          {t('Could not open the link. Check your default browser or copy the address.')}
          <button type="button" onClick={() => void open()}>
            {t('Retry')}
          </button>
          <button type="button" onClick={() => void copy(external ?? '')}>
            {t(copied ? 'Copied' : 'Copy link')}
          </button>
        </span>
      )}
    </>
  )
}

// Desktop links never navigate the privileged renderer. Markdown has no raw
// HTML support and remote images cannot make hidden network requests.
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
}: {
  content: string
  className?: string
  [key: string]: unknown
}) {
  return (
    <div className={`markdown ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: DesktopLink,
          img: ({ alt }) => <span className="muted">[{alt ?? ''}]</span>,
          pre: ({ children }) => <>{children}</>,
          code: ({ className: language, children, node }) => {
            const code = String(children).replace(/\n$/, '')
            const block =
              Boolean(language) || (node?.position?.end.line ?? 0) > (node?.position?.start.line ?? 0)
            return block ? (
              <CodeBlock code={code} language={language?.replace('language-', '')} scrollY />
            ) : (
              <code>{children}</code>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
