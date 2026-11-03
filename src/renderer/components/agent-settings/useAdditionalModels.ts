import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import type { DesktopApi } from '../../lib/api'

export function useAdditionalModels(args: {
  api: DesktopApi
  agent: string | null | undefined
  machineId?: string | null
  sessionId?: string
  cwd?: string
  enabled: boolean
}) {
  const { api, agent, machineId, sessionId, cwd = '' } = args
  const isDsh = agent === 'dsh'
  const supported = isDsh || agent === 'kimi'
  const enabled = args.enabled && supported && Boolean(sessionId || (machineId && (isDsh || cwd)))
  const queryKey = sessionId
    ? isDsh
      ? queryKeys.sessionDshModels(sessionId)
      : queryKeys.sessionKimiModels(sessionId)
    : isDsh
      ? queryKeys.machineDshModels(machineId ?? 'unknown')
      : queryKeys.machineKimiModelsForCwd(machineId ?? 'unknown', cwd)
  const query = useQuery({
    queryKey,
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      if (sessionId) return isDsh ? api.getSessionDshModels(sessionId) : api.getSessionKimiModels(sessionId)
      if (!machineId) throw new Error('Model target unavailable')
      return isDsh ? api.getMachineDshModels(machineId) : api.getMachineKimiModels(machineId, cwd)
    },
  })
  return {
    availableModels: query.data?.availableModels ?? [],
    currentModelId: query.data?.currentModelId ?? null,
    isLoading: enabled && query.isLoading,
    error: query.error
      ? 'Model discovery failed'
      : query.data?.success === false
        ? 'Model discovery failed'
        : null,
    refetch: () => {
      void query.refetch()
    },
  }
}
