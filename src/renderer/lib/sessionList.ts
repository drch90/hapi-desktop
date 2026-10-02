import type { SessionSummary } from '@hapi/protocol'
import { buildSessionSearchScoreIndex, compareSessionsBySearchRelevance } from '@/lib/sessionListSearch'

export type SessionGroup = [
  string,
  {
    machine: string
    machineId: string | null
    path: string
    hasDirectory: boolean
    sessions: SessionSummary[]
  },
]
export type SessionSection = { key: string; title: string | null; groups: SessionGroup[] }
type Machine = { id: string; metadata?: { displayName?: string; host?: string } | null }

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
  const group = (sessions: SessionSummary[]): SessionGroup[] => {
    const groups = new Map<string, SessionGroup[1]>()
    for (const row of sessions) {
      const machineId = row.metadata?.machineId ?? null
      const path = row.metadata?.path?.trim() ? row.metadata.path : '—'
      const key = `${machineId}:${path}`
      if (!groups.has(key))
        groups.set(key, {
          machineId,
          machine: machineLabel(machineId),
          path,
          hasDirectory: path !== '—',
          sessions: [],
        })
      groups.get(key)!.sessions.push(row)
    }
    return [...groups.entries()]
  }
  const flat = (key: string, sessions: SessionSummary[]): SessionGroup[] =>
    sessions.length ? [[key, { machine: '', machineId: null, path: '', hasDirectory: false, sessions }]] : []
  const ordinary = rows.filter((row) => !row.globalPinned && !row.pinned)
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
      groups: group(rows.filter((row) => row.pinned && !row.globalPinned)),
    },
  ]
  if (!options.byStatus) sections.push({ key: 'all', title: null, groups: group(ordinary) })
  else
    sections.push(
      {
        key: 'thinking',
        title: 'In progress',
        groups: flat(
          'thinking',
          ordinary.filter((row) => row.active && row.thinking),
        ),
      },
      {
        key: 'active',
        title: 'Active sessions',
        groups: flat(
          'active',
          ordinary.filter((row) => row.active && !row.thinking),
        ),
      },
      { key: 'history', title: 'History sessions', groups: group(ordinary.filter((row) => !row.active)) },
    )
  return sections.filter((section) => section.groups.length)
}
