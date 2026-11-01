import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { SendAttempt } from '../lib/outbox'

type SendRecoveryNoticeProps = {
  attempt: SendAttempt | null
  error: string
  disabled: boolean
  onCheck: () => void
  onRetry: () => void
  onCancel: () => void
  onResume?: () => void
}

export function SendRecoveryNotice({
  attempt,
  error,
  disabled,
  onCheck,
  onRetry,
  onCancel,
  onResume,
}: SendRecoveryNoticeProps) {
  const { t } = useTranslation()
  if (!attempt && !error) return null
  return (
    <div className="send-alert" role="status">
      <span>{t(error || 'Delivery is unconfirmed. Check before sending again.')}</span>
      {attempt && (
        <div className="inline-actions">
          <Button variant="outline" size="sm" disabled={disabled} onClick={onCheck}>
            {t('Check delivery')}
          </Button>
          <Button variant="outline" size="sm" disabled={disabled} onClick={onCancel}>
            {t('Cancel sending')}
          </Button>
          {onResume && (
            <Button variant="outline" size="sm" disabled={disabled} onClick={onResume}>
              {t('Resume')}
            </Button>
          )}
          {attempt.status === 'absent' && (
            <Button variant="outline" size="sm" disabled={disabled} onClick={onRetry}>
              {t('Retry sending')}
            </Button>
          )}
        </div>
      )}
      {attempt?.text && <p className="queue-text">{attempt.text}</p>}
    </div>
  )
}
