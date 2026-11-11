import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClient } from '@/api/client'
import type { DecryptedMessage, MessagesResponse, MessageContextResponse } from '@hapi/protocol'
import {
  activateMessageWindow,
  clearMessageWindow,
  fetchOlderMessages,
  getMessageWindowState,
  ingestIncomingMessages,
  recoverWindowAfterGapResume,
  setMessageViewMode,
  syncTailMessages,
} from '@/lib/message-window-store'

const sessionId = 'gap-recovery'
const state = () => getMessageWindowState(sessionId)

function row(seq: number): DecryptedMessage {
  return {
    id: `message-${seq}`,
    seq,
    localId: null,
    createdAt: seq * 100,
    invokedAt: seq * 100,
    content: { role: 'user', content: { type: 'text', text: `Message ${seq}` } },
  }
}

function tool(seq: number, status: 'in_progress' | 'completed'): DecryptedMessage {
  return {
    ...row(seq),
    content: {
      role: 'agent',
      content: {
        type: 'codex',
        data: { type: 'tool-call', callId: `call-${seq}`, name: 'Bash', input: { command: 'ls' }, status },
      },
    },
  }
}

function rows(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, index) => row(first + index))
}

function page(messages: DecryptedMessage[], patch: Partial<MessagesResponse['page']> = {}): MessagesResponse {
  const oldest = messages[0]
  const newest = messages.at(-1)
  return {
    messages,
    page: {
      direction: 'latest',
      limit: 200,
      epoch: 1,
      reset: false,
      hasMore: true,
      nextBeforeAt: oldest?.invokedAt ?? null,
      nextBeforeSeq: oldest?.seq ?? null,
      nextAfterAt: newest?.invokedAt ?? null,
      nextAfterSeq: newest?.seq ?? null,
      snapshotHeadAt: newest?.invokedAt ?? null,
      snapshotHeadSeq: newest?.seq ?? null,
      ...patch,
    },
  }
}

function context(message: DecryptedMessage, epoch = 1): MessageContextResponse {
  return { messages: [message], targetMessageId: message.id, page: page([message], { epoch }).page }
}

function harness() {
  const api = new ApiClient('')
  const getMessages = vi.spyOn(api, 'getMessages').mockRejectedValue(new Error('Unexpected message request'))
  const getContext = vi
    .spyOn(api, 'getMessageContext')
    .mockRejectedValue(new Error('Unexpected context request'))
  return { api, getMessages, getContext }
}

afterEach(() => {
  clearMessageWindow(sessionId)
  vi.restoreAllMocks()
})

describe('message recovery after an SSE gap', () => {
  it('refreshes an in-place tool update while preserving loaded history and its paging cursor', async () => {
    const { api, getMessages, getContext } = harness()
    const stale = tool(600, 'in_progress')
    const completed = tool(600, 'completed')
    getMessages.mockResolvedValueOnce(page([...rows(401, 599), stale]))
    await syncTailMessages(api, sessionId)
    setMessageViewMode(sessionId, 'history')
    getMessages.mockResolvedValueOnce(page(rows(201, 400), { direction: 'before' }))
    await fetchOlderMessages(api, sessionId)
    getMessages.mockResolvedValueOnce(page(rows(1, 200), { direction: 'before' }))
    await fetchOlderMessages(api, sessionId)
    expect(state().messages).toHaveLength(600)

    getMessages.mockResolvedValueOnce(page([], { direction: 'after', hasMore: false }))
    getMessages.mockResolvedValueOnce(page([completed]))
    await recoverWindowAfterGapResume(api, sessionId)
    expect(state().messages).toHaveLength(600)
    expect(state().messages.at(-1)?.content).toEqual(completed.content)
    expect(state()).toMatchObject({
      oldestSeq: 1,
      newestSeq: 600,
      hasMore: true,
      pendingGapRecovery: false,
      warning: null,
    })
    expect(getContext).not.toHaveBeenCalled()

    getMessages.mockResolvedValueOnce(page([], { direction: 'before', hasMore: false }))
    await fetchOlderMessages(api, sessionId)
    expect(getMessages).toHaveBeenLastCalledWith(sessionId, { beforeAt: 100, beforeSeq: 1, limit: 200 })
  })

  it('catches up every missed page even when cached activation prefers the latest page', async () => {
    const { api, getMessages } = harness()
    getMessages.mockResolvedValueOnce(page([row(1), row(2)]))
    await syncTailMessages(api, sessionId)
    activateMessageWindow(sessionId)
    getMessages.mockResolvedValueOnce(
      page(rows(3, 102), {
        direction: 'after',
        hasMore: true,
        snapshotHeadAt: 20200,
        snapshotHeadSeq: 202,
      }),
    )
    getMessages.mockResolvedValueOnce(page(rows(103, 202), { direction: 'after', hasMore: false }))
    getMessages.mockResolvedValueOnce(page(rows(153, 202)))
    await recoverWindowAfterGapResume(api, sessionId)
    expect(state().messages.map((message) => message.seq)).toEqual(
      Array.from({ length: 202 }, (_, index) => index + 1),
    )
    expect(getMessages).toHaveBeenNthCalledWith(
      3,
      sessionId,
      expect.objectContaining({
        afterSeq: 102,
        untilSeq: 202,
        epoch: 1,
      }),
    )
    expect(state()).toMatchObject({ pendingGapRecovery: false, warning: null })
  })

  it('does not advance the cursor past a failed catch-up and retries on the next sync', async () => {
    const { api, getMessages } = harness()
    getMessages.mockResolvedValueOnce(page([row(1)]))
    await syncTailMessages(api, sessionId)
    getMessages.mockRejectedValueOnce(new Error('Connection interrupted'))
    await recoverWindowAfterGapResume(api, sessionId)
    expect(state()).toMatchObject({
      newestSeq: 1,
      pendingGapRecovery: true,
      isSyncingTail: false,
      warning: 'Connection interrupted',
    })
    expect(getMessages).toHaveBeenCalledTimes(2)

    getMessages.mockResolvedValueOnce(page(rows(2, 4), { direction: 'after', hasMore: false }))
    getMessages.mockResolvedValueOnce(page([row(4)]))
    await syncTailMessages(api, sessionId)
    expect(state().messages.map((message) => message.seq)).toEqual([1, 2, 3, 4])
    expect(state()).toMatchObject({ pendingGapRecovery: false, warning: null })
  })

  async function retainedTool() {
    const harnessState = harness()
    const { api, getMessages } = harnessState
    const stale = tool(2, 'in_progress')
    getMessages.mockResolvedValueOnce(page([row(1), stale]))
    await syncTailMessages(api, sessionId)
    getMessages.mockResolvedValueOnce(page(rows(3, 302), { direction: 'after', hasMore: false }))
    getMessages.mockResolvedValue(page(rows(103, 302)))
    return { ...harnessState, stale, completed: tool(2, 'completed') }
  }

  it('refreshes an old retained tool by id without overwriting a newer SSE result', async () => {
    const { api, getContext } = await retainedTool()
    const gate = Promise.withResolvers<MessageContextResponse | null>()
    getContext.mockReturnValueOnce(gate.promise)
    const recovery = recoverWindowAfterGapResume(api, sessionId)
    await vi.waitFor(() => expect(getContext).toHaveBeenCalledWith(sessionId, 'message-2'))
    const live = { ...tool(2, 'completed'), contentRevision: 10 }
    ingestIncomingMessages(sessionId, [live])
    gate.resolve(context(tool(2, 'in_progress')))
    await recovery
    expect(state().messages.find((message) => message.id === live.id)).toEqual(live)
    expect(state()).toMatchObject({ pendingGapRecovery: false, warning: null, isSyncingTail: false })
  })

  it.each(['error', 'missing'] as const)(
    'retains the recovery flag after a %s context response and retries the tool refresh',
    async (failure) => {
      const { api, getMessages, getContext, stale, completed } = await retainedTool()
      if (failure === 'error') getContext.mockRejectedValueOnce(new Error('Context unavailable'))
      else getContext.mockResolvedValueOnce(null)
      await recoverWindowAfterGapResume(api, sessionId)
      expect(state().messages.find((message) => message.id === stale.id)?.content).toEqual(stale.content)
      expect(state()).toMatchObject({ pendingGapRecovery: true, isSyncingTail: false })
      expect(state().warning).toBeTruthy()
      getMessages.mockResolvedValueOnce(page([], { direction: 'after', hasMore: false }))
      getContext.mockResolvedValueOnce(context(completed))
      await syncTailMessages(api, sessionId)
      expect(state().messages.find((message) => message.id === completed.id)?.content).toEqual(
        completed.content,
      )
      expect(state()).toMatchObject({ pendingGapRecovery: false, warning: null })
    },
  )

  it('replaces the old window after a context response reveals a remote rewind', async () => {
    const { api, getMessages, getContext, completed } = await retainedTool()
    getContext.mockResolvedValueOnce(context(completed, 2))
    await recoverWindowAfterGapResume(api, sessionId)
    expect(state()).toMatchObject({ pendingGapRecovery: true, isSyncingTail: false, epoch: 1 })
    expect(state().warning).toBeTruthy()
    getMessages.mockResolvedValueOnce(page([row(1)], { epoch: 2, hasMore: false }))
    await syncTailMessages(api, sessionId)
    expect(state().messages.map((message) => message.seq)).toEqual([1])
    expect(state()).toMatchObject({ pendingGapRecovery: false, epoch: 2, warning: null })
  })
})
