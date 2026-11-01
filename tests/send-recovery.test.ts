import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import { cancelAttempt, type SendAttempt } from '../src/renderer/lib/outbox'

const attempt: SendAttempt = {
  localId: 'desktop-send-1',
  text: 'Keep my draft',
  createdAt: 1,
  status: 'unconfirmed',
}
const received = {
  id: 'hub-message-1',
  localId: attempt.localId,
  seq: 2,
  content: { role: 'user', content: { type: 'text', text: attempt.text } },
  createdAt: 1,
  invokedAt: 2,
}

describe('uncertain send cancellation', () => {
  it.each([
    { status: 'cancelled', localId: null },
    { status: 'cancelled', localId: attempt.localId },
    { status: 'busy', localId: attempt.localId },
    { status: 'invoked', message: received },
  ])('accepts the Hub result without turning $status into a successful cancellation', async (response) => {
    const transport = vi.fn().mockResolvedValue(response)
    const result = await cancelAttempt(new ApiClient('', { transport }), 'archived-hermes', attempt)
    expect(result).toEqual(response)
    expect(transport).toHaveBeenCalledExactlyOnceWith(
      `/api/sessions/archived-hermes/messages/${attempt.localId}`,
      { method: 'DELETE' },
    )
  })

  it.each([
    null,
    { status: 'cancelled' },
    { status: 'unknown', localId: attempt.localId },
    { status: 'cancelled', localId: 'another-send' },
    { status: 'busy', localId: 'another-send' },
    { status: 'invoked', message: { ...received, localId: 'another-send' } },
    { status: 'invoked', message: { ...received, invokedAt: null } },
  ])('rejects malformed or unrelated cancellation receipts: %j', async (response) => {
    const transport = vi.fn().mockResolvedValue(response)
    await expect(cancelAttempt(new ApiClient('', { transport }), 'hermes', attempt)).rejects.toThrow(
      'INVALID_RESPONSE',
    )
  })

  it('preserves a transport failure without retrying or assuming cancellation', async () => {
    const error = new Error('CONNECTION_CHANGED')
    const transport = vi.fn().mockRejectedValue(error)
    await expect(cancelAttempt(new ApiClient('', { transport }), 'hermes', attempt)).rejects.toBe(error)
    expect(transport).toHaveBeenCalledTimes(1)
  })
})
