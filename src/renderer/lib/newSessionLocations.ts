import { z } from 'zod'

const MAX_RECENT_PATHS = 5
const locationsSchema = z.object({
  lastMachineId: z.string().max(512).optional(),
  paths: z.record(z.string(), z.array(z.string().trim().min(1).max(8192)).max(MAX_RECENT_PATHS)),
})

export function loadNewSessionLocations(scope: string): z.infer<typeof locationsSchema> {
  try {
    return locationsSchema.parse(
      JSON.parse(localStorage.getItem(`desktop:new-session-locations:${scope}`) ?? 'null'),
    )
  } catch {
    return { paths: {} }
  }
}

/** Record only successful launches. Web keeps the five most recent paths per runner. */
export function rememberSessionLocation(scope: string, machineId: string, directory: string): void {
  const path = directory.trim()
  if (!machineId || machineId.length > 512 || !path || path.length > 8192) return
  const previous = loadNewSessionLocations(scope)
  const recent = Object.hasOwn(previous.paths, machineId) ? previous.paths[machineId] : []
  const paths = [path, ...recent.filter((item) => item !== path)].slice(0, MAX_RECENT_PATHS)
  try {
    localStorage.setItem(
      `desktop:new-session-locations:${scope}`,
      JSON.stringify({
        lastMachineId: machineId,
        paths: { ...previous.paths, [machineId]: paths },
      }),
    )
  } catch {
    // A full or unavailable preference store must not turn a successful launch into a failure.
  }
}
