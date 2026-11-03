import { RPC_TARGET_MISSING_ERROR_CODE } from '@hapi/protocol/rpcMethods'

/** Preserve only discovery codes used by the UI; never forward server error text. */
export async function readDiscoveryErrorCode(response: Response, path: string): Promise<string | null> {
  const pathname = path.split('?')[0]
  const availability =
    response.status === 409 && /^\/api\/machines\/[^/]+\/agent-availability$/.test(pathname)
  const modelDiscovery =
    response.status === 503 &&
    /^\/api\/(machines|sessions)\/[^/]+\/(agy|claude|codex|copilot|cursor|dsh|grok|hermes|kimi|opencode|pi)-models$/.test(
      pathname,
    )
  if (!availability && !modelDiscovery) return null
  const reader = response.body?.getReader()
  if (!reader) return null
  const limit = 4096
  try {
    if (Number(response.headers.get('content-length')) > limit) return null
    let size = 0
    const chunks: Uint8Array[] = []
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) return null
      chunks.push(next.value)
    }
    const payload: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
    if (!payload || typeof payload !== 'object' || !('code' in payload)) return null
    if (availability && payload.code === 'runner_upgrade_required') return payload.code
    if (modelDiscovery && payload.code === RPC_TARGET_MISSING_ERROR_CODE) return payload.code
  } catch {
    // An unreadable error body keeps the original HTTP failure, never a success.
    return null
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  return null
}
