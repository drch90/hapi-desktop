import {
  Children,
  isValidElement,
  memo,
  createContext,
  useContext,
  useState,
  type ComponentPropsWithoutRef,
} from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkLatexBracketMath from '@/lib/remark-latex-bracket-math'
import remarkRepairTables from '@/lib/remark-repair-tables'
import { Table } from '@/components/assistant-ui/markdown-text'
import { CodeBlock } from '@/components/CodeBlock'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { unwrap } from '../lib/api'
import { parseSessionPathHref } from '@/lib/sessionReference'
import { MermaidBlock } from './MermaidBlock'

const remarkPlugins: PluggableList = [
  [remarkGfm, { singleTilde: false }],
  remarkRepairTables,
  remarkLatexBracketMath,
  // Match Web: currency stays literal; use \(…\), \[…\] or $$…$$ for math.
  [remarkMath, { singleDollarTextMath: false }],
]
const remarkPluginsWithBreaks: PluggableList = [...remarkPlugins, remarkBreaks]
const rehypePlugins: PluggableList = [rehypeKatex]

export const LinkContext = createContext<{
  openSession: (id: string) => void
  openFile: (path: string) => void
}>({ openSession: () => {}, openFile: () => {} })

function DesktopTable({ children }: ComponentPropsWithoutRef<'table'>) {
  return <Table>{children}</Table>
}

function DesktopLink({ href, children, node: _node, ...props }: ComponentPropsWithoutRef<'a'> & ExtraProps) {
  const links = useContext(LinkContext)
  const { t } = useTranslation()
  const { copied, copy } = useCopyToClipboard()
  const [failed, setFailed] = useState(false)
  const external = href?.startsWith('//') ? `https:${href}` : href
  async function open(anchor?: HTMLAnchorElement) {
    setFailed(false)
    if (!external) return
    try {
      if (external.startsWith('#')) {
        const id = decodeURIComponent(external.slice(1))
        // Footnote IDs can repeat across messages. Stay in the clicked message
        // and scroll its pane without navigating the privileged renderer.
        const target = [...(anchor?.closest('.markdown')?.querySelectorAll<HTMLElement>('[id]') ?? [])].find(
          (element) => element.id === id,
        )
        if (target) {
          target.scrollIntoView({ block: 'nearest' })
          if (target.tabIndex < 0) target.tabIndex = -1
          target.focus({ preventScroll: true })
        }
        return
      }
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
        {...props}
        href={external}
        title={props.title ?? external}
        onClick={(event) => {
          event.preventDefault()
          void open(event.currentTarget)
        }}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault()
            void open(event.currentTarget)
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

function DesktopPre({ children }: ComponentPropsWithoutRef<'pre'>) {
  const child = Children.toArray(children)[0]
  if (!isValidElement<ComponentPropsWithoutRef<'code'>>(child)) return <pre>{children}</pre>
  // Only <pre><code> is a block. Source line counts also include multiline
  // inline code, and a one-line indented block may span just one source line.
  const language = /(?:^|\s)language-([^\s]+)/i.exec(child.props.className ?? '')?.[1].toLowerCase()
  const code = String(child.props.children ?? '').replace(/\n$/, '')
  return language === 'mermaid' || language === 'mmd' ? (
    <MermaidBlock code={code} />
  ) : (
    <CodeBlock code={code} language={language} scrollY />
  )
}

const components: Components = {
  table: DesktopTable,
  a: DesktopLink,
  img: ({ alt }) => <span className="muted">[{alt ?? ''}]</span>,
  pre: DesktopPre,
}

// Desktop links never navigate the privileged renderer. Markdown has no raw
// HTML support and remote images cannot make hidden network requests.
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  preserveSingleLineBreaks = false,
}: {
  content: string
  className?: string
  preserveSingleLineBreaks?: boolean
  [key: string]: unknown
}) {
  return (
    <div className={`markdown ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={preserveSingleLineBreaks ? remarkPluginsWithBreaks : remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
