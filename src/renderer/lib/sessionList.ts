import type { SessionSummary } from '@hapi/protocol'
import { buildSessionSearchScoreIndex, compareSessionsBySearchRelevance } from '@/lib/sessionListSearch'
import type { Settings } from '../../shared/bridge'

const pathCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export type SessionGroup = [
  string,
  {
    machine: string
    machineId: string | null
    path: string
    hasDirectory: boolean
    workspaceKey: string
    sessions: SessionSummary[]
  },
]
export type SessionSection = { key: string; title: string | null; groups: SessionGroup[] }
type Machine = { id: string; metadata?: { displayName?: string; host?: string } | null }

export function sessionWorkspaceKey(session: Pick<SessionSummary, 'metadata'>): string {
  const path = session.metadata?.path?.trim() ? session.metadata.path : '—'
  return `${session.metadata?.machineId ?? null}:${path}`
}

export function sessionSectionKey(session: SessionSummary): string {
  if (session.globalPinned) return 'global-pinned'
  if (!session.active) return 'history'
  return session.thinking || session.pendingRequestsCount > 0 || (session.backgroundTaskCount ?? 0) > 0
    ? 'thinking'
    : 'active'
}

export function sessionGroupKey(session: SessionSummary): string {
  const section = sessionSectionKey(session)
  return section === 'history' ? `${section}:${sessionWorkspaceKey(session)}` : section
}

export function selectSessionList(options: {
  sessions: SessionSummary[]
  machines: Machine[]
  search: string
  machine: string
  unreadOnly: boolean
  lastSeen: Readonly<Record<string, number>>
  scope: string
  workspaceGroupSort?: Settings['workspaceGroupSort']
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
      const key = sessionGroupKey(row)
      if (!groups.has(key))
        groups.set(key, {
          machineId,
          machine: machineLabel(machineId),
          path,
          hasDirectory: path !== '—',
          workspaceKey: sessionWorkspaceKey(row),
          sessions: [],
        })
      groups.get(key)!.sessions.push(row)
    }
    for (const workspace of groups.values()) {
      workspace.sessions.sort(
        (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || compare(a, b),
      )
    }
    return [...groups.entries()].sort(([aKey, a], [bKey, b]) => {
      const pins = Number(b.sessions.some((row) => row.pinned)) - Number(a.sessions.some((row) => row.pinned))
      // Search keeps relevance order; recent order already comes from the first row.
      if (pins || query || options.workspaceGroupSort === 'recent') return pins
      const direction = options.workspaceGroupSort === 'path-desc' ? -1 : 1
      const pathOrder =
        pathCollator.compare(a.path, b.path) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
      return (
        Number(b.hasDirectory) - Number(a.hasDirectory) ||
        direction * pathOrder ||
        pathCollator.compare(a.machine, b.machine) ||
        aKey.localeCompare(bKey, 'en')
      )
    })
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
              workspaceKey: key,
              sessions: [...sessions].sort(
                (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || compare(a, b),
              ),
            },
          ],
        ]
      : []
  const sections: SessionSection[] = [
    {
      key: 'global-pinned',
      title: 'Global pins',
      groups: flat(
        'global-pinned',
        rows.filter((row) => row.globalPinned),
      ),
    },
    ...[
      { key: 'thinking', title: 'In progress' },
      { key: 'active', title: 'Active sessions' },
      { key: 'history', title: 'History sessions' },
    ].map((section) => ({
      ...section,
      groups:
        section.key === 'history'
          ? group(rows.filter((row) => sessionSectionKey(row) === section.key))
          : flat(
              section.key,
              rows.filter((row) => sessionSectionKey(row) === section.key),
            ),
    })),
  ]
  return sections.filter((section) => section.groups.length)
}
