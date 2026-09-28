// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubConnection } from '../src/main/hub'
import type { DesktopEvent } from '../src/shared/bridge'

class FakeHub {
  authCalls = 0
  requests: { origin: string; path: string; init?: RequestInit }[] = []
  streams: ReadableStreamDefaultController<Uint8Array>[] = []
  route: (path: string, init?: RequestInit) => Promise<Response> = async () => Response.json({ ok: true })
  rejectAuth = false
  protocol = 1
  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const { origin, pathname: path } = new URL(String(input))
    this.requests.push({ origin, path, init })
    if (path === '/health') return Response.json({ protocolVersion: this.protocol })
    if (path === '/api/auth') {
      this.authCalls++
      if (this.rejectAuth) return new Response('secret-error-text', { status: 401 })
      return Response.json({
        token: `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 14400 })).toString('base64url')}.signature-${this.authCalls}`,
      })
    }
    if (path === '/api/events') {
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          this.streams.push(controller)
          init?.signal?.addEventListener(
            'abort',
            () => {
              try {
                controller.error(new Error('aborted'))
              } catch {}
            },
            { once: true },
          )
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    }
    return this.route(path, init)
  }) as typeof fetch
  frame(data: unknown, id?: string) {
    this.streams
      .at(-1)!
      .enqueue(
        new TextEncoder().encode(`${id !== undefined ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`),
      )
  }
}

const connections: HubConnection[] = []
afterEach(() => {
  for (const hub of connections) hub.disconnect()
  connections.length = 0
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function connected(origin = 'https://hub.example') {
  const fake = new FakeHub()
  const events: DesktopEvent[] = []
  const hub = new HubConnection((event) => events.push(event), fake.fetch)
  connections.push(hub)
  await hub.connect(origin, 'test-access-token')
  await vi.waitFor(() => expect(fake.streams).toHaveLength(1))
  fake.frame({
    type: 'connection-changed',
    data: { status: 'connected', subscriptionId: 'one', resume: 'gap' },
  })
  await vi.waitFor(() => expect(hub.state.status).toBe('connected'))
  return { fake, hub, events }
}

describe('Hub API authentication and delivery', () => {
  it('uses the configured private HTTP origin for login, SSE and authenticated requests', async () => {
    const origin = 'http://192.168.1.5:3006'
    const { fake, hub, events } = await connected(origin)
    await hub.request({ path: '/api/sessions', method: 'GET' })
    await hub.request({
      path: '/api/sessions/s/messages',
      method: 'POST',
      body: { text: 'hello over LAN', localId: 'lan-message' },
    })
    expect(fake.requests.map((request) => request.path)).toEqual([
      '/health',
      '/api/auth',
      '/api/events',
      '/api/sessions',
      '/api/sessions/s/messages',
    ])
    for (const request of fake.requests) {
      expect(request.origin).toBe(origin)
      expect(request.init?.redirect).toBe('error')
    }
    expect(fake.requests.at(-1)?.init?.headers).toHaveProperty('authorization')
    expect(hub.state).toMatchObject({ status: 'connected', hubUrl: origin })
    expect(JSON.stringify(events)).not.toContain('test-access-token')
    expect(JSON.stringify(events)).not.toContain('signature-')
  })
  it('rejects public HTTP before sending any credentials or network requests', async () => {
    const fake = new FakeHub()
    const hub = new HubConnection(() => {}, fake.fetch)
    connections.push(hub)
    await expect(hub.connect('http://8.8.8.8:3006', 'secret')).rejects.toThrow('HTTPS_REQUIRED')
    expect(fake.requests).toEqual([])
    expect(hub.state.status).toBe('disconnected')
  })
  it('keeps bearer credentials out of bridge events and enforces the API allowlist', async () => {
    const { fake, hub, events } = await connected()
    await hub.request({ path: '/api/sessions', method: 'GET' })
    const request = fake.requests.at(-1)!
    expect(request.init?.headers).toHaveProperty('authorization')
    expect(request.init?.redirect).toBe('error')
    expect(JSON.stringify(events)).not.toContain('signature-')
    expect(JSON.stringify(events)).not.toContain('test-access-token')
    const before = fake.requests.length
    await expect(hub.request({ path: '/api/auth', method: 'POST' })).rejects.toThrow()
    expect(fake.requests.length).toBe(before)
  })
  it('shares one refresh across simultaneous 401 responses', async () => {
    const { fake, hub } = await connected()
    fake.route = async (_path, init) =>
      String((init?.headers as Record<string, string>).authorization).endsWith('signature-1')
        ? new Response('', { status: 401 })
        : Response.json({ sessions: [] })
    await Promise.all([
      hub.request({ path: '/api/sessions', method: 'GET' }),
      hub.request({ path: '/api/machines', method: 'GET' }),
    ])
    expect(fake.authCalls).toBe(2)
    expect(fake.requests.filter((r) => r.path === '/api/sessions')).toHaveLength(2)
  })
  it('stops on revoked credentials without exposing server error text', async () => {
    const { fake, hub, events } = await connected()
    fake.rejectAuth = true
    fake.route = async () => new Response('private server details', { status: 401 })
    await expect(hub.request({ path: '/api/sessions', method: 'GET' })).rejects.toMatchObject({
      code: 'INVALID_ACCESS_TOKEN',
    })
    expect(hub.state.status).toBe('authentication-required')
    expect(JSON.stringify(events)).not.toContain('private')
  })
  it.each(['network', 'server', 'body'])('never retries an uncertain mutation: %s', async (failure) => {
    const { fake, hub } = await connected()
    fake.route = async () => {
      if (failure === 'network') throw new TypeError('socket lost')
      if (failure === 'server') return new Response('secret', { status: 503 })
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('body truncated'))
          },
        }),
      )
    }
    await expect(
      hub.request({
        path: '/api/sessions/s/messages',
        method: 'POST',
        body: { text: 'hello', localId: 'stable-id' },
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_UNKNOWN' })
    expect(fake.requests.filter((r) => r.path.endsWith('/messages'))).toHaveLength(1)
  })
  it('rejects an incompatible Hub before sending credentials', async () => {
    const fake = new FakeHub()
    fake.protocol = 99
    const hub = new HubConnection(() => {}, fake.fetch)
    connections.push(hub)
    await expect(hub.connect('https://hub.example', 'secret')).rejects.toMatchObject({
      code: 'INCOMPATIBLE_PROTOCOL',
    })
    expect(fake.authCalls).toBe(0)
  })
  it('refreshes an expiring JWT before sending a request', async () => {
    const { fake, hub } = await connected()
    const later = Date.now() + 14_390_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    await hub.request({ path: '/api/sessions', method: 'GET' })
    expect(fake.authCalls).toBe(2)
    expect(String((fake.requests.at(-1)?.init?.headers as Record<string, string>).authorization)).toContain(
      'signature-2',
    )
  })
  it('discards an in-flight old-account response after logout', async () => {
    const { fake, hub } = await connected()
    let finish!: (response: Response) => void
    fake.route = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const pending = hub.request({ path: '/api/sessions', method: 'GET' })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    hub.disconnect()
    finish(Response.json({ sessions: ['old-account-private-session'] }))
    await expect(pending).rejects.toMatchObject({ code: 'CONNECTION_CHANGED' })
    expect(hub.state.status).toBe('disconnected')
    await expect(hub.request({ path: '/api/sessions', method: 'GET' })).rejects.toMatchObject({
      code: 'SIGN_IN_REQUIRED',
    })
  })
})

describe('global SSE recovery', () => {
  it('keeps the cursor across no-id heartbeats and requests replay on reconnect', async () => {
    const { fake, hub, events } = await connected()
    fake.frame({ type: 'session-removed', sessionId: 'old' }, 'cursor-7')
    fake.frame({ type: 'heartbeat', data: { timestamp: Date.now() } })
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'sync' && e.event.type === 'session-removed')).toBe(true),
    )
    fake.streams[0].close()
    await vi.waitFor(() => expect(hub.state.status).toBe('reconnecting'))
    hub.wake()
    await vi.waitFor(() => expect(fake.streams).toHaveLength(2))
    expect(fake.requests.filter((r) => r.path === '/api/events')[1].init?.headers).toHaveProperty(
      'Last-Event-ID',
      'cursor-7',
    )
    const before = events.filter((e) => e.type === 'resync').length
    fake.frame({ type: 'connection-changed', data: { status: 'connected', resume: 'ok' } })
    await vi.waitFor(() => expect(hub.state.status).toBe('connected'))
    expect(events.filter((e) => e.type === 'resync')).toHaveLength(before)
  })
  it('resyncs known malformed state, skips additive events, and requests REST recovery on gaps', async () => {
    const { fake, events } = await connected()
    const before = events.filter((e) => e.type === 'resync').length
    fake.frame({ type: 'future-feature', value: 1 }, 'cursor-1')
    fake.frame({ type: 'session-updated', sessionId: 's', data: { active: 'invalid' } }, 'cursor-2')
    fake.frame({ type: 'connection-changed', data: { status: 'connected', resume: 'gap' } })
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'resync')).toHaveLength(before + 2))
  })
})
