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
import { classifySessionAttention } from '@/lib/sessionAttention'
import {
  initializeSessionLastSeen,
  getSessionLastSeenSnapshot,
  markAllSessionsSeen,
  useSessionLastSeenVersion,
} from '@/lib/sessionLastSeen'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToastProvider, useToast } from '@/lib/toast-context'
import { Toast } from '@/components/ui/Toast'
import type { Bootstrap, ConnectionState, Settings } from '../shared/bridge'
import { api, errorKey, unwrap } from './lib/api'
import {
  applyDesktopEvent,
  machinesKey,
  queries,
  refreshSessions,
  resetCaches,
  sessionsKey,
  sessionKey,
  forgetSession,
} from './lib/sync'
import {
  loadWorkspace,
  reduceWorkspace,
  migrateSessionLocalState,
  isHistoryGroupCollapsed,
  type WorkspaceAction,
  type PaneId,
  type Workspace,
} from './lib/workspace'
import { Chat } from './components/Chat'
import { FilePanel, type FileRequest } from './components/FilePanel'
import { SessionListActions } from './components/SessionListActions'
import { ResizeHandle } from './components/ResizeHandle'
import { SessionWorkspaceGroup } from './components/SessionWorkspaceGroup'
import { NewSessionDialog } from './components/NewSessionDialog'

export function App() {
  const { t, i18n } = useTranslation()
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [connection, setConnection] = useState<ConnectionState>({ status: 'disconnected', hubUrl: '' })
  const [fatal, setFatal] = useState('')
  const openSession = useRef<(id: string) => void>(() => {})
  useEffect(() => {
    const unsubscribe = window.desktop.onEvent((event) => {
      applyDesktopEvent(event)
      if (event.type === 'connection') setConnection(event.state)
      if (event.type === 'settings')
        setBootstrap((previous) => (previous ? { ...previous, settings: event.settings } : previous))
      if (event.type === 'open-session') openSession.current(event.sessionId)
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
        ((dict as Record<string, string>)[key] ?? (en as Record<string, string>)[key] ?? key).replace(
          /\{(\w+)\}/g,
          (match, key: string) => String(params?.[key] ?? match),
        ),
    }
  }, [settings?.locale])
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
        <DesktopToasts openSession={(id) => openSession.current(id)} />
      </ToastProvider>
    </I18nContext.Provider>
  )
}

function DesktopToasts({ openSession }: { openSession: (id: string) => void }) {
  const { toasts, removeToast } = useToast()
  return (
    <div className="desktop-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          title={toast.title}
          body={toast.body}
          onClose={() => removeToast(toast.id)}
          onClick={() => {
            removeToast(toast.id)
            if (toast.sessionId) openSession(toast.sessionId)
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
  openSession: React.MutableRefObject<(id: string) => void>
}) {
  const { t } = useTranslation()
  const scope = `${connection.hubUrl}:${connection.profile ?? ''}`
  const [workspace, dispatch] = useReducer(reduceWorkspace, scope, loadWorkspace)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [showSettings, setShowSettings] = useState(false)
  const [showNew, setShowNew] = useState(false)
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
    const observer = new ResizeObserver(() => setContentWidth(area.clientWidth))
    observer.observe(area)
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
  const activeId = workspace.panes[workspace.focused].active
  const sessionDeleted = useCallback(
    (id: string) => {
      forgetSession(id)
      for (const family of ['draft', 'outbox']) localStorage.removeItem(`desktop:${family}:${scope}:${id}`)
      dispatch({ type: 'close', id })
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
    localStorage.setItem(`desktop:workspace:${scope}`, JSON.stringify(workspace))
  }, [workspace, scope])
  useEffect(() => {
    openSession.current = (id) => dispatch({ type: 'open', id })
    return () => {
      openSession.current = () => {}
    }
  }, [openSession])
  const visibleIds = workspace.panes
    .filter((_, index) => index === 0 || workspace.split)
    .map((pane) => pane.active)
    .filter((id): id is string => Boolean(id))
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
          .filter((row) => visibleIds.includes(row.id))
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
  const groups = useMemo(() => {
    const groups = new Map<string, { machine: string; path: string; sessions: SessionSummary[] }>()
    for (const row of [...(sessions.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (
        (filter === 'Active' && !row.active) ||
        (filter === 'Pending' && !row.pendingRequestsCount) ||
        (filter === 'History' && row.active)
      )
        continue
      const machine = machines.data?.find((m) => m.id === row.metadata?.machineId)
      const machineName =
        machine?.metadata?.displayName ||
        machine?.metadata?.host ||
        row.metadata?.machineId?.slice(0, 8) ||
        'HAPI'
      const path = row.metadata?.path ?? '/'
      if (
        !`${sessionTitle(row)} ${machineName} ${path} ${row.metadata?.flavor ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())
      )
        continue
      const key = `${row.metadata?.machineId}:${path}`
      if (!groups.has(key)) groups.set(key, { machine: machineName, path, sessions: [] })
      groups.get(key)!.sessions.push(row)
    }
    return [...groups.entries()]
  }, [sessions.data, machines.data, filter, search])
  const sections = useMemo(() => {
    if (!bootstrap.settings.groupSessionsByStatus) return [{ key: 'all', title: null, groups }]
    return [
      { key: 'thinking', title: 'In progress' },
      { key: 'active', title: 'Active sessions' },
      { key: 'history', title: 'History sessions' },
    ]
      .map(({ key, title }) => {
        const sectionGroups = groups
          .map(
            ([groupKey, group]) =>
              [
                groupKey,
                {
                  ...group,
                  sessions: group.sessions.filter(
                    (row) => (!row.active ? 'history' : row.thinking ? 'thinking' : 'active') === key,
                  ),
                },
              ] as const,
          )
          .filter(([, group]) => group.sessions.length > 0)
        return {
          key,
          title,
          groups:
            key === 'history' || !sectionGroups.length
              ? sectionGroups
              : ([
                  [
                    key,
                    {
                      machine: '',
                      path: '',
                      sessions: sectionGroups
                        .flatMap(([, group]) => group.sessions)
                        .sort((a, b) => b.updatedAt - a.updatedAt),
                    },
                  ],
                ] as typeof groups),
        }
      })
      .filter((section) => section.groups.length > 0)
  }, [groups, bootstrap.settings.groupSessionsByStatus])
  function replaceSession(from: string, to: string) {
    if (!to || to.length > 256) throw new Error('INVALID_RESPONSE')
    migrateSessionLocalState(scope, from, to)
    dispatch({ type: 'replace', from, to })
    refreshSessions()
  }
  return (
    <main className="workbench">
      <aside className="sidebar">
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
          onClick={() => setShowNew(true)}
          disabled={connection.status !== 'connected'}
        >
          <Plus size={16} />
          {t('New session')}
        </Button>
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label={t('Search sessions')}
            placeholder={t('Search sessions')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="filters">
          {['All', 'Active', 'Pending', 'History'].map((value) => (
            <button
              key={value}
              className={filter === value ? 'selected' : ''}
              onClick={() => setFilter(value)}
            >
              {t(value)}
              {value === 'Pending' && rows.some((s) => s.pendingRequestsCount) ? <i /> : null}
            </button>
          ))}
        </div>
        <div className="session-tree">
          {sessions.isPending && <p className="muted padded">{t('Loading…')}</p>}
          {sessions.isError && (
            <button className="error padded" onClick={() => void sessions.refetch()}>
              {t('Refresh')}
            </button>
          )}
          {!sessions.isPending && groups.length === 0 && (
            <p className="muted padded">{t(search ? 'No matching sessions' : 'No sessions yet')}</p>
          )}
          {sections.map((section) => (
            <section key={section.key} data-testid={`sessions-${section.key}`} className="session-section">
              {section.title && (
                <h2>
                  {t(section.title)}{' '}
                  <span>{section.groups.reduce((count, [, group]) => count + group.sessions.length, 0)}</span>
                </h2>
              )}
              {section.groups.map(([key, group]) => (
                <SessionWorkspaceGroup
                  key={key}
                  machine={group.machine}
                  path={group.path}
                  count={group.sessions.length}
                  filtering={Boolean(search.trim())}
                  historyOnly={group.sessions.every((row) => !row.active)}
                  showHeading={section.key === 'history' || section.key === 'all'}
                  collapsible={group.sessions.every((row) => !row.active)}
                  collapsed={
                    !search.trim() &&
                    group.sessions.every((row) => !row.active) &&
                    isHistoryGroupCollapsed(workspace, key, bootstrap.settings.collapseHistoryByDefault)
                  }
                  onToggle={() =>
                    dispatch({
                      type: 'toggle-history-group',
                      key,
                      defaultCollapsed: bootstrap.settings.collapseHistoryByDefault,
                    })
                  }
                >
                  {group.sessions.map((row) => {
                    const unread =
                      readStateReady &&
                      classifySessionAttention(row, {
                        selected: false,
                        lastSeenAt: lastSeen[`${scope}:${row.id}`] ?? 0,
                      })?.kind === 'unread'
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
                        data-status={status}
                        className={`session-row ${activeId === row.id ? 'selected' : ''} ${unread ? 'unread' : ''}`}
                        onClick={() => dispatch({ type: 'open', id: row.id })}
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
                          <span>{sessionTitle(row)}</span>
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
              ))}
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
                    onFocusCapture={() => dispatch({ type: 'focus', pane })}
                    onPointerDown={() => {
                      if (workspace.focused !== pane) dispatch({ type: 'focus', pane })
                    }}
                  >
                    <Tabs pane={pane} workspace={workspace} dispatch={dispatch} byId={byId} />
                    {workspace.panes[pane].active ? (
                      <Chat
                        key={workspace.panes[pane].active}
                        id={workspace.panes[pane].active!}
                        scope={scope}
                        connected={connection.status === 'connected'}
                        enterBehavior={bootstrap.settings.enterBehavior}
                        replaceSession={replaceSession}
                        sessionDeleted={sessionDeleted}
                        openSession={(id) => dispatch({ type: 'open', id })}
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
                        <Button variant="outline" onClick={() => setShowNew(true)}>
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
                onOpenSession={(id) => dispatch({ type: 'open', id })}
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
          onDismiss={() => setSessionMenu(null)}
          onDeleted={sessionDeleted}
        />
      )}
      <SettingsDialog open={showSettings} close={() => setShowSettings(false)} bootstrap={bootstrap} />
      {showNew && (
        <NewSessionDialog
          close={() => setShowNew(false)}
          created={(id) => {
            dispatch({ type: 'open', id })
            setShowNew(false)
            refreshSessions()
          }}
        />
      )}
    </main>
  )
}

function Tabs({
  pane,
  workspace,
  dispatch,
  byId,
}: {
  pane: PaneId
  workspace: Workspace
  dispatch: Dispatch<WorkspaceAction>
  byId: Map<string, SessionSummary>
}) {
  const { t } = useTranslation()
  const { tabs, active } = workspace.panes[pane]
  return (
    <div className="tabs" role="tablist">
      {tabs.map((id) => (
        <div className={`tab ${active === id ? 'active' : ''}`} key={id}>
          <button
            role="tab"
            aria-selected={active === id}
            onClick={() => dispatch({ type: 'open', id, pane })}
          >
            {sessionTitle(byId.get(id)) || id.slice(0, 8)}
          </button>
          <button
            className="tab-close"
            aria-label={t('Close tab')}
            onClick={() => dispatch({ type: 'close', id })}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {active && (
        <button
          className="icon-button move-tab"
          aria-label={t('Move to other pane')}
          title={t('Move to other pane')}
          onClick={() => dispatch({ type: 'move', id: active, pane: pane === 0 ? 1 : 0 })}
        >
          <ArrowRightLeft size={14} />
        </button>
      )}
    </div>
  )
}

function SettingsDialog({
  open,
  close,
  bootstrap,
}: {
  open: boolean
  close: () => void
  bootstrap: Bootstrap
}) {
  const { t } = useTranslation()
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
              checked={bootstrap.settings.groupSessionsByStatus}
              onChange={(e) => void update({ groupSessionsByStatus: e.target.checked })}
            />
            {t('Group sessions by status')}
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
                resetCaches()
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
