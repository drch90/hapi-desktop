import { z } from 'zod'
import { CREATABLE_AGENT_FLAVORS, getPermissionModesForFlavor, type AgentFlavor } from '@hapi/protocol'
import { PermissionModeSchema } from '@hapi/protocol/schemas'
import { defaultLaunchSettings, type LaunchSettings } from '../components/agent-settings/launchSettings'

const launchPreferencesSchema = z.object({
  model: z.string().min(1).max(2048).catch('auto'),
  effort: z.string().min(1).max(128).catch('auto'),
  reasoning: z.string().min(1).max(128).catch('default'),
  permission: PermissionModeSchema.optional().catch(undefined),
})

function launchKey(scope: string, machineId: string, agent: AgentFlavor) {
  return `desktop:new-session-launch:v1:${JSON.stringify([scope, machineId, agent])}`
}

export function loadPreferredAgent(scope: string): AgentFlavor {
  try {
    const stored = localStorage.getItem(`desktop:new-session-agent:${scope}`)
    return CREATABLE_AGENT_FLAVORS.find((agent) => agent === stored) ?? 'codex'
  } catch {
    return 'codex'
  }
}

/** Web remembers CLI selection immediately, including when creation is cancelled. */
export function rememberPreferredAgent(scope: string, agent: AgentFlavor): void {
  if (!CREATABLE_AGENT_FLAVORS.includes(agent)) return
  try {
    localStorage.setItem(`desktop:new-session-agent:${scope}`, agent)
  } catch {
    // Preferences are optional when storage is full or unavailable.
  }
}

export function loadPreferredLaunchSettings(
  scope: string,
  machineId: string,
  agent: AgentFlavor,
): LaunchSettings {
  const defaults = defaultLaunchSettings(agent)
  if (!machineId) return defaults
  try {
    const saved = launchPreferencesSchema.parse(
      JSON.parse(localStorage.getItem(launchKey(scope, machineId, agent)) ?? 'null'),
    )
    return {
      ...defaults,
      ...saved,
      permission:
        saved.permission && getPermissionModesForFlavor(agent).includes(saved.permission)
          ? saved.permission
          : defaults.permission,
    }
  } catch {
    return defaults
  }
}

/** Save only confirmed launches. Modes, worktree names and fast tier remain per launch, as on Web. */
export function rememberLaunchSettings(
  scope: string,
  machineId: string,
  agent: AgentFlavor,
  settings: LaunchSettings,
): void {
  if (!machineId) return
  try {
    localStorage.setItem(
      launchKey(scope, machineId, agent),
      JSON.stringify(launchPreferencesSchema.parse(settings)),
    )
  } catch {
    // A preference write must not turn a confirmed remote launch into a failure.
  }
}
