import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Copy, Folder, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useAnchoredMenu } from '@/hooks/useAnchoredMenu'
import { basename } from '@/utils/path'

export function SessionWorkspaceGroup(props: {
  machine: string
  path: string
  count: number
  collapsed: boolean
  collapsible: boolean
  showHeading: boolean
  filtering: boolean
  hasDirectory: boolean
  canCreate: boolean
  onNewSession: () => void
  onToggle: () => void
  onSetAllCollapsed: (collapsed: boolean) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const id = useId()
  const { copied, copy } = useCopyToClipboard()
  const [copyFailed, setCopyFailed] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const headingRef = useRef<HTMLDivElement>(null)
  const closeMenu = () => {
    const element = menuRef.current
    setMenu(null)
    requestAnimationFrame(() => {
      const focused = document.activeElement
      if (focused && focused !== document.body && !element?.contains(focused)) return
      if (previousFocus.current?.isConnected && previousFocus.current !== document.body)
        previousFocus.current.focus()
      else headingRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
  }
  const { menuRef, menuStyle } = useAnchoredMenu({
    isOpen: Boolean(menu),
    onClose: closeMenu,
    anchorPoint: menu ?? { x: 0, y: 0 },
    align: 'start',
  })
  const openMenu = (point: { x: number; y: number }) => {
    if (!props.collapsible) return
    if (document.activeElement instanceof HTMLElement) previousFocus.current = document.activeElement
    setMenu(point)
  }
  useEffect(() => {
    if (!menu || !props.filtering) return
    const frame = requestAnimationFrame(() => menuRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [Boolean(menu), props.filtering])
  const heading = (
    <span className="workspace-group-label">
      <span className="workspace-group-title">
        <span className="group-name" title={props.path}>
          <Folder size={13} />
          <span>{basename(props.path)}</span>
        </span>
        <span className="group-machine" title={props.machine}>
          <Server size={12} />
          <span>{props.machine}</span>
        </span>
      </span>
      <span className="group-path" title={props.path}>
        {props.path}
      </span>
    </span>
  )
  return (
    <section className="session-group">
      {props.showHeading && (
        <div
          className="workspace-group-heading"
          ref={headingRef}
          onPointerDown={(event) => {
            if (event.button !== 0) event.preventDefault()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            openMenu({ x: event.clientX, y: event.clientY })
          }}
          onKeyDown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              event.preventDefault()
              const rect = event.currentTarget.getBoundingClientRect()
              openMenu({ x: rect.left, y: rect.bottom })
            }
          }}
        >
          {props.collapsible ? (
            <Button
              variant="secondary"
              className="workspace-group-toggle"
              aria-label={`${t(props.collapsed ? 'Expand workspace' : 'Collapse workspace')}: ${props.machine} ${props.path}`}
              aria-expanded={!props.collapsed}
              aria-controls={id}
              disabled={props.filtering}
              onClick={props.onToggle}
            >
              <ChevronDown size={13} className={props.collapsed ? 'collapsed' : ''} />
              {heading}
            </Button>
          ) : (
            heading
          )}
          {props.hasDirectory && (
            <div className="workspace-group-actions">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`${t(copied && !copyFailed ? 'Copied' : 'Copy path')}: ${props.path}`}
                title={`${t(copyFailed ? 'Copy failed' : copied ? 'Copied' : 'Copy path')}: ${props.path}`}
                onClick={async () => setCopyFailed(!(await copy(props.path)))}
              >
                {copied && !copyFailed ? <Check size={13} /> : <Copy size={13} />}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label={`${t('New session in this directory')}: ${props.path}`}
                title={t(
                  props.canCreate
                    ? 'New session in this directory'
                    : 'Machine unavailable. Select an online machine.',
                )}
                disabled={!props.canCreate}
                onClick={props.onNewSession}
              >
                <Plus size={14} />
              </Button>
            </div>
          )}
          <span className="workspace-group-count">{props.count}</span>
        </div>
      )}
      {copyFailed && (
        <p role="alert" className="error small">
          {t('Copy failed')}
        </p>
      )}
      <div id={id} hidden={props.collapsed}>
        {props.children}
      </div>
      {menu &&
        createPortal(
          <div
            className="tab-menu workspace-group-menu"
            role="menu"
            tabIndex={-1}
            aria-label={t('Workspace groups')}
            ref={menuRef}
            style={menuStyle}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                closeMenu()
                return
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ]
              if (!buttons.length) return
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
            {[
              { label: 'Expand all groups', collapsed: false },
              { label: 'Collapse all groups', collapsed: true },
            ].map((item) => (
              <button
                key={item.label}
                role="menuitem"
                disabled={props.filtering}
                onClick={() => {
                  props.onSetAllCollapsed(item.collapsed)
                  closeMenu()
                }}
              >
                {t(item.label)}
              </button>
            ))}
            {props.filtering && (
              <p className="workspace-group-menu-hint">{t('Clear search to expand or collapse groups.')}</p>
            )}
          </div>,
          document.body,
        )}
    </section>
  )
}
