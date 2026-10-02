import * as Popover from '@radix-ui/react-popover'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTranslation as useHapiTranslation } from '@/lib/use-translation'
import { AppContextProvider } from '@/lib/app-context'
import SettingsUsagePage from '@/routes/settings/usage'
import { getContextBudgetTokens } from '@/chat/modelConfig'
import {
  formatContextUsageLabel,
  getContextUsageDetails,
  getContextWarning,
} from '@/components/AssistantChat/StatusBar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { queries } from '../lib/sync'
import { createApi } from '../lib/api'

export function UsageDialog({ scope, close }: { scope: string; close: () => void }) {
  const { t } = useTranslation()
  const value = useMemo(() => ({ api: createApi(scope), token: '', baseUrl: '' }), [scope])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent className="desktop-dialog usage-dialog">
        <DialogHeader>
          <DialogTitle>{t('Usage statistics')}</DialogTitle>
        </DialogHeader>
        <Button
          variant="outline"
          onClick={() =>
            void queries.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'usage-summary' })
          }
        >
          {t('Refresh')}
        </Button>
        <div className="usage-content">
          <AppContextProvider value={value}>
            <SettingsUsagePage />
          </AppContextProvider>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ContextUsage(props: {
  size?: number
  window?: number | null
  cacheRead?: number
  model?: string | null
  flavor?: string | null
}) {
  const { t } = useTranslation()
  const { t: h } = useHapiTranslation()
  if (props.size === undefined || !Number.isFinite(props.size))
    return (
      <span className="small muted" title={t('Context usage is not available yet.')}>
        {t('Context')}: —
      </span>
    )
  const limit = props.window ?? getContextBudgetTokens(props.model, props.flavor)
  const details = getContextUsageDetails(props.size, limit, props.cacheRead)
  const label = formatContextUsageLabel(props.size, limit)
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className={`context-usage ${limit ? getContextWarning(props.size, limit).color : ''}`}
          aria-label={`${t('Context')}: ${label}`}
        >
          {t('Context')}: {label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="context-popover" side="top" sideOffset={8} collisionPadding={12}>
          {details.cacheRead && <p>{h('misc.contextCache', { value: details.cacheRead })}</p>}
          <p>
            {details.usedPercentage === null
              ? h('misc.contextUsedTokens', { value: details.used })
              : h('misc.contextUsed', { value: details.used, percent: details.usedPercentage })}
          </p>
          {details.remaining !== null && (
            <p>
              {h('misc.contextRemaining', {
                value: details.remaining,
                percent: details.remainingPercentage ?? 0,
              })}
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
