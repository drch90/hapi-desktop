import { CREATABLE_AGENT_FLAVORS, type AgentAvailabilityEntry } from '@hapi/protocol'

export class AgentConfigFixture {
  availability = new Map<string, AgentAvailabilityEntry[]>()
  availabilityError: 'failed' | 'upgrade' | null = null
  availabilityGates = new Map<string, Promise<void>>()
  failModels = new Set<string>()
  modelGates = new Map<string, Promise<void>>()
  modelRequests: { machineId?: string; sessionId?: string; endpoint: string; cwd: string | null }[] = []
  catalogs = new Map<string, unknown>([
    [
      'agy-models',
      {
        success: true,
        availableModels: [
          { modelId: 'claude-sonnet-4-6-low', name: 'Sonnet (Low)' },
          { modelId: 'claude-sonnet-4-6-high', name: 'Sonnet (High)' },
          { modelId: 'gemini-3.1-pro-low', name: 'Gemini Pro' },
        ],
        currentModelId: 'claude-sonnet-4-6-low',
      },
    ],
    [
      'cursor-models',
      {
        success: true,
        availableModels: [
          { modelId: 'claude-sonnet-4-6[effort=low]', name: 'Sonnet' },
          { modelId: 'claude-sonnet-4-6[effort=high]', name: 'Sonnet' },
          { modelId: 'composer-2.5[fast=false]', name: 'Composer' },
        ],
        cliModelSkus: [],
        currentModelId: 'claude-sonnet-4-6[effort=low]',
      },
    ],
    [
      'pi-models',
      {
        success: true,
        availableModels: [
          {
            provider: 'office',
            modelId: 'shared-model',
            name: 'Office model',
            reasoning: true,
            thinkingLevelMap: { max: 'max', xhigh: null },
          },
          { provider: 'home', modelId: 'shared-model', name: 'Home model', reasoning: false },
        ],
        currentModelId: 'shared-model',
      },
    ],
    [
      'grok-models',
      {
        success: true,
        autoPermissionModeSupported: false,
        availableModels: [
          {
            modelId: 'grok-fixture',
            name: 'Grok Fixture',
            reasoningEfforts: [
              { value: 'low', name: 'Low' },
              { value: 'ultra', name: 'Ultra' },
            ],
          },
        ],
        currentModelId: 'grok-fixture',
      },
    ],
    [
      'grok-reasoning-effort-options',
      {
        success: true,
        options: [
          { value: 'low', name: 'Low' },
          { value: 'ultra', name: 'Ultra' },
        ],
        currentValue: 'low',
      },
    ],
    [
      'copilot-models',
      {
        success: true,
        availableModels: [{ modelId: 'copilot-fixture', name: 'Copilot Fixture' }],
        currentModelId: 'copilot-fixture',
      },
    ],
    [
      'kimi-models',
      {
        success: true,
        availableModels: [{ modelId: 'office-kimi', name: 'Office Kimi', provider: 'office' }],
        currentModelId: 'office-kimi',
      },
    ],
    [
      'dsh-models',
      {
        success: true,
        availableModels: [
          { modelId: '["deepseek","deepseek-v4"]', name: 'DeepSeek V4' },
          { modelId: '["office","deepseek-v4"]', name: 'Office V4' },
        ],
        currentModelId: '["deepseek","deepseek-v4"]',
      },
    ],
  ])

  async handle(url: URL, reply: (value: unknown, status?: number) => void, hermesAvailable: boolean) {
    const match = /^\/api\/(machines|sessions)\/([^/]+)\/([^/]+)$/.exec(url.pathname)
    if (!match) return false
    const [, kind, id, endpoint] = match
    if (endpoint === 'agent-availability' && kind === 'machines') {
      // Capture the answer before waiting, to reproduce an older machine's late response.
      const agents =
        this.availability.get(id) ??
        CREATABLE_AGENT_FLAVORS.map((agent) => ({
          agent,
          available: agent !== 'hermes' || hermesAvailable,
        }))
      await this.availabilityGates.get(id)
      if (this.availabilityError)
        reply(
          {
            error: 'Agent inspection failed',
            code: this.availabilityError === 'upgrade' ? 'runner_upgrade_required' : 'inspection_failed',
          },
          this.availabilityError === 'upgrade' ? 409 : 503,
        )
      else reply({ agents })
      return true
    }
    if (!this.catalogs.has(endpoint)) return false
    this.modelRequests.push({
      ...(kind === 'machines' ? { machineId: id } : { sessionId: id }),
      endpoint,
      cwd: url.searchParams.get('cwd'),
    })
    await this.modelGates.get(endpoint)
    reply(
      this.failModels.has(endpoint)
        ? { success: false, error: 'Fixture discovery failure' }
        : this.catalogs.get(endpoint),
    )
    return true
  }
}
