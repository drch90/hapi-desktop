import { useMemo, useState } from 'react'
import type { Machine, SessionSummary, SlashCommand } from '@/types/api'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { getSlashCommandSuggestions } from '@/hooks/queries/useSlashCommands'
import { buildSessionReferenceText, matchSessionsForMention } from '@/lib/sessionReference'
import { getSessionTitle } from '@/lib/sessionTitle'

export function useComposerSuggestions(
  query: string | null,
  commands: readonly SlashCommand[],
  sessions: readonly SessionSummary[],
  machines: readonly Machine[],
  sessionId: string,
) {
  const candidates = useMemo((): Suggestion[] => {
    if (query === null) return []
    if (!query.startsWith('@')) return getSlashCommandSuggestions(commands, query)
    const machineLabel = (id: string | null) => {
      const machine = machines.find((item) => item.id === id)
      return machine?.metadata?.displayName || machine?.metadata?.host || id?.slice(0, 8) || ''
    }
    return matchSessionsForMention(sessions, query.slice(1), {
      excludeId: sessionId,
      // Apply the display limit after retaining visible rows. Activity in an
      // offscreen session must not evict a still-matching row under the pointer.
      limit: sessions.length,
      resolveMachineLabel: machineLabel,
    }).map((row) => ({
      key: `session:${row.id}`,
      text: buildSessionReferenceText(getSessionTitle(row), row.id, '/'),
      label: `@${getSessionTitle(row) || row.id.slice(0, 8)}`,
      description: [row.id, machineLabel(row.metadata?.machineId ?? null), row.metadata?.path]
        .filter(Boolean)
        .join(' · '),
    }))
  }, [query, commands, sessions, machines, sessionId])
  const limit = query?.startsWith('@') ? 20 : candidates.length
  const [state, setState] = useState({
    query,
    sessionId,
    candidates,
    suggestions: candidates.slice(0, limit),
    selected: candidates.length ? 0 : -1,
  })
  let current = state
  if (state.query !== query || state.sessionId !== sessionId || state.candidates !== candidates) {
    const sameQuery = state.query === query && state.sessionId === sessionId
    const byKey = new Map(candidates.map((item) => [item.key, item]))
    // Keep rows under the pointer in place during background activity. Updated
    // labels and removals still apply immediately; new matches go at the end.
    const ordered = sameQuery
      ? state.suggestions
          .flatMap((item) => {
            const next = byKey.get(item.key)
            byKey.delete(item.key)
            return next ? [next] : []
          })
          .concat([...byKey.values()])
      : candidates
    const suggestions = ordered.slice(0, limit)
    const previousKey = sameQuery ? state.suggestions[state.selected]?.key : undefined
    const selectedByKey = suggestions.findIndex((item) => item.key === previousKey)
    const selected =
      selectedByKey >= 0
        ? selectedByKey
        : Math.min(sameQuery ? Math.max(0, state.selected) : 0, suggestions.length - 1)
    current = { query, sessionId, candidates, suggestions, selected }
    // Both sources are local query-cache data. Derive synchronously so a refresh
    // never publishes an empty menu or a selection from the previous search.
    setState(current)
  }
  function move(offset: number) {
    setState((previous) => {
      const count = previous.suggestions.length
      if (!count) return previous
      return { ...previous, selected: (previous.selected + offset + count) % count }
    })
  }
  return [current.suggestions, current.selected, () => move(-1), () => move(1)] as const
}
