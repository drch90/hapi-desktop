import { memo } from 'react'
import { useDocumentVisibility } from '@/hooks/useDocumentVisibility'
import { useMinuteTick } from '@/hooks/useMinuteTick'
import { formatAbsoluteDateTime, formatRelativeTime } from '@/lib/relativeTime'
import { useTranslation } from '@/lib/use-translation'

export const SessionActivityTime = memo(function SessionActivityTime({ updatedAt }: { updatedAt: number }) {
  const { t } = useTranslation()
  const visible = useDocumentVisibility()
  const date = new Date(updatedAt < 1_000_000_000_000 ? updatedAt * 1000 : updatedAt)
  const valid = Number.isFinite(date.getTime())
  // Tick only this label, not the session list or its open conversations.
  useMinuteTick(visible && valid)
  if (!valid) return null

  return (
    <time
      className="session-activity-time"
      dateTime={date.toISOString()}
      title={formatAbsoluteDateTime(updatedAt) ?? undefined}
    >
      {formatRelativeTime(updatedAt, t)}
    </time>
  )
})
