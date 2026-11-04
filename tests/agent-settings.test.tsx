import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentFlavor } from '@hapi/protocol'
import { hubRequestSchema } from '../src/shared/policy'
import { createApi } from '../src/renderer/lib/api'
import { useLaunchSettings } from '../src/renderer/components/agent-settings/useLaunchSettings'
import { useSessionSettings } from '../src/renderer/components/agent-settings/useSessionSettings'
import {
  defaultLaunchSettings,
  launchParameters,
} from '../src/renderer/components/agent-settings/launchSettings'
import { AgentConfigFixture } from './fixtures/agent-config'
import { fixtureSession } from './fake-server'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const clients: QueryClient[] = []
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  const catalogs = new AgentConfigFixture().catalogs
  const responses = new Map<string, unknown>()
  const request = vi.fn(async (input: { path: string; method: string; scope?: string }) => {
    const url = new URL(input.path, 'https://fixture.invalid')
    const response = responses.get(input.path) ??
      catalogs.get(url.pathname.split('/').at(-1) ?? '') ?? { success: true, availableModels: [], models: [] }
    return { ok: true, value: await response }
  })
  Object.defineProperty(window, 'desktop', { configurable: true, value: { request } })
  const api = createApi('https://hub.example:account')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { api, request, responses, wrapper }
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  Reflect.deleteProperty(window, 'desktop')
  vi.restoreAllMocks()
})

describe('CLI settings contracts', () => {
  it('allows only the specific discovery and configuration endpoints', () => {
    const readPaths = [
      '/api/machines/runner/agent-availability',
      ...['agy', 'cursor', 'grok', 'copilot', 'pi', 'kimi', 'dsh'].map(
        (agent) => `/api/machines/runner/${agent}-models?cwd=%2Fproject`,
      ),
      ...['cursor', 'grok', 'copilot', 'pi', 'kimi', 'dsh'].map(
        (agent) => `/api/sessions/session/${agent}-models`,
      ),
      '/api/sessions/session/grok-reasoning-effort-options',
    ]
    for (const path of readPaths) {
      expect(hubRequestSchema.safeParse({ method: 'GET', path }).success, path).toBe(true)
      expect(hubRequestSchema.safeParse({ method: 'POST', path }).success, path).toBe(false)
    }
    for (const endpoint of ['copilot-agent-mode', 'service-tier']) {
      expect(
        hubRequestSchema.safeParse({ method: 'POST', path: `/api/sessions/a/${endpoint}` }).success,
      ).toBe(true)
      expect(hubRequestSchema.safeParse({ method: 'GET', path: `/api/sessions/a/${endpoint}` }).success).toBe(
        false,
      )
    }
    for (const path of [
      '/api/machines/a/execute',
      '/api/sessions/a/pi-execute',
      '/api/machines/a/unknown-models',
    ]) {
      expect(hubRequestSchema.safeParse({ method: 'GET', path }).success).toBe(false)
    }
  })

  it('keeps new model endpoints scoped, encodes directory queries, and rejects malformed catalogs', async () => {
    const { api, request, responses } = harness()
    await api.getMachineKimiModels('runner-1', 'C:\\Projects\\研发 & test')
    expect(request).toHaveBeenLastCalledWith({
      method: 'GET',
      scope: 'https://hub.example:account',
      path: '/api/machines/runner-1/kimi-models?cwd=C%3A%5CProjects%5C%E7%A0%94%E5%8F%91+%26+test',
    })
    responses.set('/api/sessions/session/dsh-models', { success: true, availableModels: [{ modelId: 42 }] })
    await expect(api.getSessionDshModels('session')).rejects.toThrow()
  })

  it('omits unsupported launch fields and uses the native safe permission for Antigravity', () => {
    const stale = {
      ...defaultLaunchSettings('codex'),
      reasoning: 'xhigh',
      effort: 'high',
      permission: 'yolo' as const,
      copilotMode: 'autopilot' as const,
    }
    expect(launchParameters('pi', stale, false)).toMatchObject({
      permissionMode: undefined,
      modelReasoningEffort: undefined,
      copilotAgentMode: undefined,
      effort: 'high',
    })
    expect(launchParameters('dsh', stale, false)).toMatchObject({
      permissionMode: undefined,
      effort: undefined,
      modelReasoningEffort: undefined,
    })
    expect(launchParameters('agy', defaultLaunchSettings('agy'), false)).toMatchObject({
      permissionMode: 'request-review',
      effort: undefined,
    })
    expect(
      launchParameters(
        'cursor',
        { ...defaultLaunchSettings('cursor'), permission: 'debug', model: 'claude-sonnet-4-6[effort=high]' },
        false,
      ),
    ).toMatchObject({
      permissionMode: 'debug',
      model: 'claude-sonnet-4-6[effort=high]',
      effort: undefined,
      modelReasoningEffort: undefined,
    })
  })
})

describe('launch configuration changes', () => {
  it('resets directory models immediately and waits for the new directory before probing', async () => {
    const { api, request, responses, wrapper } = harness()
    const args = {
      agent: 'kimi' as AgentFlavor,
      machineId: 'runner-a',
      directory: '/project-a',
      cwd: '/project-a',
      pathReady: true,
    }
    const view = renderHook((props) => useLaunchSettings({ ...props, api, enabled: true }), {
      initialProps: args,
      wrapper,
    })
    await waitFor(() => expect(view.result.current.modelDisabled).toBe(false))
    act(() => view.result.current.change({ model: 'office-kimi' }))
    expect(view.result.current.parameters.model).toBe('office-kimi')
    view.rerender({ ...args, directory: '/project-b', pathReady: false })
    expect(view.result.current.parameters.model).toBeUndefined()
    expect(request.mock.calls.some(([input]) => input.path.includes('cwd=%2Fproject-b'))).toBe(false)
    const gate = Promise.withResolvers<unknown>()
    responses.set('/api/machines/runner-b/kimi-models?cwd=%2Fproject-b', gate.promise)
    view.rerender({ ...args, machineId: 'runner-b', directory: '/project-b', cwd: '/project-b' })
    await waitFor(() => expect(view.result.current.pending).toBe(true))
    expect(view.result.current.parameters.model).toBeUndefined()
    await act(async () => gate.resolve({ success: true, availableModels: [{ modelId: 'remote-kimi' }] }))
    await waitFor(() => expect(view.result.current.pending).toBe(false))
    expect(view.result.current.modelOptions.map((option) => option.value)).toEqual(['auto', 'remote-kimi'])
    expect(view.result.current.settings.model).toBe('auto')
  })

  it('disambiguates Pi providers and removes thinking levels a different model cannot use', async () => {
    const { api, wrapper } = harness()
    const { result } = renderHook(
      () =>
        useLaunchSettings({
          api,
          agent: 'pi',
          machineId: 'runner',
          cwd: '/project',
          directory: '/project',
          pathReady: true,
          enabled: true,
        }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.modelDisabled).toBe(false))
    expect(result.current.modelOptions.map((option) => option.value)).toEqual([
      'auto',
      'office/shared-model',
      'home/shared-model',
    ])
    act(() => result.current.change({ model: 'office/shared-model', effort: 'max' }))
    expect(result.current.parameters).toMatchObject({ model: 'office/shared-model', effort: 'max' })
    expect(result.current.effortFieldOptions.some((option) => option.value === 'xhigh')).toBe(false)
    act(() => result.current.change({ model: 'home/shared-model' }))
    expect(result.current.showEffort).toBe(false)
    expect(result.current.parameters.effort).toBeUndefined()
    act(() => result.current.change({ model: 'auto' }))
    expect(result.current.effortFieldOptions.some((option) => option.value === 'max')).toBe(false)
  })

  it('uses live Grok efforts and clears modes no longer supported by the CLI', async () => {
    const { api, wrapper } = harness()
    const { result } = renderHook(
      () =>
        useLaunchSettings({
          api,
          agent: 'grok',
          machineId: 'runner',
          cwd: '/project',
          directory: '/project',
          pathReady: true,
          enabled: true,
        }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.modelDisabled).toBe(false))
    act(() => result.current.change({ model: 'grok-fixture', effort: 'ultra', permission: 'auto' }))
    expect(result.current.parameters).toMatchObject({ effort: 'ultra', permissionMode: 'default' })
    act(() => result.current.change({ effort: 'max' }))
    expect(result.current.parameters.effort).toBeUndefined()
  })
})

describe('OpenCode session model settings', () => {
  const models = {
    success: true,
    availableModels: [{ modelId: 'opencode/plain' }, { modelId: 'opencode/reasoning' }],
    currentModelId: 'opencode/plain',
  }

  it('allows model changes when the current model has no reasoning options', async () => {
    const { api, request, responses, wrapper } = harness()
    const session = { ...fixtureSession('session', 'OpenCode', 'opencode'), model: 'opencode/plain' }
    responses.set('/api/sessions/session/opencode-models', models)
    responses.set('/api/sessions/session/opencode-reasoning-effort-options', {
      success: false,
      error: 'OpenCode reasoning effort options are not available',
      currentModelId: session.model,
      targetModelId: session.model,
    })
    const { result } = renderHook(() => useSessionSettings(api, session, true), { wrapper })
    await waitFor(() => expect(result.current.modelsDisabled).toBe(false))
    expect(result.current.catalogs.error).toBeFalsy()
    expect(result.current.effortOptions).toEqual([])
    expect(result.current.effortDisabled).toBe(true)
    await act(async () => expect(await result.current.apply('model', 'opencode/reasoning')).toBe(true))
    expect(request).toHaveBeenCalledWith({
      path: '/api/sessions/session/model',
      method: 'POST',
      scope: 'https://hub.example:account',
      body: { model: 'opencode/reasoning' },
    })
  })

  it('loads models independently and makes a failed model discovery refreshable', async () => {
    const { api, responses, wrapper } = harness()
    const session = { ...fixtureSession('session', 'OpenCode', 'opencode'), model: 'opencode/plain' }
    const effort = Promise.withResolvers<unknown>()
    responses.set('/api/sessions/session/opencode-models', { success: false, error: 'Not ready' })
    responses.set('/api/sessions/session/opencode-reasoning-effort-options', effort.promise)
    const { result } = renderHook(() => useSessionSettings(api, session, true), { wrapper })
    try {
      await waitFor(() => expect(result.current.catalogs.error).toBe('Not ready'))
      expect(result.current.modelsDisabled).toBe(true)
      responses.set('/api/sessions/session/opencode-models', models)
      act(() => result.current.catalogs.refetch())
      await waitFor(() => expect(result.current.modelsDisabled).toBe(false))
      expect(result.current.effortDisabled).toBe(true)
      expect(result.current.catalogs.isLoading).toBe(false)
      await act(async () => effort.resolve({ success: true, options: [{ value: 'deep' }] }))
      await waitFor(() => expect(result.current.effortDisabled).toBe(false))
      expect(result.current.effortOptions).toContainEqual({ value: 'deep', label: 'Deep' })
    } finally {
      effort.resolve({ success: true, options: [] })
    }
  })
})
