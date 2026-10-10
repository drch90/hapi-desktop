import type { SessionSummary } from '@hapi/protocol'
import { buildSessionSearchScoreIndex, compareSessionsBySearchRelevance } from '@/lib/sessionListSearch'

type SessionStatusSection = { key: string; title: string | null; sessions: SessionSummary[] }
export type SessionGroup = [
  string,
  {
    machine: string
    machineId: string | null
    path: string
    hasDirectory: boolean
    sessions: SessionSummary[]
    sections: SessionStatusSection[]
  },
]
export type SessionSection = { key: string; title: string | null; groups: SessionGroup[] }
type Machine = { id: string; metadata?: { displayName?: string; host?: string } | null }

export function sessionWorkspaceKey(session: Pick<SessionSummary, 'metadata'>): string {
  const path = session.metadata?.path?.trim() ? session.metadata.path : '—'
  return `${session.metadata?.machineId ?? null}:${path}`
}

export function selectSessionList(options: {
  sessions: SessionSummary[]
  machines: Machine[]
  search: string
  status: string
  machine: string
  unreadOnly: boolean
  lastSeen: Readonly<Record<string, number>>
  scope: string
  byStatus: boolean
}): SessionSection[] {
  const machineLabel = (id: string | null) => {
    const machine = options.machines.find((item) => item.id === id)
    return machine?.metadata?.displayName || machine?.metadata?.host || id?.slice(0, 8) || 'HAPI'
  }
  const query = options.search.trim()
  const searchIndex = buildSessionSearchScoreIndex(options.sessions, query, machineLabel)
  const compare = (a: SessionSummary, b: SessionSummary) =>
    query ? compareSessionsBySearchRelevance(a, b, searchIndex) : b.updatedAt - a.updatedAt
  const rows = options.sessions
    .filter((row) => {
      if (
        (options.status === 'Active' && !row.active) ||
        (options.status === 'Pending' && !row.pendingRequestsCount) ||
        (options.status === 'History' && row.active)
      )
        return false
      if (options.machine && (row.metadata?.machineId ?? '__unknown__') !== options.machine) return false
      if (options.unreadOnly && row.updatedAt <= (options.lastSeen[`${options.scope}:${row.id}`] ?? 0))
        return false
      return !query || searchIndex.matchedIds.has(row.id)
    })
    .sort(compare)
  const statusSections = (sessions: SessionSummary[]): SessionStatusSection[] =>
    options.byStatus
      ? [
          {
            key: 'thinking',
            title: 'In progress',
            sessions: sessions.filter((row) => row.active && row.thinking),
          },
          {
            key: 'active',
            title: 'Active sessions',
            sessions: sessions.filter((row) => row.active && !row.thinking),
          },
          { key: 'history', title: 'History sessions', sessions: sessions.filter((row) => !row.active) },
        ].filter((section) => section.sessions.length)
      : [{ key: 'all', title: null, sessions }]
  const group = (sessions: SessionSummary[]): SessionGroup[] => {
    const groups = new Map<string, SessionGroup[1]>()
    for (const row of sessions) {
      const machineId = row.metadata?.machineId ?? null
      const path = row.metadata?.path?.trim() ? row.metadata.path : '—'
      const key = sessionWorkspaceKey(row)
      if (!groups.has(key))
        groups.set(key, {
          machineId,
          machine: machineLabel(machineId),
          path,
          hasDirectory: path !== '—',
          sessions: [],
          sections: [],
        })
      groups.get(key)!.sessions.push(row)
    }
    for (const workspace of groups.values()) {
      workspace.sessions.sort(
        (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || compare(a, b),
      )
      workspace.sections = statusSections(workspace.sessions)
    }
    // Active workspaces stay above older directories; text search keeps its relevance order.
    return [...groups.entries()].sort(([, a], [, b]) =>
      query ? 0 : Number(b.sessions.some((row) => row.active)) - Number(a.sessions.some((row) => row.active)),
    )
  }
  const flat = (key: string, sessions: SessionSummary[]): SessionGroup[] =>
    sessions.length
      ? [
          [
            key,
            {
              machine: '',
              machineId: null,
              path: '',
              hasDirectory: false,
              sessions,
              sections: [{ key: 'all', title: null, sessions }],
            },
          ],
        ]
      : []
  const workspaces = group(rows.filter((row) => !row.globalPinned))
  const sections: SessionSection[] = [
    {
      key: 'global-pinned',
      title: 'Global pins',
      groups: flat(
        'global-pinned',
        rows.filter((row) => row.globalPinned),
      ),
    },
    {
      key: 'project-pinned',
      title: 'Project pins',
      groups: workspaces.filter(([, workspace]) => workspace.sessions.some((row) => row.pinned)),
    },
    {
      key: 'all',
      title: null,
      groups: workspaces.filter(([, workspace]) => !workspace.sessions.some((row) => row.pinned)),
    },
  ]
  return sections.filter((section) => section.groups.length)
}
