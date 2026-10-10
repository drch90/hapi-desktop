import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import {
  Columns2,
  Plus,
  Search,
  Settings as SettingsIcon,
  PanelRight,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  Pin,
  X,
  ArrowRightLeft,
  MessageSquare,
  Radio,
  CheckCircle2,
} from 'lucide-react'
import type { SessionSummary } from '@hapi/protocol'
import { I18nContext } from '@/lib/i18n-context'
import { en, zhCN } from '@/lib/locales'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { forgetQueueEdit } from './lib/queueEdit'
import { selectSessionList, sessionGroupKey } from './lib/sessionList'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { classifySessionAttention } from '@/lib/sessionAttention'
import {
  initializeSessionLastSeen,
  getSessionLastSeenSnapshot,
  markAllSessionsSeen,
  markSessionSeen,
  getSessionManualUnreadAt,
  useSessionLastSeenVersion,
} from '@/lib/sessionLastSeen'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToastProvider, useToast } from '@/lib/toast-context'
import { Toast } from '@/components/ui/Toast'
import type { Bootstrap, ConnectionState, Settings } from '../shared/bridge'
import { api, createApi, errorKey, unwrap } from './lib/api'
import {
  applyDesktopEvent,
  machinesKey,
  queries,
  refreshSessions,
  resetCaches,
  sessionsKey,
  sessionKey,
  forgetSession,
  markSessionArchived,
} from './lib/sync'
import {
  loadWorkspace,
  saveWorkspace,
  reduceWorkspace,
  migrateSessionLocalState,
  isHistoryGroupCollapsed,
  type WorkspaceAction,
  type PaneId,
  type Workspace,
} from './lib/workspace'
import { Chat } from './components/Chat'
import { FilePanel, type FileRequest } from './components/FilePanel'
import { forgetAttachmentDraft } from './lib/useAttachments'
import { SessionListActions } from './components/SessionListActions'
import { ResizeHandle } from './components/ResizeHandle'
import { SessionWorkspaceGroup } from './components/SessionWorkspaceGroup'
import { UsageDialog } from './components/Usage'
import { Tabs } from './components/Tabs'
import { NewSessionDialog } from './components/NewSessionDialog'

// New upstream picker labels share the desktop's seven-language catalog.
const hermesLabels: Record<string, string> = {
  'newSession.hermes.modelPlaceholder': 'Leave empty to use Hermes configuration',
  'hermes.models.default': 'Use Hermes default',
  'hermes.models.refresh': 'Refresh models',
  'hermes.models.search': 'Search provider or model',
  'hermes.models.loading': 'Loading Hermes models…',
  'hermes.models.empty': 'No matching models',
}

export function App() {
  const { t, i18n } = useTranslation()
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [connection, setConnection] = useState<ConnectionState>({ status: 'disconnected', hubUrl: '' })
  const [fatal, setFatal] = useState('')
  const openSession = useRef<(id: string, attention?: boolean, scope?: string) => void>(() => {})
  useEffect(() => {
    const unsubscribe = window.desktop.onEvent((event) => {
      applyDesktopEvent(event)
      if (event.type === 'connection') setConnection(event.state)
      if (event.type === 'settings')
        setBootstrap((previous) => (previous ? { ...previous, settings: event.settings } : previous))
      if (event.type === 'open-session') openSession.current(event.sessionId, event.attention, event.scope)
    })
    void unwrap(window.desktop.bootstrap())
      .then((value) => {
        setBootstrap(value)
        setConnection(value.connection)
      })
      .catch(() => setFatal('The request failed. Refresh and try again.'))
    return unsubscribe
  }, [])
  const settings = bootstrap?.settings
  useEffect(() => {
    const scales = { small: 0.875, normal: 1, large: 1.125, 'extra-large': 1.25 }
    document.documentElement.style.setProperty(
      '--desk-font-scale',
      String(scales[settings?.fontSize ?? 'normal']),
    )
  }, [settings?.fontSize])
  useEffect(() => {
    if (!settings) return
    void i18n.changeLanguage(settings.locale)
    document.documentElement.lang = settings.locale
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings?.locale, settings?.theme, i18n])
  const upstream = useMemo(() => {
    const locale = settings?.locale.startsWith('zh') ? ('zh-CN' as const) : ('en' as const)
    const dict = locale === 'zh-CN' ? zhCN : en
    return {
      locale,
      setLocale: () => {},
      t: (key: string, params?: Record<string, string | number>) =>
        hermesLabels[key]
          ? t(hermesLabels[key], { lng: settings?.locale })
          : ((dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key).replace(
              /\{(\w+)\}/g,
              (match, key: string) => String(params?.[key] ?? match),
            ),
    }
  }, [settings?.locale, t])
  if (!bootstrap) return <div className="loading-screen">{t(fatal || 'Loading…')}</div>
  const authenticated = connection.status === 'connected' || connection.status === 'reconnecting'
  return (
    <I18nContext.Provider value={upstream}>
      <ToastProvider key={connection.hubUrl + connection.profile}>
        {authenticated ? (
          <Workbench
            key={connection.hubUrl + connection.profile}
            bootstrap={bootstrap}
            connection={connection}
            openSession={openSession}
          />
        ) : (
          <ConnectScreen bootstrap={bootstrap} connection={connection} />
        )}
        <DesktopToasts
          scope={`${connection.hubUrl}:${connection.profile ?? ''}`}
          openSession={(id, attention) =>
            openSession.current(id, attention, `${connection.hubUrl}:${connection.profile ?? ''}`)
          }
        />
      </ToastProvider>
    </I18nContext.Provider>
  )
}

function DesktopToasts({
  openSession,
  scope,
}: {
  openSession: (id: string, attention?: boolean) => void
  scope: string
}) {
  const { toasts, removeToast, addToast } = useToast()
  useEffect(
    () =>
      window.desktop.onEvent((event) => {
        if (event.type === 'notification' && event.scope === scope)
          addToast({
            title: event.title,
            body: event.body,
            sessionId: event.sessionId,
            url: event.attention ? 'desktop:attention' : '',
          })
      }),
    [scope, addToast],
  )
  return (
    <div className="desktop-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          title={toast.title}
          body={toast.body}
          tabIndex={toast.sessionId ? 0 : undefined}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
              event.preventDefault()
              removeToast(toast.id)
              if (toast.sessionId) openSession(toast.sessionId, toast.url === 'desktop:attention')
            }
          }}
          onClose={() => removeToast(toast.id)}
          onClick={() => {
            removeToast(toast.id)
            if (toast.sessionId) openSession(toast.sessionId, toast.url === 'desktop:attention')
          }}
        />
      ))}
    </div>
  )
}

function ConnectScreen({ bootstrap, connection }: { bootstrap: Bootstrap; connection: ConnectionState }) {
  const { t } = useTranslation()
  const [hubUrl, setHubUrl] = useState(bootstrap.settings.hubUrl)
  const [accessToken, setAccessToken] = useState('')
  const [remember, setRemember] = useState(bootstrap.canRemember)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <main className="connect-screen">
      <section className="connect-card">
        <div className="brand-mark">
          <Radio size={28} />
        </div>
        <div className="eyebrow">HAPI DESKTOP</div>
        <h1>{t('Connect to your Hub')}</h1>
        <p className="muted">{t('Your agents, one workspace.')}</p>
        <form
          className="form-stack"
          onSubmit={async (event) => {
            event.preventDefault()
            if (busy) return
            setBusy(true)
            setError('')
            try {
              // Reset in-memory data; persisted drafts are scoped to Hub + account.
              resetCaches()
              await unwrap(window.desktop.connect({ hubUrl, accessToken, remember }))
              setAccessToken('')
            } catch (error) {
              setError(errorKey(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            {t('Hub URL')}
            <input
              type="url"
              required
              placeholder="https://hapi.example.com"
              value={hubUrl}
              onChange={(e) => setHubUrl(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            {t('Access token')}
            <input
              type="password"
              autoComplete="off"
              required
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={remember}
              disabled={!bootstrap.canRemember || busy}
              onChange={(e) => setRemember(e.target.checked)}
            />
            {t('Remember on this device')}
          </label>
          {!bootstrap.canRemember && (
            <p className="muted small">
              {t('Secure storage is unavailable. Sign in for this session only.')}
            </p>
          )}
          {(error || connection.error) && (
            <p role="alert" className="error">
              {t(error || errorKey(new Error(connection.error)))}
            </p>
          )}
          <Button type="submit" disabled={busy || connection.status === 'connecting'}>
            {t(busy || connection.status === 'connecting' ? 'Connecting…' : 'Connect')}
          </Button>
        </form>
        <div className="connect-footer">
          Codex <span>·</span> Claude Code <span>·</span> OpenCode
        </div>
      </section>
    </main>
  )
}

export function sessionTitle(session?: Pick<SessionSummary, 'id' | 'metadata'>) {
  return (
    session?.metadata?.name ||
    session?.metadata?.summary?.text ||
    session?.metadata?.path?.split('/').filter(Boolean).pop() ||
    session?.id.slice(0, 8) ||
    'HAPI'
  )
}

function Workbench({
  bootstrap,
  connection,
  openSession,
}: {
  bootstrap: Bootstrap
  connection: ConnectionState
  openSession: React.MutableRefObject<(id: string, attention?: boolean, scope?: string) => void>
}) {
  const { t } = useTranslation()
  const scope = `${connection.hubUrl}:${connection.profile ?? ''}`
  const [workspace, rawDispatch] = useReducer(reduceWorkspace, scope, loadWorkspace)
  const { addToast } = useToast()
  const [attentionTarget, setAttentionTarget] = useState<{ id: string; token: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [machineFilter, setMachineFilter] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [markAllRead, setMarkAllRead] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const sessionTree = useRef<HTMLDivElement>(null)
  const [locateTarget, setLocateTarget] = useState<string | null>(null)
  const workbench = useRef<HTMLElement>(null)
  const [workbenchWidth, setWorkbenchWidth] = useState(window.innerWidth)
  const [showSettings, setShowSettings] = useState(false)
  const [newSession, setNewSession] = useState<{ machineId?: string; directory?: string } | null>(null)
  const [preview, setPreview] = useState<FileRequest | null>(null)
  const [sessionMenu, setSessionMenu] = useState<{ id: string; point: { x: number; y: number } } | null>(null)
  const composerActions = useRef(new Map<string, (path: string) => void>())
  const registerComposer = useCallback((id: string, insert: ((path: string) => void) | null) => {
    if (insert) composerActions.current.set(id, insert)
    else composerActions.current.delete(id)
  }, [])
  const [readStateReady, setReadStateReady] = useState(false)
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus())
  const readVersion = useSessionLastSeenVersion()
  const lastSeen = useMemo(() => getSessionLastSeenSnapshot(), [readVersion, readStateReady])
  const paneContainer = useRef<HTMLDivElement>(null)
  const contentArea = useRef<HTMLDivElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  useEffect(() => {
    const area = contentArea.current
    if (!area) return
    const observer = new ResizeObserver(() => {
      setContentWidth(area.clientWidth)
      setWorkbenchWidth(workbench.current?.clientWidth ?? window.innerWidth)
    })
    observer.observe(area)
    if (workbench.current) observer.observe(workbench.current)
    setContentWidth(area.clientWidth)
    return () => observer.disconnect()
  }, [])
  const filePanelMax = Math.max(240, Math.min(960, contentWidth - (workspace.split ? 440 : 320)))
  const filePanelWidth = Math.min(workspace.filePanelWidth, filePanelMax)
  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: async () => (await api.getSessions()).sessions,
  })
  const machines = useQuery({
    queryKey: machinesKey,
    queryFn: async () => (await api.getMachines()).machines,
  })
  const rows = sessions.data ?? []
  const byId = new Map(rows.map((row) => [row.id, row]))
  const machineNames = new Map(
    (machines.data ?? []).map((machine) => [
      machine.id,
      machine.metadata?.displayName || machine.metadata?.host || machine.id,
    ]),
  )
  const dispatch = useCallback(
    (action: WorkspaceAction) => {
      const id =
        action.type === 'open'
          ? action.id
          : action.type === 'focus' && workspace.focused !== action.pane
            ? workspace.panes[action.pane].active
            : null
      if (id) {
        const row = sessions.data?.find((row) => row.id === id)
        if (row) markSessionSeen(`${scope}:${id}`, row.updatedAt)
      }
      rawDispatch(action)
    },
    [scope, sessions.data, workspace.focused, workspace.panes],
  )
  const openListedSession = (id: string) => {
    const row = queries.getQueryData<SessionSummary[]>(sessionsKey)?.find((row) => row.id === id)
    dispatch({ type: 'open', id, preview: row ? !row.active : undefined })
  }
  const previousSessionStates = useRef(new Map<string, { active: boolean; lifecycle?: string }>())
  useEffect(() => {
    if (!sessions.data) return
    for (const row of sessions.data) {
      const previous = previousSessionStates.current.get(row.id)
      // A confirmed lifecycle change also covers archiving from Web. A lost
      // runner connection alone must not close a tab or interrupt its draft.
      if (previous && previous.lifecycle !== 'archived' && row.metadata?.lifecycleState === 'archived')
        rawDispatch({ type: 'close', id: row.id })
      else if (row.active && !previous?.active) rawDispatch({ type: 'keep-tab', id: row.id })
    }
    previousSessionStates.current = new Map(
      sessions.data.map((row) => [row.id, { active: row.active, lifecycle: row.metadata?.lifecycleState }]),
    )
  }, [sessions.data])
  const sessionArchived = useCallback(async (id: string) => {
    previousSessionStates.current.set(id, { active: false, lifecycle: 'archived' })
    await markSessionArchived(id)
    rawDispatch({ type: 'close', id })
  }, [])
  const sidebarMax = Math.max(
    220,
    Math.min(480, workbenchWidth - (workspace.split ? 440 : 320) - (workspace.sidePanel ? 240 : 0)),
  )
  const sidebarWidth = workspace.sidebarCollapsed ? 48 : Math.min(workspace.sidebarWidth, sidebarMax)
  const pendingCount = rows.reduce((count, row) => count + row.pendingRequestsCount, 0)
  const unreadCount = rows.filter((row) => row.updatedAt > (lastSeen[`${scope}:${row.id}`] ?? 0)).length
  const focusSearch = useCallback(() => {
    rawDispatch({ type: 'sidebar', collapsed: false })
    requestAnimationFrame(() => searchInput.current?.focus())
  }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.altKey ||
        document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') ||
        !(event.ctrlKey || event.metaKey)
      )
        return
      const key = event.key.toLowerCase()
      const pane = workspace.panes[workspace.focused]
      if (key === 'w' && !event.shiftKey) {
        if (pane.active) dispatch({ type: 'close', id: pane.active })
      } else if (key === 'tab') {
        if (pane.tabs.length) {
          const next =
            (pane.tabs.indexOf(pane.active ?? '') + (event.shiftKey ? -1 : 1) + pane.tabs.length) %
            pane.tabs.length
          dispatch({ type: 'open', id: pane.tabs[next] })
        }
      } else if (key === 't' && event.shiftKey)
        dispatch({ type: 'restore', available: rows.map((row) => row.id) })
      else if (key === 'b' && !event.shiftKey) dispatch({ type: 'sidebar' })
      else if (key === 'k' && !event.shiftKey) focusSearch()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [workspace, rows, dispatch, focusSearch])
  const activeId = workspace.panes[workspace.focused].active
  const sessionDeleted = useCallback(
    (id: string) => {
      forgetSession(id)
      forgetAttachmentDraft(scope, id)
      forgetQueueEdit(scope, id)
      for (const family of ['draft', 'outbox', 'queue-edit', 'scratch-draft', 'scratch-save'])
        localStorage.removeItem(`desktop:${family}:${scope}:${id}`)
      for (const key of Object.keys(localStorage))
        if (key.startsWith(`desktop:scratch-send:${scope}:${id}:`)) localStorage.removeItem(key)
      dispatch({ type: 'remove', id })
      setPreview((previous) => (previous?.sessionId === id ? null : previous))
    },
    [scope],
  )
  useEffect(
    () =>
      window.desktop.onEvent((event) => {
        if (event.type === 'sync' && event.event.type === 'session-removed')
          sessionDeleted(event.event.sessionId)
      }),
    [sessionDeleted],
  )
  useEffect(() => {
    saveWorkspace(scope, workspace)
  }, [workspace, scope])
  useEffect(() => {
    let disposed = false
    openSession.current = (id, attention, noticeScope) => {
      if (noticeScope && noticeScope !== scope) return
      if (!attention && !noticeScope) {
        const row = queries.getQueryData<SessionSummary[]>(sessionsKey)?.find((row) => row.id === id)
        rawDispatch({ type: 'open', id, preview: row ? !row.active : undefined })
        return
      }
      void createApi(scope)
        .getSession(id)
        .then(({ session }) => {
          if (disposed) return
          const row = queries.getQueryData<SessionSummary[]>(sessionsKey)?.find((row) => row.id === id)
          if (row) markSessionSeen(`${scope}:${id}`, row.updatedAt)
          rawDispatch({ type: 'open', id, preview: !attention && !session.active })
          if (attention) setAttentionTarget({ id, token: Date.now() })
          refreshSessions()
        })
        .catch((error) => {
          if (!disposed) addToast({ title: t(errorKey(error)), body: '', sessionId: '', url: '' })
        })
    }
    return () => {
      disposed = true
      openSession.current = () => {}
    }
  }, [openSession, scope, addToast, t])
  const visibleIds = workspace.panes
    .filter((_, index) => index === 0 || workspace.split)
    .map((pane) => pane.active)
    .filter((id): id is string => Boolean(id))
  const unreadIds = useMemo(
    () =>
      new Set(
        rows
          .filter(
            (row) =>
              readStateReady &&
              classifySessionAttention(row, {
                selected: visibleIds.includes(row.id),
                manualUnreadAt: getSessionManualUnreadAt(`${scope}:${row.id}`),
                lastSeenAt: lastSeen[`${scope}:${row.id}`] ?? 0,
              })?.kind === 'unread',
          )
          .map((row) => row.id),
      ),
    [sessions.data, readStateReady, scope, lastSeen, visibleIds.join('|')],
  )
  useEffect(() => {
    const updateFocus = () => setWindowFocused(document.hasFocus() && document.visibilityState === 'visible')
    window.addEventListener('focus', updateFocus)
    window.addEventListener('blur', updateFocus)
    document.addEventListener('visibilitychange', updateFocus)
    return () => {
      window.removeEventListener('focus', updateFocus)
      window.removeEventListener('blur', updateFocus)
      document.removeEventListener('visibilitychange', updateFocus)
    }
  }, [])
  useEffect(() => {
    if (!sessions.data) return
    initializeSessionLastSeen(
      scope,
      sessions.data.map((row) => ({ id: `${scope}:${row.id}`, updatedAt: row.updatedAt })),
    )
    setReadStateReady(true)
    if (windowFocused) {
      markAllSessionsSeen(
        sessions.data
          .filter(
            (row) => visibleIds.includes(row.id) && getSessionManualUnreadAt(`${scope}:${row.id}`) === null,
          )
          .map((row) => ({ id: `${scope}:${row.id}`, updatedAt: row.updatedAt })),
      )
    }
  }, [sessions.data, scope, windowFocused, visibleIds.join('|')])
  useEffect(() => {
    void window.desktop.setVisibleSessions(visibleIds)
    return () => {
      void window.desktop.setVisibleSessions([])
    }
  }, [visibleIds.join('|')])
  const sections = useMemo(
    () =>
      selectSessionList({
        sessions: sessions.data ?? [],
        machines: machines.data ?? [],
        search,
        machine: machineFilter,
        unreadOnly: readStateReady && unreadOnly,
        lastSeen,
        scope,
      }),
    [sessions.data, machines.data, search, machineFilter, unreadOnly, lastSeen, readStateReady, scope],
  )
  const groupKeys = sections
    .filter((section) => section.key === 'history')
    .flatMap((section) => section.groups.map(([key]) => key))
  const locateSession = (id: string) => {
    const row = byId.get(id)
    if (!row) return
    // Only explicit location changes filters, and only if they hide the target.
    // Opening the tab marks it read, so an unread-only list must also be cleared.
    if (
      unreadOnly ||
      !sections.some((section) =>
        section.groups.some(([, group]) => group.sessions.some((row) => row.id === id)),
      )
    ) {
      setSearch('')
      setMachineFilter('')
      setUnreadOnly(false)
    }
    rawDispatch({ type: 'sidebar', collapsed: false })
    if (!row.active && !row.globalPinned)
      rawDispatch({ type: 'set-history-groups', keys: [sessionGroupKey(row)], collapsed: false })
    setLocateTarget(id)
  }
  useEffect(() => {
    if (!locateTarget) return
    if (activeId === locateTarget && !workspace.sidebarCollapsed) {
      const row = sessions.data?.find((row) => row.id === locateTarget)
      if (
        row &&
        !row.active &&
        !row.globalPinned &&
        !workspace.expandedHistoryGroups.includes(sessionGroupKey(row))
      ) {
        rawDispatch({ type: 'set-history-groups', keys: [sessionGroupKey(row)], collapsed: false })
        return
      }
      // Wait for the expanded group and any cleared filters to reach the DOM.
      sessionTree.current
        ?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(locateTarget)}"]`)
        ?.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
    setLocateTarget(null)
  }, [
    locateTarget,
    activeId,
    workspace.sidebarCollapsed,
    workspace.expandedHistoryGroups,
    sections,
    sessions.data,
  ])
  function replaceSession(from: string, to: string) {
    if (!to || to.length > 256) throw new Error('INVALID_RESPONSE')
    migrateSessionLocalState(scope, from, to)
    dispatch({ type: 'replace', from, to })
    // A resume can remove its source via SSE before returning the new ID.
    dispatch({ type: 'open', id: to })
    refreshSessions()
  }
  return (
    <main className="workbench" ref={workbench}>
      <aside
        className={`sidebar ${workspace.sidebarCollapsed ? 'collapsed' : ''}`}
        style={{ width: sidebarWidth }}
      >
        <div className="sidebar-rail">
          <button
            className="icon-button"
            title={`${t(workspace.sidebarCollapsed ? 'Expand session list' : 'Collapse session list')} (Ctrl+B)`}
            aria-label={t(workspace.sidebarCollapsed ? 'Expand session list' : 'Collapse session list')}
            onClick={() => dispatch({ type: 'sidebar' })}
          >
            {workspace.sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          {workspace.sidebarCollapsed && (
            <>
              <button
                className="icon-button"
                title={t('New session')}
                aria-label={t('New session')}
                disabled={connection.status !== 'connected'}
                onClick={() => setNewSession({})}
              >
                <Plus size={18} />
              </button>
              <button
                className="icon-button"
                title={`${t('Search sessions')} (Ctrl+K)`}
                aria-label={t('Search sessions')}
                onClick={focusSearch}
              >
                <Search size={18} />
              </button>
              <button
                className="icon-button pending-shortcut"
                title={`${t('Pending')}: ${pendingCount}`}
                aria-label={`${t('Pending')}: ${pendingCount}`}
                disabled={!pendingCount}
                onClick={() => {
                  const target = rows.find((row) => row.pendingRequestsCount > 0)
                  if (!target) return
                  openListedSession(target.id)
                  locateSession(target.id)
                  setAttentionTarget({ id: target.id, token: Date.now() })
                }}
              >
                <Bell size={18} />
                <span>{pendingCount}</span>
              </button>
              <span className="rail-spacer" />
              <span
                className={`status-dot ${connection.status === 'connected' ? 'online' : 'pending'}`}
                title={t(connection.status)}
              />
              <button
                className="icon-button"
                title={t('Settings')}
                aria-label={t('Settings')}
                onClick={() => setShowSettings(true)}
              >
                <SettingsIcon size={18} />
              </button>
            </>
          )}
        </div>
        <div className="brand">
          <div className="brand-mark small-mark">
            <Radio size={20} />
          </div>
          <b>
            HAPI <span>Desktop</span>
          </b>
          <span className="version">{bootstrap.version}</span>
        </div>
        <Button
          className="new-session"
          variant="outline"
          onClick={() => setNewSession({})}
          disabled={connection.status !== 'connected'}
        >
          <Plus size={16} />
          {t('New session')}
        </Button>
        <div className="search-field">
          <Search size={15} />
          <input
            ref={searchInput}
            aria-label={t('Search sessions')}
            placeholder={t('Search sessions')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="session-list-tools">
          <select
            aria-label={t('Filter by machine')}
            value={machineFilter}
            onChange={(event) => setMachineFilter(event.target.value)}
          >
            <option value="">{t('All machines')}</option>
            {[...new Set(rows.map((row) => row.metadata?.machineId ?? '__unknown__'))].map((id) => (
              <option key={id} value={id}>
                {id === '__unknown__'
                  ? t('Unknown machine')
                  : machines.data?.find((machine) => machine.id === id)?.metadata?.displayName ||
                    machines.data?.find((machine) => machine.id === id)?.metadata?.host ||
                    id.slice(0, 8)}
              </option>
            ))}
          </select>
          <label className="check-label">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
            />
            {t('Unread only')}
          </label>
          <button
            className="icon-button"
            title={t('Mark all as read')}
            aria-label={t('Mark all as read')}
            disabled={!unreadCount}
            onClick={() => setMarkAllRead(true)}
          >
            <CheckCircle2 size={16} />
          </button>
        </div>
        <div className="session-tree" ref={sessionTree}>
          {sessions.isPending && <p className="muted padded">{t('Loading…')}</p>}
          {sessions.isError && (
            <button className="error padded" onClick={() => void sessions.refetch()}>
              {t('Refresh')}
            </button>
          )}
          {!sessions.isPending && sections.length === 0 && (
            <p className="muted padded">{t(search ? 'No matching sessions' : 'No sessions yet')}</p>
          )}
          {sections.map((section) => (
            <section
              key={section.key}
              data-testid={`sessions-${section.key}`}
              className="session-section"
              data-section={section.key}
            >
              {section.title && (
                <h2>
                  {t(section.title)}{' '}
                  <span>{section.groups.reduce((count, [, group]) => count + group.sessions.length, 0)}</span>
                </h2>
              )}
              {section.groups.map(([key, group]) => {
                // Carry over earlier workspace choices; new history overrides
                // take precedence and never hide live sessions in the top sections.
                const defaultCollapsed = isHistoryGroupCollapsed(
                  workspace,
                  group.workspaceKey,
                  section.key === 'history' &&
                    bootstrap.settings.collapseHistoryByDefault &&
                    !group.sessions.some((row) => row.pinned),
                )
                return (
                  <SessionWorkspaceGroup
                    key={key}
                    machine={group.machine}
                    path={group.path}
                    hasDirectory={group.hasDirectory}
                    canCreate={
                      connection.status === 'connected' &&
                      Boolean(
                        machines.data?.some((machine) => machine.id === group.machineId && machine.active),
                      )
                    }
                    onNewSession={() => {
                      if (group.machineId && group.hasDirectory)
                        setNewSession({ machineId: group.machineId, directory: group.path })
                    }}
                    count={group.sessions.length}
                    filtering={Boolean(search.trim())}
                    showHeading={section.key === 'history'}
                    collapsible={section.key === 'history'}
                    collapsed={
                      section.key === 'history' &&
                      !search.trim() &&
                      isHistoryGroupCollapsed(workspace, key, defaultCollapsed)
                    }
                    onToggle={() =>
                      dispatch({
                        type: 'toggle-history-group',
                        key,
                        defaultCollapsed,
                      })
                    }
                    onSetAllCollapsed={(collapsed) =>
                      dispatch({ type: 'set-history-groups', keys: groupKeys, collapsed })
                    }
                  >
                    {group.sessions.map((row) => {
                      const unread = unreadIds.has(row.id)
                      const status = !row.active
                        ? 'history'
                        : row.pendingRequestsCount
                          ? 'pending'
                          : row.thinking
                            ? 'thinking'
                            : row.backgroundTaskCount
                              ? 'background'
                              : 'ready'
                      return (
                        <button
                          key={row.id}
                          data-testid={`session-${row.id}`}
                          data-session-id={row.id}
                          data-status={status}
                          title={[
                            row.metadata?.machineId
                              ? machineNames.get(row.metadata.machineId) || row.metadata.machineId
                              : undefined,
                            row.metadata?.path,
                          ]
                            .filter(Boolean)
                            .join('\n')}
                          className={`session-row ${activeId === row.id ? 'selected' : ''} ${unread ? 'unread' : ''}`}
                          onClick={() => openListedSession(row.id)}
                          onDoubleClick={() => dispatch({ type: 'open', id: row.id, preview: false })}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            setSessionMenu({ id: row.id, point: { x: event.clientX, y: event.clientY } })
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                              event.preventDefault()
                              const rect = event.currentTarget.getBoundingClientRect()
                              setSessionMenu({ id: row.id, point: { x: rect.left + 20, y: rect.bottom } })
                            }
                          }}
                        >
                          {status === 'ready' ? (
                            <CheckCircle2 size={14} className="session-ready-icon" aria-hidden="true" />
                          ) : (
                            <span
                              className={`status-dot ${row.pendingRequestsCount ? 'pending' : row.thinking ? 'thinking' : row.active ? 'online' : ''}`}
                            />
                          )}
                          <span className="session-copy">
                            <span>
                              {(row.pinned || row.globalPinned) && (
                                <Pin
                                  size={12}
                                  className="session-pin"
                                  aria-label={t(row.globalPinned ? 'Global pins' : 'Project pins')}
                                />
                              )}
                              {sessionTitle(row)}
                            </span>
                            <small>
                              {row.metadata?.flavor || 'Agent'} <span>·</span>{' '}
                              <strong className="session-status">
                                {t(
                                  status === 'pending'
                                    ? 'Pending'
                                    : status === 'thinking'
                                      ? 'Thinking'
                                      : status === 'ready'
                                        ? 'Ready'
                                        : status === 'background'
                                          ? 'Running in background'
                                          : 'History',
                                )}
                              </strong>
                            </small>
                          </span>
                          {row.pendingRequestsCount > 0 && (
                            <span className="count">{row.pendingRequestsCount}</span>
                          )}
                          {unread && <Badge className="session-unread-badge">{t('New activity')}</Badge>}
                        </button>
                      )
                    })}
                  </SessionWorkspaceGroup>
                )
              })}
            </section>
          ))}
        </div>
        <footer className="sidebar-footer">
          <span className={`status-dot ${connection.status === 'connected' ? 'online' : 'pending'}`} />
          <span title={scope}>{t(connection.status)}</span>
          <button className="icon-button" aria-label={t('Settings')} onClick={() => setShowSettings(true)}>
            <SettingsIcon size={17} />
          </button>
        </footer>
        {!workspace.sidebarCollapsed && (
          <div className="sidebar-resizer">
            <ResizeHandle
              label={t('Resize session list')}
              value={sidebarWidth}
              min={220}
              max={sidebarMax}
              step={20}
              pointerValue={(x) => x - workbench.current!.getBoundingClientRect().left}
              onChange={(width) => dispatch({ type: 'sidebar-width', width: Math.round(width) })}
              onReset={() => dispatch({ type: 'sidebar-width', width: 272 })}
            />
          </div>
        )}
      </aside>
      <section className="main-area">
        <header className="workspace-header">
          <span className="eyebrow">{t('Workspace')}</span>
          <span className="muted host-label">{new URL(connection.hubUrl).host}</span>
          <div className="header-actions">
            <button
              className={`icon-button ${workspace.split ? 'selected' : ''}`}
              title={t(workspace.split ? 'Single view' : 'Split view')}
              aria-label={t(workspace.split ? 'Single view' : 'Split view')}
              onClick={() => dispatch({ type: 'split' })}
            >
              <Columns2 size={18} />
            </button>
            <button
              className={`icon-button ${workspace.sidePanel ? 'selected' : ''}`}
              aria-label={t('Files')}
              title={t('Files')}
              onClick={() => dispatch({ type: 'side-panel' })}
            >
              <PanelRight size={18} />
            </button>
          </div>
        </header>
        {connection.status !== 'connected' && (
          <div className="connection-banner" role="status">
            {t('reconnecting')}
          </div>
        )}
        <div className="content-area" ref={contentArea}>
          <div className="panes" ref={paneContainer}>
            {([0, 1] as const)
              .filter((id) => id === 0 || workspace.split)
              .map((pane) => (
                <div
                  className="pane-fragment"
                  key={pane}
                  style={{ flex: workspace.split ? (pane === 0 ? workspace.ratio : 1 - workspace.ratio) : 1 }}
                >
                  {pane === 1 && (
                    <ResizeHandle
                      label={t('Split view')}
                      value={workspace.ratio * 100}
                      min={30}
                      max={70}
                      step={2}
                      pointerValue={(clientX) => {
                        const rect = paneContainer.current!.getBoundingClientRect()
                        return ((clientX - rect.left) / rect.width) * 100
                      }}
                      onChange={(value) => dispatch({ type: 'ratio', ratio: value / 100 })}
                      onReset={() => dispatch({ type: 'ratio', ratio: 0.5 })}
                    />
                  )}
                  <section
                    className={`chat-pane ${workspace.focused === pane ? 'focused' : ''}`}
                    onFocusCapture={(event) => {
                      // Portaled menus belong to this React tree, but are outside the pane.
                      if (event.currentTarget.contains(event.target)) dispatch({ type: 'focus', pane })
                    }}
                    onPointerDown={() => {
                      if (workspace.focused !== pane) dispatch({ type: 'focus', pane })
                    }}
                  >
                    <Tabs
                      pane={pane}
                      workspace={workspace}
                      dispatch={dispatch}
                      byId={byId}
                      machineNames={machineNames}
                      connected={connection.status === 'connected'}
                      unreadIds={unreadIds}
                      onLocate={locateSession}
                      dragging={dragging}
                      onDrag={setDragging}
                    />
                    {workspace.panes[pane].active ? (
                      <Chat
                        key={workspace.panes[pane].active}
                        id={workspace.panes[pane].active!}
                        scope={scope}
                        sessions={rows}
                        machines={machines.data ?? []}
                        attentionToken={
                          attentionTarget?.id === workspace.panes[pane].active
                            ? attentionTarget.token
                            : undefined
                        }
                        connected={connection.status === 'connected'}
                        enterBehavior={bootstrap.settings.enterBehavior}
                        codexExplorationCollapsed={bootstrap.settings.codexExplorationCollapsed}
                        replaceSession={replaceSession}
                        sessionDeleted={sessionDeleted}
                        sessionArchived={sessionArchived}
                        keepSession={(id) => dispatch({ type: 'keep-tab', id })}
                        openSession={openListedSession}
                        registerComposer={registerComposer}
                        openFile={(path) => {
                          if (workspace.focused !== pane) dispatch({ type: 'focus', pane })
                          setPreview({
                            sessionId: workspace.panes[pane].active!,
                            path,
                            requestId: crypto.randomUUID(),
                          })
                          if (!workspace.sidePanel) dispatch({ type: 'side-panel' })
                        }}
                      />
                    ) : (
                      <div className="empty-pane">
                        <MessageSquare size={36} strokeWidth={1} />
                        <h2>{t('Open a session to begin')}</h2>
                        <p>{t('Choose a session from the sidebar, or create a new one.')}</p>
                        <Button variant="outline" onClick={() => setNewSession({})}>
                          <Plus size={15} />
                          {t('New session')}
                        </Button>
                      </div>
                    )}
                  </section>
                </div>
              ))}
          </div>
          {workspace.sidePanel && activeId && (
            <div className="file-sidebar" style={{ width: filePanelWidth }}>
              <ResizeHandle
                label={t('Resize file panel')}
                value={filePanelWidth}
                min={240}
                max={filePanelMax}
                step={20}
                direction={-1}
                pointerValue={(clientX) => contentArea.current!.getBoundingClientRect().right - clientX}
                onChange={(width) => dispatch({ type: 'file-panel-width', width: Math.round(width) })}
                onReset={() => dispatch({ type: 'file-panel-width', width: 335 })}
              />
              <FilePanel
                key={activeId}
                sessionId={activeId}
                scope={scope}
                workspacePath={byId.get(activeId)?.metadata?.path}
                request={preview?.sessionId === activeId ? preview : undefined}
                onAddToComposer={(path) => composerActions.current.get(activeId)?.(path)}
                onOpenSession={openListedSession}
                close={() => dispatch({ type: 'side-panel' })}
              />
            </div>
          )}
        </div>
      </section>
      {sessionMenu && byId.get(sessionMenu.id) && (
        <SessionListActions
          key={`${sessionMenu.id}:${sessionMenu.point.x}:${sessionMenu.point.y}`}
          session={byId.get(sessionMenu.id)!}
          point={sessionMenu.point}
          connected={connection.status === 'connected'}
          scope={scope}
          onDismiss={() => setSessionMenu(null)}
          onDeleted={sessionDeleted}
          onArchived={sessionArchived}
        />
      )}
      <ConfirmDialog
        isOpen={markAllRead}
        onClose={() => setMarkAllRead(false)}
        title={t('Mark all as read')}
        description={t('Mark {{count}} unread sessions in this account as read?', { count: unreadCount })}
        confirmLabel={t('Mark all as read')}
        confirmingLabel={t('Working…')}
        isPending={false}
        onConfirm={async () => {
          markAllSessionsSeen(rows.map((row) => ({ id: `${scope}:${row.id}`, updatedAt: row.updatedAt })))
          setMarkAllRead(false)
        }}
      />
      <SettingsDialog
        open={showSettings}
        close={() => setShowSettings(false)}
        bootstrap={bootstrap}
        scope={scope}
      />
      {newSession && (
        <NewSessionDialog
          initialMachineId={newSession.machineId}
          initialDirectory={newSession.directory}
          close={() => setNewSession(null)}
          created={(id) => {
            dispatch({ type: 'open', id })
            setNewSession(null)
            refreshSessions()
          }}
        />
      )}
    </main>
  )
}

function SettingsDialog({
  open,
  close,
  bootstrap,
  scope,
}: {
  open: boolean
  close: () => void
  bootstrap: Bootstrap
  scope: string
}) {
  const { t } = useTranslation()
  const [usageOpen, setUsageOpen] = useState(false)
  const [error, setError] = useState('')
  async function update(value: Partial<Settings>) {
    try {
      await unwrap(window.desktop.updateSettings(value))
      setError('')
    } catch (error) {
      setError(errorKey(error))
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close()
      }}
    >
      <DialogContent className="desktop-dialog">
        <DialogHeader>
          <DialogTitle>{t('Settings')}</DialogTitle>
        </DialogHeader>
        <div className="form-stack">
          <label>
            {t('Language')}
            <select
              aria-label={t('Language')}
              value={bootstrap.settings.locale}
              onChange={(e) => void update({ locale: e.target.value as Settings['locale'] })}
            >
              {Object.entries({
                zh: '简体中文',
                en: 'English',
                'zh-TW': '繁體中文',
                ja: '日本語',
                fr: 'Français',
                ru: 'Русский',
                vi: 'Tiếng Việt',
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Theme')}
            <select
              aria-label={t('Theme')}
              value={bootstrap.settings.theme}
              onChange={(e) => void update({ theme: e.target.value as Settings['theme'] })}
            >
              {(['system', 'light', 'dark'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark')}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Interface font size')}
            <select
              aria-label={t('Interface font size')}
              value={bootstrap.settings.fontSize}
              onChange={(e) => void update({ fontSize: e.target.value as Settings['fontSize'] })}
            >
              <option value="small">{t('Small')}</option>
              <option value="normal">{t('Standard')}</option>
              <option value="large">{t('Large')}</option>
              <option value="extra-large">{t('Extra large')}</option>
            </select>
          </label>
          <label>
            {t('Enter key behavior')}
            <select
              aria-label={t('Enter key behavior')}
              value={bootstrap.settings.enterBehavior}
              onChange={(e) => void update({ enterBehavior: e.target.value as Settings['enterBehavior'] })}
            >
              <option value="newline">{t('Enter for newline')}</option>
              <option value="send">{t('Enter to send')}</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={bootstrap.settings.collapseHistoryByDefault}
              onChange={(e) => void update({ collapseHistoryByDefault: e.target.checked })}
            />
            {t('Collapse history workspaces by default')}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={bootstrap.settings.codexExplorationCollapsed}
              onChange={(e) => void update({ codexExplorationCollapsed: e.target.checked })}
            />
            {t('Collapse explored tool groups by default')}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={bootstrap.settings.notifications}
              onChange={(e) => void update({ notifications: e.target.checked })}
            />
            {t('Notifications')}
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={bootstrap.settings.launchAtLogin}
              disabled={bootstrap.platform !== 'win32'}
              onChange={(e) => void update({ launchAtLogin: e.target.checked })}
            />
            {t('Launch at login')}
          </label>
          <Button variant="outline" onClick={() => setUsageOpen(true)}>
            {t('Usage statistics')}
          </Button>
          {usageOpen && <UsageDialog scope={scope} close={() => setUsageOpen(false)} />}
          <p className="small muted">{t('Closing the window keeps notifications running in the tray.')}</p>
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <Button
            variant="outline"
            onClick={async () => {
              try {
                close()
                await unwrap(window.desktop.disconnect())
                resetCaches(true)
                localStorage.clear()
              } catch (error) {
                setError(errorKey(error))
              }
            }}
          >
            {t('Disconnect and forget credentials')}
          </Button>
          <span className="small muted">HAPI Desktop {bootstrap.version} · AGPL-3.0</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
