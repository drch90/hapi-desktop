import { useTranslation } from 'react-i18next'
import type { AgentEvent } from '@/chat/types'
import { CodeBlock } from './CodeBlock'

/** These Hub events have no message field, so the generic event row would hide them. */
export function ModelErrorEvent({ event }: { event: AgentEvent }) {
  const { t } = useTranslation()
  if (event.type !== 'modelError' && event.type !== 'modelErrorBridged') return null
  const kind = typeof event.kind === 'string' ? event.kind : t('Unknown')
  let label = t('Model error: {{kind}}', { kind })
  if (event.type === 'modelErrorBridged') {
    label = t('HAPI re-sent the last message after a model error ({{kind}}).', { kind })
  } else if (event.transient === true) {
    label = t('Temporary model error: {{kind}}', { kind })
  }
  return (
    <div className={`event-message model-error-event${event.type === 'modelError' ? ' error' : ''}`}>
      <p>{label}</p>
      {event.type === 'modelError' && typeof event.rawSnippet === 'string' && event.rawSnippet && (
        <details>
          <summary>{t('Error details')}</summary>
          <CodeBlock code={event.rawSnippet} language="text" scrollY />
        </details>
      )}
    </div>
  )
}
