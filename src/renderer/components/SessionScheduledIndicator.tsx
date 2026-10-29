import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { toIntlLocale } from '../../shared/i18n'

export const SessionScheduledIndicator = memo(function SessionScheduledIndicator({
  count,
  nextScheduledAt,
}: {
  count: number
  nextScheduledAt: number | null
}) {
  const { t, i18n } = useTranslation()
  if (count < 1) return null
  const label = t('Scheduled messages ({{count}})', { count })
  const time = nextScheduledAt == null ? null : new Date(nextScheduledAt)
  const detail =
    time && Number.isFinite(time.getTime())
      ? t('Scheduled for {{time}}', {
          time: time.toLocaleString(toIntlLocale(i18n.resolvedLanguage || 'en')),
        })
      : ''
  return (
    <span className="session-scheduled" aria-label={label} title={[label, detail].filter(Boolean).join('\n')}>
      <Clock size={13} aria-hidden="true" />
      {count > 1 && <span aria-hidden="true">{count}</span>}
    </span>
  )
})
