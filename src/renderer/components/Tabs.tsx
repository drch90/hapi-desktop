import { useEffect, useRef, useState, type Dispatch } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRightLeft, X } from 'lucide-react'
import type { SessionSummary } from '@hapi/protocol'
import { getSessionTitle } from '@/lib/sessionTitle'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import type { PaneId, Workspace, WorkspaceAction } from '../lib/workspace'

export function Tabs(props: {
  pane: PaneId
  workspace: Workspace
  dispatch: Dispatch<WorkspaceAction>
  byId: Map<string, SessionSummary>
  dragging: string | null
  onDrag: (id: string | null) => void
}) {
  const { t } = useTranslation()
  const { pane, workspace, dispatch, byId } = props
  const { tabs, active } = workspace.panes[pane]
  const bar = useRef<HTMLDivElement>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const closeMenu = () => {
    setMenu(null)
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus()
      else (bar.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? bar.current)?.focus()
    })
  }
  const { menuRef, menuStyle } = useAnchoredMenu({
    isOpen: Boolean(menu),
    onClose: closeMenu,
    anchorPoint: menu ?? { x: 0, y: 0 },
    align: 'start',
  })
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
  const items: { label: string; disabled?: boolean; run: () => void }[] = menu
    ? [
        { label: 'Close tab', run: () => dispatch({ type: 'close', id: menu.id }) },
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
          if (event.button !== 0) event.stopPropagation()
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
        {tabs.map((id, tabIndex) => (
          <div
            className={`tab ${active === id ? 'active' : ''} ${dropIndex === tabIndex ? 'drop-before' : ''}`}
            key={id}
            draggable
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
              trigger.current = event.currentTarget.querySelector('[role="tab"]')
              setMenu({ id, x: event.clientX, y: event.clientY })
            }}
          >
            <button
              role="tab"
              aria-selected={active === id}
              title={getSessionTitle(byId.get(id) ?? ({ id } as SessionSummary))}
              onClick={() => dispatch({ type: 'open', id, pane })}
              onKeyDown={(event) => {
                if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                  event.preventDefault()
                  trigger.current = event.currentTarget
                  const rect = event.currentTarget.getBoundingClientRect()
                  setMenu({ id, x: rect.left, y: rect.bottom })
                }
              }}
            >
              {byId.has(id) ? getSessionTitle(byId.get(id)!) : id.slice(0, 8)}
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
                  closeMenu()
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
