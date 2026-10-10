import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Copy, Folder, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
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
  children: ReactNode
}) {
  const { t } = useTranslation()
  const id = useId()
  const { copied, copy } = useCopyToClipboard()
  const [copyFailed, setCopyFailed] = useState(false)
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
        <div className="workspace-group-heading">
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
    </section>
  )
}
