import { useTranslation } from 'react-i18next'
import {
  getPermissionModeOptionsForFlavor,
  getCodexCollaborationModeOptions,
  getCopilotAgentModeOptions,
  getClaudeEffortLevelsForModel,
  resolveClaudeEffortForModel,
  isKnownFlavor,
  splitAgyModelSelection,
  type Session,
} from '@hapi/protocol'
import {
  getClaudeCatalogOptions,
  getModelOptionsForFlavor,
  type ModelOption,
} from '@/components/AssistantChat/modelOptions'
import { getClaudeComposerEffortOptions } from '@/components/AssistantChat/claudeEffortOptions'
import { getCodexComposerReasoningEffortOptions } from '@/components/AssistantChat/codexReasoningEffortOptions'
import { getPiThinkingLevelOptions } from '@/components/AssistantChat/piThinkingLevelOptions'
import { codexModelAdvertisesFastTier } from '@/components/AssistantChat/codexFastMode'
import { getCodexModelReasoningEfforts } from '@/lib/codexModelCapabilities'
import { mergeCursorCliModelSkus } from '@/lib/cursorPickerState'
import type { DesktopApi } from '../../lib/api'
import {
  agyEffortOptions,
  agyModelOptions,
  catalogOptions,
  cursorModelOptions,
  findPiModel,
  piModelOptions,
} from './modelOptions'
import { useSessionCatalogs } from './useSessionCatalogs'

export type SessionSettingField = 'mode' | 'permission' | 'model' | 'effort' | 'copilotMode' | 'tier'

export function useSessionSettings(api: DesktopApi, session: Session, connected: boolean) {
  const { t } = useTranslation()
  const flavor = session.metadata?.flavor
  const supported = isKnownFlavor(flavor)
  const controlled =
    session.agentState?.controlledByUser === true && !session.metadata?.capabilities?.concurrentClients
  const waitingForTurn = flavor === 'hermes' && session.thinking
  const editable = supported && connected && session.active && !controlled && !waitingForTurn
  const catalogs = useSessionCatalogs(api, session, editable)
  const managedPermission = flavor === 'dsh' || flavor === 'pi'
  const permissions = supported
    ? getPermissionModeOptionsForFlavor(flavor).filter(
        (option) =>
          (!session.metadata?.capabilities?.concurrentClients || option.mode !== 'safe-yolo') &&
          !(flavor === 'grok' && option.mode === 'auto' && catalogs.autoPermissionModeSupported === false),
      )
    : []
  const modes = flavor === 'codex' ? getCodexCollaborationModeOptions() : []
  const copilotModes = flavor === 'copilot' ? getCopilotAgentModeOptions() : []
  const fastMode =
    flavor === 'codex' &&
    !catalogs.codex.error &&
    codexModelAdvertisesFastTier(session.model, catalogs.codex.models)
  let modelValue = session.model === 'auto' || session.model === 'default' ? '' : (session.model ?? '')
  let choices: ModelOption[] = []
  switch (flavor) {
    case 'claude':
      choices = getModelOptionsForFlavor(
        flavor,
        session.model,
        getClaudeCatalogOptions(catalogs.claude.availableModels, t('Other models')),
      )
      break
    case 'codex':
      choices = catalogs.codex.models.map((model) => ({ value: model.id, label: model.displayName }))
      break
    case 'hermes':
      choices = catalogOptions(catalogs.hermes.availableModels)
      break
    case 'opencode':
      choices = catalogOptions(catalogs.opencode.availableModels)
      break
    case 'grok':
      choices = [{ value: null, label: 'Default' }, ...catalogOptions(catalogs.grok.availableModels)]
      break
    case 'copilot':
      choices = [{ value: null, label: 'Auto' }, ...catalogOptions(catalogs.copilot.availableModels)]
      break
    case 'kimi':
      choices = catalogOptions(catalogs.kimi.availableModels)
      break
    case 'dsh':
      choices = catalogs.dsh.availableModels.length
        ? [{ value: null, label: 'Default' }, ...catalogOptions(catalogs.dsh.availableModels)]
        : []
      break
    case 'agy': {
      choices = agyModelOptions(catalogs.agy.availableModels)
      const base = splitAgyModelSelection(session.model).model
      if (choices.some((option) => option.value === base)) modelValue = base ?? ''
      break
    }
    case 'cursor':
      choices = cursorModelOptions({
        machineModels: catalogs.machineCursor.availableModels,
        sessionModels: catalogs.cursor.availableModels,
        cliModelSkus: mergeCursorCliModelSkus(
          catalogs.machineCursor.cliModelSkus,
          catalogs.cursor.cliModelSkus,
        ),
        currentModel: session.model,
      }).map((option) => ({ ...option, value: option.value === 'auto' ? null : option.value }))
      break
    case 'pi': {
      choices = piModelOptions(catalogs.pi.availableModels)
      const selected =
        session.metadata?.piSelectedModel ?? findPiModel(catalogs.pi.availableModels, session.model)
      if (selected) modelValue = `${selected.provider}/${selected.modelId}`
      break
    }
    case 'gemini':
      choices = getModelOptionsForFlavor(flavor, session.model)
      break
  }
  const catalogReady = choices.length > 0
  const modelOptions = choices.some((option) => (option.value ?? '') === modelValue)
    ? choices
    : [{ value: modelValue || null, label: modelValue || 'Default' }, ...choices]
  const reasoningAgent = flavor === 'codex' || flavor === 'opencode'
  const effort = reasoningAgent
    ? session.modelReasoningEffort
    : (session.effort ?? (flavor === 'agy' ? splitAgyModelSelection(session.model).effort : null))
  const piModel = findPiModel(catalogs.pi.availableModels, modelValue)
  let effortOptions: ModelOption[] = []
  switch (flavor) {
    case 'claude':
      effortOptions = getClaudeComposerEffortOptions(
        effort,
        getClaudeEffortLevelsForModel(session.model, catalogs.claude.availableModels),
      )
      break
    case 'codex':
    case 'opencode':
      effortOptions = getCodexComposerReasoningEffortOptions(
        effort,
        flavor,
        flavor === 'codex'
          ? getCodexModelReasoningEfforts(catalogs.codex.models, session.model)?.map((value) => ({ value }))
          : catalogs.opencodeEffort.options,
      )
      break
    case 'grok':
      effortOptions = [
        { value: null, label: 'Default' },
        ...catalogs.grokEffort.options.map((option) => ({
          value: option.value,
          label: option.name ?? option.value,
        })),
      ]
      break
    case 'agy': {
      const options = agyEffortOptions(catalogs.agy.availableModels, modelValue)
      if (options.length) effortOptions = [{ value: null, label: 'Default' }, ...options]
      break
    }
    case 'pi':
      if (piModel && piModel.reasoning !== false)
        effortOptions = getPiThinkingLevelOptions(effort, piModel.thinkingLevelMap)
      break
  }
  const modelsDisabled = !editable || !catalogReady || catalogs.isLoading || Boolean(catalogs.error)
  const effortDisabled =
    !editable ||
    !effortOptions.length ||
    (flavor !== 'claude' && (catalogs.isLoading || Boolean(catalogs.error)))

  async function apply(field: SessionSettingField, value: string) {
    if (!editable) return false
    if (field === 'permission') {
      const option = permissions.find((option) => option.mode === value)
      if (!option) return false
      await api.setPermissionMode(session.id, option.mode)
    } else if (field === 'mode') {
      const option = modes.find((option) => option.mode === value)
      if (!option) return false
      await api.setCollaborationMode(session.id, option.mode)
    } else if (field === 'copilotMode') {
      const option = copilotModes.find((option) => option.mode === value)
      if (!option) return false
      await api.setCopilotAgentMode(session.id, option.mode)
    } else if (field === 'tier') {
      if (!fastMode || (value !== 'fast' && value !== 'standard')) return false
      await api.setServiceTier(session.id, value)
    } else if (field === 'model') {
      if (modelsDisabled || !choices.some((option) => (option.value ?? '') === value)) return false
      if (flavor === 'pi') {
        const model = catalogs.pi.availableModels.find(
          (model) => `${model.provider}/${model.modelId}` === value,
        )
        if (!model) return false
        await api.setModel(session.id, { provider: model.provider, modelId: model.modelId })
      } else {
        const nextEffort =
          flavor === 'claude'
            ? resolveClaudeEffortForModel(session.effort, value || null, catalogs.claude.availableModels)
            : agyEffortOptions(catalogs.agy.availableModels, value).some((option) => option.value === effort)
              ? (effort ?? null)
              : null
        await api.setModel(
          session.id,
          value || null,
          flavor === 'claude' || flavor === 'agy' ? { effort: nextEffort } : undefined,
        )
      }
    } else {
      if (effortDisabled || !effortOptions.some((option) => (option.value ?? '') === value)) return false
      if (reasoningAgent) await api.setModelReasoningEffort(session.id, value || null)
      else await api.setEffort(session.id, value || null)
    }
    return true
  }
  return {
    flavor,
    supported,
    editable,
    waitingForTurn,
    catalogs,
    managedPermission,
    permissions,
    modes,
    copilotModes,
    fastMode,
    modelValue,
    modelOptions,
    modelsDisabled,
    effort,
    effortOptions,
    effortDisabled,
    apply,
  }
}
