import { z } from 'zod'

const resourceId = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)
export const remoteFileSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('generated'), sessionId: resourceId, imageId: resourceId }).strict(),
  z
    .object({
      kind: z.literal('file'),
      sessionId: resourceId,
      path: z
        .string()
        .min(1)
        .max(8192)
        .regex(/^[^\x00-\x1f]+$/),
    })
    .strict(),
])
export const saveFileSchema = z
  .object({
    source: remoteFileSchema,
    fileName: z.string().min(1).max(4096),
  })
  .strict()

export function downloadFileName(input: string): string {
  const name = (input.split(/[\\/]/).pop() ?? '')
    .replace(/[<>:"|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_')
    .slice(0, 200)
    .replace(/[. ]+$/, '')
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return 'download'
  return name
}

export function normalizeHubUrl(input: string): string {
  const url = new URL(input.trim())
  // URL canonicalizes IP literals before classification. Do not infer that a
  // DNS name is private from its prefix or suffix.
  const ipv4 = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ? url.hostname.split('.').map(Number) : null
  const privateHost =
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^\[f[cd][\da-f]{2}:/.test(url.hostname) || // IPv6 unique-local fc00::/7
    (ipv4 !== null &&
      (ipv4[0] === 127 ||
        ipv4[0] === 10 ||
        (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
        (ipv4[0] === 192 && ipv4[1] === 168) ||
        (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127))) // Shared/VPN address space
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && privateHost))
    throw new Error('HTTPS_REQUIRED')
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== ''))
    throw new Error('INVALID_HUB_URL')
  return url.origin
}

// Only the shipped desktop features may reach the configured hub. No arbitrary
// origin, headers, auth endpoints, terminal, host management, or shell access.
const session = '/api/sessions/[^/?#]+'
const machine = '/api/machines/[^/?#]+'
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const uploadBodySchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(4096)
      .regex(/^[^/\\\x00-\x1f]+$/),
    content: z
      .string()
      .min(1)
      .max(4 * Math.ceil(MAX_UPLOAD_BYTES / 3)),
    mimeType: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/),
  })
  .strict()
const allowed: Record<string, RegExp[]> = {
  GET: [
    /^\/health$/,
    /^\/api\/(sessions|machines)$/,
    new RegExp(`^${session}$`),
    new RegExp(
      `^${session}/(messages|files|file|directory|git-status|git-diff-numstat|git-diff-file|slash-commands|codex-models|opencode-models|opencode-reasoning-effort-options)$`,
    ),
    new RegExp(`^${machine}/(agent-availability|codex-models|opencode-models|opencode-model-variants)$`),
  ],
  POST: [
    new RegExp(
      `^${session}/(messages|resume|reopen|abort|archive|clear|model|permission-mode|model-reasoning-effort|effort|collaboration-mode|upload)$`,
    ),
    new RegExp(`^${session}/messages/queued-state$`),
    new RegExp(`^${session}/upload/delete$`),
    new RegExp(`^${session}/messages/[^/?#]+/(retry|steer)$`),
    new RegExp(`^${session}/permissions/[^/?#]+/(approve|deny)$`),
    new RegExp(`^${session}/codex/plan/implement$`),
    new RegExp(`^${machine}/(spawn|list-directory|paths/exists)$`),
  ],
  PATCH: [new RegExp(`^${session}$`)],
  DELETE: [new RegExp(`^${session}$`), new RegExp(`^${session}/messages/[^/?#]+$`)],
}

export const hubRequestSchema = z
  .object({
    path: z.string().max(12_000),
    method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']),
    body: z.unknown().optional(),
    scope: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .superRefine((request, context) => {
    try {
      const url = new URL(request.path, 'https://desktop.invalid')
      const decoded = decodeURIComponent(url.pathname)
      const rawPath = decodeURIComponent(request.path.split('?')[0])
      if (
        url.origin !== 'https://desktop.invalid' ||
        (!request.path.startsWith('/api/') && request.path !== '/health') ||
        url.hash ||
        /[\\\x00-\x1f]/.test(rawPath) ||
        rawPath.split('/').some((p) => p === '..' || p === '.') ||
        /%2f|%5c|%25/i.test(url.pathname) ||
        decoded.split('/').some((p) => p === '..' || p === '.') ||
        !allowed[request.method].some((pattern) => pattern.test(url.pathname)) ||
        url.searchParams.has('token') ||
        url.searchParams.has('accessToken')
      )
        throw new Error()
      if (request.method === 'GET' && request.body !== undefined) throw new Error()
      if (request.method === 'POST' && new RegExp(`^${session}/upload$`).test(url.pathname)) {
        const body = uploadBodySchema.parse(request.body)
        const base64 = body.content
        if (
          base64.length % 4 !== 0 ||
          /[^A-Za-z0-9+/=]/.test(base64) ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
        )
          throw new Error()
        const size = (base64.length / 4) * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
        if (size > MAX_UPLOAD_BYTES) throw new Error()
      } else {
        const limit =
          request.method === 'POST' && new RegExp(`^${session}/messages$`).test(url.pathname) ? 80 : 8
        if (JSON.stringify(request.body ?? null).length > limit * 1024 * 1024) throw new Error()
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'REQUEST_NOT_ALLOWED' })
    }
  })

export const settingsUpdateSchema = z
  .object({
    locale: z.enum(['zh', 'en', 'zh-TW', 'ja', 'fr', 'ru', 'vi']).optional(),
    theme: z.enum(['system', 'light', 'dark']).optional(),
    enterBehavior: z.enum(['newline', 'send']).optional(),
    fontSize: z.enum(['small', 'normal', 'large', 'extra-large']).optional(),
    groupSessionsByStatus: z.boolean().optional(),
    collapseHistoryByDefault: z.boolean().optional(),
    codexExplorationCollapsed: z.boolean().optional(),
    notifications: z.boolean().optional(),
    launchAtLogin: z.boolean().optional(),
  })
  .strict()

export const connectSchema = z
  .object({
    hubUrl: z.string().max(2048),
    accessToken: z.string().trim().min(1).max(4096),
    remember: z.boolean(),
  })
  .strict()
