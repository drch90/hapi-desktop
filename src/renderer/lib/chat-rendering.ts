import { replaceEqualDeep } from '@tanstack/react-query'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { AgentState, DecryptedMessage } from '@/types/api'
import { isQueuedForInvocation } from '@/lib/messages'

export function reuseChatBlocks<T extends { id: string; kind: string }>(
  previous: readonly T[],
  next: T[],
): T[] {
  const byId = new Map(previous.map((block) => [`${block.kind}:${block.id}`, block]))
  return next.map((block) => replaceEqualDeep(byId.get(`${block.kind}:${block.id}`), block))
}

export function createChatBlockSelector() {
  // Message-window updates replace changed records. Unchanged records can
  // reuse normalization, and WeakMap lets evicted history be collected.
  const normalized = new WeakMap<DecryptedMessage, NormalizedMessage | null>()
  let previous: ChatBlock[] = []
  return (messages: DecryptedMessage[], agentState: AgentState | null | undefined) => {
    const input: NormalizedMessage[] = []
    for (const message of messages) {
      if (isQueuedForInvocation(message)) continue
      let value = normalized.get(message)
      if (value === undefined) {
        value = normalizeDecryptedMessage(message)
        normalized.set(message, value)
      }
      if (value !== null) input.push(value)
    }
    const result = reduceChatBlocks(input, agentState)
    result.blocks = reuseChatBlocks(previous, result.blocks)
    previous = result.blocks
    return result
  }
}
