import { setTimeout as delay } from 'node:timers/promises'
import { SyncEventSchema, type SyncEvent } from '@hapi/protocol/schemas'
import type { ConnectionState, DesktopEvent, HubRequest, RemoteFile, RemoteFileData } from '../shared/bridge'
import { normalizeHubUrl, hubRequestSchema, remoteFileSchema } from '../shared/policy'
import { SseDecoder } from './sse'

export class HubError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code = message,
  ) {
    super(message)
  }
}

export class HubConnection {
  state: ConnectionState = { status: 'disconnected', hubUrl: '' }
  private accessToken = ''
  private jwt = ''
  private expiresAt = 0
  private refresh: Promise<string> | null = null
  private lifetime = new AbortController()
  private stream: AbortController | null = null
  private retryWait: AbortController | null = null
  private generation = 0
  private cursor = ''
  private subscriptionId = ''
  private visible = false
  private lastFrameAt = 0
  private streamStartedAt = 0
  private readonly fetcher: typeof fetch

  constructor(
    private readonly emit: (event: DesktopEvent) => void,
    fetcher: typeof fetch = fetch,
  ) {
    this.fetcher = fetcher
  }

  private setState(status: ConnectionState['status'], error?: string) {
    this.state = {
      status,
      hubUrl: this.state.hubUrl,
      profile: this.state.profile,
      ...(error ? { error } : {}),
    }
    this.emit({ type: 'connection', state: this.state })
  }

  async connect(hubUrl: string, accessToken: string): Promise<void> {
    const origin = normalizeHubUrl(hubUrl)
    this.disconnect()
    const generation = this.generation
    this.state = { status: 'connecting', hubUrl: origin }
    this.accessToken = accessToken.trim()
    this.emit({ type: 'connection', state: this.state })
    try {
      const response = await this.fetcher(`${origin}/health`, {
        redirect: 'error',
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000)]),
      })
      if (!response.ok) throw new HubError('HUB_UNAVAILABLE', response.status)
      const health = (await response.json()) as { protocolVersion?: number }
      if (health.protocolVersion !== 1) throw new HubError('INCOMPATIBLE_PROTOCOL')
      await this.authenticate()
      if (generation !== this.generation) throw new HubError('CONNECTION_CHANGED')
      // SSE, not a successful login, establishes a live connection.
      void this.runStream(generation)
    } catch (error) {
      if (generation === this.generation)
        this.setState(
          error instanceof HubError && error.status === 401 ? 'authentication-required' : 'disconnected',
          error instanceof HubError ? error.code : 'NETWORK_ERROR',
        )
      throw error instanceof HubError ? error : new HubError('NETWORK_ERROR')
    }
  }

  disconnect() {
    this.generation++
    this.lifetime.abort()
    this.stream?.abort()
    this.lifetime = new AbortController()
    this.accessToken = ''
    this.jwt = ''
    this.expiresAt = 0
    this.refresh = null
    this.cursor = ''
    this.subscriptionId = ''
    this.setState('disconnected')
  }

  private async authenticate(): Promise<string> {
    if (this.refresh) return this.refresh
    const generation = this.generation
    const origin = this.state.hubUrl
    const accessToken = this.accessToken
    if (!accessToken) throw new HubError('SIGN_IN_REQUIRED', 401)
    const promise = (async () => {
      const response = await this.fetcher(`${origin}/api/auth`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessToken }),
        signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10_000)]),
      })
      if (!response.ok) {
        if (response.status === 401 && generation === this.generation) {
          this.jwt = ''
          this.stream?.abort()
          this.setState('authentication-required', 'INVALID_ACCESS_TOKEN')
        }
        throw new HubError(
          response.status === 401 ? 'INVALID_ACCESS_TOKEN' : 'AUTH_UNAVAILABLE',
          response.status,
        )
      }
      const body = (await response.json()) as { token?: string }
      if (!body.token || generation !== this.generation) throw new HubError('CONNECTION_CHANGED')
      // exp schedules refresh only. The Hub alone verifies JWT signatures and access.
      const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString()) as {
        exp?: number
        uid?: unknown
        ns?: unknown
      }
      if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now())
        throw new HubError('INVALID_AUTH_RESPONSE')
      this.jwt = body.token
      this.expiresAt = payload.exp * 1000
      // Non-secret account namespace scopes local drafts. This is not used
      // for authorization, which remains entirely with the Hub.
      this.state.profile = JSON.stringify([payload.uid ?? null, payload.ns ?? null])
      return body.token
    })()
    this.refresh = promise
    try {
      return await promise
    } finally {
      if (this.refresh === promise) this.refresh = null
    }
  }

  private async token() {
    if (this.jwt && this.expiresAt - Date.now() > 60_000) return this.jwt
    return this.authenticate()
  }

  async request(input: HubRequest): Promise<unknown> {
    const request = hubRequestSchema.parse(input)
    if (request.scope !== undefined && request.scope !== `${this.state.hubUrl}:${this.state.profile ?? ''}`)
      throw new HubError('CONNECTION_CHANGED')
    return this.authorizedRequest(request.path, request.method, request.body)
  }

  get signal(): AbortSignal {
    return this.lifetime.signal
  }

  async readFile(input: RemoteFile): Promise<RemoteFileData> {
    const source = remoteFileSchema.parse(input)
    if (source.scope !== undefined && source.scope !== `${this.state.hubUrl}:${this.state.profile ?? ''}`)
      throw new HubError('CONNECTION_CHANGED')
    const path = `/api/sessions/${encodeURIComponent(source.sessionId)}`
    if (source.kind === 'scratchlist')
      return (await this.authorizedRequest(
        `${path}/scratchlist/attachments/${encodeURIComponent(source.attachmentId)}`,
        'GET',
        undefined,
        'binary',
      )) as RemoteFileData
    if (source.kind === 'generated') {
      return (await this.authorizedRequest(
        `${path}/generated-images/${encodeURIComponent(source.imageId)}`,
        'GET',
        undefined,
        'binary',
      )) as RemoteFileData
    }
    const result = (await this.authorizedRequest(
      `${path}/file?${new URLSearchParams({ path: source.path })}`,
      'GET',
    )) as { success?: boolean; content?: unknown }
    if (!result || result.success !== true || typeof result.content !== 'string')
      throw new HubError('FILE_UNAVAILABLE')
    const bytes = Buffer.from(result.content, 'base64')
    if (bytes.toString('base64') !== result.content) throw new HubError('INVALID_RESPONSE')
    return { bytes: new Uint8Array(bytes), mimeType: 'application/octet-stream' }
  }

  private async authorizedRequest(
    path: string,
    method: string,
    body?: unknown,
    format: 'json' | 'binary' = 'json',
  ): Promise<unknown> {
    const generation = this.generation
    const origin = this.state.hubUrl
    let token = await this.token()
    for (let attempt = 0; attempt < 2; attempt++) {
      if (generation !== this.generation) throw new HubError('CONNECTION_CHANGED')
      let response: Response
      try {
        response = await this.fetcher(`${origin}${path}`, {
          method,
          redirect: 'error',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.any([
            this.lifetime.signal,
            AbortSignal.timeout(method === 'GET' && format === 'json' ? 20_000 : 60_000),
          ]),
        })
      } catch {
        throw new HubError(method === 'GET' ? 'NETWORK_ERROR' : 'DELIVERY_UNKNOWN')
      }
      if (generation !== this.generation) throw new HubError('CONNECTION_CHANGED')
      if (response.status === 401) {
        if (attempt === 0) {
          // A parallel request may already have refreshed this token.
          token = this.jwt && this.jwt !== token ? this.jwt : await this.authenticate()
          continue
        }
        this.jwt = ''
        this.stream?.abort()
        this.setState('authentication-required', 'SIGN_IN_REQUIRED')
        throw new HubError('SIGN_IN_REQUIRED', 401)
      }
      if (!response.ok) {
        // Do not forward arbitrary server error text (which can contain secrets) to UI/logs.
        const code =
          method !== 'GET' && response.status >= 500 ? 'DELIVERY_UNKNOWN' : `HTTP_${response.status}`
        throw new HubError(code, response.status)
      }
      if (response.status === 204) {
        if (format === 'binary') throw new HubError('FILE_UNAVAILABLE')
        return undefined
      }
      let bytes: Buffer
      try {
        // Enforce the bound while reading, including responses without Content-Length.
        // HAPI's generated-media protocol allows up to 25 MiB per file.
        // Chat pages may contain several Web image attachment previews.
        const messagePage = method === 'GET' && /^\/api\/sessions\/[^/?]+\/messages(?:\?|$)/.test(path)
        const limit = (format === 'binary' ? 25 : messagePage ? 96 : 24) * 1024 * 1024
        if (Number(response.headers.get('content-length')) > limit) {
          await response.body?.cancel()
          throw new HubError('RESPONSE_TOO_LARGE')
        }
        const chunks: Uint8Array[] = []
        let size = 0
        const reader = response.body?.getReader()
        if (reader) {
          try {
            while (true) {
              const next = await reader.read()
              if (next.done) break
              size += next.value.byteLength
              if (size > limit) throw new HubError('RESPONSE_TOO_LARGE')
              chunks.push(next.value)
            }
          } finally {
            await reader.cancel().catch(() => {})
            reader.releaseLock()
          }
        }
        bytes = Buffer.concat(chunks, size)
      } catch (error) {
        if (generation !== this.generation) throw new HubError('CONNECTION_CHANGED')
        if (error instanceof HubError) throw error
        throw new HubError(method === 'GET' ? 'NETWORK_ERROR' : 'DELIVERY_UNKNOWN')
      }
      if (generation !== this.generation) throw new HubError('CONNECTION_CHANGED')
      if (format === 'binary') {
        const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
        return {
          bytes: new Uint8Array(bytes),
          mimeType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : 'application/octet-stream',
        }
      }
      try {
        return JSON.parse(bytes.toString('utf8'))
      } catch {
        throw new HubError(method === 'GET' ? 'INVALID_RESPONSE' : 'DELIVERY_UNKNOWN')
      }
    }
    throw new HubError('SIGN_IN_REQUIRED', 401)
  }

  setVisible(visible: boolean) {
    this.visible = visible
    if (this.subscriptionId && this.jwt) {
      void this.authorizedRequest('/api/visibility', 'POST', {
        subscriptionId: this.subscriptionId,
        visibility: visible ? 'visible' : 'hidden',
      }).catch(() => {})
    }
  }

  wake() {
    this.retryWait?.abort()
    if (Date.now() - this.lastFrameAt > 45_000) this.stream?.abort()
  }

  private async runStream(generation: number) {
    let failures = 0
    while (generation === this.generation && this.state.status !== 'authentication-required') {
      const controller = new AbortController()
      this.stream = controller
      this.subscriptionId = ''
      let watchdog: ReturnType<typeof setInterval> | undefined
      let connectTimeout: ReturnType<typeof setTimeout> | undefined
      try {
        const token = await this.token()
        if (generation !== this.generation) break
        this.streamStartedAt = Date.now()
        this.lastFrameAt = this.streamStartedAt
        connectTimeout = setTimeout(() => controller.abort(), 10_000)
        const headers: Record<string, string> = {
          authorization: `Bearer ${token}`,
          accept: 'text/event-stream',
        }
        if (this.cursor) headers['Last-Event-ID'] = this.cursor
        const response = await this.fetcher(
          `${this.state.hubUrl}/api/events?all=true&visibility=${this.visible ? 'visible' : 'hidden'}`,
          {
            headers,
            redirect: 'error',
            signal: AbortSignal.any([this.lifetime.signal, controller.signal]),
          },
        )
        if (response.status === 401) {
          await this.authenticate()
          throw new HubError('STREAM_REAUTH')
        }
        if (
          !response.ok ||
          !response.body ||
          !response.headers.get('content-type')?.includes('text/event-stream')
        )
          throw new HubError('STREAM_UNAVAILABLE')
        watchdog = setInterval(() => {
          if (Date.now() - this.lastFrameAt > 90_000 || this.expiresAt - Date.now() < 60_000)
            controller.abort()
        }, 10_000)
        const reader = response.body.getReader()
        const text = new TextDecoder()
        // Match the 80 MiB message request ceiling, plus the SSE envelope.
        const decoder = new SseDecoder(81 * 1024 * 1024)
        try {
          while (generation === this.generation) {
            const next = await reader.read()
            if (next.done) break
            this.lastFrameAt = Date.now()
            for (const frame of decoder.push(text.decode(next.value, { stream: true }))) {
              const raw = JSON.parse(frame.data) as { type?: unknown }
              const parsed = SyncEventSchema.safeParse(raw)
              if (!parsed.success) {
                // Unknown additive events are safe to skip. Known-but-invalid state
                // requires a REST resync; never silently discard a state transition.
                if (SyncEventSchema.options.some((option) => option.shape.type.value === raw.type))
                  this.emit({ type: 'resync' })
                if (frame.id !== undefined) this.cursor = frame.id
                continue
              }
              const event: SyncEvent = parsed.data
              if (event.type === 'connection-changed') {
                clearTimeout(connectTimeout)
                failures = 0
                this.subscriptionId = event.data?.subscriptionId ?? ''
                this.setState('connected')
                if (event.data?.resume !== 'ok') this.emit({ type: 'resync' })
              }
              const timestamp = event.type === 'message-received' ? event.message.createdAt : 0
              this.emit({ type: 'sync', event, replay: timestamp > 0 && timestamp < this.streamStartedAt })
              // Frames without id (heartbeat/handshake/toast) keep the sticky cursor.
              if (frame.id !== undefined) this.cursor = frame.id
            }
          }
        } finally {
          await reader.cancel().catch(() => {})
          reader.releaseLock()
        }
      } catch {
        // Session credentials survive temporary network and service failures.
      } finally {
        clearTimeout(connectTimeout)
        clearInterval(watchdog)
        controller.abort()
      }
      if (
        generation !== this.generation ||
        (this.state as ConnectionState).status === 'authentication-required'
      )
        break
      this.setState('reconnecting', 'NETWORK_ERROR')
      const wait = failures === 0 ? 0 : failures >= 8 ? 300_000 : Math.min(30_000, 1000 * 2 ** (failures - 1))
      failures++
      this.retryWait = new AbortController()
      try {
        await delay(wait + Math.floor(Math.random() * 500), undefined, {
          signal: AbortSignal.any([this.lifetime.signal, this.retryWait.signal]),
        })
      } catch {
        if (generation !== this.generation) break
      }
      this.retryWait = null
    }
  }
}
