import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Folder, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function SessionWorkspaceGroup(props: {
  machine: string
  path: string
  count: number
  collapsed: boolean
  collapsible: boolean
  showHeading: boolean
  filtering: boolean
  historyOnly: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const id = useId()
  const heading = (
    <span className="workspace-group-label">
      {!props.historyOnly && (
        <span className="group-machine">
          <Server size={12} />
          {props.machine}
        </span>
      )}
      <span className="group-path" title={props.path}>
        <Folder size={12} />
        <span>{props.path}</span>
      </span>
    </span>
  )
  return (
    <section className="session-group">
      {props.showHeading &&
        (props.collapsible ? (
          <Button
            variant="secondary"
            className="workspace-group-toggle"
            aria-label={`${t(props.collapsed ? 'Expand workspace' : 'Collapse workspace')}: ${props.historyOnly ? '' : props.machine + ' '}${props.path}`}
            aria-expanded={!props.collapsed}
            aria-controls={id}
            disabled={props.filtering}
            onClick={props.onToggle}
          >
            <ChevronDown size={13} className={props.collapsed ? 'collapsed' : ''} />
            {heading}
            <span className="workspace-group-count">{props.count}</span>
          </Button>
        ) : (
          heading
        ))}
      <div id={id} hidden={props.collapsed}>
        {props.children}
      </div>
    </section>
  )
}
