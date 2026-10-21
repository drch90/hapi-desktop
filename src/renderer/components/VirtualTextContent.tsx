import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Compartment, EditorSelection, EditorState, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  keymap,
  lineNumbers,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import { standardKeymap } from '@codemirror/commands'
import {
  SearchQuery,
  getSearchQuery,
  gotoLine,
  openSearchPanel,
  search,
  searchKeymap,
  setSearchQuery,
} from '@codemirror/search'
import { ArrowDownToLine, Check, Copy, ListOrdered, Search, WrapText } from 'lucide-react'
import { useCodeWrap } from '@/hooks/useCodeWrap'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation as useHapiTranslation } from '@/lib/use-translation'

function decorateDiff(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = []
  let previousLine = 0
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos)
      if (line.number > previousLine) {
        const prefix = view.state.sliceDoc(line.from, Math.min(line.to, line.from + 4))
        const className = prefix.startsWith('+')
          ? 'diff-add'
          : prefix.startsWith('-')
            ? 'diff-remove'
            : prefix.startsWith('@@')
              ? 'diff-heading'
              : ''
        if (className) ranges.push(Decoration.line({ class: className }).range(line.from))
        previousLine = line.number
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(ranges)
}

const diffDecoration = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = decorateDiff(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = decorateDiff(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--app-fg)',
    backgroundColor: 'var(--app-code-bg)',
    fontSize: 'calc(13px * var(--desk-font-scale))',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    overscrollBehavior: 'contain',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '8px 0' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': { backgroundColor: 'var(--app-code-header-bg)', color: 'var(--desk-muted)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px' },
  '.cm-panels': { backgroundColor: 'var(--app-bg)', color: 'var(--app-fg)' },
  '.cm-panel': { maxHeight: 'min(210px, 35vh)', overflow: 'auto' },
  '.cm-panel.cm-search': { padding: '8px 22px 8px 8px' },
  '.cm-textfield': {
    maxWidth: '100%',
    background: 'var(--app-bg)',
    color: 'var(--app-fg)',
    border: '1px solid var(--desk-border)',
    borderRadius: '4px',
  },
  '.cm-button': {
    background: 'var(--app-secondary-bg)',
    color: 'var(--app-fg)',
    border: '1px solid var(--desk-border)',
    borderRadius: '4px',
  },
  '.cm-searchMatch': { backgroundColor: '#d4a72c44' },
  '.cm-searchMatch-selected': { backgroundColor: '#d4a72c88' },
  '.diff-heading': { color: 'var(--desk-muted)', backgroundColor: 'var(--app-code-header-bg)' },
})

type ScrollAnchor = { position: number; yMargin: number; atEnd: boolean }

function loadScrollAnchor(key?: string): ScrollAnchor | undefined {
  try {
    const anchor = key ? JSON.parse(sessionStorage.getItem(`${key}:anchor`) ?? 'null') : null
    if (
      anchor &&
      Number.isInteger(anchor.position) &&
      anchor.position >= 0 &&
      Number.isFinite(anchor.yMargin) &&
      typeof anchor.atEnd === 'boolean'
    )
      return anchor
  } catch {
    /* Ignore an incomplete saved position. */
  }
}

/** CodeMirror virtualizes both offscreen lines and gaps in very long lines. */
export function VirtualTextContent(props: {
  code: string
  language?: string
  title?: string
  diff?: boolean
  canCopy: boolean
  showWrapToggle?: boolean
  startLineNumber?: number
  ariaLabel?: string
  searchLabel?: string
  scrollKey?: string
  toolbarStart?: ReactNode
  toolbarActions?: ReactNode
}) {
  const { t } = useTranslation()
  const { t: web } = useHapiTranslation()
  const { codeWrap, setCodeWrap } = useCodeWrap()
  const { copied, copy } = useCopyToClipboard()
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<EditorView | null>(null)
  const previousCode = useRef(props.code)
  const wrap = useMemo(() => new Compartment(), [])
  const [lineCount, setLineCount] = useState(0)
  const findLabel = props.searchLabel || t('Find in text')

  useLayoutEffect(() => {
    if (!host.current) return
    const savedTop = props.scrollKey ? Number(sessionStorage.getItem(props.scrollKey)) || 0 : 0
    const savedLeft = props.scrollKey ? Number(sessionStorage.getItem(`${props.scrollKey}:left`)) || 0 : 0
    const anchor = loadScrollAnchor(props.scrollKey)
    let restored = savedTop === 0 && savedLeft === 0
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    const savePosition = () => {
      if (!restored || !props.scrollKey) return
      sessionStorage.setItem(props.scrollKey, String(view.scrollDOM.scrollTop))
      sessionStorage.setItem(`${props.scrollKey}:left`, String(view.scrollDOM.scrollLeft))
      const bounds = view.scrollDOM.getBoundingClientRect()
      const gutter = view.scrollDOM.querySelector('.cm-gutters')?.getBoundingClientRect().right ?? bounds.left
      const position =
        view.posAtCoords({ x: Math.min(bounds.right - 1, gutter + 2), y: bounds.top + 2 }, false) ?? 0
      const coordinates = view.coordsAtPos(position)
      sessionStorage.setItem(
        `${props.scrollKey}:anchor`,
        JSON.stringify({
          position,
          yMargin: (coordinates?.top ?? bounds.top) - bounds.top,
          atEnd:
            view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight - view.scrollDOM.scrollTop <=
            Math.max(4, view.defaultLineHeight),
        } satisfies ScrollAnchor),
      )
    }
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: props.code,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({
            tabindex: '0',
            'aria-label': props.ariaLabel || t('Read-only text'),
            'aria-readonly': 'true',
          }),
          EditorState.tabSize.of(4),
          lineNumbers({ formatNumber: (line) => String(line + (props.startLineNumber ?? 1) - 1) }),
          editorTheme,
          wrap.of(codeWrap ? EditorView.lineWrapping : []),
          search({ top: true }),
          keymap.of([{ key: 'Mod-g', run: gotoLine }, ...searchKeymap, ...standardKeymap]),
          EditorState.phrases.of({
            Find: findLabel,
            next: t('Next match'),
            previous: t('Previous match'),
            all: t('Select all matches'),
            'match case': t('Match case'),
            regexp: t('Regular expression'),
            'by word': t('Whole word'),
            close: t('Close'),
            'Go to line': t('Go to line'),
            go: t('Go'),
            'current match': t('Current match'),
            'on line': t('On line'),
          }),
          EditorView.domEventHandlers({
            scroll(event) {
              if (event.target !== view.scrollDOM || !restored) return
              clearTimeout(saveTimer)
              saveTimer = setTimeout(savePosition, 150)
            },
          }),
          ...(props.diff ? [diffDecoration] : []),
        ],
      }),
    })
    editor.current = view
    previousCode.current = props.code
    setLineCount(view.state.doc.lines)
    // The stock panel commits on keyup/change. An input event also covers
    // pasted text, so the first Enter always searches the current field value.
    const onSearchInput = (event: Event) => {
      const field = event.target
      if (!(field instanceof HTMLInputElement) || field.name !== 'search' || !field.closest('.cm-search'))
        return
      const current = getSearchQuery(view.state)
      const query = new SearchQuery({
        search: field.value,
        caseSensitive: current.caseSensitive,
        regexp: current.regexp,
        wholeWord: current.wholeWord,
      })
      if (!query.eq(current)) view.dispatch({ effects: setSearchQuery.of(query) })
    }
    view.dom.addEventListener('input', onSearchInput)
    // Estimated offscreen line heights change as a file is measured. Restore
    // its text position, rather than drifting hundreds of lines with a pixel offset.
    if (anchor) {
      view.dispatch({
        effects: EditorView.scrollIntoView(
          anchor.atEnd ? view.state.doc.length : Math.min(anchor.position, view.state.doc.length),
          {
            y: anchor.atEnd ? 'end' : 'start',
            yMargin: anchor.atEnd ? 0 : anchor.yMargin,
            x: anchor.atEnd || codeWrap ? 'nearest' : 'start',
            xMargin: 0,
          },
        ),
      })
      view.requestMeasure({
        read: () => null,
        write: () => {
          restored = true
        },
      })
    } else if (!restored)
      view.requestMeasure({
        read: () => null,
        write: () => {
          view.scrollDOM.scrollTop = savedTop
          view.scrollDOM.scrollLeft = savedLeft
          restored = true
        },
      })
    return () => {
      clearTimeout(saveTimer)
      savePosition()
      view.dom.removeEventListener('input', onSearchInput)
      editor.current = null
      view.destroy()
    }
    // Wrapping is reconfigured below without replacing the document or selection.
  }, [props.diff, props.scrollKey, props.startLineNumber, props.ariaLabel, findLabel, t, wrap])

  useLayoutEffect(() => {
    const view = editor.current
    const previous = previousCode.current
    if (!view || previous === props.code) return
    const scrollTop = view.scrollDOM.scrollTop
    const follow =
      view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight - scrollTop <=
      Math.max(4, view.defaultLineHeight)
    const appended = props.code.startsWith(previous)
    // Incremental appends keep selection and the existing document tree. A CRLF
    // split across stream updates is already represented by the preceding CR.
    const added = appended
      ? props.code.slice(
          previous.length + (previous.endsWith('\r') && props.code[previous.length] === '\n' ? 1 : 0),
        )
      : props.code
    const replacement = appended ? null : view.state.toText(added)
    view.dispatch({
      changes: {
        from: appended ? view.state.doc.length : 0,
        to: view.state.doc.length,
        insert: replacement ?? added,
      },
      ...(replacement
        ? {
            selection: EditorSelection.create(
              view.state.selection.ranges.map((range) =>
                EditorSelection.range(
                  Math.min(range.anchor, replacement.length),
                  Math.min(range.head, replacement.length),
                ),
              ),
              view.state.selection.mainIndex,
            ),
          }
        : {}),
    })
    previousCode.current = props.code
    setLineCount(view.state.doc.lines)
    view.requestMeasure({
      read: () => (follow ? view.scrollDOM.scrollHeight : scrollTop),
      // Scroll only this output. Background updates must not move the chat pane.
      write: (top) => {
        view.scrollDOM.scrollTop = top
      },
    })
  }, [props.code])

  useLayoutEffect(() => {
    const view = editor.current
    if (!view || view.lineWrapping === codeWrap) return
    view.dispatch({
      effects: [wrap.reconfigure(codeWrap ? EditorView.lineWrapping : []), view.scrollSnapshot()],
    })
  }, [codeWrap, wrap])

  return (
    <div
      className="virtual-text-content"
      data-virtual-text-content
      data-hapi-share-excerpt-label={t('Visible excerpt')}
    >
      <div className="virtual-text-toolbar">
        {props.toolbarStart}
        <span className="virtual-text-label">
          {props.title || props.language || 'text'} · {t('{{count}} lines', { count: lineCount })}
        </span>
        <span
          className="virtual-text-actions"
          data-hapi-share-export-exclude="true"
          onClick={(event) => event.stopPropagation()}
        >
          {props.toolbarActions}
          <button
            type="button"
            title={t('Jump to end')}
            aria-label={t('Jump to end')}
            onClick={() => {
              const view = editor.current
              if (view)
                view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }) })
            }}
          >
            <ArrowDownToLine size={14} />
          </button>
          <button
            type="button"
            title={`${findLabel} · Ctrl+F`}
            aria-label={findLabel}
            onClick={() => editor.current && openSearchPanel(editor.current)}
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            title={`${t('Go to line')} · Ctrl+G`}
            aria-label={t('Go to line')}
            onClick={() => editor.current && gotoLine(editor.current)}
          >
            <ListOrdered size={14} />
          </button>
          {props.showWrapToggle !== false && (
            <button
              type="button"
              data-hapi-code-wrap-toggle
              aria-pressed={codeWrap}
              title={web(codeWrap ? 'code.wrap.disable' : 'code.wrap.enable')}
              aria-label={web(codeWrap ? 'code.wrap.disable' : 'code.wrap.enable')}
              onClick={() => setCodeWrap(!codeWrap)}
            >
              <WrapText size={14} />
            </button>
          )}
          {props.canCopy && (
            <button
              type="button"
              data-hapi-code-copy
              title={web(copied ? 'message.copied' : 'code.copy')}
              aria-label={web(copied ? 'message.copied' : 'code.copy')}
              onClick={() => void copy(props.code)}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          )}
        </span>
      </div>
      <div className="virtual-text-editor" ref={host} />
    </div>
  )
}
