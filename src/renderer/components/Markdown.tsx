import { memo, createContext, useContext } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from '@/components/CodeBlock'

export const LinkContext = createContext<{
  openSession: (id: string) => void
  openFile: (path: string) => void
}>({ openSession: () => {}, openFile: () => {} })

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
  const links = useContext(LinkContext)
  return (
    <div className={`markdown ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(event) => {
                event.preventDefault()
                if (!href) return
                const session = /^\/sessions\/([^/?#]+)$/.exec(href)
                if (session) {
                  links.openSession(decodeURIComponent(session[1]))
                  return
                }
                if (/^https?:\/\//i.test(href)) {
                  void window.desktop.openExternal(href)
                  return
                }
                if (!/^[a-z][a-z\d+.-]*:/i.test(href) && !href.startsWith('#') && !href.startsWith('//'))
                  links.openFile(href.replace(/#L\d+(?:-L\d+)?$/, ''))
              }}
            >
              {children}
            </a>
          ),
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
