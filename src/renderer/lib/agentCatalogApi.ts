import { z } from 'zod'

// These Hub endpoints are newer than the vendored Web client's convenience methods.
// Keep their narrow transport adapter here; model IDs are opaque, especially DSH tuples.
const modelCatalogSchema = z.object({
  success: z.boolean(),
  availableModels: z
    .array(
      z.object({
        modelId: z.string().min(1),
        name: z.string().optional(),
        provider: z.string().optional(),
      }),
    )
    .optional(),
  currentModelId: z.string().nullable().optional(),
  error: z.string().optional(),
})

export function agentCatalogApi(transport: <T>(path: string, init?: RequestInit) => Promise<T>) {
  const read = async (path: string) => modelCatalogSchema.parse(await transport<unknown>(path))
  return {
    getMachineDshModels: (machineId: string) =>
      read(`/api/machines/${encodeURIComponent(machineId)}/dsh-models`),
    getSessionDshModels: (sessionId: string) =>
      read(`/api/sessions/${encodeURIComponent(sessionId)}/dsh-models`),
    getMachineKimiModels: (machineId: string, cwd: string) =>
      read(`/api/machines/${encodeURIComponent(machineId)}/kimi-models?${new URLSearchParams({ cwd })}`),
    getSessionKimiModels: (sessionId: string) =>
      read(`/api/sessions/${encodeURIComponent(sessionId)}/kimi-models`),
  }
}
