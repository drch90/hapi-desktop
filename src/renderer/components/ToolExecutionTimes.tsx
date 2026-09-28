import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChatToolCall } from '@/chat/types'
import { getToolTimingDetails } from '@/components/ToolCard/ToolCard'
import { formatDuration } from '@/chat/presentation'

export function ToolExecutionTimes({ tool }: { tool: ChatToolCall }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (tool.state !== 'running') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [tool.state, tool.startedAt])
  const timing = getToolTimingDetails(tool, now)
  return (
    <div className="tool-execution-times" data-testid="tool-execution-times">
      <span>
        <b>{t('Start time')}</b>
        <time
          dateTime={timing.startedAt != null ? new Date(timing.startedAt).toISOString() : undefined}
          title={timing.startedAt != null ? new Date(timing.startedAt).toLocaleString() : undefined}
        >
          {timing.startedAt != null
            ? new Date(timing.startedAt).toLocaleTimeString(undefined, { hour12: false })
            : '—'}
        </time>
      </span>
      <span>
        <b>{t('End time')}</b>
        <time
          dateTime={timing.completedAt != null ? new Date(timing.completedAt).toISOString() : undefined}
          title={timing.completedAt != null ? new Date(timing.completedAt).toLocaleString() : undefined}
        >
          {timing.completedAt != null
            ? new Date(timing.completedAt).toLocaleTimeString(undefined, { hour12: false })
            : tool.state === 'running'
              ? t('Working…')
              : '—'}
        </time>
      </span>
      <span>
        <b>{t('Elapsed')}</b>
        <span>{timing.durationMs != null ? formatDuration(timing.durationMs) : '—'}</span>
      </span>
    </div>
  )
}
