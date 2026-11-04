import type { FixtureHub } from '../fake-server'

// Same opaque identity as HAPI 0.33.5 SharedCodexAsyncQuestions.
export const asyncQuestionId = JSON.stringify(['request_user_input_async', 'item-question-1', 0])
export const asyncQuestionRequestId = `codex-async-question:${JSON.stringify(['native-thread', asyncQuestionId])}`

export function publishAsyncQuestion(server: FixtureHub, requestId = asyncQuestionRequestId) {
  const session = server.sessions.get('design')
  if (!session) throw new Error('Fixture session missing')
  session.agentState = {
    ...session.agentState,
    requests: {
      ...session.agentState?.requests,
      [requestId]: {
        tool: 'request_user_input',
        toolCallId: requestId,
        createdAt: Date.now(),
        arguments: {
          isBlocking: false,
          questions: [
            {
              id: asyncQuestionId,
              question: '用户消息默认采用哪种显示方式？',
              isOther: true,
              options: [{ label: '按原文显示', description: '保留空格、Tab、换行及 # 等符号' }],
            },
          ],
        },
      },
    },
  }
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
}

export function resolveAsyncQuestion(server: FixtureHub, requestId = asyncQuestionRequestId) {
  const session = server.sessions.get('design')
  if (!session) throw new Error('Fixture session missing')
  delete session.agentState?.requests?.[requestId]
  session.agentStateVersion++
  server.emit({ type: 'session-updated', sessionId: session.id, data: session })
}
