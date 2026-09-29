import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getPermissionModeOptionsForFlavor,
  getCodexCollaborationModeOptions,
  type CodexCollaborationMode,
  type PermissionMode,
  type Session,
} from '@hapi/protocol'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { SelectControl } from '@/components/ui/select-control'
import { Button } from '@/components/ui/button'
import { HermesModelPicker } from '@/components/HermesModelPicker'
import { useHermesModels } from '@/hooks/queries/useHermesModels'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { useOpencodeModels } from '@/hooks/queries/useOpencodeModels'
import { useOpencodeReasoningEffortOptions } from '@/hooks/queries/useOpencodeReasoningEffortOptions'
import { getModelOptionsForFlavor } from '@/components/AssistantChat/modelOptions'
import { getClaudeComposerEffortOptions } from '@/components/AssistantChat/claudeEffortOptions'
import { getCodexComposerReasoningEffortOptions } from '@/components/AssistantChat/codexReasoningEffortOptions'
import { getCodexModelReasoningEfforts } from '@/lib/codexModelCapabilities'
import { queryKeys } from '@/lib/query-keys'
import { api, errorKey } from '../lib/api'
import { queries, refreshSessions } from '../lib/sync'

export function SessionConfiguration(props: {
  session: Session
  connected: boolean
  onClose: () => void
  refresh: () => Promise<unknown>
}) {
  const { t } = useTranslation()
  const { session } = props
  const flavor = session.metadata?.flavor
  const supported = flavor === 'codex' || flavor === 'claude' || flavor === 'opencode' || flavor === 'hermes'
  const controlled =
    session.agentState?.controlledByUser === true && !session.metadata?.capabilities?.concurrentClients
  const waitingForTurn = flavor === 'hermes' && session.thinking
  const editable = supported && props.connected && session.active && !controlled && !waitingForTurn
  const [pending, setPending] = useState(false)
  const saving = useRef(false)
  const [error, setError] = useState('')
  const hermes = useHermesModels({
    api,
    sessionId: session.id,
    model: session.model,
    enabled: flavor === 'hermes' && props.connected && session.active,
  })
  const codex = useCodexModels({
    api,
    sessionId: session.id,
    machineId: session.metadata?.machineId,
    enabled: editable && flavor === 'codex',
  })
  const opencode = useOpencodeModels({
    api,
    sessionId: session.id,
    enabled: editable && flavor === 'opencode',
  })
  const opencodeEffort = useOpencodeReasoningEffortOptions({
    api,
    sessionId: session.id,
    enabled: editable && flavor === 'opencode',
    sessionModel: session.model,
  })
  // Model switches may originate in another client. Drop the old model's
  // catalog and let the upstream hook wait for the CLI's confirmed model.
  useEffect(() => {
    if (flavor === 'opencode' && editable) {
      void queries.resetQueries({
        queryKey: queryKeys.sessionOpencodeReasoningEffortOptions(session.id),
        exact: true,
      })
    }
  }, [flavor, session.id, session.model, editable])
  const permissions = supported
    ? getPermissionModeOptionsForFlavor(flavor).filter(
        (option) => !session.metadata?.capabilities?.concurrentClients || option.mode !== 'safe-yolo',
      )
    : []
  const catalog =
    flavor === 'codex' ? codex : flavor === 'opencode' ? opencode : flavor === 'hermes' ? hermes : null
  const modes = flavor === 'codex' ? getCodexCollaborationModeOptions() : []
  const modelOptions = !supported
    ? []
    : (flavor === 'codex' && !codex.models.length) ||
        ((flavor === 'opencode' || flavor === 'hermes') &&
          !(flavor === 'hermes' ? hermes : opencode).availableModels.length)
      ? [{ value: session.model ?? null, label: session.model || 'Default' }]
      : getModelOptionsForFlavor(
          flavor,
          session.model,
          flavor === 'codex'
            ? codex.models.map((model) => ({ value: model.id, label: model.displayName }))
            : flavor === 'opencode' || flavor === 'hermes'
              ? (flavor === 'hermes' ? hermes : opencode).availableModels.map((model) => ({
                  value: model.modelId,
                  label: model.name ?? model.modelId,
                }))
              : undefined,
        )
  const effort = flavor === 'claude' ? session.effort : session.modelReasoningEffort
  const effortOptions =
    flavor === 'claude'
      ? getClaudeComposerEffortOptions(effort)
      : flavor === 'codex' || flavor === 'opencode'
        ? getCodexComposerReasoningEffortOptions(
            effort,
            flavor,
            flavor === 'codex'
              ? getCodexModelReasoningEfforts(codex.models, session.model)?.map((value) => ({ value }))
              : opencodeEffort.options,
          )
        : []
  const catalogReady =
    flavor === 'claude' ||
    (flavor === 'codex'
      ? codex.models.length > 0
      : (flavor === 'hermes' ? hermes : opencode).availableModels.length > 0)
  const modelsDisabled =
    !editable || pending || !catalogReady || Boolean(catalog?.error) || Boolean(catalog?.isLoading)
  const effortDisabled =
    !editable ||
    pending ||
    !effortOptions.length ||
    (flavor === 'opencode' && (opencodeEffort.isLoading || Boolean(opencodeEffort.error)))

  async function change(field: 'mode' | 'permission' | 'model' | 'effort', value: string) {
    if (!editable || saving.current) return
    if (field === 'mode' && !modes.some((option) => option.mode === value)) return
    if (field === 'permission' && !permissions.some((option) => option.mode === value)) return
    if (
      field === 'model' &&
      (modelsDisabled || !modelOptions.some((option) => (option.value ?? '') === value))
    )
      return
    if (
      field === 'effort' &&
      (effortDisabled || !effortOptions.some((option) => (option.value ?? '') === value))
    )
      return
    saving.current = true
    setPending(true)
    setError('')
    try {
      if (field === 'mode') await api.setCollaborationMode(session.id, value as CodexCollaborationMode)
      else if (field === 'permission') await api.setPermissionMode(session.id, value as PermissionMode)
      else if (field === 'model') await api.setModel(session.id, value || null)
      else if (flavor === 'claude') await api.setEffort(session.id, value || null)
      else await api.setModelReasoningEffort(session.id, value || null)
      // Keep the selected values server-confirmed, including failures and SSE
      // changes from the web client. No browser-only configuration state.
      await props.refresh()
      refreshSessions()
    } catch (cause) {
      setError(errorKey(cause))
    } finally {
      saving.current = false
      setPending(false)
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
              !supported
                ? 'Settings are unavailable for this agent.'
                : !props.connected
                  ? 'Connection failed. Check the Hub address and network.'
                  : !session.active
                    ? 'Resume this session to change settings.'
                    : waitingForTurn
                      ? 'Wait for the current turn to finish before changing settings.'
                      : 'This session is controlled by the terminal.',
            )}
          </p>
        )}
        {modes.length > 0 && (
          <label>
            {t('Mode')}
            <SelectControl
              value={session.collaborationMode ?? 'default'}
              disabled={!editable || pending}
              onChange={(event) => void change('mode', event.target.value)}
            >
              {modes.map((option) => (
                <option key={option.mode} value={option.mode}>
                  {t(option.label)}
                </option>
              ))}
            </SelectControl>
          </label>
        )}
        <label>
          {t('Permission mode')}
          <SelectControl
            value={session.permissionMode ?? 'default'}
            disabled={!editable || pending || !permissions.length}
            onChange={(event) => void change('permission', event.target.value)}
          >
            {!permissions.some((option) => option.mode === (session.permissionMode ?? 'default')) && (
              <option value={session.permissionMode ?? 'default'}>
                {session.permissionMode ?? t('Default')}
              </option>
            )}
            {permissions.map((option) => (
              <option key={option.mode} value={option.mode}>
                {t(option.label)}
              </option>
            ))}
          </SelectControl>
        </label>
        {flavor === 'hermes' ? (
          <section aria-label={t('Model')}>
            <HermesModelPicker
              models={hermes.availableModels}
              value={session.model}
              onChange={(value) => void change('model', value)}
              isLoading={hermes.isLoading}
              error={
                error
                  ? t(error)
                  : hermes.error
                    ? t('Unable to load session options. Use Refresh to retry.')
                    : null
              }
              disabled={!editable || pending}
              onRefresh={() => {
                setError('')
                hermes.refetch()
              }}
            />
          </section>
        ) : (
          <label>
            {t('Model')}
            <SelectControl
              value={session.model === 'default' || session.model === 'auto' ? '' : (session.model ?? '')}
              disabled={modelsDisabled}
              onChange={(event) => void change('model', event.target.value)}
            >
              {!modelOptions.some((option) => option.value === null) && (
                <option value="" disabled>
                  {t('Default')}
                </option>
              )}
              {modelOptions.map((option) => (
                <option key={option.value ?? ''} value={option.value ?? ''}>
                  {t(option.label, { defaultValue: option.label })}
                </option>
              ))}
            </SelectControl>
          </label>
        )}
        {flavor !== 'hermes' && (
          <label>
            {t('Reasoning effort')}
            <SelectControl
              value={effort === 'default' || effort === 'auto' ? '' : (effort ?? '')}
              disabled={effortDisabled}
              onChange={(event) => void change('effort', event.target.value)}
            >
              {!effortOptions.length && <option value={effort ?? ''}>{effort || t('Not available')}</option>}
              {effortOptions.map((option) => (
                <option key={option.value ?? ''} value={option.value ?? ''}>
                  {t(option.label, { defaultValue: option.label })}
                </option>
              ))}
            </SelectControl>
          </label>
        )}
        {editable && flavor !== 'hermes' && (catalog?.isLoading || opencodeEffort.isLoading) && (
          <p className="muted" role="status">
            {t('Loading…')}
          </p>
        )}
        {editable && flavor !== 'hermes' && (catalog?.error || opencodeEffort.error) && (
          <div>
            <p className="error" role="alert">
              {t('Unable to load session options. Use Refresh to retry.')}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const keys =
                  flavor === 'codex'
                    ? [
                        queryKeys.machineCodexModels(session.metadata?.machineId ?? 'unknown'),
                        queryKeys.sessionCodexModels(session.id),
                      ]
                    : [
                        queryKeys.sessionOpencodeModels(session.id),
                        queryKeys.sessionOpencodeReasoningEffortOptions(session.id),
                      ]
                void Promise.all(keys.map((queryKey) => queries.resetQueries({ queryKey, exact: true })))
              }}
            >
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
