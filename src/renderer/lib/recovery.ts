import type { z } from 'zod'

// A session usually has one recovery record. Resuming into an existing session
// can combine several; retain the legacy single-record format when possible.
export function readRecoveryQueue<T>(key: string, schema: z.ZodType<T>): T[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return (Array.isArray(value) ? value : [value]).flatMap((item) => {
      const parsed = schema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
  } catch {
    return []
  }
}

export function writeRecoveryQueue<T>(key: string, records: T[]) {
  if (records.length) localStorage.setItem(key, JSON.stringify(records.length === 1 ? records[0] : records))
  else localStorage.removeItem(key)
}

export function updateRecoveryQueue<T extends { localId: string }>(
  records: T[],
  value: T | null,
  localId = value?.localId ?? records[0]?.localId,
): T[] {
  if (!value) return records.filter((record) => record.localId !== localId)
  if (!records.some((record) => record.localId === value.localId)) return [...records, value]
  return records.map((record) => (record.localId === value.localId ? value : record))
}

export function mergeRecoveryQueues<T extends { localId: string }>(target: T[], source: T[]): T[] {
  const seen = new Set<string>()
  return [...target, ...source].filter((record) => {
    if (seen.has(record.localId)) return false
    seen.add(record.localId)
    return true
  })
}
