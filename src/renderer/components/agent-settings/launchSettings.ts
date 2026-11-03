import {
  getPermissionModesForFlavor,
  type AgentFlavor,
  type CodexCollaborationMode,
  type CopilotAgentMode,
  type PermissionMode,
} from '@hapi/protocol'
import type { NewSessionServiceTier } from '@/components/NewSession/types'

export type LaunchSettings = {
  model: string
  effort: string
  reasoning: string
  permission: PermissionMode
  mode: CodexCollaborationMode
  tier: NewSessionServiceTier
  copilotMode: CopilotAgentMode
}

export const defaultModelSettings = {
  model: 'auto',
  effort: 'auto',
  reasoning: 'default',
  tier: 'standard' as const,
}

export function defaultLaunchSettings(agent: AgentFlavor): LaunchSettings {
  return {
    ...defaultModelSettings,
    permission: getPermissionModesForFlavor(agent)[0] ?? 'default',
    mode: 'default',
    copilotMode: 'interactive',
  }
}

export function launchParameters(agent: AgentFlavor, settings: LaunchSettings, fastMode: boolean) {
  const managedPermission = agent === 'pi' || agent === 'dsh'
  return {
    agent,
    model: settings.model === 'auto' ? undefined : settings.model,
    effort:
      ['claude', 'agy', 'grok', 'pi'].includes(agent) && settings.effort !== 'auto'
        ? settings.effort
        : undefined,
    modelReasoningEffort:
      (agent === 'codex' || agent === 'opencode') && settings.reasoning !== 'default'
        ? settings.reasoning
        : undefined,
    permissionMode: managedPermission ? undefined : settings.permission,
    collaborationMode: agent === 'codex' && settings.mode !== 'default' ? settings.mode : undefined,
    copilotAgentMode: agent === 'copilot' ? settings.copilotMode : undefined,
    serviceTier: fastMode ? settings.tier : undefined,
  }
}
