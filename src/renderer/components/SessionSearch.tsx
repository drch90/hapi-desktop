import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, History, Search, X } from 'lucide-react'
import {
  addRecentSearch,
  loadSessionSearchHistory,
  saveSessionSearchHistory,
} from '../lib/sessionSearchHistory'

export type SessionSearchHandle = { focus: () => void }

export function SessionSearch({
  scope,
  value,
  onChange,
  collapsed,
  ref,
}: {
  scope: string
  value: string
  onChange: (query: string) => void
  collapsed: boolean
  ref?: Ref<SessionSearchHandle>
}) {
  const { t } = useTranslation()
  const historyId = useId()
  const container = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
  const pendingQuery = useRef<string | null>(null)
  const [history, setHistory] = useState(() => loadSessionSearchHistory(scope))
  const [open, setOpen] = useState(false)
  const expanded = open && !collapsed

  const updateHistory = useCallback(
    (next: string[]) => {
      setHistory(next)
      saveSessionSearchHistory(scope, next)
    },
    [scope],
  )
  const commitSearch = useCallback(() => {
    if (pendingQuery.current === null) return
    const query = pendingQuery.current
    pendingQuery.current = null
    if (query.trim()) updateHistory(addRecentSearch(history, query))
  }, [history, updateHistory])

  useImperativeHandle(ref, () => ({
    focus() {
      input.current?.focus()
      input.current?.select()
      setOpen(true)
    },
  }))

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        commitSearch()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [commitSearch])

  useEffect(() => {
    if (!collapsed) return
    commitSearch()
    setOpen(false)
  }, [collapsed, commitSearch])

  const cancelSearch = () => {
    commitSearch()
    onChange('')
    input.current?.focus({ preventScroll: true })
    setOpen(false)
  }
  const selectSearch = (query: string) => {
    const previous = pendingQuery.current ? addRecentSearch(history, pendingQuery.current) : history
    pendingQuery.current = null
    updateHistory(addRecentSearch(previous, query))
    onChange(query)
    input.current?.focus({ preventScroll: true })
    setOpen(false)
  }
  const removeSearch = (query: string) => {
    // Removing the current query must survive the next blur or cancellation.
    if (pendingQuery.current?.trim().toLowerCase() === query.toLowerCase()) pendingQuery.current = null
    input.current?.focus({ preventScroll: true })
    updateHistory(history.filter((entry) => entry !== query))
  }
  const historyButtons = () => [
    ...(container.current?.querySelectorAll<HTMLButtonElement>('.search-history-query') ?? []),
  ]

  return (
    <div
      className="session-search"
      ref={container}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        commitSearch()
        setOpen(false)
      }}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          cancelSearch()
        }
      }}
    >
      <div className="search-field">
        <Search size={15} aria-hidden="true" />
        <input
          ref={input}
          aria-label={t('Search sessions')}
          aria-controls={expanded ? historyId : undefined}
          placeholder={t('Search sessions')}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onChange={(event) => {
            pendingQuery.current = event.target.value
            onChange(event.target.value)
            setOpen(false)
          }}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              commitSearch()
              setOpen(false)
            } else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault()
              setOpen(true)
              requestAnimationFrame(() => {
                const buttons = historyButtons()
                buttons[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus()
              })
            }
          }}
        />
        {value && (
          <button
            type="button"
            className="icon-button search-cancel"
            aria-label={t('Cancel search')}
            title={`${t('Cancel search')} (Esc)`}
            onClick={cancelSearch}
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          className="icon-button search-history-toggle"
          aria-label={t('Recent searches')}
          title={t('Recent searches')}
          aria-expanded={expanded}
          aria-controls={expanded ? historyId : undefined}
          onClick={() => setOpen(!expanded)}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div
          id={historyId}
          className="search-history"
          role="region"
          aria-label={t('Recent searches')}
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            const buttons = historyButtons()
            if (!buttons.length) return
            const current = buttons.findIndex((button) =>
              button.parentElement?.contains(event.target as Node),
            )
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : current < 0
                    ? event.key === 'ArrowDown'
                      ? 0
                      : buttons.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
            buttons[next]?.focus()
          }}
        >
          <div className="search-history-header">
            <span>{t('Recent searches')}</span>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  pendingQuery.current = null
                  input.current?.focus({ preventScroll: true })
                  updateHistory([])
                }}
              >
                {t('Clear search history')}
              </button>
            )}
          </div>
          {history.length ? (
            <ul className="search-history-list">
              {history.map((query) => (
                <li key={query}>
                  <button
                    type="button"
                    className="search-history-query"
                    title={query}
                    onClick={() => selectSearch(query)}
                  >
                    <History size={14} aria-hidden="true" />
                    <span>{query}</span>
                  </button>
                  <button
                    type="button"
                    className="icon-button search-history-remove"
                    aria-label={`${t('Remove recent search')}: ${query}`}
                    title={t('Remove recent search')}
                    onClick={() => removeSearch(query)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="search-history-empty">{t('No recent searches')}</p>
          )}
        </div>
      )}
    </div>
  )
}
