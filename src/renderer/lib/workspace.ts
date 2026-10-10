import { z } from 'zod'

const paneSchema = z.object({ tabs: z.array(z.string().max(256)).max(60), active: z.string().nullable() })
export const workspaceSchema = z.object({
  panes: z.tuple([paneSchema, paneSchema]),
  split: z.boolean(),
  focused: z.union([z.literal(0), z.literal(1)]),
  ratio: z.number().min(0.3).max(0.7),
  sidePanel: z.boolean(),
  filePanelWidth: z.number().min(240).max(960).default(335),
  sidebarWidth: z.number().min(220).max(480).default(272),
  sidebarCollapsed: z.boolean().default(false),
  closedTabs: z
    .array(
      z.object({
        id: z.string().max(256),
        pane: z.union([z.literal(0), z.literal(1)]),
        index: z.number().int().min(0),
      }),
    )
    .max(30)
    .default([]),
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
  filePanelWidth: 335,
  sidebarWidth: 272,
  sidebarCollapsed: false,
  closedTabs: [],
  collapsedHistoryGroups: [],
  expandedHistoryGroups: [],
}
export type WorkspaceAction =
  | { type: 'open'; id: string; pane?: PaneId }
  | { type: 'close'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'close-tabs'; pane: PaneId; id: string; range: 'left' | 'right' | 'all' | 'others' }
  | { type: 'restore'; available: string[] }
  | { type: 'place'; id: string; pane: PaneId; index: number }
  | { type: 'sidebar-width'; width: number }
  | { type: 'sidebar'; collapsed?: boolean }
  | { type: 'move'; id: string; pane: PaneId }
  | { type: 'replace'; from: string; to: string }
  | { type: 'focus'; pane: PaneId }
  | { type: 'split' }
  | { type: 'ratio'; ratio: number }
  | { type: 'side-panel' }
  | { type: 'file-panel-width'; width: number }
  | { type: 'toggle-history-group'; key: string; defaultCollapsed?: boolean }

export function isHistoryGroupCollapsed(state: Workspace, key: string, defaultCollapsed: boolean): boolean {
  if (state.expandedHistoryGroups.includes(key)) return false
  return state.collapsedHistoryGroups.includes(key) || defaultCollapsed
}

export function reduceWorkspace(state: Workspace, action: WorkspaceAction): Workspace {
  if (action.type === 'sidebar')
    return { ...state, sidebarCollapsed: action.collapsed ?? !state.sidebarCollapsed }
  if (action.type === 'sidebar-width')
    return { ...state, sidebarWidth: Math.max(220, Math.min(480, action.width)) }
  if (action.type === 'restore') {
    const records = [...state.closedTabs]
    while (records.length) {
      const record = records.pop()!
      if (!action.available.includes(record.id)) continue
      const next = { ...state, closedTabs: records }
      if (state.panes.some((pane) => pane.tabs.includes(record.id)))
        return reduceWorkspace(next, { type: 'open', id: record.id })
      const pane = state.split ? record.pane : state.focused
      const opened = reduceWorkspace(next, { type: 'open', id: record.id, pane })
      return reduceWorkspace(opened, { type: 'place', id: record.id, pane, index: record.index })
    }
    return { ...state, closedTabs: [] }
  }
  if (action.type === 'close-tabs') {
    const tabs = state.panes[action.pane].tabs
    const index = tabs.indexOf(action.id)
    if (index < 0) return state
    const ids =
      action.range === 'all'
        ? tabs
        : action.range === 'others'
          ? tabs.filter((id) => id !== action.id)
          : action.range === 'left'
            ? tabs.slice(0, index)
            : tabs.slice(index + 1)
    // Close right to left so every saved index still describes the original position.
    return [...ids].reverse().reduce((next, id) => reduceWorkspace(next, { type: 'close', id }), state)
  }
  if (action.type === 'place') {
    const source = state.panes.findIndex((pane) => pane.tabs.includes(action.id))
    if (source < 0) return state
    const next = structuredClone(state)
    const sourcePane = next.panes[source]
    const from = sourcePane.tabs.indexOf(action.id)
    sourcePane.tabs.splice(from, 1)
    const target = next.panes[action.pane]
    target.tabs.splice(Math.max(0, Math.min(target.tabs.length, action.index)), 0, action.id)
    if (source !== action.pane) {
      if (sourcePane.active === action.id) sourcePane.active = sourcePane.tabs[Math.max(0, from - 1)] ?? null
      target.active = action.id
      next.focused = action.pane
      next.split = true
    }
    return next
  }
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
  if (action.type === 'file-panel-width')
    return { ...state, filePanelWidth: Math.max(240, Math.min(960, action.width)) }
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
    next.closedTabs = next.closedTabs.map((record) =>
      record.id === action.from ? { ...record, id: action.to } : record,
    )
    const sourcePane = next.panes.findIndex((p) => p.tabs.includes(action.from))
    if (action.from === action.to || sourcePane < 0) return next
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
  if (action.type === 'close' || action.type === 'move' || action.type === 'remove') {
    if (action.type === 'remove')
      next.closedTabs = state.closedTabs.filter((record) => record.id !== action.id)
    for (const pane of next.panes) {
      const index = pane.tabs.indexOf(action.id)
      if (index < 0) continue
      if (action.type === 'close')
        next.closedTabs = [
          ...state.closedTabs.filter((record) => record.id !== action.id),
          { id: action.id, pane: next.panes.indexOf(pane) as PaneId, index },
        ].slice(-30)
      pane.tabs.splice(index, 1)
      if (pane.active === action.id) pane.active = pane.tabs[Math.max(0, index - 1)] ?? null
    }
    if (action.type !== 'move') return next
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

export type Draft = { text: string; scrollTop: number; expanded: string[]; scheduledAt?: number | null }
const draftSchema = z.object({
  text: z.string(),
  scrollTop: z.number(),
  expanded: z.array(z.string()),
  scheduledAt: z.number().nullable().optional(),
})
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
  for (const family of ['draft', 'outbox', 'queue-edit']) {
    const key = `desktop:${family}:${scope}:`
    const source = localStorage.getItem(key + from)
    if (source !== null) {
      localStorage.setItem(key + to, source)
      localStorage.removeItem(key + from)
    }
  }
}
