import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getClaudeEffortLevelsForModel, resolveClaudeEffortForModel, type AgentFlavor } from '@hapi/protocol'
import { getClaudeLaunchModelOptions } from '@/components/AssistantChat/modelOptions'
import { getClaudeComposerEffortOptions } from '@/components/AssistantChat/claudeEffortOptions'
import { getCodexComposerReasoningEffortOptions } from '@/components/AssistantChat/codexReasoningEffortOptions'
import { getPiThinkingLevelOptions } from '@/components/AssistantChat/piThinkingLevelOptions'
import { codexModelAdvertisesFastTier } from '@/components/AssistantChat/codexFastMode'
import { buildGrokEffortOptions } from '@/components/NewSession/grokModels'
import { CODEX_REASONING_EFFORT_OPTIONS, isOpencodeReasoningEffortValid } from '@/components/NewSession/types'
import { getCodexModelReasoningEfforts } from '@/lib/codexModelCapabilities'
import type { DesktopApi } from '../../lib/api'
import {
  agyEffortOptions,
  agyModelOptions,
  catalogOptions,
  cursorModelOptions,
  findPiModel,
  piModelOptions,
  type SelectOption,
} from './modelOptions'
import {
  defaultLaunchSettings,
  defaultModelSettings,
  launchParameters,
  type LaunchSettings,
} from './launchSettings'
import { useLaunchCatalogs, usesDirectoryModels } from './useLaunchCatalogs'

export function useLaunchSettings(args: {
  api: DesktopApi
  agent: AgentFlavor
  machineId: string
  directory: string
  cwd: string
  pathReady: boolean
  enabled: boolean
}) {
  const { t } = useTranslation()
  const { agent, machineId, directory, pathReady } = args
  const scopeKey = JSON.stringify([machineId, agent])
  const [stored, setStored] = useState({ scopeKey, directory, value: defaultLaunchSettings(agent) })
  const previous = stored.scopeKey === scopeKey ? stored.value : defaultLaunchSettings(agent)
  // Derive reset values immediately so a late catalog response cannot leak a model
  // into another machine, CLI, or directory between render and an effect.
  const settings =
    usesDirectoryModels(agent) && stored.directory !== directory
      ? { ...previous, ...defaultModelSettings }
      : { ...previous }
  const catalogs = useLaunchCatalogs(args)
  const withDefault = (options: SelectOption[]) => [{ value: 'auto', label: t('Default') }, ...options]
  const optionsByAgent: Record<AgentFlavor, SelectOption[]> = {
    claude: getClaudeLaunchModelOptions(
      catalogs.claude.availableModels,
      settings.model,
      t('Not in current model list'),
      t('Other models'),
    ),
    codex: withDefault(catalogs.codex.models.map((model) => ({ value: model.id, label: model.displayName }))),
    agy: withDefault(agyModelOptions(catalogs.agy.availableModels)),
    cursor: cursorModelOptions({
      machineModels: catalogs.cursor.availableModels,
      cliModelSkus: catalogs.cursor.cliModelSkus,
    }),
    grok: withDefault(catalogOptions(catalogs.grok.availableModels)),
    copilot: withDefault(catalogOptions(catalogs.copilot.availableModels)),
    pi: withDefault(piModelOptions(catalogs.pi.availableModels)),
    kimi: withDefault(catalogOptions(catalogs.kimi.availableModels)),
    dsh: withDefault(catalogOptions(catalogs.dsh.availableModels)),
    opencode: withDefault(catalogOptions(catalogs.opencode.availableModels)),
    hermes: withDefault(catalogOptions(catalogs.hermes.availableModels)),
    gemini: [],
  }
  const modelOptions = [...optionsByAgent[agent]]
  if (
    agent !== 'claude' &&
    agent !== 'hermes' &&
    !catalogs.isLoading &&
    !catalogs.error &&
    (!usesDirectoryModels(agent) || pathReady) &&
    !modelOptions.some((option) => option.value === settings.model)
  )
    settings.model = 'auto'

  const effectiveModel = settings.model === 'auto' ? null : settings.model
  const claudeEfforts = getClaudeComposerEffortOptions(
    null,
    getClaudeEffortLevelsForModel(effectiveModel, catalogs.claude.availableModels),
  ).map((option) => ({ value: option.value ?? 'auto', label: t(option.label) }))
  const agyEfforts = agyEffortOptions(
    catalogs.agy.availableModels,
    effectiveModel ?? catalogs.agy.currentModelId,
  )
  const grokEfforts = buildGrokEffortOptions(
    catalogs.grok.availableModels,
    settings.model,
    catalogs.grok.currentModelId,
  )
  const piModel = findPiModel(catalogs.pi.availableModels, effectiveModel)
  const piEfforts =
    piModel?.reasoning === false ? [] : getPiThinkingLevelOptions(null, piModel?.thinkingLevelMap)
  const effortOptions =
    agent === 'agy' ? agyEfforts : agent === 'grok' ? grokEfforts : agent === 'pi' ? piEfforts : claudeEfforts
  if (agent === 'claude') {
    settings.effort =
      resolveClaudeEffortForModel(
        settings.effort === 'auto' ? null : settings.effort,
        effectiveModel,
        catalogs.claude.availableModels,
      ) ?? 'auto'
  } else if (
    !catalogs.isLoading &&
    settings.effort !== 'auto' &&
    !effortOptions.some((option) => option.value === settings.effort)
  ) {
    settings.effort = 'auto'
  }
  const codexEfforts = getCodexModelReasoningEfforts(catalogs.codex.models, settings.model)
  const opencodeModel = effectiveModel ?? catalogs.opencode.currentModelId
  const variants =
    opencodeModel && catalogs.variants.variants && !catalogs.variants.error
      ? (catalogs.variants.variants[opencodeModel] ?? [])
      : null
  if (
    !catalogs.isLoading &&
    settings.reasoning !== 'default' &&
    ((agent === 'codex' && codexEfforts && !codexEfforts.includes(settings.reasoning)) ||
      (agent === 'opencode' && !isOpencodeReasoningEffortValid(settings.reasoning, variants)))
  )
    settings.reasoning = 'default'
  if (
    agent === 'grok' &&
    settings.permission === 'auto' &&
    catalogs.grok.autoPermissionModeSupported === false
  ) {
    settings.permission = 'default'
  }
  const fastMode =
    agent === 'codex' &&
    !catalogs.codex.error &&
    codexModelAdvertisesFastTier(effectiveModel, catalogs.codex.models)
  if (!fastMode && !catalogs.isLoading) settings.tier = 'standard'
  const pending = catalogs.isLoading
  const showEffort =
    agent === 'codex' ||
    agent === 'claude' ||
    agent === 'grok' ||
    (agent === 'opencode' && variants?.length !== 0) ||
    (agent === 'agy' && agyEfforts.length > 0) ||
    (agent === 'pi' && piEfforts.length > 0)
  const reasoningAgent = agent === 'codex' || agent === 'opencode'
  let effortFieldOptions = effortOptions
  if (agent === 'agy' || agent === 'pi') effortFieldOptions = withDefault(effortOptions)
  if (agent === 'codex')
    effortFieldOptions = getCodexComposerReasoningEffortOptions(
      null,
      agent,
      codexEfforts?.map((value) => ({ value })),
    ).map((option) => ({ ...option, value: option.value ?? 'default' }))
  if (agent === 'opencode')
    effortFieldOptions =
      variants === null
        ? CODEX_REASONING_EFFORT_OPTIONS.filter((option) => option.value !== 'xhigh')
        : [{ value: 'default', label: 'Default' }, ...variants.map((value) => ({ value, label: value }))]

  if (settings.model !== 'auto' && !modelOptions.some((option) => option.value === settings.model)) {
    modelOptions.push({
      value: settings.model,
      label: `${settings.model} (${t('Not in current model list')})`,
    })
  }
  useEffect(() => {
    const changed = (Object.keys(settings) as (keyof LaunchSettings)[]).some(
      (key) => stored.value[key] !== settings[key],
    )
    if (stored.scopeKey !== scopeKey || stored.directory !== directory || changed) {
      setStored({ scopeKey, directory, value: settings })
    }
  }, [scopeKey, directory, settings, stored])

  function change(patch: Partial<LaunchSettings>) {
    setStored({ scopeKey, directory, value: { ...settings, ...patch } })
  }

  return {
    agent,
    settings,
    catalogs,
    modelOptions,
    codexEfforts,
    variants,
    piModel,
    claudeEfforts,
    agyEfforts,
    grokEfforts,
    fastMode,
    showEffort,
    reasoningAgent,
    effortFieldOptions,
    pending,
    change,
    modelDisabled:
      catalogs.isLoading || Boolean(catalogs.error) || (usesDirectoryModels(agent) && !pathReady),
    parameters: launchParameters(agent, settings, fastMode),
  }
}
