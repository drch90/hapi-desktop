import { useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Folder } from 'lucide-react'
import { SessionSchema } from '@hapi/protocol/schemas'
import { type CodexCollaborationMode, type PermissionMode } from '@hapi/protocol'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MachineSelector } from '@/components/NewSession/MachineSelector'
import { PermissionField } from '@/components/NewSession/PermissionField'
import { ModelSelector } from '@/components/NewSession/ModelSelector'
import { OpencodeModelSelector } from '@/components/NewSession/OpencodeModelSelector'
import { EffortField } from '@/components/NewSession/EffortField'
import { CollaborationModeSelector } from '@/components/NewSession/CollaborationModeSelector'
import { FastModeSelector } from '@/components/NewSession/FastModeSelector'
import { SessionTypeSelector } from '@/components/NewSession/SessionTypeSelector'
import {
  type NewSessionServiceTier,
  type SessionType,
  isOpencodeReasoningEffortValid,
} from '@/components/NewSession/types'
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser'
import { useMachinePathsExists } from '@/hooks/useMachinePathsExists'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { useOpencodeModelsForCwd } from '@/hooks/queries/useOpencodeModelsForCwd'
import { useOpencodeModelVariants } from '@/hooks/queries/useOpencodeModelVariants'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { codexModelAdvertisesFastTier } from '@/components/AssistantChat/codexFastMode'
import { getCodexModelReasoningEfforts } from '@/lib/codexModelCapabilities'
import { I18nContext } from '@/lib/i18n-context'
import { api, errorKey } from '../lib/api'
import { machinesKey, queries, sessionKey } from '../lib/sync'

export function NewSessionDialog({ close, created }: { close: () => void; created: (id: string) => void }) {
  const { t } = useTranslation()
  const upstream = useContext(I18nContext)
  const machines = useQuery({
    queryKey: machinesKey,
    queryFn: async () => (await api.getMachines()).machines,
  })
  const online = machines.data?.filter((machine) => machine.active) ?? []
  const [chosenMachine, setMachine] = useState('')
  const machineId = chosenMachine || online[0]?.id || ''
  const [agent, setAgent] = useState<'claude' | 'codex' | 'opencode'>('codex')
  const [directory, setDirectory] = useState('')
  const [permission, setPermission] = useState<PermissionMode>('default')
  const [yolo, setYolo] = useState(false)
  const [model, setModel] = useState('auto')
  const [effort, setEffort] = useState('auto')
  const [reasoning, setReasoning] = useState('default')
  const [mode, setMode] = useState<CodexCollaborationMode>('default')
  const [tier, setTier] = useState<NewSessionServiceTier>('standard')
  const [sessionType, setSessionType] = useState<SessionType>('simple')
  const [worktreeName, setWorktreeName] = useState('')
  const worktreeInput = useRef<HTMLInputElement>(null)
  const [browsing, setBrowsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const { spawnSession } = useSpawnSession(api)
  const availability = useQuery({
    queryKey: ['availability', machineId],
    queryFn: () => api.getMachineAgentAvailability(machineId),
    enabled: Boolean(machineId),
  })
  const available = availability.data?.agents.some((item) => item.agent === agent && item.available) ?? false
  const cwd = useDeferredValue(directory.trim())
  const paths = useMemo(() => (cwd ? [cwd] : []), [cwd])
  const { pathExistence, outsideWorkspaceRoots } = useMachinePathsExists(api, machineId, paths)
  const discoverOpencode = agent === 'opencode' && available && pathExistence[cwd] === true
  const codex = useCodexModels({ api, machineId, enabled: agent === 'codex' && available })
  const opencode = useOpencodeModelsForCwd({ api, machineId, cwd, enabled: discoverOpencode })
  const variants = useOpencodeModelVariants({ api, machineId, cwd, enabled: discoverOpencode })
  const effectiveOpencodeModel = model === 'auto' ? opencode.currentModelId : model
  const variantOptions =
    effectiveOpencodeModel && variants.variants ? (variants.variants[effectiveOpencodeModel] ?? []) : null
  const codexEfforts = useMemo(
    () => getCodexModelReasoningEfforts(codex.models, model),
    [codex.models, model],
  )
  const fastMode =
    agent === 'codex' && codexModelAdvertisesFastTier(model === 'auto' ? null : model, codex.models)
  const optionsPending =
    agent === 'codex'
      ? codex.isLoading
      : agent === 'opencode' &&
        Boolean(cwd) &&
        (pathExistence[cwd] === undefined || opencode.isLoading || variants.isLoading)
  useEffect(() => {
    if (optionsPending || reasoning === 'default') return
    if (
      (agent === 'codex' && codexEfforts && !codexEfforts.includes(reasoning)) ||
      (agent === 'opencode' && !isOpencodeReasoningEffortValid(reasoning, variantOptions))
    )
      setReasoning('default')
  }, [agent, reasoning, optionsPending, codexEfforts, variantOptions])
  const browserLocale = useMemo(
    () =>
      upstream
        ? {
            ...upstream,
            t: (key: string, params?: Record<string, string | number>) =>
              key === 'browse.startSession' ? t('Use this folder') : upstream.t(key, params),
          }
        : upstream,
    [upstream, t],
  )

  function resetModel() {
    setModel('auto')
    setEffort('auto')
    setReasoning('default')
    setTier('standard')
  }

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !busy) close()
      }}
    >
      <DialogContent className="new-session-dialog">
        <DialogHeader>
          <DialogTitle>{t('New session')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (submitting.current || !available || !directory.trim() || optionsPending) return
            if (outsideWorkspaceRoots.has(directory.trim())) {
              setError('The directory is outside the configured workspace roots.')
              return
            }
            submitting.current = true
            setBusy(true)
            setError('')
            try {
              const response = await spawnSession({
                machineId,
                directory: directory.trim(),
                agent,
                model: model === 'auto' ? undefined : model,
                modelReasoningEffort: agent !== 'claude' && reasoning !== 'default' ? reasoning : undefined,
                effort: agent === 'claude' && effort !== 'auto' ? effort : undefined,
                permissionMode: permission,
                yolo,
                sessionType,
                worktreeName: sessionType === 'worktree' ? worktreeName.trim() || undefined : undefined,
                collaborationMode: agent === 'codex' && mode !== 'default' ? mode : undefined,
                serviceTier: fastMode ? tier : undefined,
                startingMode: 'remote',
              })
              if (response.type !== 'success' || !response.sessionId) throw new Error('SPAWN_FAILED')
              await queries.fetchQuery({
                queryKey: sessionKey(response.sessionId),
                queryFn: async () => SessionSchema.parse((await api.getSession(response.sessionId)).session),
              })
              created(response.sessionId)
            } catch (cause) {
              setError(errorKey(cause))
            } finally {
              submitting.current = false
              setBusy(false)
            }
          }}
        >
          <div className="new-session-fields">
            <div className="new-session-location">
              <MachineSelector
                machines={online}
                machineId={machineId}
                isLoading={machines.isPending}
                isDisabled={busy}
                onChange={(value) => {
                  setMachine(value)
                  setDirectory('')
                  resetModel()
                }}
              />
              <label className="launch-agent">
                {t('Agent')}
                <select
                  value={agent}
                  aria-label={t('Agent')}
                  disabled={busy}
                  onChange={(event) => {
                    setAgent(event.target.value as typeof agent)
                    setPermission('default')
                    setYolo(false)
                    setMode('default')
                    resetModel()
                  }}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </label>
              {!available && (
                <p className="small muted">
                  {t(availability.isPending ? 'Loading…' : 'Agent unavailable on this machine')}
                </p>
              )}
              <div className="launch-directory">
                <label>
                  {t('Directory')}
                  <input
                    value={directory}
                    placeholder="/home/user/project"
                    required
                    pattern="/.*"
                    disabled={busy}
                    onChange={(event) => {
                      setDirectory(event.target.value)
                      if (agent === 'opencode') resetModel()
                    }}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !machineId}
                  onClick={() => setBrowsing(true)}
                >
                  <Folder size={14} />
                  {t('Browse')}
                </Button>
              </div>
            </div>
            <fieldset aria-label={t('Model')} disabled={busy}>
              {agent === 'opencode' ? (
                <OpencodeModelSelector
                  cwd={cwd}
                  machineId={machineId}
                  isLoading={optionsPending}
                  error={opencode.error ? t('Unable to load session options. Use Refresh to retry.') : null}
                  availableModels={opencode.availableModels}
                  currentModelId={opencode.currentModelId}
                  selectedModel={model === 'auto' ? null : model}
                  onModelChange={(value) => {
                    setModel(value || 'auto')
                    setReasoning('default')
                  }}
                  onRetry={opencode.refetch}
                />
              ) : (
                <ModelSelector
                  agent={agent}
                  model={model}
                  options={
                    agent === 'codex'
                      ? [
                          { value: 'auto', label: t('Default') },
                          ...codex.models.map((item) => ({ value: item.id, label: item.displayName })),
                        ]
                      : undefined
                  }
                  isDisabled={busy || (agent === 'codex' && Boolean(codex.error))}
                  isLoading={agent === 'codex' && codex.isLoading}
                  error={
                    agent === 'codex' && codex.error
                      ? t('Unable to load session options. Use Refresh to retry.')
                      : null
                  }
                  onModelChange={(value) => {
                    setModel(value)
                    setReasoning('default')
                    setTier('standard')
                  }}
                />
              )}
            </fieldset>
            <fieldset aria-label={t('Reasoning effort')} disabled={busy}>
              <EffortField
                agent={agent}
                effort={effort}
                onEffortChange={setEffort}
                reasoningEffort={reasoning}
                onReasoningEffortChange={setReasoning}
                codexReasoningOptions={codexEfforts?.map((value) => ({ value }))}
                opencodeVariantOptions={variantOptions}
                isDisabled={busy || optionsPending || (agent === 'opencode' && !discoverOpencode)}
              />
            </fieldset>
            <fieldset aria-label={t('Permission mode')} disabled={busy}>
              <PermissionField
                agent={agent}
                nativeValue={permission}
                yoloMode={yolo}
                isDisabled={busy}
                onNativeChange={setPermission}
                onYoloToggle={setYolo}
              />
            </fieldset>
            {agent === 'codex' && (
              <fieldset aria-label={t('Mode')} disabled={busy}>
                <CollaborationModeSelector agent={agent} value={mode} isDisabled={busy} onChange={setMode} />
              </fieldset>
            )}
            {fastMode && (
              <fieldset aria-label={t('Fast mode')} disabled={busy}>
                <FastModeSelector visible value={tier} isDisabled={busy} onChange={setTier} />
              </fieldset>
            )}
            <fieldset className="new-session-location" aria-label={t('Session type')} disabled={busy}>
              <SessionTypeSelector
                sessionType={sessionType}
                worktreeName={worktreeName}
                worktreeInputRef={worktreeInput}
                isDisabled={busy}
                onSessionTypeChange={setSessionType}
                onWorktreeNameChange={setWorktreeName}
              />
            </fieldset>
          </div>
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={busy || !available || !directory.trim() || optionsPending}>
              {t(busy ? 'Working…' : 'Create session')}
            </Button>
          </div>
        </form>
        {browsing && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setBrowsing(false)
            }}
          >
            <DialogContent className="workspace-browser-dialog">
              <DialogHeader>
                <DialogTitle>{t('Browse folders')}</DialogTitle>
              </DialogHeader>
              <div className="workspace-browser-content">
                <I18nContext.Provider value={browserLocale}>
                  <WorkspaceBrowser
                    api={api}
                    machines={online.filter((machine) => machine.id === machineId)}
                    machinesLoading={machines.isPending}
                    initialMachineId={machineId}
                    onStartSession={(_, path) => {
                      setDirectory(path)
                      if (agent === 'opencode') resetModel()
                      setBrowsing(false)
                    }}
                  />
                </I18nContext.Provider>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}
