import { describe, expect, it, vi } from 'vitest'
import * as normalization from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { createChatBlockSelector } from '../src/renderer/lib/chat-rendering'
import { fixtureMessage } from './fake-server'

describe('incremental conversation rendering', () => {
  it('reuses unchanged messages while replacing a streaming snapshot', () => {
    const normalize = vi.spyOn(normalization, 'normalizeDecryptedMessage')
    const select = createChatBlockSelector()
    const messages = [
      fixtureMessage('question', 1, 'Start', true),
      fixtureMessage('first', 2, 'Completed'),
      fixtureMessage('live', 3, 'Part one'),
    ]
    const first = select(messages, null)
    expect(normalize).toHaveBeenCalledTimes(3)
    const update = { ...fixtureMessage('live', 3, 'Part one and two'), createdAt: messages[2].createdAt }
    const next = select([...messages.slice(0, 2), update], null)
    expect(normalize).toHaveBeenCalledTimes(4)
    expect(next.blocks[0]).toBe(first.blocks[0])
    expect(next.blocks[1]).toBe(first.blocks[1])
    expect(next.blocks[2]).not.toBe(first.blocks[2])
    expect(next.blocks[2]).toMatchObject({ text: 'Part one and two' })
    expect(first.blocks[2]).toMatchObject({ text: 'Part one' })
    normalize.mockRestore()
  })

  it('matches the reducer across history prepend, queued consumption and history replacement', () => {
    const select = createChatBlockSelector()
    const live = fixtureMessage('live', 3, 'Answer')
    const queued = {
      ...fixtureMessage('queued', 4, 'Next question', true),
      invokedAt: null,
      status: 'queued' as const,
    }
    const first = select([live, queued], null)
    expect(first.blocks).toHaveLength(1)
    const earlier = fixtureMessage('earlier', 1, 'Earlier question', true)
    const consumed = { ...queued, invokedAt: Date.now(), status: 'sent' as const }
    const messages = [earlier, live, consumed]
    const next = select(messages, null)
    expect(next.blocks[1]).toBe(first.blocks[0])
    expect(next).toEqual(
      reduceChatBlocks(
        messages.map(normalization.normalizeDecryptedMessage).filter((item) => item !== null),
        null,
      ),
    )
    expect(select([earlier], null).blocks).toEqual([next.blocks[0]])
  })
})
