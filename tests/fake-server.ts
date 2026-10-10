import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Session, DecryptedMessage, SyncEvent } from '@hapi/protocol/schemas'
import { CURRENT_MACHINE_CAPABILITIES, type ScratchlistAttachmentMetadata } from '@hapi/protocol'

export function fixtureSession(id: string, name: string, flavor: string, active = true): Session {
  return {
    id,
    namespace: 'test',
    seq: 1,
    createdAt: Date.now() - 600_000,
    updatedAt: Date.now(),
    active,
    activeAt: Date.now(),
    metadata: { path: '/home/dev/hapi-desktop', host: 'linux-dev-01', name, flavor, machineId: 'linux-1' },
    metadataVersion: 1,
    agentState: { requests: {} },
    agentStateVersion: 1,
    thinking: false,
    thinkingAt: 0,
    model: null,
    modelReasoningEffort: null,
    effort: null,
    serviceTier: null,
    permissionMode: 'default',
  }
}

export function fixtureMessage(id: string, seq: number, text: string, user = false): DecryptedMessage {
  const content = user
    ? { role: 'user', content: { type: 'text', text } }
    : {
        role: 'agent',
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            uuid: id,
            message: { role: 'assistant', content: [{ type: 'text', text }] },
          },
        },
      }
  return {
    id,
    seq,
    localId: null,
    createdAt: Date.now() - (10 - seq) * 30_000,
    invokedAt: Date.now(),
    content,
  }
}

export function fixtureCodexEvent(
  id: string,
  seq: number,
  data: Record<string, unknown>,
  createdAt = Date.now(),
): DecryptedMessage {
  return {
    id,
    seq,
    localId: null,
    createdAt,
    content: { role: 'agent', content: { type: 'codex', data } },
  }
}

export class FixtureHub {
  sessions = new Map([
    ['design', fixtureSession('design', '桌面工作台 · 界面与交互', 'codex')],
    ['review', fixtureSession('review', '审查连接与恢复流程', 'claude')],
    ['history', fixtureSession('history', 'OpenCode · 历史会话', 'opencode', false)],
  ])
  messages = new Map<string, DecryptedMessage[]>([
    [
      'design',
      [
        fixtureMessage('d1', 1, '把远程 Agent 整合到一个清晰的桌面工作台。', true),
        fixtureMessage(
          'd2',
          2,
          '已完成工作区的主要结构。\n\n### 会话始终在手边\n\n- 按 **机器与项目** 分组，快速找到正在进行的工作\n- 两个会话并排打开，草稿和滚动位置各自保存\n- 工具调用和待审批操作集中呈现\n\n```typescript\nconst workspace = {\n  panes: ["design", "review"],\n  connection: "HAPI Hub",\n  transport: "HTTPS + SSE"\n}\n```\n\n接下来可以检查右侧的变更预览。',
        ),
      ],
    ],
    [
      'review',
      [
        fixtureMessage('r1', 1, '检查认证和断线重连，先列出需要关注的点。', true),
        fixtureMessage(
          'r2',
          2,
          '已经核对 API 契约，重点关注三处：\n\n| 场景 | 处理方式 |\n| --- | --- |\n| SSE 断线 | 带游标恢复，缺失时重新同步 |\n| 消息响应丢失 | 保留草稿，先查询接收状态 |\n| 会话恢复 | 迁移到 Hub 返回的会话 ID |\n\n需要运行一次本地测试来确认实现。',
        ),
      ],
    ],
    ['history', [fixtureMessage('h1', 1, '这是一段可以恢复的远程会话。')]],
  ])
  requests: { path: string; method: string; body: Record<string, unknown> }[] = []
  generatedMedia = new Map<string, { content: Buffer; mimeType: string }>()
  fileContents = new Map<string, Buffer | null>()
  fileReadPaths: string[] = []
  directoryEntries = new Map<
    string,
    { name: string; type: 'file' | 'directory'; size?: number; modified?: number }[]
  >()
  uploads = new Map<string, { sessionId: string; filename: string; mimeType: string; bytes: Buffer }>()
  uploadDeletes: string[] = []
  failUpload = false
  uploadGate: Promise<void> | null = null
  resumeRemovesSource = false
  failFileSearch = false
  failGitNumstat = false
  displayMedia(sessionId: string, imageId: string, fileName: string, mimeType: string, content?: Buffer) {
    if (content) this.generatedMedia.set(imageId, { content, mimeType })
    const messages = this.messages.get(sessionId)!
    const message = {
      id: `display-${imageId}`,
      seq: messages.length + 1,
      localId: null,
      createdAt: Date.now(),
      content: {
        role: 'agent',
        content: { type: 'codex', data: { type: 'generated-image', imageId, fileName, mimeType } },
      },
    }
    messages.push(message)
    this.emit({ type: 'message-received', sessionId, message })
  }
  streams = new Set<ServerResponse>()
  eventStreamGate: Promise<void> | null = null
  eventId = 0
  failSend: 'none' | 'absent' | 'accepted' = 'none'
  sendGate: Promise<void> | null = null
  holdMessages = false
  messagePageSize: number | null = null
  historyGate: Promise<void> | null = null
  failHistory = false
  messagePageRequests: { sessionId: string; beforeSeq: number | null; afterSeq: number | null }[] = []
  steerOutcome: 'steered' | 'failed' | 'invoked' | 'indeterminate' = 'steered'
  emitQueueEvents = true
  commandEvents = false
  failPin = false
  failUsage = false
  failScratchSaveAfterCommit = false
  failScratchDelete = false
  cancelGate: Promise<void> | null = null
  scratchlists = new Map<
    string,
    Map<
      string,
      {
        entryId: string
        text: string
        createdAt: number
        updatedAt: number
        attachments: ScratchlistAttachmentMetadata[]
      }
    >
  >()
  scratchFiles = new Map<
    string,
    { sessionId: string; bytes: Buffer; metadata: ScratchlistAttachmentMetadata }
  >()
  failSetting = false
  hermesAvailable = true
  failHermesModels = false
  emptyHermesModels = false
  hermesModelRequests: { path: string; cwd: string | null; refresh: boolean }[] = []
  hermesModels = [
    { modelId: 'custom:office:qwen:32b', name: 'Qwen 32B', providerLabel: 'Office' },
    { modelId: 'custom:home:qwen:32b', name: 'Qwen 32B', providerLabel: 'Home' },
  ]
  failModelDiscovery = false
  failDelete = false
  failArchive = false
  emitArchiveEvents = true
  emitDeleteEvents = true
  machines = [
    {
      id: 'linux-1',
      namespace: 'test',
      active: true,
      activeAt: Date.now(),
      seq: 1,
      updatedAt: Date.now(),
      createdAt: 1,
      metadataVersion: 1,
      runnerStateVersion: 1,
      runnerState: {},
      metadata: {
        host: 'linux-dev-01',
        platform: 'linux',
        happyCliVersion: '0.30.7',
        workspaceRoots: ['/home/dev'],
        capabilities: [...CURRENT_MACHINE_CAPABILITIES],
      },
    },
  ]
  spawnCount = 0
  readonly server = createServer(async (request, response) => {
    const url = new URL(request.url!, 'http://fixture')
    const path = url.pathname
    let raw = ''
    for await (const chunk of request) raw += String(chunk)
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    this.requests.push({ path, method: request.method!, body })
    const reply = (value: unknown, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    if (path === '/health') {
      reply({ status: 'ok', protocolVersion: 1 })
      return
    }
    if (path === '/api/auth') {
      reply({
        token: `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 14400 })).toString('base64url')}.fixture-signature`,
        user: { id: 1 },
      })
      return
    }
    if (!request.headers.authorization?.startsWith('Bearer ')) {
      reply({}, 401)
      return
    }
    if (path === '/api/events') {
      if (this.eventStreamGate) await this.eventStreamGate
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      response.write(
        `data: ${JSON.stringify({ type: 'connection-changed', data: { status: 'connected', subscriptionId: 'fixture', resume: 'gap' } })}\n\n`,
      )
      this.streams.add(response)
      request.on('close', () => this.streams.delete(response))
      return
    }
    if (path === '/api/visibility') {
      reply({ ok: true })
      return
    }
    if (path === '/api/sessions') {
      reply({
        sessions: [...this.sessions.values()].map((s) => ({
          ...s,
          hasConversationContent: (this.messages.get(s.id)?.length ?? 0) > 0,
          todosUpdatedAt: 0,
          todoProgress: null,
          pendingRequestsCount: Object.keys(s.agentState?.requests ?? {}).length,
          pendingRequestKinds: [],
          pendingRequests: [],
          backgroundTaskCount: s.backgroundTaskCount ?? 0,
          futureScheduledMessageCount: 0,
          nextScheduledAt: null,
        })),
      })
      return
    }
    if (path === '/api/machines') {
      reply({ machines: this.machines })
      return
    }
    if (path.endsWith('/agent-availability')) {
      reply({
        agents: ['codex', 'claude', 'opencode', 'hermes'].map((agent) => ({
          agent,
          available: agent !== 'hermes' || this.hermesAvailable,
        })),
      })
      return
    }
    if (path.endsWith('/hermes-models')) {
      this.hermesModelRequests.push({
        path,
        cwd: url.searchParams.get('cwd'),
        refresh: url.searchParams.get('refresh') === 'true',
      })
      const sessionId = /^\/api\/sessions\/([^/]+)\/hermes-models$/.exec(path)?.[1]
      reply(
        this.failHermesModels
          ? { success: false, error: 'fixture internal details' }
          : {
              success: true,
              availableModels: this.emptyHermesModels ? [] : this.hermesModels,
              currentModelId: sessionId
                ? (this.sessions.get(sessionId)?.model ?? null)
                : this.hermesModels[0].modelId,
            },
      )
      return
    }
    if (path.endsWith('/codex-models')) {
      reply(
        this.failModelDiscovery
          ? { success: false }
          : {
              success: true,
              models: [
                {
                  id: 'fixture-codex',
                  displayName: 'Fixture Codex',
                  isDefault: true,
                  supportedReasoningEfforts: ['low', 'high', 'xhigh'],
                  serviceTiers: ['standard', 'fast'],
                },
                {
                  id: 'fixture-fast',
                  displayName: 'Fixture Fast',
                  supportedReasoningEfforts: ['low', 'medium'],
                },
              ],
            },
      )
      return
    }
    const spawnMachine = this.machines.find(
      (machine) => path === `/api/machines/${machine.id}/spawn` && machine.active,
    )
    if (spawnMachine) {
      const id = ++this.spawnCount === 1 ? 'created' : `created-${this.spawnCount}`
      const s = fixtureSession(id, '新建远程会话', String(body.agent))
      s.metadata!.path = String(body.directory)
      s.metadata!.machineId = spawnMachine.id
      s.metadata!.host = spawnMachine.metadata.host
      if (body.agent === 'hermes') s.metadata!.hermesSessionId = `native-${id}`
      s.model = (body.model as string) ?? (body.agent === 'hermes' ? this.hermesModels[0].modelId : null)
      s.permissionMode = body.permissionMode as Session['permissionMode']
      s.collaborationMode = body.collaborationMode as Session['collaborationMode']
      s.effort = (body.effort as string) ?? null
      s.modelReasoningEffort = (body.modelReasoningEffort as string) ?? null
      this.sessions.set(s.id, s)
      this.messages.set(s.id, [])
      reply({ type: 'success', sessionId: s.id })
      this.emit({ type: 'session-added', sessionId: s.id, data: s })
      return
    }
    if (/^\/api\/machines\/[^/]+\/paths\/exists$/.test(path)) {
      reply({ exists: Object.fromEntries((body.paths as string[]).map((p) => [p, !p.endsWith('/missing')])) })
      return
    }
    if (path === '/api/machines/linux-1/list-directory') {
      reply({
        success: true,
        entries:
          body.path === '/home/dev'
            ? [
                { name: 'project', type: 'directory', isGitRepo: true },
                { name: 'notes.txt', type: 'file' },
                ...(body.includeHidden ? [{ name: '.private', type: 'directory' }] : []),
              ]
            : [{ name: 'nested', type: 'directory' }],
      })
      return
    }
    if (path === '/api/machines/linux-1/opencode-models') {
      reply({
        success: true,
        availableModels: [
          { modelId: 'fixture/opencode', name: 'Fixture OpenCode' },
          { modelId: 'fixture/other', name: 'Fixture Other' },
        ],
        currentModelId: 'fixture/opencode',
      })
      return
    }
    if (path === '/api/machines/linux-1/opencode-model-variants') {
      reply({ success: true, variants: { 'fixture/opencode': ['balanced', 'deep'], 'fixture/other': [] } })
      return
    }
    if (path === '/api/usage/summary') {
      if (this.failUsage) {
        reply({}, 503)
        return
      }
      const bucket = {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 400,
        cacheCreationTokens: 50,
        totalTokens: 1200,
        uncachedTokens: 800,
        requests: 3,
      }
      reply({
        range: { from: null, to: null },
        totals: { ...bucket, sessions: 2 },
        daily: [{ key: '2026-10-02', ...bucket }],
        byAgent: [{ key: 'codex', ...bucket }],
        byModel: [{ key: 'gpt-5', ...bucket }],
        updatedAt: Date.now(),
      })
      return
    }
    const match = /^\/api\/sessions\/([^/]+)(.*)$/.exec(path)
    if (!match) {
      reply({}, 404)
      return
    }
    const [, id, action] = match
    const session = this.sessions.get(id)
    if (!session) {
      reply({}, 404)
      return
    }
    if (!action) {
      if (request.method === 'DELETE') {
        if (session.active || this.failDelete) {
          reply({ error: 'Cannot delete session' }, 409)
          return
        }
        this.sessions.delete(id)
        this.messages.delete(id)
        reply({ ok: true })
        if (this.emitDeleteEvents) this.emit({ type: 'session-removed', sessionId: id })
        return
      }
      if (request.method === 'PATCH') {
        session.metadata!.name = String(body.name)
        session.metadataVersion++
        this.emit({ type: 'session-updated', sessionId: id, data: session })
      }
      reply({ session })
      return
    }
    if (action === '/pin' && request.method === 'PUT') {
      if (this.failPin) {
        reply({}, 503)
        return
      }
      session.pinned = body.mode === 'project'
      session.globalPinned = body.mode === 'global'
      session.updatedAt = Math.max(Date.now(), session.updatedAt + 1)
      this.emit({ type: 'session-updated', sessionId: id, data: session })
      reply({ ok: true })
      return
    }
    if (action.startsWith('/scratchlist')) {
      let entries = this.scratchlists.get(id)
      if (!entries) {
        entries = new Map()
        this.scratchlists.set(id, entries)
      }
      const changed = () =>
        this.emit({ type: 'session-updated', sessionId: id, data: { scratchlistUpdatedAt: Date.now() } })
      if (action === '/scratchlist/upload') {
        const attachmentId = `scratch-file-${this.scratchFiles.size + 1}`
        const bytes = Buffer.from(String(body.content), 'base64')
        const metadata = {
          id: attachmentId,
          filename: String(body.filename),
          mimeType: String(body.mimeType),
          size: bytes.length,
          path: `hapi-hub:scratchlist/${attachmentId}`,
        }
        this.scratchFiles.set(attachmentId, { sessionId: id, bytes, metadata })
        reply({ success: true, attachment: metadata })
        return
      }
      if (action.startsWith('/scratchlist/attachments/')) {
        const attachmentId = action.split('/').at(-1)!
        const file = this.scratchFiles.get(attachmentId)
        if (!file || file.sessionId !== id) {
          reply({}, 404)
          return
        }
        if (request.method === 'DELETE') {
          this.scratchFiles.delete(attachmentId)
          reply({ ok: true })
          return
        }
        response.writeHead(200, { 'content-type': file.metadata.mimeType })
        response.end(file.bytes)
        return
      }
      if (action === '/scratchlist') {
        if (request.method === 'GET') {
          reply({ entries: [...entries.values()] })
          return
        }
        const entryId = String(body.entryId ?? `note-${entries.size + 1}`)
        const entry = entries.get(entryId) ?? {
          entryId,
          text: String(body.text ?? ''),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          attachments: (body.attachments ?? []) as ScratchlistAttachmentMetadata[],
        }
        entries.set(entryId, entry)
        changed()
        if (this.failScratchSaveAfterCommit) {
          response.destroy()
          return
        }
        reply({ entry })
        return
      }
      const entryId = decodeURIComponent(action.split('/').at(-1)!)
      const entry = entries.get(entryId)
      if (!entry) {
        reply({}, 404)
        return
      }
      if (request.method === 'DELETE') {
        if (this.failScratchDelete) {
          reply({}, 503)
          return
        }
        entries.delete(entryId)
        changed()
        reply({ ok: true })
        return
      }
      if (request.method === 'PUT') {
        entry.text = String(body.text)
        entry.updatedAt = Date.now()
        changed()
        reply({ entry })
        return
      }
    }
    if (action === '/opencode-models') {
      reply({
        success: true,
        availableModels: [
          { modelId: 'fixture/opencode', name: 'Fixture OpenCode' },
          { modelId: 'fixture/other', name: 'Fixture Other' },
        ],
        currentModelId: session.model,
      })
      return
    }
    if (action === '/opencode-reasoning-effort-options') {
      reply({
        success: true,
        currentModelId: session.model,
        options:
          session.model === 'fixture/other'
            ? [{ value: 'minimal', name: 'Minimal' }]
            : [
                { value: 'balanced', name: 'Balanced' },
                { value: 'deep', name: 'Deep' },
              ],
        currentValue: session.modelReasoningEffort,
      })
      return
    }
    if (
      ['/collaboration-mode', '/permission-mode', '/model', '/model-reasoning-effort', '/effort'].includes(
        action,
      )
    ) {
      if (this.failSetting) {
        reply({ error: 'Fixture rejected setting' }, 409)
        return
      }
      if (action === '/permission-mode') session.permissionMode = body.mode as Session['permissionMode']
      if (action === '/collaboration-mode')
        session.collaborationMode = body.mode as Session['collaborationMode']
      if (action === '/model') session.model = body.model as string | null
      if (action === '/model-reasoning-effort')
        session.modelReasoningEffort = body.modelReasoningEffort as string | null
      if (action === '/effort') session.effort = body.effort as string | null
      session.updatedAt += 60_000
      reply({ ok: true })
      this.emit({ type: 'session-updated', sessionId: id, data: session })
      return
    }
    if (action === '/slash-commands') {
      reply({
        success: true,
        commands: [
          {
            name: 'project-check',
            description: 'Project diagnostics',
            source: 'project',
            content: 'Inspect the project',
          },
        ],
      })
      return
    }
    if (action === '/clear') {
      const next = { ...session, id: 'cleared', active: true }
      this.sessions.set(next.id, next)
      this.messages.set(next.id, [])
      this.emit({ type: 'session-added', sessionId: next.id, data: next })
      reply({ sessionId: next.id })
      return
    }
    if (action === '/upload') {
      await this.uploadGate
      if (!session.active || this.failUpload) {
        reply({ success: false })
        return
      }
      const path = `/tmp/hapi-upload/${id}/${this.uploads.size + 1}/${body.filename}`
      const bytes = Buffer.from(String(body.content), 'base64')
      this.uploads.set(path, {
        sessionId: id,
        filename: String(body.filename),
        mimeType: String(body.mimeType),
        bytes,
      })
      this.fileContents.set(path, bytes)
      reply({ success: true, path })
      return
    }
    if (action === '/upload/delete') {
      const path = String(body.path)
      if (this.uploads.get(path)?.sessionId !== id) {
        reply({ success: false }, 403)
        return
      }
      this.uploadDeletes.push(path)
      this.fileContents.delete(path)
      reply({ success: true })
      return
    }
    if (action === '/resume') {
      const nextId = session.active || session.metadata?.flavor === 'hermes' ? id : 'resumed'
      const next = {
        ...session,
        id: nextId,
        active: true,
        metadataVersion: session.metadataVersion + 1,
        metadata: session.metadata ? { ...session.metadata, lifecycleState: 'running' } : null,
      }
      this.sessions.set(nextId, next)
      this.messages.set(nextId, this.messages.get(id) ?? [])
      if (this.resumeRemovesSource && nextId !== id) {
        this.sessions.delete(id)
        this.emit({ type: 'session-removed', sessionId: id })
      }
      reply({ sessionId: nextId })
      return
    }
    if (action === '/messages/queued-state') {
      const ids = body.localIds as string[]
      const candidates = (this.messages.get(id) ?? []).filter((m) => m.localId && ids.includes(m.localId))
      reply({
        queuedLocalIds: candidates
          .filter((m) => m.invokedAt === null && m.deliveryState !== 'indeterminate')
          .map((m) => m.localId),
        indeterminateLocalIds: candidates
          .filter((m) => m.invokedAt === null && m.deliveryState === 'indeterminate')
          .map((m) => m.localId),
        invokedLocalMessages: candidates
          .filter((m) => m.invokedAt != null)
          .map((m) => ({ localId: m.localId, invokedAt: m.invokedAt })),
      })
      return
    }
    const queueAction = /^\/messages\/([^/]+)(?:\/(steer|retry))?$/.exec(action)
    if (queueAction) {
      const message = this.messages.get(id)?.find((m) => m.id === decodeURIComponent(queueAction[1]))
      if (!message) {
        reply({ status: 'cancelled', localId: null })
        return
      }
      if (queueAction[2] === 'steer') {
        if (this.steerOutcome === 'failed') {
          reply({ status: 'failed', error: 'Turn already ended', localId: message.localId })
          return
        }
        if (this.steerOutcome === 'indeterminate') {
          message.deliveryState = 'indeterminate'
          this.emit({ type: 'messages-indeterminate', sessionId: id, localIds: [message.localId!] })
          reply({ status: 'failed', error: 'Outcome unknown', localId: message.localId })
          return
        }
        message.invokedAt = Date.now()
        if (this.emitQueueEvents)
          this.emit({
            type: 'messages-consumed',
            sessionId: id,
            localIds: [message.localId!],
            invokedAt: message.invokedAt,
            steered: true,
          })
        reply(
          this.steerOutcome === 'invoked'
            ? { status: 'invoked', message }
            : { status: 'steered', localId: message.localId },
        )
        return
      }
      if (queueAction[2] === 'retry') {
        message.deliveryState = undefined
        this.emit({ type: 'messages-requeued', sessionId: id, localIds: [message.localId!] })
        reply({ status: 'retried', localId: message.localId })
        return
      }
      if (request.method === 'DELETE') {
        await this.cancelGate
        if (message.invokedAt != null) {
          reply({ status: 'invoked', message })
          return
        }
        if (message.deliveryState === 'indeterminate') {
          reply({ status: 'busy', localId: message.localId })
          return
        }
        this.messages.set(
          id,
          this.messages.get(id)!.filter((m) => m.id !== message.id),
        )
        if (this.emitQueueEvents)
          this.emit({
            type: 'message-cancelled',
            sessionId: id,
            messageId: message.id,
            localId: message.localId!,
          })
        reply({ status: 'cancelled', localId: message.localId })
        return
      }
    }
    if (action === '/messages') {
      if (request.method === 'POST') {
        const attachments = body.attachments as { path: string }[] | undefined
        if (
          attachments?.some(
            (item) => this.uploads.get(item.path)?.sessionId !== id || this.uploadDeletes.includes(item.path),
          )
        ) {
          reply({ error: 'Wrong attachment session' }, 400)
          return
        }
        const message = {
          ...fixtureMessage(
            `sent-${Date.now()}`,
            (this.messages.get(id)?.length ?? 0) + 1,
            String(body.text),
            true,
          ),
          content: {
            role: 'user',
            content: { type: 'text', text: String(body.text), ...(attachments ? { attachments } : {}) },
          },
          localId: String(body.localId),
          invokedAt: this.holdMessages && body.deliveryMode !== 'steer' ? null : Date.now(),
        }
        if (this.failSend !== 'absent') {
          this.messages.set(id, [...(this.messages.get(id) ?? []), message])
          this.emit({ type: 'message-received', sessionId: id, message })
        }
        if (this.failSend !== 'none') {
          response.destroy()
          return
        }
        if (this.commandEvents && String(body.text).startsWith('/')) {
          const event = {
            ...fixtureMessage(`command-${message.id}`, (this.messages.get(id)?.length ?? 0) + 1, ''),
            content: {
              role: 'agent',
              content: {
                type: 'event',
                id: `event-${message.id}`,
                data:
                  body.text === '/compact'
                    ? { type: 'compact', trigger: 'manual', preTokens: 1000 }
                    : { type: 'message', message: `**Command result**\n\n${body.text}` },
              },
            },
          }
          this.messages.get(id)!.push(event)
          this.emit({ type: 'message-received', sessionId: id, message: event })
        }
        await this.sendGate
        reply({ ok: true })
        return
      }
      const allMessages = this.messages.get(id) ?? []
      const beforeSeq = url.searchParams.has('beforeSeq') ? Number(url.searchParams.get('beforeSeq')) : null
      const afterSeq = url.searchParams.has('afterSeq') ? Number(url.searchParams.get('afterSeq')) : null
      this.messagePageRequests.push({ sessionId: id, beforeSeq, afterSeq })
      if (beforeSeq !== null) {
        await this.historyGate
        if (this.failHistory) {
          reply({ error: 'Fixture history unavailable' }, 503)
          return
        }
      }
      const limit =
        this.messagePageSize === null
          ? allMessages.length
          : Math.min(this.messagePageSize, Number(url.searchParams.get('limit')) || 20)
      let direction = 'latest'
      let eligible = allMessages
      if (this.messagePageSize !== null && beforeSeq !== null) {
        direction = 'before'
        eligible = allMessages.filter((message) => message.seq! < beforeSeq)
      } else if (this.messagePageSize !== null && afterSeq !== null) {
        direction = 'after'
        eligible = allMessages.filter((message) => message.seq! > afterSeq)
      }
      const messages = direction === 'after' ? eligible.slice(0, limit) : eligible.slice(-limit)
      reply({
        messages,
        page: {
          direction,
          limit,
          epoch: 1,
          reset: false,
          nextBeforeSeq: messages[0]?.seq ?? null,
          nextBeforeAt: messages[0]?.createdAt ?? null,
          nextAfterSeq: messages.at(-1)?.seq ?? null,
          nextAfterAt: messages.at(-1)?.createdAt ?? null,
          snapshotHeadSeq: allMessages.at(-1)?.seq ?? null,
          snapshotHeadAt: allMessages.at(-1)?.createdAt ?? null,
          hasMore: eligible.length > messages.length,
        },
      })
      return
    }
    if (action.startsWith('/permissions/')) {
      const key = decodeURIComponent(action.split('/')[2])
      delete session.agentState!.requests![key]
      session.agentStateVersion++
      this.emit({ type: 'session-updated', sessionId: id, data: session })
      reply({ ok: true })
      return
    }
    if (action === '/abort' || action === '/archive') {
      if (action === '/archive' && this.failArchive) {
        reply({ error: 'Fixture archive failed' }, 500)
        return
      }
      session.active = false
      session.thinking = false
      if (action === '/archive' && session.metadata) {
        session.metadata.lifecycleState = 'archived'
        session.metadataVersion++
      }
      if (action !== '/archive' || this.emitArchiveEvents)
        this.emit({ type: 'session-updated', sessionId: id, data: session })
      reply({ ok: true })
      return
    }
    if (action === '/directory') {
      reply({
        success: true,
        entries: this.directoryEntries.get(url.searchParams.get('path') ?? '') ?? [
          { name: 'src', type: 'directory' },
          { name: 'README.md', type: 'file' },
          { name: 'package.json', type: 'file' },
        ],
      })
      return
    }
    if (action.startsWith('/generated-images/')) {
      const media = this.generatedMedia.get(action.slice('/generated-images/'.length))
      if (!media) {
        reply({ error: 'Fixture media missing' }, 404)
        return
      }
      response.writeHead(200, { 'content-type': media.mimeType, 'content-length': media.content.length })
      response.end(media.content)
      return
    }
    if (action === '/file') {
      const filePath = url.searchParams.get('path') ?? ''
      this.fileReadPaths.push(filePath)
      const bytes = this.fileContents.has(filePath)
        ? this.fileContents.get(filePath)
        : (this.uploads.get(filePath)?.bytes ??
          Buffer.from('# HAPI Desktop\n\nA workspace for remote agents.\n'))
      if (!bytes) {
        reply({ success: false, error: 'File unavailable' })
        return
      }
      reply({
        success: true,
        content: bytes.toString('base64'),
        size: bytes.length,
        modified: Date.UTC(2026, 8, 1),
      })
      return
    }
    if (action === '/files') {
      if (this.failFileSearch) {
        reply({ success: false, error: 'Failed to search files' })
        return
      }
      const query = url.searchParams.get('query') ?? ''
      reply({
        success: true,
        files: [...this.fileContents.entries()]
          .filter(([path]) => path.includes(query))
          .map(([path, bytes]) => ({
            fileName: path.split('/').pop(),
            filePath: path.slice(0, path.lastIndexOf('/')),
            fullPath: path,
            fileType: 'file',
            size: bytes?.length,
            modified: Date.UTC(2026, 8, 1),
          })),
      })
      return
    }
    if (action === '/git-status') {
      reply({
        success: true,
        stdout: '# branch.head main\n1 .M N... 100644 100644 100644 abc def src/main.ts\n',
      })
      return
    }
    if (action === '/git-diff-numstat') {
      if (this.failGitNumstat) {
        reply({ success: false, error: 'Fixture numstat unavailable' })
        return
      }
      reply({ success: true, stdout: url.searchParams.get('staged') === 'true' ? '' : '4\t1\tsrc/main.ts\n' })
      return
    }
    if (action === '/git-diff-file') {
      reply({
        success: true,
        stdout:
          'diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,2 +1,5 @@\n-connectDirectly()\n+const hub = connectHub()\n+hub.on("reconnect", restoreCursor)\n+hub.on("approval", notifyUser)\n+openWorkspace()\n',
      })
      return
    }
    reply({}, 404)
  })
  async start() {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`
  }
  emit(event: SyncEvent) {
    for (const response of this.streams)
      response.write(`id: fixture-${++this.eventId}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  async close() {
    for (const stream of this.streams) stream.end()
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve())
      this.server.closeAllConnections()
    })
  }
}
