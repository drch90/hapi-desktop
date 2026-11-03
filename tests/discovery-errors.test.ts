// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { readDiscoveryErrorCode } from '../src/main/discovery-errors'

describe('discovery error codes', () => {
  const availability = '/api/machines/runner/agent-availability'
  it('preserves the runner upgrade code without exposing server details', async () => {
    const response = Response.json(
      { code: 'runner_upgrade_required', error: 'private server details' },
      { status: 409 },
    )
    expect(await readDiscoveryErrorCode(response, availability)).toBe('runner_upgrade_required')
  })

  it('preserves the missing model RPC code for shared-client fallback', async () => {
    const response = Response.json(
      { code: 'rpc_target_missing', error: 'private machine path' },
      { status: 503 },
    )
    expect(await readDiscoveryErrorCode(response, '/api/sessions/id/codex-models')).toBe('rpc_target_missing')
  })

  it.each([
    { code: 'sensitive-error-value', status: 409, path: availability },
    { code: 'runner_upgrade_required', status: 500, path: availability },
    { code: 'runner_upgrade_required', status: 409, path: '/api/sessions/id/messages' },
    { code: 'rpc_target_missing', status: 503, path: '/api/sessions/id/model' },
  ])(
    'does not forward unknown codes or apply discovery semantics to $path ($status)',
    async ({ code, status, path }) => {
      expect(await readDiscoveryErrorCode(Response.json({ code }, { status }), path)).toBeNull()
    },
  )

  it('bounds the error body and cancels oversized streams without Content-Length', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(4097)))
      },
      cancel,
    })
    expect(await readDiscoveryErrorCode(new Response(stream, { status: 409 }), availability)).toBeNull()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('falls back to the HTTP error for malformed bodies', async () => {
    expect(await readDiscoveryErrorCode(new Response('not JSON', { status: 409 }), availability)).toBeNull()
  })
})
