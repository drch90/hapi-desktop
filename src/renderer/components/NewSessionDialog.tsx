import { useContext, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Folder } from 'lucide-react'
import { SessionSchema } from '@hapi/protocol/schemas'
import {
  CREATABLE_AGENT_FLAVORS,
  getFlavorLabel,
  type AgentFlavor,
  type SessionSummary,
} from '@hapi/protocol'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MachineSelector } from '@/components/NewSession/MachineSelector'
import { SessionTypeSelector } from '@/components/NewSession/SessionTypeSelector'
import type { SessionType } from '@/components/NewSession/types'
import { useAgentAvailability } from '@/hooks/queries/useAgentAvailability'
import { LaunchSettingsFields } from './agent-settings/LaunchSettingsFields'
import { useLaunchSettings } from './agent-settings/useLaunchSettings'
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser'
import { useMachinePathsExists } from '@/hooks/useMachinePathsExists'
import { useDirectorySuggestions } from '@/hooks/useDirectorySuggestions'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { I18nContext } from '@/lib/i18n-context'
import { getPathDisplayName } from '@/utils/path'
import { createApi, errorKey } from '../lib/api'
import { loadNewSessionLocations, rememberSessionLocation } from '../lib/newSessionLocations'
import { machinesKey, queries, sessionKey } from '../lib/sync'

export function NewSessionDialog({
  scope,
  sessions,
  close,
  created,
  initialMachineId,
  initialDirectory,
}: {
  scope: string
  sessions: SessionSummary[]
  close: () => void
  created: (id: string) => void
  initialMachineId?: string
  initialDirectory?: string
}) {
  const { t } = useTranslation()
  const upstream = useContext(I18nContext)
  const api = useMemo(() => createApi(scope), [scope])
  const [locations] = useState(() => loadNewSessionLocations(scope))
  const machines = useQuery({
    queryKey: machinesKey,
    queryFn: async () => (await api.getMachines()).machines,
  })
  const online = machines.data?.filter((machine) => machine.active) ?? []
  const [chosenMachine, setMachine] = useState(initialMachineId ?? '')
  const machineId =
    chosenMachine ||
    online.find((machine) => machine.id === locations.lastMachineId)?.id ||
    online[0]?.id ||
    ''
  // Keep even an automatically selected runner when it goes offline; never redirect a launch.
  useEffect(() => {
    if (!chosenMachine && machineId) setMachine(machineId)
  }, [chosenMachine, machineId])
  const machineAvailable = online.some((machine) => machine.id === machineId)
  const selectedMachine = machines.data?.find((machine) => machine.id === machineId)
  const workspaceRoots = useMemo(
    () => [
      ...new Set(selectedMachine?.metadata?.workspaceRoots?.map((path) => path.trim()).filter(Boolean) ?? []),
    ],
    [selectedMachine?.metadata?.workspaceRoots],
  )
  const recentPaths = useMemo(
    () => (Object.hasOwn(locations.paths, machineId) ? locations.paths[machineId] : []),
    [locations, machineId],
  )
  const allPaths = useDirectorySuggestions(machineId, sessions, recentPaths)
  const historyPaths = machineId ? allPaths.filter((path) => !workspaceRoots.includes(path)) : []
  const [agent, setAgent] = useState<AgentFlavor>('codex')
  // Resolve defaults once per machine selection; metadata refreshes must not move the launch.
  // An empty string is an intentional user edit, while null waits for the runner's defaults.
  const [directoryOverride, setDirectory] = useState<string | null>(initialDirectory ?? null)
  const directory = directoryOverride ?? recentPaths[0] ?? workspaceRoots[0] ?? ''
  useEffect(() => {
    if (directoryOverride === null && directory) setDirectory(directory)
  }, [directoryOverride, directory])
  const [sessionType, setSessionType] = useState<SessionType>('simple')
  const [worktreeName, setWorktreeName] = useState('')
  const worktreeInput = useRef<HTMLInputElement>(null)
  const [browsing, setBrowsing] = useState(false)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [error, setError] = useState('')
  const { spawnSession } = useSpawnSession(api)
  const availability = useAgentAvailability({ api, machineId, enabled: machineAvailable })
  const availableAgents =
    machineAvailable && !availability.error
      ? availability.agents.filter(
          (entry) => entry.available && CREATABLE_AGENT_FLAVORS.includes(entry.agent),
        )
      : []
  const available =
    !availability.isLoading && !availability.error && availableAgents.some((entry) => entry.agent === agent)
  const firstAvailable = availableAgents[0]?.agent
  useEffect(() => {
    if (!availability.isLoading && !availability.error && !available && firstAvailable)
      setAgent(firstAvailable)
  }, [availability.isLoading, availability.error, available, firstAvailable])
  const cwd = useDeferredValue(directory.trim())
  const paths = useMemo(
    () => [...new Set([...(cwd ? [cwd] : []), ...workspaceRoots, ...allPaths])].slice(0, 1000),
    [cwd, workspaceRoots, allPaths],
  )
  const { pathExistence, outsideWorkspaceRoots, checkPathsExists } = useMachinePathsExists(
    api,
    machineAvailable ? machineId : null,
    paths,
  )
  // A deferred path can still refer to the previous directory after an edit.
  // Only discover models for the current input, including after it is cleared.
  const currentPathReady =
    Boolean(cwd) && cwd === directory.trim() && pathExistence[cwd] === true && !outsideWorkspaceRoots.has(cwd)
  const config = useLaunchSettings({
    api,
    agent,
    machineId,
    cwd,
    directory: directory.trim(),
    pathReady: currentPathReady,
    enabled: available,
  })
  const optionsPending = config.pending
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

  function chooseDirectory(path: string) {
    setDirectory(path)
    setError('')
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
              const status = await checkPathsExists([directory.trim()])
              if (!mounted.current) return
              if (status.outsideWorkspaceRoots?.includes(directory.trim())) {
                setError('The directory is outside the configured workspace roots.')
                return
              }
              const response = await spawnSession({
                machineId,
                directory: directory.trim(),
                ...config.parameters,
                sessionType,
                worktreeName: sessionType === 'worktree' ? worktreeName.trim() || undefined : undefined,
                startingMode: 'remote',
              })
              if (response.type !== 'success' || !response.sessionId) throw new Error('SPAWN_FAILED')
              if (!mounted.current) return
              rememberSessionLocation(scope, machineId, directory)
              await queries.fetchQuery({
                queryKey: sessionKey(response.sessionId),
                queryFn: async () => SessionSchema.parse((await api.getSession(response.sessionId)).session),
              })
              if (mounted.current) created(response.sessionId)
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
                machineId={machineAvailable ? machineId : ''}
                placeholder={
                  !machines.isPending && !machineAvailable
                    ? t('Machine unavailable. Select an online machine.')
                    : undefined
                }
                isLoading={machines.isPending}
                isDisabled={busy}
                onChange={(value) => {
                  setMachine(value)
                  setDirectory(null)
                  setError('')
                }}
              />
              <label className="launch-agent">
                {t('Agent')}
                <select
                  value={available ? agent : ''}
                  aria-label={t('Agent')}
                  disabled={busy || availability.isLoading || !availableAgents.length}
                  onChange={(event) => {
                    const selected = availableAgents.find((entry) => entry.agent === event.target.value)
                    if (selected) setAgent(selected.agent)
                    setError('')
                  }}
                >
                  {!available && (
                    <option value="">
                      {t(availability.isLoading ? 'Checking installed CLIs…' : 'No available CLI')}
                    </option>
                  )}
                  {availableAgents.map((entry) => (
                    <option key={entry.agent} value={entry.agent}>
                      {getFlavorLabel(entry.agent)}
                    </option>
                  ))}
                </select>
              </label>
              {!available && (
                <div className="launch-catalog-status">
                  <p
                    className={availability.error ? 'small error' : 'small muted'}
                    role={availability.error ? 'alert' : 'status'}
                  >
                    {t(
                      !machines.isPending && !machineAvailable
                        ? 'Machine unavailable. Select an online machine.'
                        : availability.upgradeRequired
                          ? 'Update the runner on this machine to detect installed CLIs.'
                          : availability.error
                            ? 'Unable to check installed CLIs. Refresh to retry.'
                            : availability.isLoading || machines.isPending
                              ? 'Checking installed CLIs…'
                              : 'No available CLIs were found on this machine.',
                    )}
                  </p>
                  {machineAvailable && !availability.isLoading && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={availability.refetch}
                    >
                      {t('Refresh')}
                    </Button>
                  )}
                </div>
              )}
              <div className="launch-directory">
                <label>
                  {t('Directory')}
                  <input
                    value={directory}
                    placeholder={
                      workspaceRoots[0] ||
                      (selectedMachine?.metadata?.platform === 'win32'
                        ? 'C:\\Projects'
                        : '/home/user/project')
                    }
                    required
                    disabled={busy}
                    onChange={(event) => chooseDirectory(event.target.value)}
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !machineAvailable}
                  onClick={() => setBrowsing(true)}
                >
                  <Folder size={14} />
                  {t('Browse')}
                </Button>
              </div>
              {[
                { label: 'Runner workspaces', paths: workspaceRoots },
                { label: 'Recent and session folders', paths: historyPaths },
              ].map(({ label, paths }) =>
                paths.length ? (
                  <div key={label} className="launch-folder-group" role="group" aria-label={t(label)}>
                    <span className="small muted">{t(label)}</span>
                    <div className="launch-folder-options">
                      {paths.map((path) => {
                        const unavailable = outsideWorkspaceRoots.has(path)
                          ? 'The directory is outside the configured workspace roots.'
                          : pathExistence[path] === false
                            ? 'Directory unavailable'
                            : ''
                        return (
                          <button
                            key={path}
                            type="button"
                            title={unavailable ? `${path}\n${t(unavailable)}` : path}
                            aria-label={path}
                            aria-pressed={directory.trim() === path}
                            disabled={busy || !machineAvailable || Boolean(unavailable)}
                            onClick={() => chooseDirectory(path)}
                          >
                            <Folder size={13} aria-hidden="true" />
                            <span>{getPathDisplayName(path)}</span>
                            {label === 'Runner workspaces' && path === workspaceRoots[0] && (
                              <small>{t('Default')}</small>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null,
              )}
            </div>
            <LaunchSettingsFields config={config} disabled={busy || !available} />
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
                      chooseDirectory(path)
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
