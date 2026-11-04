import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { GrokModelsResponse, Session } from '@hapi/protocol'
import { useAgyModels } from '@/hooks/queries/useAgyModels'
import { useClaudeModels } from '@/hooks/queries/useClaudeModels'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { useCopilotModels } from '@/hooks/queries/useCopilotModels'
import { useCursorModels } from '@/hooks/queries/useCursorModels'
import { useCursorModelsForMachine } from '@/hooks/queries/useCursorModelsForMachine'
import { useGrokModels } from '@/hooks/queries/useGrokModels'
import { useGrokReasoningEffortOptions } from '@/hooks/queries/useGrokReasoningEffortOptions'
import { useHermesModels } from '@/hooks/queries/useHermesModels'
import { useOpencodeModels } from '@/hooks/queries/useOpencodeModels'
import { useOpencodeReasoningEffortOptions } from '@/hooks/queries/useOpencodeReasoningEffortOptions'
import { usePiModels } from '@/hooks/queries/usePiModels'
import { queryKeys } from '@/lib/query-keys'
import type { DesktopApi } from '../../lib/api'
import { useAdditionalModels } from './useAdditionalModels'

export function useSessionCatalogs(api: DesktopApi, session: Session, enabled: boolean) {
  const agent = session.metadata?.flavor
  const machineId = session.metadata?.machineId
  const queries = useQueryClient()
  const target = (flavor: string) => ({
    api,
    machineId,
    sessionId: session.id,
    enabled: enabled && agent === flavor,
  })
  const claude = useClaudeModels(target('claude'))
  const codex = useCodexModels({
    ...target('codex'),
    preferSession: Boolean(session.metadata?.capabilities?.concurrentClients),
  })
  const agy = useAgyModels(target('agy'))
  const cursor = useCursorModels(target('cursor'))
  const machineCursor = useCursorModelsForMachine(target('cursor'))
  const pi = usePiModels(target('pi'))
  const grok = useGrokModels(target('grok'))
  const grokEffort = useGrokReasoningEffortOptions(target('grok'))
  const copilot = useCopilotModels(target('copilot'))
  const hermes = useHermesModels({ ...target('hermes'), model: session.model })
  const opencode = useOpencodeModels(target('opencode'))
  const opencodeEffort = useOpencodeReasoningEffortOptions({
    ...target('opencode'),
    sessionModel: session.model,
  })
  const additional = useAdditionalModels({ api, sessionId: session.id, agent, enabled })
  useEffect(() => {
    if (!enabled) return
    const queryKey =
      agent === 'opencode'
        ? queryKeys.sessionOpencodeReasoningEffortOptions(session.id)
        : agent === 'grok'
          ? queryKeys.sessionGrokReasoningEffortOptions(session.id)
          : null
    if (queryKey) void queries.resetQueries({ queryKey, exact: true })
  }, [agent, enabled, session.id, session.model, queries])

  const catalogs = {
    agy,
    codex,
    cursor,
    pi,
    grok,
    copilot,
    hermes,
    opencode,
    dsh: additional,
    kimi: additional,
  }
  const active = agent && Object.hasOwn(catalogs, agent) ? catalogs[agent as keyof typeof catalogs] : null
  // OpenCode reports an unavailable effort catalog for models without variants.
  // Like Web, keep that optional discovery independent of the model selector.
  const effortState = agent === 'grok' ? grokEffort : null
  const isLoading = Boolean(
    active?.isLoading || effortState?.isLoading || (agent === 'cursor' && machineCursor.isLoading),
  )
  const error = active?.error || effortState?.error || (agent === 'cursor' ? machineCursor.error : null)
  const grokCapabilities = queries.getQueryData<GrokModelsResponse>(queryKeys.sessionGrokModels(session.id))

  function refetch() {
    if (agent === 'agy') {
      agy.refetch()
      return
    }
    if (agent === 'hermes') {
      hermes.refetch()
      return
    }
    if (agent === 'kimi' || agent === 'dsh') {
      additional.refetch()
      return
    }
    const keys: Record<string, QueryKey[]> = {
      codex: [queryKeys.machineCodexModels(machineId ?? 'unknown'), queryKeys.sessionCodexModels(session.id)],
      claude: [queryKeys.machineClaudeModels(machineId ?? 'unknown')],
      cursor: [
        queryKeys.machineCursorModels(machineId ?? 'unknown'),
        queryKeys.sessionCursorModels(session.id),
      ],
      pi: [queryKeys.sessionPiModels(session.id)],
      grok: [
        queryKeys.sessionGrokModels(session.id),
        queryKeys.sessionGrokReasoningEffortOptions(session.id),
      ],
      copilot: [queryKeys.sessionCopilotModels(session.id)],
      opencode: [
        queryKeys.sessionOpencodeModels(session.id),
        queryKeys.sessionOpencodeReasoningEffortOptions(session.id),
      ],
    }
    void Promise.all(
      (keys[agent ?? ''] ?? []).map((queryKey) => queries.resetQueries({ queryKey, exact: true })),
    )
  }
  return {
    ...catalogs,
    claude,
    machineCursor,
    grokEffort,
    opencodeEffort,
    isLoading,
    error,
    refetch,
    autoPermissionModeSupported: grokCapabilities?.autoPermissionModeSupported,
  }
}
