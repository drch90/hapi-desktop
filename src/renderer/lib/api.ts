import { ApiClient, ApiError } from '@/api/client'
import type { Result } from '../../shared/bridge'

export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise
  if (!result.ok)
    throw new ApiError(
      result.error.message,
      result.error.status ?? 0,
      result.error.code ?? result.error.message,
    )
  return result.value
}

export function createApi(scope?: string) {
  const client = new ApiClient('', {
    transport: async <T>(path: string, init?: RequestInit): Promise<T> =>
      unwrap(
        window.desktop.request({
          path,
          ...(scope ? { scope } : {}),
          method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
          ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
        }),
      ) as Promise<T>,
  })
  client.fetchScratchlistAttachmentBlob = async (sessionId, attachmentId) => {
    const result = await unwrap(
      window.desktop.readFile({ kind: 'scratchlist', sessionId, attachmentId, ...(scope ? { scope } : {}) }),
    )
    return new Blob([result.bytes as BlobPart], { type: result.mimeType })
  }
  return client
}
export const api = createApi()

export function errorKey(error: unknown): string {
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : ''
  switch (code) {
    case 'HTTPS_REQUIRED':
      return 'Use HTTPS, or HTTP with a private IP address or localhost.'
    case 'INVALID_HUB_URL':
      return 'Enter a valid Hub origin without a path or query.'
    case 'INVALID_ACCESS_TOKEN':
    case 'SIGN_IN_REQUIRED':
      return 'The access token is invalid or has been revoked.'
    case 'INCOMPATIBLE_PROTOCOL':
      return 'This Hub uses an unsupported protocol version.'
    case 'NETWORK_ERROR':
    case 'HUB_UNAVAILABLE':
    case 'AUTH_UNAVAILABLE':
      return 'Connection failed. Check the Hub address and network.'
    case 'DELIVERY_UNKNOWN':
      return 'Delivery is unconfirmed. Check before sending again.'
    case 'UPLOAD_FAILED':
    case 'ATTACHMENTS_NOT_READY':
      return 'Upload failed. Retry or remove the attachment.'
    case 'HTTP_404':
      return 'This session is unavailable.'
    default:
      return 'The request failed. Refresh and try again.'
  }
}

export function operationErrorKey(error: unknown): string {
  const key = errorKey(error)
  return key === 'Delivery is unconfirmed. Check before sending again.'
    ? 'The operation could not be confirmed. Refresh the session before retrying.'
    : key
}

export function fileErrorKey(error: unknown): string {
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : ''
  if (code === 'HTTP_404' || code === 'FILE_UNAVAILABLE')
    return 'File unavailable. It may have expired or the remote session is offline.'
  if (code === 'RESPONSE_TOO_LARGE') return 'File is too large to load.'
  if (code === 'FILE_SAVE_FAILED') return 'Could not save the file. Choose another location and try again.'
  return errorKey(error)
}
