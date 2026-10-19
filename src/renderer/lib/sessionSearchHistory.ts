export const MAX_RECENT_SEARCHES = 10

function normalizeHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const history: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const query = item.trim()
    const key = query.toLowerCase()
    if (!query || query.length > 1024 || seen.has(key)) continue
    seen.add(key)
    history.push(query)
    if (history.length === MAX_RECENT_SEARCHES) break
  }
  return history
}

export function addRecentSearch(history: readonly string[], query: string): string[] {
  return normalizeHistory([query, ...history])
}

export function loadSessionSearchHistory(scope: string): string[] {
  try {
    return normalizeHistory(JSON.parse(localStorage.getItem(`desktop:session-search:${scope}`) ?? 'null'))
  } catch {
    return []
  }
}

export function saveSessionSearchHistory(scope: string, history: readonly string[]): void {
  try {
    const entries = normalizeHistory(history)
    const key = `desktop:session-search:${scope}`
    if (entries.length) localStorage.setItem(key, JSON.stringify(entries))
    else localStorage.removeItem(key)
  } catch {
    // Search remains usable when the local preference store is unavailable.
  }
}
