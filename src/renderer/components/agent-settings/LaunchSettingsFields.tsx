import { useTranslation } from 'react-i18next'
import { getCopilotAgentModeOptions } from '@hapi/protocol'
import { Button } from '@/components/ui/button'
import { HermesModelPicker } from '@/components/HermesModelPicker'
import { ModelSelector } from '@/components/NewSession/ModelSelector'
import { CollaborationModeSelector } from '@/components/NewSession/CollaborationModeSelector'
import { FastModeSelector } from '@/components/NewSession/FastModeSelector'
import type { useLaunchSettings } from './useLaunchSettings'
import { PermissionModeField } from './PermissionModeField'

export function LaunchSettingsFields({
  config,
  disabled,
}: {
  config: ReturnType<typeof useLaunchSettings>
  disabled: boolean
}) {
  const { t } = useTranslation()
  const { agent, settings, catalogs, change } = config
  const translated = (options: { value: string; label: string }[]) =>
    options.map((option) => ({
      ...option,
      label: t(option.label, { defaultValue: option.label }),
    }))
  return (
    <>
      <fieldset aria-label={t('Model')} disabled={disabled}>
        {agent === 'hermes' ? (
          <HermesModelPicker
            models={catalogs.hermes.availableModels}
            value={settings.model}
            onChange={(model) => change({ model })}
            isLoading={catalogs.hermes.isLoading}
            error={catalogs.hermes.error ? t('Unable to load session options. Use Refresh to retry.') : null}
            allowDefault
            disabled={disabled}
            onRefresh={catalogs.hermes.refetch}
          />
        ) : (
          <ModelSelector
            agent={agent}
            model={settings.model}
            options={config.modelOptions}
            isDisabled={disabled || config.modelDisabled}
            isLoading={catalogs.isLoading}
            onModelChange={(model) => change({ model, reasoning: 'default', tier: 'standard' })}
          />
        )}
      </fieldset>
      {config.showEffort && (
        <fieldset aria-label={t('Reasoning effort')} disabled={disabled}>
          <ModelSelector
            agent={agent}
            label={t('Reasoning effort')}
            model={config.reasoningAgent ? settings.reasoning : settings.effort}
            options={translated(config.effortFieldOptions)}
            onModelChange={(value) =>
              change(config.reasoningAgent ? { reasoning: value } : { effort: value })
            }
            isDisabled={disabled || config.pending || (agent === 'opencode' && config.modelDisabled)}
          />
        </fieldset>
      )}
      <fieldset aria-label={t('Permission mode')} disabled={disabled}>
        <PermissionModeField
          agent={agent}
          value={settings.permission}
          autoSupported={agent === 'grok' ? catalogs.grok.autoPermissionModeSupported : null}
          disabled={disabled}
          onChange={(permission) => change({ permission })}
        />
      </fieldset>
      {agent === 'codex' && (
        <fieldset aria-label={t('Mode')} disabled={disabled}>
          <CollaborationModeSelector
            agent={agent}
            value={settings.mode}
            isDisabled={disabled}
            onChange={(mode) => change({ mode })}
          />
        </fieldset>
      )}
      {agent === 'copilot' && (
        <fieldset aria-label={t('Copilot agent mode')} disabled={disabled}>
          <ModelSelector
            agent={agent}
            label={t('Copilot agent mode')}
            model={settings.copilotMode}
            isDisabled={disabled}
            options={getCopilotAgentModeOptions().map((option) => ({
              value: option.mode,
              label: t(option.label),
            }))}
            onModelChange={(value) => {
              const option = getCopilotAgentModeOptions().find((option) => option.mode === value)
              if (option) change({ copilotMode: option.mode })
            }}
          />
        </fieldset>
      )}
      {config.fastMode && (
        <fieldset aria-label={t('Fast mode')} disabled={disabled}>
          <FastModeSelector
            visible
            value={settings.tier}
            isDisabled={disabled}
            onChange={(tier) => change({ tier })}
          />
        </fieldset>
      )}
      {agent !== 'hermes' &&
        (catalogs.isLoading || catalogs.error || (agent === 'agy' && catalogs.agy.warning)) && (
          <div className="launch-catalog-status new-session-location">
            <p
              className={catalogs.error ? 'error small' : 'muted small'}
              role={catalogs.error ? 'alert' : 'status'}
            >
              {t(
                catalogs.isLoading
                  ? 'Loading…'
                  : catalogs.error
                    ? 'Unable to load session options. Use Refresh to retry.'
                    : 'The last model check failed. Showing the cached list.',
              )}
            </p>
            {!catalogs.isLoading && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={catalogs.refetch}
              >
                {t('Refresh')}
              </Button>
            )}
          </div>
        )}
    </>
  )
}
