import { useEffect, useRef, useState, type Dispatch } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRightLeft,
  BellRing,
  CheckCircle2,
  Circle,
  Eye,
  LoaderCircle,
  Timer,
  WifiOff,
  X,
} from 'lucide-react'
import type { SessionSummary } from '@hapi/protocol'
import { getSessionTitle } from '@/lib/sessionTitle'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import type { PaneId, Workspace, WorkspaceAction } from '../lib/workspace'

function tabActivity(session: SessionSummary | undefined, connected: boolean) {
  // Match the composer: cached work cannot override connectivity or a request.
  if (!connected) return 'disconnected'
  if (!session) return 'loading'
  if (!session.active) return 'offline'
  if (session.pendingRequestsCount > 0) return 'pending'
  if (session.thinking) return 'processing'
  if ((session.backgroundTaskCount ?? 0) > 0) return 'background'
  return 'idle'
}

const activityIcons = {
  disconnected: WifiOff,
  loading: LoaderCircle,
  offline: Circle,
  pending: BellRing,
  processing: LoaderCircle,
  background: Timer,
  idle: CheckCircle2,
}

export function Tabs(props: {
  pane: PaneId
  workspace: Workspace
  dispatch: Dispatch<WorkspaceAction>
  byId: Map<string, SessionSummary>
  machineNames: ReadonlyMap<string, string>
  connected: boolean
  unreadIds: ReadonlySet<string>
  onLocate: (id: string) => void
  dragging: string | null
  onDrag: (id: string | null) => void
}) {
  const { t } = useTranslation()
  const { pane, workspace, dispatch, byId } = props
  const { tabs, active, preview } = workspace.panes[pane]
  const bar = useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const closeMenu = (focusActivePane = false) => {
    const menuElement = menuRef.current
    setMenu(null)
    requestAnimationFrame(() => {
      if (focusActivePane) {
        document.querySelector<HTMLElement>('.chat-pane.focused .tabs [aria-selected="true"]')?.focus()
        return
      }
      // Let an outside click keep its new focus; otherwise return to the original control.
      const focused = document.activeElement
      if (focused && focused !== document.body && !menuElement?.contains(focused)) return
      if (previousFocus.current?.isConnected && previousFocus.current !== document.body)
        previousFocus.current.focus()
      else if (trigger.current?.isConnected) trigger.current.focus()
      else (bar.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? bar.current)?.focus()
    })
  }
  const { menuRef, menuStyle } = useAnchoredMenu({
    isOpen: Boolean(menu),
    onClose: closeMenu,
    anchorPoint: menu ?? { x: 0, y: 0 },
    align: 'start',
  })
  const rememberFocus = () => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && !menuRef.current?.contains(focused)) previousFocus.current = focused
  }
  useEffect(() => {
    if (!props.dragging) setDropIndex(null)
  }, [props.dragging])
  useEffect(() => {
    bar.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs.join('|')])
  useEffect(() => {
    if (menu && !tabs.includes(menu.id)) setMenu(null)
  }, [tabs.join('|'), menu])
  const index = menu ? tabs.indexOf(menu.id) : -1
  const items: { label: string; disabled?: boolean; focusActivePane?: boolean; run: () => void }[] = menu
    ? [
        ...(menu.id === preview
          ? [{ label: 'Keep tab open', run: () => dispatch({ type: 'keep-tab', id: menu.id }) }]
          : []),
        { label: 'Close tab', run: () => dispatch({ type: 'close', id: menu.id }) },
        {
          label: 'Close other tabs',
          disabled: tabs.length < 2,
          run: () => dispatch({ type: 'close-tabs', pane, id: menu.id, range: 'others' }),
        },
        {
          label: 'Close tabs to the right',
          disabled: index === tabs.length - 1,
          run: () => dispatch({ type: 'close-tabs', pane, id: menu.id, range: 'right' }),
        },
        {
          label: 'Close tabs to the left',
          disabled: index === 0,
          run: () => dispatch({ type: 'close-tabs', pane, id: menu.id, range: 'left' }),
        },
        {
          label: 'Close all tabs in this pane',
          run: () => dispatch({ type: 'close-tabs', pane, id: menu.id, range: 'all' }),
        },
        {
          label: 'Reopen closed tab',
          disabled: !workspace.closedTabs.some((record) => byId.has(record.id)),
          focusActivePane: true,
          run: () => dispatch({ type: 'restore', available: [...byId.keys()] }),
        },
        {
          label: 'Move tab left',
          disabled: index === 0,
          run: () => dispatch({ type: 'place', pane, id: menu.id, index: index - 1 }),
        },
        {
          label: 'Move tab right',
          disabled: index === tabs.length - 1,
          run: () => dispatch({ type: 'place', pane, id: menu.id, index: index + 1 }),
        },
        {
          label: 'Move to other pane',
          focusActivePane: true,
          run: () => dispatch({ type: 'move', id: menu.id, pane: pane === 0 ? 1 : 0 }),
        },
      ]
    : []
  return (
    <>
      <div
        className={`tabs ${props.dragging ? 'tabs-dragging' : ''}`}
        role="tablist"
        tabIndex={-1}
        aria-label={t('Session tabs')}
        ref={bar}
        onPointerDown={(event) => {
          if (event.button === 0) return
          event.preventDefault()
          event.stopPropagation()
        }}
        onDragOver={(event) => {
          if (!props.dragging) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('.tab')]
          const at = elements.findIndex((element) => {
            const rect = element.getBoundingClientRect()
            return event.clientX < rect.left + rect.width / 2
          })
          setDropIndex(at < 0 ? tabs.length : at)
          const rect = event.currentTarget.getBoundingClientRect()
          if (event.clientX < rect.left + 35) event.currentTarget.scrollLeft -= 35
          else if (event.clientX > rect.right - 35) event.currentTarget.scrollLeft += 35
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null)
        }}
        onDrop={(event) => {
          if (!props.dragging || dropIndex === null) return
          event.preventDefault()
          const from = tabs.indexOf(props.dragging)
          dispatch({
            type: 'place',
            pane,
            id: props.dragging,
            index: dropIndex - (from >= 0 && from < dropIndex ? 1 : 0),
          })
          props.onDrag(null)
          setDropIndex(null)
        }}
      >
        {tabs.map((id, tabIndex) => {
          const session = byId.get(id)
          const machineId = session?.metadata?.machineId
          const activity = tabActivity(session, props.connected)
          const ActivityIcon = activityIcons[activity]
          const unread = props.unreadIds.has(id)
          const labels = {
            disconnected: t('disconnected'),
            loading: t('Loading…'),
            offline: t('Offline'),
            pending: `${t('Pending')} (${session?.pendingRequestsCount ?? 0})`,
            processing: t('Processing…'),
            background: t('Background tasks: {{count}}', { count: session?.backgroundTaskCount ?? 0 }),
            idle: t('Idle'),
          }
          const description = [
            labels[activity],
            ...(unread ? [t('Unread')] : []),
            ...(preview === id ? [t('Temporary preview · Double-click to keep')] : []),
            t('Double-click to locate in the session list'),
          ]
          return (
            <div
              className={`tab ${active === id ? 'active' : ''} ${preview === id ? 'preview' : ''} ${dropIndex === tabIndex ? 'drop-before' : ''}`}
              key={id}
              draggable
              onAuxClick={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                event.stopPropagation()
                dispatch({ type: 'close', id })
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData('application/x-hapi-tab', id)
                event.dataTransfer.effectAllowed = 'move'
                props.onDrag(id)
                setMenu(null)
              }}
              onDragEnd={() => props.onDrag(null)}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                rememberFocus()
                trigger.current = event.currentTarget.querySelector('[role="tab"]')
                setMenu({ id, x: event.clientX, y: event.clientY })
              }}
            >
              <button
                role="tab"
                aria-selected={active === id}
                aria-description={description.join(' · ')}
                title={[
                  getSessionTitle(session ?? ({ id } as SessionSummary)),
                  machineId ? props.machineNames.get(machineId) || machineId : undefined,
                  session?.metadata?.path,
                  ...description,
                ]
                  .filter(Boolean)
                  .join('\n')}
                onClick={() => dispatch({ type: 'open', id, pane })}
                onDoubleClick={() => {
                  dispatch({ type: 'keep-tab', id })
                  props.onLocate(id)
                }}
                onKeyDown={(event) => {
                  if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                    event.preventDefault()
                    rememberFocus()
                    trigger.current = event.currentTarget
                    const rect = event.currentTarget.getBoundingClientRect()
                    setMenu({ id, x: rect.left, y: rect.bottom })
                  }
                }}
              >
                <ActivityIcon
                  size={13}
                  className={`tab-activity ${activity}`}
                  data-status={activity}
                  aria-hidden="true"
                />
                {preview === id && <Eye size={12} className="tab-preview-icon" aria-hidden="true" />}
                <span className="tab-title">{session ? getSessionTitle(session) : id.slice(0, 8)}</span>
                {unread && <span className="tab-unread" aria-hidden="true" />}
              </button>
              <button
                className="tab-close"
                aria-label={t('Close tab')}
                onClick={() => dispatch({ type: 'close', id })}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}
        {dropIndex === tabs.length && <span className="tab-drop-end" />}
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
      {menu &&
        createPortal(
          <div
            className="tab-menu"
            role="menu"
            aria-label={t('Session tabs')}
            ref={menuRef}
            style={menuStyle}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ]
              const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              buttons[next]?.focus()
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  item.run()
                  closeMenu(item.focusActivePane)
                }}
              >
                {t(item.label)}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}
