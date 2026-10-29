import type { VisibleChatBlock } from '@/chat/toolGroups'
import type { ToolCallBlock } from '@/chat/types'

export const INLINE_PLAN_TOOLS = new Set([
  'ExitPlanMode',
  'exit_plan_mode',
  'update_plan',
  'TodoWrite',
  'CursorCreatePlan',
])

export type ExecutionTrace = {
  id: string
  blockKeys: string[]
  toolCount: number
  durationMs?: number
}

export const chatBlockKey = (block: VisibleChatBlock) => `${block.kind}:${block.id}`

function toolsInBlock(block: VisibleChatBlock): ToolCallBlock[] {
  return block.kind === 'tool-group' ? block.tools : block.kind === 'tool-call' ? [block] : []
}

function isActivity(block: VisibleChatBlock): boolean {
  return (
    block.kind === 'agent-reasoning' ||
    block.kind === 'tool-group' ||
    (block.kind === 'tool-call' && !INLINE_PLAN_TOOLS.has(block.tool.name))
  )
}

/** Describe folding without regrouping or remounting the message/tool components. */
export function buildArticleTranscript(blocks: readonly VisibleChatBlock[], tailActive: boolean) {
  const traces = new Map<string, ExecutionTrace>()
  const traceByBlock = new Map<string, ExecutionTrace>()
  const finalTextKeys = new Set<string>()
  let response: VisibleChatBlock[] = []

  function finishResponse(active: boolean) {
    const lastText = response.findLast((block) => block.kind === 'agent-text')
    if (lastText) finalTextKeys.add(chatBlockKey(lastText))
    const lastActivity = response.findLastIndex(isActivity)
    const answer = response
      .slice(lastActivity + 1)
      .find(
        (block) =>
          block.kind === 'agent-text' || block.kind === 'codex-review' || block.kind === 'generated-image',
      )
    // A live or waiting turn must stay visible. Only completed work with a
    // separate answer can be folded; plans and notices always stay in place.
    const waiting = response.some((block) =>
      toolsInBlock(block).some(
        ({ tool }) =>
          tool.state === 'running' || tool.state === 'pending' || tool.permission?.status === 'pending',
      ),
    )
    if (active || waiting || lastActivity < 0 || !answer) return
    const work = response
      .slice(0, lastActivity + 1)
      .filter(
        (block) =>
          isActivity(block) ||
          block.kind === 'agent-text' ||
          (block.kind === 'cli-output' && block.source === 'assistant'),
      )
    if (!work.length) return
    const reportedDuration = 'durationMs' in answer ? answer.durationMs : undefined
    const summaryDuration = 'roundSummary' in answer ? answer.roundSummary?.durationMs : undefined
    const durationMs = reportedDuration ?? summaryDuration
    const trace: ExecutionTrace = {
      // The last activity stays stable when older history is prepended.
      id: `execution:${chatBlockKey(response[lastActivity])}`,
      blockKeys: work.map(chatBlockKey),
      toolCount: work.reduce((count, block) => count + toolsInBlock(block).length, 0),
      durationMs:
        durationMs != null && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
    }
    traces.set(trace.blockKeys[0], trace)
    for (const key of trace.blockKeys) traceByBlock.set(key, trace)
  }

  for (const block of blocks) {
    if (block.kind === 'user-text' || (block.kind === 'cli-output' && block.source === 'user')) {
      finishResponse(false)
      response = []
    } else response.push(block)
  }
  finishResponse(tailActive)
  return { traces, traceByBlock, finalTextKeys }
}
