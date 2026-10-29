import { memo, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, LoaderCircle } from 'lucide-react'
import type { ToolCallBlock } from '@/chat/types'
import type { SessionMetadataSummary } from '@/types/api'
import { ToolCard, ToolDetailDialogContent, getToolTimingDetails } from '@/components/ToolCard/ToolCard'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { useTranslation as useHapiTranslation } from '@/lib/use-translation'
import { formatDuration } from '@/chat/presentation'
import { api } from '../lib/api'
import { INLINE_PLAN_TOOLS } from '../lib/article-transcript'
import { ToolExecutionTimes } from './ToolExecutionTimes'

export const ToolMessage = memo(function ToolMessage({
  block,
  sessionId,
  metadata,
  disabled,
  done,
  expanded,
  onToggle,
}: {
  block: ToolCallBlock
  sessionId?: string
  metadata: SessionMetadataSummary | null
  disabled: boolean
  done: () => void
  expanded: boolean
  onToggle: (id: string) => void
}) {
  const { t } = useTranslation()
  const { t: web } = useHapiTranslation()
  const detailsId = useId()
  const [now, setNow] = useState(Date.now)
  const isRunning = block.tool.state === 'running'
  useEffect(() => {
    if (!isRunning) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [isRunning, block.tool.startedAt])
  const timing = getToolTimingDetails(block.tool, now)
  const presentation = getToolPresentation(
    {
      toolName: block.tool.name,
      input: block.tool.input,
      result: block.tool.result,
      childrenCount: block.children.length,
      description: block.tool.nativeTitle ?? block.tool.description,
      metadata,
    },
    web,
  )
  const status = t(
    isRunning
      ? 'Working…'
      : block.tool.state === 'completed'
        ? 'Task completed'
        : block.tool.state === 'error'
          ? 'Task failed'
          : 'Pending',
  )
  const tooltip = [
    presentation.title,
    presentation.subtitle,
    block.tool.name,
    status,
    timing.startedAt != null ? `${t('Start time')}: ${new Date(timing.startedAt).toLocaleString()}` : null,
    timing.completedAt != null ? `${t('End time')}: ${new Date(timing.completedAt).toLocaleString()}` : null,
    timing.durationMs != null ? `${t('Elapsed')}: ${formatDuration(timing.durationMs)}` : null,
  ]
    .filter(Boolean)
    .join('\n')
  const isPlan = INLINE_PLAN_TOOLS.has(block.tool.name)

  return (
    <div className={`message-tool${isPlan ? ' tool-plan' : ''}`} data-state={block.tool.state}>
      {!isPlan && (
        <button
          type="button"
          className="disclosure tool-disclosure"
          onClick={() => onToggle(block.id)}
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          title={tooltip}
        >
          <span className="tool-icon" aria-hidden="true">
            {isRunning ? <LoaderCircle className="tool-running-icon" size={14} /> : presentation.icon}
          </span>
          <span className="tool-operation">
            <span>{presentation.title}</span>
            {presentation.subtitle && (
              <>
                {' '}
                <small>{presentation.subtitle}</small>
              </>
            )}
          </span>
          {block.tool.state !== 'completed' && <span className="tool-state">{status}</span>}
          <ChevronRight size={12} className="disclosure-chevron" aria-hidden="true" />
        </button>
      )}
      {(isPlan || expanded) && (
        <div className="tool-expanded-details" id={detailsId}>
          {isPlan && sessionId ? (
            <>
              <ToolCard
                api={api}
                sessionId={sessionId}
                metadata={metadata}
                terminalToolDisplayMode="detailed"
                disabled={disabled}
                onDone={done}
                block={block}
              />
              <ToolExecutionTimes tool={block.tool} />
            </>
          ) : (
            <div className="tool-inline-details">
              <ToolDetailDialogContent block={block} metadata={metadata} />
            </div>
          )}
        </div>
      )}
    </div>
  )
})
