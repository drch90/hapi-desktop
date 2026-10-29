import { describe, expect, it } from 'vitest'
import { buildVisibleChatBlocks } from '@/chat/toolGroups'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { createChatBlockSelector } from '../src/renderer/lib/chat-rendering'
import { buildArticleTranscript, chatBlockKey } from '../src/renderer/lib/article-transcript'
import { fixtureCodexEvent, fixtureMessage } from './fake-server'

function conversation(): ChatBlock[] {
  return createChatBlockSelector()(
    [
      fixtureMessage('question', 1, 'Check the project', true),
      fixtureMessage('commentary', 2, 'I will read the configuration.'),
      fixtureCodexEvent('read', 3, {
        type: 'tool-call',
        callId: 'read',
        name: 'Read',
        input: { file_path: '/repo/package.json' },
      }),
      fixtureCodexEvent('read-result', 4, {
        type: 'tool-call-result',
        callId: 'read',
        output: 'Configuration',
      }),
      fixtureMessage('answer', 5, 'The configuration is correct.'),
      fixtureMessage('answer-details', 6, 'No changes are needed.'),
    ],
    null,
  ).blocks
}

describe('article execution history', () => {
  it('folds commentary and tools while keeping the user and the whole conclusion visible', () => {
    const blocks = conversation()
    const layout = buildArticleTranscript(blocks, false)
    expect(layout.traces.size).toBe(1)
    const trace = [...layout.traces.values()][0]
    expect(trace.toolCount).toBe(1)
    expect(
      blocks.filter((block) => !layout.traceByBlock.has(chatBlockKey(block))).map((block) => block.id),
    ).toEqual(['question', 'answer:0', 'answer-details:0'])
    expect(layout.finalTextKeys.has('agent-text:answer-details:0')).toBe(true)
  })

  it('keeps live, unfinished and waiting work visible even if commentary follows a tool', () => {
    const blocks = conversation()
    expect(buildArticleTranscript(blocks, true).traces.size).toBe(0)
    const tool = blocks.find((block): block is ToolCallBlock => block.kind === 'tool-call')!
    for (const state of ['running', 'pending'] as const) {
      expect(
        buildArticleTranscript(
          blocks.map((block) => (block === tool ? { ...tool, tool: { ...tool.tool, state } } : block)),
          false,
        ).traces.size,
      ).toBe(0)
    }
    expect(buildArticleTranscript(blocks.slice(0, 3), false).traces.size).toBe(0)
  })

  it('keeps plans, notices and pending permissions outside a folded execution record', () => {
    const blocks = conversation()
    const tool = blocks.find((block): block is ToolCallBlock => block.kind === 'tool-call')!
    const plan: ToolCallBlock = {
      ...tool,
      id: 'plan',
      tool: { ...tool.tool, id: 'plan', name: 'ExitPlanMode' },
    }
    const notice: ChatBlock = {
      kind: 'agent-event',
      id: 'notice',
      createdAt: 1,
      event: { type: 'error', message: 'Connection lost' },
    }
    const layout = buildArticleTranscript([...blocks.slice(0, 2), plan, notice, ...blocks.slice(2)], false)
    expect(layout.traceByBlock.has(chatBlockKey(plan))).toBe(false)
    expect(layout.traceByBlock.has(chatBlockKey(notice))).toBe(false)
    const permission = { id: 'permission', status: 'pending' as const }
    const waiting = blocks.map((block) =>
      block === tool ? { ...tool, tool: { ...tool.tool, permission } } : block,
    )
    expect(buildArticleTranscript(waiting, false).traces.size).toBe(0)
  })

  it('keeps earlier completed records foldable during the next active turn', () => {
    const blocks = conversation()
    const next: ChatBlock = { kind: 'user-text', id: 'next', localId: null, createdAt: 2, text: 'Continue' }
    const layout = buildArticleTranscript(
      [
        ...blocks,
        next,
        { kind: 'agent-reasoning', id: 'thinking', localId: null, createdAt: 3, text: 'Checking more' },
      ],
      true,
    )
    expect(layout.traces.size).toBe(1)
    expect(layout.traceByBlock.has('agent-reasoning:thinking')).toBe(false)
  })

  it('preserves a group record identity when earlier narration is loaded and counts every tool', () => {
    const blocks = conversation()
    const tool = blocks.find((block): block is ToolCallBlock => block.kind === 'tool-call')!
    const another = { ...tool, id: 'second', tool: { ...tool.tool, id: 'second' } }
    const grouped = buildVisibleChatBlocks([tool, another, ...blocks.slice(-2)], { hasMoreMessages: true })
    const before = buildArticleTranscript(grouped, false)
    const after = buildArticleTranscript([...blocks.slice(0, 2), ...grouped], false)
    const trace = [...after.traces.values()][0]
    expect(trace.id).toBe([...before.traces.values()][0].id)
    expect(trace.toolCount).toBe(2)
  })
})
