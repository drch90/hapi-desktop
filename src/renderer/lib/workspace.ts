import { z } from 'zod'

const paneSchema = z.object({ tabs: z.array(z.string().max(256)).max(60), active: z.string().nullable() })
export const workspaceSchema = z.object({
  panes: z.tuple([paneSchema, paneSchema]),
  split: z.boolean(),
  focused: z.union([z.literal(0), z.literal(1)]),
  ratio: z.number().min(0.3).max(0.7),
  sidePanel: z.boolean(),
  collapsedHistoryGroups: z.array(z.string()).default([]),
  expandedHistoryGroups: z.array(z.string()).default([]),
})
export type Workspace = z.infer<typeof workspaceSchema>
export type PaneId = 0 | 1
export const emptyWorkspace: Workspace = {
  panes: [
    { tabs: [], active: null },
    { tabs: [], active: null },
  ],
  split: false,
  focused: 0,
  ratio: 0.5,
  sidePanel: false,
  collapsedHistoryGroups: [],
  expandedHistoryGroups: [],
}
export type WorkspaceAction =
  | { type: 'open'; id: string; pane?: PaneId }
  | { type: 'close'; id: string }
  | { type: 'move'; id: string; pane: PaneId }
  | { type: 'replace'; from: string; to: string }
  | { type: 'focus'; pane: PaneId }
  | { type: 'split' }
  | { type: 'ratio'; ratio: number }
  | { type: 'side-panel' }
  | { type: 'toggle-history-group'; key: string; defaultCollapsed?: boolean }

export function isHistoryGroupCollapsed(state: Workspace, key: string, defaultCollapsed: boolean): boolean {
  if (state.expandedHistoryGroups.includes(key)) return false
  return state.collapsedHistoryGroups.includes(key) || defaultCollapsed
}

export function reduceWorkspace(state: Workspace, action: WorkspaceAction): Workspace {
  if (action.type === 'toggle-history-group') {
    const collapsed = isHistoryGroupCollapsed(state, action.key, action.defaultCollapsed ?? false)
    return {
      ...state,
      collapsedHistoryGroups: collapsed
        ? state.collapsedHistoryGroups.filter((key) => key !== action.key)
        : [...state.collapsedHistoryGroups, action.key],
      expandedHistoryGroups: collapsed
        ? [...state.expandedHistoryGroups, action.key]
        : state.expandedHistoryGroups.filter((key) => key !== action.key),
    }
  }
  const next: Workspace = {
    ...state,
    panes: [
      { ...state.panes[0], tabs: [...state.panes[0].tabs] },
      { ...state.panes[1], tabs: [...state.panes[1].tabs] },
    ],
  }
  if (action.type === 'focus') return { ...state, focused: action.pane }
  if (action.type === 'side-panel') return { ...state, sidePanel: !state.sidePanel }
  if (action.type === 'ratio') return { ...state, ratio: Math.max(0.3, Math.min(0.7, action.ratio)) }
  if (action.type === 'split') {
    if (state.split) {
      next.panes[0].tabs = [...new Set([...next.panes[0].tabs, ...next.panes[1].tabs])]
      next.panes[0].active = state.panes[state.focused].active ?? next.panes[0].active
      next.panes[1] = { tabs: [], active: null }
      next.focused = 0
    }
    next.split = !state.split
    return next
  }
  if (action.type === 'replace') {
    const sourcePane = next.panes.findIndex((p) => p.tabs.includes(action.from))
    if (action.from === action.to || sourcePane < 0) return state
    for (const pane of next.panes) {
      pane.tabs = pane.tabs
        .filter((id) => id !== action.to || id === action.from)
        .map((id) => (id === action.from ? action.to : id))
      if (pane.active === action.from) pane.active = action.to
      else if (pane.active === action.to && sourcePane !== next.panes.indexOf(pane))
        pane.active = pane.tabs[0] ?? null
    }
    return next
  }
  if (action.type === 'close' || action.type === 'move') {
    for (const pane of next.panes) {
      const index = pane.tabs.indexOf(action.id)
      if (index < 0) continue
      pane.tabs.splice(index, 1)
      if (pane.active === action.id) pane.active = pane.tabs[Math.max(0, index - 1)] ?? null
    }
    if (action.type === 'close') return next
    next.panes[action.pane].tabs.push(action.id)
    next.panes[action.pane].active = action.id
    next.focused = action.pane
    next.split = true
    return next
  }
  const existing = next.panes.findIndex((pane) => pane.tabs.includes(action.id))
  const target = existing < 0 ? (action.pane ?? state.focused) : (existing as PaneId)
  if (existing < 0) next.panes[target].tabs.push(action.id)
  next.panes[target].active = action.id
  next.focused = target
  if (target === 1) next.split = true
  return next
}

export function loadWorkspace(scope: string): Workspace {
  try {
    const workspace = workspaceSchema.parse(
      JSON.parse(localStorage.getItem(`desktop:workspace:${scope}`) ?? 'null'),
    )
    const seen = new Set<string>()
    for (const pane of workspace.panes) {
      pane.tabs = pane.tabs.filter((id) => {
        if (seen.has(id)) return false
        seen.add(id)
        return true
      })
      if (!pane.active || !pane.tabs.includes(pane.active)) pane.active = pane.tabs[0] ?? null
    }
    if (!workspace.split) {
      workspace.panes[0].tabs.push(...workspace.panes[1].tabs)
      workspace.panes[0].active ??= workspace.panes[0].tabs[0] ?? null
      workspace.panes[1] = { tabs: [], active: null }
      workspace.focused = 0
    }
    return workspace
  } catch {
    return structuredClone(emptyWorkspace)
  }
}

export type Draft = { text: string; scrollTop: number; expanded: string[] }
const draftSchema = z.object({ text: z.string(), scrollTop: z.number(), expanded: z.array(z.string()) })
export function loadDraft(scope: string, id: string): Draft {
  try {
    return draftSchema.parse(JSON.parse(localStorage.getItem(`desktop:draft:${scope}:${id}`) ?? 'null'))
  } catch {
    return { text: '', scrollTop: -1, expanded: [] }
  }
}
export function saveDraft(scope: string, id: string, draft: Draft) {
  localStorage.setItem(`desktop:draft:${scope}:${id}`, JSON.stringify(draft))
}

export function migrateSessionLocalState(scope: string, from: string, to: string) {
  if (from === to) return
  for (const family of ['draft', 'outbox']) {
    const key = `desktop:${family}:${scope}:`
    const source = localStorage.getItem(key + from)
    if (source !== null) {
      localStorage.setItem(key + to, source)
      localStorage.removeItem(key + from)
    }
  }
}
