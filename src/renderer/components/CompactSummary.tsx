import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AgentEvent } from '@/chat/types'
import { getEventPresentation } from '@/chat/presentation'
import { formatTokenDelta } from '@/components/AssistantChat/messages/SystemMessage'
import { MarkdownRenderer } from './Markdown'

export function CompactSummary({ event }: { event: AgentEvent }) {
  // Match Web: returning to a session collapses reports instead of restoring a draft preference.
  const [expanded, setExpanded] = useState(false)
  const summaryId = useId()
  if (event.type !== 'compact-summary') return null
  const summary = typeof event.summary === 'string' ? event.summary : ''
  const hasSummary = summary.trim().length > 0
  const title = getEventPresentation(event).text
  const delta = formatTokenDelta(event)

  return (
    <div className="event-message">
      {hasSummary ? (
        <button
          type="button"
          className="disclosure"
          aria-expanded={expanded}
          aria-controls={expanded ? summaryId : undefined}
          onClick={() => setExpanded((value) => !value)}
        >
          {title}
          <ChevronRight size={12} className="disclosure-chevron" aria-hidden="true" />
        </button>
      ) : (
        <MarkdownRenderer content={title} />
      )}
      {delta && <p className="small muted">{delta}</p>}
      {hasSummary && expanded && (
        <div id={summaryId}>
          <MarkdownRenderer content={summary} />
        </div>
      )}
    </div>
  )
}
