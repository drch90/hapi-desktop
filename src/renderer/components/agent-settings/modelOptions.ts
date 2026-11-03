import { getAgyModelChoices, splitAgyModelSelection, type PiModelSummary } from '@hapi/protocol'
import { groupModelsByProvider } from '@/components/AssistantChat/piModelGroups'
import type { ModelOption } from '@/components/AssistantChat/modelOptions'
import { buildCursorCatalogFromSources } from '@/lib/cursorPickerState'
import { buildFlatCursorModelPickerOptions } from '@/lib/cursorModelOptions'
import type { AgyModelSummary, CursorModelSummary } from '@/types/api'

export type SelectOption = { value: string; label: string; group?: string }

export function catalogOptions(models: readonly { modelId: string; name?: string }[]): SelectOption[] {
  return models
    .filter((model) => model.modelId !== 'auto')
    .map((model) => ({
      value: model.modelId,
      label: model.name ?? model.modelId,
    }))
}

export function piModelOptions(models: PiModelSummary[]): SelectOption[] {
  return groupModelsByProvider(models).flatMap((group) =>
    group.models.map((model) => ({
      value: `${model.provider}/${model.modelId}`,
      label: model.name ?? model.modelId,
      group: group.label,
    })),
  )
}

export function findPiModel(models: PiModelSummary[], value: string | null | undefined) {
  // Match the full qualified ID before accepting the legacy unqualified value.
  const qualified = models.find((model) => `${model.provider}/${model.modelId}` === value)
  if (qualified) return qualified
  const legacy = models.filter((model) => model.modelId === value)
  return legacy.length === 1 ? legacy[0] : undefined
}

export function agyModelOptions(models: AgyModelSummary[]) {
  return getAgyModelChoices(models).map((model) => ({ value: model.modelId, label: model.name }))
}

export function agyEffortOptions(models: AgyModelSummary[], selected: string | null | undefined) {
  const choices = getAgyModelChoices(models)
  const base = splitAgyModelSelection(selected).model
  const selectedChoice = choices.find((choice) => choice.modelId === selected || choice.modelId === base)
  const labels = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' }
  return selectedChoice?.supportedEfforts.map((value) => ({ value, label: labels[value] })) ?? []
}

export function cursorModelOptions(args: {
  machineModels: CursorModelSummary[]
  sessionModels?: CursorModelSummary[]
  cliModelSkus: CursorModelSummary[]
  currentModel?: string | null
}): SelectOption[] {
  const catalog = buildCursorCatalogFromSources({
    ...args,
    sessionModels: args.sessionModels ?? [],
    currentWireId: args.currentModel,
    defaultValue: 'auto',
  })
  // Every row is a complete server wire ID, including its effort/speed variant.
  // Never submit a synthetic base model while a separate variant is undecided.
  return buildFlatCursorModelPickerOptions(catalog, { defaultValue: 'auto' }).map((option) => {
    const base = catalog.wireToBase.get(option.value)
    const variants = base ? catalog.variantsByBase.get(base) : undefined
    const label = catalog.baseOptions.find((row) => row.value === base)?.label
    return label && variants && variants.length > 1
      ? { ...option, label: `${label} · ${option.label}` }
      : option
  })
}

export function groupModelOptions<T extends ModelOption>(options: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const option of options) {
    const group = option.group ?? ''
    const rows = groups.get(group) ?? []
    rows.push(option)
    groups.set(group, rows)
  }
  return [...groups]
}
