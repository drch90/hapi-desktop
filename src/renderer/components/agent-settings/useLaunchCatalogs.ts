import { useQueryClient } from '@tanstack/react-query'
import type { AgentFlavor } from '@hapi/protocol'
import { useAgyModels } from '@/hooks/queries/useAgyModels'
import { useClaudeModels } from '@/hooks/queries/useClaudeModels'
import { useCodexModels } from '@/hooks/queries/useCodexModels'
import { useCopilotModelsForCwd } from '@/hooks/queries/useCopilotModelsForCwd'
import { useCursorModelsForMachine } from '@/hooks/queries/useCursorModelsForMachine'
import { useGrokModelsForCwd } from '@/hooks/queries/useGrokModelsForCwd'
import { useHermesModels } from '@/hooks/queries/useHermesModels'
import { useOpencodeModelsForCwd } from '@/hooks/queries/useOpencodeModelsForCwd'
import { useOpencodeModelVariants } from '@/hooks/queries/useOpencodeModelVariants'
import { usePiModelsForMachine } from '@/hooks/queries/usePiModelsForMachine'
import { queryKeys } from '@/lib/query-keys'
import type { DesktopApi } from '../../lib/api'
import { useAdditionalModels } from './useAdditionalModels'

export function usesDirectoryModels(agent: AgentFlavor) {
  return ['opencode', 'hermes', 'grok', 'copilot', 'kimi'].includes(agent)
}

export function useLaunchCatalogs(args: {
  api: DesktopApi
  agent: AgentFlavor
  machineId: string
  cwd: string
  pathReady: boolean
  enabled: boolean
}) {
  const { api, agent, machineId, cwd, pathReady, enabled } = args
  const queries = useQueryClient()
  const machine = (flavor: AgentFlavor) => ({ api, machineId, enabled: enabled && agent === flavor })
  const directory = (flavor: AgentFlavor) => ({
    ...machine(flavor),
    cwd,
    enabled: enabled && agent === flavor && pathReady,
  })
  const claude = useClaudeModels(machine('claude'))
  const codex = useCodexModels(machine('codex'))
  const agy = useAgyModels(machine('agy'))
  const cursor = useCursorModelsForMachine(machine('cursor'))
  const pi = usePiModelsForMachine(machine('pi'))
  const grok = useGrokModelsForCwd(directory('grok'))
  const copilot = useCopilotModelsForCwd(directory('copilot'))
  const hermes = useHermesModels(directory('hermes'))
  const opencode = useOpencodeModelsForCwd(directory('opencode'))
  const variants = useOpencodeModelVariants(directory('opencode'))
  const additional = useAdditionalModels({
    api,
    agent,
    machineId,
    cwd,
    enabled: enabled && (agent === 'dsh' || pathReady),
  })
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
  const active = agent === 'claude' || agent === 'gemini' ? null : catalogs[agent]
  const isLoading = Boolean(active?.isLoading || (agent === 'opencode' && variants.isLoading))
  const error = active?.error || (agent === 'opencode' ? variants.error : null)

  function refetch() {
    switch (agent) {
      case 'agy':
        agy.refetch()
        return
      case 'cursor':
        cursor.refetch()
        return
      case 'hermes':
        hermes.refetch()
        return
      case 'dsh':
      case 'kimi':
        additional.refetch()
        return
      case 'opencode':
        opencode.refetch()
        void queries.resetQueries({
          queryKey: [...queryKeys.machineOpencodeModelVariants(machineId), cwd],
          exact: true,
        })
        return
    }
    const key =
      agent === 'pi'
        ? queryKeys.machinePiModels(machineId)
        : agent === 'grok'
          ? queryKeys.machineGrokModelsForCwd(machineId, cwd)
          : agent === 'copilot'
            ? queryKeys.machineCopilotModelsForCwd(machineId, cwd)
            : agent === 'claude'
              ? queryKeys.machineClaudeModels(machineId)
              : queryKeys.machineCodexModels(machineId)
    void queries.resetQueries({ queryKey: key, exact: true })
  }

  return { ...catalogs, claude, variants, isLoading, error, refetch }
}
