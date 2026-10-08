import { useTranslation } from 'react-i18next'
import { computePendingRequestsCount, type Session } from '@hapi/protocol'

export function ComposerStatus({ session, connected }: { session?: Session; connected: boolean }) {
  // Keep Web's priority: offline, pending requests, foreground work, background
  // work, then idle. Hub connectivity takes precedence over cached session data.
  const { t } = useTranslation()
  const state = !connected
    ? 'disconnected'
    : !session
      ? 'loading'
      : !session.active
        ? 'offline'
        : computePendingRequestsCount(session.agentState) > 0
          ? 'attention'
          : session.thinking
            ? 'processing'
            : (session.backgroundTaskCount ?? 0) > 0
              ? 'background'
              : 'idle'
  const labels = {
    disconnected: t('disconnected'),
    loading: t('Loading…'),
    offline: t('Offline'),
    attention: t('Pending'),
    processing: t('Processing…'),
    background: t('Background tasks: {{count}}', { count: session?.backgroundTaskCount ?? 0 }),
    idle: t('Idle'),
  }
  return (
    <span
      className={`composer-status ${state}`}
      role="status"
      aria-label={t('Session activity')}
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="composer-status-dot" aria-hidden="true" />
      <span>{labels[state]}</span>
    </span>
  )
}
