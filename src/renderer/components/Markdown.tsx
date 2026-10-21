import {
  Children,
  isValidElement,
  memo,
  createContext,
  useContext,
  useState,
  lazy,
  Suspense,
  useMemo,
  type ComponentPropsWithoutRef,
} from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { Root, RootContent } from 'hast'
import { useTranslation } from 'react-i18next'
import ReactMarkdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown'
import { Table } from '@/components/assistant-ui/markdown-text'
import { CodeBlock } from '@/components/CodeBlock'
import { isLargeText } from '@/lib/text-rendering'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { unwrap } from '../lib/api'
import { parseSessionPathHref } from '@/lib/sessionReference'
import { MermaidBlock } from './MermaidBlock'
import { getRemarkPlugins, rehypePlugins, type MarkdownOptions } from '../lib/markdown-plugins'

const LongMarkdown = lazy(() => import('./LongMarkdown'))
export const MarkdownAnchorContext = createContext<((id: string) => void) | null>(null)

export const LinkContext = createContext<{
  openSession: (id: string) => void
  openFile: (path: string) => void
}>({ openSession: () => {}, openFile: () => {} })

function DesktopTable({ children }: ComponentPropsWithoutRef<'table'>) {
  return <Table>{children}</Table>
}

function DesktopLink({ href, children, node: _node, ...props }: ComponentPropsWithoutRef<'a'> & ExtraProps) {
  const links = useContext(LinkContext)
  const openAnchor = useContext(MarkdownAnchorContext)
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
        } else openAnchor?.(id)
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

/** Render the same desktop components from a tree parsed in the background. */
export const MarkdownTree = memo(function MarkdownTree({ tree }: { tree: Root }) {
  return useMemo(() => {
    // Match react-markdown's URL policy. Raw HTML is discarded by remark-rehype.
    function clean(node: RootContent) {
      if (node.type !== 'element') return
      for (const key of ['href', 'src']) {
        const value = node.properties[key]
        if (typeof value === 'string') node.properties[key] = defaultUrlTransform(value)
      }
      node.children.forEach(clean)
    }
    tree.children.forEach(clean)
    return toJsxRuntime(tree, { Fragment, jsx, jsxs, components, passKeys: true, passNode: true })
  }, [tree])
})

// Desktop links never navigate the privileged renderer. Markdown has no raw
// HTML support and remote images cannot make hidden network requests.
export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  preserveSingleLineBreaks = false,
  userMessage = false,
  largeMode,
  fillHeight = false,
  scrollKey,
  canCopy = true,
  initialMode,
}: {
  content: string
  className?: string
  preserveSingleLineBreaks?: boolean
  userMessage?: boolean
  largeMode?: 'source' | 'preview'
  fillHeight?: boolean
  scrollKey?: string
  canCopy?: boolean
  initialMode?: 'source' | 'preview'
  [key: string]: unknown
}) {
  const { t } = useTranslation()
  const options: MarkdownOptions = { preserveSingleLineBreaks, userMessage }
  // Long content keeps its continuous source view, with an on-demand preview
  // that parses off the UI thread and only mounts visible Markdown sections.
  if (isLargeText(content))
    return (
      <div className={`markdown ${fillHeight ? 'markdown-fill' : ''} ${className ?? ''}`}>
        <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>
          <LongMarkdown
            content={content}
            {...options}
            mode={largeMode}
            fillHeight={fillHeight}
            scrollKey={scrollKey}
            canCopy={canCopy}
            initialMode={initialMode}
          />
        </Suspense>
      </div>
    )
  return (
    <div className={`markdown ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={getRemarkPlugins(options)}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
