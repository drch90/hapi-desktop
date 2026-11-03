import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Session } from '@hapi/protocol'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { SelectControl } from '@/components/ui/select-control'
import { Button } from '@/components/ui/button'
import { HermesModelPicker } from '@/components/HermesModelPicker'
import type { ModelOption } from '@/components/AssistantChat/modelOptions'
import { createApi, errorKey } from '../lib/api'
import { refreshSessions } from '../lib/sync'
import { groupModelOptions } from './agent-settings/modelOptions'
import { useSessionSettings, type SessionSettingField } from './agent-settings/useSessionSettings'

function SettingSelect(props: {
  label: string
  value: string | null | undefined
  options: ModelOption[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const value = props.value ?? ''
  return (
    <label>
      {props.label}
      <SelectControl
        value={value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {!props.options.some((option) => (option.value ?? '') === value) && (
          <option value={value} disabled>
            {value || t('Default')}
          </option>
        )}
        {groupModelOptions(props.options).map(([group, options]) => {
          const rows = options.map((option) => (
            <option key={option.value ?? ''} value={option.value ?? ''}>
              {t(option.label, { defaultValue: option.label })}
            </option>
          ))
          return group ? (
            <optgroup key={group} label={group}>
              {rows}
            </optgroup>
          ) : (
            rows
          )
        })}
      </SelectControl>
    </label>
  )
}

export function SessionConfiguration(props: {
  scope: string
  session: Session
  connected: boolean
  onClose: () => void
  refresh: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const { session } = props
  const api = useMemo(() => createApi(props.scope), [props.scope])
  const config = useSessionSettings(api, session, props.connected)
  const { flavor, catalogs, editable } = config
  const [pending, setPending] = useState(false)
  const saving = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [error, setError] = useState('')

  async function change(field: SessionSettingField, value: string) {
    if (!editable || saving.current) return
    saving.current = true
    setPending(true)
    setError('')
    try {
      if (await config.apply(field, value)) {
        // Values remain server-confirmed, including changes from other clients.
        await props.refresh()
        refreshSessions()
      }
    } catch (cause) {
      if (mounted.current) setError(errorKey(cause))
    } finally {
      saving.current = false
      if (mounted.current) setPending(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent className="session-configuration">
        <DialogHeader>
          <DialogTitle>{t('Session settings')}</DialogTitle>
          <DialogDescription>{t('Changes apply to this remote session.')}</DialogDescription>
        </DialogHeader>
        {!editable && (
          <p className="muted">
            {t(
              !config.supported
                ? 'Settings are unavailable for this agent.'
                : !props.connected
                  ? 'Connection failed. Check the Hub address and network.'
                  : !session.active
                    ? 'Resume this session to change settings.'
                    : config.waitingForTurn
                      ? 'Wait for the current turn to finish before changing settings.'
                      : 'This session is controlled by the terminal.',
            )}
          </p>
        )}
        {config.modes.length > 0 && (
          <SettingSelect
            label={t('Mode')}
            value={session.collaborationMode ?? 'default'}
            options={config.modes.map((option) => ({ value: option.mode, label: option.label }))}
            disabled={!editable || pending}
            onChange={(value) => void change('mode', value)}
          />
        )}
        {config.copilotModes.length > 0 && (
          <SettingSelect
            label={t('Copilot agent mode')}
            value={session.copilotAgentMode ?? 'interactive'}
            options={config.copilotModes.map((option) => ({ value: option.mode, label: option.label }))}
            disabled={!editable || pending}
            onChange={(value) => void change('copilotMode', value)}
          />
        )}
        {config.managedPermission ? (
          <p className="muted" data-testid="permission-managed">
            {t('Permissions are managed by this CLI.')}
          </p>
        ) : (
          <SettingSelect
            label={t('Permission mode')}
            value={session.permissionMode ?? 'default'}
            options={config.permissions.map((option) => ({ value: option.mode, label: option.label }))}
            disabled={!editable || pending || !config.permissions.length}
            onChange={(value) => void change('permission', value)}
          />
        )}
        {flavor === 'hermes' ? (
          <section aria-label={t('Model')}>
            <HermesModelPicker
              models={catalogs.hermes.availableModels}
              value={session.model}
              onChange={(value) => void change('model', value)}
              isLoading={catalogs.hermes.isLoading}
              error={
                error
                  ? t(error)
                  : catalogs.hermes.error
                    ? t('Unable to load session options. Use Refresh to retry.')
                    : null
              }
              disabled={!editable || pending}
              onRefresh={() => {
                setError('')
                catalogs.refetch()
              }}
            />
          </section>
        ) : (
          <SettingSelect
            label={t('Model')}
            value={config.modelValue}
            options={config.modelOptions}
            disabled={pending || config.modelsDisabled}
            onChange={(value) => void change('model', value)}
          />
        )}
        {config.effortOptions.length > 0 && (
          <SettingSelect
            label={t('Reasoning effort')}
            value={config.effort === 'default' || config.effort === 'auto' ? '' : config.effort}
            options={config.effortOptions}
            disabled={pending || config.effortDisabled}
            onChange={(value) => void change('effort', value)}
          />
        )}
        {config.fastMode && (
          <SettingSelect
            label={t('Fast mode')}
            value={session.serviceTier ?? 'standard'}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'fast', label: 'Fast' },
            ]}
            disabled={!editable || pending}
            onChange={(value) => void change('tier', value)}
          />
        )}
        {editable && flavor !== 'hermes' && catalogs.isLoading && (
          <p className="muted" role="status">
            {t('Loading…')}
          </p>
        )}
        {editable &&
          flavor !== 'hermes' &&
          (catalogs.error || (flavor === 'agy' && catalogs.agy.warning)) && (
            <div>
              <p className={catalogs.error ? 'error' : 'muted'} role={catalogs.error ? 'alert' : 'status'}>
                {t(
                  catalogs.error
                    ? 'Unable to load session options. Use Refresh to retry.'
                    : 'The last model check failed. Showing the cached list.',
                )}
              </p>
              <Button size="sm" variant="outline" disabled={pending} onClick={catalogs.refetch}>
                {t('Refresh')}
              </Button>
            </div>
          )}
        {error && flavor !== 'hermes' && (
          <p className="error" role="alert">
            {t(error)}
          </p>
        )}
        <footer>
          <span role="status">{pending ? t('Saving…') : ''}</span>
          <Button variant="outline" onClick={props.onClose}>
            {t('Close')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
